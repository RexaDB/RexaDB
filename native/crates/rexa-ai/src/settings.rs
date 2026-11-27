//! Port of lib/ai/model-utils.ts (`getConfiguredModels`), hooks/use-sql-ai-settings.ts
//! (`hasAnyConfiguredModels`), `pickAiProviderAndModel` (data-table-toolbar.tsx) and
//! `resolveLanguageModel` (lib/ai/providers.ts). Settings live in
//! `user_ai_settings` row 'global', read through `rexa_settings::ai`.

use crate::llm::ProviderConfig;
use anyhow::{bail, Result};
use serde_json::Value;

/// Model used when the Anthropic provider has a key but no model chosen.
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-opus-5-5";

pub fn load() -> Value {
    rexa_settings::ai::load_settings()
}

pub fn permission_mode(settings: &Value) -> &'static str {
    if settings["permissionMode"].as_str() == Some("schema_only") {
        "schema_only"
    } else {
        "schema_with_data"
    }
}

pub fn save_permission_mode(mode: &str) -> Result<()> {
    let mut settings = load();
    settings["permissionMode"] = Value::from(mode);
    rexa_settings::ai::save_settings(&settings)
}

fn usable(id: &str, config: &Value) -> bool {
    let key = config["apiKey"].as_str().unwrap_or("").trim();
    (id == "ollama" || !key.is_empty()) && config["models"].as_array().is_some_and(|m| !m.is_empty())
}

/// One entry of the prompt bar's model pill (`sidebarModels`).
#[derive(Clone, Debug, PartialEq)]
pub struct ModelOption {
    /// `<provider>:<model>`
    pub key: String,
    pub name: String,
    pub tag: String,
    pub provider: String,
    pub model: String,
}

/// `getConfiguredModels(settings).llmModels` mapped like ai-chat-sheet.tsx.
pub fn configured_models(settings: &Value) -> Vec<ModelOption> {
    let mut out = Vec::new();
    let Some(providers) = settings["providers"].as_object() else { return out };
    for (provider, config) in providers {
        if provider == "external" || provider == "exa" {
            continue;
        }
        let key = config["apiKey"].as_str().unwrap_or("").trim();
        if provider != "ollama" && key.is_empty() {
            continue;
        }
        for model in config["models"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            let model = model.trim();
            if model.is_empty() {
                continue;
            }
            out.push(ModelOption {
                key: format!("{provider}:{model}"),
                name: model.to_string(),
                tag: provider.clone(),
                provider: provider.clone(),
                model: model.to_string(),
            });
        }
    }
    out
}

/// `hasAnyConfiguredModels`.
pub fn has_any_models(settings: &Value) -> bool {
    settings["providers"].as_object().is_some_and(|p| p.iter().any(|(id, c)| usable(id, c)))
}

/// `pickAiProviderAndModel`: default provider/model, else the first usable one.
pub fn pick_provider_and_model(settings: &Value) -> Result<(String, String)> {
    let providers = settings["providers"].as_object().cloned().unwrap_or_default();
    let def_provider = settings["defaultProvider"].as_str().unwrap_or("").trim().to_string();
    let def_model = settings["defaultModel"].as_str().unwrap_or("").trim().to_string();
    if !def_provider.is_empty() {
        if let Some(config) = providers.get(&def_provider).filter(|c| usable(&def_provider, c)) {
            let models: Vec<&str> = config["models"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            if !def_model.is_empty() && models.contains(&def_model.as_str()) {
                return Ok((def_provider, def_model));
            }
            return Ok((def_provider, models[0].to_string()));
        }
    }
    for (id, config) in &providers {
        if id == "exa" {
            continue;
        }
        if usable(id, config) {
            let first = config["models"][0].as_str().unwrap_or_default().to_string();
            return Ok((id.clone(), first));
        }
    }
    bail!("Set a default AI provider in AI settings first (Models section).")
}

/// `resolveLanguageModel` + the checks of `sendMessage` / `resolveAiReq`.
pub fn provider_config(settings: &Value, provider: &str, model: &str) -> Result<ProviderConfig> {
    let config = settings.pointer(&format!("/providers/{provider}"));
    let Some(config) = config else { bail!("AI provider \"{provider}\" is not configured.") };
    let api_key = config["apiKey"].as_str().unwrap_or("").trim().to_string();
    if provider == "external" {
        bail!("External ACP agents are not available in the native app yet.");
    }
    if provider != "ollama" && api_key.is_empty() {
        bail!("Configure an AI provider with an API key and model first.");
    }
    let mut model = model.trim().to_string();
    if model.is_empty() && provider == "anthropic" {
        model = DEFAULT_ANTHROPIC_MODEL.to_string();
    }
    if model.is_empty() {
        if provider == "ollama" {
            bail!("Configure Ollama with a model first.");
        }
        bail!("Configure an AI provider with an API key and model first.");
    }
    let base_url = config["baseUrl"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    Ok(ProviderConfig { provider: provider.to_string(), model, api_key, base_url })
}

/// Exa web-search key (Settings → AI → Web search).
pub fn exa_api_key(settings: &Value) -> Option<String> {
    settings.pointer("/providers/exa/apiKey").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Value {
        json!({
            "permissionMode": "schema_only",
            "defaultProvider": "", "defaultModel": "",
            "providers": {
                "openai": {"apiKey": "", "models": ["gpt-x"]},
                "anthropic": {"apiKey": "k", "models": ["claude-opus-5-5", "claude-sonnet-5-5"]},
                "ollama": {"apiKey": "", "models": ["llama"], "baseUrl": "http://localhost:11434/v1"},
                "exa": {"apiKey": "e", "models": ["x"]}
            }
        })
    }

    #[test]
    fn models_and_pick() {
        let s = sample();
        let models = configured_models(&s);
        assert!(models.iter().any(|m| m.key == "anthropic:claude-opus-5-5"));
        assert!(models.iter().any(|m| m.key == "ollama:llama"));
        assert!(!models.iter().any(|m| m.provider == "openai" || m.provider == "exa"));
        assert!(has_any_models(&s));
        assert_eq!(permission_mode(&s), "schema_only");
        let (p, _) = pick_provider_and_model(&s).unwrap();
        assert!(p == "anthropic" || p == "ollama");
        let mut s2 = s.clone();
        s2["defaultProvider"] = json!("anthropic");
        s2["defaultModel"] = json!("claude-sonnet-5-5");
        assert_eq!(pick_provider_and_model(&s2).unwrap(), ("anthropic".into(), "claude-sonnet-5-5".into()));
        assert!(pick_provider_and_model(&json!({"providers": {}})).is_err());
        assert_eq!(provider_config(&s, "anthropic", "").unwrap().model, DEFAULT_ANTHROPIC_MODEL);
        assert!(provider_config(&s, "openai", "gpt-x").is_err());
        assert!(provider_config(&s, "ollama", "llama").is_ok());
    }
}
