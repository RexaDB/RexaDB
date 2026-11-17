//! Port of `lib/db/federated/*`: one connection that queries several saved
//! Postgres / SQLite(libSQL) / MySQL connections at once.
//!
//! * Connection string: `federated://<base64url(JSON {version:1, sources:[{alias,
//!   connectionId, namespace?}]})>` ([`build_federated_connection_string`]).
//! * Saved connections are resolved through a host-provided resolver
//!   ([`set_federated_resolver`]) — the app wires it to `rexa-store` (the
//!   original reads the `connections` table + keychain).
//! * Catalog: schemas = aliases; tables/structure/FKs come from the source.
//! * Queries (SELECT / WITH / set operations only): every `alias.table`
//!   (or unambiguous bare `table`) after FROM/JOIN is loaded from its source
//!   (`SELECT * FROM namespace.table`), copied into an in-memory SQLite temp
//!   table `federated_<alias>__<table>`, references are rewritten, and the
//!   query runs on SQLite — the original's `executeFederatedQueryWithLoader`.

use crate::*;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use tokio::sync::Mutex as AsyncMutex;

/// One mapped source (`FederatedSource`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FederatedSource {
    pub alias: String,
    #[serde(rename = "connectionId")]
    pub connection_id: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub namespace: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FederatedConfig {
    version: u32,
    sources: Vec<FederatedSource>,
}

/// A saved connection the resolver returns.
#[derive(Debug, Clone)]
pub struct ResolvedConnection {
    pub connection_type: String,
    pub connection_string: String,
    pub name: String,
}

type Resolver = Arc<dyn Fn(i64) -> Option<ResolvedConnection> + Send + Sync>;

fn resolver_slot() -> &'static RwLock<Option<Resolver>> {
    static R: OnceLock<RwLock<Option<Resolver>>> = OnceLock::new();
    R.get_or_init(|| RwLock::new(None))
}

/// Install the lookup from connection id → saved connection (type +
/// decrypted connection string). Call once at startup.
pub fn set_federated_resolver(f: impl Fn(i64) -> Option<ResolvedConnection> + Send + Sync + 'static) {
    *resolver_slot().write().unwrap() = Some(Arc::new(f));
}

fn validate(sources: Vec<FederatedSource>) -> Result<Vec<FederatedSource>> {
    let sources: Vec<FederatedSource> = sources
        .into_iter()
        .map(|s| FederatedSource { alias: s.alias.trim().to_string(), connection_id: s.connection_id, namespace: s.namespace.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) })
        .filter(|s| !s.alias.is_empty() && s.connection_id > 0)
        .collect();
    if sources.is_empty() {
        bail!("Federated connections require at least one mapped source.");
    }
    let ident = regex::Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").unwrap();
    let mut seen = std::collections::HashSet::new();
    for s in &sources {
        if !ident.is_match(&s.alias) {
            bail!("Invalid federated alias \"{}\". Use letters, numbers, and underscores only.", s.alias);
        }
        if !seen.insert(s.alias.clone()) {
            bail!("Duplicate federated alias \"{}\".", s.alias);
        }
    }
    Ok(sources)
}

/// `buildFederatedConnectionString`.
pub fn build_federated_connection_string(sources: Vec<FederatedSource>) -> Result<String> {
    let cfg = FederatedConfig { version: 1, sources: validate(sources)? };
    Ok(format!("federated://{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_string(&cfg)?)))
}

/// `parseFederatedConnectionString`.
pub fn parse_federated_connection_string(cs: &str) -> Result<Vec<FederatedSource>> {
    let raw = cs.trim();
    let Some(payload) = raw.get(..12).filter(|p| p.eq_ignore_ascii_case("federated://")).map(|_| &raw[12..]) else {
        bail!("Invalid federated connection string.")
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| anyhow::anyhow!("Invalid federated connection string."))?;
    let cfg: serde_json::Value = serde_json::from_slice(&bytes)?;
    let sources: Vec<FederatedSource> = serde_json::from_value(cfg.get("sources").cloned().unwrap_or_default()).unwrap_or_default();
    validate(sources)
}

/// `getFederatedTempTableName`.
fn temp_name(alias: &str, table: &str) -> String {
    let base: String = format!("{alias}__{table}").chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    format!("federated_{base}")
}

/// `toFederatedSqliteType`.
fn sqlite_type(dt: &str) -> &'static str {
    let t = dt.to_ascii_lowercase();
    if ["int", "serial", "bigint", "smallint"].iter().any(|k| t.contains(k)) {
        "INTEGER"
    } else if ["real", "double", "float", "numeric", "decimal"].iter().any(|k| t.contains(k)) {
        "REAL"
    } else if ["blob", "binary", "bytea"].iter().any(|k| t.contains(k)) {
        "BLOB"
    } else {
        "TEXT"
    }
}

struct Source {
    alias: String,
    namespace: String,
    driver: Arc<dyn Driver>,
}

pub struct FederatedDriver {
    sources: Vec<FederatedSource>,
    resolved: AsyncMutex<HashMap<String, Arc<Source>>>,
}

/// A table reference found in the query: byte span + alias/table.
#[derive(Debug, Clone, PartialEq)]
struct Ref {
    start: usize,
    end: usize,
    alias: Option<String>,
    table: String,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Ident(String, bool),
    Dot,
    Comma,
    Open,
    Close,
    Other,
}

fn tokenize(sql: &str) -> Vec<(usize, usize, Tok)> {
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
        } else if c == b'-' && b.get(i + 1) == Some(&b'-') {
            i = sql[i..].find('\n').map_or(b.len(), |p| i + p);
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            i = sql[i + 2..].find("*/").map_or(b.len(), |p| i + 2 + p + 2);
        } else if c == b'\'' {
            let mut j = i + 1;
            while j < b.len() {
                if b[j] == b'\'' {
                    if b.get(j + 1) == Some(&b'\'') {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j += 1;
            }
            out.push((i, (j + 1).min(b.len()), Tok::Other));
            i = j + 1;
        } else if c == b'"' || c == b'`' {
            let mut j = i + 1;
            let mut name = String::new();
            while j < b.len() {
                if b[j] == c {
                    if b.get(j + 1) == Some(&c) {
                        name.push(c as char);
                        j += 2;
                        continue;
                    }
                    break;
                }
                name.push(b[j] as char);
                j += 1;
            }
            out.push((i, (j + 1).min(b.len()), Tok::Ident(name, true)));
            i = j + 1;
        } else if c.is_ascii_alphabetic() || c == b'_' {
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'$') {
                j += 1;
            }
            out.push((i, j, Tok::Ident(sql[i..j].to_string(), false)));
            i = j;
        } else {
            let t = match c {
                b'.' => Tok::Dot,
                b',' => Tok::Comma,
                b'(' => Tok::Open,
                b')' => Tok::Close,
                _ => Tok::Other,
            };
            out.push((i, i + 1, t));
            i += 1;
        }
    }
    out
}

const STOP: [&str; 18] = [
    "where", "group", "order", "limit", "having", "union", "intersect", "except", "on", "using", "join", "left", "right", "inner", "outer",
    "cross", "full", "natural",
];

const CLAUSES: [&str; 12] = ["where", "group", "order", "limit", "having", "union", "intersect", "except", "select", "returning", "window", "offset"];

/// Table references after FROM / JOIN (and comma lists in FROM), skipping
/// subqueries and CTE names (`collectFederatedRefs`).
fn find_refs(sql: &str) -> Vec<Ref> {
    let toks = tokenize(sql);
    let kw = |i: usize, w: &str| matches!(toks.get(i), Some((_, _, Tok::Ident(s, false))) if s.eq_ignore_ascii_case(w));
    // CTE names: WITH [RECURSIVE] name AS (, name AS (
    let mut ctes = std::collections::HashSet::new();
    for i in 0..toks.len() {
        if let (Some((_, _, Tok::Ident(n, _))), true, Some((_, _, Tok::Open))) = (toks.get(i), kw(i + 1, "as"), toks.get(i + 2)) {
            ctes.insert(n.to_ascii_lowercase());
        }
    }
    let mut refs = Vec::new();
    // Parse one table reference at `j`; returns the index after it (and its alias).
    let parse_one = |j: usize, refs: &mut Vec<Ref>| -> usize {
        let Some((s, _, Tok::Ident(first, quoted))) = toks.get(j).cloned() else { return j };
        if !quoted && (STOP.contains(&first.to_ascii_lowercase().as_str()) || first.eq_ignore_ascii_case("select") || first.eq_ignore_ascii_case("lateral")) {
            return j;
        }
        let (alias, table, end, mut next) = match (toks.get(j + 1), toks.get(j + 2)) {
            (Some((_, _, Tok::Dot)), Some((_, e, Tok::Ident(t, _)))) => (Some(first.clone()), t.clone(), *e, j + 3),
            _ => (None, first.clone(), toks[j].1, j + 1),
        };
        if alias.is_some() || !ctes.contains(&table.to_ascii_lowercase()) {
            refs.push(Ref { start: s, end, alias, table });
        }
        if kw(next, "as") {
            next += 2;
        } else if let Some((_, _, Tok::Ident(a, q))) = toks.get(next) {
            if *q || !(STOP.contains(&a.to_ascii_lowercase().as_str()) || CLAUSES.contains(&a.to_ascii_lowercase().as_str())) {
                next += 1;
            }
        }
        next
    };
    // Per paren depth: are we inside a FROM list?
    let mut in_from = vec![false];
    let mut i = 0;
    while i < toks.len() {
        match &toks[i].2 {
            Tok::Open => {
                in_from.push(false);
                i += 1;
            }
            Tok::Close => {
                if in_from.len() > 1 {
                    in_from.pop();
                }
                i += 1;
            }
            Tok::Comma if *in_from.last().unwrap() => i = parse_one(i + 1, &mut refs).max(i + 1),
            Tok::Ident(w, false) if w.eq_ignore_ascii_case("from") || w.eq_ignore_ascii_case("join") => {
                *in_from.last_mut().unwrap() = true;
                i = parse_one(i + 1, &mut refs).max(i + 1);
            }
            Tok::Ident(w, false) if CLAUSES.contains(&w.to_ascii_lowercase().as_str()) => {
                *in_from.last_mut().unwrap() = false;
                i += 1;
            }
            _ => i += 1,
        }
    }
    refs
}

fn is_read_query(sql: &str) -> bool {
    let h = sql.trim_start().trim_start_matches('(').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
    matches!(h.as_str(), "select" | "with" | "values")
}

impl FederatedDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let sources = parse_federated_connection_string(cs)?;
        // Sources connect lazily on first use; check they resolve now.
        let resolver = resolver_slot().read().unwrap().clone();
        if let Some(r) = resolver {
            for s in &sources {
                if r(s.connection_id).is_none() {
                    bail!("Federated source \"{}\" points to a missing connection.", s.alias);
                }
            }
        }
        Ok(FederatedDriver { sources, resolved: AsyncMutex::new(HashMap::new()) })
    }

    /// `resolveFederatedSources` + connect (cached).
    async fn source(&self, alias: &str) -> Result<Arc<Source>> {
        if let Some(s) = self.resolved.lock().await.get(alias) {
            return Ok(s.clone());
        }
        let Some(src) = self.sources.iter().find(|s| s.alias == alias).cloned() else { bail!("Unknown federated source alias \"{alias}\".") };
        let resolver = resolver_slot().read().unwrap().clone().ok_or_else(|| anyhow::anyhow!("Federated connections need the saved-connection resolver (set_federated_resolver)."))?;
        let conn = resolver(src.connection_id).ok_or_else(|| anyhow::anyhow!("Federated source \"{alias}\" points to a missing connection."))?;
        let kind = Kind::detect(&conn.connection_type, &conn.connection_string).unwrap_or(Kind::Postgres);
        if kind == Kind::Federated {
            bail!("Nested federated connections are not supported.");
        }
        if !matches!(kind, Kind::Postgres | Kind::Sqlite | Kind::MySql) {
            bail!("Federated source \"{alias}\" must be postgres, sqlite/libsql, or mysql.");
        }
        let fut: std::pin::Pin<Box<dyn std::future::Future<Output = Result<Arc<dyn Driver>>> + Send + '_>> =
            Box::pin(connect(kind, &conn.connection_string));
        let driver = fut.await?;
        let namespace = src.namespace.clone().unwrap_or_else(|| match kind {
            Kind::Sqlite => "main".into(),
            Kind::MySql => crate::detect::database_name(&conn.connection_string),
            _ => "public".into(),
        });
        let s = Arc::new(Source { alias: alias.to_string(), namespace, driver });
        self.resolved.lock().await.insert(alias.to_string(), s.clone());
        Ok(s)
    }

    async fn resolve_bare(&self, table: &str) -> Result<String> {
        let mut matches = Vec::new();
        for s in &self.sources {
            let src = self.source(&s.alias).await?;
            if src.driver.tables(&src.namespace).await?.iter().any(|t| t.name == table) {
                matches.push(s.alias.clone());
            }
        }
        match matches.len() {
            1 => Ok(matches.remove(0)),
            0 => bail!("Table \"{table}\" was not found in any federated source."),
            _ => bail!("Table \"{table}\" exists in multiple federated sources. Use alias.table syntax."),
        }
    }

    /// `executeFederatedQueryWithLoader`.
    async fn query(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        if !is_read_query(sql) {
            bail!("Federated queries currently support SELECT, WITH, and set-operation statements only.");
        }
        let refs = find_refs(sql);
        let temp = crate::sqlite::SqliteDriver::open(":memory:")?;
        let mut loaded: HashMap<String, String> = HashMap::new();
        let mut rewritten = String::new();
        let mut last = 0;
        for r in &refs {
            let alias = match &r.alias {
                Some(a) if self.sources.iter().any(|s| &s.alias == a) => a.clone(),
                Some(_) => continue, // e.g. a real schema-qualified ref the sources don't own
                None => self.resolve_bare(&r.table).await?,
            };
            let name = temp_name(&alias, &r.table);
            if !loaded.contains_key(&name) {
                let src = self.source(&alias).await?;
                let tref = TableRef::new(&src.namespace, &r.table);
                let structure = src.driver.table_structure(&tref).await?;
                let data = src.driver.execute(&format!("SELECT * FROM {}", src.driver.dialect().table_ref(&src.namespace, &r.table)), usize::MAX).await?;
                let cols: Vec<(String, &str)> = if structure.is_empty() {
                    data.columns.iter().map(|c| (c.clone(), "TEXT")).collect()
                } else {
                    structure.iter().map(|c| (c.column_name.clone(), sqlite_type(&c.data_type))).collect()
                };
                let q = |s: &str| Dialect::Sqlite.quote_ident(s);
                let mut stmts = vec![format!("CREATE TABLE {} ({})", q(&name), cols.iter().map(|(n, t)| format!("{} {t}", q(n))).collect::<Vec<_>>().join(", "))];
                for row in &data.rows {
                    let vals: Vec<String> = data
                        .columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            let ty = cols.iter().find(|(n, _)| n == c).map_or("TEXT", |x| x.1);
                            match row.get(i) {
                                Some(Cell::Text(s)) if (ty == "INTEGER" || ty == "REAL") && s.parse::<f64>().is_ok() => s.clone(),
                                Some(Cell::Text(s)) => Dialect::Sqlite.quote_str(s),
                                _ => "NULL".into(),
                            }
                        })
                        .collect();
                    stmts.push(format!("INSERT INTO {} ({}) VALUES ({})", q(&name), data.columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", "), vals.join(", ")));
                }
                temp.transaction(&stmts).await?;
                loaded.insert(name.clone(), alias.clone());
            }
            rewritten.push_str(&sql[last..r.start]);
            rewritten.push_str(&Dialect::Sqlite.quote_ident(&name));
            last = r.end;
        }
        rewritten.push_str(&sql[last..]);
        let mut r = temp.execute(&rewritten, row_limit).await?;
        r.column_types.clear();
        Ok(r)
    }
}

#[async_trait]
impl Driver for FederatedDriver {
    fn kind(&self) -> Kind {
        Kind::Federated
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(self.sources.iter().map(|s| s.alias.clone()).collect())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        self.schemas().await
    }

    async fn tables(&self, alias: &str) -> Result<Vec<TableRef>> {
        let src = self.source(alias).await?;
        Ok(src.driver.tables(&src.namespace).await?.into_iter().map(|t| TableRef { schema: alias.to_string(), ..t }).collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = std::time::Instant::now();
        let mut last = QueryResult::default();
        for s in split::split_statements(sql, Dialect::Postgres) {
            last = self.query(&s, row_limit).await?;
        }
        last.elapsed = started.elapsed();
        Ok(last)
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let src = self.source(&t.schema).await?;
        src.driver.table_structure(&TableRef::new(&src.namespace, &t.name)).await
    }

    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        let src = self.source(&t.schema).await?;
        Ok(src
            .driver
            .foreign_keys(&TableRef::new(&src.namespace, &t.name))
            .await?
            .into_iter()
            .map(|f| ForeignKey { foreign_table_schema: src.alias.clone(), ..f })
            .collect())
    }

    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let mut out = Vec::new();
        for s in self.sources.iter().filter(|s| schema.is_none_or(|f| f == s.alias)) {
            let src = self.source(&s.alias).await?;
            for c in src.driver.all_tables_with_columns(Some(&src.namespace)).await? {
                out.push(SchemaColumn {
                    table_schema: s.alias.clone(),
                    referenced_table_schema: c.referenced_table_name.as_ref().map(|_| s.alias.clone()),
                    ..c
                });
            }
        }
        Ok(out)
    }

    /// `getFederatedReferencedRecord`: looked up in the source.
    async fn referenced_record(&self, t: &TableRef, keys: &RowValues) -> Result<Option<Record>> {
        let src = self.source(&t.schema).await?;
        src.driver.referenced_record(&TableRef::new(&src.namespace, &t.name), keys).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_string_round_trip() {
        let s = vec![
            FederatedSource { alias: "pg".into(), connection_id: 3, namespace: Some("public".into()) },
            FederatedSource { alias: "lite".into(), connection_id: 4, namespace: None },
        ];
        let cs = build_federated_connection_string(s.clone()).unwrap();
        assert_eq!(parse_federated_connection_string(&cs).unwrap(), s);
        assert!(build_federated_connection_string(vec![FederatedSource { alias: "bad alias".into(), connection_id: 1, namespace: None }]).is_err());
        assert_eq!(Kind::detect("", &cs), Some(Kind::Federated));
    }

    #[test]
    fn finds_table_refs() {
        let sql = "WITH x AS (SELECT * FROM pg.users) SELECT u.id, o.total FROM x JOIN lite.\"orders\" o ON o.uid = x.id, pg.items AS i WHERE 'from a.b' = '' ORDER BY 1";
        let refs: Vec<(Option<String>, String)> = find_refs(sql).into_iter().map(|r| (r.alias, r.table)).collect();
        assert_eq!(
            refs,
            vec![(Some("pg".into()), "users".into()), (Some("lite".into()), "orders".into()), (Some("pg".into()), "items".into())]
        );
        assert_eq!(find_refs("SELECT * FROM (SELECT 1) s JOIN t ON true").iter().map(|r| r.table.clone()).collect::<Vec<_>>(), vec!["t"]);
        assert_eq!(temp_name("a", "b-c"), "federated_a__b_c");
    }

    #[tokio::test]
    async fn joins_two_sqlite_sources() {
        let dir = std::env::temp_dir().join(format!("rexa-fed-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b) = (dir.join("a.db"), dir.join("b.db"));
        let da = connect(Kind::Sqlite, a.to_str().unwrap()).await.unwrap();
        da.execute("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1,'ann'),(2,'bob')", 1).await.unwrap();
        let db = connect(Kind::Sqlite, b.to_str().unwrap()).await.unwrap();
        db.execute("CREATE TABLE orders(id INTEGER PRIMARY KEY, uid INTEGER, total REAL); INSERT INTO orders VALUES (1,2,9.5),(2,2,0.5)", 1).await.unwrap();
        let (pa, pb) = (a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned());
        set_federated_resolver(move |id| {
            let cs = match id {
                1 => pa.clone(),
                2 => pb.clone(),
                _ => return None,
            };
            Some(ResolvedConnection { connection_type: "sqlite".into(), connection_string: cs, name: format!("c{id}") })
        });
        let cs = build_federated_connection_string(vec![
            FederatedSource { alias: "a".into(), connection_id: 1, namespace: None },
            FederatedSource { alias: "b".into(), connection_id: 2, namespace: None },
        ])
        .unwrap();
        let d = connect_detect("federated", &cs).await.unwrap();
        assert_eq!(d.schemas().await.unwrap(), vec!["a", "b"]);
        assert_eq!(d.tables("b").await.unwrap()[0].name, "orders");
        let r = d.execute("SELECT u.name, SUM(o.total) AS t FROM a.users u JOIN orders o ON o.uid = u.id GROUP BY u.name", 10).await.unwrap();
        assert_eq!(r.rows, vec![vec![Cell::Text("bob".into()), Cell::Text("10".into())]]);
        assert!(d.execute("DELETE FROM a.users", 1).await.is_err());
        assert_eq!(d.all_tables_with_columns(None).await.unwrap().len(), 5);
        let _ = std::fs::remove_dir_all(dir);
    }
}
