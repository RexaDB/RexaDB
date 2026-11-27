//! Streaming, tool-using model clients — the native replacement for the Pi SDK
//! session the sidecar built in lib/ai/pi-agent.ts (`parsePiModelSpec`):
//! Anthropic Messages, OpenAI-compatible Chat Completions (openai, openrouter,
//! kilo, ollama, custom base URLs) and Google Gemini.
//!
//! The conversation is kept in Anthropic's block format (`text`, `tool_use`,
//! `tool_result`, plus provider-opaque blocks such as `thinking` that are only
//! echoed back to the provider that produced them) and translated per provider.
//! Requests go only to the endpoint the user configured in Settings → AI.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

const ANTHROPIC_VERSION: &str = "2023-06-01";
pub const MAX_TOKENS: u32 = 32000;

#[derive(Clone, Debug, PartialEq)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// One message of the running conversation (Anthropic block format).
#[derive(Clone, Debug)]
pub struct Msg {
    pub role: &'static str,
    pub content: Vec<Value>,
}

impl Msg {
    pub fn user_text(text: impl Into<String>) -> Self {
        Msg { role: "user", content: vec![json!({"type": "text", "text": text.into()})] }
    }
    pub fn assistant_text(text: impl Into<String>) -> Self {
        Msg { role: "assistant", content: vec![json!({"type": "text", "text": text.into()})] }
    }
}

#[derive(Clone, Debug)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// `Err` when the streamed arguments were not valid JSON.
    pub input: Result<Value, String>,
}

/// One assistant turn.
#[derive(Clone, Debug, Default)]
pub struct Turn {
    /// Assistant content blocks to append to the history verbatim.
    pub blocks: Vec<Value>,
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: Option<String>,
}

pub struct Stream<'a> {
    pub on_text: &'a mut (dyn FnMut(&str) + Send),
    pub cancel: &'a AtomicBool,
}


/// Run one model turn with streaming.
pub async fn stream_turn(cfg: &ProviderConfig, system: &str, messages: &[Msg], tools: &[ToolSpec], max_tokens: u32, stream: Stream<'_>) -> Result<Turn> {
    match cfg.provider.as_str() {
        "anthropic" => anthropic_turn(cfg, system, messages, tools, max_tokens, stream).await,
        "google" => gemini_turn(cfg, system, messages, tools, max_tokens, stream).await,
        _ => openai_turn(cfg, system, messages, tools, max_tokens, stream).await,
    }
}

// ---- SSE ---------------------------------------------------------------------------------

/// Pull `data:` payloads out of a response body as they arrive.
async fn for_each_sse(mut response: reqwest::Response, cancel: &AtomicBool, mut f: impl FnMut(&str) -> Result<()>) -> Result<()> {
    let mut buf = String::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let Some(chunk) = response.chunk().await.context("The AI stream was interrupted")? else { break };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim_start();
                if !data.is_empty() && data != "[DONE]" {
                    f(data)?;
                }
            }
        }
    }
    if let Some(data) = buf.trim().strip_prefix("data:") {
        let data = data.trim();
        if !data.is_empty() && data != "[DONE]" {
            f(data)?;
        }
    }
    Ok(())
}

async fn error_message(response: reqwest::Response, label: &str) -> anyhow::Error {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let message = parsed
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| parsed.pointer("/error").and_then(Value::as_str))
        .or_else(|| parsed.pointer("/0/error/message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| if body.len() < 400 && !body.trim().is_empty() { body.trim().to_string() } else { "request failed".into() });
    anyhow::anyhow!("{label} returned HTTP {status}: {message}")
}

fn parse_args(raw: &str) -> Result<Value, String> {
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    match serde_json::from_str::<Value>(raw) {
        Ok(v @ Value::Object(_)) => Ok(v),
        Ok(_) => Err("Tool input must be a JSON object.".into()),
        Err(e) => Err(format!("Tool input was not valid JSON: {e}")),
    }
}

// ---- Anthropic ---------------------------------------------------------------------------

fn anthropic_endpoint(base: Option<&str>) -> (String, bool) {
    let base = base.unwrap_or("https://api.anthropic.com").trim().trim_end_matches('/');
    let official = base == "https://api.anthropic.com" || base == "https://api.anthropic.com/v1";
    let url = if base.ends_with("/v1") { format!("{base}/messages") } else { format!("{base}/v1/messages") };
    (url, official)
}

/// Models that take the server-side refusal fallback (`fallbacks: "default"`).
fn supports_fallbacks(model: &str) -> bool {
    matches!(model, "claude-opus-5-5" | "claude-opus-5" | "claude-fable-5-1" | "claude-fable-5-2" | "claude-sonnet-5-5")
}

pub(crate) fn anthropic_body(cfg: &ProviderConfig, system: &str, messages: &[Msg], tools: &[ToolSpec], max_tokens: u32, official: bool) -> Value {
    let msgs: Vec<Value> = messages
        .iter()
        .map(|m| {
            let content: Vec<Value> = m.content.iter().filter(|b| !b.get("type").and_then(Value::as_str).is_some_and(|t| t.starts_with("gemini_"))).map(strip_private).collect();
            json!({"role": m.role, "content": content})
        })
        .collect();
    let mut body = json!({"model": cfg.model, "max_tokens": max_tokens, "messages": msgs, "stream": true});
    if !system.trim().is_empty() {
        body["system"] = Value::from(system);
    }
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| {
                let mut v = json!({"name": t.name, "description": t.description, "input_schema": t.input_schema});
                if official {
                    v["eager_input_streaming"] = Value::Bool(true);
                }
                v
            })
            .collect();
    }
    if official && supports_fallbacks(&cfg.model) {
        body["fallbacks"] = Value::from("default");
    }
    body
}

/// Drop our private bookkeeping fields (prefixed `_`) before sending.
fn strip_private(block: &Value) -> Value {
    match block {
        Value::Object(map) => Value::Object(map.iter().filter(|(k, _)| !k.starts_with('_')).map(|(k, v)| (k.clone(), v.clone())).collect()),
        other => other.clone(),
    }
}

async fn anthropic_turn(cfg: &ProviderConfig, system: &str, messages: &[Msg], tools: &[ToolSpec], max_tokens: u32, stream: Stream<'_>) -> Result<Turn> {
    if cfg.api_key.trim().is_empty() {
        bail!("Configure an Anthropic API key in Settings → AI first.");
    }
    let (url, official) = anthropic_endpoint(cfg.base_url.as_deref());
    let body = anthropic_body(cfg, system, messages, tools, max_tokens, official);
    let mut req = reqwest::Client::new()
        .post(url)
        .header("x-api-key", cfg.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body);
    if official && supports_fallbacks(&cfg.model) {
        req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }
    let response = req.send().await.context("Could not reach Anthropic Messages API")?;
    if !response.status().is_success() {
        return Err(error_message(response, "Anthropic API").await);
    }
    let mut turn = Turn::default();
    let mut blocks: Vec<Value> = Vec::new();
    let mut partial: Vec<String> = Vec::new();
    let mut error: Option<String> = None;
    let on_text = &mut *stream.on_text;
    for_each_sse(response, stream.cancel, |data| {
        let ev: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        match ev["type"].as_str().unwrap_or("") {
            "content_block_start" => {
                let idx = ev["index"].as_u64().unwrap_or(blocks.len() as u64) as usize;
                while blocks.len() <= idx {
                    blocks.push(Value::Null);
                    partial.push(String::new());
                }
                let mut block = ev["content_block"].clone();
                if block["type"] == "text" {
                    if let Some(t) = block["text"].as_str().filter(|t| !t.is_empty()) {
                        turn.text.push_str(t);
                        on_text(t);
                    }
                }
                if block["type"] == "tool_use" {
                    block["input"] = json!({});
                }
                blocks[idx] = block;
            }
            "content_block_delta" => {
                let idx = ev["index"].as_u64().unwrap_or(0) as usize;
                let Some(block) = blocks.get_mut(idx) else { return Ok(()) };
                let delta = &ev["delta"];
                match delta["type"].as_str().unwrap_or("") {
                    "text_delta" => {
                        let t = delta["text"].as_str().unwrap_or("");
                        let cur = block["text"].as_str().unwrap_or("").to_string();
                        block["text"] = Value::from(cur + t);
                        turn.text.push_str(t);
                        on_text(t);
                    }
                    "thinking_delta" => {
                        let cur = block["thinking"].as_str().unwrap_or("").to_string();
                        block["thinking"] = Value::from(cur + delta["thinking"].as_str().unwrap_or(""));
                    }
                    "signature_delta" => {
                        let cur = block["signature"].as_str().unwrap_or("").to_string();
                        block["signature"] = Value::from(cur + delta["signature"].as_str().unwrap_or(""));
                    }
                    "input_json_delta" => partial[idx].push_str(delta["partial_json"].as_str().unwrap_or("")),
                    _ => {}
                }
            }
            "content_block_stop" => {
                let idx = ev["index"].as_u64().unwrap_or(0) as usize;
                if let Some(block) = blocks.get_mut(idx) {
                    if block["type"] == "tool_use" {
                        let parsed = parse_args(&partial[idx]);
                        if let Ok(v) = &parsed {
                            block["input"] = v.clone();
                        }
                        turn.tool_calls.push(ToolCall { id: block["id"].as_str().unwrap_or("").to_string(), name: block["name"].as_str().unwrap_or("").to_string(), input: parsed });
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = ev.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    turn.stop_reason = Some(r.to_string());
                }
            }
            "error" => error = Some(ev.pointer("/error/message").and_then(Value::as_str).unwrap_or("stream error").to_string()),
            _ => {}
        }
        Ok(())
    })
    .await?;
    if let Some(e) = error {
        bail!("{e}");
    }
    turn.blocks = blocks.into_iter().filter(|b| !b.is_null()).collect();
    Ok(turn)
}

// ---- OpenAI-compatible -------------------------------------------------------------------

fn openai_endpoint(cfg: &ProviderConfig) -> Result<String> {
    let default_base = match cfg.provider.as_str() {
        "openai" => "https://api.openai.com/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "kilo" => "https://api.kilo.ai/api/gateway",
        "ollama" => "http://localhost:11434/v1",
        _ => "",
    };
    let base = cfg.base_url.as_deref().unwrap_or(default_base).trim().trim_end_matches('/');
    if base.is_empty() {
        bail!("Enter a base URL for the custom AI provider in Settings → AI.");
    }
    Ok(if base.ends_with("/chat/completions") { base.to_string() } else { format!("{base}/chat/completions") })
}

pub(crate) fn openai_messages(system: &str, messages: &[Msg]) -> Vec<Value> {
    let mut out = Vec::new();
    if !system.trim().is_empty() {
        out.push(json!({"role": "system", "content": system}));
    }
    for m in messages {
        if m.role == "assistant" {
            let text: String = m.content.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
            let calls: Vec<Value> = m
                .content
                .iter()
                .filter(|b| b["type"] == "tool_use")
                .map(|b| json!({"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": b["input"].to_string()}}))
                .collect();
            let mut msg = json!({"role": "assistant", "content": if text.is_empty() && !calls.is_empty() { Value::Null } else { Value::from(text) }});
            if !calls.is_empty() {
                msg["tool_calls"] = Value::Array(calls);
            }
            out.push(msg);
        } else {
            let text: String = m.content.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n");
            for r in m.content.iter().filter(|b| b["type"] == "tool_result") {
                out.push(json!({"role": "tool", "tool_call_id": r["tool_use_id"], "content": r["content"].as_str().unwrap_or("")}));
            }
            if !text.is_empty() {
                out.push(json!({"role": "user", "content": text}));
            }
        }
    }
    out
}

async fn openai_turn(cfg: &ProviderConfig, system: &str, messages: &[Msg], tools: &[ToolSpec], max_tokens: u32, stream: Stream<'_>) -> Result<Turn> {
    if cfg.provider != "ollama" && cfg.api_key.trim().is_empty() {
        bail!("Configure an API key for this provider in Settings → AI.");
    }
    let endpoint = openai_endpoint(cfg)?;
    let mut body = json!({"model": cfg.model, "messages": openai_messages(system, messages), "max_tokens": max_tokens, "stream": true});
    if !tools.is_empty() {
        body["tools"] = tools.iter().map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}})).collect();
    }
    let mut req = reqwest::Client::new().post(endpoint).json(&body);
    if !cfg.api_key.trim().is_empty() {
        req = req.bearer_auth(cfg.api_key.trim());
    }
    let response = req.send().await.context("Could not reach the selected AI provider")?;
    if !response.status().is_success() {
        return Err(error_message(response, "AI provider").await);
    }
    let mut turn = Turn::default();
    // index → (id, name, args)
    let mut calls: Vec<(String, String, String)> = Vec::new();
    let mut error = None;
    let on_text = &mut *stream.on_text;
    for_each_sse(response, stream.cancel, |data| {
        let ev: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(e) = ev.pointer("/error/message").and_then(Value::as_str) {
            error = Some(e.to_string());
        }
        let choice = &ev["choices"][0];
        if let Some(t) = choice.pointer("/delta/content").and_then(Value::as_str) {
            turn.text.push_str(t);
            on_text(t);
        }
        for tc in choice.pointer("/delta/tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let idx = tc["index"].as_u64().unwrap_or(calls.len() as u64) as usize;
            while calls.len() <= idx {
                calls.push(Default::default());
            }
            if let Some(id) = tc["id"].as_str() {
                calls[idx].0 = id.to_string();
            }
            if let Some(n) = tc.pointer("/function/name").and_then(Value::as_str) {
                calls[idx].1.push_str(n);
            }
            if let Some(a) = tc.pointer("/function/arguments").and_then(Value::as_str) {
                calls[idx].2.push_str(a);
            }
        }
        if let Some(r) = choice["finish_reason"].as_str() {
            turn.stop_reason = Some(match r {
                "tool_calls" => "tool_use".into(),
                "length" => "max_tokens".into(),
                "stop" => "end_turn".into(),
                other => other.to_string(),
            });
        }
        Ok(())
    })
    .await?;
    if let Some(e) = error {
        bail!("{e}");
    }
    if !turn.text.is_empty() {
        turn.blocks.push(json!({"type": "text", "text": turn.text}));
    }
    for (i, (id, name, args)) in calls.into_iter().enumerate() {
        let id = if id.is_empty() { format!("call_{}_{i}", crate::chat_store::random_id()) } else { id };
        let input = parse_args(&args);
        turn.blocks.push(json!({"type": "tool_use", "id": id, "name": name, "input": input.clone().unwrap_or(json!({}))}));
        turn.tool_calls.push(ToolCall { id, name, input });
    }
    if !turn.tool_calls.is_empty() && turn.stop_reason.as_deref() != Some("max_tokens") {
        turn.stop_reason = Some("tool_use".into());
    }
    Ok(turn)
}

// ---- Gemini ------------------------------------------------------------------------------

/// Gemini rejects object schemas without properties; drop them.
fn gemini_schema(schema: &Value) -> Option<Value> {
    if schema["properties"].as_object().is_some_and(|p| p.is_empty()) {
        return None;
    }
    Some(schema.clone())
}

pub(crate) fn gemini_contents(messages: &[Msg]) -> Vec<Value> {
    let mut names = std::collections::HashMap::new();
    let mut out = Vec::new();
    for m in messages {
        let mut parts = Vec::new();
        for b in &m.content {
            match b["type"].as_str().unwrap_or("") {
                "text" => {
                    if let Some(t) = b["text"].as_str().filter(|t| !t.is_empty()) {
                        parts.push(json!({"text": t}));
                    }
                }
                "tool_use" => {
                    names.insert(b["id"].as_str().unwrap_or("").to_string(), b["name"].clone());
                    let mut p = json!({"functionCall": {"name": b["name"], "args": b["input"]}});
                    if let Some(sig) = b.get("_gemini_signature") {
                        p["thoughtSignature"] = sig.clone();
                    }
                    parts.push(p);
                }
                "tool_result" => {
                    let name = names.get(b["tool_use_id"].as_str().unwrap_or("")).cloned().unwrap_or(Value::from("tool"));
                    parts.push(json!({"functionResponse": {"name": name, "response": {"result": b["content"]}}}));
                }
                _ => {}
            }
        }
        if !parts.is_empty() {
            out.push(json!({"role": if m.role == "assistant" { "model" } else { "user" }, "parts": parts}));
        }
    }
    out
}

async fn gemini_turn(cfg: &ProviderConfig, system: &str, messages: &[Msg], tools: &[ToolSpec], max_tokens: u32, stream: Stream<'_>) -> Result<Turn> {
    if cfg.api_key.trim().is_empty() {
        bail!("Configure a Google AI API key in Settings → AI.");
    }
    let base = cfg.base_url.as_deref().unwrap_or("https://generativelanguage.googleapis.com/v1beta").trim().trim_end_matches('/');
    let model = url::form_urlencoded::byte_serialize(cfg.model.trim().as_bytes()).collect::<String>();
    let mut endpoint = url::Url::parse(&format!("{base}/models/{model}:streamGenerateContent")).context("Google AI base URL is invalid")?;
    endpoint.query_pairs_mut().append_pair("alt", "sse").append_pair("key", cfg.api_key.trim());
    let mut body = json!({"contents": gemini_contents(messages), "generationConfig": {"maxOutputTokens": max_tokens}});
    if !system.trim().is_empty() {
        body["systemInstruction"] = json!({"parts": [{"text": system}]});
    }
    if !tools.is_empty() {
        let decls: Vec<Value> = tools
            .iter()
            .map(|t| {
                let mut d = json!({"name": t.name, "description": t.description});
                if let Some(p) = gemini_schema(&t.input_schema) {
                    d["parameters"] = p;
                }
                d
            })
            .collect();
        body["tools"] = json!([{"functionDeclarations": decls}]);
    }
    let response = reqwest::Client::new().post(endpoint).json(&body).send().await.context("Could not reach Google Gemini")?;
    if !response.status().is_success() {
        return Err(error_message(response, "Google Gemini").await);
    }
    let mut turn = Turn::default();
    let on_text = &mut *stream.on_text;
    let mut error = None;
    for_each_sse(response, stream.cancel, |data| {
        let ev: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(e) = ev.pointer("/error/message").and_then(Value::as_str) {
            error = Some(e.to_string());
        }
        for part in ev.pointer("/candidates/0/content/parts").and_then(Value::as_array).into_iter().flatten() {
            if part["thought"] == true {
                continue;
            }
            if let Some(t) = part["text"].as_str() {
                turn.text.push_str(t);
                on_text(t);
            }
            if let Some(fc) = part.get("functionCall") {
                let id = format!("call_{}", crate::chat_store::random_id());
                let name = fc["name"].as_str().unwrap_or("").to_string();
                let args = if fc["args"].is_object() { fc["args"].clone() } else { json!({}) };
                let mut block = json!({"type": "tool_use", "id": id, "name": name, "input": args});
                if let Some(sig) = part.get("thoughtSignature") {
                    block["_gemini_signature"] = sig.clone();
                }
                turn.blocks.push(block);
                turn.tool_calls.push(ToolCall { id, name, input: Ok(args) });
            }
        }
        if let Some(r) = ev.pointer("/candidates/0/finishReason").and_then(Value::as_str) {
            turn.stop_reason = Some(if r == "MAX_TOKENS" { "max_tokens".into() } else { "end_turn".into() });
        }
        Ok(())
    })
    .await?;
    if let Some(e) = error {
        bail!("{e}");
    }
    if !turn.text.is_empty() {
        turn.blocks.insert(0, json!({"type": "text", "text": turn.text}));
    }
    if !turn.tool_calls.is_empty() {
        turn.stop_reason = Some("tool_use".into());
    }
    Ok(turn)
}

/// One-shot text completion (no tools) — used by the SQL editor and AI filter.
pub async fn complete_text(cfg: &ProviderConfig, system: &str, prompt: &str, max_tokens: u32) -> Result<String> {
    let cancel = AtomicBool::new(false);
    let mut sink = |_: &str| {};
    let turn = stream_turn(cfg, system, &[Msg::user_text(prompt)], &[], max_tokens, Stream { on_text: &mut sink, cancel: &cancel }).await?;
    if turn.stop_reason.as_deref() == Some("refusal") {
        bail!("The model declined this request.");
    }
    Ok(turn.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(p: &str) -> ProviderConfig {
        ProviderConfig { provider: p.into(), model: "claude-opus-5-5".into(), api_key: "k".into(), base_url: None }
    }

    fn history() -> Vec<Msg> {
        vec![
            Msg::user_text("hi"),
            Msg { role: "assistant", content: vec![json!({"type":"thinking","thinking":"","signature":"s"}), json!({"type":"text","text":"x"}), json!({"type":"tool_use","id":"t1","name":"list_tables","input":{}, "_gemini_signature": "g"})] },
            Msg { role: "user", content: vec![json!({"type":"tool_result","tool_use_id":"t1","content":"[]"})] },
        ]
    }

    #[test]
    fn anthropic_shape() {
        let tools = [ToolSpec { name: "list_tables", description: "d", input_schema: json!({"type":"object","properties":{}}) }];
        let b = anthropic_body(&cfg("anthropic"), "sys", &history(), &tools, 100, true);
        assert_eq!(b["fallbacks"], "default");
        assert_eq!(b["tools"][0]["eager_input_streaming"], true);
        assert!(b["messages"][1]["content"][2].get("_gemini_signature").is_none());
        assert_eq!(b["messages"][1]["content"][0]["type"], "thinking");
        let b = anthropic_body(&cfg("anthropic"), "", &history(), &[], 100, false);
        assert!(b.get("fallbacks").is_none() && b.get("system").is_none());
    }

    #[test]
    fn openai_shape() {
        let m = openai_messages("sys", &history());
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[2]["tool_calls"][0]["function"]["name"], "list_tables");
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[3]["tool_call_id"], "t1");
    }

    #[test]
    fn gemini_shape() {
        let c = gemini_contents(&history());
        assert_eq!(c[1]["role"], "model");
        assert_eq!(c[1]["parts"][1]["thoughtSignature"], "g");
        assert_eq!(c[2]["parts"][0]["functionResponse"]["name"], "list_tables");
        assert!(gemini_schema(&json!({"type":"object","properties":{}})).is_none());
    }

    #[test]
    fn args() {
        assert!(parse_args("").is_ok());
        assert!(parse_args("{\"a\":1}").is_ok());
        assert!(parse_args("{\"a\":").is_err());
        assert!(parse_args("[1]").is_err());
        assert_eq!(anthropic_endpoint(Some("https://gw.example/v1")).0, "https://gw.example/v1/messages");
        assert!(anthropic_endpoint(None).1);
    }
}
