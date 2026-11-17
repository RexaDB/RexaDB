//! Port of `lib/db/jdbc-client.ts` + `jdbc-bridge-manager.ts`: generic JDBC
//! through the existing Java bridge (`java -cp bridge.jar Bridge`, JSON
//! lines over stdio — see `bridge.rs`).
//!
//! Connection string: `jdbc://?jdbcUrl=…&driverClass=…&jarPaths=a.jar,b.jar&username=…&password=…`
//! (`buildJdbcConfig`). Java: the bundled `jre/bin/java` next to
//! `bridge.jar` when present, else `java` on PATH. `bridge.jar` is looked up
//! in `$REXADB_BRIDGE_JAR`, `$RESOURCEDIR`, the app bundle and the repo's
//! `resources/java-bridge/dist`. Without `jarPaths`, drivers are discovered
//! in `$REXADB_JDBC_DRIVERS_DIR` (`manifest.json` → `jar_paths`, else every jar).

use crate::bridge::{self, BridgeSlot, Session};
use crate::*;
use serde_json::{json, Value as J};
use std::path::{Path, PathBuf};
use tokio::sync::Mutex as AsyncMutex;

static BRIDGE: BridgeSlot = BridgeSlot::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JdbcConfig {
    pub jdbc_url: String,
    pub driver_class: String,
    pub jar_paths: Vec<String>,
    pub username: String,
    pub password: String,
}

/// `parseJdbcConnectionString`.
pub fn parse_jdbc_connection_string(cs: &str) -> Result<JdbcConfig> {
    let u = url::Url::parse(cs.trim()).map_err(|e| anyhow::anyhow!("Invalid JDBC connection string: {e}"))?;
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap_or_default();
    let cfg = JdbcConfig {
        jdbc_url: crate::detect::percent_decode(&get("jdbcUrl")),
        driver_class: get("driverClass"),
        jar_paths: get("jarPaths").split(',').filter(|s| !s.is_empty()).map(str::to_string).collect(),
        username: get("username"),
        password: get("password"),
    };
    if cfg.jdbc_url.is_empty() || cfg.driver_class.is_empty() {
        bail!("JDBC connection string must include jdbcUrl and driverClass parameters. Format: jdbc://?jdbcUrl=...&driverClass=...&jarPaths=...");
    }
    Ok(cfg)
}

/// `buildJdbcConfig`.
pub fn build_jdbc_connection_string(cfg: &JdbcConfig) -> String {
    let mut u = url::Url::parse("jdbc://").unwrap();
    u.query_pairs_mut()
        .append_pair("jdbcUrl", &cfg.jdbc_url)
        .append_pair("driverClass", &cfg.driver_class)
        .append_pair("jarPaths", &cfg.jar_paths.join(","))
        .append_pair("username", &cfg.username)
        .append_pair("password", &cfg.password);
    u.to_string()
}

fn walk_jars(dir: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_jars(&p, out);
        } else if p.extension().is_some_and(|x| x == "jar") {
            out.push(p.to_string_lossy().into_owned());
        }
    }
}

/// `resolveDriverJars`.
fn resolve_driver_jars(mut cfg: JdbcConfig) -> JdbcConfig {
    if !cfg.jar_paths.is_empty() {
        return cfg;
    }
    let Ok(dir) = std::env::var("REXADB_JDBC_DRIVERS_DIR") else { return cfg };
    let dir = PathBuf::from(dir);
    let mut found = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten().filter(|e| e.path().is_dir()) {
            let manifest = e.path().join("manifest.json");
            if let Ok(m) = std::fs::read_to_string(&manifest).map(|s| serde_json::from_str::<J>(&s).unwrap_or(J::Null)) {
                if m.get("driver_class").and_then(J::as_str) == Some(cfg.driver_class.as_str()) {
                    found.extend(m.get("jar_paths").and_then(J::as_array).into_iter().flatten().filter_map(J::as_str).filter(|p| Path::new(p).exists()).map(str::to_string));
                }
            }
            if !found.is_empty() {
                break;
            }
        }
    }
    if found.is_empty() {
        walk_jars(&dir, &mut found);
    }
    cfg.jar_paths = found;
    cfg
}

fn locate() -> Result<(PathBuf, Vec<String>)> {
    let jar = std::env::var("REXADB_BRIDGE_JAR")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .or_else(|| bridge::resource_dirs().into_iter().map(|d| d.join("bridge.jar")).find(|p| p.exists()))
        .ok_or_else(|| anyhow::anyhow!("bridge.jar not found. Run resources/java-bridge/build.sh first."))?;
    let jre = jar.parent().map(|d| d.join(if cfg!(windows) { "jre/bin/java.exe" } else { "jre/bin/java" }));
    let java = match jre {
        Some(j) if j.exists() && j.parent().and_then(|b| b.parent()).is_some_and(|r| r.join("lib/modules").exists()) => j,
        _ => PathBuf::from("java"),
    };
    Ok((java, vec!["-cp".into(), jar.to_string_lossy().into_owned(), "Bridge".into()]))
}

pub struct JdbcDriver {
    config: J,
    session: AsyncMutex<Option<Session>>,
}

impl JdbcDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let cfg = resolve_driver_jars(parse_jdbc_connection_string(cs)?);
        let config = json!({
            "jdbcUrl": cfg.jdbc_url, "driverClass": cfg.driver_class, "jarPaths": cfg.jar_paths,
            "username": cfg.username, "password": cfg.password,
        });
        let d = JdbcDriver { config, session: AsyncMutex::new(None) };
        d.call("schemas", json!({})).await?;
        Ok(d)
    }

    /// Run an action on the (lazily re-opened) session.
    async fn call(&self, action: &str, extra: J) -> Result<J> {
        let mut g = self.session.lock().await;
        for attempt in 0..2 {
            if g.as_ref().is_none_or(|s| !s.bridge.is_alive()) {
                let b = BRIDGE.get("JDBC bridge", locate).await?;
                *g = Some(Session::open(b, self.config.clone()).await?);
            }
            match g.as_ref().unwrap().call(action, extra.clone()).await {
                Ok(v) => return Ok(v),
                Err(e) if attempt == 0 && !g.as_ref().unwrap().bridge.is_alive() => {
                    let _ = e;
                    *g = None;
                }
                Err(e) => return Err(e),
            }
        }
        unreachable!()
    }

    async fn tables_raw(&self, schema: &str) -> Result<Vec<(String, String)>> {
        let data = self.call("tables", json!({ "schema": schema })).await?;
        Ok(bridge::rows(&data).iter().map(|r| (bridge::col(r, 0), bridge::col(r, 1))).collect())
    }
}

#[async_trait]
impl Driver for JdbcDriver {
    fn kind(&self) -> Kind {
        Kind::Jdbc
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(bridge::rows(&self.call("schemas", json!({})).await?).iter().map(|r| bridge::col(r, 0)).collect())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        self.schemas().await
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        Ok(self
            .tables_raw(schema)
            .await?
            .into_iter()
            .filter(|(_, t)| t == "TABLE" || t == "VIEW")
            .map(|(name, t)| TableRef { schema: schema.to_string(), name, is_view: t == "VIEW" })
            .collect())
    }

    /// The bridge takes no bind parameters; they are inlined.
    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = std::time::Instant::now();
        let data = self.call("query", json!({ "sql": sql })).await?;
        let mut r = bridge::to_result(&data, row_limit);
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let data = self.call("structure", json!({ "schema": t.schema, "table": t.name })).await?;
        Ok(bridge::rows(&data)
            .iter()
            .map(|r| {
                let ty = bridge::col(r, 1);
                let nullable = r.get(3).cloned().flatten().is_some_and(|v| crate::records::parse_bool(&v));
                ColumnDetail {
                    column_name: bridge::col(r, 0),
                    full_type: ty.clone(),
                    data_type: ty,
                    character_maximum_length: bridge::col(r, 2).parse().ok().filter(|n: &i64| *n > 0),
                    is_nullable: nullable,
                    column_default: r.get(4).cloned().flatten().filter(|d| !d.is_empty() && d != "null"),
                    ordinal_position: bridge::col(r, 5).parse().unwrap_or(0),
                    ..Default::default()
                }
            })
            .collect())
    }

    /// The original picks a column named `id` (or the first column).
    async fn primary_key(&self, t: &TableRef) -> Result<Vec<String>> {
        let cols = self.table_structure(t).await?;
        Ok(cols
            .iter()
            .find(|c| c.column_name.eq_ignore_ascii_case("id") || c.ordinal_position == 1)
            .map(|c| vec![c.column_name.clone()])
            .unwrap_or_default())
    }

    async fn foreign_keys(&self, t: &TableRef) -> Result<Vec<ForeignKey>> {
        let data = self.call("foreign-keys", json!({ "schema": t.schema, "table": t.name })).await?;
        Ok(bridge::rows(&data)
            .iter()
            .map(|r| ForeignKey {
                column_name: bridge::col(r, 0),
                foreign_table_name: bridge::col(r, 1),
                foreign_table_schema: r.get(2).cloned().flatten().filter(|s| !s.is_empty()).unwrap_or_else(|| t.schema.clone()),
                foreign_column_name: bridge::col(r, 3),
                ..Default::default()
            })
            .collect())
    }

    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        let schemas = match schema {
            Some(s) => vec![s.to_string()],
            None => self.schemas().await?,
        };
        let mut out = Vec::new();
        for s in schemas {
            for t in self.tables(&s).await?.into_iter().filter(|t| !t.is_view) {
                for c in self.table_structure(&t).await? {
                    out.push(SchemaColumn {
                        table_schema: s.clone(),
                        table_name: t.name.clone(),
                        column_name: c.column_name,
                        data_type: c.data_type,
                        is_nullable: c.is_nullable,
                        ..Default::default()
                    });
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_config() {
        let cfg = JdbcConfig {
            jdbc_url: "jdbc:postgresql://h:5432/db?ssl=true".into(),
            driver_class: "org.postgresql.Driver".into(),
            jar_paths: vec!["/a.jar".into(), "/b.jar".into()],
            username: "u".into(),
            password: "p&w".into(),
        };
        let cs = build_jdbc_connection_string(&cfg);
        assert!(cs.starts_with("jdbc://?jdbcUrl="));
        assert_eq!(parse_jdbc_connection_string(&cs).unwrap(), cfg);
        assert!(parse_jdbc_connection_string("jdbc://?jdbcUrl=x").is_err());
        assert_eq!(crate::Kind::detect("", &cs), Some(crate::Kind::Jdbc));
    }
}
