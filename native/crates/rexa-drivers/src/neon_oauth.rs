//! Resolves native `neon-cli://` connection pointers into short-lived DSNs.
//! OAuth refresh tokens stay in the OS keychain with the rest of the account.
//! Also exposes Neon Realtime management APIs used by the studio grid.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

const ACCOUNTS_KEY: &str = "rexadb-neon-cli-profiles";
const NEON_API: &str = "https://console.neon.tech/api/v2";

/// Parsed `neon-cli://profile/project/branch/db?role=` pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeonPointer {
    pub profile: String,
    pub project_id: String,
    pub branch_id: String,
    pub database: String,
    pub role: String,
}

/// `NeonRealtimeState` from `lib/neon-oauth/api.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct NeonRealtimeState {
    pub enabled: bool,
    pub pending: bool,
    #[serde(default)]
    pub invocation_url: Option<String>,
    #[serde(default)]
    pub allowed_origins: Option<Vec<String>>,
}

pub fn is_pointer(connection_string: &str) -> bool {
    connection_string
        .trim()
        .to_ascii_lowercase()
        .starts_with("neon-cli://")
}

/// `parseNeonCliConnectionString`.
pub fn parse_pointer(connection_string: &str) -> Option<NeonPointer> {
    let parsed = Url::parse(connection_string.trim()).ok()?;
    if parsed.scheme() != "neon-cli" {
        return None;
    }
    let mut parts = Vec::new();
    if !parsed.host_str().unwrap_or_default().is_empty() {
        parts.push(percent_decode(parsed.host_str().unwrap_or_default()));
    }
    parts.extend(
        parsed
            .path_segments()
            .into_iter()
            .flatten()
            .filter(|part| !part.is_empty())
            .map(percent_decode),
    );
    if parts.len() != 4 {
        return None;
    }
    let role = parsed
        .query_pairs()
        .find(|(key, _)| key == "role")
        .map(|(_, value)| value.into_owned())
        .filter(|role| !role.is_empty())?;
    Some(NeonPointer {
        profile: parts[0].clone(),
        project_id: parts[1].clone(),
        branch_id: parts[2].clone(),
        database: parts[3].clone(),
        role,
    })
}

pub async fn resolve_pointer(pointer: &str) -> Result<String> {
    let pointer = parse_pointer(pointer).ok_or_else(|| {
        anyhow::anyhow!(
            "Invalid Neon connection pointer. Reopen Connections and connect to the Neon project again."
        )
    })?;
    let token = profile_access_token(&pointer.profile).await?;

    let mut endpoint = Url::parse(&format!("{NEON_API}/"))?;
    endpoint
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Invalid Neon API endpoint"))?
        .push("projects")
        .push(&pointer.project_id)
        .push("connection_uri");
    endpoint
        .query_pairs_mut()
        .append_pair("database_name", &pointer.database)
        .append_pair("role_name", &pointer.role)
        .append_pair("branch_id", &pointer.branch_id)
        .append_pair("pooled", "true");
    let response = reqwest::Client::new()
        .get(endpoint)
        .bearer_auth(token)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        bail!(
            "Neon could not resolve this database connection ({status}): {}",
            body.chars().take(300).collect::<String>()
        );
    }
    let result: Value =
        serde_json::from_str(&body).context("Neon returned an invalid connection response")?;
    let dsn = result
        .get("uri")
        .or_else(|| result.get("connection_uri"))
        .and_then(Value::as_str)
        .filter(|uri| uri.starts_with("postgres://") || uri.starts_with("postgresql://"))
        .ok_or_else(|| {
            anyhow::anyhow!("Neon API did not return a valid PostgreSQL connection URI")
        })?;
    Ok(dsn.to_string())
}

fn realtime_path(project_id: &str, branch_id: &str, suffix: &str) -> String {
    format!(
        "{NEON_API}/projects/{}/branches/{}/realtime{suffix}",
        urlencoding(project_id),
        urlencoding(branch_id),
    )
}

/// `getRealtimeState`.
pub async fn get_realtime_state(
    profile: &str,
    project_id: &str,
    branch_id: &str,
) -> Result<NeonRealtimeState> {
    let text = neon_request(profile, &realtime_path(project_id, branch_id, ""), "GET", None).await?;
    serde_json::from_str(&text).context("Invalid Neon Realtime state response")
}

/// Enabling permanently sets wal_level=logical for the whole project.
pub async fn enable_realtime(
    profile: &str,
    project_id: &str,
    branch_id: &str,
    allowed_origins: Option<&[String]>,
) -> Result<()> {
    let body = match allowed_origins {
        Some(origins) if !origins.is_empty() => {
            Some(serde_json::json!({ "allowed_origins": origins }))
        }
        _ => Some(serde_json::json!({})),
    };
    neon_request(profile, &realtime_path(project_id, branch_id, ""), "POST", body).await?;
    Ok(())
}

pub async fn disable_realtime(profile: &str, project_id: &str, branch_id: &str) -> Result<()> {
    neon_request(profile, &realtime_path(project_id, branch_id, ""), "DELETE", None).await?;
    Ok(())
}

pub async fn rotate_realtime_secret(profile: &str, project_id: &str, branch_id: &str) -> Result<()> {
    neon_request(
        profile,
        &realtime_path(project_id, branch_id, "/rotate_secret"),
        "POST",
        None,
    )
    .await?;
    Ok(())
}

/// Server-only Realtime secret used to seal live queries. 404 while disabled.
pub async fn get_realtime_secret(profile: &str, project_id: &str, branch_id: &str) -> Result<String> {
    #[derive(Deserialize)]
    struct SecretBody {
        secret: String,
    }
    let text = neon_request(
        profile,
        &realtime_path(project_id, branch_id, "/secret"),
        "GET",
        None,
    )
    .await?;
    let body: SecretBody =
        serde_json::from_str(&text).context("Invalid Neon Realtime secret response")?;
    Ok(body.secret)
}

async fn neon_request(
    profile: &str,
    path: &str,
    method: &str,
    body: Option<Value>,
) -> Result<String> {
    let token = profile_access_token(profile).await?;
    let client = reqwest::Client::new();
    let request = match method {
        "GET" => client.get(path),
        "POST" => client.post(path),
        "DELETE" => client.delete(path),
        other => bail!("Unsupported Neon API method {other}"),
    };
    let request = request.bearer_auth(&token).header("Accept", "application/json");
    let request = if let Some(body) = body {
        request.header("Content-Type", "application/json").json(&body)
    } else {
        request
    };
    let response = request.send().await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        bail!(
            "Neon API {method} {path} failed ({status}): {}",
            text.chars().take(300).collect::<String>()
        );
    }
    Ok(text)
}

async fn profile_access_token(profile: &str) -> Result<String> {
    let store = rexa_store::Store::open()?;
    let raw = store
        .setting(ACCOUNTS_KEY)?
        .ok_or_else(|| anyhow::anyhow!("Neon account was removed. Reconnect it in Connections."))?;
    let mut accounts: Vec<Value> =
        serde_json::from_str(&raw).context("Saved Neon account list is invalid")?;
    let account = accounts
        .iter_mut()
        .find(|account| {
            account
                .get("profileName")
                .and_then(Value::as_str)
                .is_some_and(|saved| saved.eq_ignore_ascii_case(profile))
        })
        .ok_or_else(|| {
            anyhow::anyhow!("Neon account '{profile}' was removed. Reconnect it in Connections.")
        })?;
    let credential_ref = account
        .get("credentialRef")
        .and_then(Value::as_str)
        .map(str::to_string);
    let credential = if let Some(reference) = &credential_ref {
        rexa_store::read_account_token(reference)
            .context("Could not unlock Neon account credentials")?
    } else {
        account
            .get("accessToken")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Neon account credentials are missing"))?
            .to_string()
    };
    let (token, refreshed_bundle) = access_token(&credential).await?;
    if let (Some(bundle), Some(old_ref)) = (refreshed_bundle, credential_ref) {
        let new_ref = rexa_store::store_account_token(&bundle)?;
        account
            .as_object_mut()
            .context("Invalid Neon account entry")?
            .insert("credentialRef".into(), Value::String(new_ref));
        store.set_setting(ACCOUNTS_KEY, &Value::Array(accounts).to_string())?;
        let _ = rexa_store::delete_credential(&old_ref);
    }
    Ok(token)
}

fn urlencoding(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}

async fn access_token(saved: &str) -> Result<(String, Option<String>)> {
    let Ok(mut credentials) = serde_json::from_str::<Value>(saved) else {
        return Ok((saved.to_string(), None));
    };
    if credentials.get("type").and_then(Value::as_str) != Some("oauth") {
        return Ok((saved.to_string(), None));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis() as u64;
    let expires_at = credentials
        .get("expires_at")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let refreshed = if expires_at <= now + 120_000 {
        let refresh = credentials
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or_else(|| {
                anyhow::anyhow!("Neon sign-in expired. Reconnect this account in Connections.")
            })?
            .to_string();
        let discovery: Value = reqwest::Client::new()
            .get("https://oauth2.neon.tech/.well-known/openid-configuration")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let endpoint = discovery
            .get("token_endpoint")
            .and_then(Value::as_str)
            .filter(|url| url.starts_with("https://"))
            .ok_or_else(|| anyhow::anyhow!("Neon OAuth did not provide a valid token endpoint"))?;
        let response = reqwest::Client::new()
            .post(endpoint)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.as_str()),
                ("client_id", "neonctl"),
            ])
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            bail!("Neon sign-in expired ({status}). Reconnect this account in Connections.");
        }
        let next: Value = serde_json::from_str(&body)
            .context("Neon returned an invalid token refresh response")?;
        let access = next
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or_else(|| anyhow::anyhow!("Neon token refresh did not return an access token"))?
            .to_string();
        let expires_in = next
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(3600);
        credentials["access_token"] = Value::String(access);
        credentials["refresh_token"] = next
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(|value| Value::String(value.into()))
            .unwrap_or(Value::String(refresh));
        credentials["expires_at"] = Value::from(now + expires_in * 1000);
        for key in ["id_token", "token_type", "scope"] {
            if let Some(value) = next.get(key) {
                credentials[key] = value.clone();
            }
        }
        true
    } else {
        false
    };
    let access = credentials
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Neon credentials do not include an access token"))?
        .to_string();
    Ok((access, refreshed.then(|| credentials.to_string())))
}

fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}
