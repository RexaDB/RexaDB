//! Client for the workspace (`studio-backend`) API used by the Team screen and
//! the workspace tabs. Mirrors `lib/studio-backend/api-client.ts`: requests go
//! to `<studioUrl>/studio-api/api<path>` with the saved bearer token and the
//! response is unwrapped from `{ success, data }`.

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

pub const STUDIO_CONFIG_KEY: &str = "studio_backend_config";
pub const WORKSPACE_LIST_KEY: &str = "workspace_list";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Auth {
    pub url: String,
    pub token: String,
    pub user_id: String,
}

impl Auth {
    pub fn is_configured(&self) -> bool {
        !self.url.trim().is_empty()
    }
}

/// The active workspace config (`app_settings.studio_backend_config`).
pub fn active() -> Option<Auth> {
    let raw = rexa_store::Store::open()
        .ok()?
        .setting(STUDIO_CONFIG_KEY)
        .ok()
        .flatten()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    Some(Auth {
        url: v.get("studioUrl")?.as_str()?.to_string(),
        token: v
            .get("studioToken")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        user_id: v
            .get("userId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

pub fn save_config(url: &str, token: &str, user_id: &str) -> Result<()> {
    let url = trim_url(url);
    if url.is_empty() {
        bail!("Enter your studio backend URL");
    }
    let store = rexa_store::Store::open()?;
    store.set_setting(
        STUDIO_CONFIG_KEY,
        &json!({ "studioUrl": url, "studioToken": token, "userId": user_id }).to_string(),
    )?;
    // Keep the workspace list in sync (ensureActiveWorkspaceInList).
    let mut list = workspaces();
    if !list
        .iter()
        .any(|w| w.get("studioUrl").and_then(Value::as_str) == Some(url.as_str()))
    {
        list.push(
            json!({ "studioUrl": url, "studioToken": token, "userId": user_id, "name": url }),
        );
        store.set_setting(WORKSPACE_LIST_KEY, &Value::Array(list).to_string())?;
    }
    Ok(())
}

pub fn trim_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

pub fn workspaces() -> Vec<Value> {
    rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting(WORKSPACE_LIST_KEY).ok().flatten())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

pub fn save_workspaces(list: &[Value]) -> Result<()> {
    rexa_store::Store::open()?
        .set_setting(WORKSPACE_LIST_KEY, &Value::Array(list.to_vec()).to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("RexaDB")
        .build()
        .expect("http client")
}

fn endpoint(auth: &Auth, path: &str) -> String {
    format!("{}/studio-api/api{}", trim_url(&auth.url), path)
}

async fn send(
    auth: &Auth,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    with_auth: bool,
) -> Result<Value> {
    if !auth.is_configured() {
        bail!("No workspace is connected. Add one in Settings → Workspace.");
    }
    let mut req = client()
        .request(method, endpoint(auth, path))
        .header("Content-Type", "application/json");
    if with_auth && !auth.token.is_empty() {
        req = req.bearer_auth(&auth.token);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req
        .send()
        .await
        .map_err(|e| anyhow!("Could not reach the workspace API: {e}"))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let message = parsed
            .get("error")
            .and_then(Value::as_str)
            .or_else(|| parsed.get("message").and_then(Value::as_str))
            .unwrap_or(if text.is_empty() {
                "Workspace API error"
            } else {
                text.as_str()
            });
        if status.as_u16() == 401 {
            bail!("Workspace session expired. Connect again in Settings → Workspace.");
        }
        bail!("{message}");
    }
    Ok(unwrap(parsed))
}

/// `{ success, data }` → `data`; plain payloads pass through.
fn unwrap(value: Value) -> Value {
    value.get("data").cloned().unwrap_or(value)
}

pub async fn get(auth: &Auth, path: &str) -> Result<Value> {
    send(auth, reqwest::Method::GET, path, None, true).await
}

pub async fn post(auth: &Auth, path: &str, body: Value) -> Result<Value> {
    send(auth, reqwest::Method::POST, path, Some(body), true).await
}

pub async fn put(auth: &Auth, path: &str, body: Value) -> Result<Value> {
    send(auth, reqwest::Method::PUT, path, Some(body), true).await
}

pub async fn delete(auth: &Auth, path: &str) -> Result<Value> {
    send(auth, reqwest::Method::DELETE, path, None, true).await
}

/// `POST /invites/accept` — public, then persists the returned session.
pub async fn accept_invite(url: &str, token: &str, name: &str, email: &str) -> Result<Auth> {
    let auth = Auth {
        url: trim_url(url),
        token: String::new(),
        user_id: String::new(),
    };
    let data = send(
        &auth,
        reqwest::Method::POST,
        "/invites/accept",
        Some(json!({ "token": token.trim(), "name": name.trim(), "email": email.trim().to_lowercase() })),
        false,
    )
    .await?;
    let user_id = text(&data, "userId");
    let studio_token = text(&data, "studioToken");
    save_config(&auth.url, &studio_token, &user_id)?;
    Ok(Auth {
        url: auth.url,
        token: studio_token,
        user_id,
    })
}

pub fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| {
            x.as_str()
                .map(str::to_string)
                .or_else(|| x.as_i64().map(|n| n.to_string()))
        })
        .unwrap_or_default()
}

pub fn num(v: &Value, key: &str) -> u64 {
    v.get(key)
        .and_then(Value::as_u64)
        .or_else(|| {
            v.get(key)
                .and_then(Value::as_str)
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0)
}

pub fn list(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwraps_api_envelope() {
        assert_eq!(
            unwrap(json!({"success": true, "data": [1, 2]})),
            json!([1, 2])
        );
        assert_eq!(unwrap(json!({"items": []})), json!({"items": []}));
    }

    #[test]
    fn trims_trailing_slashes() {
        assert_eq!(trim_url("https://x.dev///"), "https://x.dev");
    }

    #[test]
    fn reads_numbers_from_strings() {
        assert_eq!(num(&json!({"userCount": "4"}), "userCount"), 4);
        assert_eq!(num(&json!({"userCount": 7}), "userCount"), 7);
    }
}
