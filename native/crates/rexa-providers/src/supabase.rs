//! Port of `lib/supabase-paykit/supabase-ref.ts` (project-ref inference +
//! linked-account token lookup), `lib/studio/edge-functions-utils.ts#resolveEdgeAccess`
//! and its tolerant `mgmtRequest` helper. The old app proxied the Management
//! API through the Bun sidecar (`/api/supabase-mgmt/proxy/v1`); here we call
//! `https://api.supabase.com/v1` directly.
//!
//! Linked accounts are read (read-only) from the same `app_settings` key
//! rexa-connections writes: `rexadb-supabase-mgmt-accounts`, tokens behind
//! `credentialRef` keychain entries.

use anyhow::{anyhow, bail, Result};
use rexa_core::Session;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub const API: &str = "https://api.supabase.com/v1";

#[derive(Clone, Debug, PartialEq)]
pub enum ConnKind {
    /// supabase-mgmt connection with an embedded token.
    Mgmt,
    /// Direct Postgres connection to `db.<ref>.supabase.co`.
    Postgres,
}

/// `PaymentsConnectionInfo`.
#[derive(Clone, Debug, PartialEq)]
pub struct ConnInfo {
    pub kind: ConnKind,
    pub project_ref: String,
    pub token: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Access {
    pub project_ref: String,
    pub token: String,
}

/// `inferSupabaseRefFromPostgresUrl`.
pub fn infer_ref_from_postgres_url(cs: &str) -> Option<String> {
    let url = url::Url::parse(cs.trim()).ok()?;
    if url.scheme() != "postgres" && url.scheme() != "postgresql" {
        return None;
    }
    let host = url.host_str()?.to_lowercase();
    let rest = host.strip_prefix("db.")?.strip_suffix(".supabase.co")?;
    let ok = !rest.is_empty() && rest.len() <= 64 && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    ok.then(|| rest.to_string())
}

fn parse_mgmt(cs: &str) -> Option<(String, String)> {
    let u = url::Url::parse(cs.trim()).ok()?;
    if u.scheme() != "supabase-mgmt" {
        return None;
    }
    let project = u.host_str().filter(|h| !h.is_empty()).map(str::to_string).unwrap_or_else(|| u.path().trim_start_matches('/').to_string());
    let token = u.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()).unwrap_or_default();
    (!project.is_empty()).then_some((project, token))
}

/// `resolvePaymentsConnection`. The native app also stores Supabase direct
/// connections with connection type `supabase`.
pub fn resolve_connection(connection_type: &str, cs: &str) -> Option<ConnInfo> {
    if cs.is_empty() {
        return None;
    }
    if connection_type == "supabase-mgmt" {
        let (project_ref, token) = parse_mgmt(cs)?;
        return Some(ConnInfo { kind: ConnKind::Mgmt, project_ref, token: (!token.is_empty()).then_some(token) });
    }
    if matches!(connection_type, "postgres" | "postgresql" | "supabase") {
        let project_ref = infer_ref_from_postgres_url(cs)?;
        return Some(ConnInfo { kind: ConnKind::Postgres, project_ref, token: None });
    }
    None
}

/// The connection string with secrets resolved (blocking: keychain).
pub fn connection_string(session: &Session, vault: Option<&rexa_store::Vault>) -> String {
    rexa_store::resolve_credentials(&session.connection, vault)
        .map(|c| c.connection_string)
        .unwrap_or_else(|_| session.connection.connection_string.clone())
}

pub fn connection_info(session: &Session, vault: Option<&rexa_store::Vault>) -> Option<ConnInfo> {
    // Dev aid (debug builds only): treat any connection as this Supabase project ref.
    #[cfg(debug_assertions)]
    if let Ok(project_ref) = std::env::var("REXA_DEV_SUPABASE_REF") {
        return Some(ConnInfo { kind: ConnKind::Postgres, project_ref, token: None });
    }
    let kind = session.connection.kind.as_str();
    // Ref inference only needs the host, which is never stripped.
    if kind != "supabase-mgmt" {
        return resolve_connection(kind, &session.connection.connection_string);
    }
    resolve_connection(kind, &connection_string(session, vault))
}

/// Linked Supabase Management API tokens (`getMgmtAccounts`), oldest first.
pub fn linked_tokens() -> Vec<String> {
    let raw = rexa_store::Store::open().ok().and_then(|s| s.setting("rexadb-supabase-mgmt-accounts").ok().flatten())
        .or_else(|| rexa_store::WebStore::open()?.get("rexadb-supabase-mgmt-accounts").ok().flatten());
    let mut list: Vec<Value> = raw.and_then(|r| serde_json::from_str::<Value>(&r).ok()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    list.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
    list.iter()
        .filter_map(|a| {
            a.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string)
                .or_else(|| a.get("credentialRef").and_then(Value::as_str).and_then(|r| rexa_store::read_account_token(r).ok()))
        })
        .collect()
}

fn token_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// `resolveMgmtTokenForRef`: the first linked account whose project list
/// contains `project_ref` (read-only `GET /projects`), cached per ref.
pub async fn token_for_ref(project_ref: &str) -> Option<String> {
    if let Some(t) = token_cache().lock().ok()?.get(project_ref).cloned() {
        return Some(t);
    }
    let tokens = tokio::task::spawn_blocking(linked_tokens).await.ok()?;
    for token in tokens {
        let Ok(projects) = request(&token, reqwest::Method::GET, "/projects", None).await else { continue };
        let found = projects.as_array().is_some_and(|ps| ps.iter().any(|p| p.get("ref").and_then(Value::as_str) == Some(project_ref)));
        if found {
            token_cache().lock().ok()?.insert(project_ref.to_string(), token.clone());
            return Some(token);
        }
    }
    None
}

/// `resolveEdgeAccess` (shared by Edge Functions, Auth admin and PayKit deploys).
pub async fn resolve_access(info: Option<ConnInfo>) -> Result<Option<Access>> {
    let Some(info) = info else { return Ok(None) };
    match info.kind {
        ConnKind::Mgmt => {
            let token = info.token.ok_or_else(|| anyhow!("Invalid Supabase management connection."))?;
            Ok(Some(Access { project_ref: info.project_ref, token }))
        }
        ConnKind::Postgres => match token_for_ref(&info.project_ref).await {
            Some(token) => Ok(Some(Access { project_ref: info.project_ref, token })),
            None => bail!("No linked Supabase account can access this project. Link your Supabase account to manage Edge Functions."),
        },
    }
}

pub fn http() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().unwrap_or_default())
        .clone()
}

/// `mgmtRequest`: empty bodies parse as `Null`; non-2xx surfaces the upstream
/// `message`/`error` as `Supabase API <status>: <detail>`.
pub async fn request(token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value> {
    let mut req = http().request(method, format!("{API}{path}")).bearer_auth(token).header("User-Agent", "supabase-cli");
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().await?;
    read_response(res).await
}

pub async fn read_response(res: reqwest::Response) -> Result<Value> {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("Supabase API {}: {}", status.as_u16(), error_detail(&text, status.canonical_reason().unwrap_or("")));
    }
    if text.is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

pub fn error_detail(text: &str, fallback: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(text).ok();
    parsed
        .as_ref()
        .and_then(|p| p.get("message").or_else(|| p.get("error")).and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| if text.is_empty() { fallback.to_string() } else { text.to_string() })
}

/// encodeURIComponent.
pub fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_ref() {
        assert_eq!(infer_ref_from_postgres_url("postgresql://postgres:x@db.abcd1234.supabase.co:5432/postgres").as_deref(), Some("abcd1234"));
        assert_eq!(infer_ref_from_postgres_url("postgres://localhost/postgres"), None);
        assert_eq!(infer_ref_from_postgres_url("mysql://db.abc.supabase.co/x"), None);
    }

    #[test]
    fn resolves_mgmt() {
        let info = resolve_connection("supabase-mgmt", "supabase-mgmt://ref1?token=sbp_1").unwrap();
        assert_eq!(info.kind, ConnKind::Mgmt);
        assert_eq!(info.project_ref, "ref1");
        assert_eq!(info.token.as_deref(), Some("sbp_1"));
        assert!(resolve_connection("mysql", "mysql://x").is_none());
    }

    #[test]
    fn detail_prefers_message() {
        assert_eq!(error_detail(r#"{"message":"nope"}"#, "x"), "nope");
        assert_eq!(error_detail("", "Bad"), "Bad");
        assert_eq!(enc("a b/c"), "a%20b%2Fc");
    }
}
