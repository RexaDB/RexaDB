//! Port of components/studio/ai/ai-settings-section.tsx + the persistence in
//! hooks/use-ai-provider-settings.ts / lib/db/actions-core.ts
//! (getGlobalAiSettings / saveGlobalAiSettings / normalizeGlobalAiSettings):
//! `user_ai_settings` row `user_id = 'global'`. The AI agent (rexa-ai) reads
//! the same row. Also the "Slash AI Trigger" card of settings-view.tsx.

use crate::model::SettingsModel;
use gpui::{div, img, prelude::*, px, AnyElement, AppContext, Context, Entity, FontWeight, SharedString, Window};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::Icon;
use rexa_ui::{with_alpha, ActiveTokens, Button, ButtonSize, IconName, PasswordInput, Select, SelectOption, Switch, TextInput, Tw};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub const PINNED: &[&str] = &["openai", "anthropic", "google", "openrouter", "kilo", "ollama"];

fn default_providers() -> Vec<(&'static str, Option<&'static str>)> {
    vec![
        ("openai", None),
        ("google", None),
        ("anthropic", None),
        ("openrouter", Some("https://openrouter.ai/api/v1")),
        ("kilo", Some("https://api.kilo.ai/api/gateway")),
        ("ollama", Some("http://localhost:11434/v1")),
        ("external", None),
    ]
}

pub fn label_for(id: &str) -> String {
    match id {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "google" => "Google",
        "openrouter" => "OpenRouter",
        "kilo" => "Kilo Code",
        "ollama" => "Ollama",
        "exa" => "Exa (web search)",
        other => other,
    }
    .to_string()
}

fn logo_for(id: &str) -> Option<&'static str> {
    Some(match id {
        "openai" => "providers/openai.svg",
        "anthropic" => "providers/anthropic_black.svg",
        "google" => "providers/google.svg",
        "openrouter" => "providers/openrouter_light.svg",
        "kilo" => "providers/kilo.svg",
        "ollama" => "providers/ollama-logo-black-light-svg.svg",
        _ => return None,
    })
}

/// normalizeGlobalAiSettings.
pub fn normalize(input: &Value) -> Value {
    let providers = input.get("providers").and_then(|p| p.as_object()).cloned().unwrap_or_default();
    let mut ids: Vec<String> = default_providers().iter().map(|(id, _)| id.to_string()).collect();
    for k in providers.keys() {
        if !ids.contains(k) {
            ids.push(k.clone());
        }
    }
    let defaults: HashMap<&str, Option<&str>> = default_providers().into_iter().collect();
    let mut out = Map::new();
    for id in ids {
        let cfg = providers.get(&id).cloned().unwrap_or(Value::Null);
        let mut p = cfg.as_object().cloned().unwrap_or_default();
        p.insert("apiKey".into(), Value::from(cfg.get("apiKey").and_then(|v| v.as_str()).unwrap_or("")));
        let models: Vec<Value> = cfg
            .get("models")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|m| m.as_str()).map(str::trim).filter(|m| !m.is_empty()).map(Value::from).collect())
            .unwrap_or_default();
        p.insert("models".into(), Value::Array(models));
        match cfg.get("baseUrl").and_then(|v| v.as_str()).map(str::to_string).or_else(|| defaults.get(id.as_str()).copied().flatten().map(str::to_string)) {
            Some(b) => p.insert("baseUrl".into(), Value::from(b)),
            None => p.remove("baseUrl"),
        };
        out.insert(id, Value::Object(p));
    }
    json!({
        "permissionMode": if input.get("permissionMode").and_then(|v| v.as_str()) == Some("schema_only") { "schema_only" } else { "schema_with_data" },
        "defaultProvider": input.get("defaultProvider").and_then(|v| v.as_str()).unwrap_or("").trim(),
        "defaultModel": input.get("defaultModel").and_then(|v| v.as_str()).unwrap_or("").trim(),
        "providers": out,
    })
}

pub fn load_settings() -> Value {
    let raw = rexa_store::Store::open().ok().and_then(|s| s.global_ai_settings_json().ok().flatten()).and_then(|j| serde_json::from_str(&j).ok());
    normalize(&raw.unwrap_or(Value::Null))
}

pub fn save_settings(settings: &Value) -> anyhow::Result<()> {
    rexa_store::Store::open()?.save_global_ai_settings_json(&normalize(settings).to_string())
}

fn usable(id: &str, c: &Value) -> bool {
    (id == "ollama" || !c["apiKey"].as_str().unwrap_or("").trim().is_empty()) && c["models"].as_array().is_some_and(|m| !m.is_empty())
}

pub struct AiSection {
    model: Entity<SettingsModel>,
    settings: Value,
    open: Option<String>,
    keys: HashMap<String, Entity<InputState>>,
    drafts: HashMap<String, Entity<InputState>>,
    base_urls: HashMap<String, Entity<InputState>>,
    _subs: Vec<gpui::Subscription>,
}

impl AiSection {
    pub fn new(model: Entity<SettingsModel>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let settings = load_settings();
        let mut this = Self { model, settings, open: None, keys: HashMap::new(), drafts: HashMap::new(), base_urls: HashMap::new(), _subs: Vec::new() };
        let mut ids: Vec<&str> = PINNED.to_vec();
        ids.push("exa");
        for id in ids {
            let key = this.settings["providers"][id]["apiKey"].as_str().unwrap_or("").to_string();
            let s = cx.new(|cx| InputState::new(window, cx).masked(true).placeholder("sk-...").default_value(key));
            let pid = id.to_string();
            this._subs.push(cx.subscribe(&s, move |this, s, e: &InputEvent, cx| {
                if matches!(e, InputEvent::Change) {
                    let v = s.read(cx).value().to_string();
                    this.update_provider(&pid, "apiKey", Value::from(v), cx);
                }
            }));
            this.keys.insert(id.to_string(), s);
            let d = cx.new(|cx| InputState::new(window, cx).placeholder("model-id"));
            let pid = id.to_string();
            this._subs.push(cx.subscribe(&d, move |this, s, e: &InputEvent, cx| {
                if matches!(e, InputEvent::PressEnter { .. }) {
                    let v = s.read(cx).value().trim().to_string();
                    this.add_model(&pid, v, cx);
                }
            }));
            this.drafts.insert(id.to_string(), d);
            let base = this.settings["providers"][id]["baseUrl"].as_str().unwrap_or("").to_string();
            let b = cx.new(|cx| InputState::new(window, cx).default_value(base));
            let pid = id.to_string();
            this._subs.push(cx.subscribe(&b, move |this, s, e: &InputEvent, cx| {
                if matches!(e, InputEvent::Change) {
                    let v = s.read(cx).value().to_string();
                    this.update_provider(&pid, "baseUrl", Value::from(v), cx);
                }
            }));
            this.base_urls.insert(id.to_string(), b);
        }
        this
    }

    fn update_settings(&mut self, next: Value, cx: &mut Context<Self>) {
        self.settings = normalize(&next);
        if let Err(e) = save_settings(&self.settings) {
            rexa_ui::toast::error(format!("Failed to save AI settings: {e}"), cx);
        }
        cx.notify();
    }

    fn update_provider(&mut self, id: &str, field: &str, value: Value, cx: &mut Context<Self>) {
        let mut next = self.settings.clone();
        if !next["providers"][id].is_object() {
            next["providers"][id] = json!({"apiKey": "", "models": []});
        }
        next["providers"][id][field] = value;
        self.update_settings(next, cx);
    }

    fn add_model(&mut self, id: &str, model: String, cx: &mut Context<Self>) {
        if model.is_empty() {
            return;
        }
        let mut models: Vec<Value> = self.settings["providers"][id]["models"].as_array().cloned().unwrap_or_default();
        if !models.iter().any(|m| m.as_str() == Some(model.as_str())) {
            models.push(Value::from(model));
        }
        self.update_provider(id, "models", Value::Array(models), cx);
    }

    fn card(&self, cx: &gpui::App) -> gpui::Div {
        let t = cx.tokens();
        div().tw_rounded_lg().border_1().border_color(t.border).bg(t.card).p_4()
    }

    fn label(text: &'static str, cx: &gpui::App) -> impl IntoElement {
        div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(cx.tokens().muted_foreground).child(text)
    }

    fn avatar(id: &str, label: &str, cx: &gpui::App) -> AnyElement {
        let t = cx.tokens();
        match logo_for(id) {
            // `dark:invert` for monochrome marks is not emulated.
            Some(src) => img(src).size(px(20.)).into_any_element(),
            None => div()
                .size_5()
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(t.muted)
                .tw_text_10()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(t.muted_foreground)
                .child(label.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default())
                .into_any_element(),
        }
    }

    fn provider_item(&self, id: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let cfg = self.settings["providers"][id].clone();
        let models: Vec<String> = cfg["models"].as_array().map(|a| a.iter().filter_map(|m| m.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let open = self.open.as_deref() == Some(id);
        let label = label_for(id);
        let count = if models.is_empty() { "No models".to_string() } else { format!("{} model{}", models.len(), if models.len() == 1 { "" } else { "s" }) };
        let header = div()
            .id(SharedString::from(format!("ai-prov-{id}")))
            .flex()
            .items_center()
            .gap_3()
            .px_4()
            .py_3()
            .cursor_pointer()
            .hover(|s| s.bg(with_alpha(t.muted, 0.5)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.open = if this.open.as_deref() == Some(id) { None } else { Some(id.to_string()) };
                cx.notify();
            }))
            .child(Self::avatar(id, &label, cx))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(label))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(count)),
            )
            .child(Icon::new(if open { IconName::ChevronUp } else { IconName::ChevronDown }).size_4().text_color(t.muted_foreground));
        let mut item = div().tw_rounded_lg().border_1().border_color(t.border).bg(t.card).overflow_hidden().child(header);
        if open {
            let mut list = div().flex().flex_wrap().gap(px(6.));
            for m in models {
                let mm = m.clone();
                list = list.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .tw_rounded_md()
                        .border_1()
                        .border_color(t.border)
                        .px_2()
                        .py(px(2.))
                        .tw_text_xs()
                        .font_family(rexa_ui::MONO)
                        .child(m.clone())
                        .child(
                            div()
                                .id(SharedString::from(format!("rm-model-{id}-{m}")))
                                .cursor_pointer()
                                .text_color(t.muted_foreground)
                                .hover(|s| s.text_color(t.foreground))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let models: Vec<Value> = this.settings["providers"][id]["models"]
                                        .as_array()
                                        .cloned()
                                        .unwrap_or_default()
                                        .into_iter()
                                        .filter(|v| v.as_str() != Some(mm.as_str()))
                                        .collect();
                                    this.update_provider(id, "models", Value::Array(models), cx);
                                }))
                                .child(Icon::new(IconName::X).size_3()),
                        ),
                );
            }
            let draft = self.drafts[id].clone();
            let d2 = draft.clone();
            item = item.child(
                div()
                    .border_t_1()
                    .border_color(t.border)
                    .px_4()
                    .pb_4()
                    .pt_3()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().flex().flex_col().gap(px(6.)).child(Self::label("API Key", cx)).child(PasswordInput::new(SharedString::from(format!("ai-key-{id}")), &self.keys[id])))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(Self::label("Models", cx))
                            .child(list)
                            .child(
                                div().flex().gap_2().child(div().flex_1().child(TextInput::new(&draft))).child(
                                    Button::new(SharedString::from(format!("ai-add-{id}"))).outline().icon(IconName::Plus).label("Add Model").on_click(cx.listener(move |this, _, w, cx| {
                                        let v = d2.read(cx).value().trim().to_string();
                                        d2.update(cx, |s, cx| s.set_value("", w, cx));
                                        this.add_model(id, v, cx);
                                    })),
                                ),
                            ),
                    )
                    .when(id == "openrouter" || id == "ollama", |d| {
                        d.child(div().flex().flex_col().gap(px(6.)).child(Self::label("Base URL", cx)).child(TextInput::new(&self.base_urls[id])))
                    }),
            );
        }
        item.into_any_element()
    }
}

impl Render for AiSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let s = self.settings.clone();
        let providers = s["providers"].as_object().cloned().unwrap_or_default();
        let usable_list: Vec<(String, Vec<String>)> = providers
            .iter()
            .filter(|(id, c)| usable(id, c))
            .map(|(id, c)| (id.clone(), c["models"].as_array().unwrap().iter().filter_map(|m| m.as_str().map(str::to_string)).collect()))
            .collect();
        let dp = s["defaultProvider"].as_str().unwrap_or("").to_string();
        let active_provider = if usable_list.iter().any(|(p, _)| *p == dp) { dp } else { String::new() };
        let active_models = usable_list.iter().find(|(p, _)| *p == active_provider).map(|(_, m)| m.clone()).unwrap_or_default();
        let dm = s["defaultModel"].as_str().unwrap_or("").to_string();
        let active_model = if active_models.contains(&dm) { dm } else { String::new() };
        let model_count: usize = providers.values().map(|c| c["models"].as_array().map_or(0, |a| a.len())).sum();
        let provider_count = usable_list.len();
        let this = cx.entity();
        let (t1, t2, t3) = (this.clone(), this.clone(), this.clone());
        let slash = self.model.read(cx).bool("slashAiTrigger");
        let m = self.model.clone();
        let mut accordions = div().flex().flex_col().gap_2();
        for id in PINNED {
            if providers.contains_key(*id) {
                accordions = accordions.child(self.provider_item(id, cx));
            }
        }
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap_3()
                            .child(
                                div()
                                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight("Models")))
                                    .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Configure provider access and permissions.")),
                            )
                            .child(Button::new("ai-configure").outline().size(ButtonSize::Sm).label("Configure providers").icon_end(IconName::ArrowRight).on_click(cx.listener(|this, _, _, cx| {
                                this.open = Some("openai".into());
                                cx.notify();
                            }))),
                    )
                    .child(self.card(cx).child(Self::label("Permissions", cx)).child(
                        div().mt_2().child(
                            Select::new("ai-permission")
                                .w(px(220.))
                                .placeholder("Select permission mode")
                                .options([SelectOption::new("schema_only", "Schema only"), SelectOption::new("schema_with_data", "Schema with database data (read only)")])
                                .value(Some(s["permissionMode"].as_str().unwrap_or("schema_with_data").to_string()))
                                .on_change(move |v, _, cx| t1.update(cx, |a, cx| {
                                    let mut n = a.settings.clone();
                                    n["permissionMode"] = Value::from(v.to_string());
                                    a.update_settings(n, cx);
                                })),
                        ),
                    ))
                    .child(
                        self.card(cx)
                            .child(Self::label("Default provider", cx))
                            .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Used for one-shot agent actions like AI filter from search."))
                            .child(
                                div()
                                    .mt_2()
                                    .flex()
                                    .gap_2()
                                    .child(
                                        Select::new("ai-default-provider")
                                            .w(px(220.))
                                            .placeholder("Select default provider")
                                            .options(usable_list.iter().map(|(p, _)| SelectOption::new(p.clone(), label_for(p))))
                                            .value((!active_provider.is_empty()).then_some(active_provider.clone()))
                                            .on_change(move |v, _, cx| t2.update(cx, |a, cx| {
                                                let mut n = a.settings.clone();
                                                n["defaultProvider"] = Value::from(v.to_string());
                                                n["defaultModel"] = Value::from(if v.starts_with("cli:") { "default" } else { "" });
                                                a.update_settings(n, cx);
                                            })),
                                    )
                                    .child(
                                        Select::new("ai-default-model")
                                            .w(px(220.))
                                            .placeholder("Select default model")
                                            .disabled(active_provider.is_empty())
                                            .options(active_models.iter().map(|m| SelectOption::simple(m.clone())))
                                            .value((!active_model.is_empty()).then_some(active_model))
                                            .on_change(move |v, _, cx| t3.update(cx, |a, cx| {
                                                let mut n = a.settings.clone();
                                                n["defaultModel"] = Value::from(v.to_string());
                                                a.update_settings(n, cx);
                                            })),
                                    ),
                            ),
                    )
                    .child(
                        self.card(cx)
                            .child(Self::label("Web search (Exa)", cx))
                            .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child(
                                "Lets the agent search the live web. Works out of the box with a free daily quota \u{2014} add a key for unlimited, richer results ($20 signup credits + $10 free every month). Get a free key",
                            ))
                            .child(div().mt_2().child(PasswordInput::new("ai-key-exa", &self.keys["exa"]))),
                    )
                    .child(accordions)
                    .child(div().flex().justify_center().tw_text_xs().text_color(t.muted_foreground).child(format!(
                        "{model_count} API model{} across {provider_count} API provider{}.",
                        if model_count == 1 { "" } else { "s" },
                        if provider_count == 1 { "" } else { "s" }
                    ))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(t.card)
                    .p_4()
                    .child(crate::rows::title_block("Slash AI Trigger", "Type / in an empty editor to activate AI mode.", None, cx))
                    .child(Switch::new("slash-ai").checked(slash).on_change(move |v, _, cx| m.update(cx, |m, cx| m.set("slashAiTrigger", v, cx)))),
            )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn normalizes_defaults() {
        let n = super::normalize(&serde_json::Value::Null);
        assert_eq!(n["permissionMode"], "schema_with_data");
        assert_eq!(n["providers"]["ollama"]["baseUrl"], "http://localhost:11434/v1");
        assert_eq!(n["providers"]["openai"]["models"], serde_json::json!([]));
    }
}
