//! Resolves native `neon-cli://` connection pointers into short-lived DSNs.
//! OAuth refresh tokens stay in the OS keychain with the rest of the account.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use url::Url;

const ACCOUNTS_KEY: &str = "rexadb-neon-cli-profiles";

pub fn is_pointer(connection_string: &str) -> bool {
    connection_string
        .trim()
        .to_ascii_lowercase()
        .starts_with("neon-cli://")
}

pub async fn resolve_pointer(pointer: &str) -> Result<String> {
    let parsed = Url::parse(pointer).context("Invalid Neon connection pointer")?;
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
        bail!("Invalid Neon connection pointer. Reopen Connections and connect to the Neon project again.");
    }
    let [profile, project, branch, database] = [
        parts[0].clone(),
        parts[1].clone(),
        parts[2].clone(),
        parts[3].clone(),
    ];
    let role = parsed
        .query_pairs()
        .find(|(key, _)| key == "role")
        .map(|(_, value)| value.into_owned())
        .filter(|role| !role.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Neon connection pointer is missing its database role"))?;

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
                .is_some_and(|saved| saved.eq_ignore_ascii_case(&profile))
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

    let mut endpoint = Url::parse("https://console.neon.tech/api/v2/")?;
    endpoint
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Invalid Neon API endpoint"))?
        .push("projects")
        .push(&project)
        .push("connection_uri");
    endpoint
        .query_pairs_mut()
        .append_pair("database_name", &database)
        .append_pair("role_name", &role)
        .append_pair("branch_id", &branch)
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
