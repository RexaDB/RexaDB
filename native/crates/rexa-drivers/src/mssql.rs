//! Port of `lib/db/mssql-client.ts` on tiberius (TDS 7.3+).
//!
//! Connection strings: ADO-style `Server=host,port\instance;Database=…;User
//! Id=…;Password=…;Encrypt=true;TrustServerCertificate=true` or URLs
//! `mssql://user:pass@host:1433/db?encrypt=true&trustServerCertificate=true&instance=X`
//! (`sqlserver://` accepted). Encryption off unless `encrypt`/`ssl` is
//! truthy, like the original's defaults. Named instances are resolved via
//! the SQL Browser.

use crate::*;
use anyhow::{anyhow, Context};
use futures_util::TryStreamExt;
use std::time::Instant;
use tiberius::{AuthMethod, Client, ColumnData, ColumnType, Config, EncryptionLevel, FromSql, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

type Conn = Client<Compat<TcpStream>>;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct MsConfig {
    pub server: String,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub encrypt: bool,
    pub trust_server_certificate: bool,
    pub instance: Option<String>,
}

fn to_bool(raw: Option<&str>, fallback: bool) -> bool {
    match raw.map(|s| s.trim().to_ascii_lowercase()) {
        Some(s) if ["true", "1", "yes", "y", "on"].contains(&s.as_str()) => true,
        Some(s) if ["false", "0", "no", "n", "off"].contains(&s.as_str()) => false,
        _ => fallback,
    }
}

/// `parseMssqlConfig`.
pub(crate) fn parse(cs: &str) -> MsConfig {
    let t = cs.trim();
    let t = if t.len() >= 12 && t[..12].eq_ignore_ascii_case("sqlserver://") { format!("mssql://{}", &t[12..]) } else { t.to_string() };
    if t.contains(';') {
        let mut map = std::collections::HashMap::new();
        for part in t.split(';').map(str::trim).filter(|p| !p.is_empty()) {
            if let Some((k, v)) = part.split_once('=') {
                if !k.trim().is_empty() {
                    map.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                }
            }
        }
        if !map.is_empty() {
            let raw = ["server", "data source", "address", "addr", "network address"].iter().find_map(|k| map.get(*k)).cloned().unwrap_or_default();
            let mut server = raw.trim_start_matches("tcp:").trim().to_string();
            if server.is_empty() {
                server = "localhost".into();
            }
            let mut instance = None;
            let mut port = None;
            if let Some((h, i)) = server.clone().split_once('\\') {
                server = h.to_string();
                instance = Some(i.to_string()).filter(|s| !s.is_empty());
            }
            if let Some((h, p)) = server.clone().split_once(',') {
                server = h.to_string();
                port = p.trim().parse().ok().filter(|p| *p > 0);
            }
            let get = |ks: &[&str]| ks.iter().find_map(|k| map.get(*k)).cloned().filter(|s| !s.is_empty());
            return MsConfig {
                server,
                port,
                database: get(&["database", "initial catalog"]),
                user: get(&["user id", "uid", "user"]),
                password: get(&["password", "pwd"]),
                encrypt: to_bool(map.get("encrypt").map(String::as_str), false),
                trust_server_certificate: to_bool(map.get("trustservercertificate").map(String::as_str), false),
                instance,
            };
        }
    }
    match url::Url::parse(&t) {
        Ok(u) if u.scheme().starts_with("mssql") || u.scheme().starts_with("sqlserver") => {
            let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
            MsConfig {
                server: u.host_str().unwrap_or("localhost").to_string(),
                port: Some(u.port().unwrap_or(1433)),
                database: Some(crate::detect::percent_decode(u.path().trim_start_matches('/'))).filter(|s| !s.is_empty()),
                user: Some(crate::detect::percent_decode(u.username())).filter(|s| !s.is_empty()),
                password: u.password().map(crate::detect::percent_decode),
                encrypt: to_bool(get("encrypt").or_else(|| get("ssl")).as_deref(), false),
                trust_server_certificate: to_bool(get("trustServerCertificate").or_else(|| get("trustServerCert")).as_deref(), false),
                instance: get("instance").filter(|s| !s.is_empty()),
            }
        }
        _ => MsConfig { server: "localhost".into(), port: Some(1433), trust_server_certificate: true, ..Default::default() },
    }
}

pub struct MsSqlDriver {
    config: Config,
    instance: bool,
    conn: AsyncMutex<Option<Conn>>,
}

async fn open(config: &Config, instance: bool) -> Result<Conn> {
    let tcp = if instance {
        use tiberius::SqlBrowser;
        tokio::time::timeout(Duration::from_secs(15), TcpStream::connect_named(config)).await.map_err(|_| anyhow!("connect ETIMEDOUT"))??
    } else {
        tokio::time::timeout(Duration::from_secs(15), TcpStream::connect(config.get_addr())).await.map_err(|_| anyhow!("connect ETIMEDOUT"))??
    };
    tcp.set_nodelay(true)?;
    Ok(Client::connect(config.clone(), tcp.compat_write()).await.context("connecting to SQL Server")?)
}

/// tiberius `ColumnType` → T-SQL type name.
fn type_name(t: ColumnType) -> &'static str {
    use ColumnType::*;
    match t {
        Null => "null",
        Bit | Bitn => "bit",
        Int1 => "tinyint",
        Int2 => "smallint",
        Int4 | Intn => "int",
        Int8 => "bigint",
        Datetime4 => "smalldatetime",
        Float4 => "real",
        Float8 | Floatn => "float",
        Money | Money4 => "money",
        Datetime | Datetimen => "datetime",
        Guid => "uniqueidentifier",
        Decimaln | Numericn => "decimal",
        Daten => "date",
        Timen => "time",
        Datetime2 => "datetime2",
        DatetimeOffsetn => "datetimeoffset",
        BigVarBin | BigBinary | Image => "varbinary",
        BigVarChar | BigChar | Text => "varchar",
        NVarchar | NChar | NText => "nvarchar",
        Xml => "xml",
        Udt => "udt",
        SSVariant => "sql_variant",
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn cell(d: &ColumnData<'static>) -> Cell {
    use tiberius::time::chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
    let s: Option<String> = match d {
        ColumnData::U8(v) => v.map(|x| x.to_string()),
        ColumnData::I16(v) => v.map(|x| x.to_string()),
        ColumnData::I32(v) => v.map(|x| x.to_string()),
        ColumnData::I64(v) => v.map(|x| x.to_string()),
        ColumnData::F32(v) => v.map(|x| x.to_string()),
        ColumnData::F64(v) => v.map(|x| x.to_string()),
        ColumnData::Bit(v) => v.map(|x| x.to_string()),
        ColumnData::String(v) => v.as_ref().map(|x| x.to_string()),
        ColumnData::Guid(v) => v.map(|x| x.to_string().to_uppercase()),
        ColumnData::Binary(v) => v.as_ref().map(|x| hex(x)),
        ColumnData::Numeric(v) => v.map(|x| x.to_string()),
        ColumnData::Xml(v) => v.as_ref().map(|x| x.to_string()),
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            NaiveDateTime::from_sql(d).ok().flatten().map(|x| x.format("%Y-%m-%dT%H:%M:%S%.3f").to_string())
        }
        ColumnData::DateTimeOffset(_) => DateTime::<FixedOffset>::from_sql(d).ok().flatten().map(|x| x.to_rfc3339()),
        ColumnData::Date(_) => NaiveDate::from_sql(d).ok().flatten().map(|x| x.to_string()),
        ColumnData::Time(_) => NaiveTime::from_sql(d).ok().flatten().map(|x| x.to_string()),
    };
    s.map_or(Cell::Null, Cell::Text)
}

fn returns_rows(sql: &str) -> bool {
    let h = sql.trim_start().trim_start_matches('(').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
    matches!(h.as_str(), "select" | "with" | "exec" | "execute" | "sp_help" | "declare" | "values") || sql.to_ascii_lowercase().contains("output inserted")
}

async fn run(c: &mut Conn, sql: &str, row_limit: usize) -> Result<Vec<QueryResult>> {
    if !returns_rows(sql) {
        let r = c.execute(sql, &[]).await.map_err(|e| anyhow!("{e}"))?;
        return Ok(vec![QueryResult { affected: Some(r.rows_affected().iter().sum()), ..Default::default() }]);
    }
    let mut stream = c.simple_query(sql).await.map_err(|e| anyhow!("{e}"))?;
    let mut out: Vec<QueryResult> = Vec::new();
    while let Some(item) = stream.try_next().await.map_err(|e| anyhow!("{e}"))? {
        match item {
            QueryItem::Metadata(m) => {
                let cols = m.columns();
                out.push(QueryResult {
                    columns: cols.iter().map(|c| c.name().to_string()).collect(),
                    column_types: cols.iter().map(|c| ColumnMeta::new(c.name(), type_name(c.column_type()))).collect(),
                    ..Default::default()
                });
            }
            QueryItem::Row(row) => {
                let Some(cur) = out.last_mut() else { continue };
                if cur.rows.len() >= row_limit {
                    cur.truncated = true;
                    continue;
                }
                cur.rows.push(row.cells().map(|(_, d)| cell(d)).collect());
            }
        }
    }
    if out.is_empty() {
        out.push(QueryResult::default());
    }
    Ok(out)
}

fn lit(s: &str) -> String {
    Dialect::MsSql.quote_str(s)
}

impl MsSqlDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let p = parse(cs);
        let mut config = Config::new();
        config.host(&p.server);
        if let Some(port) = p.port {
            config.port(port);
        }
        if let Some(db) = &p.database {
            config.database(db);
        }
        if let Some(i) = &p.instance {
            config.instance_name(i);
        }
        config.application_name("RexaDB");
        config.authentication(AuthMethod::sql_server(p.user.clone().unwrap_or_default(), p.password.clone().unwrap_or_default()));
        config.encryption(if p.encrypt { EncryptionLevel::Required } else { EncryptionLevel::Off });
        if p.trust_server_certificate || !p.encrypt {
            config.trust_cert();
        }
        let conn = open(&config, p.instance.is_some()).await?;
        Ok(MsSqlDriver { config, instance: p.instance.is_some(), conn: AsyncMutex::new(Some(conn)) })
    }

    async fn with_conn<T>(&self, f: impl for<'a> FnOnce(&'a mut Conn) -> futures_util::future::BoxFuture<'a, Result<T>>) -> Result<T> {
        let mut g = self.conn.lock().await;
        if g.is_none() {
            *g = Some(open(&self.config, self.instance).await?);
        }
        let r = f(g.as_mut().unwrap()).await;
        if let Err(e) = &r {
            let m = e.to_string().to_ascii_lowercase();
            if m.contains("broken pipe") || m.contains("connection reset") || m.contains("eof") {
                *g = None;
            }
        }
        r
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Record>> {
        Ok(self.execute(sql, usize::MAX).await?.records())
    }
}

#[async_trait]
impl Driver for MsSqlDriver {
    fn kind(&self) -> Kind {
        Kind::MsSql
    }

    fn quote_ident(&self, ident: &str) -> String {
        Dialect::MsSql.quote_ident(ident)
    }

    fn select_preview_sql(&self, table: &TableRef, limit: usize) -> String {
        format!("SELECT TOP {limit} * FROM {}", Dialect::MsSql.table_ref(&table.schema, &table.name))
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(self.execute("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name", usize::MAX).await?.first_column())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.execute("SELECT name FROM sys.databases ORDER BY name", usize::MAX).await?.first_column())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        Ok(self
            .rows(&format!(
                "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME",
                lit(schema)
            ))
            .await?
            .into_iter()
            .map(|r| TableRef { schema: schema.to_string(), name: r.string("name"), is_view: r.get("type") == Some("VIEW") })
            .collect())
    }

    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        Ok(self
            .rows(&format!(
                "SELECT o.name, o.type,
                        (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS row_estimate,
                        (SELECT SUM(a.total_pages) * 8192 FROM sys.partitions p JOIN sys.allocation_units a ON a.container_id = p.partition_id
                          WHERE p.object_id = o.object_id) AS total_bytes,
                        CAST(ep.value AS NVARCHAR(MAX)) AS comment
                 FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                 LEFT JOIN sys.extended_properties ep ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
                 WHERE s.name = {} AND o.type IN ('U', 'V') ORDER BY o.name",
                lit(schema)
            ))
            .await?
            .into_iter()
            .map(|r| TableInfo {
                schema: schema.to_string(),
                name: r.string("name"),
                kind: if r.get("type").map(str::trim) == Some("V") { TableKind::View } else { TableKind::Table },
                row_estimate: r.i64("row_estimate"),
                total_bytes: r.i64("total_bytes"),
                comment: r.non_empty("comment"),
                ..Default::default()
            })
            .collect())
    }

    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        Ok(self
            .execute(&format!("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME", lit(schema)), usize::MAX)
            .await?
            .first_column())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let sql = sql.to_string();
        let mut r = self.with_conn(move |c| Box::pin(async move { run(c, &sql, row_limit).await })).await?.pop().unwrap_or_default();
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let stmts = statements.to_vec();
        self.with_conn(move |c| {
            Box::pin(async move {
                c.simple_query("BEGIN TRANSACTION").await?.into_results().await?;
                let mut out = Vec::new();
                for s in &stmts {
                    match run(c, s, usize::MAX).await {
                        Ok(mut r) => out.push(r.pop().unwrap_or_default()),
                        Err(e) => {
                            let _ = async { c.simple_query("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION").await?.into_results().await }.await;
                            return Err(e);
                        }
                    }
                }
                c.simple_query("COMMIT TRANSACTION").await?.into_results().await?;
                Ok(out)
            })
        })
        .await
    }

    /// `SET SHOWPLAN_XML ON` must be alone in its batch.
    async fn explain(&self, query: &str, _analyze: bool) -> Result<ExplainResult> {
        let q = query.to_string();
        let result = self
            .with_conn(move |c| {
                Box::pin(async move {
                    c.simple_query("SET SHOWPLAN_XML ON").await?.into_results().await?;
                    let r = run_rows(c, &q).await;
                    let _ = async { c.simple_query("SET SHOWPLAN_XML OFF").await?.into_results().await }.await;
                    r
                })
            })
            .await?;
        Ok(ExplainResult { result, plan_query: explain_sql(Kind::MsSql, query, false) })
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let (s, n) = (lit(&t.schema), lit(&t.name));
        let sql = format!(
            "SELECT c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable,
                    c.COLUMN_DEFAULT AS column_default, c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
                    c.NUMERIC_PRECISION AS numeric_precision, c.NUMERIC_SCALE AS numeric_scale, c.ORDINAL_POSITION AS ordinal_position,
                    COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
                    CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_foreign_key
             FROM INFORMATION_SCHEMA.COLUMNS c
             LEFT JOIN (SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                         AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
                        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = {s} AND tc.TABLE_NAME = {n}) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
             LEFT JOIN (SELECT DISTINCT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                        WHERE kcu.TABLE_SCHEMA = {s} AND kcu.TABLE_NAME = {n}) fk ON c.COLUMN_NAME = fk.COLUMN_NAME
             WHERE c.TABLE_SCHEMA = {s} AND c.TABLE_NAME = {n}
             ORDER BY c.ORDINAL_POSITION"
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| {
                let dt = r.string("data_type");
                let len = r.i64("character_maximum_length");
                let full = match (dt.as_str(), len) {
                    (_, Some(-1)) => format!("{dt}(MAX)"),
                    ("varchar" | "nvarchar" | "char" | "nchar" | "varbinary" | "binary", Some(l)) => format!("{dt}({l})"),
                    ("decimal" | "numeric", _) => format!("{dt}({},{})", r.i64("numeric_precision").unwrap_or(18), r.i64("numeric_scale").unwrap_or(0)),
                    _ => dt.clone(),
                };
                ColumnDetail {
                    column_name: r.string("column_name"),
                    data_type: dt,
                    full_type: full,
                    is_nullable: r.get("is_nullable") == Some("YES"),
                    column_default: r.opt("column_default"),
                    character_maximum_length: len,
                    numeric_precision: r.i64("numeric_precision"),
                    numeric_scale: r.i64("numeric_scale"),
                    is_primary_key: r.bool("is_primary_key"),
                    is_foreign_key: r.bool("is_foreign_key"),
                    is_identity: r.bool("is_identity"),
                    ordinal_position: r.i64("ordinal_position").unwrap_or(0),
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        Ok(self
            .execute(
                &format!(
                    "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                      AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
                     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = {} AND tc.TABLE_NAME = {}
                     ORDER BY kcu.ORDINAL_POSITION",
                    lit(&t.schema),
                    lit(&t.name)
                ),
                usize::MAX,
            )
            .await?
            .first_column())
    }

    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        Ok(self
            .rows(&format!(
                "SELECT kcu.COLUMN_NAME AS column_name, ccu.TABLE_SCHEMA AS foreign_table_schema, ccu.TABLE_NAME AS foreign_table_name,
                        ccu.COLUMN_NAME AS foreign_column_name, rc.CONSTRAINT_NAME AS constraint_name,
                        rc.UPDATE_RULE AS on_update, rc.DELETE_RULE AS on_delete
                 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                 JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                 JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
                 WHERE kcu.TABLE_SCHEMA = {} AND kcu.TABLE_NAME = {}
                 ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
                lit(&t.schema),
                lit(&t.name)
            ))
            .await?
            .into_iter()
            .map(|r| ForeignKey {
                column_name: r.string("column_name"),
                foreign_table_schema: r.string("foreign_table_schema"),
                foreign_table_name: r.string("foreign_table_name"),
                foreign_column_name: r.string("foreign_column_name"),
                constraint_name: r.opt("constraint_name"),
                on_update: r.opt("on_update"),
                on_delete: r.opt("on_delete"),
            })
            .collect())
    }

    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let filter = schema.map(|s| format!("AND c.TABLE_SCHEMA = {}", lit(s))).unwrap_or_default();
        Ok(self
            .rows(&format!(
                "SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
                        c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS column_default,
                        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary,
                        fk.ref_schema AS referenced_table_schema, fk.ref_table AS referenced_table_name, fk.ref_column AS referenced_column_name
                 FROM INFORMATION_SCHEMA.COLUMNS c
                 JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
                 LEFT JOIN (SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY') pk
                   ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
                 LEFT JOIN (SELECT OBJECT_SCHEMA_NAME(f.parent_object_id) AS s, OBJECT_NAME(f.parent_object_id) AS t,
                                   COL_NAME(f.parent_object_id, f.parent_column_id) AS col,
                                   OBJECT_SCHEMA_NAME(f.referenced_object_id) AS ref_schema, OBJECT_NAME(f.referenced_object_id) AS ref_table,
                                   COL_NAME(f.referenced_object_id, f.referenced_column_id) AS ref_column
                            FROM sys.foreign_key_columns f) fk
                   ON fk.s = c.TABLE_SCHEMA AND fk.t = c.TABLE_NAME AND fk.col = c.COLUMN_NAME
                 WHERE 1 = 1 {filter}
                 ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION"
            ))
            .await?
            .into_iter()
            .map(|r| SchemaColumn {
                table_schema: r.string("table_schema"),
                table_name: r.string("table_name"),
                column_name: r.string("column_name"),
                data_type: r.string("data_type"),
                is_nullable: r.get("is_nullable") == Some("YES"),
                column_default: r.opt("column_default"),
                is_primary: r.bool("is_primary"),
                referenced_table_schema: r.opt("referenced_table_schema"),
                referenced_table_name: r.opt("referenced_table_name"),
                referenced_column_name: r.opt("referenced_column_name"),
            })
            .collect())
    }

    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        let filter = schema.map(|s| format!("AND s.name = {}", lit(s))).unwrap_or_default();
        let rows = self
            .rows(&format!(
                "SELECT s.name AS [schema], t.name AS table_name, i.name AS name, i.is_unique, i.is_primary_key, i.type_desc AS method,
                        c.name AS column_name
                 FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
                 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE i.name IS NOT NULL {filter}
                 ORDER BY s.name, t.name, i.name, ic.key_ordinal"
            ))
            .await?;
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in rows {
            let (s, t, n, c) = (r.string("schema"), r.string("table_name"), r.string("name"), r.string("column_name"));
            if let Some(i) = out.iter_mut().find(|i| i.schema == s && i.table_name == t && i.name == n) {
                i.columns.push(c);
                continue;
            }
            out.push(IndexInfo {
                is_unique: r.bool("is_unique"),
                is_primary: r.bool("is_primary_key"),
                method: r.opt("method"),
                columns: vec![c],
                schema: s,
                table_name: t,
                name: n,
                definition: String::new(),
            });
        }
        for i in &mut out {
            let cols: Vec<String> = i.columns.iter().map(|c| Dialect::MsSql.quote_ident(c)).collect();
            i.definition = format!(
                "CREATE {}{}INDEX {} ON {} ({})",
                if i.is_unique { "UNIQUE " } else { "" },
                i.method.as_deref().map(|m| format!("{m} ")).unwrap_or_default(),
                Dialect::MsSql.quote_ident(&i.name),
                Dialect::MsSql.table_ref(&i.schema, &i.table_name),
                cols.join(", ")
            );
        }
        Ok(out)
    }

    /// `getRoutines`.
    async fn functions(&self, schema: &str) -> Result<Vec<RoutineInfo>> {
        let schema = if schema.is_empty() { "dbo" } else { schema };
        let Ok(objects) = self
            .rows(&format!(
                "SELECT s.name AS [schema], o.name AS name,
                        CASE WHEN o.type IN ('P','PC','X') THEN 'PROCEDURE' ELSE 'FUNCTION' END AS [type], m.definition AS definition
                 FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
                 LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
                 WHERE s.name = {} AND o.type IN ('P','PC','FN','IF','TF') ORDER BY o.name",
                lit(schema)
            ))
            .await
        else {
            return Ok(Vec::new());
        };
        let params = self
            .rows(&format!(
                "SELECT OBJECT_NAME(p.object_id) AS name, p.name AS param_name, TYPE_NAME(p.user_type_id) AS type_name,
                        p.max_length, p.precision, p.scale, p.is_output, p.parameter_id
                 FROM sys.parameters p JOIN sys.objects o ON p.object_id = o.object_id JOIN sys.schemas s ON o.schema_id = s.schema_id
                 WHERE s.name = {} AND o.type IN ('P','PC','FN','IF','TF') ORDER BY OBJECT_NAME(p.object_id), p.parameter_id",
                lit(schema)
            ))
            .await
            .unwrap_or_default();
        let returns = self
            .rows(&format!(
                "SELECT SPECIFIC_NAME AS name, DATA_TYPE AS data_type, CHARACTER_MAXIMUM_LENGTH AS char_len,
                        NUMERIC_PRECISION AS num_precision, NUMERIC_SCALE AS num_scale
                 FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = {}",
                lit(schema)
            ))
            .await
            .unwrap_or_default();
        let fmt_type = |t: &str, len: Option<i64>, p: Option<i64>, s: Option<i64>, nchar: bool| -> String {
            let l = t.to_ascii_lowercase();
            match l.as_str() {
                "nvarchar" | "nchar" | "varchar" | "char" | "varbinary" | "binary" => match len {
                    Some(-1) => format!("{t}(MAX)"),
                    Some(n) if n > 0 => format!("{t}({})", if nchar && l.starts_with('n') { n / 2 } else { n }),
                    _ => t.to_string(),
                },
                "decimal" | "numeric" => match (p, s) {
                    (Some(p), Some(s)) => format!("{t}({p},{s})"),
                    _ => t.to_string(),
                },
                "datetime2" | "datetimeoffset" | "time" => s.map_or(t.to_string(), |s| format!("{t}({s})")),
                _ => t.to_string(),
            }
        };
        Ok(objects
            .into_iter()
            .map(|o| {
                let name = o.string("name");
                let ty = if o.get("type") == Some("PROCEDURE") { "PROCEDURE" } else { "FUNCTION" };
                let args: Vec<String> = params
                    .iter()
                    .filter(|p| p.string("name") == name && p.i64("parameter_id").unwrap_or(-1) != 0 && !p.string("param_name").is_empty())
                    .map(|p| {
                        format!(
                            "{} {}{}",
                            p.string("param_name"),
                            fmt_type(&p.string("type_name"), p.i64("max_length"), p.i64("precision"), p.i64("scale"), true),
                            if p.bool("is_output") { " OUTPUT" } else { "" }
                        )
                    })
                    .collect();
                let ret = returns
                    .iter()
                    .find(|r| r.string("name") == name)
                    .and_then(|r| r.non_empty("data_type").map(|dt| fmt_type(&dt, r.i64("char_len"), r.i64("num_precision"), r.i64("num_scale"), false)))
                    .unwrap_or_default();
                RoutineInfo {
                    schema: o.non_empty("schema").unwrap_or_else(|| schema.to_string()),
                    arguments: args.join(", "),
                    return_type: if ty == "PROCEDURE" { String::new() } else { ret },
                    definition: o.opt("definition"),
                    language: "Transact-SQL".into(),
                    r#type: ty.into(),
                    name,
                    ..Default::default()
                }
            })
            .collect())
    }

    /// `getTriggers` (events grouped per trigger).
    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        let schema = schema.filter(|s| !s.is_empty()).unwrap_or("dbo");
        let Ok(rows) = self
            .rows(&format!(
                "SELECT s.name AS [schema], t.name AS name, OBJECT_SCHEMA_NAME(t.parent_id) AS table_schema,
                        OBJECT_NAME(t.parent_id) AS table_name,
                        CASE WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
                        te.type_desc AS event, m.definition AS definition, t.is_disabled
                 FROM sys.triggers t JOIN sys.objects o ON o.object_id = t.object_id JOIN sys.schemas s ON o.schema_id = s.schema_id
                 LEFT JOIN sys.sql_modules m ON t.object_id = m.object_id
                 LEFT JOIN sys.trigger_events te ON t.object_id = te.object_id
                 WHERE s.name = {0} OR OBJECT_SCHEMA_NAME(t.parent_id) = {0}
                 ORDER BY t.name",
                lit(schema)
            ))
            .await
        else {
            return Ok(Vec::new());
        };
        let mut out: Vec<TriggerInfo> = Vec::new();
        for r in rows {
            let (s, n, ev) = (r.non_empty("schema").unwrap_or_else(|| schema.to_string()), r.string("name"), r.string("event"));
            if n.is_empty() {
                continue;
            }
            if let Some(t) = out.iter_mut().find(|t| t.schema == s && t.name == n) {
                if !ev.is_empty() && !t.events.contains(&ev) {
                    t.events.push(ev);
                    t.event = t.events.join(", ");
                }
                continue;
            }
            out.push(TriggerInfo {
                table_schema: r.opt("table_schema"),
                table_name: r.opt("table_name"),
                timing: r.non_empty("timing").unwrap_or_else(|| "AFTER".into()),
                events: if ev.is_empty() { vec![] } else { vec![ev.clone()] },
                event: ev,
                orientation: "STATEMENT".into(),
                enabled_mode: if r.bool("is_disabled") { "DISABLED".into() } else { "ENABLED".into() },
                definition: r.opt("definition"),
                schema: s,
                name: n,
                ..Default::default()
            });
        }
        Ok(out)
    }

    async fn sessions(&self) -> Result<QueryResult> {
        self.execute(
            "SELECT s.session_id AS pid, DB_NAME(s.database_id) AS [database], s.login_name AS username, s.program_name AS application_name,
                    c.client_net_address AS client_addr, s.status AS state, r.command, t.text AS query, r.start_time AS query_start
             FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
             LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
             OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
             WHERE s.is_user_process = 1 AND s.session_id <> @@SPID",
            usize::MAX,
        )
        .await
    }
}

async fn run_rows(c: &mut Conn, sql: &str) -> Result<QueryResult> {
    let mut stream = c.simple_query(sql).await.map_err(|e| anyhow!("{e}"))?;
    let mut r = QueryResult::default();
    while let Some(item) = stream.try_next().await.map_err(|e| anyhow!("{e}"))? {
        match item {
            QueryItem::Metadata(m) => r.columns = m.columns().iter().map(|c| c.name().to_string()).collect(),
            QueryItem::Row(row) => r.rows.push(row.cells().map(|(_, d)| cell(d)).collect()),
        }
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_the_original() {
        let c = parse("Server=tcp:db.example.com,1444;Initial Catalog=Sales;User ID=sa;Password=p;Encrypt=True;TrustServerCertificate=yes");
        assert_eq!(
            c,
            MsConfig {
                server: "db.example.com".into(),
                port: Some(1444),
                database: Some("Sales".into()),
                user: Some("sa".into()),
                password: Some("p".into()),
                encrypt: true,
                trust_server_certificate: true,
                instance: None
            }
        );
        let c = parse("Server=host\\SQLEXPRESS;Database=d");
        assert_eq!((c.server.as_str(), c.instance.as_deref(), c.port), ("host", Some("SQLEXPRESS"), None));
        let c = parse("sqlserver://sa:p%40w@h/db?encrypt=true&trustServerCertificate=true");
        assert_eq!((c.server.as_str(), c.port, c.password.as_deref(), c.encrypt), ("h", Some(1433), Some("p@w"), true));
        assert!(returns_rows("SELECT 1") && !returns_rows("UPDATE t SET a = 1") && returns_rows("INSERT INTO t OUTPUT INSERTED.* VALUES (1)"));
    }
}
