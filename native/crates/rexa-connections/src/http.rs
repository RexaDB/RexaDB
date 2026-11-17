//! Minimal HTTP for the provider account screens. The old app routed these
//! calls through the sidecar's CORS proxies (`/api/supabase-mgmt/proxy`,
//! `/api/planetscale/proxy`, `/api/spacetimedb-mgmt/proxy`); natively we call
//! the upstream APIs directly with the same headers. Runs on the Tokio runtime.

use anyhow::{bail, Result};

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder().user_agent("supabase-cli").build()?)
}

pub async fn get_json(url: &str, bearer: &str) -> Result<serde_json::Value> {
    let res = client()?.get(url).bearer_auth(bearer).header("Accept", "application/json").send().await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("API {}: {}", status.as_u16(), text.chars().take(300).collect::<String>());
    }
    Ok(serde_json::from_str(&text)?)
}

pub async fn post_json(url: &str, bearer: &str, body: serde_json::Value) -> Result<serde_json::Value> {
    let res = client()?.post(url).bearer_auth(bearer).json(&body).send().await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("API {}: {}", status.as_u16(), text.chars().take(300).collect::<String>());
    }
    Ok(serde_json::from_str(&text)?)
}

pub async fn get_bytes(url: &str) -> Result<Vec<u8>> {
    let res = client()?.get(url).send().await?;
    if !res.status().is_success() {
        bail!("Download failed ({})", res.status().as_u16());
    }
    Ok(res.bytes().await?.to_vec())
}
