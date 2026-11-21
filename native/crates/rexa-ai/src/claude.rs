//! Minimal client for Anthropic's Messages API. Kept independent of the UI so
//! the agent view can compose database context and tools around it.

use anyhow::{bail, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

#[derive(Clone, Debug, Default)]
pub struct Completion {
    pub text: String,
    pub stop_reason: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Read Anthropic credentials and the selected model from Settings → AI, then
/// send the request. The settings schema matches `rexa-settings::ai::normalize`.
pub async fn complete_configured(system: Option<&str>, messages: &[Message], max_tokens: u32) -> Result<Completion> {
    let raw = rexa_store::Store::open()?.global_ai_settings_json()?.unwrap_or_else(|| "{}".into());
    let settings: serde_json::Value = serde_json::from_str(&raw).context("Saved AI settings are invalid")?;
    let provider = settings.get("defaultProvider").and_then(serde_json::Value::as_str).unwrap_or("");
    if provider != "anthropic" { bail!("Select Anthropic as the default provider in Settings → AI."); }
    let model = settings.get("defaultModel").and_then(serde_json::Value::as_str).unwrap_or("");
    let config = settings.pointer("/providers/anthropic").ok_or_else(|| anyhow::anyhow!("Anthropic is not configured in Settings → AI."))?;
    let api_key = config.get("apiKey").and_then(serde_json::Value::as_str).unwrap_or("");
    let base_url = config.get("baseUrl").and_then(serde_json::Value::as_str);
    complete(api_key, model, base_url, system, messages, max_tokens).await
}

/// Send conversation history to Anthropic's Messages endpoint.
///
/// `base_url` may be `https://api.anthropic.com` or an Anthropic-compatible
/// gateway URL ending in `/v1`. API keys are passed by the caller and are never
/// persisted by this client.
pub async fn complete(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: Option<&str>,
    messages: &[Message],
    max_tokens: u32,
) -> Result<Completion> {
    let api_key = api_key.trim();
    if api_key.is_empty() { bail!("Configure an Anthropic API key in Settings → AI first."); }
    if model.trim().is_empty() { bail!("Choose a Claude model first."); }
    if messages.is_empty() { bail!("Add a user message before requesting a response."); }
    if max_tokens == 0 { bail!("The response token limit must be greater than zero."); }

    let base = base_url.filter(|s| !s.trim().is_empty()).unwrap_or("https://api.anthropic.com").trim().trim_end_matches('/');
    let endpoint = if base.ends_with("/v1") { format!("{base}/messages") } else { format!("{base}/v1/messages") };
    let mut headers = HeaderMap::new();
    headers.insert("x-api-key", HeaderValue::from_str(api_key).context("Anthropic API key contains invalid header characters")?);
    headers.insert("anthropic-version", HeaderValue::from_static(ANTHROPIC_VERSION));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let mut body = serde_json::json!({ "model": model.trim(), "max_tokens": max_tokens, "messages": messages });
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) { body["system"] = serde_json::Value::String(system.to_string()); }
    let response = reqwest::Client::new().post(endpoint).headers(headers).json(&body).send().await.context("Could not reach Anthropic Messages API")?;
    let status = response.status();
    let payload: serde_json::Value = response.json().await.context("Anthropic returned an invalid response")?;
    if !status.is_success() {
        let message = payload.pointer("/error/message").and_then(serde_json::Value::as_str).unwrap_or("request failed");
        bail!("Anthropic API returned HTTP {status}: {message}");
    }
    let text = payload.get("content").and_then(serde_json::Value::as_array).into_iter().flatten()
        .filter(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>().join("");
    Ok(Completion {
        text,
        stop_reason: payload.get("stop_reason").and_then(serde_json::Value::as_str).map(str::to_string),
        input_tokens: payload.pointer("/usage/input_tokens").and_then(serde_json::Value::as_u64),
        output_tokens: payload.pointer("/usage/output_tokens").and_then(serde_json::Value::as_u64),
    })
}
