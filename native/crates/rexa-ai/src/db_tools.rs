//! Port of lib/agents/db-tools-core.ts — DB tool handlers shared by the
//! built-in chat agent (lib/ai/pi-tools.ts) and the RexaDB MCP server, executed
//! through `rexa_drivers`. Results are JSON shaped like the original's
//! `lib/db/actions` payloads.

use crate::sql_guards::*;
use anyhow::{anyhow, bail, Result};
use rexa_drivers::{Cell, Driver, QueryResult, TableRef};
use serde_json::{json, Map, Value};
use std::sync::Arc;

/// Rows handed back to the model per query (keeps context bounded).
pub const TOOL_ROW_LIMIT: usize = 200;

#[derive(Clone)]
pub struct DbCtx {
    pub driver: Arc<dyn Driver>,
    pub db_type: String,
    pub connection_name: Option<String>,
    pub default_namespace: Option<String>,
    pub allow_read: bool,
    pub allow_write: bool,
}

impl DbCtx {
    fn ns(&self, value: Option<&str>) -> String {
        let v = value.filter(|s| !s.is_empty()).map(str::to_string).or_else(|| self.default_namespace.clone()).unwrap_or_default();
        if v.is_empty() && self.db_type == "sqlite" {
            return "main".into();
        }
        v
    }
}

pub fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

pub fn query_result_json(r: &QueryResult) -> Value {
    let rows: Vec<Value> = r
        .rows
        .iter()
        .take(TOOL_ROW_LIMIT)
        .map(|row| {
            let mut obj = Map::new();
            for (i, col) in r.columns.iter().enumerate() {
                let v = match row.get(i) {
                    Some(Cell::Text(s)) => Value::from(s.clone()),
                    _ => Value::Null,
                };
                obj.insert(col.clone(), v);
            }
            Value::Object(obj)
        })
        .collect();
    let mut out = json!({
        "rows": rows,
        "fields": r.columns.iter().map(|c| json!({"name": c})).collect::<Vec<_>>(),
        "rowCount": r.affected.unwrap_or(r.rows.len() as u64),
    });
    if r.truncated || r.rows.len() > TOOL_ROW_LIMIT {
        out["truncated"] = Value::Bool(true);
    }
    out
}

/// `describeConnection`.
pub fn describe_connection(ctx: &DbCtx) -> Value {
    json!({
        "connectionName": ctx.connection_name,
        "dbType": ctx.db_type,
        "capabilities": db_capabilities(&ctx.db_type),
        "permissions": {"allowSqlRead": ctx.allow_read, "allowSqlWrite": ctx.allow_write},
    })
}

/// `listNamespaces`.
pub async fn list_namespaces(ctx: &DbCtx) -> Result<Value> {
    let namespaces = if ctx.db_type == "mongodb" || ctx.db_type == "redis" {
        ctx.driver.databases().await?
    } else {
        ctx.driver.schemas().await?
    };
    Ok(json!({"namespaces": namespaces}))
}

/// `listTables`.
pub async fn list_tables(ctx: &DbCtx, args: &Value) -> Result<Value> {
    let ns = str_arg(args, "namespace");
    if ctx.db_type == "redis" {
        let keys = ctx.driver.redis_keys("*", 100, ns).await?;
        let schema = ns.unwrap_or("0");
        return Ok(json!({"tables": keys.iter().map(|k| json!({"schema": schema, "name": k.key, "type": k.r#type})).collect::<Vec<_>>()}));
    }
    let schema = ctx.ns(ns);
    let tables = ctx.driver.tables(&schema).await?;
    if ctx.db_type == "mongodb" {
        return Ok(json!({"tables": tables.iter().map(|t| json!({"schema": schema, "name": t.name})).collect::<Vec<_>>()}));
    }
    Ok(json!({"tables": tables.iter().map(|t| t.name.clone()).collect::<Vec<_>>()}))
}

/// `getTableSchema`.
pub async fn get_table_schema(ctx: &DbCtx, args: &Value) -> Result<Value> {
    if ctx.db_type == "redis" {
        bail!("Redis does not expose table schemas.");
    }
    let table = str_arg(args, "table").unwrap_or("").to_string();
    let schema = ctx.ns(str_arg(args, "namespace"));
    let cols = ctx.driver.table_structure(&TableRef::new(schema, table.clone())).await?;
    let structure: Vec<Value> = cols
        .iter()
        .map(|c| {
            json!({
                "column_name": c.column_name,
                "data_type": c.display_type(),
                "is_nullable": if c.is_nullable { "YES" } else { "NO" },
                "column_default": c.column_default,
                "is_primary_key": c.is_primary_key,
                "is_foreign_key": c.is_foreign_key,
                "is_unique": c.is_unique,
                "comment": c.comment,
            })
        })
        .collect();
    Ok(json!({"table": table, "structure": structure}))
}

/// `getRelatedTables`.
pub async fn get_related_tables(ctx: &DbCtx, args: &Value) -> Result<Value> {
    if !supports_related_tables(&ctx.db_type) {
        bail!("Related table inspection is not supported for {}.", ctx.db_type);
    }
    let table = str_arg(args, "table").unwrap_or("").to_string();
    let schema = ctx.ns(str_arg(args, "namespace"));
    let fks = ctx.driver.foreign_keys(&TableRef::new(schema, table.clone())).await?;
    let relationships: Vec<Value> = fks
        .iter()
        .map(|f| {
            json!({
                "column_name": f.column_name,
                "foreign_table_schema": f.foreign_table_schema,
                "foreign_table_name": f.foreign_table_name,
                "foreign_column_name": f.foreign_column_name,
                "constraint_name": f.constraint_name,
                "on_update": f.on_update,
                "on_delete": f.on_delete,
            })
        })
        .collect();
    Ok(json!({"table": table, "relationships": relationships}))
}

/// `sampleRows`.
pub async fn sample_rows(ctx: &DbCtx, args: &Value, denied: &str) -> Result<Value> {
    if !ctx.allow_read {
        bail!("{denied}");
    }
    let table = str_arg(args, "table").unwrap_or("");
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, 100) as usize;
    let ns = str_arg(args, "namespace");
    match ctx.db_type.as_str() {
        "mongodb" => {
            let q = json!({"database": ns.map(str::to_string).or(ctx.default_namespace.clone()), "collection": table, "operation": "find", "limit": limit});
            Ok(query_result_json(&ctx.driver.execute(&q.to_string(), limit).await?))
        }
        "redis" => {
            let keys = ctx.driver.redis_keys(&format!("{table}*"), limit, ns).await?;
            let rows: Vec<Value> = keys.iter().map(|k| json!({"key": k.key, "type": k.r#type, "ttl": k.ttl_seconds, "size": k.size})).collect();
            Ok(json!({"rows": rows, "rowCount": rows.len()}))
        }
        _ => {
            let sql = build_sample_query(&ctx.db_type, &ctx.ns(ns), table, limit);
            Ok(query_result_json(&ctx.driver.execute(&sql, limit).await?))
        }
    }
}

/// Built-in chat `run_readonly_query` (pi-tools.ts): always read-only.
pub async fn run_readonly_query(ctx: &DbCtx, query: &str) -> Result<Value> {
    if !ctx.allow_read {
        bail!("This chat is limited to schema-only access.");
    }
    match ctx.db_type.as_str() {
        "mongodb" => {}
        "redis" => {
            if !is_read_only_redis(query) {
                bail!("Only read-only Redis commands are allowed.");
            }
        }
        _ => ensure_read_only_sql(query)?,
    }
    Ok(query_result_json(&ctx.driver.execute(query, TOOL_ROW_LIMIT).await?))
}

/// MCP / harness `run_sql` with the mode's read/write gating.
pub async fn run_sql(ctx: &DbCtx, query: &str) -> Result<Value> {
    match ctx.db_type.as_str() {
        "mongodb" => {
            if !ctx.allow_read {
                bail!("This agent mode does not allow running queries.");
            }
            if looks_like_mongo_write(query) && !ctx.allow_write {
                bail!("This agent mode is plan/read-only — mutating Mongo operations are blocked.");
            }
        }
        "redis" => {
            if !ctx.allow_read {
                bail!("This agent mode does not allow running commands.");
            }
            if !is_read_only_redis(query) && !ctx.allow_write {
                bail!("This agent mode is plan/read-only — only read Redis commands are allowed.");
            }
        }
        _ => {
            if is_read_sql(query) {
                if !ctx.allow_read {
                    bail!("This agent mode does not allow running SQL.");
                }
                ensure_read_only_sql(query)?;
            } else if !ctx.allow_write {
                bail!("This agent mode is plan/read-only — mutating SQL is blocked. Emit a ```schema-plan or ```sql proposal instead.");
            }
        }
    }
    Ok(query_result_json(&ctx.driver.execute(query, TOOL_ROW_LIMIT).await?))
}

/// `searchSchema`.
pub async fn search_schema(ctx: &DbCtx, query: &str) -> Result<Value> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(json!({"matches": []}));
    }
    let rows = ctx.driver.all_tables_with_columns(None).await.map_err(|e| anyhow!("Failed to inspect schema: {e:#}"))?;
    let matches: Vec<Value> = rows
        .iter()
        .filter(|r| r.table_name.to_lowercase().contains(&needle) || r.column_name.to_lowercase().contains(&needle) || r.table_schema.to_lowercase().contains(&needle))
        .take(60)
        .map(|r| {
            json!({
                "table_schema": r.table_schema, "table_name": r.table_name, "column_name": r.column_name,
                "data_type": r.data_type, "is_nullable": r.is_nullable, "is_primary": r.is_primary,
            })
        })
        .collect();
    Ok(json!({"matches": matches}))
}

/// `LightSchemaContextTable[]` for the prompt / @-mentions
/// (use-ai-mention-catalog.ts + groupSchemaRows): all tables with columns.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogTable {
    pub schema: String,
    pub table: String,
    pub columns: Vec<(String, String)>,
}

pub async fn load_catalog(driver: Arc<dyn Driver>, db_type: &str) -> Vec<CatalogTable> {
    if db_type == "redis" {
        return Vec::new();
    }
    if db_type != "mongodb" {
        if let Ok(rows) = driver.all_tables_with_columns(None).await {
            let mut out: Vec<CatalogTable> = Vec::new();
            for r in rows {
                match out.iter_mut().find(|t| t.schema == r.table_schema && t.table == r.table_name) {
                    Some(t) => t.columns.push((r.column_name, r.data_type)),
                    None => out.push(CatalogTable { schema: r.table_schema, table: r.table_name, columns: vec![(r.column_name, r.data_type)] }),
                }
            }
            if !out.is_empty() {
                return out;
            }
        }
    }
    let mut out = Vec::new();
    for schema in driver.schemas().await.unwrap_or_default() {
        for t in driver.tables(&schema).await.unwrap_or_default() {
            out.push(CatalogTable { schema: schema.clone(), table: t.name, columns: Vec::new() });
        }
    }
    out
}

/// Dispatch one of db-tools-core's `DbToolName`s.
pub async fn execute_db_tool(name: &str, ctx: &DbCtx, args: &Value) -> Result<Value> {
    match name {
        "describe_connection" => Ok(describe_connection(ctx)),
        "list_namespaces" => list_namespaces(ctx).await,
        "list_tables" => list_tables(ctx, args).await,
        "get_table_schema" => get_table_schema(ctx, args).await,
        "get_related_tables" => get_related_tables(ctx, args).await,
        "sample_rows" => sample_rows(ctx, args, "This agent mode does not allow reading table data.").await,
        "run_sql" => run_sql(ctx, str_arg(args, "query").unwrap_or("")).await,
        "search_schema" => search_schema(ctx, str_arg(args, "query").unwrap_or("")).await,
        other => bail!("Unknown tool: {other}"),
    }
}
