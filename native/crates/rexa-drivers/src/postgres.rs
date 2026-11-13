//! Port of `lib/db/pg-client.ts`, `pg-connection.ts`, `pg-tls.ts`.
//!
//! * Pool of up to 6 connections (the original's `max: 6`), so a long query
//!   doesn't block the sidebar's catalog reads.
//! * Results come from the simple-query (text) protocol so every type
//!   renders as the server prints it. For single row-returning statements
//!   the statement is also prepared once to learn the column types
//!   (`dataTypeName` = `pg_type.typname`, as the original reports).
//! * `sslmode` follows libpq/node-postgres: `disable` = plaintext,
//!   `allow`/`prefer` = TLS if offered (plaintext fallback), `require` =
//!   TLS without verification, `verify-ca` = verify chain, `verify-full` =
//!   chain + hostname. `sslrootcert`/`sslcert`/`sslkey` files are honoured.
//! * SSH tunnels via `rexadb_ssh_*` params (see `ssh.rs`).
//! * Query cancellation by id (`cancelQueryById`) via the backend's cancel key.

use crate::*;
use anyhow::{anyhow, Context};
use postgres_native_tls::MakeTlsConnector;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_postgres::{CancelToken, Client, SimpleQueryMessage};

const MAX_CONNECTIONS: usize = 6;

pub struct PostgresDriver {
    config: tokio_postgres::Config,
    tls: MakeTlsConnector,
    init_sql: Option<String>,
    idle: Mutex<Vec<Client>>,
    permits: Arc<Semaphore>,
    running: Mutex<HashMap<String, CancelToken>>,
    _tunnel: Option<crate::ssh::Tunnel>,
}

/// A checked-out connection; returned to the pool on drop unless closed.
struct Conn<'a> {
    client: Option<Client>,
    pool: &'a PostgresDriver,
    _permit: OwnedSemaphorePermit,
}

impl std::ops::Deref for Conn<'_> {
    type Target = Client;
    fn deref(&self) -> &Client {
        self.client.as_ref().unwrap()
    }
}

impl Drop for Conn<'_> {
    fn drop(&mut self) {
        if let Some(c) = self.client.take() {
            if !c.is_closed() {
                self.pool.idle.lock().unwrap().push(c);
            }
        }
    }
}

/// Parsed TLS settings of a connection string.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct PgTls {
    pub mode: String,
    pub root_cert: Option<String>,
    pub cert: Option<String>,
    pub key: Option<String>,
}

/// Normalize `postgres:/x` → `postgres://x`, pick the TLS settings and drop
/// params tokio-postgres doesn't know (it rejects unknown options; node-pg
/// ignores them).
pub(crate) fn normalize(cs: &str) -> (String, PgTls) {
    let mut input = cs.trim().to_string();
    for scheme in ["postgresql:/", "postgres:/"] {
        if input.len() > scheme.len() && input[..scheme.len()].eq_ignore_ascii_case(scheme) && !input[scheme.len()..].starts_with('/') {
            input = format!("{}/{}", &input[..scheme.len()], &input[scheme.len()..]);
            break;
        }
    }
    let Ok(mut url) = url::Url::parse(&input) else { return (input, PgTls { mode: "prefer".into(), ..Default::default() }) };
    let mut tls = PgTls { mode: "prefer".into(), ..Default::default() };
    let mut kept = Vec::new();
    let mut dbname_override = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "sslmode" => {
                let m = v.to_ascii_lowercase();
                if ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].contains(&m.as_str()) {
                    tls.mode = m;
                }
            }
            "sslrootcert" => tls.root_cert = Some(v.into_owned()),
            "sslcert" => tls.cert = Some(v.into_owned()),
            "sslkey" => tls.key = Some(v.into_owned()),
            "dbname" | "database" => dbname_override = Some(v.into_owned()),
            "user" | "password" | "host" | "port" | "options" | "application_name" | "connect_timeout" | "keepalives"
            | "keepalives_idle" | "target_session_attrs" | "channel_binding" | "hostaddr" | "load_balance_hosts" => {
                kept.push((k.into_owned(), v.into_owned()))
            }
            _ => {}
        }
    }
    let pg_mode = match tls.mode.as_str() {
        "disable" => "disable",
        "allow" | "prefer" => "prefer",
        _ => "require",
    };
    kept.push(("sslmode".into(), pg_mode.into()));
    if let Some(db) = dbname_override {
        kept.push(("dbname".into(), db));
    }
    url.query_pairs_mut().clear().extend_pairs(kept);
    (url.to_string(), tls)
}

fn build_tls(tls: &PgTls) -> Result<MakeTlsConnector> {
    let mut b = native_tls::TlsConnector::builder();
    match tls.mode.as_str() {
        "verify-full" => {}
        "verify-ca" => {
            b.danger_accept_invalid_hostnames(true);
        }
        _ => {
            b.danger_accept_invalid_certs(true).danger_accept_invalid_hostnames(true);
        }
    }
    if let Some(path) = &tls.root_cert {
        let pem = std::fs::read(path).with_context(|| format!("reading sslrootcert {path}"))?;
        b.add_root_certificate(native_tls::Certificate::from_pem(&pem)?);
    }
    if let (Some(cert), Some(key)) = (&tls.cert, &tls.key) {
        let cert = std::fs::read(cert).with_context(|| format!("reading sslcert {cert}"))?;
        let key = std::fs::read(key).with_context(|| format!("reading sslkey {key}"))?;
        b.identity(native_tls::Identity::from_pkcs8(&cert, &key)?);
    }
    Ok(MakeTlsConnector::new(b.build()?))
}

impl PostgresDriver {
    pub async fn connect(connection_string: &str, opts: &ConnectOptions) -> Result<Self> {
        let (cs, tunnel) = crate::ssh::start_if_needed(connection_string, 5432).await?;
        let (cs, tls) = normalize(&cs);
        let mut config: tokio_postgres::Config = cs.parse().context("invalid Postgres connection string")?;
        if config.get_connect_timeout().is_none() {
            config.connect_timeout(Duration::from_secs(15));
        }
        let mut init = Vec::new();
        if opts.read_only {
            init.push("SET default_transaction_read_only = on".to_string());
        }
        if let Some(t) = opts.statement_timeout {
            init.push(format!("SET statement_timeout = {}", t.as_millis()));
        }
        let driver = PostgresDriver {
            config,
            tls: build_tls(&tls)?,
            init_sql: (!init.is_empty()).then(|| init.join("; ")),
            idle: Mutex::new(Vec::new()),
            permits: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            running: Mutex::new(HashMap::new()),
            _tunnel: tunnel,
        };
        // Probe like the pool's first `connect()`.
        drop(driver.conn().await?);
        Ok(driver)
    }

    async fn new_client(&self) -> Result<Client> {
        let (client, connection) = self.config.connect(self.tls.clone()).await.map_err(describe).context("connecting to Postgres")?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        if let Some(init) = &self.init_sql {
            client.batch_execute(init).await.map_err(describe)?;
        }
        Ok(client)
    }

    async fn conn(&self) -> Result<Conn<'_>> {
        let permit = self.permits.clone().acquire_owned().await?;
        let existing = loop {
            let c = self.idle.lock().unwrap().pop();
            match c {
                Some(c) if c.is_closed() => continue,
                other => break other,
            }
        };
        let client = match existing {
            Some(c) => c,
            None => self.new_client().await?,
        };
        Ok(Conn { client: Some(client), pool: self, _permit: permit })
    }

    async fn run_on(&self, client: &Client, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let types = if wants_types(sql) {
            client.prepare(sql).await.ok().map(|st| {
                st.columns().iter().map(|c| ColumnMeta::new(c.name(), c.type_().name()).with_id(c.type_().oid())).collect::<Vec<_>>()
            })
        } else {
            None
        };
        let messages = client.simple_query(sql).await.map_err(describe)?;
        let mut result = collect(messages, row_limit).pop().unwrap_or_default();
        if let Some(types) = types {
            if types.len() == result.columns.len() {
                result.column_types = types;
            }
        }
        result.elapsed = started.elapsed();
        Ok(result)
    }
}

/// Prepare for column types only when it's a single row-returning statement.
fn wants_types(sql: &str) -> bool {
    let stmts = split::split_statements(sql, Dialect::Postgres);
    if stmts.len() != 1 {
        return false;
    }
    let s = stmts[0].trim_start_matches(|c: char| c == '(' || c.is_whitespace());
    let head = s.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
    matches!(head.as_str(), "select" | "with" | "table" | "values" | "show") || s.to_ascii_lowercase().contains("returning")
}

/// Turn simple-query messages into one result per statement.
fn collect(messages: Vec<SimpleQueryMessage>, row_limit: usize) -> Vec<QueryResult> {
    let mut out = Vec::new();
    let mut cur = QueryResult::default();
    let mut has_desc = false;
    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(cols) => {
                cur.columns = cols.iter().map(|c| c.name().to_string()).collect();
                has_desc = true;
            }
            SimpleQueryMessage::Row(row) => {
                if cur.columns.is_empty() {
                    cur.columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if cur.rows.len() >= row_limit {
                    cur.truncated = true;
                    continue;
                }
                cur.rows.push((0..row.len()).map(|i| row.get(i).map_or(Cell::Null, |v| Cell::Text(v.to_string()))).collect());
            }
            SimpleQueryMessage::CommandComplete(n) => {
                if !has_desc {
                    cur.affected = Some(n);
                }
                out.push(std::mem::take(&mut cur));
                has_desc = false;
            }
            _ => {}
        }
    }
    if !cur.columns.is_empty() || !cur.rows.is_empty() {
        out.push(cur);
    }
    out
}

#[async_trait]
impl Driver for PostgresDriver {
    fn kind(&self) -> Kind {
        Kind::Postgres
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        pgcat::schemas(self).await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        pgcat::tables(self, schema).await
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let c = self.conn().await?;
        self.run_on(&c, sql, row_limit).await
    }

    async fn execute_script(&self, sql: &str, row_limit: usize) -> Result<ScriptResult> {
        let started = Instant::now();
        let c = self.conn().await?;
        let mut out = ScriptResult::default();
        for (i, stmt) in split::split_statements(sql, Dialect::Postgres).into_iter().enumerate() {
            match self.run_on(&c, &stmt, row_limit).await {
                Ok(r) => out.results.push(r),
                Err(e) => {
                    out.error = Some(ScriptError { statement_index: i, statement: stmt, message: format!("{e:#}") });
                    break;
                }
            }
        }
        out.elapsed = started.elapsed();
        Ok(out)
    }

    async fn execute_cancellable(&self, sql: &str, row_limit: usize, query_id: &str) -> Result<QueryResult> {
        let c = self.conn().await?;
        let id = query_id.trim().to_string();
        if !id.is_empty() {
            self.running.lock().unwrap().insert(id.clone(), c.cancel_token());
        }
        let r = self.run_on(&c, sql, row_limit).await;
        if !id.is_empty() {
            self.running.lock().unwrap().remove(&id);
        }
        r
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        let id = query_id.trim();
        if id.is_empty() {
            bail!("Missing query id.");
        }
        let token = self.running.lock().unwrap().get(id).cloned();
        match token {
            Some(t) => {
                t.cancel_query(self.tls.clone()).await.map_err(describe)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let c = self.conn().await?;
        c.batch_execute("BEGIN").await.map_err(describe)?;
        let mut out = Vec::new();
        for s in statements {
            match self.run_on(&c, s, usize::MAX).await {
                Ok(r) => out.push(r),
                Err(e) => {
                    let _ = c.batch_execute("ROLLBACK").await;
                    return Err(e);
                }
            }
        }
        if let Err(e) = c.batch_execute("COMMIT").await {
            let _ = c.batch_execute("ROLLBACK").await;
            return Err(describe(e));
        }
        Ok(out)
    }

    async fn databases(&self) -> Result<Vec<String>> {
        pgcat::databases(self).await
    }
    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        pgcat::table_infos(self, schema).await
    }
    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        pgcat::views(self, schema).await
    }
    async fn table_structure(&self, table: &TableRef) -> Result<Vec<ColumnDetail>> {
        pgcat::table_structure(self, table).await
    }
    async fn foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKey>> {
        pgcat::foreign_keys(self, table).await
    }
    async fn primary_key(&self, table: &TableRef) -> Result<Vec<String>> {
        pgcat::primary_key(self, table).await
    }
    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        pgcat::all_tables_with_columns(self, schema).await
    }
    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        pgcat::indexes(self, schema).await
    }
    async fn constraints(&self, table: &TableRef) -> Result<Vec<ConstraintInfo>> {
        pgcat::constraints(self, table).await
    }
    async fn enums(&self) -> Result<Vec<EnumType>> {
        pgcat::enums(self).await
    }
    async fn functions(&self, schema: &str) -> Result<Vec<RoutineInfo>> {
        pgcat::functions(self, schema).await
    }
    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        pgcat::triggers(self, schema).await
    }
    async fn sequences(&self, schema: &str) -> Result<Vec<SequenceInfo>> {
        pgcat::sequences(self, schema).await
    }
    async fn extensions(&self) -> Result<Vec<ExtensionInfo>> {
        pgcat::extensions(self).await
    }
    async fn rls_policies(&self, schema: Option<&str>, table: Option<&str>) -> Result<Vec<RlsPolicy>> {
        pgcat::rls_policies(self, schema, table).await
    }
    async fn table_security(&self, schema: &str) -> Result<Vec<TableSecurity>> {
        pgcat::table_security(self, schema).await
    }
    async fn roles(&self) -> Result<Vec<String>> {
        pgcat::roles(self).await
    }
    async fn materialized_views(&self, schema: &str) -> Result<Vec<MaterializedViewInfo>> {
        pgcat::materialized_views(self, schema).await
    }
    async fn sessions(&self) -> Result<QueryResult> {
        pgcat::sessions(self).await
    }
    async fn locks(&self) -> Result<QueryResult> {
        pgcat::locks(self).await
    }
    async fn kill_session(&self, pid: i64) -> Result<()> {
        self.execute(&format!("SELECT pg_terminate_backend({pid})"), 1).await.map(|_| ())
    }
    async fn cancel_session_query(&self, pid: i64) -> Result<()> {
        self.execute(&format!("SELECT pg_cancel_backend({pid})"), 1).await.map(|_| ())
    }
    async fn supabase_auth_users(&self) -> Result<Vec<AuthUser>> {
        pgcat::auth_users(self).await
    }
}

/// Surface the server's message (and detail/hint/position) instead of "db error".
pub(crate) fn describe(err: tokio_postgres::Error) -> anyhow::Error {
    match err.as_db_error() {
        Some(db) => {
            let mut msg = format!("{}: {}", db.severity(), db.message());
            if let Some(detail) = db.detail() {
                msg.push_str(&format!("\nDETAIL: {detail}"));
            }
            if let Some(hint) = db.hint() {
                msg.push_str(&format!("\nHINT: {hint}"));
            }
            if let Some(tokio_postgres::error::ErrorPosition::Original(p)) = db.position() {
                msg.push_str(&format!("\nPOSITION: {p}"));
            }
            anyhow!(msg)
        }
        None => {
            let text = err.to_string();
            match std::error::Error::source(&err) {
                Some(src) if !text.contains(&src.to_string()) => anyhow!("{text}: {src}"),
                _ => anyhow!(text),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn sslmode_follows_libpq_semantics() {
        let (cs, tls) = normalize("postgres://u@h/d?sslmode=require&pgbouncer=true");
        assert_eq!(cs, "postgres://u@h/d?sslmode=require");
        assert_eq!(tls.mode, "require");
        let (cs, tls) = normalize("postgres://u@h/d?sslmode=verify-full&sslrootcert=/x.pem");
        assert_eq!(cs, "postgres://u@h/d?sslmode=require");
        assert_eq!((tls.mode.as_str(), tls.root_cert.as_deref()), ("verify-full", Some("/x.pem")));
        let (cs, tls) = normalize("postgres:/u@h/d");
        assert_eq!(cs, "postgres://u@h/d?sslmode=prefer");
        assert_eq!(tls.mode, "prefer");
        assert_eq!(normalize("postgres://u@h/d?sslmode=disable").0, "postgres://u@h/d?sslmode=disable");
        assert_eq!(normalize("postgres://u@h/?database=x").0, "postgres://u@h/?sslmode=prefer&dbname=x");
    }

    #[test]
    fn type_probe_only_for_single_selects() {
        assert!(super::wants_types("SELECT 1"));
        assert!(super::wants_types(" with x as (select 1) select * from x"));
        assert!(super::wants_types("INSERT INTO t VALUES (1) RETURNING id"));
        assert!(!super::wants_types("SELECT 1; SELECT 2"));
        assert!(!super::wants_types("CREATE TABLE t (a int)"));
    }
}
