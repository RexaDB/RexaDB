use crate::*;
use rusqlite::{types::ValueRef, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

pub struct SqliteDriver {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteDriver {
    pub fn open(connection_string: &str) -> Result<Self> {
        let conn = Connection::open(resolve_path(connection_string))?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || f(&conn.lock().unwrap())).await?
    }
}

fn resolve_path(cs: &str) -> PathBuf {
    let s = cs.trim();
    let s = s.strip_prefix("sqlite://").or_else(|| s.strip_prefix("sqlite:")).unwrap_or(s);
    let s = s.split('?').next().unwrap_or(s);
    match s.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
        None => PathBuf::from(s),
    }
}

fn cell(v: ValueRef<'_>) -> Cell {
    match v {
        ValueRef::Null => Cell::Null,
        ValueRef::Integer(i) => Cell::Text(i.to_string()),
        ValueRef::Real(f) => Cell::Text(f.to_string()),
        ValueRef::Text(t) => Cell::Text(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Cell::Text(format!("0x{}", b.iter().map(|b| format!("{b:02x}")).collect::<String>())),
    }
}

fn run(conn: &Connection, sql: &str, row_limit: usize) -> Result<QueryResult> {
    let started = Instant::now();
    let mut result = QueryResult::default();
    let mut rest = sql.trim();
    // Execute statement by statement so multi-statement scripts work and the
    // last statement's rows are shown.
    while !rest.is_empty() {
        let mut stmt = conn.prepare(rest)?;
        let consumed = statement_end(rest);
        let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
        if columns.is_empty() {
            let n = stmt.execute([])?;
            result = QueryResult { affected: Some(n as u64), ..Default::default() };
        } else {
            let mut current = QueryResult { columns, ..Default::default() };
            let width = current.columns.len();
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                if current.rows.len() >= row_limit {
                    current.truncated = true;
                    break;
                }
                current.rows.push((0..width).map(|i| cell(row.get_ref(i).unwrap())).collect());
            }
            result = current;
        }
        rest = rest[consumed..].trim_start_matches(|c: char| c.is_whitespace() || c == ';');
    }
    result.elapsed = started.elapsed();
    Ok(result)
}

/// Byte offset just past the first complete statement (rusqlite doesn't
/// expose the prepare tail). `sqlite3_complete` understands strings, comments
/// and triggers, so semicolons inside them don't split.
fn statement_end(sql: &str) -> usize {
    for (i, c) in sql.char_indices() {
        if c == ';' {
            let prefix = std::ffi::CString::new(&sql[..=i]).unwrap_or_default();
            if unsafe { rusqlite::ffi::sqlite3_complete(prefix.as_ptr()) } != 0 {
                return i + 1;
            }
        }
    }
    sql.len()
}

#[async_trait]
impl Driver for SqliteDriver {
    fn kind(&self) -> Kind {
        Kind::Sqlite
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        self.blocking(|c| {
            let mut stmt = c.prepare("SELECT name FROM pragma_database_list ORDER BY seq")?;
            let names = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?;
            Ok(names)
        })
        .await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let schema = schema.to_string();
        self.blocking(move |c| {
            let sql = format!(
                "SELECT name, type = 'view' FROM {}.sqlite_master
                 WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
                 ORDER BY name",
                quote(&schema)
            );
            let mut stmt = c.prepare(&sql)?;
            let tables = stmt
                .query_map([], |r| {
                    Ok(TableRef { schema: schema.clone(), name: r.get(0)?, is_view: r.get(1)? })
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(tables)
        })
        .await
    }

    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>> {
        let table = table.clone();
        self.blocking(move |c| {
            let mut stmt = c.prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info(?1, ?2)")?;
            let cols = stmt
                .query_map([&table.name, &table.schema], |r| {
                    Ok(ColumnInfo {
                        name: r.get(0)?,
                        data_type: r.get(1)?,
                        nullable: r.get::<_, i64>(2)? == 0,
                        is_primary_key: r.get::<_, i64>(3)? > 0,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(cols)
        })
        .await
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let sql = sql.to_string();
        self.blocking(move |c| run(c, &sql, row_limit)).await
    }

    fn select_preview_sql(&self, table: &TableRef, limit: usize) -> String {
        let name = if table.schema == "main" {
            quote(&table.name)
        } else {
            format!("{}.{}", quote(&table.schema), quote(&table.name))
        };
        format!("SELECT * FROM {name} LIMIT {limit}")
    }
}

fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runs_scripts_and_lists_catalog() {
        let d = SqliteDriver::open(":memory:").unwrap();
        let r = d
            .execute("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t(name) VALUES ('a;b'),(NULL); SELECT * FROM t", 100)
            .await
            .unwrap();
        assert_eq!(r.columns, vec!["id", "name"]);
        assert_eq!(r.rows[0][1], Cell::Text("a;b".into()));
        assert_eq!(r.rows[1][1], Cell::Null);
        let tables = d.tables("main").await.unwrap();
        assert_eq!(tables[0].name, "t");
        let cols = d.columns(&tables[0]).await.unwrap();
        assert!(cols[0].is_primary_key && !cols[1].is_primary_key);
        assert_eq!(d.execute("SELECT 1 LIMIT 0", 1).await.unwrap().rows.len(), 0);
        let r = d
            .execute("-- a; comment\nWITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n LIMIT 5) SELECT x FROM n", 2)
            .await
            .unwrap();
        assert!(r.truncated && r.rows.len() == 2);
    }
}
