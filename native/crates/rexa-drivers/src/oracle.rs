//! Port of `lib/db/oracle-client.ts`, `oracle-connection.ts` and
//! `oracle-bridge-manager.ts`: Oracle through the existing Rust thin-driver
//! bridge binary `rexadb-oracle-bridge` (JSON lines over stdio, same
//! protocol as the JDBC bridge — `bridge.rs`). The binary is looked up in
//! `$REXADB_ORACLE_BRIDGE`, `$RESOURCEDIR[/bin|/oracle-bridge]`, next to the
//! executable / in the app bundle, and the repo's
//! `src-tauri/oracle-bridge/target/{debug,release}`.
//!
//! Connection strings: `oracle://user:pass@host:1521/SERVICE?sslmode=disable`
//! or `oracle://user:pass@host:1521/?sid=ORCL` (SID mode).

use crate::bridge::{self, BridgeSlot, Session};
use crate::*;
use serde_json::{json, Value as J};
use std::path::PathBuf;
use tokio::sync::Mutex as AsyncMutex;

static BRIDGE: BridgeSlot = BridgeSlot::new();

/// `OracleConnectionParts`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OracleParts {
    pub host: String,
    pub port: String,
    pub username: String,
    pub password: String,
    /// SID mode (`?sid=`) instead of service name.
    pub sid_mode: bool,
    pub target: String,
    pub ssl_mode: String,
}

impl Default for OracleParts {
    fn default() -> Self {
        OracleParts {
            host: "localhost".into(),
            port: "1521".into(),
            username: String::new(),
            password: String::new(),
            sid_mode: false,
            target: String::new(),
            ssl_mode: "disable".into(),
        }
    }
}

/// `parseOracleConnectionString`
pub fn parse_oracle_connection_string(cs: &str) -> OracleParts {
    let t = cs.trim();
    if t.is_empty() {
        return OracleParts::default();
    }
    let parseable = if t.len() >= 7 && t[..7].eq_ignore_ascii_case("oracle:") { format!("http:{}", &t[7..]) } else { t.to_string() };
    let Ok(u) = url::Url::parse(&parseable) else { return OracleParts::default() };
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.trim().to_string()).filter(|v| !v.is_empty());
    let sid = get("sid");
    let path_target = crate::detect::percent_decode(u.path().trim_start_matches('/')).trim().to_string();
    let d = OracleParts::default();
    OracleParts {
        host: u.host_str().filter(|h| !h.is_empty()).map_or(d.host, str::to_string),
        port: u.port().map_or(d.port, |p| p.to_string()),
        username: crate::detect::percent_decode(u.username()),
        password: u.password().map(crate::detect::percent_decode).unwrap_or_default(),
        sid_mode: sid.is_some(),
        target: sid.unwrap_or(path_target),
        ssl_mode: get("sslmode").or_else(|| get("ssl")).map(|s| s.to_ascii_lowercase()).unwrap_or(d.ssl_mode),
    }
}

/// `buildOracleConnectionString`
pub fn build_oracle_connection_string(p: &OracleParts) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    let host = if p.host.trim().is_empty() { "localhost" } else { p.host.trim() };
    let port = if p.port.trim().is_empty() { "1521" } else { p.port.trim() };
    let auth = if p.username.trim().is_empty() {
        String::new()
    } else if p.password.is_empty() {
        format!("{}@", enc(p.username.trim()))
    } else {
        format!("{}:{}@", enc(p.username.trim()), enc(&p.password))
    };
    let ssl = if p.ssl_mode.trim().is_empty() { "disable".to_string() } else { p.ssl_mode.trim().to_ascii_lowercase() };
    if p.sid_mode {
        let sid = if p.target.trim().is_empty() { String::new() } else { format!("&sid={}", enc(p.target.trim())) };
        return format!("oracle://{auth}{host}:{port}/?sslmode={ssl}{sid}");
    }
    let path = if p.target.trim().is_empty() { "/".to_string() } else { format!("/{}", enc(p.target.trim())) };
    format!("oracle://{auth}{host}:{port}{path}?sslmode={ssl}")
}

fn check(value: &str, label: &str, extra: &str) -> Result<String> {
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c) || extra.contains(c)) {
        bail!("Invalid Oracle {label}: {value:?}");
    }
    Ok(value.to_string())
}

/// `buildOracleNetConnectString`: Easy Connect for service names, a
/// connect descriptor for SIDs; `tcps` when SSL is on. Values are validated
/// so they can't break out of the descriptor.
pub fn build_net_connect_string(p: &OracleParts) -> Result<String> {
    let host = check(if p.host.trim().is_empty() { "localhost" } else { p.host.trim() }, "host", ":$[]")?;
    let port = p.port.trim();
    let port = if port.is_empty() { "1521".to_string() } else if port.chars().all(|c| c.is_ascii_digit()) { port.to_string() } else { bail!("Invalid Oracle port: {port:?}") };
    let target = p.target.trim();
    let ssl = !["disable", "false", "off", "0", ""].contains(&p.ssl_mode.to_ascii_lowercase().as_str());
    let proto = if ssl { "tcps" } else { "tcp" };
    if p.sid_mode {
        if target.is_empty() {
            bail!("Oracle SID is required when connect mode is SID.");
        }
        let sid = check(target, "SID", "#$")?;
        return Ok(format!("(DESCRIPTION=(ADDRESS=(PROTOCOL={proto})(HOST={host})(PORT={port}))(CONNECT_DATA=(SID={sid})))"));
    }
    if target.is_empty() {
        bail!("Oracle service name is required when connect mode is Service Name.");
    }
    let svc = check(target, "service name", "#$")?;
    Ok(if ssl { format!("{proto}://{host}:{port}/{svc}") } else { format!("{host}:{port}/{svc}") })
}

fn locate() -> Result<(PathBuf, Vec<String>)> {
    let name = if cfg!(windows) { "rexadb-oracle-bridge.exe" } else { "rexadb-oracle-bridge" };
    let mut candidates: Vec<PathBuf> = std::env::var("REXADB_ORACLE_BRIDGE").ok().map(PathBuf::from).into_iter().collect();
    for d in bridge::resource_dirs() {
        candidates.extend([d.join(name), d.join("bin").join(name), d.join("oracle-bridge").join(name)]);
    }
    if let Ok(cwd) = std::env::current_dir() {
        for up in [cwd.clone(), cwd.join(".."), cwd.join("../..")] {
            for p in ["src-tauri/oracle-bridge/target/release", "src-tauri/oracle-bridge/target/debug", "src-tauri/binaries"] {
                candidates.push(up.join(p).join(name));
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| (p, Vec::new()))
        .ok_or_else(|| anyhow::anyhow!("rexadb-oracle-bridge not found. Build it with: cargo build --manifest-path src-tauri/oracle-bridge/Cargo.toml"))
}

pub struct OracleDriver {
    config: J,
    username: String,
    session: AsyncMutex<Option<Session>>,
}

fn esc(s: &str) -> String {
    s.replace('\'', "''")
}

impl OracleDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let parts = parse_oracle_connection_string(cs);
        let config = json!({ "connectString": build_net_connect_string(&parts)?, "username": parts.username, "password": parts.password });
        let d = OracleDriver { config, username: parts.username.to_uppercase(), session: AsyncMutex::new(None) };
        d.call("schemas", json!({})).await?;
        Ok(d)
    }

    async fn call(&self, action: &str, extra: J) -> Result<J> {
        let mut g = self.session.lock().await;
        for attempt in 0..2 {
            if g.as_ref().is_none_or(|s| !s.bridge.is_alive()) {
                let b = BRIDGE.get("Oracle bridge", locate).await?;
                *g = Some(Session::open(b, self.config.clone()).await?);
            }
            match g.as_ref().unwrap().call(action, extra.clone()).await {
                Ok(v) => return Ok(v),
                Err(_) if attempt == 0 && !g.as_ref().unwrap().bridge.is_alive() => *g = None,
                Err(e) => return Err(e),
            }
        }
        unreachable!()
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Record>> {
        Ok(self.execute(sql, usize::MAX).await?.records())
    }

    async fn tables_detailed(&self, schema: &str) -> Result<Vec<(String, String)>> {
        let data = self.call("tables", json!({ "schema": schema })).await?;
        Ok(bridge::rows(&data).iter().map(|r| (bridge::col(r, 0), bridge::col(r, 1))).collect())
    }

    /// `getObjectSource` (ALL_SOURCE text).
    #[allow(dead_code)]
    pub async fn object_source(&self, schema: &str, name: &str, ty: &str) -> Result<Option<String>> {
        let r = self
            .rows(&format!("SELECT text FROM all_source WHERE owner = '{}' AND name = '{}' AND type = '{}' ORDER BY line", esc(schema), esc(name), esc(ty)))
            .await?;
        Ok((!r.is_empty()).then(|| r.iter().map(|x| x.string("text")).collect()))
    }
}

#[async_trait]
impl Driver for OracleDriver {
    fn kind(&self) -> Kind {
        Kind::Oracle
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(bridge::rows(&self.call("schemas", json!({})).await?).iter().map(|r| bridge::col(r, 0)).collect())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        self.schemas().await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let mut out: Vec<TableRef> = self
            .tables_detailed(schema)
            .await?
            .into_iter()
            .filter(|(_, t)| t == "TABLE" || t == "VIEW")
            .map(|(name, t)| TableRef { schema: schema.to_string(), name, is_view: t == "VIEW" })
            .collect();
        if let Ok(mv) = self.materialized_views(schema).await {
            for m in mv {
                if !out.iter().any(|t| t.name.eq_ignore_ascii_case(&m.name)) {
                    out.push(TableRef { schema: schema.to_string(), name: m.name, is_view: true });
                }
            }
        }
        out.sort();
        Ok(out)
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        self.execute_params(sql, &[], row_limit).await
    }

    /// The Oracle bridge binds positional `?` parameters natively.
    async fn execute_params(&self, sql: &str, params: &[Value], row_limit: usize) -> Result<QueryResult> {
        let started = std::time::Instant::now();
        let params: Vec<J> = params.iter().map(Value::to_json).collect();
        let sql = sql.trim().trim_end_matches(';');
        let data = self.call("query", json!({ "sql": sql, "params": params })).await?;
        let mut r = bridge::to_result(&data, row_limit);
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn execute_script(&self, sql: &str, row_limit: usize) -> Result<ScriptResult> {
        let started = std::time::Instant::now();
        let mut out = ScriptResult::default();
        for (i, s) in split::split_statements(sql, Dialect::Oracle).into_iter().enumerate() {
            match self.execute(&s, row_limit).await {
                Ok(r) => out.results.push(r),
                Err(e) => {
                    out.error = Some(ScriptError { statement_index: i, statement: s, message: e.to_string() });
                    break;
                }
            }
        }
        out.elapsed = started.elapsed();
        Ok(out)
    }

    async fn explain(&self, query: &str, _analyze: bool) -> Result<ExplainResult> {
        let plan_query = explain_sql(Kind::Oracle, query, false);
        self.execute(&plan_query, 1).await?;
        let result = self.execute("SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY())", usize::MAX).await?;
        Ok(ExplainResult { result, plan_query })
    }

    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        Ok(self.tables(schema).await?.into_iter().filter(|t| t.is_view).map(|t| t.name).collect())
    }

    /// `getTableStructure`: bridge structure + PK/FK flags from the dictionary.
    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let data = self.call("structure", json!({ "schema": t.schema, "table": t.name })).await?;
        let pk = self.primary_key(t).await.unwrap_or_default();
        let fk: Vec<String> = self.foreign_keys(t).await.unwrap_or_default().into_iter().map(|f| f.column_name).collect();
        Ok(bridge::rows(&data)
            .iter()
            .map(|r| {
                let name = bridge::col(r, 0);
                let ty = bridge::col(r, 1);
                ColumnDetail {
                    is_primary_key: pk.contains(&name),
                    is_foreign_key: fk.contains(&name),
                    full_type: ty.clone(),
                    data_type: ty,
                    character_maximum_length: bridge::col(r, 2).parse().ok().filter(|n: &i64| *n > 0),
                    is_nullable: r.get(3).cloned().flatten().is_some_and(|v| crate::records::parse_bool(&v)),
                    column_default: r.get(4).cloned().flatten().map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
                    ordinal_position: bridge::col(r, 5).parse().unwrap_or(0),
                    column_name: name,
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        Ok(self
            .execute(
                &format!(
                    "SELECT acc.column_name FROM all_constraints ac JOIN all_cons_columns acc
                     ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
                     WHERE ac.constraint_type = 'P' AND ac.owner = '{}' AND ac.table_name = '{}' ORDER BY acc.position",
                    esc(&t.schema),
                    esc(&t.name)
                ),
                usize::MAX,
            )
            .await?
            .first_column())
    }

    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        let data = self.call("foreign-keys", json!({ "schema": t.schema, "table": t.name })).await?;
        Ok(bridge::rows(&data)
            .iter()
            .map(|r| ForeignKey {
                column_name: bridge::col(r, 0),
                foreign_table_name: bridge::col(r, 1),
                foreign_table_schema: bridge::col(r, 2),
                foreign_column_name: bridge::col(r, 3),
                ..Default::default()
            })
            .collect())
    }

    /// `getAllTablesWithColumns`: per schema, per table (slow but faithful).
    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let schemas = match schema {
            Some(s) => vec![s.to_string()],
            None => self.schemas().await?,
        };
        let mut out = Vec::new();
        for s in schemas {
            for (name, _) in self.tables_detailed(&s).await? {
                let t = TableRef::new(&s, &name);
                let fks = self.foreign_keys(&t).await.unwrap_or_default();
                for c in self.table_structure(&t).await? {
                    let fk = fks.iter().find(|f| f.column_name == c.column_name);
                    out.push(SchemaColumn {
                        table_schema: s.clone(),
                        table_name: name.clone(),
                        data_type: c.data_type,
                        is_nullable: c.is_nullable,
                        is_primary: c.is_primary_key,
                        column_default: None,
                        referenced_table_schema: fk.map(|f| f.foreign_table_schema.clone()),
                        referenced_table_name: fk.map(|f| f.foreign_table_name.clone()),
                        referenced_column_name: fk.map(|f| f.foreign_column_name.clone()),
                        column_name: c.column_name,
                    });
                }
            }
        }
        Ok(out)
    }

    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        let filter = schema.map(|s| format!("AND i.owner = '{}'", esc(s))).unwrap_or_default();
        let rows = self
            .rows(&format!(
                "SELECT i.owner, i.index_name, i.table_name, i.uniqueness, c.column_name, c.column_position
                 FROM all_indexes i JOIN all_ind_columns c ON i.owner = c.index_owner AND i.index_name = c.index_name
                 WHERE i.index_type LIKE 'NORMAL%' AND i.owner NOT IN ('SYS','SYSTEM','XDB','CTXSYS','MDSYS','ORDDATA','WMSYS') {filter}
                 ORDER BY i.owner, i.index_name, c.column_position"
            ))
            .await?;
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in rows {
            let (owner, name, col) = (r.string("owner"), r.string("index_name"), r.string("column_name"));
            if owner.is_empty() || name.is_empty() {
                continue;
            }
            if let Some(i) = out.iter_mut().find(|i| i.schema == owner && i.name == name) {
                if !col.is_empty() && !i.columns.contains(&col) {
                    i.columns.push(col);
                }
                continue;
            }
            out.push(IndexInfo {
                is_unique: r.string("uniqueness").eq_ignore_ascii_case("UNIQUE"),
                table_name: r.string("table_name"),
                columns: if col.is_empty() { vec![] } else { vec![col] },
                schema: owner,
                name,
                ..Default::default()
            });
        }
        for i in &mut out {
            i.definition = format!("{}INDEX {}.{} ON {} ({})", if i.is_unique { "UNIQUE " } else { "" }, i.schema, i.name, i.table_name, i.columns.join(", "));
        }
        Ok(out)
    }

    /// `getRoutines`: standalone + package members, ALL_SOURCE definitions.
    async fn functions(&self, schema: &str) -> Result<Vec<RoutineInfo>> {
        let owner = esc(schema);
        let Ok(rows) = self
            .rows(&format!(
                "SELECT owner, object_name, procedure_name, object_type FROM all_procedures
                 WHERE owner = '{owner}' AND object_type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE')
                   AND ((object_type IN ('PROCEDURE', 'FUNCTION') AND procedure_name IS NULL)
                        OR (object_type = 'PACKAGE' AND procedure_name IS NOT NULL))
                 ORDER BY object_type, object_name, procedure_name"
            ))
            .await
        else {
            return Ok(Vec::new());
        };
        let mut out: Vec<RoutineInfo> = rows
            .into_iter()
            .filter(|r| !r.string("object_name").is_empty())
            .map(|r| {
                let (ot, on) = (r.string("object_type").to_uppercase(), r.string("object_name"));
                match (ot.as_str(), r.non_empty("procedure_name")) {
                    ("PACKAGE", Some(member)) => RoutineInfo {
                        schema: schema.to_string(),
                        name: format!("{on}.{member}"),
                        r#type: "FUNCTION".into(),
                        language: "PL/SQL".into(),
                        package_name: Some(on),
                        ..Default::default()
                    },
                    _ => RoutineInfo {
                        schema: schema.to_string(),
                        name: on,
                        r#type: if ot == "PROCEDURE" { "PROCEDURE".into() } else { "FUNCTION".into() },
                        language: "PL/SQL".into(),
                        ..Default::default()
                    },
                }
            })
            .collect();
        if let Ok(src) = self.rows(&format!("SELECT name, type, line, text FROM all_source WHERE owner = '{owner}' AND type IN ('PROCEDURE', 'FUNCTION') ORDER BY name, type, line")).await {
            let mut by: HashMap<String, String> = HashMap::new();
            for s in src {
                by.entry(format!("{}:{}", s.string("type"), s.string("name"))).or_default().push_str(&s.string("text"));
            }
            for r in out.iter_mut().filter(|r| r.package_name.is_none()) {
                r.definition = by.get(&format!("{}:{}", r.r#type, r.name)).cloned();
            }
        }
        Ok(out)
    }

    async fn packages(&self, schema: &str) -> Result<Vec<PackageInfo>> {
        let owner = esc(schema);
        let mut pkgs: Vec<PackageInfo> = self
            .rows(&format!("SELECT object_name, status FROM all_objects WHERE owner = '{owner}' AND object_type = 'PACKAGE' ORDER BY object_name"))
            .await?
            .into_iter()
            .map(|r| PackageInfo { schema: schema.to_string(), name: r.string("object_name"), status: r.non_empty("status").unwrap_or_else(|| "VALID".into()), definition: None })
            .filter(|p| !p.name.is_empty())
            .collect();
        if let Ok(src) = self.rows(&format!("SELECT name, line, text FROM all_source WHERE owner = '{owner}' AND type = 'PACKAGE' ORDER BY name, line")).await {
            let mut by: HashMap<String, String> = HashMap::new();
            for s in src {
                by.entry(s.string("name")).or_default().push_str(&s.string("text"));
            }
            for p in &mut pkgs {
                p.definition = by.get(&p.name).cloned();
            }
        }
        Ok(pkgs)
    }

    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        let filter = schema.map(|s| format!("AND owner = '{}'", esc(s))).unwrap_or_default();
        let rows = self
            .rows(&format!(
                "SELECT owner, trigger_name, table_owner, table_name, trigger_type, triggering_event, status, trigger_body
                 FROM all_triggers WHERE 1=1 {filter} AND owner NOT IN ('SYS','SYSTEM','XDB','CTXSYS','MDSYS') ORDER BY owner, trigger_name"
            ))
            .await?;
        Ok(rows
            .into_iter()
            .filter(|r| !r.string("trigger_name").is_empty())
            .map(|r| {
                let event = r.string("triggering_event");
                let tt = r.string("trigger_type").to_uppercase();
                let timing = if tt.contains("BEFORE") {
                    "BEFORE"
                } else if tt.contains("INSTEAD") {
                    "INSTEAD OF"
                } else {
                    "AFTER"
                };
                TriggerInfo {
                    schema: r.string("owner"),
                    name: r.string("trigger_name"),
                    table_schema: r.non_empty("table_owner"),
                    table_name: r.non_empty("table_name"),
                    timing: timing.into(),
                    events: regex::Regex::new(r"(?i) OR |,").unwrap().split(&event).map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect(),
                    event,
                    orientation: if tt.contains("ROW") { "ROW".into() } else { "STATEMENT".into() },
                    enabled_mode: r.non_empty("status").unwrap_or_else(|| "ENABLED".into()),
                    definition: r.non_empty("trigger_body"),
                    ..Default::default()
                }
            })
            .collect())
    }

    async fn sequences(&self, schema: &str) -> Result<Vec<SequenceInfo>> {
        Ok(self
            .rows(&format!(
                "SELECT sequence_owner, sequence_name, min_value, max_value, increment_by, last_number, cycle_flag, cache_size
                 FROM all_sequences WHERE sequence_owner = '{}' ORDER BY sequence_name",
                esc(schema)
            ))
            .await?
            .into_iter()
            .map(|r| SequenceInfo {
                schema: r.non_empty("sequence_owner").unwrap_or_else(|| schema.to_string()),
                name: r.string("sequence_name"),
                min_value: r.opt("min_value"),
                max_value: r.opt("max_value"),
                increment_by: r.opt("increment_by"),
                last_number: r.opt("last_number"),
                cache_size: r.opt("cache_size"),
                cycle_flag: r.string("cycle_flag").eq_ignore_ascii_case("Y"),
                ..Default::default()
            })
            .filter(|s| !s.name.is_empty())
            .collect())
    }

    async fn synonyms(&self, schema: &str) -> Result<Vec<SynonymInfo>> {
        Ok(self
            .rows(&format!("SELECT owner, synonym_name, table_owner, table_name, db_link FROM all_synonyms WHERE owner = '{}' ORDER BY synonym_name", esc(schema)))
            .await?
            .into_iter()
            .map(|r| SynonymInfo {
                schema: r.non_empty("owner").unwrap_or_else(|| schema.to_string()),
                name: r.string("synonym_name"),
                table_owner: r.string("table_owner"),
                table_name: r.string("table_name"),
                db_link: r.non_empty("db_link"),
            })
            .filter(|s| !s.name.is_empty())
            .collect())
    }

    async fn db_links(&self) -> Result<Vec<DbLinkInfo>> {
        if let Ok(r) = self.rows("SELECT owner, db_link, username, host FROM all_db_links ORDER BY owner, db_link").await {
            if !r.is_empty() {
                return Ok(r
                    .into_iter()
                    .map(|r| DbLinkInfo { owner: r.string("owner"), name: r.string("db_link"), username: r.non_empty("username"), host: r.non_empty("host") })
                    .filter(|l| !l.name.is_empty())
                    .collect());
            }
        }
        let user = if self.username.is_empty() { "USER".to_string() } else { self.username.clone() };
        Ok(self
            .rows("SELECT db_link, username, host FROM user_db_links ORDER BY db_link")
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|r| DbLinkInfo { owner: user.clone(), name: r.string("db_link"), username: r.non_empty("username"), host: r.non_empty("host") })
            .filter(|l| !l.name.is_empty())
            .collect())
    }

    async fn materialized_views(&self, schema: &str) -> Result<Vec<MaterializedViewInfo>> {
        Ok(self
            .rows(&format!(
                "SELECT owner, mview_name, refresh_mode, refresh_method, build_mode, last_refresh_date, staleness, compile_state, query
                 FROM all_mviews WHERE owner = '{}' ORDER BY mview_name",
                esc(schema)
            ))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|r| MaterializedViewInfo {
                schema: r.non_empty("owner").unwrap_or_else(|| schema.to_string()),
                name: r.string("mview_name"),
                refresh_mode: r.non_empty("refresh_mode"),
                refresh_method: r.non_empty("refresh_method"),
                build_mode: r.non_empty("build_mode"),
                last_refresh_date: r.opt("last_refresh_date"),
                staleness: r.non_empty("staleness"),
                compile_state: r.non_empty("compile_state"),
                query: r.non_empty("query"),
                is_populated: None,
            })
            .filter(|m| !m.name.is_empty())
            .collect())
    }
}

use std::collections::HashMap;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_strings() {
        let p = parse_oracle_connection_string("oracle://scott:ti%40ger@db:1522/ORCLPDB?sslmode=require");
        assert_eq!((p.username.as_str(), p.password.as_str(), p.port.as_str(), p.target.as_str(), p.sid_mode), ("scott", "ti@ger", "1522", "ORCLPDB", false));
        assert_eq!(build_net_connect_string(&p).unwrap(), "tcps://db:1522/ORCLPDB");
        let sid = parse_oracle_connection_string("oracle://u@h/?sid=XE");
        assert!(sid.sid_mode);
        assert_eq!(build_net_connect_string(&sid).unwrap(), "(DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=h)(PORT=1521))(CONNECT_DATA=(SID=XE)))");
        let evil = OracleParts { target: "X)(HOST=evil".into(), ..Default::default() };
        assert!(build_net_connect_string(&evil).is_err());
        assert_eq!(build_oracle_connection_string(&p), "oracle://scott:ti%40ger@db:1522/ORCLPDB?sslmode=require");
        assert_eq!(build_oracle_connection_string(&sid), "oracle://u@h:1521/?sslmode=disable&sid=XE");
        assert_eq!(crate::Kind::Oracle.default_schema("oracle://hr@h/x"), "HR");
    }
}
