//! HTTP-backed SQLite family — port of `lib/db/edge-sqlite.ts` and the
//! remote (`libsql://` / `https://`) branch of `sqlite-client.ts`:
//!
//! * Turso / libSQL: Hrana-over-HTTP `POST /v2/pipeline` (what
//!   `@libsql/client` uses), `?authToken=` / `?auth_token=`.
//! * rqlite: `POST /db/request?timings` (`rqlite[s]://`, `rqlite+http[s]://`).
//! * Cloudflare D1: REST `…/d1/database/{id}/query` (`d1://{account}/{db}?token=`).
//! * StarbaseDB: `POST /query/raw` (`starbase[s]://host?token=`).
//! * Val.town: `POST https://api.val.town/v1/sqlite/execute` (`valtown://?token=`).
//!
//! The catalog is the shared SQL-only SQLite catalog in `sqlite.rs`.

use crate::http::{client, json, json_to_cell};
use crate::sqlite::*;
use crate::*;
use base64::Engine;
use serde_json::{json, Value as J};
use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RemoteSqlite {
    Libsql { url: String, token: Option<String> },
    Rqlite { base: String, username: Option<String>, password: Option<String> },
    D1 { account: String, database: String, token: String },
    Starbase { base: String, token: String, source: Option<String> },
    Valtown { token: String },
}

fn param(u: &url::Url, names: &[&str]) -> Option<String> {
    names.iter().find_map(|n| u.query_pairs().find(|(k, _)| k == n).map(|(_, v)| v.into_owned())).filter(|v| !v.is_empty())
}

fn token_of(u: &url::Url) -> Option<String> {
    u.password()
        .map(crate::detect::percent_decode)
        .filter(|s| !s.is_empty())
        .or_else(|| (!u.username().is_empty()).then(|| crate::detect::percent_decode(u.username())))
        .or_else(|| param(u, &["token", "authToken", "auth_token", "apiToken", "api_token"]))
}

fn replace_scheme(raw: &str, pairs: &[(&str, &str)]) -> String {
    let lower = raw.to_ascii_lowercase();
    for (from, to) in pairs {
        if lower.starts_with(from) {
            return format!("{to}{}", &raw[from.len()..]);
        }
    }
    raw.to_string()
}

impl RemoteSqlite {
    /// `parseEdgeSqliteTarget` + `resolveSqliteTarget` (remote mode). `None`
    /// for local files.
    pub(crate) fn parse(cs: &str) -> Result<Option<RemoteSqlite>> {
        let raw = cs.trim();
        let lower = raw.to_ascii_lowercase();
        let starts = |ps: &[&str]| ps.iter().any(|p| lower.starts_with(p));
        if starts(&["rqlite://", "rqlites://", "rqlite+http://", "rqlite+https://"]) {
            let n = replace_scheme(raw, &[("rqlites://", "https://"), ("rqlite+https://", "https://"), ("rqlite+http://", "http://"), ("rqlite://", "http://")]);
            let u = url::Url::parse(&n).map_err(|_| anyhow::anyhow!("Invalid rqlite connection string. Use rqlite://host:4001"))?;
            let username = (!u.username().is_empty()).then(|| crate::detect::percent_decode(u.username())).or_else(|| param(&u, &["user", "username"]));
            let password = u.password().map(crate::detect::percent_decode).or_else(|| param(&u, &["password", "pass"]));
            let base = format!("{}://{}", u.scheme(), u.host_str().unwrap_or("localhost")) + &u.port().map(|p| format!(":{p}")).unwrap_or_default();
            return Ok(Some(RemoteSqlite::Rqlite { base, username, password }));
        }
        if starts(&["d1://", "cloudflare-d1://"]) {
            let without = raw.split_once("://").map_or(raw, |(_, r)| r);
            let (path, query) = without.split_once('?').unwrap_or((without, ""));
            let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
            if segs.len() < 2 {
                bail!("Invalid Cloudflare D1 connection string. Use d1://{{accountId}}/{{databaseId}}?token=...");
            }
            let fake = url::Url::parse(&format!("http://x/?{query}"))?;
            let token = param(&fake, &["token", "authToken", "auth_token", "apiToken", "api_token"])
                .ok_or_else(|| anyhow::anyhow!("Cloudflare D1 connection string is missing ?token= (API token)."))?;
            return Ok(Some(RemoteSqlite::D1 { account: segs[0].into(), database: segs[1].into(), token }));
        }
        if starts(&["starbase://", "starbases://", "starbasedb://", "starbasedbs://"]) {
            let n = replace_scheme(raw, &[("starbases://", "https://"), ("starbasedbs://", "https://"), ("starbase://", "http://"), ("starbasedb://", "http://")]);
            let u = url::Url::parse(&n).map_err(|_| anyhow::anyhow!("Invalid StarbaseDB connection string. Use starbase://host:8787?token=..."))?;
            let token = token_of(&u).ok_or_else(|| anyhow::anyhow!("StarbaseDB connection string is missing ?token=."))?;
            let path = u.path().trim_end_matches('/');
            let base = format!("{}://{}{}{}", u.scheme(), u.host_str().unwrap_or(""), u.port().map(|p| format!(":{p}")).unwrap_or_default(), path);
            return Ok(Some(RemoteSqlite::Starbase { base, token, source: param(&u, &["source"]) }));
        }
        if starts(&["valtown://", "val.town://"]) {
            let n = replace_scheme(raw, &[("val.town://", "valtown://")]);
            let token = match url::Url::parse(&n) {
                Ok(u) => token_of(&u).or_else(|| u.host_str().filter(|h| *h != "val.town" && *h != "api.val.town").map(str::to_string)),
                Err(_) => Some(n["valtown://".len()..].split('?').next().unwrap_or("").trim_end_matches('/').to_string()),
            }
            .filter(|t| !t.is_empty())
            .ok_or_else(|| anyhow::anyhow!("Val.town connection string is missing a token. Use valtown://?token=..."))?;
            return Ok(Some(RemoteSqlite::Valtown { token }));
        }
        if starts(&["libsql://", "https://", "http://"]) {
            let mut u = url::Url::parse(raw)?;
            let token = param(&u, &["authToken", "auth_token"]);
            let kept: Vec<(String, String)> =
                u.query_pairs().filter(|(k, _)| k != "authToken" && k != "auth_token").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
            if kept.is_empty() {
                u.set_query(None);
            } else {
                u.query_pairs_mut().clear().extend_pairs(kept);
            }
            let s = u.to_string();
            let s = replace_scheme(&s, &[("libsql://", "https://")]);
            return Ok(Some(RemoteSqlite::Libsql { url: s.trim_end_matches('/').to_string(), token }));
        }
        Ok(None)
    }
}

pub(crate) struct RemoteSqliteDriver {
    target: RemoteSqlite,
}

/// Dedupe repeated column names (`__col_i`), like `rqliteResultToRows`.
fn dedupe(cols: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    cols.into_iter()
        .map(|c| {
            let mut name = c.clone();
            let mut i = 0;
            while seen.contains(&name) && i < 20 {
                name = format!("__{c}_{i}");
                i += 1;
            }
            seen.insert(name.clone());
            name
        })
        .collect()
}

fn tuples(cols: Vec<String>, rows: &[J], row_limit: usize) -> QueryResult {
    let mut r = QueryResult::from_columns(dedupe(cols));
    for row in rows {
        if r.rows.len() >= row_limit {
            r.truncated = true;
            break;
        }
        let arr = row.as_array().cloned().unwrap_or_default();
        r.rows.push((0..r.columns.len()).map(|i| arr.get(i).map_or(Cell::Null, json_to_cell)).collect());
    }
    r
}

fn hrana_value(v: &J) -> Cell {
    match v.get("type").and_then(J::as_str) {
        Some("null") | None => Cell::Null,
        Some("blob") => {
            let b = v.get("base64").and_then(J::as_str).unwrap_or("");
            let bytes = base64::engine::general_purpose::STANDARD_NO_PAD.decode(b.trim_end_matches('=')).unwrap_or_default();
            Cell::Text(bytes.iter().map(|x| format!("{x:02x}")).collect())
        }
        Some(_) => v.get("value").map_or(Cell::Null, json_to_cell),
    }
}

fn hrana_result(res: &J, row_limit: usize) -> Result<QueryResult> {
    if res.get("type").and_then(J::as_str) == Some("error") {
        bail!("{}", res.pointer("/error/message").and_then(J::as_str).unwrap_or("libSQL error"));
    }
    let result = res.pointer("/response/result").cloned().unwrap_or(J::Null);
    let cols: Vec<&J> = result.get("cols").and_then(J::as_array).map(|a| a.iter().collect()).unwrap_or_default();
    let mut r = QueryResult::from_columns(dedupe(cols.iter().map(|c| c.get("name").and_then(J::as_str).unwrap_or("").to_string()).collect()));
    r.column_types = cols
        .iter()
        .zip(&r.columns)
        .map(|(c, n)| ColumnMeta::new(n.clone(), c.get("decltype").and_then(J::as_str).unwrap_or("unknown")))
        .collect();
    for row in result.get("rows").and_then(J::as_array).into_iter().flatten() {
        if r.rows.len() >= row_limit {
            r.truncated = true;
            break;
        }
        r.rows.push(row.as_array().into_iter().flatten().map(hrana_value).collect());
    }
    if r.columns.is_empty() {
        r.affected = result.get("affected_row_count").and_then(J::as_u64);
    }
    Ok(r)
}

fn is_tx_control(sql: &str) -> bool {
    let h = sql.trim_start().split_whitespace().next().unwrap_or("").to_ascii_uppercase();
    matches!(h.as_str(), "BEGIN" | "COMMIT" | "ROLLBACK" | "END" | "SAVEPOINT" | "RELEASE")
}

impl RemoteSqliteDriver {
    pub(crate) fn new(target: RemoteSqlite) -> Self {
        RemoteSqliteDriver { target }
    }

    fn d1_url(account: &str, database: &str) -> String {
        let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
        format!("https://api.cloudflare.com/client/v4/accounts/{}/d1/database/{}/query", enc(account), enc(database))
    }

    /// One statement → one result.
    async fn one(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        match &self.target {
            RemoteSqlite::Libsql { url, token } => {
                let mut req = client().post(format!("{url}/v2/pipeline")).json(&json!({
                    "requests": [{ "type": "execute", "stmt": { "sql": sql } }, { "type": "close" }]
                }));
                if let Some(t) = token {
                    req = req.bearer_auth(t);
                }
                let v = json(req, "libSQL").await?;
                hrana_result(v.pointer("/results/0").unwrap_or(&J::Null), row_limit)
            }
            RemoteSqlite::Rqlite { base, username, password } => {
                if is_tx_control(sql) {
                    return Ok(QueryResult::default());
                }
                let mut req = client().post(format!("{base}/db/request?timings")).json(&json!([[sql]]));
                if let Some(u) = username {
                    req = req.basic_auth(u, password.as_deref());
                }
                let v = json(req, "Edge SQLite").await?;
                let item = v.pointer("/results/0").cloned().unwrap_or(v);
                if let Some(e) = item.get("error").and_then(J::as_str) {
                    bail!("{e}");
                }
                let cols: Vec<String> = item.get("columns").and_then(J::as_array).into_iter().flatten().filter_map(|c| c.as_str().map(str::to_string)).collect();
                let types: Vec<String> = item.get("types").and_then(J::as_array).into_iter().flatten().filter_map(|c| c.as_str().map(str::to_string)).collect();
                let mut r = tuples(cols, item.get("values").and_then(J::as_array).map(Vec::as_slice).unwrap_or(&[]), row_limit);
                r.column_types = r.columns.iter().enumerate().map(|(i, c)| ColumnMeta::new(c.clone(), types.get(i).cloned().unwrap_or_else(|| "unknown".into()))).collect();
                if r.columns.is_empty() {
                    r.affected = item.get("rows_affected").and_then(J::as_u64);
                }
                Ok(r)
            }
            RemoteSqlite::D1 { account, database, token } => {
                if is_tx_control(sql) {
                    return Ok(QueryResult::default());
                }
                let v = json(client().post(Self::d1_url(account, database)).bearer_auth(token).json(&json!({ "sql": sql, "params": [] })), "Edge SQLite").await?;
                d1_check(&v)?;
                let first = v.pointer("/result/0").cloned().unwrap_or(J::Null);
                let rows: Vec<J> = first.get("results").and_then(J::as_array).cloned().unwrap_or_default();
                let mut r = crate::http::objects_to_result(&rows);
                if r.rows.len() > row_limit {
                    r.rows.truncate(row_limit);
                    r.truncated = true;
                }
                if r.columns.is_empty() {
                    r.affected = first.pointer("/meta/changes").and_then(J::as_u64);
                }
                Ok(r)
            }
            RemoteSqlite::Starbase { base, token, source } => {
                if is_tx_control(sql) {
                    return Ok(QueryResult::default());
                }
                let mut req = client().post(format!("{base}/query/raw")).bearer_auth(token).json(&json!({ "sql": sql, "params": [] }));
                if let Some(s) = source {
                    req = req.header("X-Starbase-Source", s);
                }
                let v = json(req, "Edge SQLite").await?;
                let Some(res) = v.get("result") else {
                    if let Some(e) = v.get("error").and_then(J::as_str) {
                        bail!("{e}");
                    }
                    return Ok(QueryResult::default());
                };
                let res = if res.is_array() { res.get(0).cloned().unwrap_or(J::Null) } else { res.clone() };
                let cols: Vec<String> = res.get("columns").and_then(J::as_array).into_iter().flatten().filter_map(|c| c.as_str().map(str::to_string)).collect();
                let mut r = tuples(cols, res.get("rows").and_then(J::as_array).map(Vec::as_slice).unwrap_or(&[]), row_limit);
                if r.columns.is_empty() {
                    r.affected = res.pointer("/meta/rows_written").and_then(J::as_u64);
                }
                Ok(r)
            }
            RemoteSqlite::Valtown { token } => {
                if is_tx_control(sql) {
                    return Ok(QueryResult::default());
                }
                let v = json(
                    client().post("https://api.val.town/v1/sqlite/execute").bearer_auth(token).json(&json!({ "statement": { "sql": sql, "args": [] } })),
                    "Edge SQLite",
                )
                .await?;
                if let Some(e) = v.get("error").and_then(J::as_str) {
                    bail!("{e}");
                }
                let cols: Vec<String> = v.get("columns").and_then(J::as_array).into_iter().flatten().filter_map(|c| c.as_str().map(str::to_string)).collect();
                let mut r = tuples(cols, v.get("rows").and_then(J::as_array).map(Vec::as_slice).unwrap_or(&[]), row_limit);
                if r.columns.is_empty() {
                    r.affected = v.get("rowsAffected").and_then(J::as_u64);
                }
                Ok(r)
            }
        }
    }

    /// Atomic batch where the backend has one (`runBatch`).
    async fn batch(&self, statements: &[String]) -> Result<Option<Vec<QueryResult>>> {
        match &self.target {
            RemoteSqlite::Libsql { url, token } => {
                let n = statements.len();
                let mut steps = vec![json!({ "stmt": { "sql": "BEGIN" } })];
                for (i, s) in statements.iter().enumerate() {
                    steps.push(json!({ "stmt": { "sql": s }, "condition": { "type": "ok", "step": i } }));
                }
                steps.push(json!({ "stmt": { "sql": "COMMIT" }, "condition": { "type": "ok", "step": n } }));
                steps.push(json!({ "stmt": { "sql": "ROLLBACK" }, "condition": { "type": "not", "cond": { "type": "ok", "step": n + 1 } } }));
                let mut req = client().post(format!("{url}/v2/pipeline")).json(&json!({
                    "requests": [{ "type": "batch", "batch": { "steps": steps } }, { "type": "close" }]
                }));
                if let Some(t) = token {
                    req = req.bearer_auth(t);
                }
                let v = json(req, "libSQL").await?;
                let res = v.pointer("/results/0").cloned().unwrap_or(J::Null);
                if res.get("type").and_then(J::as_str) == Some("error") {
                    bail!("{}", res.pointer("/error/message").and_then(J::as_str).unwrap_or("libSQL error"));
                }
                let step_results = res.pointer("/response/result/step_results").and_then(J::as_array).cloned().unwrap_or_default();
                let step_errors = res.pointer("/response/result/step_errors").and_then(J::as_array).cloned().unwrap_or_default();
                if let Some(e) = step_errors.iter().find_map(|e| e.get("message").and_then(J::as_str)) {
                    bail!("{e}");
                }
                let out = (1..=n)
                    .map(|i| {
                        let wrapped = json!({ "type": "ok", "response": { "result": step_results.get(i).cloned().unwrap_or(J::Null) } });
                        hrana_result(&wrapped, usize::MAX).unwrap_or_default()
                    })
                    .collect();
                Ok(Some(out))
            }
            RemoteSqlite::Rqlite { base, username, password } => {
                let body: Vec<J> = statements.iter().map(|s| json!([s])).collect();
                let mut req = client().post(format!("{base}/db/request?timings&transaction")).json(&body);
                if let Some(u) = username {
                    req = req.basic_auth(u, password.as_deref());
                }
                let v = json(req, "Edge SQLite").await?;
                let list = v.get("results").and_then(J::as_array).cloned().unwrap_or_default();
                if let Some(e) = list.iter().find_map(|i| i.get("error").and_then(J::as_str)) {
                    bail!("{e}");
                }
                Ok(Some(list.iter().map(|i| QueryResult { affected: i.get("rows_affected").and_then(J::as_u64), ..Default::default() }).collect()))
            }
            RemoteSqlite::D1 { account, database, token } => {
                let body: Vec<J> = statements.iter().map(|s| json!({ "sql": s, "params": [] })).collect();
                let v = json(client().post(Self::d1_url(account, database)).bearer_auth(token).json(&body), "Edge SQLite").await?;
                d1_check(&v)?;
                let list = v.get("result").and_then(J::as_array).cloned().unwrap_or_default();
                if let Some(e) = list.iter().find_map(|i| i.get("error").and_then(J::as_str)) {
                    bail!("{e}");
                }
                Ok(Some(list.iter().map(|i| QueryResult { affected: i.pointer("/meta/changes").and_then(J::as_u64), ..Default::default() }).collect()))
            }
            RemoteSqlite::Starbase { base, token, source } => {
                let tx: Vec<J> = statements.iter().map(|s| json!({ "sql": s, "params": [] })).collect();
                let mut req = client().post(format!("{base}/query/raw")).bearer_auth(token).json(&json!({ "transaction": tx }));
                if let Some(s) = source {
                    req = req.header("X-Starbase-Source", s);
                }
                let v = json(req, "Edge SQLite").await?;
                if let Some(e) = v.get("error").and_then(J::as_str) {
                    bail!("{e}");
                }
                Ok(Some(statements.iter().map(|_| QueryResult::default()).collect()))
            }
            RemoteSqlite::Valtown { .. } => Ok(None),
        }
    }
}

fn d1_check(v: &J) -> Result<()> {
    let errors = v.get("errors").and_then(J::as_array).cloned().unwrap_or_default();
    if v.get("success").and_then(J::as_bool) == Some(false) && !errors.is_empty() {
        bail!("{}", errors.iter().map(|e| e.get("message").and_then(J::as_str).unwrap_or("D1 error")).collect::<Vec<_>>().join("; "));
    }
    Ok(())
}

#[async_trait]
impl Driver for RemoteSqliteDriver {
    fn kind(&self) -> Kind {
        Kind::Sqlite
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(sqlcat_schemas(self).await.unwrap_or_else(|_| vec!["main".into()]))
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        sqlcat_tables(self, schema).await
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut last = QueryResult::default();
        for s in split::split_statements(sql, Dialect::Sqlite) {
            last = self.one(&s, row_limit).await?;
        }
        last.elapsed = started.elapsed();
        Ok(last)
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if let Some(r) = self.batch(statements).await? {
            return Ok(r);
        }
        let mut out = Vec::new();
        for s in statements {
            out.push(self.one(s, usize::MAX).await?);
        }
        Ok(out)
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(vec![match &self.target {
            RemoteSqlite::Libsql { url, .. } => url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "turso".into()),
            RemoteSqlite::Rqlite { base, .. } => url::Url::parse(base).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "rqlite".into()),
            RemoteSqlite::D1 { database, .. } => format!("d1:{}", database.chars().take(8).collect::<String>()),
            RemoteSqlite::Starbase { base, .. } => url::Url::parse(base).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "starbase".into()),
            RemoteSqlite::Valtown { .. } => "valtown".into(),
        }])
    }
    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        sqlcat_table_structure(self, t).await
    }
    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        sqlcat_primary_key(self, t).await
    }
    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        sqlcat_foreign_keys(self, t).await
    }
    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        sqlcat_all_columns(self, schema).await
    }
    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        sqlcat_indexes(self, schema).await
    }
    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        sqlcat_triggers(self, schema).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_edge_targets() {
        assert_eq!(RemoteSqlite::parse("/tmp/x.db").unwrap(), None);
        assert_eq!(
            RemoteSqlite::parse("libsql://db-me.turso.io?authToken=abc").unwrap(),
            Some(RemoteSqlite::Libsql { url: "https://db-me.turso.io".into(), token: Some("abc".into()) })
        );
        assert_eq!(
            RemoteSqlite::parse("rqlites://u:p@h:4001").unwrap(),
            Some(RemoteSqlite::Rqlite { base: "https://h:4001".into(), username: Some("u".into()), password: Some("p".into()) })
        );
        assert_eq!(
            RemoteSqlite::parse("d1://acc/db?token=t").unwrap(),
            Some(RemoteSqlite::D1 { account: "acc".into(), database: "db".into(), token: "t".into() })
        );
        assert!(RemoteSqlite::parse("d1://acc/db").is_err());
        assert_eq!(
            RemoteSqlite::parse("starbases://h/api?token=t&source=external").unwrap(),
            Some(RemoteSqlite::Starbase { base: "https://h/api".into(), token: "t".into(), source: Some("external".into()) })
        );
        assert_eq!(RemoteSqlite::parse("valtown://?token=t").unwrap(), Some(RemoteSqlite::Valtown { token: "t".into() }));
        assert_eq!(RemoteSqlite::parse("valtown://tok").unwrap(), Some(RemoteSqlite::Valtown { token: "tok".into() }));
    }

    #[test]
    fn hrana_values() {
        let r = hrana_result(
            &json!({"type":"ok","response":{"type":"execute","result":{"cols":[{"name":"a","decltype":"INTEGER"},{"name":"a"}],
                "rows":[[{"type":"integer","value":"1"},{"type":"blob","base64":"AQI="}],[{"type":"null"},{"type":"text","value":"x"}]]}}}),
            10,
        )
        .unwrap();
        assert_eq!(r.columns, vec!["a", "__a_0"]);
        assert_eq!(r.rows[0], vec![Cell::Text("1".into()), Cell::Text("0102".into())]);
        assert_eq!(r.rows[1][0], Cell::Null);
        assert_eq!(r.column_types[0].category, TypeCategory::Integer);
    }
}
