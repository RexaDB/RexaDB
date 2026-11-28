//! Port of `lib/db/spacetimedb-client.ts` over the HTTP API (the original's
//! fallback path; same results as its websocket path):
//! `spacetimedb[s]://host[:port]/{database}?token=` → `POST
//! /v1/database/{db}/sql`, schema from `GET …/schema?version=9` (v9
//! `tables`/`typespace`) or v10 (`sections`). Row edits go through the
//! `update_{table}` / `delete_{table}` reducers like the original.

use crate::http::{client, json, json_to_cell};
use crate::*;
use serde_json::Value as J;
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;

pub struct SpacetimeDriver {
    base: String,
    database: String,
    token: Option<String>,
    module: AsyncMutex<Option<J>>,
}

pub(crate) fn parse(cs: &str) -> Result<(String, String, Option<String>)> {
    let raw = cs.trim();
    if raw.is_empty() {
        bail!("SpacetimeDB: empty connection string");
    }
    let u = url::Url::parse(raw).map_err(|e| anyhow::anyhow!("SpacetimeDB: invalid connection string - {e}"))?;
    let https = u.scheme() == "spacetimedbs";
    let host = u.host_str().unwrap_or("localhost");
    let port = u.port().unwrap_or(if https { 443 } else { 3000 });
    let database = crate::detect::percent_decode(u.path().trim_start_matches('/'));
    if database.is_empty() {
        bail!("SpacetimeDB: database name is required");
    }
    let token = u.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()).filter(|t| !t.is_empty());
    Ok((format!("{}://{host}:{port}", if https { "https" } else { "http" }), database, token))
}

fn el_name(el: &J) -> String {
    el.pointer("/name/some").and_then(J::as_str).or_else(|| el.get("name").and_then(J::as_str)).unwrap_or("?").to_string()
}

/// `resolveAlgebraicTypeName`.
fn type_name(at: &J, ts: &[J]) -> String {
    let Some((k, v)) = at.as_object().and_then(|o| o.iter().next()) else { return "unknown".into() };
    match k.as_str() {
        "Ref" => v.as_u64().and_then(|i| ts.get(i as usize)).map(|t| type_name(t, ts)).unwrap_or_else(|| "Ref".into()),
        "Product" => {
            let els = v.get("elements").and_then(J::as_array).cloned().unwrap_or_default();
            if els.len() == 1 {
                match el_name(&els[0]).as_str() {
                    "__identity__" => return "Identity".into(),
                    "__timestamp_micros_since_unix_epoch__" => return "Timestamp".into(),
                    "__time_duration__" => return "TimeDuration".into(),
                    "__connection_id__" => return "ConnectionId".into(),
                    "__uuid__" => return "Uuid".into(),
                    _ => {}
                }
            }
            "Product".into()
        }
        "Sum" => {
            let vars = v.get("variants").and_then(J::as_array).cloned().unwrap_or_default();
            match vars.iter().find(|x| x.pointer("/name/some").and_then(J::as_str) == Some("some")) {
                Some(s) => {
                    let inner = type_name(s.get("algebraic_type").unwrap_or(&J::Null), ts);
                    if inner == "unknown" { "Option".into() } else { format!("Option<{inner}>") }
                }
                None => "Sum".into(),
            }
        }
        "Array" => match v.get("elem_ty") {
            Some(e) => format!("Array<{}>", type_name(e, ts)),
            None => "Array".into(),
        },
        other => other.to_string(),
    }
}

/// `unwrapSatsValue`: single-element product wrappers → the inner value.
fn unwrap_sats(v: &J, at: &J, ts: &[J]) -> J {
    let Some((k, inner)) = at.as_object().and_then(|o| o.iter().next()) else { return v.clone() };
    match k.as_str() {
        "Ref" => inner.as_u64().and_then(|i| ts.get(i as usize)).map_or(v.clone(), |t| unwrap_sats(v, t, ts)),
        "Array" => v.clone(),
        _ => match v.as_array() {
            Some(a) if a.len() == 1 => a[0].clone(),
            _ => v.clone(),
        },
    }
}

#[derive(Debug, Clone)]
struct StTable {
    name: String,
    columns: Vec<(String, J)>,
    primary_key: Vec<usize>,
    type_ref: u64,
}

fn module_tables(m: &J) -> (Vec<StTable>, Vec<J>) {
    let (tables, ts): (Vec<J>, Vec<J>) = if let Some(sections) = m.get("sections").and_then(J::as_array) {
        let t = sections.iter().find_map(|s| s.get("Tables")).and_then(J::as_array).cloned().unwrap_or_default();
        let ts = sections.iter().find_map(|s| s.pointer("/Typespace/types")).and_then(J::as_array).cloned().unwrap_or_default();
        (t, ts)
    } else {
        (
            m.get("tables").and_then(J::as_array).cloned().unwrap_or_default(),
            m.pointer("/typespace/types").and_then(J::as_array).cloned().unwrap_or_default(),
        )
    };
    let out = tables
        .iter()
        .filter(|t| {
            let tt = t.get("table_type").unwrap_or(&J::Null);
            tt.get("User").is_some() || tt.as_str() == Some("User")
        })
        .map(|t| {
            let type_ref = t.get("product_type_ref").and_then(J::as_u64).unwrap_or(0);
            let els = ts.get(type_ref as usize).and_then(|x| x.pointer("/Product/elements")).and_then(J::as_array).cloned().unwrap_or_default();
            StTable {
                name: t.get("source_name").or_else(|| t.get("name")).and_then(J::as_str).unwrap_or("").to_string(),
                columns: els.iter().map(|e| (el_name(e), e.get("algebraic_type").cloned().unwrap_or(J::Null))).collect(),
                primary_key: t.get("primary_key").and_then(J::as_array).into_iter().flatten().filter_map(J::as_u64).map(|x| x as usize).collect(),
                type_ref,
            }
        })
        .collect();
    (out, ts)
}

impl SpacetimeDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let (base, database, token) = parse(cs)?;
        Ok(SpacetimeDriver { base, database, token, module: AsyncMutex::new(None) })
    }

    fn auth(&self, r: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.token {
            Some(t) => r.bearer_auth(t),
            None => r,
        }
    }

    fn db_path(&self) -> String {
        format!("{}/v1/database/{}", self.base, percent_encoding::utf8_percent_encode(&self.database, percent_encoding::NON_ALPHANUMERIC))
    }

    async fn module(&self) -> Result<J> {
        let mut g = self.module.lock().await;
        if let Some(m) = g.as_ref() {
            return Ok(m.clone());
        }
        let m = match json(self.auth(client().get(format!("{}/schema?version=9", self.db_path()))), "SpacetimeDB").await {
            Ok(m) => m,
            Err(_) => json(self.auth(client().get(format!("{}/schema?version=10", self.db_path()))), "SpacetimeDB").await?,
        };
        *g = Some(m.clone());
        Ok(m)
    }

    /// `callSpacetimeDbReducer` (HTTP).
    pub async fn call_reducer(&self, reducer: &str, args: &[J]) -> Result<()> {
        let url = format!("{}/call/{}", self.db_path(), percent_encoding::utf8_percent_encode(reducer, percent_encoding::NON_ALPHANUMERIC));
        let res = self.auth(client().post(url)).json(&args).send().await?;
        if !res.status().is_success() {
            let status = res.status();
            bail!("SpacetimeDB POST /call/{reducer} failed ({status}): {}", res.text().await.unwrap_or_default());
        }
        Ok(())
    }

    async fn reducer_args(&self, name: &str) -> Result<Option<Vec<String>>> {
        let m = self.module().await?;
        let reducers: Vec<J> = m
            .get("sections")
            .and_then(J::as_array)
            .and_then(|s| s.iter().find_map(|x| x.get("Reducers")).and_then(J::as_array).cloned())
            .or_else(|| m.get("reducers").and_then(J::as_array).cloned())
            .unwrap_or_default();
        Ok(reducers
            .iter()
            .find(|r| {
                r.pointer("/source_name/some").and_then(J::as_str).or_else(|| r.get("source_name").and_then(J::as_str)).or_else(|| r.get("name").and_then(J::as_str))
                    == Some(name)
            })
            .map(|r| {
                let params = r.get("params").or_else(|| r.get("args")).cloned().unwrap_or(J::Null);
                let els = params.get("elements").and_then(J::as_array).cloned().or_else(|| params.as_array().cloned()).unwrap_or_default();
                els.iter().map(el_name).collect()
            }))
    }
}

fn value_json(v: &Value) -> J {
    match v {
        Value::Text(s) => serde_json::from_str::<J>(s).ok().filter(|j| j.is_number() || j.is_boolean()).unwrap_or_else(|| J::String(s.clone())),
        other => other.to_json(),
    }
}

#[async_trait]
impl Driver for SpacetimeDriver {
    fn kind(&self) -> Kind {
        Kind::SpacetimeDb
    }

    async fn spacetimedb_module(&self) -> Result<J> { self.module().await }

    async fn spacetimedb_logs(&self, num_lines: usize) -> Result<Vec<J>> {
        let url = format!("{}/logs?num_lines={}", self.db_path(), num_lines.clamp(1, 1000));
        let response = self.auth(client().get(url)).send().await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() { bail!("SpacetimeDB log request failed ({status}): {body}"); }
        let payload: J = serde_json::from_str(&body)?;
        Ok(payload.as_array().cloned().unwrap_or_default())
    }

    async fn call_spacetimedb_reducer(&self, name: &str, args: &[J]) -> Result<()> {
        self.call_reducer(name, args).await
    }

    /// The original reports no schemas; the database name acts as the namespace.
    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(vec![self.database.clone()])
    }

    async fn tables(&self, _schema: &str) -> Result<Vec<TableRef>> {
        let (t, _) = module_tables(&self.module().await?);
        Ok(t.into_iter().map(|t| TableRef { schema: self.database.clone(), name: t.name, is_view: false }).collect())
    }

    async fn views(&self, _schema: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        if regex::Regex::new(r"\$\d+").unwrap().is_match(sql) {
            bail!("SpacetimeDB does not support parameterized queries ($1, $2, ...). Use inline values.");
        }
        let started = Instant::now();
        let raw = json(self.auth(client().post(format!("{}/sql", self.db_path()))).header("content-type", "text/plain").body(sql.to_string()), "SpacetimeDB").await?;
        let set = match &raw {
            J::Array(a) => a.last().cloned().unwrap_or(J::Null),
            other => other.clone(),
        };
        let ts = self.module().await.map(|m| module_tables(&m).1).unwrap_or_default();
        let els = set.get("schema").and_then(|s| s.pointer("/Product/elements").or_else(|| s.get("elements"))).and_then(J::as_array).cloned().unwrap_or_default();
        let mut r = QueryResult::from_columns(els.iter().map(el_name).collect());
        r.column_types =
            els.iter().map(|e| ColumnMeta::new(el_name(e), type_name(e.get("algebraic_type").unwrap_or(&J::Null), &ts))).collect();
        for row in set.get("rows").and_then(J::as_array).into_iter().flatten() {
            if r.rows.len() >= row_limit {
                r.truncated = true;
                break;
            }
            let vals = row.as_array().cloned().unwrap_or_default();
            r.rows.push(
                vals.iter()
                    .enumerate()
                    .map(|(i, v)| json_to_cell(&unwrap_sats(v, els.get(i).and_then(|e| e.get("algebraic_type")).unwrap_or(&J::Null), &ts)))
                    .collect(),
            );
        }
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn ping(&self) -> Result<()> {
        let res = self.auth(client().get(format!("{}/v1/ping", self.base))).send().await?;
        if !res.status().is_success() {
            bail!("SpacetimeDB ping failed ({})", res.status());
        }
        self.module().await.map(|_| ())
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let (tables, ts) = module_tables(&self.module().await?);
        let Some(tb) = tables.into_iter().find(|x| x.name == t.name) else { return Ok(Vec::new()) };
        Ok(tb
            .columns
            .iter()
            .enumerate()
            .map(|(i, (name, at))| {
                let ty = type_name(at, &ts);
                ColumnDetail {
                    column_name: name.clone(),
                    full_type: ty.clone(),
                    data_type: ty,
                    is_nullable: true,
                    is_primary_key: tb.primary_key.contains(&i),
                    ordinal_position: i as i64 + 1,
                    ..Default::default()
                }
            })
            .collect())
    }

    /// `getSpacetimeDbPrimaryKey` (first PK column).
    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        let (tables, _) = module_tables(&self.module().await?);
        Ok(tables
            .into_iter()
            .find(|x| x.name == t.name)
            .and_then(|tb| tb.primary_key.first().and_then(|i| tb.columns.get(*i)).map(|c| vec![c.0.clone()]))
            .unwrap_or_default())
    }

    /// `getSpacetimeDbAllTablesWithColumns` (Ref-typed columns become FKs).
    async fn all_tables_with_columns(&self, _schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let (tables, ts) = module_tables(&self.module().await?);
        let mut out = Vec::new();
        for tb in &tables {
            for (i, (name, at)) in tb.columns.iter().enumerate() {
                let refd = at.get("Ref").and_then(J::as_u64).and_then(|r| tables.iter().find(|x| x.type_ref == r));
                out.push(SchemaColumn {
                    table_schema: self.database.clone(),
                    table_name: tb.name.clone(),
                    column_name: name.clone(),
                    data_type: type_name(at, &ts),
                    is_nullable: true,
                    column_default: None,
                    is_primary: tb.primary_key.contains(&i),
                    referenced_table_schema: refd.map(|_| self.database.clone()),
                    referenced_table_name: refd.map(|x| x.name.clone()),
                    referenced_column_name: refd.and_then(|x| x.primary_key.first().and_then(|p| x.columns.get(*p)).map(|c| c.0.clone())),
                });
            }
        }
        Ok(out)
    }

    /// `updateSpacetimeDbRows`: calls `update_{table}` with args in reducer order.
    async fn update_rows(&self, table: &TableRef, updates: &[RowUpdate]) -> Result<()> {
        let reducer = format!("update_{}", table.name);
        let Some(args) = self.reducer_args(&reducer).await? else { bail!("No {reducer} reducer found") };
        for u in updates {
            let merged: Vec<&(String, Value)> = u.set.iter().chain(u.r#where.iter()).collect();
            let vals: Vec<J> = args.iter().map(|a| merged.iter().find(|(k, _)| k == a).map_or(J::Null, |(_, v)| value_json(v))).collect();
            self.call_reducer(&reducer, &vals).await?;
        }
        Ok(())
    }

    /// `deleteSpacetimeDbRows`: `delete_{table}(pk)` per row.
    async fn delete_rows(&self, table: &TableRef, rows: &[RowValues]) -> Result<u64> {
        let pk = self.primary_key(table).await?;
        let Some(pk) = pk.first() else {
            bail!("No primary key found for this table. Deletion is only supported for tables with a primary key.")
        };
        let reducer = format!("delete_{}", table.name);
        let mut n = 0;
        for r in rows {
            if let Some((_, v)) = r.iter().find(|(k, _)| k == pk) {
                self.call_reducer(&reducer, &[value_json(v)]).await?;
                n += 1;
            }
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_and_resolves_types() {
        assert_eq!(parse("spacetimedbs://maincloud.spacetimedb.com/chat?token=t").unwrap(), ("https://maincloud.spacetimedb.com:443".into(), "chat".into(), Some("t".into())));
        assert_eq!(parse("spacetimedb://localhost/db").unwrap().0, "http://localhost:3000");
        assert!(parse("spacetimedb://localhost").is_err());
        let ts = vec![json!({"Product": {"elements": [{"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}]}})];
        assert_eq!(type_name(&json!({"Ref": 0}), &ts), "Identity");
        assert_eq!(type_name(&json!({"Sum": {"variants": [{"name": {"some": "some"}, "algebraic_type": {"U32": []}}, {"name": {"some": "none"}}]}}), &ts), "Option<U32>");
        assert_eq!(type_name(&json!({"Array": {"elem_ty": {"String": []}}}), &ts), "Array<String>");
        assert_eq!(unwrap_sats(&json!(["0xabc"]), &json!({"Ref": 0}), &ts), json!("0xabc"));
        let m = json!({"tables": [{"name": "user", "product_type_ref": 1, "primary_key": [0], "table_type": "User"}],
                       "typespace": {"types": [ts[0].clone(), {"Product": {"elements": [{"name": {"some": "id"}, "algebraic_type": {"U64": []}}]}}]}});
        let (t, _) = module_tables(&m);
        assert_eq!((t[0].name.as_str(), t[0].columns[0].0.as_str(), t[0].primary_key.clone()), ("user", "id", vec![0]));
    }
}
