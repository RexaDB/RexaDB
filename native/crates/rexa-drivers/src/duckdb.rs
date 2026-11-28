//! Port of `lib/db/duckdb-client.ts`.
//!
//! Two backends behind one driver:
//! * the embedded engine (cargo feature `duckdb`, bundled C++ build — what
//!   the original ships via `@duckdb/node-api`);
//! * otherwise the `duckdb` CLI (`duckdb -json <file> -c <sql>` per
//!   statement; `$REXADB_DUCKDB_CLI` overrides the binary). `:memory:`
//!   databases don't persist between statements in CLI mode.
//!
//! `duckdb://path` / `duckdb://:memory:` / plain `*.duckdb|*.ddb` paths.
//! The catalog is SQL over `information_schema` / `duckdb_constraints()`.

use crate::*;
use std::time::Instant;

/// `normalizeConnectionString`. `None` = in-memory.
pub(crate) fn db_path(cs: &str) -> Option<String> {
    let raw = cs.trim();
    if raw == ":memory:" || raw.starts_with("duckdb://:memory:") {
        return None;
    }
    let p = match raw.strip_prefix("duckdb://") {
        Some(rest) => crate::detect::percent_decode(rest),
        None => raw.to_string(),
    };
    if p.is_empty() {
        return None;
    }
    Some(match p.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest).to_string_lossy().into_owned(),
        None => p,
    })
}

pub(crate) async fn open(cs: &str) -> Result<Arc<dyn Driver>> {
    let path = db_path(cs);
    #[cfg(feature = "duckdb")]
    {
        Ok(Arc::new(DuckDriver { backend: Backend::Embedded { conn: embedded::open(path.as_deref())?, path } }))
    }
    #[cfg(not(feature = "duckdb"))]
    {
        let cli = std::env::var("REXADB_DUCKDB_CLI").unwrap_or_else(|_| "duckdb".into());
        let ok = tokio::process::Command::new(&cli).arg("-version").output().await.map(|o| o.status.success()).unwrap_or(false);
        if !ok {
            bail!("DuckDB support needs the `duckdb` CLI on PATH (or a build with the `duckdb` feature).");
        }
        Ok(Arc::new(DuckDriver { backend: Backend::Cli { cli, path, readonly: false } }))
    }
}

enum Backend {
    #[cfg(feature = "duckdb")]
    Embedded { conn: Arc<std::sync::Mutex<::duckdb::Connection>>, path: Option<String> },
    #[cfg_attr(feature = "duckdb", allow(dead_code))]
    Cli { cli: String, path: Option<String>, readonly: bool },
}

pub struct DuckDriver {
    backend: Backend,
}

#[cfg(feature = "duckdb")]
mod embedded {
    use super::*;
    use ::duckdb::types::{TimeUnit, ValueRef};
    use std::sync::Mutex;

    pub(super) fn open(path: Option<&str>) -> Result<Arc<Mutex<::duckdb::Connection>>> {
        let c = match path {
            Some(p) => ::duckdb::Connection::open(p)?,
            None => ::duckdb::Connection::open_in_memory()?,
        };
        Ok(Arc::new(Mutex::new(c)))
    }

    pub(super) fn open_readonly(path: &str) -> Result<Arc<Mutex<::duckdb::Connection>>> {
        let config = ::duckdb::Config::default().access_mode(::duckdb::AccessMode::ReadOnly)?;
        let conn = ::duckdb::Connection::open_with_flags(path, config)?;
        Ok(Arc::new(Mutex::new(conn)))
    }

    fn ts(unit: TimeUnit, v: i64) -> String {
        let micros = match unit {
            TimeUnit::Second => v * 1_000_000,
            TimeUnit::Millisecond => v * 1000,
            TimeUnit::Microsecond => v,
            TimeUnit::Nanosecond => v / 1000,
        };
        chrono_like(micros)
    }

    /// Format microseconds since the epoch as `YYYY-MM-DD HH:MM:SS[.ffffff]`.
    fn chrono_like(micros: i64) -> String {
        let secs = micros.div_euclid(1_000_000);
        let frac = micros.rem_euclid(1_000_000);
        let days = secs.div_euclid(86400);
        let sod = secs.rem_euclid(86400);
        let (y, m, d) = civil(days);
        let base = format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", sod / 3600, sod % 3600 / 60, sod % 60);
        if frac == 0 { base } else { format!("{base}.{frac:06}") }
    }

    fn civil(z: i64) -> (i64, i64, i64) {
        let z = z + 719468;
        let era = z.div_euclid(146097);
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        (yoe + era * 400 + i64::from(m <= 2), m, d)
    }

    fn cell(v: ValueRef<'_>) -> Cell {
        Cell::Text(match v {
            ValueRef::Null => return Cell::Null,
            ValueRef::Boolean(b) => b.to_string(),
            ValueRef::TinyInt(i) => i.to_string(),
            ValueRef::SmallInt(i) => i.to_string(),
            ValueRef::Int(i) => i.to_string(),
            ValueRef::BigInt(i) => i.to_string(),
            ValueRef::HugeInt(i) => i.to_string(),
            ValueRef::UTinyInt(i) => i.to_string(),
            ValueRef::USmallInt(i) => i.to_string(),
            ValueRef::UInt(i) => i.to_string(),
            ValueRef::UBigInt(i) => i.to_string(),
            ValueRef::Float(f) => f.to_string(),
            ValueRef::Double(f) => f.to_string(),
            ValueRef::Decimal(d) => d.to_string(),
            ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
            ValueRef::Blob(b) => b.iter().map(|x| format!("{x:02x}")).collect(),
            ValueRef::Date32(d) => {
                let (y, m, dd) = civil(d as i64);
                format!("{y:04}-{m:02}-{dd:02}")
            }
            ValueRef::Timestamp(u, v) => ts(u, v),
            ValueRef::Time64(u, v) => ts(u, v).split(' ').nth(1).unwrap_or("").to_string(),
            other => format!("{:?}", other.to_owned()),
        })
    }

    pub(super) fn run(conn: &::duckdb::Connection, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let head = sql.trim_start().trim_start_matches('(').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        let reads = matches!(head.as_str(), "select" | "with" | "show" | "describe" | "explain" | "pragma" | "from" | "values" | "summarize" | "table" | "call")
            || sql.to_ascii_lowercase().contains("returning");
        if !reads {
            let n = conn.execute(sql, [])?;
            return Ok(QueryResult { affected: Some(n as u64), ..Default::default() });
        }
        let mut stmt = conn.prepare(sql)?;
        let mut rows = stmt.query([])?;
        let mut out = QueryResult::default();
        let mut width = 0;
        while let Some(row) = rows.next()? {
            if out.rows.len() >= row_limit {
                out.truncated = true;
                break;
            }
            if width == 0 {
                width = row.as_ref().column_count();
            }
            out.rows.push((0..width).map(|i| row.get_ref(i).map(cell).unwrap_or(Cell::Null)).collect());
        }
        drop(rows);
        let n = stmt.column_count();
        out.columns = (0..n).map(|i| stmt.column_name(i).map(|s| s.to_string()).unwrap_or_default()).collect();
        out.column_types = (0..n).map(|i| ColumnMeta::new(out.columns[i].clone(), format!("{:?}", stmt.column_type(i)))).collect();
        if n == 0 {
            out.affected = Some(0);
        }
        Ok(out)
    }
}

impl DuckDriver {
    async fn one(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut r = match &self.backend {
            #[cfg(feature = "duckdb")]
            Backend::Embedded { conn, .. } => {
                let conn = conn.clone();
                let sql = sql.to_string();
                tokio::task::spawn_blocking(move || embedded::run(&conn.lock().unwrap(), &sql, row_limit)).await??
            }
            Backend::Cli { cli, path, readonly } => {
                let mut command = tokio::process::Command::new(cli);
                if *readonly { command.arg("-readonly"); }
                let out = command.arg("-json").arg(path.as_deref().unwrap_or(":memory:")).arg("-c").arg(sql).output().await?;
                if !out.status.success() {
                    bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
                }
                let text = String::from_utf8_lossy(&out.stdout);
                let rows: Vec<serde_json::Value> = serde_json::from_str(text.trim()).unwrap_or_default();
                let mut r = crate::http::objects_to_result(&rows);
                if r.rows.len() > row_limit {
                    r.rows.truncate(row_limit);
                    r.truncated = true;
                }
                r
            }
        };
        r.elapsed = started.elapsed();
        Ok(r)
    }
}

fn lit(s: &str) -> String {
    Dialect::DuckDb.quote_str(s)
}

#[async_trait]
impl Driver for DuckDriver {
    fn kind(&self) -> Kind {
        Kind::DuckDb
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        let r = self.one("SELECT DISTINCT schema_name FROM information_schema.schemata ORDER BY schema_name", usize::MAX).await?;
        Ok(r.first_column())
    }

    /// `getDuckdbDatabases`: catalogs.
    async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.one("SELECT DISTINCT catalog_name FROM information_schema.schemata ORDER BY catalog_name", usize::MAX).await?.first_column())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let r = self
            .one(&format!("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = {} ORDER BY table_name", lit(schema)), usize::MAX)
            .await?;
        Ok(r.records()
            .into_iter()
            .map(|r| TableRef { schema: schema.to_string(), name: r.string("table_name"), is_view: r.get("table_type") == Some("VIEW") })
            .collect())
    }

    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let r = self
            .one(
                &format!(
                    "SELECT t.table_name, t.table_type, d.estimated_size, d.comment
                     FROM information_schema.tables t
                     LEFT JOIN duckdb_tables() d ON d.schema_name = t.table_schema AND d.table_name = t.table_name
                     WHERE t.table_schema = {} ORDER BY t.table_name",
                    lit(schema)
                ),
                usize::MAX,
            )
            .await?;
        Ok(r.records()
            .into_iter()
            .map(|r| TableInfo {
                schema: schema.to_string(),
                name: r.string("table_name"),
                kind: if r.get("table_type") == Some("VIEW") { TableKind::View } else { TableKind::Table },
                row_estimate: r.i64("estimated_size"),
                comment: r.non_empty("comment"),
                ..Default::default()
            })
            .collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut last = QueryResult::default();
        for s in split::split_statements(sql, Dialect::DuckDb) {
            last = self.one(&s, row_limit).await?;
        }
        last.elapsed = started.elapsed();
        Ok(last)
    }

    async fn execute_readonly(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let backend = match &self.backend {
            #[cfg(feature = "duckdb")]
            Backend::Embedded { path: Some(path), .. } => Backend::Embedded { conn: embedded::open_readonly(path)?, path: Some(path.clone()) },
            #[cfg(feature = "duckdb")]
            Backend::Embedded { path: None, .. } => bail!("Read-only dashboard queries require a file-backed DuckDB database."),
            Backend::Cli { cli, path: Some(path), .. } => Backend::Cli { cli: cli.clone(), path: Some(path.clone()), readonly: true },
            Backend::Cli { path: None, .. } => bail!("Read-only dashboard queries require a file-backed DuckDB database."),
        };
        DuckDriver { backend }.execute(sql, row_limit).await
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        match &self.backend {
            Backend::Cli { .. } => {
                // One CLI invocation so the transaction spans all statements.
                let script = format!("BEGIN TRANSACTION;\n{};\nCOMMIT;", statements.join(";\n"));
                self.one(&script, usize::MAX).await?;
                Ok(statements.iter().map(|_| QueryResult::default()).collect())
            }
            #[cfg(feature = "duckdb")]
            Backend::Embedded { .. } => {
                self.one("BEGIN TRANSACTION", 1).await?;
                let mut out = Vec::new();
                for s in statements {
                    match self.one(s, usize::MAX).await {
                        Ok(r) => out.push(r),
                        Err(e) => {
                            let _ = self.one("ROLLBACK", 1).await;
                            return Err(e);
                        }
                    }
                }
                self.one("COMMIT", 1).await?;
                Ok(out)
            }
        }
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let pk = self.primary_key(t).await.unwrap_or_default();
        let r = self
            .one(
                &format!(
                    "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale, ordinal_position
                     FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
                    lit(&t.schema),
                    lit(&t.name)
                ),
                usize::MAX,
            )
            .await?;
        Ok(r.records()
            .into_iter()
            .map(|r| {
                let name = r.string("column_name");
                ColumnDetail {
                    is_primary_key: pk.contains(&name),
                    data_type: r.string("data_type"),
                    full_type: r.string("data_type"),
                    is_nullable: r.get("is_nullable") == Some("YES"),
                    column_default: r.opt("column_default"),
                    character_maximum_length: r.i64("character_maximum_length"),
                    numeric_precision: r.i64("numeric_precision"),
                    numeric_scale: r.i64("numeric_scale"),
                    ordinal_position: r.i64("ordinal_position").unwrap_or(0),
                    column_name: name,
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        let r = self
            .one(
                &format!(
                    "SELECT unnest(constraint_column_names) AS c FROM duckdb_constraints()
                     WHERE constraint_type = 'PRIMARY KEY' AND schema_name = {} AND table_name = {}",
                    lit(&t.schema),
                    lit(&t.name)
                ),
                usize::MAX,
            )
            .await?;
        Ok(r.first_column())
    }

    /// `getDuckdbAllTablesWithColumns`.
    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let filter = schema.map(|s| format!("WHERE table_schema = {}", lit(s))).unwrap_or_default();
        let r = self
            .one(
                &format!("SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns {filter} ORDER BY table_schema, table_name, ordinal_position"),
                usize::MAX,
            )
            .await?;
        Ok(r.records()
            .into_iter()
            .map(|r| SchemaColumn {
                table_schema: r.string("table_schema"),
                table_name: r.string("table_name"),
                column_name: r.string("column_name"),
                data_type: r.string("data_type"),
                is_nullable: r.get("is_nullable") == Some("YES"),
                ..Default::default()
            })
            .collect())
    }

    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        let filter = schema.map(|s| format!("WHERE schema_name = {}", lit(s))).unwrap_or_default();
        let r = self.one(&format!("SELECT schema_name, table_name, index_name, is_unique, is_primary, sql FROM duckdb_indexes() {filter}"), usize::MAX).await?;
        Ok(r.records()
            .into_iter()
            .map(|r| {
                let definition = r.string("sql");
                IndexInfo {
                    schema: r.string("schema_name"),
                    table_name: r.string("table_name"),
                    name: r.string("index_name"),
                    columns: extract_index_columns(&definition),
                    definition,
                    is_unique: r.bool("is_unique"),
                    is_primary: r.bool("is_primary"),
                    method: None,
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn paths() {
        assert_eq!(super::db_path("duckdb://:memory:"), None);
        assert_eq!(super::db_path("duckdb:///tmp/a.duckdb").as_deref(), Some("/tmp/a.duckdb"));
        assert_eq!(super::db_path("/x/y.ddb").as_deref(), Some("/x/y.ddb"));
    }
}
