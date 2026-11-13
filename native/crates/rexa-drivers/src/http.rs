//! Shared HTTP client for the HTTP-speaking engines (ClickHouse, Trino,
//! Turso/libSQL, rqlite, D1, StarbaseDB, Val.town, SpacetimeDB, Supabase
//! Management API).

use anyhow::{anyhow, bail, Result};
use std::sync::OnceLock;
use std::time::Duration;

pub(crate) fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .user_agent("RexaDB")
            .build()
            .expect("http client")
    })
}

/// Send and parse a JSON response; non-2xx and non-JSON bodies become errors
/// carrying the server text (`postJson` in `edge-sqlite.ts`).
pub(crate) async fn json(req: reqwest::RequestBuilder, label: &str) -> Result<serde_json::Value> {
    let res = req.send().await.map_err(|e| anyhow!("{label} request failed: {e}"))?;
    let status = res.status();
    let is_json = res.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("json"));
    let text = res.text().await.unwrap_or_default();
    let parsed: Option<serde_json::Value> = if is_json || text.trim_start().starts_with(['{', '[']) { serde_json::from_str(&text).ok() } else { None };
    if !status.is_success() {
        let msg = parsed
            .as_ref()
            .and_then(|p| {
                p.get("error")
                    .and_then(|e| e.as_str().map(str::to_string).or_else(|| e.get("message").and_then(|m| m.as_str()).map(str::to_string)))
                    .or_else(|| p.get("message").and_then(|m| m.as_str()).map(str::to_string))
                    .or_else(|| p.pointer("/errors/0/message").and_then(|m| m.as_str()).map(str::to_string))
            })
            .unwrap_or_else(|| if text.is_empty() { format!("{label} error (status {status}).") } else { text.clone() });
        bail!("{msg}");
    }
    match parsed {
        Some(v) => Ok(v),
        None if text.trim().is_empty() => Ok(serde_json::Value::Null),
        None => bail!("{label} returned non-JSON response (status {}): {}", status.as_u16(), text.chars().take(300).collect::<String>()),
    }
}

/// JSON value → display text (strings unquoted, objects/arrays as JSON).
pub(crate) fn json_to_cell(v: &serde_json::Value) -> crate::Cell {
    match v {
        serde_json::Value::Null => crate::Cell::Null,
        serde_json::Value::String(s) => crate::Cell::Text(s.clone()),
        serde_json::Value::Bool(b) => crate::Cell::Text(b.to_string()),
        serde_json::Value::Number(n) => crate::Cell::Text(n.to_string()),
        other => crate::Cell::Text(other.to_string()),
    }
}

/// Rows of JSON objects → [`crate::QueryResult`] (column order of first
/// appearance across rows, like `inferFields`).
pub(crate) fn objects_to_result(rows: &[serde_json::Value]) -> crate::QueryResult {
    let mut columns: Vec<String> = Vec::new();
    for r in rows {
        if let Some(o) = r.as_object() {
            for k in o.keys() {
                if !columns.contains(k) {
                    columns.push(k.clone());
                }
            }
        }
    }
    let out_rows = rows
        .iter()
        .map(|r| columns.iter().map(|c| r.get(c).map_or(crate::Cell::Null, json_to_cell)).collect())
        .collect();
    crate::QueryResult { columns, rows: out_rows, ..Default::default() }
}
