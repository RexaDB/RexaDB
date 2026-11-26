//! GPUI extension manager for the existing local JSON bundle format.
//!
//! Native bundle management is available now. The legacy Worker sandbox host
//! still needs a native equivalent before extension JavaScript can activate.

use gpui::{div, prelude::*, px, App, AppContext, Context, Entity, Subscription, Window};
use gpui_component::{input::{Input, InputEvent, InputState, Textarea, TextareaState}, scroll::ScrollableElement};
use rexa_core::{Registry, Session, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde_json::{json, Value};
use std::sync::Arc;

const KEY: &str = "rexadb.extensions.installed.v1";

fn load() -> Vec<Value> {
    let raw = rexa_store::Store::open().ok().and_then(|s| s.setting(KEY).ok().flatten())
        .or_else(|| rexa_store::WebStore::open().and_then(|s| s.get(KEY).ok().flatten()));
    raw.and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok()).unwrap_or_default()
}

fn save(records: &[Value]) -> anyhow::Result<()> {
    rexa_store::Store::open()?.set_setting(KEY, &serde_json::to_string(records)?)
}

fn validate_manifest(manifest: &Value) -> anyhow::Result<()> {
    let id = manifest.get("id").and_then(Value::as_str).unwrap_or_default();
    let valid_part = |part: &str| !part.is_empty() && part.as_bytes()[0].is_ascii_alphanumeric() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let valid_id = id.split_once('.').is_some_and(|(publisher, name)| valid_part(publisher) && valid_part(name));
    if !valid_id {
        anyhow::bail!("Manifest id must be a publisher.name identifier.");
    }
    if manifest.get("name").and_then(Value::as_str).is_none_or(|name| name.trim().is_empty()) {
        anyhow::bail!("Manifest name is required.");
    }
    let version = manifest.get("version").and_then(Value::as_str).unwrap_or_default();
    let (numbers, prerelease) = version.split_once('-').map_or((version, None), |(n, p)| (n, Some(p)));
    let version_parts: Vec<_> = numbers.split('.').collect();
    if version_parts.len() != 3 || version_parts.iter().any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
        || prerelease.is_some_and(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'))
    {
        anyhow::bail!("Manifest version must be semantic version text, such as 1.0.0.");
    }
    if manifest.get("engines").and_then(|v| v.get("rexadb")).and_then(Value::as_str).is_none() {
        anyhow::bail!("Manifest engines.rexadb is required.");
    }
    let contributes = manifest.get("contributes").unwrap_or(&Value::Null);
    if !contributes.is_null() && !contributes.is_object() {
        anyhow::bail!("Manifest contributes must be an object.");
    }
    if let Some(commands) = contributes.get("commands") {
        let Some(commands) = commands.as_array() else { anyhow::bail!("Manifest contributes.commands must be an array."); };
        for (index, command) in commands.iter().enumerate() {
            if command.get("command").and_then(Value::as_str).is_none_or(|v| v.trim().is_empty())
                || command.get("title").and_then(Value::as_str).is_none_or(|v| v.trim().is_empty())
            {
                anyhow::bail!("Manifest command contribution {index} requires command and title.");
            }
        }
    }
    Ok(())
}

pub struct ExtensionsView {
    records: Vec<Value>,
    bundle: Entity<TextareaState>,
    search: Entity<InputState>,
    query: String,
    message: Option<String>,
    _subs: Vec<Subscription>,
}

impl ExtensionsView {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let bundle = cx.new(|cx| TextareaState::new(window, cx).auto_grow(8, 20).placeholder("Paste { manifest, code } JSON or a raw extension manifest"));
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search installed extensions…"));
        let subs = vec![
            cx.subscribe(&bundle, |_, _, event: &InputEvent, cx| if matches!(event, InputEvent::Change) { cx.notify(); }),
            cx.subscribe(&search, |this, state, event: &InputEvent, cx| if matches!(event, InputEvent::Change) { this.query = state.read(cx).value().to_string(); cx.notify(); }),
        ];
        Self { records: load(), bundle, search, query: String::new(), message: None, _subs: subs }
    }

    fn persist(&mut self, cx: &mut Context<Self>) {
        match save(&self.records) {
            Ok(()) => {}
            Err(error) => { self.message = Some(format!("Could not save extension registry: {error:#}")); }
        }
        cx.notify();
    }

    fn install(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.bundle.read(cx).value().to_string();
        let parsed = match serde_json::from_str::<Value>(&text) {
            Ok(value) => value,
            Err(error) => { self.message = Some(format!("Invalid JSON: {error}")); cx.notify(); return; }
        };
        let manifest = parsed.get("manifest").cloned().unwrap_or_else(|| parsed.clone());
        if let Err(error) = validate_manifest(&manifest) { self.message = Some(error.to_string()); cx.notify(); return; }
        let id = manifest["id"].as_str().unwrap_or_default().to_owned();
        let record = json!({
            "manifest": manifest,
            "code": parsed.get("code"),
            "source": "local",
            "enabled": true,
            "installedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
        });
        if let Some(existing) = self.records.iter_mut().find(|r| r["manifest"]["id"] == id) {
            let enabled = existing["enabled"].as_bool().unwrap_or(true);
            *existing = record;
            existing["enabled"] = Value::Bool(enabled);
        } else {
            self.records.push(record);
        }
        self.bundle.update(cx, |s, cx| s.set_value(String::new(), window, cx));
        self.message = Some(format!("Installed {id}. Reload after the native extension sandbox host is available to activate its code."));
        self.persist(cx);
    }

    fn toggle(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(record) = self.records.iter_mut().find(|r| r["manifest"]["id"] == id) {
            let enabled = record["enabled"].as_bool().unwrap_or(true);
            record["enabled"] = Value::Bool(!enabled);
            self.message = Some(format!("{} {id}. Runtime activation awaits the native sandbox host.", if enabled { "Disabled" } else { "Enabled" }));
        }
        self.persist(cx);
    }

    fn uninstall(&mut self, id: &str, cx: &mut Context<Self>) {
        self.records.retain(|r| r["manifest"]["id"] != id);
        self.message = Some(format!("Uninstalled {id}."));
        self.persist(cx);
    }

    fn choose_bundle(&mut self, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some("Select an extension JSON bundle".into()) });
        let bundle = self.bundle.clone();
        let this = cx.entity().downgrade();
        cx.spawn(async move |_, cx| {
            let result = match prompt.await {
                Ok(Ok(Some(paths))) => match paths.first() {
                    Some(path) => {
                        let path = path.clone();
                        tokio::task::spawn_blocking(move || std::fs::read_to_string(path)).await.map_err(|e| e.to_string()).and_then(|r| r.map_err(|e| e.to_string()))
                    }
                    None => return,
                },
                Ok(Ok(None)) | Err(_) => return,
                Ok(Err(error)) => Err(format!("Could not open file picker: {error:#}")),
            };
            cx.update(|cx| match result {
                Ok(text) => {
                    if let Some(window) = cx.active_window() {
                        window.update(cx, |_, window, cx| bundle.update(cx, |state, cx| state.set_value(text, window, cx))).ok();
                    }
                }
                Err(error) => { this.update(cx, |view, cx| { view.message = Some(format!("Could not load bundle: {error}")); cx.notify(); }).ok(); }
            });
        }).detach();
    }
}

impl Render for ExtensionsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        div().size_full().flex().flex_col().overflow_hidden().bg(t.studio_bg).text_color(t.foreground)
            .child(div().px_5().py_4().border_b_1().border_color(t.border)
                .child(div().flex().items_center().gap_2().child(gpui_component::Icon::new(IconName::Puzzle).size_4())
                    .child(div().tw_text_lg().font_weight(gpui::FontWeight::SEMIBOLD).child("Extensions"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} installed", self.records.len())))))
            .child(div().mx_5().mt_4().rounded_md().border_1().border_color(t.border).bg(t.card).p_3()
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Installed bundles and enablement are stored locally. Extension JavaScript, webview panels, commands, and runtime contributions remain inactive until the native sandbox host is ported.")))
            .child(div().px_5().pt_4().child(Input::new(&self.search)))
            .child(div().flex_1().min_h_0().overflow_y_scrollbar().px_5().py_4().flex().flex_col().gap_3()
                .when(self.records.is_empty(), |d| d.child(div().rounded_md().border_1().border_color(t.border).p_4().tw_text_sm().text_color(t.muted_foreground).child("No extensions installed yet.")))
                .children(self.records.iter().filter(|record| {
                    let query = self.query.trim().to_lowercase();
                    query.is_empty() || [record["manifest"]["id"].as_str().unwrap_or_default(), record["manifest"]["displayName"].as_str().unwrap_or_default(), record["manifest"]["name"].as_str().unwrap_or_default(), record["manifest"]["description"].as_str().unwrap_or_default()].iter().any(|text| text.to_lowercase().contains(&query))
                }).map(|record| {
                    let id = record["manifest"]["id"].as_str().unwrap_or("unknown").to_string();
                    let name = record["manifest"]["displayName"].as_str().or_else(|| record["manifest"]["name"].as_str()).unwrap_or(&id).to_string();
                    let version = record["manifest"]["version"].as_str().unwrap_or("?").to_string();
                    let description = record["manifest"]["description"].as_str().unwrap_or("").to_string();
                    let enabled = record["enabled"].as_bool().unwrap_or(true);
                    let (toggle_id, remove_id) = (id.clone(), id.clone());
                    div().flex().items_center().gap_3().rounded_md().border_1().border_color(t.border).bg(t.card).p_3()
                        .child(div().flex_1().min_w_0().flex().flex_col().gap_1()
                            .child(div().flex().items_center().gap_2().child(div().truncate().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child(name)).child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("v{version}"))))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(id.clone()))
                            .when(!description.is_empty(), |d| d.child(div().tw_text_xs().text_color(t.muted_foreground).child(description))))
                        .child(Button::new(format!("ext-toggle-{id}")).outline().size(ButtonSize::Sm).label(if enabled { "Disable" } else { "Enable" }).on_click(cx.listener(move |this, _, _, cx| this.toggle(&toggle_id, cx))))
                        .child(Button::new(format!("ext-remove-{id}")).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(cx.listener(move |this, _, _, cx| this.uninstall(&remove_id, cx))))
                }))
                .child(div().flex().flex_col().gap_2().rounded_md().border_1().border_color(t.border).bg(t.card).p_4()
                    .child(div().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child("Install from JSON bundle"))
                    .child(Textarea::new(&self.bundle).h(px(180.)))
                    .child(div().flex().gap_2()
                        .child(Button::new("extension-file").outline().size(ButtonSize::Sm).icon(IconName::Upload).label("Choose JSON file").on_click(cx.listener(|this, _, _, cx| this.choose_bundle(cx))))
                        .child(Button::new("extension-install").size(ButtonSize::Sm).icon(IconName::Plus).label("Install extension").on_click(cx.listener(|this, _, window, cx| this.install(window, cx)))))
                    .when_some(self.message.clone(), |d, message| d.child(div().tw_text_xs().text_color(t.muted_foreground).child(message)))))
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-features-extensions", |spec, _session: Arc<Session>, window, cx| {
        let TabSpec::View { view, .. } = spec else { return None };
        (view == "extensions").then(|| cx.new(|cx| ExtensionsView::new(window, cx)).into())
    });
}
