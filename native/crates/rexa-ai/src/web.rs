//! Port of lib/ai/exa-search.ts (keyed Exa API) and lib/ai/exa-mcp.ts (the
//! keyless free tier through Exa's hosted MCP endpoint) behind the agent's
//! `web_search` / `fetch_web_content` tools. Only the model-written query /
//! URLs are sent, exactly as the original does.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

const EXA_API_BASE: &str = "https://api.exa.ai";
const EXA_MCP_URL: &str = "https://mcp.exa.ai/mcp";
const FREE_LIMIT_NOTE: &str = "The free tier allows a limited number of searches per day.";

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap_or_default()
}

async fn post_exa(path: &str, key: &str, body: Value) -> Result<Value> {
    let res = client().post(format!("{EXA_API_BASE}{path}")).header("x-api-key", key).json(&body).send().await.context("Exa request failed")?;
    let status = res.status();
    if status.is_success() {
        return Ok(res.json().await?);
    }
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let tag = data["tag"].as_str().unwrap_or("");
    let detail = data["error"].as_str().map(|d| format!(" ({d})")).unwrap_or_default();
    match status.as_u16() {
        401 => bail!("Exa rejected the API key. Check it in Settings → AI → Web search (Exa).{detail}"),
        402 => bail!("Exa credits are exhausted. Top up at https://dashboard.exa.ai/api-keys — the free tier adds $10 every month.{detail}"),
        429 => bail!("Exa rate limit hit — wait a moment and retry."),
        s if s >= 500 => bail!("Exa is having issues (HTTP {s}). Retry shortly."),
        _ if tag == "INVALID_API_KEY" => bail!("Exa rejected the API key.{detail}"),
        s => bail!("Exa request failed (HTTP {s}).{detail}"),
    }
}

/// `searchExa`.
pub async fn search_exa(query: &str, key: &str, num_results: u64) -> Result<Value> {
    let data = post_exa(
        "/search",
        key,
        json!({"query": query.trim(), "numResults": num_results.clamp(1, 10), "type": "auto", "contents": {"text": {"maxCharacters": 3000}, "highlights": {"maxCharacters": 1000}}}),
    )
    .await?;
    let results: Vec<Value> = data["results"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| json!({"title": r["title"], "url": r["url"], "publishedDate": r["publishedDate"], "author": r["author"], "text": r["text"], "highlights": r["highlights"], "summary": r["summary"]}))
        .collect();
    Ok(json!({"results": results, "costDollars": data.pointer("/costDollars/total")}))
}

/// `fetchExaContents`.
pub async fn fetch_exa_contents(urls: &[String], key: &str) -> Result<Value> {
    let data = post_exa("/contents", key, json!({"urls": urls, "text": {"maxCharacters": 6000}})).await?;
    Ok(Value::Array(
        data["results"].as_array().into_iter().flatten().map(|r| json!({"title": r["title"], "url": r["url"], "text": r["text"], "highlights": r["highlights"], "summary": r["summary"]})).collect(),
    ))
}

fn parse_sse_payload(body: &str) -> Value {
    let lines: Vec<&str> = body.lines().map(str::trim).filter_map(|l| l.strip_prefix("data:")).map(str::trim).filter(|l| !l.is_empty() && *l != "[DONE]").collect();
    let payload = if lines.is_empty() { body.trim().to_string() } else { lines.join("\n") };
    serde_json::from_str(&payload).unwrap_or(Value::Null)
}

async fn mcp_post(body: Value, session: Option<&str>) -> Result<(Value, Option<String>)> {
    let mut req = client().post(EXA_MCP_URL).header("Accept", "application/json, text/event-stream").json(&body);
    if let Some(s) = session {
        req = req.header("Mcp-Session-Id", s);
    }
    let res = req.send().await.map_err(|e| anyhow::anyhow!("Free web search is unreachable: {e}"))?;
    let next = res.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).map(str::to_string).or(session.map(str::to_string));
    let status = res.status().as_u16();
    if status == 202 {
        return Ok((Value::Null, next));
    }
    if !(200..300).contains(&status) {
        if status == 429 {
            bail!("Free web search is rate-limited right now. {FREE_LIMIT_NOTE} Add an Exa key in Settings → AI → Web search for unlimited use.");
        }
        if status >= 500 {
            bail!("Free web search is having issues (HTTP {status}). Retry shortly.");
        }
        bail!("Free web search failed (HTTP {status}).");
    }
    let text = res.text().await.unwrap_or_default();
    Ok((if text.trim().is_empty() { Value::Null } else { parse_sse_payload(&text) }, next))
}

fn extract_text(data: &Value) -> Result<String> {
    if let Some(parts) = data.pointer("/result/content").and_then(Value::as_array) {
        return Ok(parts.iter().filter(|p| p["type"] == "text").filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n\n"));
    }
    if let Some(e) = data.get("error") {
        let message = e["message"].as_str().unwrap_or("search failed");
        let lower = message.to_lowercase();
        if ["limit", "quota", "credit", "budget"].iter().any(|w| lower.contains(w)) {
            bail!("Today's free web searches are used up. {FREE_LIMIT_NOTE} Add an Exa key in Settings → AI → Web search for unlimited use.");
        }
        bail!("Free web search failed: {message}");
    }
    Ok(String::new())
}

async fn free_call(tool: &str, arguments: Value) -> Result<String> {
    let (_, session) = mcp_post(
        json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "rexadb", "version": "1.0"}}}),
        None,
    )
    .await?;
    mcp_post(json!({"jsonrpc": "2.0", "id": 2, "method": "notifications/initialized", "params": {}}), session.as_deref()).await.ok();
    let (data, _) = mcp_post(json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": tool, "arguments": arguments}}), session.as_deref()).await?;
    extract_text(&data)
}

/// `parseFreeSearchText`.
pub fn parse_free_search_text(text: &str) -> Vec<Value> {
    text.split("\n---\n")
        .filter_map(|block| {
            let url = block.lines().find_map(|l| l.strip_prefix("URL:")).map(|u| u.split_whitespace().next().unwrap_or("").to_string())?;
            let title = block.lines().find_map(|l| l.strip_prefix("Title:")).map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
            Some(json!({"title": title, "url": url, "text": block.trim()}))
        })
        .collect()
}

/// `searchWebFree`.
pub async fn search_web_free(query: &str, num_results: u64) -> Result<Vec<Value>> {
    let q = query.trim();
    if q.is_empty() {
        bail!("Search query is required.");
    }
    let text = free_call("web_search_exa", json!({"query": q, "objective": format!("Find the most relevant pages for: {q}"), "numResults": num_results.clamp(1, 10)})).await?;
    Ok(parse_free_search_text(&text))
}

/// `fetchWebFree`.
pub async fn fetch_web_free(urls: &[String]) -> Result<Vec<Value>> {
    if urls.is_empty() {
        bail!("At least one URL is required.");
    }
    let text = free_call("web_fetch_exa", json!({"urls": urls})).await?;
    let parsed = parse_free_search_text(&text);
    if !parsed.is_empty() {
        return Ok(parsed);
    }
    Ok(urls.iter().map(|u| json!({"title": null, "url": u, "text": if text.is_empty() { Value::Null } else { Value::from(text.clone()) }})).collect())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_free() {
        let r = super::parse_free_search_text("Title: A\nURL: https://a.dev\nbody\n---\nTitle: B\nURL: https://b.dev x");
        assert_eq!(r.len(), 2);
        assert_eq!(r[1]["url"], "https://b.dev");
        assert_eq!(super::parse_sse_payload("event: m\ndata: {\"a\":1}\n\n")["a"], 1);
    }
}
