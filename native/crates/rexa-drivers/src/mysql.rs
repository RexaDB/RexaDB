//! Port of `lib/db/mysql-client.ts` (+ `mysql-referenced-record.ts`).
//!
//! Text protocol (`query_iter`) so values render as the server prints them;
//! binary-charset columns (BLOB/BINARY) render as hex like the original's
//! `Buffer → hex`. SSL: `sslmode`/`ssl` other than disable/false/0/off,
//! `sslaccept=…` (PlanetScale) or `ssl-mode=REQUIRED` → TLS with
//! certificate verification (`rejectUnauthorized: true`). SSH tunnels via
//! `rexadb_ssh_*` params.

use crate::*;
use anyhow::Context;
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::*;
use mysql_async::{Column, Opts, OptsBuilder, Pool, SslOpts, Value as MyValue};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

pub struct MySqlDriver {
    pool: Pool,
    running: Mutex<HashMap<String, u32>>,
    _tunnel: Option<crate::ssh::Tunnel>,
}

/// `normalizeMysqlConnectionString`: `mysql:/x` → `mysql://x`, bare
/// `user@host:3306/db` → `mysql://…`, `mariadb://` → `mysql://`.
pub(crate) fn normalize(cs: &str) -> String {
    let input = cs.trim();
    let lower = input.to_ascii_lowercase();
    let mut out = input.to_string();
    for scheme in ["mysql:/", "mariadb:/"] {
        if lower.starts_with(scheme) && !lower[scheme.len()..].starts_with('/') {
            out = format!("{}/{}", &input[..scheme.len()], &input[scheme.len()..]);
        }
    }
    if !out.contains("://") && !out.is_empty() {
        out = format!("mysql://{out}");
    }
    if out.to_ascii_lowercase().starts_with("mariadb://") {
        out = format!("mysql://{}", &out["mariadb://".len()..]);
    }
    out
}

/// Split TLS intent off the URL; keep only params mysql_async understands.
pub(crate) fn parse(cs: &str) -> Result<(String, bool)> {
    let mut url = url::Url::parse(&normalize(cs)).context("invalid MySQL connection string")?;
    let mut tls = false;
    let mut kept = Vec::new();
    for (k, v) in url.query_pairs() {
        let lv = v.to_ascii_lowercase();
        match k.as_ref() {
            "sslmode" | "ssl" => tls |= !lv.is_empty() && !["disable", "disabled", "false", "0", "off"].contains(&lv.as_str()),
            "sslaccept" => tls = true,
            "ssl-mode" => tls |= lv != "disabled",
            "socket" | "prefer_socket" | "compression" | "tcp_keepalive" | "stmt_cache_size" | "pool_min" | "pool_max"
            | "conn_ttl" | "require_secure_transport" => kept.push((k.into_owned(), v.into_owned())),
            _ => {}
        }
    }
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    Ok((url.to_string(), tls))
}

impl MySqlDriver {
    pub async fn connect(connection_string: &str, opts: &ConnectOptions) -> Result<Self> {
        let (cs, tunnel) = crate::ssh::start_if_needed(&normalize(connection_string), 3306).await?;
        let (base, tls) = parse(&cs)?;
        let mut b = OptsBuilder::from_opts(Opts::from_url(&base).context("invalid MySQL connection string")?);
        if tls {
            b = b.ssl_opts(SslOpts::default());
        }
        let mut init = Vec::new();
        if opts.read_only {
            init.push("SET SESSION TRANSACTION READ ONLY".to_string());
        }
        if let Some(t) = opts.statement_timeout {
            init.push(format!("SET SESSION max_execution_time = {}", t.as_millis()));
        }
        if !init.is_empty() {
            b = b.init(init);
        }
        let pool = Pool::new(b);
        let mut conn = tokio::time::timeout(Duration::from_secs(15), pool.get_conn())
            .await
            .map_err(|_| anyhow::anyhow!("connect ETIMEDOUT"))?
            .context("connecting to MySQL")?;
        conn.ping().await?;
        drop(conn);
        Ok(Self { pool, running: Mutex::new(HashMap::new()), _tunnel: tunnel })
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Record>> {
        Ok(self.execute(sql, usize::MAX).await?.records())
    }
}

/// `MYSQL_TYPE_LONG` → `long` (mysql2's `Types` names, lowercased).
fn type_name(c: &Column) -> String {
    format!("{:?}", c.column_type()).trim_start_matches("MYSQL_TYPE_").to_ascii_lowercase()
}

fn is_binary(c: &Column) -> bool {
    c.character_set() == 63
        && c.flags().contains(ColumnFlags::BINARY_FLAG)
        && matches!(
            c.column_type(),
            ColumnType::MYSQL_TYPE_BLOB
                | ColumnType::MYSQL_TYPE_TINY_BLOB
                | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
                | ColumnType::MYSQL_TYPE_LONG_BLOB
                | ColumnType::MYSQL_TYPE_STRING
                | ColumnType::MYSQL_TYPE_VAR_STRING
                | ColumnType::MYSQL_TYPE_VARCHAR
                | ColumnType::MYSQL_TYPE_GEOMETRY
        )
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn cell(value: MyValue, binary: bool) -> Cell {
    match value {
        MyValue::NULL => Cell::Null,
        MyValue::Bytes(b) if binary => Cell::Text(hex(&b)),
        MyValue::Bytes(b) => Cell::Text(match String::from_utf8(b) {
            Ok(s) => s,
            Err(e) => hex(e.as_bytes()),
        }),
        MyValue::Int(i) => Cell::Text(i.to_string()),
        MyValue::UInt(u) => Cell::Text(u.to_string()),
        MyValue::Float(f) => Cell::Text(f.to_string()),
        MyValue::Double(f) => Cell::Text(f.to_string()),
        other => Cell::Text(other.as_sql(true).trim_matches('\'').to_string()),
    }
}

async fn run(conn: &mut mysql_async::Conn, sql: &str, row_limit: usize) -> Result<Vec<QueryResult>> {
    let mut stream = conn.query_iter(sql).await?;
    let mut out = Vec::new();
    loop {
        let cols = stream.columns();
        let (columns, types, binary): (Vec<String>, Vec<ColumnMeta>, Vec<bool>) = match cols.as_deref() {
            Some(cols) => (
                cols.iter().map(|c| c.name_str().into_owned()).collect(),
                cols.iter()
                    .map(|c| {
                        let mut m = ColumnMeta::new(c.name_str().into_owned(), type_name(c)).with_id(c.column_type() as u32);
                        if is_binary(c) {
                            m.category = TypeCategory::Binary;
                        }
                        m
                    })
                    .collect(),
                cols.iter().map(is_binary).collect(),
            ),
            None => Default::default(),
        };
        let mut current = QueryResult { columns, column_types: types, ..Default::default() };
        while let Some(row) = stream.next().await? {
            if current.rows.len() >= row_limit {
                current.truncated = true;
                continue;
            }
            current.rows.push(row.unwrap().into_iter().enumerate().map(|(i, v)| cell(v, binary.get(i).copied().unwrap_or(false))).collect());
        }
        if current.columns.is_empty() {
            current.affected = Some(stream.affected_rows());
        }
        out.push(current);
        if stream.is_empty() {
            break;
        }
    }
    Ok(out)
}

fn lit(s: &str) -> String {
    Dialect::MySql.quote_str(s)
}

fn yes(r: &Record, k: &str) -> bool {
    r.get(k).is_some_and(|v| v.eq_ignore_ascii_case("YES") || crate::records::parse_bool(v))
}

#[async_trait]
impl Driver for MySqlDriver {
    fn kind(&self) -> Kind {
        Kind::MySql
    }

    fn quote_ident(&self, ident: &str) -> String {
        Dialect::MySql.quote_ident(ident)
    }

    /// `getSchemas`: `SHOW DATABASES` (falls back to information_schema).
    async fn schemas(&self) -> Result<Vec<String>> {
        if let Ok(r) = self.execute("SHOW DATABASES", usize::MAX).await {
            let names: Vec<String> = r.first_column().into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            if !names.is_empty() {
                return Ok(names);
            }
        }
        Ok(self.execute("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name", usize::MAX).await?.first_column())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        self.schemas().await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let sql = format!(
            "SELECT table_name AS name, table_type = 'VIEW' AS is_view FROM information_schema.tables
             WHERE table_schema = {} ORDER BY table_name",
            lit(schema)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| TableRef { schema: schema.to_string(), name: r.string("name"), is_view: r.bool("is_view") })
            .collect())
    }

    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let sql = format!(
            "SELECT table_name AS name, table_type, table_rows, data_length, index_length, table_comment
             FROM information_schema.tables WHERE table_schema = {} ORDER BY table_name",
            lit(schema)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| {
                let data = r.i64("data_length");
                TableInfo {
                    schema: schema.to_string(),
                    name: r.string("name"),
                    kind: if r.get("table_type") == Some("VIEW") { TableKind::View } else { TableKind::Table },
                    row_estimate: r.i64("table_rows"),
                    total_bytes: data.map(|d| d + r.i64("index_length").unwrap_or(0)),
                    data_bytes: data,
                    comment: r.non_empty("table_comment"),
                    rls_enabled: None,
                }
            })
            .collect())
    }

    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        let sql = format!("SELECT table_name AS name FROM information_schema.views WHERE table_schema = {} ORDER BY table_name", lit(schema));
        Ok(self.execute(&sql, usize::MAX).await?.first_column())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;
        let mut r = run(&mut conn, sql, row_limit).await?.pop().unwrap_or_default();
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn execute_readonly(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let mut conn=self.pool.get_conn().await?;
        conn.query_drop("START TRANSACTION READ ONLY").await?;
        let result=run(&mut conn,sql,row_limit).await;
        let rollback=conn.query_drop("ROLLBACK").await;
        match (result,rollback){(Ok(mut values),Ok(()))=>Ok(values.pop().unwrap_or_default()),(Err(error),_)=>Err(error.into()),(Ok(_),Err(error))=>Err(error.into())}
    }

    async fn execute_script(&self, sql: &str, row_limit: usize) -> Result<ScriptResult> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;
        let mut out = ScriptResult::default();
        for (i, stmt) in split::split_statements(sql, Dialect::MySql).into_iter().enumerate() {
            let t = Instant::now();
            match run(&mut conn, &stmt, row_limit).await {
                Ok(mut rs) => {
                    let mut r = rs.pop().unwrap_or_default();
                    r.elapsed = t.elapsed();
                    out.results.push(r);
                }
                Err(e) => {
                    out.error = Some(ScriptError { statement_index: i, statement: stmt, message: e.to_string() });
                    break;
                }
            }
        }
        out.elapsed = started.elapsed();
        Ok(out)
    }

    async fn execute_cancellable(&self, sql: &str, row_limit: usize, query_id: &str) -> Result<QueryResult> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;
        let id = query_id.trim().to_string();
        if !id.is_empty() {
            self.running.lock().unwrap().insert(id.clone(), conn.id());
        }
        let r = run(&mut conn, sql, row_limit).await;
        if !id.is_empty() {
            self.running.lock().unwrap().remove(&id);
        }
        let mut r = r?.pop().unwrap_or_default();
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        let thread = self.running.lock().unwrap().get(query_id.trim()).copied();
        match thread {
            Some(id) => {
                let mut conn = self.pool.get_conn().await?;
                conn.query_drop(format!("KILL QUERY {id}")).await?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let mut conn = self.pool.get_conn().await?;
        conn.query_drop("START TRANSACTION").await?;
        let mut out = Vec::new();
        for s in statements {
            match run(&mut conn, s, usize::MAX).await {
                Ok(mut r) => out.push(r.pop().unwrap_or_default()),
                Err(e) => {
                    let _ = conn.query_drop("ROLLBACK").await;
                    return Err(e);
                }
            }
        }
        conn.query_drop("COMMIT").await?;
        Ok(out)
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let sql = format!(
            "SELECT c.column_name AS column_name, c.data_type AS data_type, c.column_type AS column_type,
                    c.is_nullable AS is_nullable, c.column_default AS column_default,
                    c.character_maximum_length AS character_maximum_length, c.numeric_precision AS numeric_precision,
                    c.numeric_scale AS numeric_scale, c.extra AS extra, c.column_comment AS column_comment,
                    c.column_key AS column_key, c.ordinal_position AS ordinal_position,
                    c.generation_expression AS generation_expression,
                    EXISTS (SELECT 1 FROM information_schema.key_column_usage fk
                            WHERE fk.table_schema = c.table_schema AND fk.table_name = c.table_name
                              AND fk.column_name = c.column_name AND fk.referenced_table_name IS NOT NULL) AS is_foreign_key
             FROM information_schema.columns c
             WHERE c.table_schema = {} AND c.table_name = {}
             ORDER BY c.ordinal_position",
            lit(&t.schema),
            lit(&t.name)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| {
                let extra = r.string("extra");
                let column_type = r.string("column_type");
                ColumnDetail {
                    column_name: r.string("column_name"),
                    data_type: r.string("data_type"),
                    is_enum: column_type.starts_with("enum("),
                    full_type: column_type,
                    is_nullable: yes(&r, "is_nullable"),
                    column_default: r.opt("column_default"),
                    character_maximum_length: r.i64("character_maximum_length"),
                    numeric_precision: r.i64("numeric_precision"),
                    numeric_scale: r.i64("numeric_scale"),
                    is_primary_key: r.get("column_key") == Some("PRI"),
                    is_unique: r.get("column_key") == Some("UNI"),
                    is_foreign_key: r.bool("is_foreign_key"),
                    is_identity: extra.to_ascii_lowercase().contains("auto_increment"),
                    generation_expression: r.non_empty("generation_expression"),
                    extra: (!extra.is_empty()).then_some(extra),
                    comment: r.non_empty("column_comment"),
                    ordinal_position: r.i64("ordinal_position").unwrap_or(0),
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        let sql = format!(
            "SELECT column_name AS name FROM information_schema.key_column_usage
             WHERE table_schema = {} AND table_name = {} AND constraint_name = 'PRIMARY' ORDER BY ordinal_position",
            lit(&t.schema),
            lit(&t.name)
        );
        Ok(self.execute(&sql, usize::MAX).await?.first_column())
    }

    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        let sql = format!(
            "SELECT kcu.column_name AS column_name, kcu.referenced_table_schema AS foreign_table_schema,
                    kcu.referenced_table_name AS foreign_table_name, kcu.referenced_column_name AS foreign_column_name,
                    kcu.constraint_name AS constraint_name, rc.update_rule AS on_update, rc.delete_rule AS on_delete
             FROM information_schema.key_column_usage kcu
             LEFT JOIN information_schema.referential_constraints rc
               ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name
             WHERE kcu.table_schema = {} AND kcu.table_name = {} AND kcu.referenced_table_name IS NOT NULL
             ORDER BY kcu.constraint_name, kcu.ordinal_position",
            lit(&t.schema),
            lit(&t.name)
        );
        Ok(self
            .rows(&sql)
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
        let filter = match schema {
            Some(s) => format!("cols.table_schema = {}", lit(s)),
            None => "cols.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')".into(),
        };
        let sql = format!(
            "SELECT cols.table_schema AS table_schema, cols.table_name AS table_name, cols.column_name AS column_name,
                    cols.data_type AS data_type, cols.is_nullable AS is_nullable, cols.column_default AS column_default,
                    (cols.column_key = 'PRI') AS is_primary, kcu.referenced_table_schema AS referenced_table_schema,
                    kcu.referenced_table_name AS referenced_table_name, kcu.referenced_column_name AS referenced_column_name
             FROM information_schema.columns cols
             LEFT JOIN information_schema.key_column_usage kcu
               ON cols.table_schema = kcu.table_schema AND cols.table_name = kcu.table_name
              AND cols.column_name = kcu.column_name AND kcu.referenced_table_name IS NOT NULL
             WHERE {filter}
             ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position"
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| SchemaColumn {
                table_schema: r.string("table_schema"),
                table_name: r.string("table_name"),
                column_name: r.string("column_name"),
                data_type: r.string("data_type"),
                is_nullable: yes(&r, "is_nullable"),
                column_default: r.opt("column_default"),
                is_primary: r.bool("is_primary"),
                referenced_table_schema: r.opt("referenced_table_schema"),
                referenced_table_name: r.opt("referenced_table_name"),
                referenced_column_name: r.opt("referenced_column_name"),
            })
            .filter(|c| !c.table_schema.is_empty() && !c.table_name.is_empty() && !c.column_name.is_empty())
            .collect())
    }

    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        let filter = match schema {
            Some(s) => format!("table_schema = {}", lit(s)),
            None => "table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')".into(),
        };
        let sql = format!(
            "SELECT table_schema, table_name, index_name, non_unique, column_name, index_type
             FROM information_schema.statistics WHERE {filter}
             ORDER BY table_schema, table_name, index_name, seq_in_index"
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let (schema, table, name) = (r.string("table_schema"), r.string("table_name"), r.string("index_name"));
            let col = r.string("column_name");
            if let Some(i) = out.iter_mut().find(|i| i.schema == schema && i.table_name == table && i.name == name) {
                i.columns.push(col);
                continue;
            }
            out.push(IndexInfo {
                is_unique: r.get("non_unique") == Some("0"),
                is_primary: name == "PRIMARY",
                method: r.opt("index_type"),
                columns: vec![col],
                schema,
                table_name: table,
                name,
                definition: String::new(),
            });
        }
        for i in &mut out {
            let cols: Vec<String> = i.columns.iter().map(|c| Dialect::MySql.quote_ident(c)).collect();
            i.definition = format!(
                "CREATE {}INDEX {} ON {} ({})",
                if i.is_unique { "UNIQUE " } else { "" },
                Dialect::MySql.quote_ident(&i.name),
                Dialect::MySql.table_ref(&i.schema, &i.table_name),
                cols.join(", ")
            );
        }
        Ok(out)
    }

    async fn constraints(&self, t: &TableRef) -> Result<Vec<ConstraintInfo>> {
        let sql = format!(
            "SELECT tc.constraint_name AS name, tc.constraint_type AS type, kcu.column_name AS column_name
             FROM information_schema.table_constraints tc
             LEFT JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
              AND kcu.table_name = tc.table_name
             WHERE tc.table_schema = {} AND tc.table_name = {}
             ORDER BY tc.constraint_name, kcu.ordinal_position",
            lit(&t.schema),
            lit(&t.name)
        );
        let mut out: Vec<ConstraintInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let name = r.string("name");
            let col = r.opt("column_name");
            if let Some(c) = out.iter_mut().find(|c| c.name == name) {
                c.columns.extend(col);
                continue;
            }
            out.push(ConstraintInfo { name, constraint_type: ConstraintType::parse(r.get("type").unwrap_or("")), columns: col.into_iter().collect(), definition: None });
        }
        if let Ok(checks) = self
            .rows(&format!(
                "SELECT constraint_name AS name, check_clause FROM information_schema.check_constraints WHERE constraint_schema = {}",
                lit(&t.schema)
            ))
            .await
        {
            for r in checks {
                if let Some(c) = out.iter_mut().find(|c| c.name == r.string("name")) {
                    c.definition = r.opt("check_clause").map(|x| format!("CHECK ({x})"));
                }
            }
        }
        Ok(out)
    }

    /// `getRoutines`.
    async fn functions(&self, schema: &str) -> Result<Vec<RoutineInfo>> {
        let routines = self
            .rows(&format!(
                "SELECT ROUTINE_SCHEMA AS `schema`, ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS return_type,
                        ROUTINE_DEFINITION AS body, IS_DETERMINISTIC AS is_deterministic, SQL_DATA_ACCESS AS data_access,
                        ROUTINE_COMMENT AS comment, SECURITY_TYPE AS security_type, DEFINER AS owner
                 FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = {} ORDER BY ROUTINE_NAME",
                lit(schema)
            ))
            .await?;
        let mut args: HashMap<String, Vec<String>> = HashMap::new();
        if let Ok(params) = self
            .rows(&format!(
                "SELECT SPECIFIC_NAME AS routine_name, ROUTINE_TYPE AS routine_type, PARAMETER_MODE AS mode,
                        PARAMETER_NAME AS name, DTD_IDENTIFIER AS data_type
                 FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = {} AND ORDINAL_POSITION > 0
                 ORDER BY SPECIFIC_NAME, ORDINAL_POSITION",
                lit(schema)
            ))
            .await
        {
            for r in params {
                let kind = r.string("routine_type");
                let mode = if kind == "PROCEDURE" { r.opt("mode") } else { None };
                let arg = [mode, r.opt("name"), r.opt("data_type")].into_iter().flatten().collect::<Vec<_>>().join(" ");
                args.entry(format!("{kind}:{}", r.string("routine_name"))).or_default().push(arg);
            }
        }
        Ok(routines
            .into_iter()
            .map(|r| {
                let ty = r.string("type").to_ascii_uppercase();
                let name = r.string("name");
                let a = args.get(&format!("{ty}:{name}")).map(|v| v.join(", ")).unwrap_or_default();
                let ret = r.string("return_type");
                let returns = if ty == "FUNCTION" && !ret.is_empty() { format!(" RETURNS {ret}") } else { String::new() };
                let mut characteristics =
                    vec![if r.get("is_deterministic") == Some("YES") { "DETERMINISTIC".to_string() } else { "NOT DETERMINISTIC".to_string() }];
                characteristics.extend(r.non_empty("data_access"));
                characteristics.extend(r.non_empty("security_type").map(|s| format!("SQL SECURITY {s}")));
                characteristics.extend(r.non_empty("comment").map(|c| format!("COMMENT {}", lit(&c))));
                let definition = r.non_empty("body").map(|body| {
                    let mut lines = vec![format!("CREATE {ty} {}({a}){returns}", Dialect::MySql.quote_ident(&name))];
                    lines.extend(characteristics.iter().cloned());
                    lines.push(body);
                    lines.join("\n")
                });
                RoutineInfo {
                    schema: r.string("schema"),
                    return_type: if ty == "FUNCTION" { ret } else { String::new() },
                    language: "SQL".into(),
                    definition,
                    volatility: Some(characteristics[0].clone()),
                    security_definer: Some(r.get("security_type") == Some("DEFINER")),
                    owner: r.opt("owner"),
                    arguments: a,
                    r#type: ty,
                    name,
                    package_name: None,
                }
            })
            .collect())
    }

    /// `getTriggers` (needs a schema; the original returns [] without one).
    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        let Some(schema) = schema.filter(|s| !s.is_empty()) else { return Ok(Vec::new()) };
        let r = self
            .rows(&format!(
                "SELECT TRIGGER_SCHEMA AS `schema`, TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS table_name,
                        ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, ACTION_ORIENTATION AS orientation,
                        ACTION_STATEMENT AS statement
                 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = {} ORDER BY TRIGGER_NAME",
                lit(schema)
            ))
            .await?;
        Ok(r.into_iter()
            .map(|r| {
                let (name, table, timing, event, orientation) =
                    (r.string("name"), r.string("table_name"), r.string("timing"), r.string("event"), r.string("orientation"));
                let definition = format!(
                    "CREATE TRIGGER {} {timing} {event}\nON {} FOR EACH {orientation}\n{}",
                    Dialect::MySql.quote_ident(&name),
                    Dialect::MySql.quote_ident(&table),
                    r.string("statement")
                );
                TriggerInfo {
                    schema: r.string("schema"),
                    table_schema: Some(r.string("schema")),
                    table_name: Some(table),
                    events: vec![event.clone()],
                    event,
                    timing,
                    orientation,
                    function_name: String::new(),
                    enabled_mode: "ENABLED".into(),
                    definition: Some(definition),
                    full_definition: None,
                    name,
                }
            })
            .collect())
    }

    async fn sessions(&self) -> Result<QueryResult> {
        self.execute("SHOW FULL PROCESSLIST", usize::MAX).await
    }

    async fn kill_session(&self, pid: i64) -> Result<()> {
        self.execute(&format!("KILL {pid}"), 1).await.map(|_| ())
    }

    async fn cancel_session_query(&self, pid: i64) -> Result<()> {
        self.execute(&format!("KILL QUERY {pid}"), 1).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_strings() {
        assert_eq!(normalize("mysql:/u@h/d"), "mysql://u@h/d");
        assert_eq!(normalize("u:p@h:3306/d"), "mysql://u:p@h:3306/d");
        assert_eq!(normalize("mariadb://u@h/d"), "mysql://u@h/d");
        assert_eq!(parse("mysql://u@h/d?sslaccept=strict&x=1").unwrap(), ("mysql://u@h/d".into(), true));
        assert_eq!(parse("mysql://u@h/d?ssl=false").unwrap(), ("mysql://u@h/d".into(), false));
        assert_eq!(parse("mysql://u@h/d?sslmode=require").unwrap().1, true);
    }
}
