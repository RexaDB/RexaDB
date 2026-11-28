//! Port of `lib/db/clickhouse-client.ts` over ClickHouse's HTTP interface
//! (what `@clickhouse/client` uses). `clickhouse://` → http, `clickhouses://`
//! → https, `clickhouse+http[s]://` explicit. Database from the path or
//! `?database=`/`?db=`, user/password from userinfo or `?user=`/`?password=`;
//! every other query param is forwarded as a ClickHouse setting.
//!
//! Row-returning statements are fetched as `JSONCompactStrings` (all values
//! as text + `meta` types); others are executed without a result.

use crate::http::client;
use crate::*;
use serde_json::Value as J;
use std::time::Instant;

pub struct ClickHouseDriver {
    base: String,
    database: String,
    user: String,
    password: String,
    settings: Vec<(String, String)>,
}

pub(crate) fn normalize(cs: &str) -> String {
    let input = cs.trim();
    let l = input.to_ascii_lowercase();
    for (from, to) in [("clickhouse+https://", "https://"), ("clickhouse+http://", "http://"), ("clickhouses://", "https://"), ("clickhouse://", "http://")] {
        if l.starts_with(from) {
            return format!("{to}{}", &input[from.len()..]);
        }
    }
    input.to_string()
}

/// `isSelectLikeQuery`
pub(crate) fn is_select_like(q: &str) -> bool {
    let head = q.trim_start().trim_start_matches('(').split(|c: char| c.is_whitespace() || c == '(').next().unwrap_or("").to_ascii_lowercase();
    matches!(head.as_str(), "select" | "with" | "show" | "describe" | "desc" | "explain" | "pragma" | "exists")
}

fn has_format(q: &str) -> bool {
    regex::Regex::new(r"(?i)\bformat\b").unwrap().is_match(q)
}

impl ClickHouseDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let u = url::Url::parse(&normalize(cs)).map_err(|e| anyhow::anyhow!("invalid ClickHouse connection string: {e}"))?;
        let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty());
        let path_db = crate::detect::percent_decode(u.path().trim_start_matches('/'));
        let database = if path_db.is_empty() { get("database").or_else(|| get("db")).unwrap_or_else(|| "default".into()) } else { path_db };
        let user = (!u.username().is_empty())
            .then(|| crate::detect::percent_decode(u.username()))
            .or_else(|| get("user"))
            .or_else(|| get("username"))
            .unwrap_or_else(|| "default".into());
        let password = u.password().map(crate::detect::percent_decode).or_else(|| get("password")).unwrap_or_default();
        let settings = u
            .query_pairs()
            .filter(|(k, _)| !["user", "username", "password", "database", "db"].contains(&k.as_ref()))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let base = format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or("localhost"), u.port().map(|p| format!(":{p}")).unwrap_or_default());
        let d = ClickHouseDriver { base, database, user, password, settings };
        Ok(d)
    }

    async fn post(&self, sql: &str) -> Result<String> {
        let mut params = vec![("database".to_string(), self.database.clone())];
        params.extend(self.settings.iter().cloned());
        let res = client()
            .post(format!("{}/", self.base))
            .query(&params)
            .header("X-ClickHouse-User", &self.user)
            .header("X-ClickHouse-Key", &self.password)
            .body(sql.to_string())
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("ClickHouse request failed ({}): {e}", self.base))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            bail!("{}", text.trim());
        }
        Ok(text)
    }

    async fn one(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let trimmed = sql.trim().trim_end_matches(';');
        if !is_select_like(trimmed) {
            self.post(trimmed).await?;
            return Ok(QueryResult { elapsed: started.elapsed(), ..Default::default() });
        }
        if has_format(trimmed) {
            let text = self.post(trimmed).await?;
            let mut r = QueryResult::from_columns(vec!["result".into()]);
            r.rows = text.lines().take(row_limit).map(|l| vec![Cell::Text(l.to_string())]).collect();
            r.elapsed = started.elapsed();
            return Ok(r);
        }
        let text = self.post(&format!("{trimmed}\nFORMAT JSONCompactStrings")).await?;
        let v: J = serde_json::from_str(&text).map_err(|_| anyhow::anyhow!("{}", text.trim()))?;
        let meta = v.get("meta").and_then(J::as_array).cloned().unwrap_or_default();
        let mut r = QueryResult::from_columns(meta.iter().map(|m| m.get("name").and_then(J::as_str).unwrap_or("").to_string()).collect());
        r.column_types = meta
            .iter()
            .map(|m| ColumnMeta::new(m.get("name").and_then(J::as_str).unwrap_or(""), m.get("type").and_then(J::as_str).unwrap_or("unknown")))
            .collect();
        for row in v.get("data").and_then(J::as_array).into_iter().flatten() {
            if r.rows.len() >= row_limit {
                r.truncated = true;
                break;
            }
            r.rows.push(row.as_array().into_iter().flatten().map(crate::http::json_to_cell).collect());
        }
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Record>> {
        Ok(self.one(sql, usize::MAX).await?.records())
    }
}

fn lit(s: &str) -> String {
    Dialect::ClickHouse.quote_str(s)
}

#[async_trait]
impl Driver for ClickHouseDriver {
    fn kind(&self) -> Kind {
        Kind::ClickHouse
    }

    fn quote_ident(&self, ident: &str) -> String {
        Dialect::ClickHouse.quote_ident(ident)
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        self.databases().await
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.one("SELECT name FROM system.databases ORDER BY name", usize::MAX).await?.first_column())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let db = if schema.is_empty() { "default" } else { schema };
        Ok(self
            .rows(&format!("SELECT name, engine LIKE '%View%' AS is_view FROM system.tables WHERE database = {} ORDER BY name", lit(db)))
            .await?
            .into_iter()
            .map(|r| TableRef { schema: db.to_string(), name: r.string("name"), is_view: r.bool("is_view") })
            .collect())
    }

    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let db = if schema.is_empty() { "default" } else { schema };
        Ok(self
            .rows(&format!(
                "SELECT name, engine, total_rows, total_bytes, comment FROM system.tables WHERE database = {} ORDER BY name",
                lit(db)
            ))
            .await?
            .into_iter()
            .map(|r| {
                let engine = r.string("engine");
                TableInfo {
                    schema: db.to_string(),
                    name: r.string("name"),
                    kind: if engine == "MaterializedView" {
                        TableKind::MaterializedView
                    } else if engine.contains("View") {
                        TableKind::View
                    } else {
                        TableKind::Table
                    },
                    row_estimate: r.i64("total_rows"),
                    total_bytes: r.i64("total_bytes"),
                    data_bytes: None,
                    comment: r.non_empty("comment"),
                    rls_enabled: None,
                }
            })
            .collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut last = QueryResult::default();
        for s in split::split_statements(sql, Dialect::ClickHouse) {
            last = self.one(&s, row_limit).await?;
        }
        last.elapsed = started.elapsed();
        Ok(last)
    }

    async fn execute_readonly(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        // ClickHouse enforces readonly=1 server-side for every HTTP query.
        // Override any connection-string setting so callers cannot disable it.
        let mut settings: Vec<_> = self.settings.iter().filter(|(key, _)| !key.eq_ignore_ascii_case("readonly")).cloned().collect();
        settings.push(("readonly".into(), "1".into()));
        let readonly = ClickHouseDriver {
            base: self.base.clone(),
            database: self.database.clone(),
            user: self.user.clone(),
            password: self.password.clone(),
            settings,
        };
        readonly.execute(sql, row_limit).await
    }

    /// `getClickhouseTableStructure` (`DESCRIBE TABLE`) + primary-key flags.
    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let db = if t.schema.is_empty() { "default" } else { &t.schema };
        let rows = self.rows(&format!("DESCRIBE TABLE {}", Dialect::ClickHouse.table_ref(db, &t.name))).await?;
        let pk: Vec<String> = self.primary_key(t).await.unwrap_or_default();
        Ok(rows
            .into_iter()
            .enumerate()
            .map(|(i, r)| {
                let ty = r.string("type");
                let name = r.string("name");
                ColumnDetail {
                    is_nullable: ty.contains("Nullable("),
                    column_default: r.non_empty("default_expression"),
                    is_primary_key: pk.contains(&name),
                    comment: r.non_empty("comment"),
                    ordinal_position: i as i64 + 1,
                    full_type: ty.clone(),
                    data_type: ty,
                    column_name: name,
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        let db = if t.schema.is_empty() { "default" } else { &t.schema };
        Ok(self
            .one(
                &format!(
                    "SELECT name FROM system.columns WHERE database = {} AND table = {} AND is_in_primary_key ORDER BY position",
                    lit(db),
                    lit(&t.name)
                ),
                usize::MAX,
            )
            .await?
            .first_column())
    }

    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let filter = match schema {
            Some(s) => format!("WHERE database = {}", lit(s)),
            None => "WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')".into(),
        };
        Ok(self
            .rows(&format!(
                "SELECT database AS table_schema, table AS table_name, name AS column_name, type AS data_type,
                        default_expression AS column_default, is_in_primary_key
                 FROM system.columns {filter} ORDER BY database, table, position"
            ))
            .await?
            .into_iter()
            .map(|r| {
                let ty = r.string("data_type");
                SchemaColumn {
                    table_schema: r.string("table_schema"),
                    table_name: r.string("table_name"),
                    column_name: r.string("column_name"),
                    is_nullable: ty.contains("Nullable("),
                    data_type: ty,
                    column_default: r.non_empty("column_default"),
                    is_primary: false,
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn sessions(&self) -> Result<QueryResult> {
        self.one("SELECT query_id, user, elapsed, read_rows, memory_usage, query FROM system.processes", usize::MAX).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn parses_connection_strings() {
        let d = ClickHouseDriver::connect("clickhouses://u:p%40ss@h:8443/analytics?max_threads=4").await.unwrap();
        assert_eq!((d.base.as_str(), d.database.as_str(), d.user.as_str(), d.password.as_str()), ("https://h:8443", "analytics", "u", "p@ss"));
        assert_eq!(d.settings, vec![("max_threads".to_string(), "4".to_string())]);
        let d = ClickHouseDriver::connect("clickhouse://h?db=x&user=me").await.unwrap();
        assert_eq!((d.base.as_str(), d.database.as_str(), d.user.as_str()), ("http://h", "x", "me"));
        assert!(is_select_like("  SHOW TABLES") && !is_select_like("INSERT INTO t VALUES (1)"));
    }
}
