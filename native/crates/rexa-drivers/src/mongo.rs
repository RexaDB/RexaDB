//! Port of `lib/db/mongo-client.ts` on the official Rust driver.
//!
//! The query editor accepts the original's two forms (`parseMongoCommand`):
//! a JSON command `{"operation":"find","collection":"users","filter":{…},
//! "sort":{…},"limit":100,"skip":0}` or shell syntax
//! `db.users.find({…}).sort({…}).limit(100)` (find, findOne, aggregate,
//! count/countDocuments, insertOne/Many, updateOne/Many, deleteOne/Many,
//! `show dbs`, `show collections`). Shell arguments may use relaxed JSON
//! (unquoted keys, single quotes, `ObjectId("…")`, `ISODate("…")`).
//!
//! Documents become rows (columns = union of keys in first-seen order);
//! ObjectIds render as hex, dates as ISO strings, nested values as JSON.

use crate::*;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::options::ClientOptions;
use serde_json::Value as J;
use std::time::Instant;

pub struct MongoDriver {
    client: mongodb::Client,
    default_db: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MongoCommand {
    pub database: Option<String>,
    pub collection: Option<String>,
    pub target_collection: Option<String>,
    pub operation: String,
    pub filter: J,
    pub projection: Option<J>,
    pub sort: Option<J>,
    pub limit: Option<i64>,
    pub skip: Option<i64>,
    pub pipeline: Vec<J>,
    pub document: Option<J>,
    pub documents: Vec<J>,
    pub update: Option<J>,
}

/// Relaxed JSON → JSON: quote bare keys, single → double quotes,
/// `ObjectId("x")` → `{"$oid":"x"}`, `ISODate("x")`/`new Date("x")` → `{"$date":"x"}`.
fn relaxed_json(src: &str) -> Option<J> {
    if let Ok(v) = serde_json::from_str(src) {
        return Some(v);
    }
    let oid = regex::Regex::new(r#"ObjectId\(\s*['"]([0-9a-fA-F]{24})['"]\s*\)"#).unwrap();
    let date = regex::Regex::new(r#"(?:new\s+Date|ISODate)\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap();
    let s = oid.replace_all(src, r#"{"$$oid":"$1"}"#);
    let s = date.replace_all(&s, r#"{"$$date":"$1"}"#);
    // single-quoted strings → double-quoted
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    let mut in_double = false;
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                in_double = !in_double;
                out.push(c);
            }
            '\\' => {
                out.push(c);
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            '\'' if !in_double => {
                out.push('"');
                for n in chars.by_ref() {
                    if n == '\'' {
                        break;
                    }
                    if n == '"' {
                        out.push('\\');
                    }
                    out.push(n);
                }
                out.push('"');
            }
            _ => out.push(c),
        }
    }
    let keys = regex::Regex::new(r#"([{,]\s*)([A-Za-z_$][A-Za-z0-9_$.]*)\s*:"#).unwrap();
    let quoted = keys.replace_all(&out, r#"$1"$2":"#);
    serde_json::from_str(&quoted).ok()
}

/// `evalShellLiteral`.
fn shell_literal(expr: &str) -> J {
    let s = expr.trim();
    if s.is_empty() {
        return J::Null;
    }
    if let Some(v) = relaxed_json(s) {
        return v;
    }
    if let Ok(n) = s.parse::<f64>() {
        return serde_json::json!(n);
    }
    J::String(s.trim_matches(|c| c == '\'' || c == '"').to_string())
}

fn balanced_end(s: &str, start: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 1;
    let mut quote: Option<u8> = None;
    let mut i = start;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
        } else if c == b'\'' || c == b'"' || c == b'`' {
            quote = Some(c);
        } else if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// `splitTopLevelArgs`.
fn split_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut p, mut br, mut bk) = (0i32, 0i32, 0i32);
    let mut quote: Option<char> = None;
    let mut esc = false;
    for c in raw.chars() {
        if esc {
            cur.push(c);
            esc = false;
            continue;
        }
        if c == '\\' {
            cur.push(c);
            esc = true;
            continue;
        }
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => quote = Some(c),
            '(' => p += 1,
            ')' => p -= 1,
            '{' => br += 1,
            '}' => br -= 1,
            '[' => bk += 1,
            ']' => bk -= 1,
            ',' if p == 0 && br == 0 && bk == 0 => {
                out.push(cur.trim().to_string());
                cur.clear();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// `parseMongoShellCommand`.
fn parse_shell(input: &str) -> Option<MongoCommand> {
    let t = input.trim().trim_end_matches(';').trim();
    let lower = t.to_ascii_lowercase();
    if regex::Regex::new(r"^show\s+dbs?$").unwrap().is_match(&lower) {
        return Some(MongoCommand { operation: "listDatabases".into(), ..Default::default() });
    }
    if regex::Regex::new(r"^(show\s+collections?|use\s+[\w-]+)$").unwrap().is_match(&lower) {
        return Some(MongoCommand { operation: "listCollections".into(), ..Default::default() });
    }
    let head = regex::Regex::new(r"^db\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\(").unwrap();
    let caps = head.captures(t)?;
    let (collection, method) = (caps[1].to_string(), caps[2].to_ascii_lowercase());
    let start = caps[0].len();
    let end = balanced_end(t, start)?;
    let args: Vec<J> = split_args(&t[start..end]).iter().map(|a| shell_literal(a)).collect();
    let mut rest = t[end + 1..].trim();
    let mut cmd = MongoCommand { collection: Some(collection), filter: args.first().cloned().unwrap_or(J::Null), ..Default::default() };
    let chain = regex::Regex::new(r"^\.([A-Za-z0-9_]+)\(").unwrap();
    while let Some(c) = chain.captures(rest) {
        let m = c[1].to_ascii_lowercase();
        let open = c[0].len();
        let Some(e) = balanced_end(rest, open) else { break };
        let a: Vec<J> = split_args(&rest[open..e]).iter().map(|x| shell_literal(x)).collect();
        match m.as_str() {
            "sort" => cmd.sort = a.first().cloned(),
            "limit" => cmd.limit = a.first().and_then(J::as_f64).map(|f| f as i64),
            "skip" => cmd.skip = a.first().and_then(J::as_f64).map(|f| f as i64),
            _ => {}
        }
        rest = rest[e + 1..].trim();
    }
    cmd.operation = match method.as_str() {
        "find" => {
            cmd.projection = args.get(1).cloned();
            "find"
        }
        "findone" => {
            cmd.projection = args.get(1).cloned();
            "findOne"
        }
        "aggregate" => {
            cmd.pipeline = args.first().and_then(J::as_array).cloned().unwrap_or_default();
            cmd.filter = J::Null;
            "aggregate"
        }
        "count" | "countdocuments" => "count",
        "insertone" => {
            cmd.document = args.first().cloned();
            "insertOne"
        }
        "insertmany" => {
            cmd.documents = args.first().and_then(J::as_array).cloned().unwrap_or_default();
            "insertMany"
        }
        "updateone" | "updatemany" => {
            cmd.update = args.get(1).cloned();
            if method == "updateone" { "updateOne" } else { "updateMany" }
        }
        "deleteone" => "deleteOne",
        "deletemany" => "deleteMany",
        _ => return None,
    }
    .to_string();
    Some(cmd)
}

/// `parseMongoCommand`.
pub(crate) fn parse_command(input: &str) -> Result<MongoCommand> {
    let t = input.trim();
    if t.is_empty() {
        return Ok(MongoCommand { operation: "listCollections".into(), ..Default::default() });
    }
    match serde_json::from_str::<J>(t) {
        Ok(J::Object(o)) => {
            let s = |k: &str| o.get(k).and_then(J::as_str).map(str::to_string);
            Ok(MongoCommand {
                database: s("database"),
                collection: s("collection"),
                target_collection: s("targetCollection"),
                operation: s("operation").unwrap_or_else(|| "find".into()),
                filter: o.get("filter").cloned().unwrap_or(J::Null),
                projection: o.get("projection").cloned(),
                sort: o.get("sort").cloned(),
                limit: o.get("limit").and_then(J::as_f64).map(|f| f as i64),
                skip: o.get("skip").and_then(J::as_f64).map(|f| f as i64),
                pipeline: o.get("pipeline").and_then(J::as_array).cloned().unwrap_or_default(),
                document: o.get("document").cloned(),
                documents: o.get("documents").and_then(J::as_array).cloned().unwrap_or_default(),
                update: o.get("update").cloned(),
            })
        }
        Ok(_) => bail!("Mongo command JSON must be an object."),
        Err(e) => parse_shell(t).ok_or_else(|| {
            anyhow::anyhow!("Invalid Mongo query. Use JSON command or shell syntax like db.users.find({{}}).limit(100). {e}")
        }),
    }
}

fn to_doc(v: &J) -> Result<Document> {
    match v {
        J::Null => Ok(Document::new()),
        J::Object(_) => match Bson::try_from(v.clone())? {
            Bson::Document(d) => Ok(d),
            _ => Ok(Document::new()),
        },
        _ => bail!("Expected a JSON object, got {v}"),
    }
}

/// `normalizeFilter`: a 24-hex `_id` string becomes an ObjectId.
fn normalize_filter(mut d: Document) -> Document {
    if let Some(Bson::String(s)) = d.get("_id") {
        if let Ok(oid) = ObjectId::parse_str(s) {
            d.insert("_id", oid);
        }
    }
    d
}

/// BSON → plain JSON (`serializeValue`: ObjectId → hex, Date → ISO).
fn plain(b: &Bson) -> J {
    match b {
        Bson::ObjectId(o) => J::String(o.to_hex()),
        Bson::DateTime(d) => J::String(d.try_to_rfc3339_string().unwrap_or_else(|_| d.to_string())),
        Bson::Document(d) => J::Object(d.iter().map(|(k, v)| (k.clone(), plain(v))).collect()),
        Bson::Array(a) => J::Array(a.iter().map(plain).collect()),
        Bson::Int32(i) => (*i).into(),
        Bson::Int64(i) => J::String(i.to_string()),
        Bson::Double(f) => serde_json::Number::from_f64(*f).map_or(J::Null, J::Number),
        Bson::Decimal128(d) => J::String(d.to_string()),
        Bson::Binary(bin) => J::String(bin.bytes.iter().map(|x| format!("{x:02x}")).collect()),
        Bson::Null | Bson::Undefined => J::Null,
        other => other.clone().into_relaxed_extjson(),
    }
}

fn type_of(b: &Bson) -> &'static str {
    match b {
        Bson::Null => "null",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::String(_) => "string",
        Bson::Boolean(_) => "boolean",
        Bson::Int32(_) | Bson::Int64(_) | Bson::Double(_) | Bson::Decimal128(_) => "number",
        _ => "mixed",
    }
}

fn docs_to_result(docs: &[Document], row_limit: usize) -> QueryResult {
    let rows: Vec<J> = docs.iter().take(row_limit).map(|d| plain(&Bson::Document(d.clone()))).collect();
    let mut r = crate::http::objects_to_result(&rows);
    r.truncated = docs.len() > row_limit;
    r.column_types = r.columns.iter().map(|c| ColumnMeta::new(c.clone(), "mixed")).collect();
    r
}

fn one_row(v: J) -> QueryResult {
    crate::http::objects_to_result(&[v])
}

impl MongoDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let mut opts = ClientOptions::parse(cs.trim()).await?;
        opts.app_name = Some("RexaDB".into());
        opts.server_selection_timeout = Some(Duration::from_secs(15));
        opts.connect_timeout = Some(Duration::from_secs(15));
        let client = mongodb::Client::with_options(opts)?;
        client.database("admin").run_command(doc! { "ping": 1 }).await?;
        Ok(MongoDriver { client, default_db: crate::detect::mongo_database(cs) })
    }

    async fn run(&self, cmd: MongoCommand, row_limit: usize) -> Result<QueryResult> {
        let db = self.client.database(cmd.database.as_deref().unwrap_or(&self.default_db));
        let op = cmd.operation.to_ascii_lowercase();
        if op == "listdatabases" {
            let dbs = self.client.list_databases().await?;
            let rows: Vec<J> = dbs.iter().map(|d| serde_json::json!({ "name": d.name, "sizeOnDisk": d.size_on_disk, "empty": d.empty })).collect();
            return Ok(crate::http::objects_to_result(&rows));
        }
        if op == "listcollections" {
            let names = db.list_collection_names().await?;
            let rows: Vec<J> = names.iter().map(|n| serde_json::json!({ "name": n })).collect();
            return Ok(crate::http::objects_to_result(&rows));
        }
        let Some(cname) = cmd.collection.clone() else { bail!("Mongo command requires `collection` for this operation.") };
        let coll = db.collection::<Document>(&cname);
        let filter = normalize_filter(to_doc(&cmd.filter)?);
        let limit = cmd.limit.map(|l| l.clamp(0, 5000)).unwrap_or(100);
        let skip = cmd.skip.unwrap_or(0).max(0) as u64;
        Ok(match op.as_str() {
            "count" => one_row(serde_json::json!({ "count": coll.count_documents(filter).await? })),
            "findone" => {
                let mut f = coll.find_one(filter);
                if let Some(p) = &cmd.projection {
                    f = f.projection(to_doc(p)?);
                }
                docs_to_result(&f.await?.into_iter().collect::<Vec<_>>(), row_limit)
            }
            "find" => {
                let mut f = coll.find(filter).skip(skip).limit(limit);
                if let Some(s) = cmd.sort.as_ref().filter(|s| !s.is_null()) {
                    f = f.sort(to_doc(s)?);
                }
                if let Some(p) = cmd.projection.as_ref().filter(|p| !p.is_null()) {
                    f = f.projection(to_doc(p)?);
                }
                let docs: Vec<Document> = f.await?.try_collect().await?;
                docs_to_result(&docs, row_limit)
            }
            "aggregate" => {
                let mut pipeline: Vec<Document> = cmd.pipeline.iter().map(to_doc).collect::<Result<_>>()?;
                pipeline.push(doc! { "$limit": limit });
                let docs: Vec<Document> = coll.aggregate(pipeline).await?.try_collect().await?;
                docs_to_result(&docs, row_limit)
            }
            "insertone" => {
                let r = coll.insert_one(to_doc(cmd.document.as_ref().unwrap_or(&J::Null))?).await?;
                one_row(serde_json::json!({ "acknowledged": true, "insertedId": plain(&r.inserted_id) }))
            }
            "insertmany" => {
                let docs: Vec<Document> = cmd.documents.iter().map(to_doc).collect::<Result<_>>()?;
                let r = coll.insert_many(docs).await?;
                one_row(serde_json::json!({ "acknowledged": true, "insertedCount": r.inserted_ids.len() }))
            }
            "createcollection" => {
                db.create_collection(&cname).await?;
                one_row(serde_json::json!({ "acknowledged": true, "collection": cname }))
            }
            "dropcollection" => {
                let dropped = match coll.drop().await {
                    Ok(()) => true,
                    Err(e) if e.to_string().to_ascii_lowercase().contains("ns not found") => false,
                    Err(e) => return Err(e.into()),
                };
                one_row(serde_json::json!({ "acknowledged": true, "dropped": dropped, "collection": cname }))
            }
            "clonecollection" => {
                let target = cmd.target_collection.clone().filter(|t| !t.trim().is_empty()).ok_or_else(|| anyhow::anyhow!("Mongo cloneCollection requires `targetCollection`."))?;
                let _: Vec<Document> = coll.aggregate(vec![doc! { "$match": {} }, doc! { "$out": &target }]).await?.try_collect().await?;
                one_row(serde_json::json!({ "acknowledged": true, "source": cname, "target": target }))
            }
            "updateone" | "updatemany" => {
                let update = to_doc(cmd.update.as_ref().unwrap_or(&J::Null))?;
                if update.is_empty() {
                    bail!("Mongo update operations require a non-empty `update` object.");
                }
                let r = if op == "updateone" { coll.update_one(filter, update).await? } else { coll.update_many(filter, update).await? };
                one_row(serde_json::json!({ "acknowledged": true, "matchedCount": r.matched_count, "modifiedCount": r.modified_count }))
            }
            "deleteone" | "deletemany" => {
                let r = if op == "deleteone" { coll.delete_one(filter).await? } else { coll.delete_many(filter).await? };
                one_row(serde_json::json!({ "acknowledged": true, "deletedCount": r.deleted_count }))
            }
            other => bail!("Unsupported Mongo operation: {other}"),
        })
    }
}

fn value_bson(key: &str, v: &Value) -> Bson {
    let j = match v {
        Value::Text(s) => serde_json::from_str::<J>(s).ok().filter(|j| j.is_object() || j.is_array()).unwrap_or_else(|| J::String(s.clone())),
        other => other.to_json(),
    };
    let b = Bson::try_from(j).unwrap_or(Bson::Null);
    match (&b, key) {
        (Bson::String(s), "_id") => ObjectId::parse_str(s).map(Bson::ObjectId).unwrap_or(b),
        _ => b,
    }
}

fn values_doc(vals: &[(String, Value)]) -> Document {
    vals.iter().map(|(k, v)| (k.clone(), value_bson(k, v))).collect()
}

#[async_trait]
impl Driver for MongoDriver {
    fn kind(&self) -> Kind {
        Kind::MongoDb
    }

    /// The original lists only the connection string's database.
    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(vec![self.default_db.clone()])
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.client.list_database_names().await?)
    }

    /// `getMongoCollections` (sorted).
    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let db = if schema.is_empty() { self.default_db.as_str() } else { schema };
        let mut names = self.client.database(db).list_collection_names().await?;
        names.sort();
        Ok(names.into_iter().map(|n| TableRef { schema: db.to_string(), name: n, is_view: false }).collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut r = self.run(parse_command(sql)?, row_limit).await?;
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn ping(&self) -> Result<()> {
        self.client.database("admin").run_command(doc! { "ping": 1 }).await?;
        Ok(())
    }

    async fn count_rows(&self, table: &TableRef, _filter: &TableFilter) -> Result<u64> {
        Ok(self.client.database(&table.schema).collection::<Document>(&table.name).count_documents(doc! {}).await?)
    }

    /// `getMongoCollectionStructure`: field types from a 100-document sample.
    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let coll = self.client.database(&t.schema).collection::<Document>(&t.name);
        let docs: Vec<Document> = coll.find(doc! {}).limit(100).await?.try_collect().await?;
        let mut fields: Vec<(String, Vec<&'static str>)> = Vec::new();
        for d in &docs {
            for (k, v) in d {
                let ty = type_of(v);
                match fields.iter_mut().find(|(n, _)| n == k) {
                    Some((_, ts)) => {
                        if !ts.contains(&ty) {
                            ts.push(ty)
                        }
                    }
                    None => fields.push((k.clone(), vec![ty])),
                }
            }
        }
        if !fields.iter().any(|(n, _)| n == "_id") {
            fields.insert(0, ("_id".into(), vec!["objectId"]));
        }
        Ok(fields
            .into_iter()
            .enumerate()
            .map(|(i, (name, ts))| ColumnDetail {
                is_nullable: ts.contains(&"null"),
                data_type: ts.join("|"),
                full_type: ts.join("|"),
                column_default: (name == "_id").then(|| "ObjectId()".into()),
                is_primary_key: name == "_id",
                ordinal_position: i as i64 + 1,
                column_name: name,
                ..Default::default()
            })
            .collect())
    }

    async fn primary_key(&self, _t: &TableRef) -> Result<Vec<String>> {
        Ok(vec!["_id".into()])
    }

    /// `updateMongoRows`: `updateMany(where, { $set })` per edit.
    async fn update_rows(&self, t: &TableRef, updates: &[RowUpdate]) -> Result<()> {
        let coll = self.client.database(&t.schema).collection::<Document>(&t.name);
        for u in updates {
            coll.update_many(values_doc(&u.r#where), doc! { "$set": values_doc(&u.set) }).await?;
        }
        Ok(())
    }

    /// `deleteMongoRows`: `deleteMany(where)` per row (by `_id` when present).
    async fn delete_rows(&self, t: &TableRef, rows: &[RowValues]) -> Result<u64> {
        let coll = self.client.database(&t.schema).collection::<Document>(&t.name);
        let mut n = 0;
        for r in rows {
            let key: Vec<(String, Value)> = match r.iter().find(|(k, _)| k == "_id") {
                Some(id) => vec![id.clone()],
                None => r.clone(),
            };
            n += coll.delete_many(values_doc(&key)).await?.deleted_count;
        }
        Ok(n)
    }

    async fn insert_rows(&self, t: &TableRef, rows: &[RowValues]) -> Result<u64> {
        let coll = self.client.database(&t.schema).collection::<Document>(&t.name);
        let docs: Vec<Document> = rows.iter().map(|r| values_doc(r)).collect();
        if docs.is_empty() {
            return Ok(0);
        }
        Ok(coll.insert_many(docs).await?.inserted_ids.len() as u64)
    }

    async fn referenced_record(&self, t: &TableRef, keys: &RowValues) -> Result<Option<Record>> {
        let coll = self.client.database(&t.schema).collection::<Document>(&t.name);
        let Some(d) = coll.find_one(values_doc(keys)).await? else { return Ok(None) };
        Ok(docs_to_result(&[d], 1).records().into_iter().next())
    }

    async fn explain(&self, query: &str, _analyze: bool) -> Result<ExplainResult> {
        let cmd = parse_command(query)?;
        let Some(c) = cmd.collection.clone() else { bail!("Explain needs a collection.") };
        let db = self.client.database(cmd.database.as_deref().unwrap_or(&self.default_db));
        let filter = normalize_filter(to_doc(&cmd.filter)?);
        let r = db.run_command(doc! { "explain": { "find": c, "filter": filter }, "verbosity": "queryPlanner" }).await?;
        Ok(ExplainResult { result: docs_to_result(&[r], 1), plan_query: query.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_shell() {
        let c = parse_command(r#"{"operation":"find","database":"d","collection":"u","filter":{"a":1},"limit":5,"skip":10,"sort":{"a":-1}}"#).unwrap();
        assert_eq!((c.operation.as_str(), c.limit, c.skip), ("find", Some(5), Some(10)));
        let c = parse_command("db.users.find({age: {$gt: 3}, name: 'bo'}).sort({age: -1}).limit(20);").unwrap();
        assert_eq!(c.collection.as_deref(), Some("users"));
        assert_eq!(c.filter, serde_json::json!({"age": {"$gt": 3}, "name": "bo"}));
        assert_eq!((c.sort.clone().unwrap(), c.limit), (serde_json::json!({"age": -1}), Some(20)));
        let c = parse_command(r#"db.u.findOne({_id: ObjectId("507f1f77bcf86cd799439011")})"#).unwrap();
        assert_eq!(c.filter, serde_json::json!({"_id": {"$oid": "507f1f77bcf86cd799439011"}}));
        let c = parse_command(r#"db.u.updateMany({"a":1}, {"$set":{"b":2}})"#).unwrap();
        assert_eq!(c.operation, "updateMany");
        assert_eq!(parse_command("show dbs").unwrap().operation, "listDatabases");
        assert_eq!(parse_command("").unwrap().operation, "listCollections");
        assert!(parse_command("nonsense(").is_err());
        let d = normalize_filter(to_doc(&serde_json::json!({"_id": "507f1f77bcf86cd799439011"})).unwrap());
        assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
    }

    #[test]
    fn documents_to_rows() {
        let d = doc! { "_id": ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap(), "n": 1, "tags": ["a"], "sub": { "x": true } };
        let r = docs_to_result(&[d, doc! { "z": Bson::Null }], 10);
        assert_eq!(r.columns, vec!["_id", "n", "tags", "sub", "z"]);
        assert_eq!(r.rows[0][0], Cell::Text("507f1f77bcf86cd799439011".into()));
        assert_eq!(r.rows[0][2], Cell::Text("[\"a\"]".into()));
        assert_eq!(r.rows[1][0], Cell::Null);
    }
}
