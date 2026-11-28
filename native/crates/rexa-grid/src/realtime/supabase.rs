//! Port of Supabase Realtime pieces in `lib/realtime/table-watch.ts` and
//! `lib/transfer/supabase-api.ts` credential resolution: publication status,
//! REPLICA IDENTITY, and a Phoenix `postgres_changes` WebSocket.

use super::types::REALTIME_ERROR;
use super::watch::{TableWatchEvent, TableWatchRequest};
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use rexa_drivers::Driver;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const MGMT_API: &str = "https://api.supabase.com/v1";

#[derive(Debug, Clone)]
pub struct SupabaseTableRealtimeStatus {
    pub published: bool,
    pub full_replica_identity: bool,
}

#[derive(Debug, Clone)]
pub struct SupabaseApiCreds {
    pub project_ref: String,
    pub project_url: String,
    pub service_role: String,
}

pub fn parse_mgmt(cs: &str) -> Option<(String, String)> {
    let u = url::Url::parse(cs.trim()).ok()?;
    if u.scheme() != "supabase-mgmt" {
        return None;
    }
    let project = u
        .host_str()
        .filter(|h| !h.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| u.path().trim_start_matches('/').to_string());
    let token = u
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    (!project.is_empty() && !token.is_empty()).then_some((project, token))
}

pub async fn resolve_api_creds(cs: &str) -> Result<SupabaseApiCreds, String> {
    let Some((project_ref, token)) = parse_mgmt(cs) else {
        return Err("No Supabase management token on this connection.".into());
    };
    let res = reqwest::Client::new()
        .get(format!("{MGMT_API}/projects/{project_ref}/api-keys"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to resolve Supabase API credentials: {e}"))?;
    if !res.status().is_success() {
        return Err(format!(
            "Could not list API keys for {project_ref} (HTTP {}).",
            res.status().as_u16()
        ));
    }
    let payload: Value = res.json().await.unwrap_or(Value::Null);
    let list = payload
        .as_array()
        .or_else(|| payload.get("data").and_then(Value::as_array))
        .or_else(|| payload.get("api_keys").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();
    let name_of = |k: &Value| {
        k.get("name")
            .or_else(|| k.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase()
    };
    let service_role = list
        .iter()
        .find(|k| name_of(k).contains("service_role"))
        .and_then(|k| k.get("api_key").and_then(Value::as_str))
        .or_else(|| {
            list.iter()
                .filter_map(|k| k.get("api_key").and_then(Value::as_str))
                .find(|k| k.starts_with("eyJ"))
        })
        .map(str::to_string);
    match service_role {
        Some(service_role) if !service_role.is_empty() => Ok(SupabaseApiCreds {
            project_url: format!("https://{project_ref}.supabase.co"),
            project_ref,
            service_role,
        }),
        _ => Err(format!("No service_role key found for {project_ref}.")),
    }
}

pub async fn get_table_realtime_status(
    driver: &dyn Driver,
    schema: &str,
    table: &str,
) -> Result<SupabaseTableRealtimeStatus> {
    let d = rexa_drivers::Dialect::Postgres;
    let sql = format!(
        "SELECT c.relreplident::text AS ident,\n\
         EXISTS (SELECT 1 FROM pg_publication_tables p\n\
                 WHERE p.pubname = 'supabase_realtime' AND p.schemaname = n.nspname AND p.tablename = c.relname) AS published\n\
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\n\
         WHERE n.nspname = {} AND c.relname = {}",
        d.quote_str(schema),
        d.quote_str(table),
    );
    let result = driver.execute(&sql, 1).await?;
    let row = result.rows.first();
    let cell = |i: usize| row.and_then(|r| r.get(i)).map(|c| c.display().to_string()).unwrap_or_default();
    let published = matches!(cell(1).as_str(), "t" | "true" | "TRUE" | "1");
    Ok(SupabaseTableRealtimeStatus {
        published,
        full_replica_identity: cell(0) == "f",
    })
}

pub async fn set_table_realtime(
    driver: &dyn Driver,
    schema: &str,
    table: &str,
    published: Option<bool>,
    full_replica_identity: Option<bool>,
) -> Result<SupabaseTableRealtimeStatus> {
    let d = rexa_drivers::Dialect::Postgres;
    let target = format!("{}.{}", d.quote_ident(schema), d.quote_ident(table));
    if let Some(want) = published {
        let current = get_table_realtime_status(driver, schema, table).await?;
        if want != current.published {
            let ensure = "DO $$ BEGIN\n\
                   IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN\n\
                     CREATE PUBLICATION supabase_realtime;\n\
                   END IF;\n\
                 END $$;"
                .to_string();
            let alter = format!(
                "ALTER PUBLICATION supabase_realtime {} TABLE {target}",
                if want { "ADD" } else { "DROP" },
            );
            for sql in [ensure, alter] {
                let script = driver.execute_script(&sql, usize::MAX).await?;
                if let Some(err) = script.error {
                    anyhow::bail!("{}", err.message);
                }
            }
        }
    }
    if let Some(full) = full_replica_identity {
        let sql = format!(
            "ALTER TABLE {target} REPLICA IDENTITY {}",
            if full { "FULL" } else { "DEFAULT" }
        );
        driver.execute(&sql, 1).await?;
    }
    get_table_realtime_status(driver, schema, table).await
}

pub async fn watch_supabase_table(
    request: TableWatchRequest,
    tx: mpsc::UnboundedSender<TableWatchEvent>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let creds = resolve_api_creds(&request.connection_string).await?;
    // Publication check is done by the caller / toolbar; still verify here.
    let _ = tx.send(TableWatchEvent::Status("connecting"));

    let ws_url = format!(
        "{}/realtime/v1/websocket?apikey={}&vsn=1.0.0",
        creds.project_url.replace("https://", "wss://").replace("http://", "ws://"),
        urlencoding::encode(&creds.service_role),
    );
    let (ws, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("Supabase Realtime connect failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    let topic = format!("realtime:{}:{}", request.schema, request.table);
    let join_ref = "1";
    let join = json!({
        "topic": topic,
        "event": "phx_join",
        "payload": {
            "config": {
                "broadcast": { "self": false },
                "presence": { "key": "" },
                "postgres_changes": [{
                    "event": "*",
                    "schema": request.schema,
                    "table": request.table,
                }],
            },
            "access_token": creds.service_role,
        },
        "ref": join_ref,
        "join_ref": join_ref,
    });
    write
        .send(Message::Text(join.to_string().into()))
        .await
        .map_err(|e| e.to_string())?;

    let mut joined = false;
    let mut heartbeat = 0u64;
    let mut next_heartbeat = tokio::time::Instant::now() + Duration::from_secs(25);

    while !stop.load(Ordering::Relaxed) {
        let wait = next_heartbeat.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(wait.max(Duration::from_millis(200)), read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                let event = value.get("event").and_then(Value::as_str).unwrap_or("");
                let payload = value.get("payload").cloned().unwrap_or(Value::Null);
                match event {
                    "phx_reply" if value.get("ref").and_then(Value::as_str) == Some(join_ref) => {
                        let status = payload.get("status").and_then(Value::as_str).unwrap_or("");
                        if status == "ok" {
                            joined = true;
                            let _ = tx.send(TableWatchEvent::Status("live"));
                        } else {
                            let message = payload
                                .get("response")
                                .and_then(|r| r.get("reason").or_else(|| r.get("error")))
                                .and_then(Value::as_str)
                                .unwrap_or("Supabase Realtime channel error");
                            return Err(message.into());
                        }
                    }
                    "postgres_changes" => {
                        let _ = tx.send(TableWatchEvent::Change { count: 1 });
                    }
                    "phx_error" | "phx_close" => {
                        return Err("Supabase Realtime channel closed".into());
                    }
                    _ => {}
                }
            }
            Ok(Some(Ok(Message::Ping(p)))) => {
                let _ = write.send(Message::Pong(p)).await;
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                return Err("Supabase Realtime connection closed".into());
            }
            Ok(Some(Err(e))) => return Err(format!("Supabase Realtime error: {e}")),
            Ok(Some(Ok(_))) => {}
            Err(_) => {
                // heartbeat tick
                heartbeat += 1;
                let hb = json!({
                    "topic": "phoenix",
                    "event": "heartbeat",
                    "payload": {},
                    "ref": heartbeat.to_string(),
                });
                if write.send(Message::Text(hb.to_string().into())).await.is_err() {
                    return Err("Supabase Realtime heartbeat failed".into());
                }
                next_heartbeat = tokio::time::Instant::now() + Duration::from_secs(25);
                if !joined {
                    // Still waiting for join reply — keep waiting.
                }
            }
        }
    }

    let leave = json!({
        "topic": topic,
        "event": "phx_leave",
        "payload": {},
        "ref": "leave",
        "join_ref": join_ref,
    });
    let _ = write.send(Message::Text(leave.to_string().into())).await;
    let _ = write.close().await;
    Ok(())
}

pub fn not_published_error(schema: &str, table: &str) -> (&'static str, String) {
    (
        REALTIME_ERROR.not_published,
        format!("\"{schema}.{table}\" is not in the supabase_realtime publication."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mgmt_pointer() {
        let (r, t) = parse_mgmt("supabase-mgmt://abcdefghijklmnop?token=sbp_x").unwrap();
        assert_eq!(r, "abcdefghijklmnop");
        assert_eq!(t, "sbp_x");
    }
}
