//! Port of `lib/db/sqlite-client.ts` (local files) and its catalog helpers.
//!
//! The catalog (`sqlcat_*`) is plain SQL over `pragma_*` table-valued
//! functions, so the remote SQLite family (Turso/libSQL, rqlite, D1,
//! StarbaseDB, Val.town — `sqlite_remote.rs`) reuses it through
//! [`Driver::execute`].
//!
//! Paths resolve like `resolveSqlitePath`: `sqlite://`, `sqlite:`, `file:`
//! URIs, `~` expansion, and relative paths against `$REXADB_USER_DATA_DIR`
//! or `~/.rexadb`. `PRAGMA foreign_keys = ON` on open, as the original.

use crate::*;
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

pub struct SqliteDriver {
    conn: Arc<Mutex<Connection>>,
    timeout: Option<Duration>,
}

/// Open a local file, or a remote SQLite-family backend when the string is
/// `libsql://`/`https://`/`rqlite://`/`d1://`/`starbase://`/`valtown://`.
pub(crate) async fn open_any(cs: &str, opts: &ConnectOptions) -> Result<Arc<dyn Driver>> {
    if let Some(remote) = crate::sqlite_remote::RemoteSqlite::parse(cs)? {
        let d = crate::sqlite_remote::RemoteSqliteDriver::new(remote);
        d.ping().await?;
        return Ok(Arc::new(d));
    }
    Ok(Arc::new(SqliteDriver::open_with(cs, opts)?))
}

fn writable_dir() -> PathBuf {
    if let Ok(d) = std::env::var("REXADB_USER_DATA_DIR") {
        if !d.is_empty() {
            return PathBuf::from(d);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let dir = home.join(".rexadb");
        if std::fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }
    std::env::current_dir().unwrap_or_default()
}

fn expand_home(p: &str) -> PathBuf {
    if p == "~" {
        return dirs::home_dir().unwrap_or_default();
    }
    match p.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
        None => PathBuf::from(p),
    }
}

fn absolutize(p: PathBuf) -> PathBuf {
    if p.is_absolute() {
        p
    } else {
        writable_dir().join(p)
    }
}

fn file_uri_path(input: &str) -> Result<PathBuf> {
    let u = url::Url::parse(input).map_err(|e| anyhow::anyhow!("invalid file URI: {e}"))?;
    let mut p = crate::detect::percent_decode(u.path());
    // /C:/x → C:/x
    if p.len() > 3 && p.as_bytes()[0] == b'/' && p.as_bytes()[2] == b':' {
        p.remove(0);
    }
    if p.is_empty() {
        p = crate::detect::percent_decode(input.trim_start_matches("file:"));
    }
    Ok(PathBuf::from(p))
}

/// `resolveSqlitePath`. `None` = `:memory:`.
pub(crate) fn resolve_path(cs: &str) -> Result<Option<PathBuf>> {
    let raw = cs.trim();
    if raw.is_empty() {
        bail!("SQLite connection string is required.");
    }
    if raw == ":memory:" {
        return Ok(None);
    }
    let raw = raw.split('?').next().unwrap_or(raw);
    if let Some(rest) = raw.strip_prefix("sqlite://") {
        let p = crate::detect::percent_decode(rest);
        if p.is_empty() {
            bail!("SQLite file path is missing.");
        }
        if p == ":memory:" {
            return Ok(None);
        }
        return Ok(Some(absolutize(expand_home(&p))));
    }
    if let Some(rest) = raw.strip_prefix("sqlite:") {
        let p = crate::detect::percent_decode(rest);
        if p.is_empty() {
            bail!("SQLite file path is missing.");
        }
        if p.starts_with("//") {
            return Ok(Some(absolutize(file_uri_path(&format!("file:{p}"))?)));
        }
        return Ok(Some(absolutize(expand_home(&p))));
    }
    if raw.starts_with("file:") {
        return Ok(Some(absolutize(file_uri_path(raw)?)));
    }
    if raw.contains("://") {
        bail!("Unsupported SQLite connection string.");
    }
    Ok(Some(absolutize(expand_home(raw))))
}

impl SqliteDriver {
    pub fn open(connection_string: &str) -> Result<Self> {
        Self::open_with(connection_string, &ConnectOptions::default())
    }

    pub fn open_with(connection_string: &str, opts: &ConnectOptions) -> Result<Self> {
        let flags = if opts.read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX
        } else {
            OpenFlags::default()
        };
        let conn = match resolve_path(connection_string)? {
            None => Connection::open_in_memory()?,
            Some(path) => {
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| {
                        anyhow::anyhow!("Cannot create directory for SQLite DB at \"{}\": {e}", path.display())
                    })?;
                }
                Connection::open_with_flags(&path, flags)?
            }
        };
        conn.busy_timeout(Duration::from_secs(5))?;
        let _ = conn.execute_batch("PRAGMA foreign_keys = ON");
        Ok(Self { conn: Arc::new(Mutex::new(conn)), timeout: opts.statement_timeout })
    }

    async fn blocking<T: Send + 'static>(&self, f: impl FnOnce(&Connection) -> Result<T> + Send + 'static) -> Result<T> {
        let conn = self.conn.clone();
        let timeout = self.timeout;
        tokio::task::spawn_blocking(move || {
            let c = conn.lock().unwrap();
            if let Some(t) = timeout {
                let start = Instant::now();
                c.progress_handler(10_000, Some(move || start.elapsed() > t));
            }
            let r = f(&c);
            if timeout.is_some() {
                c.progress_handler(10_000, None::<fn() -> bool>);
            }
            r
        })
        .await?
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn cell(v: ValueRef<'_>) -> (Cell, &'static str) {
    match v {
        ValueRef::Null => (Cell::Null, ""),
        ValueRef::Integer(i) => (Cell::Text(i.to_string()), "integer"),
        ValueRef::Real(f) => (Cell::Text(f.to_string()), "real"),
        ValueRef::Text(t) => (Cell::Text(String::from_utf8_lossy(t).into_owned()), "text"),
        ValueRef::Blob(b) => (Cell::Text(hex(b)), "blob"),
    }
}

fn assert_supported(sql: &str) -> Result<()> {
    let t = sql.trim_start();
    if t.len() >= 13 && t[..6].eq_ignore_ascii_case("create") && t[6..].trim_start().to_ascii_lowercase().starts_with("schema") {
        bail!("SQLite does not support CREATE SCHEMA. Use ATTACH DATABASE to add another database, or create tables in \"main\".");
    }
    Ok(())
}

/// Rewrite Postgres-flavoured SQL to SQLite (`lib/db/postgres-compat`).
fn compile_sql(sql: &str) -> Result<String> {
    crate::postgres_compat::compile_for_sqlite(sql)
}

/// Run every statement of `sql`; one result per statement.
fn run_all(conn: &Connection, sql: &str, row_limit: usize) -> Result<Vec<QueryResult>> {
    let mut out = Vec::new();
    let mut rest = sql.trim();
    while !rest.is_empty() {
        let consumed = statement_end(rest);
        let stmt_sql = &rest[..consumed];
        if crate::split::split_statements(stmt_sql, Dialect::Sqlite).is_empty() {
            rest = rest[consumed..].trim_start_matches(|c: char| c.is_whitespace() || c == ';');
            continue;
        }
        assert_supported(stmt_sql)?;
        out.push(run_one(conn, stmt_sql, row_limit)?);
        rest = rest[consumed..].trim_start_matches(|c: char| c.is_whitespace() || c == ';');
    }
    Ok(out)
}

fn run_one(conn: &Connection, sql: &str, row_limit: usize) -> Result<QueryResult> {
    let sql = compile_sql(sql)?;
    let started = Instant::now();
    let mut stmt = conn.prepare(&sql)?;
    let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut current = if columns.is_empty() {
        let n = stmt.execute([])?;
        QueryResult { affected: Some(n as u64), ..Default::default() }
    } else {
        let mut current = QueryResult { columns, ..Default::default() };
        let width = current.columns.len();
        let mut seen: Vec<&'static str> = vec![""; width];
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            if current.rows.len() >= row_limit {
                current.truncated = true;
                break;
            }
            let mut out = Vec::with_capacity(width);
            for (i, s) in seen.iter_mut().enumerate() {
                let (c, t) = cell(row.get_ref(i)?);
                if s.is_empty() {
                    *s = t;
                }
                out.push(c);
            }
            current.rows.push(out);
        }
        current.column_types = current.columns.iter().zip(&seen).map(|(n, t)| ColumnMeta::new(n.clone(), if t.is_empty() { "unknown" } else { t })).collect();
        current
    };
    current.elapsed = started.elapsed();
    Ok(current)
}

/// Byte offset just past the first complete statement. `sqlite3_complete`
/// understands strings, comments and triggers.
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

// ── SQL-only catalog shared with the remote SQLite family ────────────────

fn q(s: &str) -> String {
    Dialect::Sqlite.quote_ident(s)
}

fn l(s: &str) -> String {
    Dialect::Sqlite.quote_str(s)
}

fn eff(schema: &str) -> &str {
    if schema.trim().is_empty() {
        "main"
    } else {
        schema
    }
}

pub(crate) async fn sqlcat_schemas(d: &dyn Driver) -> Result<Vec<String>> {
    let names = match d.execute("SELECT name FROM pragma_database_list ORDER BY seq", usize::MAX).await {
        Ok(r) => r.first_column(),
        Err(_) => d.execute("PRAGMA database_list", usize::MAX).await.map(|r| r.records().iter().map(|x| x.string("name")).collect()).unwrap_or_default(),
    };
    let names: Vec<String> = names.into_iter().filter(|n| !n.is_empty()).collect();
    Ok(if names.is_empty() { vec!["main".into()] } else { names })
}

pub(crate) async fn sqlcat_tables(d: &dyn Driver, schema: &str) -> Result<Vec<TableRef>> {
    let s = eff(schema);
    let sql = format!(
        "SELECT name, type FROM {}.sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
        q(s)
    );
    Ok(d.execute(&sql, usize::MAX)
        .await?
        .records()
        .into_iter()
        .map(|r| TableRef { schema: s.to_string(), name: r.string("name"), is_view: r.get("type") == Some("view") })
        .collect())
}

pub(crate) async fn sqlcat_table_structure(d: &dyn Driver, t: &TableRef) -> Result<Vec<ColumnDetail>> {
    let s = eff(&t.schema);
    let info = d.execute(&format!("SELECT * FROM pragma_table_info({}, {})", l(&t.name), l(s)), usize::MAX).await?.records();
    let fk_cols: Vec<String> = d
        .execute(&format!("SELECT \"from\" FROM pragma_foreign_key_list({}, {})", l(&t.name), l(s)), usize::MAX)
        .await
        .map(|r| r.first_column())
        .unwrap_or_default();
    let create_sql = d
        .execute(&format!("SELECT sql FROM {}.sqlite_master WHERE name = {} LIMIT 1", q(s), l(&t.name)), 1)
        .await
        .ok()
        .and_then(|r| r.first_column().into_iter().next())
        .unwrap_or_default();
    let unique_cols: Vec<String> = sqlcat_indexes_for(d, s, &t.name)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.is_unique && i.columns.len() == 1)
        .flat_map(|i| i.columns)
        .collect();
    let pk_count = info.iter().filter(|r| r.i64("pk").unwrap_or(0) > 0).count();
    Ok(info
        .into_iter()
        .map(|r| {
            let name = r.string("name");
            let ty = r.non_empty("type").unwrap_or_else(|| "TEXT".into());
            let pk = r.i64("pk").unwrap_or(0) > 0;
            ColumnDetail {
                is_identity: pk && pk_count == 1 && ty.eq_ignore_ascii_case("integer")
                    || (pk && create_sql.to_ascii_uppercase().contains("AUTOINCREMENT")),
                is_foreign_key: fk_cols.contains(&name),
                is_unique: unique_cols.contains(&name),
                is_nullable: r.i64("notnull").unwrap_or(0) == 0,
                column_default: r.opt("dflt_value"),
                is_primary_key: pk,
                ordinal_position: r.i64("cid").unwrap_or(0) + 1,
                full_type: ty.clone(),
                data_type: ty,
                column_name: name,
                ..Default::default()
            }
        })
        .collect())
}

pub(crate) async fn sqlcat_primary_key(d: &dyn Driver, t: &TableRef) -> Result<Vec<String>> {
    let r = d
        .execute(&format!("SELECT name FROM pragma_table_info({}, {}) WHERE pk > 0 ORDER BY pk", l(&t.name), l(eff(&t.schema))), usize::MAX)
        .await?;
    Ok(r.first_column())
}

pub(crate) async fn sqlcat_foreign_keys(d: &dyn Driver, t: &TableRef) -> Result<Vec<ForeignKey>> {
    let s = eff(&t.schema);
    let r = d.execute(&format!("SELECT * FROM pragma_foreign_key_list({}, {})", l(&t.name), l(s)), usize::MAX).await?;
    Ok(r.records()
        .into_iter()
        .map(|r| ForeignKey {
            column_name: r.string("from"),
            foreign_table_schema: t.schema.clone(),
            foreign_table_name: r.string("table"),
            foreign_column_name: r.string("to"),
            constraint_name: r.opt("id").map(|id| format!("fk_{}_{id}", t.name)),
            on_update: r.opt("on_update"),
            on_delete: r.opt("on_delete"),
        })
        .collect())
}

pub(crate) async fn sqlcat_all_columns(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
    let mut out = Vec::new();
    for s in sqlcat_schemas(d).await? {
        if schema.is_some_and(|f| f != s) {
            continue;
        }
        for t in sqlcat_tables(d, &s).await?.into_iter().filter(|t| !t.is_view) {
            let fks = sqlcat_foreign_keys(d, &t).await.unwrap_or_default();
            for c in sqlcat_table_structure(d, &t).await? {
                let fk = fks.iter().find(|f| f.column_name == c.column_name);
                out.push(SchemaColumn {
                    table_schema: s.clone(),
                    table_name: t.name.clone(),
                    data_type: c.data_type,
                    is_nullable: c.is_nullable,
                    column_default: c.column_default,
                    is_primary: c.is_primary_key,
                    referenced_table_schema: fk.map(|_| s.clone()),
                    referenced_table_name: fk.map(|f| f.foreign_table_name.clone()),
                    referenced_column_name: fk.map(|f| f.foreign_column_name.clone()),
                    column_name: c.column_name,
                });
            }
        }
    }
    Ok(out)
}

async fn sqlcat_indexes_for(d: &dyn Driver, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
    let list = d.execute(&format!("SELECT * FROM pragma_index_list({}, {})", l(table), l(schema)), usize::MAX).await?.records();
    let mut out = Vec::new();
    for idx in list {
        let name = idx.string("name");
        let cols = d
            .execute(&format!("SELECT name FROM pragma_index_info({}, {}) ORDER BY seqno", l(&name), l(schema)), usize::MAX)
            .await
            .map(|r| r.first_column())
            .unwrap_or_default();
        let definition = d
            .execute(&format!("SELECT sql FROM {}.sqlite_master WHERE type = 'index' AND name = {}", q(schema), l(&name)), 1)
            .await
            .ok()
            .and_then(|r| r.first_column().into_iter().next())
            .unwrap_or_default();
        out.push(IndexInfo {
            schema: schema.to_string(),
            table_name: table.to_string(),
            is_unique: idx.i64("unique").unwrap_or(0) == 1,
            is_primary: idx.get("origin") == Some("pk"),
            method: None,
            columns: cols,
            definition,
            name,
        });
    }
    Ok(out)
}

pub(crate) async fn sqlcat_indexes(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
    let mut out = Vec::new();
    for s in sqlcat_schemas(d).await? {
        if schema.is_some_and(|f| f != s) {
            continue;
        }
        for t in sqlcat_tables(d, &s).await?.into_iter().filter(|t| !t.is_view) {
            out.extend(sqlcat_indexes_for(d, &s, &t.name).await?);
        }
    }
    Ok(out)
}

pub(crate) async fn sqlcat_triggers(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
    let s = eff(schema.unwrap_or("main"));
    let r = d
        .execute(&format!("SELECT name, tbl_name, sql FROM {}.sqlite_master WHERE type = 'trigger' ORDER BY name", q(s)), usize::MAX)
        .await?;
    Ok(r.records()
        .into_iter()
        .map(|r| {
            let sql = r.string("sql");
            let full = sql.to_ascii_uppercase();
            let up = full.split(" BEGIN").next().unwrap_or(&full).to_string() + " ";
            let timing = if up.contains(" BEFORE ") {
                "BEFORE"
            } else if up.contains(" INSTEAD OF ") {
                "INSTEAD OF"
            } else {
                "AFTER"
            };
            let events: Vec<String> = ["INSERT", "UPDATE", "DELETE"].iter().filter(|e| up.contains(&format!(" {e} "))).map(|e| e.to_string()).collect();
            TriggerInfo {
                schema: s.to_string(),
                name: r.string("name"),
                table_schema: Some(s.to_string()),
                table_name: r.opt("tbl_name"),
                timing: timing.into(),
                event: events.join(", "),
                events,
                orientation: "ROW".into(),
                enabled_mode: "ENABLED".into(),
                definition: Some(sql),
                ..Default::default()
            }
        })
        .collect())
}

#[async_trait]
impl Driver for SqliteDriver {
    fn kind(&self) -> Kind {
        Kind::Sqlite
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        sqlcat_schemas(self).await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        sqlcat_tables(self, schema).await
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let sql = sql.to_string();
        let started = Instant::now();
        let mut r = self.blocking(move |c| run_all(c, &sql, row_limit)).await?.pop().unwrap_or_default();
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn execute_readonly(&self, sql:&str,row_limit:usize)->Result<QueryResult>{
        let sql=sql.to_string();
        self.blocking(move|c|{
            if let Err(error)=c.execute_batch("PRAGMA query_only = ON; BEGIN") {
                let _=c.execute_batch("PRAGMA query_only = OFF");
                return Err(error.into());
            }
            let result=assert_supported(&sql).and_then(|_|run_all(c,&sql,row_limit).map(|mut r|r.pop().unwrap_or_default()));
            let rollback=c.execute_batch("ROLLBACK");
            let restore=c.execute_batch("PRAGMA query_only = OFF");
            match (result,rollback,restore){(Ok(value),Ok(()),Ok(()))=>Ok(value),(Err(error),_,_)=>Err(error),(Ok(_),Err(error),_)=>Err(error.into()),(Ok(_),Ok(()),Err(error))=>Err(error.into())}
        }).await
    }

    async fn execute_script(&self, sql: &str, row_limit: usize) -> Result<ScriptResult> {
        let stmts = split::split_statements(sql, Dialect::Sqlite);
        let started = Instant::now();
        let mut out = self
            .blocking(move |c| {
                let mut out = ScriptResult::default();
                for (i, s) in stmts.into_iter().enumerate() {
                    match assert_supported(&s).and_then(|_| run_one(c, &s, row_limit)) {
                        Ok(r) => out.results.push(r),
                        Err(e) => {
                            out.error = Some(ScriptError { statement_index: i, statement: s, message: e.to_string() });
                            break;
                        }
                    }
                }
                Ok(out)
            })
            .await?;
        out.elapsed = started.elapsed();
        Ok(out)
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let stmts = statements.to_vec();
        self.blocking(move |c| {
            c.execute_batch("BEGIN")?;
            let mut out = Vec::new();
            for s in &stmts {
                match run_one(c, s, usize::MAX) {
                    Ok(r) => out.push(r),
                    Err(e) => {
                        let _ = c.execute_batch("ROLLBACK");
                        return Err(e);
                    }
                }
            }
            c.execute_batch("COMMIT")?;
            Ok(out)
        })
        .await
    }

    fn select_preview_sql(&self, table: &TableRef, limit: usize) -> String {
        let name = if table.schema == "main" || table.schema.is_empty() {
            q(&table.name)
        } else {
            format!("{}.{}", q(&table.schema), q(&table.name))
        };
        format!("SELECT * FROM {name} LIMIT {limit}")
    }

    async fn databases(&self) -> Result<Vec<String>> {
        let path = self.blocking(|c| Ok(c.path().map(str::to_string))).await?;
        Ok(vec![match path.as_deref() {
            None | Some("") => ":memory:".into(),
            Some(p) => Path::new(p).file_name().map_or(p.to_string(), |f| f.to_string_lossy().into_owned()),
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
    fn resolves_paths_like_the_original() {
        assert_eq!(resolve_path(":memory:").unwrap(), None);
        assert_eq!(resolve_path("sqlite:///tmp/a.db").unwrap(), Some(PathBuf::from("/tmp/a.db")));
        assert_eq!(resolve_path("sqlite:/tmp/a.db").unwrap(), Some(PathBuf::from("/tmp/a.db")));
        assert_eq!(resolve_path("file:///tmp/a%20b.db").unwrap(), Some(PathBuf::from("/tmp/a b.db")));
        assert_eq!(resolve_path("/tmp/x.db?mode=ro").unwrap(), Some(PathBuf::from("/tmp/x.db")));
        assert!(resolve_path("~/x.db").unwrap().unwrap().is_absolute());
        assert!(resolve_path("http://x").is_err());
    }

    #[tokio::test]
    async fn runs_scripts_and_lists_catalog() {
        let d = SqliteDriver::open(":memory:").unwrap();
        let r = d
            .execute("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT UNIQUE); INSERT INTO t(name) VALUES ('a;b'),(NULL); SELECT * FROM t", 100)
            .await
            .unwrap();
        assert_eq!(r.columns, vec!["id", "name"]);
        assert_eq!(r.rows[0][1], Cell::Text("a;b".into()));
        assert_eq!(r.rows[1][1], Cell::Null);
        assert_eq!(r.column_types[0].category, TypeCategory::Integer);
        let tables = d.tables("main").await.unwrap();
        assert_eq!(tables[0].name, "t");
        let cols = d.columns(&tables[0]).await.unwrap();
        assert!(cols[0].is_primary_key && !cols[1].is_primary_key);
        let st = d.table_structure(&tables[0]).await.unwrap();
        assert!(st[0].is_identity && st[1].is_unique);
        assert_eq!(d.execute("SELECT 1 LIMIT 0", 1).await.unwrap().rows.len(), 0);
        let r = d
            .execute("-- a; comment\nWITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n LIMIT 5) SELECT x FROM n", 2)
            .await
            .unwrap();
        assert!(r.truncated && r.rows.len() == 2);
        assert!(d.execute("CREATE SCHEMA x", 1).await.is_err());
    }

    #[tokio::test]
    async fn compiles_postgres_syntax_on_execute() {
        let d = SqliteDriver::open(":memory:").unwrap();
        d.execute(
            r#"CREATE TABLE "users" ("id" serial primary key, "name" text, "email" text)"#,
            1,
        )
        .await
        .unwrap();
        d.execute(r#"INSERT INTO "users" ("name", "email") VALUES ('Ada', 'ada@example.com')"#, 1)
            .await
            .unwrap();
        let r = d
            .execute(
                r#"SELECT "name"::text FROM "users" WHERE "email" ILIKE '%ADA%'"#,
                10,
            )
            .await
            .unwrap();
        assert_eq!(r.rows.len(), 1);
        assert_eq!(r.rows[0][0], Cell::Text("Ada".into()));
    }

    #[tokio::test]
    async fn grid_round_trip() {
        let d = SqliteDriver::open(":memory:").unwrap();
        d.execute(
            "CREATE TABLE p(id INTEGER PRIMARY KEY, n TEXT); CREATE TABLE c(id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id) ON DELETE CASCADE, v REAL);
             CREATE INDEX ci ON c(p_id); CREATE TRIGGER tr AFTER INSERT ON c BEGIN UPDATE p SET n = n WHERE id = NEW.p_id; END;",
            1,
        )
        .await
        .unwrap();
        let p = TableRef::new("main", "p");
        let c = TableRef::new("main", "c");
        assert_eq!(d.insert_rows(&p, &[vec![("n".into(), "x".into())], vec![("n".into(), "y".into())]]).await.unwrap(), 2);
        d.insert_rows(&c, &[vec![("p_id".into(), Value::Int(1)), ("v".into(), Value::Float(1.5))]]).await.unwrap();
        let q = TableQuery {
            table: p.clone(),
            filter: TableFilter { rules: vec![FilterRule::new("n", FilterOperator::Contains, "y")], raw_where: None },
            limit: 10,
            with_count: true,
            ..Default::default()
        };
        let page = d.read_table(&q).await.unwrap();
        assert_eq!(page.total_count, Some(1));
        assert_eq!(page.result.rows[0][1], Cell::Text("y".into()));
        d.update_rows(&p, &[RowUpdate { r#where: vec![("id".into(), Value::Int(2))], set: vec![("n".into(), "z".into())] }]).await.unwrap();
        assert_eq!(d.execute("SELECT n FROM p WHERE id = 2", 1).await.unwrap().rows[0][0], Cell::Text("z".into()));
        assert_eq!(d.delete_rows(&p, &[vec![("id".into(), Value::Int(1)), ("n".into(), "x".into())]]).await.unwrap(), 1);
        let fks = d.foreign_keys(&c).await.unwrap();
        assert_eq!(fks[0].foreign_table_name, "p");
        assert_eq!(fks[0].on_delete.as_deref(), Some("CASCADE"));
        assert_eq!(d.indexes(None).await.unwrap().iter().find(|i| i.name == "ci").unwrap().columns, vec!["p_id"]);
        assert_eq!(d.triggers(None).await.unwrap()[0].events, vec!["INSERT"]);
        assert_eq!(d.all_tables_with_columns(None).await.unwrap().len(), 5);
        let rec = d.referenced_record(&p, &vec![("id".into(), Value::Int(2))]).await.unwrap().unwrap();
        assert_eq!(rec.get("n"), Some("z"));
        // empty result still has headers via structure backfill
        let empty = d.read_table(&TableQuery { table: p.clone(), filter: TableFilter::raw("1=0"), limit: 5, ..Default::default() }).await.unwrap();
        assert_eq!(empty.result.columns, vec!["id", "n"]);
        // failed transaction rolls back
        assert!(d.transaction(&["INSERT INTO p(n) VALUES ('q')".into(), "INSERT INTO nope VALUES (1)".into()]).await.is_err());
        assert_eq!(d.count_rows(&p, &TableFilter::default()).await.unwrap(), 1);
        let script = d.execute_script("SELECT 1; SELECT nope; SELECT 3", 10).await.unwrap();
        assert_eq!(script.results.len(), 1);
        assert_eq!(script.error.unwrap().statement_index, 1);
        let ex = d.explain("SELECT * FROM p", false).await.unwrap();
        assert!(ex.plan_query.starts_with("EXPLAIN QUERY PLAN"));
    }
}
