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
pub async fn complete_configured(
    system: Option<&str>,
    messages: &[Message],
    max_tokens: u32,
) -> Result<Completion> {
    let raw = rexa_store::Store::open()?
        .global_ai_settings_json()?
        .unwrap_or_else(|| "{}".into());
    let settings: serde_json::Value =
        serde_json::from_str(&raw).context("Saved AI settings are invalid")?;
    let provider = settings
        .get("defaultProvider")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let model = settings
        .get("defaultModel")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let config = settings
        .pointer(&format!("/providers/{provider}"))
        .ok_or_else(|| anyhow::anyhow!("Configure the selected provider in Settings → AI."))?;
    let api_key = config
        .get("apiKey")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let base_url = config.get("baseUrl").and_then(serde_json::Value::as_str);
    match provider {
        "anthropic" => complete(api_key, model, base_url, system, messages, max_tokens).await,
        "openai" | "openrouter" | "kilo" | "ollama" | "external" => {
            complete_openai_compatible(
                provider, api_key, model, base_url, system, messages, max_tokens,
            )
            .await
        }
        "google" => complete_google(api_key, model, base_url, system, messages, max_tokens).await,
        "" => bail!("Choose a default provider and model in Settings → AI."),
        other => bail!("The native chat client does not support the `{other}` provider yet."),
    }
}

async fn complete_google(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: Option<&str>,
    messages: &[Message],
    max_tokens: u32,
) -> Result<Completion> {
    if api_key.trim().is_empty() {
        bail!("Configure a Google AI API key in Settings → AI.");
    }
    if model.trim().is_empty() {
        bail!("Choose a Gemini model in Settings → AI.");
    }
    if messages.is_empty() {
        bail!("Add a user message before requesting a response.");
    }
    if max_tokens == 0 {
        bail!("The response token limit must be greater than zero.");
    }

    let base = base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
        .trim()
        .trim_end_matches('/');
    let endpoint = if base.contains(":generateContent") {
        url::Url::parse(base).context("Google AI base URL is invalid")?
    } else {
        let model =
            url::form_urlencoded::byte_serialize(model.trim().as_bytes()).collect::<String>();
        url::Url::parse(&format!("{base}/models/{model}:generateContent"))
            .context("Google AI base URL is invalid")?
    };
    let mut endpoint = endpoint;
    endpoint
        .query_pairs_mut()
        .append_pair("key", api_key.trim());

    let contents: Vec<_> = messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "role": match message.role { Role::User => "user", Role::Assistant => "model" },
                "parts": [{"text": message.content}],
            })
        })
        .collect();
    let mut body = serde_json::json!({
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_tokens},
    });
    if let Some(system) = system.filter(|text| !text.trim().is_empty()) {
        body["systemInstruction"] = serde_json::json!({"parts": [{"text": system}]});
    }
    let response = reqwest::Client::new()
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .context("Could not reach Google Gemini")?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .context("Google Gemini returned an invalid response")?;
    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("request failed");
        bail!("Google Gemini returned HTTP {status}: {message}");
    }
    let text = payload
        .pointer("/candidates/0/content/parts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    Ok(Completion {
        text,
        stop_reason: payload
            .pointer("/candidates/0/finishReason")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        input_tokens: payload
            .pointer("/usageMetadata/promptTokenCount")
            .and_then(serde_json::Value::as_u64),
        output_tokens: payload
            .pointer("/usageMetadata/candidatesTokenCount")
            .and_then(serde_json::Value::as_u64),
    })
}

/// OpenAI Chat Completions-compatible providers used by Settings → AI.
async fn complete_openai_compatible(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: Option<&str>,
    messages: &[Message],
    max_tokens: u32,
) -> Result<Completion> {
    if model.trim().is_empty() {
        bail!("Choose a model in Settings → AI.");
    }
    if messages.is_empty() {
        bail!("Add a user message before requesting a response.");
    }
    if max_tokens == 0 {
        bail!("The response token limit must be greater than zero.");
    }
    if provider != "ollama" && api_key.trim().is_empty() {
        bail!("Configure an API key for this provider in Settings → AI.");
    }

    let default_base = match provider {
        "openai" => "https://api.openai.com/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "kilo" => "https://api.kilo.ai/api/gateway",
        "ollama" => "http://localhost:11434/v1",
        _ => "",
    };
    let base = base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(default_base)
        .trim()
        .trim_end_matches('/');
    if base.is_empty() {
        bail!("Enter a base URL for the custom AI provider in Settings → AI.");
    }
    let endpoint = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    };

    let mut request_messages = Vec::with_capacity(messages.len() + 1);
    if let Some(system) = system.filter(|text| !text.trim().is_empty()) {
        request_messages.push(serde_json::json!({"role":"system", "content":system}));
    }
    request_messages.extend(messages.iter().map(|message| {
        serde_json::json!({
            "role": match message.role { Role::User => "user", Role::Assistant => "assistant" },
            "content": message.content,
        })
    }));
    let client = reqwest::Client::new();
    let mut request = client.post(endpoint).json(&serde_json::json!({
        "model": model.trim(),
        "messages": request_messages,
        "max_tokens": max_tokens,
    }));
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .send()
        .await
        .context("Could not reach the selected AI provider")?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .context("The AI provider returned an invalid response")?;
    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                payload
                    .pointer("/error")
                    .and_then(serde_json::Value::as_str)
            })
            .unwrap_or("request failed");
        bail!("AI provider returned HTTP {status}: {message}");
    }
    let text = payload
        .pointer("/choices/0/message/content")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    Ok(Completion {
        text,
        stop_reason: payload
            .pointer("/choices/0/finish_reason")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        input_tokens: payload
            .pointer("/usage/prompt_tokens")
            .and_then(serde_json::Value::as_u64),
        output_tokens: payload
            .pointer("/usage/completion_tokens")
            .and_then(serde_json::Value::as_u64),
    })
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
    if api_key.is_empty() {
        bail!("Configure an Anthropic API key in Settings → AI first.");
    }
    if model.trim().is_empty() {
        bail!("Choose a Claude model first.");
    }
    if messages.is_empty() {
        bail!("Add a user message before requesting a response.");
    }
    if max_tokens == 0 {
        bail!("The response token limit must be greater than zero.");
    }

    let base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("https://api.anthropic.com")
        .trim()
        .trim_end_matches('/');
    let endpoint = if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key)
            .context("Anthropic API key contains invalid header characters")?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static(ANTHROPIC_VERSION),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let mut body = serde_json::json!({ "model": model.trim(), "max_tokens": max_tokens, "messages": messages });
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        body["system"] = serde_json::Value::String(system.to_string());
    }
    let response = reqwest::Client::new()
        .post(endpoint)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .context("Could not reach Anthropic Messages API")?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .context("Anthropic returned an invalid response")?;
    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("request failed");
        bail!("Anthropic API returned HTTP {status}: {message}");
    }
    let text = payload
        .get("content")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    Ok(Completion {
        text,
        stop_reason: payload
            .get("stop_reason")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        input_tokens: payload
            .pointer("/usage/input_tokens")
            .and_then(serde_json::Value::as_u64),
        output_tokens: payload
            .pointer("/usage/output_tokens")
            .and_then(serde_json::Value::as_u64),
    })
}
