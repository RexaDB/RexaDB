//! Minimal Neon Realtime live-query watcher.
//!
//! Ports enough of `@neon/realtime` for the studio grid: seal the visible
//! window SQL, open one `neon.realtime.v1` WebSocket, subscribe, renew the
//! capability before it expires, and emit a change when a `commit` carries
//! publication body (rows changed). Full row materialization is skipped —
//! the grid refreshes from Postgres on change, matching `table-watch.ts`.

use super::neon_seal::{seal_raw_sql, SealedLiveQuery};
use super::types::{RealtimeErrorCode, REALTIME_ERROR};
use super::watch::{TableWatchEvent, TableWatchRequest};
use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use rexa_drivers::neon_oauth::{self, NeonPointer};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

const SUBPROTOCOL: &str = "neon.realtime.v1";
/// Renew 15s before the sealed capability expires (60s lifetime).
const RENEW_LEAD_MS: u64 = 15_000;

pub struct TableWatchError {
    pub code: RealtimeErrorCode,
    pub message: String,
}

impl TableWatchError {
    fn new(code: RealtimeErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl std::fmt::Display for TableWatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Build the grid's visible-window SQL (`buildNeonWindowSql`).
pub fn build_window_sql(request: &TableWatchRequest) -> String {
    let d = rexa_drivers::Dialect::Postgres;
    let sort_column = request.sort.as_ref().map(|s| s.column.as_str());
    let mut order = Vec::new();
    if let Some(sort) = &request.sort {
        order.push(format!(
            "{} {}",
            d.quote_ident(&sort.column),
            if sort.direction == rexa_drivers::SortDirection::Desc { "DESC" } else { "ASC" }
        ));
    }
    for column in &request.primary_key {
        if Some(column.as_str()) != sort_column {
            order.push(format!("{} ASC", d.quote_ident(column)));
        }
    }
    if order.is_empty() {
        // Live queries require a deterministic ORDER BY; fall back to PK-less
        // tables by ordering on the first selected column via ctid.
        order.push("ctid ASC".into());
    }
    let filter = request.filter.trim();
    format!(
        "SELECT * FROM {}.{}{} ORDER BY {} LIMIT $1 OFFSET $2",
        d.quote_ident(&request.schema),
        d.quote_ident(&request.table),
        if filter.is_empty() {
            String::new()
        } else {
            format!(" WHERE {filter}")
        },
        order.join(", "),
    )
}

pub fn describe_live_query_error(message: &str) -> String {
    if message.to_ascii_lowercase().contains("row security") {
        return "Neon Realtime (beta) doesn't support tables with row-level security yet. Disable RLS on this table or use Auto-refresh.".into();
    }
    message.to_string()
}

/// Start a Neon live-query watch. Events are sent on `tx` until `stop` is set
/// or the socket ends with an error.
pub async fn watch_neon_table(
    pointer: NeonPointer,
    request: TableWatchRequest,
    tx: mpsc::UnboundedSender<TableWatchEvent>,
    stop: Arc<AtomicBool>,
) -> Result<(), TableWatchError> {
    let state = neon_oauth::get_realtime_state(&pointer.profile, &pointer.project_id, &pointer.branch_id)
        .await
        .map_err(|e| TableWatchError::new(REALTIME_ERROR.unsupported, e.to_string()))?;
    if !state.enabled || state.pending || state.invocation_url.as_ref().is_none_or(|u| u.is_empty()) {
        return Err(TableWatchError::new(
            if state.enabled { REALTIME_ERROR.pending } else { REALTIME_ERROR.disabled },
            if state.enabled {
                "Realtime is still being set up on this branch. Try again in a moment."
            } else {
                "Realtime is not enabled on this Neon branch."
            },
        ));
    }
    if request.primary_key.is_empty() {
        return Err(TableWatchError::new(
            REALTIME_ERROR.no_primary_key,
            "Neon live queries need a primary key to identify rows.",
        ));
    }
    let secret = neon_oauth::get_realtime_secret(&pointer.profile, &pointer.project_id, &pointer.branch_id)
        .await
        .map_err(|e| TableWatchError::new(REALTIME_ERROR.unsupported, e.to_string()))?;
    let url = state.invocation_url.unwrap();
    let sql = build_window_sql(&request);
    let params = vec![
        Value::from(request.limit as i64),
        Value::from(request.offset as i64),
    ];

    let _ = tx.send(TableWatchEvent::Status("connecting"));
    if let Err(err) = run_socket(&url, &secret, &pointer.database, &sql, &params, &tx, &stop).await {
        let message = describe_live_query_error(&err.to_string());
        let _ = tx.send(TableWatchEvent::Error { message: message.clone(), code: None });
        return Err(TableWatchError::new(REALTIME_ERROR.unsupported, message));
    }
    Ok(())
}

async fn run_socket(
    url: &str,
    secret: &str,
    database: &str,
    sql: &str,
    params: &[Value],
    tx: &mpsc::UnboundedSender<TableWatchEvent>,
    stop: &AtomicBool,
) -> Result<()> {
    let mut sealed = seal_raw_sql(secret, database, sql, params, true)?;
    let mut request = url.into_client_request().context("Realtime URL")?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", HeaderValue::from_static(SUBPROTOCOL));
    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .context("Realtime WebSocket connect")?;
    let (mut write, mut read) = ws.split();

    let mut ready = false;
    let mut request_id: u64 = 0;
    let mut live_id: Option<String> = None;
    let mut pending_request: Option<u64> = None;
    let mut renew_at = renew_deadline(&sealed);

    // Wait for ready, then subscribe.
    while !stop.load(Ordering::Relaxed) {
        let next = tokio::time::timeout(Duration::from_millis(500), read.next()).await;
        match next {
            Ok(Some(Ok(Message::Text(text)))) => {
                let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                let ty = value.get("type").and_then(Value::as_str).unwrap_or("");
                match ty {
                    "ping" => {
                        let token = value.get("token").and_then(Value::as_str).unwrap_or("");
                        let pong = serde_json::json!({ "type": "pong", "token": token });
                        write.send(Message::Text(pong.to_string().into())).await?;
                    }
                    "ready" if !ready => {
                        ready = true;
                        request_id += 1;
                        pending_request = Some(request_id);
                        let msg = serde_json::json!({
                            "type": "subscribe",
                            "request_id": request_id.to_string(),
                            "authorization": sealed.capability,
                        });
                        write.send(Message::Text(msg.to_string().into())).await?;
                    }
                    "subscribed" => {
                        let rid = value
                            .get("request_id")
                            .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())));
                        if rid.as_deref() == pending_request.map(|n| n.to_string()).as_deref() {
                            live_id = value.get("live_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())));
                            pending_request = None;
                            let _ = tx.send(TableWatchEvent::Status("live"));
                        }
                    }
                    "subscribe_rejected" | "subscription_error" => {
                        let message = value
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Realtime subscription failed")
                            .to_string();
                        let code = value.get("code").and_then(Value::as_str).unwrap_or("");
                        let sqlstate = value.get("sqlstate").or_else(|| value.get("sqlState")).and_then(Value::as_str);
                        let mut full = describe_live_query_error(&message);
                        if !code.is_empty() {
                            full = format!("{full} ({code}");
                            if let Some(s) = sqlstate {
                                full = format!("{full}, SQLSTATE {s}");
                            }
                            full.push(')');
                        }
                        bail!("{full}");
                    }
                    "commit" => {
                        let body = value.get("body_count").and_then(Value::as_u64).unwrap_or(0);
                        if body > 0 {
                            let _ = tx.send(TableWatchEvent::Change { count: body as usize });
                        }
                    }
                    "keyed_results" => {
                        let changes = value
                            .get("changes")
                            .and_then(Value::as_array)
                            .map(|a| a.len())
                            .unwrap_or(0);
                        if changes > 0 {
                            let _ = tx.send(TableWatchEvent::Change { count: changes });
                        }
                    }
                    "connection_error" => {
                        let message = value
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Realtime connection error");
                        bail!("{message}");
                    }
                    _ => {}
                }
            }
            Ok(Some(Ok(Message::Ping(p)))) => {
                write.send(Message::Pong(p)).await?;
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                bail!("Realtime connection closed");
            }
            Ok(Some(Err(e))) => bail!("Realtime WebSocket error: {e}"),
            Ok(Some(Ok(_))) => {}
            Err(_) => {
                // timeout — check renew / stop
            }
        }

        if stop.load(Ordering::Relaxed) {
            break;
        }
        if ready && live_id.is_some() && std::time::Instant::now() >= renew_at {
            sealed = seal_raw_sql(secret, database, sql, params, true)?;
            renew_at = renew_deadline(&sealed);
            if let Some(id) = &live_id {
                let msg = serde_json::json!({
                    "type": "renew",
                    "live_id": id,
                    "authorization": sealed.capability,
                });
                write.send(Message::Text(msg.to_string().into())).await?;
            }
        }
    }

    if let Some(id) = live_id {
        let msg = serde_json::json!({ "type": "unsubscribe", "live_id": id });
        let _ = write.send(Message::Text(msg.to_string().into())).await;
    }
    let _ = write.close().await;
    Ok(())
}

fn renew_deadline(sealed: &SealedLiveQuery) -> std::time::Instant {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let wait = sealed.expires_at.saturating_sub(now_ms).saturating_sub(RENEW_LEAD_MS);
    std::time::Instant::now() + Duration::from_millis(wait.max(5_000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::realtime::watch::TableWatchRequest;

    #[test]
    fn window_sql_includes_pk_tiebreak() {
        let sql = build_window_sql(&TableWatchRequest {
            connection_string: String::new(),
            schema: "public".into(),
            table: "users".into(),
            primary_key: vec!["id".into()],
            filter: "active = true".into(),
            sort: Some(rexa_drivers::SortConfig {
                column: "name".into(),
                direction: rexa_drivers::SortDirection::Asc,
            }),
            limit: 100,
            offset: 0,
        });
        assert!(sql.contains("WHERE active = true"));
        assert!(sql.contains("ORDER BY \"name\" ASC, \"id\" ASC"));
        assert!(sql.contains("LIMIT $1 OFFSET $2"));
    }
}
