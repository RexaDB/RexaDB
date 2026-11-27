//! Port of the user-facing RexaDB MCP server: lib/agents/mcp/external-stdio.ts,
//! handlers.ts (`registerExternalTools`), registry.ts (exposed-connection
//! resolution), external-config.ts (`resolveMcpMode`) and audit-log.ts —
//! JSON-RPC over stdio, run as `rexadb --mcp`.
//!
//! Config is read on every call from `mcp_server_config` (Settings → MCP Server,
//! through `rexa_settings::mcp::load`), so changes apply without a restart.
//! Env overrides: REXADB_MCP_MODE, REXADB_MCP_EXPOSED_IDS. stdout carries only
//! JSON-RPC; logs go to stderr. Edge Function tools are not exposed yet.

use crate::db_tools::{self, DbCtx};
use crate::sql_guards::is_write_sql_for_audit;
use anyhow::{anyhow, bail, Result};
use rexa_drivers::Driver;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Debug, PartialEq)]
pub struct Mode {
    pub id: String,
    pub label: String,
    pub allow_read: bool,
    pub allow_write: bool,
}

/// `resolveMcpMode` over BUILTIN_APP_MODES + custom modes.
pub fn resolve_mode(config: &Value) -> Mode {
    let wanted = std::env::var("REXADB_MCP_MODE").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| config["modeId"].as_str().unwrap_or("rexadb-plan").to_string());
    let plan = Mode { id: "rexadb-plan".into(), label: "Plan".into(), allow_read: true, allow_write: false };
    let build = Mode { id: "rexadb-build".into(), label: "Build".into(), allow_read: true, allow_write: true };
    if wanted == build.id {
        return build;
    }
    for m in config["customModes"].as_array().into_iter().flatten() {
        if m["id"].as_str() == Some(wanted.as_str()) {
            return Mode {
                id: wanted.clone(),
                label: m["label"].as_str().unwrap_or(&wanted).to_string(),
                allow_read: m["allowSqlRead"] != Value::Bool(false),
                allow_write: m["allowSqlWrite"] == Value::Bool(true),
            };
        }
    }
    plan
}

fn exposed_ids(config: &Value) -> Vec<i64> {
    if let Ok(env) = std::env::var("REXADB_MCP_EXPOSED_IDS") {
        return env.split(',').filter_map(|s| s.trim().parse().ok()).filter(|n| *n > 0).collect();
    }
    config["exposedConnectionIds"].as_array().into_iter().flatten().filter_map(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).collect()
}

/// `maskConnectionString`: scheme://host/… with credentials removed.
pub fn mask_connection_string(cs: &str) -> String {
    match url::Url::parse(cs) {
        Ok(u) if u.host_str().is_some() => {
            let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
            format!("{}://{}{}{}", u.scheme(), u.host_str().unwrap_or(""), port, if u.path().len() > 1 { u.path() } else { "" })
        }
        _ => {
            if cs.contains('/') || cs.contains('\\') {
                std::path::Path::new(cs).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "***".into())
            } else {
                "***".into()
            }
        }
    }
}

fn connection_field() -> Value {
    json!({"anyOf": [{"type": "string"}, {"type": "number"}], "description": "Exposed connection id or name. Omit to use the first exposed connection."})
}

fn ro() -> Value {
    json!({"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false})
}

/// `registerExternalTools` tool list.
pub fn tool_list() -> Vec<Value> {
    let ns = json!({"type": "string", "description": "Database or schema name"});
    let table = json!({"type": "string", "description": "Table or collection name"});
    let obj = |props: Value, req: &[&str]| json!({"type": "object", "properties": props, "required": req});
    vec![
        json!({"name": "list_exposed_connections", "description": "List the RexaDB connections the user exposed over MCP (id, name, type). Pass one as `connection` to other tools. Connection strings are never revealed.", "inputSchema": obj(json!({}), &[]), "annotations": ro()}),
        json!({"name": "describe_connection", "description": "Describe the selected exposed RexaDB connection: type, capabilities, and the active MCP permission mode.", "inputSchema": obj(json!({"connection": connection_field()}), &[]), "annotations": ro()}),
        json!({"name": "list_namespaces", "description": "List databases or schemas on the selected exposed connection.", "inputSchema": obj(json!({"connection": connection_field()}), &[]), "annotations": ro()}),
        json!({"name": "list_tables", "description": "List tables or collections for a namespace/schema on the selected exposed connection.", "inputSchema": obj(json!({"connection": connection_field(), "namespace": ns}), &[]), "annotations": ro()}),
        json!({"name": "get_table_schema", "description": "Get columns and field details for a table or collection on the selected exposed connection.", "inputSchema": obj(json!({"connection": connection_field(), "table": table, "namespace": ns}), &["table"]), "annotations": ro()}),
        json!({"name": "get_related_tables", "description": "Get foreign-key style relationships for a table when supported.", "inputSchema": obj(json!({"connection": connection_field(), "table": table, "namespace": ns}), &["table"]), "annotations": ro()}),
        json!({"name": "sample_rows", "description": "Fetch a small sample of rows from a table (requires read permission in the active MCP mode).", "inputSchema": obj(json!({"connection": connection_field(), "table": table, "namespace": ns, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Max rows (default 20)"}}), &["table"]), "annotations": ro()}),
        json!({"name": "run_sql", "description": "Run SQL (or Mongo/Redis query) against the selected exposed connection. Writes are blocked unless the active MCP mode allows them (autopilot).", "inputSchema": obj(json!({"connection": connection_field(), "query": {"type": "string", "description": "SQL / Mongo JSON / Redis command"}}), &["query"]), "annotations": {"readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": true}}),
        json!({"name": "search_schema", "description": "Fuzzy-search tables and columns by keyword on the selected exposed connection.", "inputSchema": obj(json!({"connection": connection_field(), "query": {"type": "string", "description": "Search keyword"}}), &["query"]), "annotations": ro()}),
    ]
}

struct Server {
    drivers: HashMap<i64, Arc<dyn Driver>>,
}

struct Resolved {
    ctx: DbCtx,
    id: i64,
    name: String,
    mode: Mode,
}

fn usable(c: &rexa_store::SavedConnection) -> bool {
    !c.connection_string.starts_with("workspace:")
}

impl Server {
    /// `resolveToolConnection` (fail closed: never fall back to an unexposed connection).
    async fn resolve(&mut self, reference: &Value, namespace: Option<&str>) -> Result<Resolved> {
        let config = rexa_settings::mcp::load();
        if config["enabled"] != Value::Bool(true) {
            bail!("The RexaDB MCP server is disabled. Enable it in Settings → MCP Server.");
        }
        let mode = resolve_mode(&config);
        let ids = exposed_ids(&config);
        let all = rexa_store::Store::open()?.connections()?;
        let exposed: Vec<_> = all.into_iter().filter(|c| usable(c) && ids.contains(&c.id)).collect();
        if exposed.is_empty() {
            bail!("No connections are exposed over MCP. Select connections in Settings → MCP Server.");
        }
        let row = match reference {
            Value::Null => exposed.first().cloned(),
            Value::Number(n) => {
                let id = n.as_i64().unwrap_or(-1);
                Some(exposed.iter().find(|c| c.id == id).cloned().ok_or_else(|| anyhow!("Connection id {id} is not exposed over MCP."))?)
            }
            Value::String(s) if s.trim().is_empty() => exposed.first().cloned(),
            Value::String(s) => {
                let s = s.trim();
                if let Ok(id) = s.parse::<i64>() {
                    Some(exposed.iter().find(|c| c.id == id).cloned().ok_or_else(|| anyhow!("Connection id {id} is not exposed over MCP."))?)
                } else {
                    let needle = s.to_lowercase();
                    Some(
                        exposed
                            .iter()
                            .find(|c| c.name.to_lowercase() == needle)
                            .or_else(|| exposed.iter().find(|c| c.name.to_lowercase().contains(&needle)))
                            .cloned()
                            .ok_or_else(|| anyhow!("Connection \"{s}\" is not exposed over MCP."))?,
                    )
                }
            }
            _ => bail!("Invalid connection reference."),
        };
        let row = row.ok_or_else(|| anyhow!("No exposed connection matched."))?;
        let driver = match self.drivers.get(&row.id) {
            Some(d) => d.clone(),
            None => {
                let creds = rexa_store::resolve_credentials(&row, None)?;
                let d = rexa_drivers::connect_detect(&row.kind, &creds.connection_string).await?;
                self.drivers.insert(row.id, d.clone());
                d
            }
        };
        let ctx = DbCtx {
            db_type: driver.kind().as_str().to_string(),
            driver,
            connection_name: Some(row.name.clone()),
            default_namespace: namespace.filter(|s| !s.is_empty()).map(str::to_string),
            allow_read: mode.allow_read,
            allow_write: mode.allow_write,
        };
        Ok(Resolved { ctx, id: row.id, name: row.name, mode })
    }

    async fn list_exposed(&self) -> Result<Value> {
        let config = rexa_settings::mcp::load();
        if config["enabled"] != Value::Bool(true) {
            bail!("The RexaDB MCP server is disabled. Enable it in Settings → MCP Server.");
        }
        let mode = resolve_mode(&config);
        let ids = exposed_ids(&config);
        let all = rexa_store::Store::open()?.connections()?;
        let connections: Vec<Value> = all
            .iter()
            .filter(|c| usable(c) && ids.contains(&c.id))
            .map(|c| {
                let db_type = rexa_drivers::Kind::detect(&c.kind, &c.connection_string).map(|k| k.as_str().to_string()).unwrap_or_else(|| "unknown".into());
                json!({"id": c.id, "name": c.name, "dbType": db_type, "exposed": true, "dsnHint": mask_connection_string(&c.connection_string)})
            })
            .collect();
        let n = connections.len();
        Ok(json!({"mode": {"id": mode.id, "label": mode.label, "allowSqlRead": mode.allow_read, "allowSqlWrite": mode.allow_write}, "connections": connections, "exposedCount": n}))
    }

    async fn call(&mut self, name: &str, args: &Value) -> Result<Value> {
        if name == "list_exposed_connections" {
            return self.list_exposed().await;
        }
        let started = Instant::now();
        let r = self.resolve(args.get("connection").unwrap_or(&Value::Null), args["namespace"].as_str()).await?;
        if name == "describe_connection" {
            let mut d = db_tools::describe_connection(&r.ctx);
            d["selectedConnection"] = json!({"id": r.id, "name": r.name, "dbType": r.ctx.db_type});
            d["activeMode"] = json!({"id": r.mode.id, "label": r.mode.label});
            return Ok(d);
        }
        let mut tool_args = args.clone();
        if let Some(o) = tool_args.as_object_mut() {
            o.remove("connection");
        }
        let result = db_tools::execute_db_tool(name, &r.ctx, &tool_args).await;
        let denied = result.as_ref().err().is_some_and(|e| {
            let m = e.to_string().to_lowercase();
            m.contains("does not allow") || m.contains("read-only") || m.contains("blocked")
        });
        if name == "run_sql" || denied {
            let query = tool_args["query"].as_str().map(str::to_string);
            let row = rexa_store::McpAuditRow {
                transport: Some("stdio".into()),
                mode_id: Some(r.mode.id.clone()),
                connection_id: Some(r.id),
                connection_name: Some(r.name.clone()),
                tool: name.to_string(),
                is_write: if name == "run_sql" { is_write_sql_for_audit(query.as_deref().unwrap_or("")) } else { true },
                success: result.is_ok(),
                error: result.as_ref().err().map(|e| format!("{e:#}")),
                duration_ms: Some(started.elapsed().as_millis() as i64),
                row_count: result.as_ref().ok().and_then(|v| v["rowCount"].as_i64().or_else(|| v["rows"].as_array().map(|a| a.len() as i64))),
                query_hash: query.as_ref().filter(|_| name == "run_sql").map(|q| hash_query(q)),
                query_preview: query.as_ref().filter(|_| name == "run_sql").map(|q| q.chars().take(2000).collect()),
            };
            if let Err(e) = rexa_store::Store::open().and_then(|s| s.append_mcp_audit(&row)) {
                eprintln!("[rexadb-mcp] audit log write failed: {e}");
            }
        }
        result
    }
}

/// `hashQueryForAudit`: sha256 hex, first 32 chars.
pub fn hash_query(q: &str) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(q.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect::<String>()[..32].to_string()
}

fn tool_text(result: Result<Value>) -> Value {
    match result {
        Ok(v) => json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}]}),
        Err(e) => json!({"content": [{"type": "text", "text": format!("Error: {e:#}")}], "isError": true}),
    }
}

async fn handle(server: &mut Server, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or("");
    let result: Result<Value, (i64, String)> = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "rexadb", "version": "2.0.0"},
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tool_list()})),
        "tools/call" => {
            let name = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("");
            if !tool_list().iter().any(|t| t["name"] == name) {
                Err((-32602, format!("Tool {name} not found")))
            } else {
                let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
                Ok(tool_text(server.call(name, &args).await))
            }
        }
        m if m.starts_with("notifications/") => return None,
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    let id = id?;
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
    })
}

/// Entry point for `rexadb --mcp`: serve until stdin closes.
pub fn run_stdio() -> Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build()?;
    let config = rexa_settings::mcp::load();
    let mode = resolve_mode(&config);
    eprintln!(
        "[rexadb-mcp] external stdio starting enabled={} mode={} read={} write={} exposed={}",
        config["enabled"] == Value::Bool(true),
        mode.id,
        mode.allow_read,
        mode.allow_write,
        exposed_ids(&config).len()
    );
    if config["enabled"] != Value::Bool(true) {
        eprintln!("[rexadb-mcp] server is disabled — tools will refuse until enabled in Settings → MCP Server.");
    }
    let mut server = Server { drivers: HashMap::new() };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let mut out = Vec::new();
                for m in &batch {
                    if let Some(r) = rt.block_on(handle(&mut server, m)) {
                        out.push(r);
                    }
                }
                (!out.is_empty()).then_some(Value::Array(out))
            }
            Ok(msg) => rt.block_on(handle(&mut server, &msg)),
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("Parse error: {e}")}})),
        };
        if let Some(r) = reply {
            writeln!(stdout, "{r}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_and_masking() {
        assert_eq!(resolve_mode(&json!({"modeId": "rexadb-build"})).allow_write, true);
        assert_eq!(resolve_mode(&json!({"modeId": "nope"})).id, "rexadb-plan");
        let c = resolve_mode(&json!({"modeId": "x", "customModes": [{"id": "x", "label": "X", "allowSqlRead": false}]}));
        assert!(!c.allow_read && !c.allow_write);
        assert_eq!(mask_connection_string("postgres://u:p@db.host:5432/app"), "postgres://db.host:5432/app");
        assert_eq!(hash_query("select 1").len(), 32);
        assert_eq!(tool_list().len(), 9);
    }

    #[test]
    fn jsonrpc() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let mut s = Server { drivers: HashMap::new() };
        let r = rt.block_on(handle(&mut s, &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}}))).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(rt.block_on(handle(&mut s, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))).is_none());
        let r = rt.block_on(handle(&mut s, &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))).unwrap();
        assert_eq!(r["result"]["tools"][0]["name"], "list_exposed_connections");
        let r = rt.block_on(handle(&mut s, &json!({"jsonrpc": "2.0", "id": 3, "method": "bogus"}))).unwrap();
        assert_eq!(r["error"]["code"], -32601);
    }
}
