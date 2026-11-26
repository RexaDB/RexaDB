//! GPUI extension manager for the existing local JSON bundle format.
//!
//! Native bundle management is available now. The legacy Worker sandbox host
//! still needs a native equivalent before extension JavaScript can activate.

use gpui::{div, prelude::*, px, App, AppContext, Context, Entity, Subscription, Window};
use gpui_component::{input::{InputEvent, Textarea, TextareaState}, scroll::ScrollableElement};
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
    if id.is_empty() || !id.contains('.') || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_') {
        anyhow::bail!("Manifest id must be a publisher.name identifier.");
    }
    if manifest.get("version").and_then(Value::as_str).is_none_or(str::is_empty) {
        anyhow::bail!("Manifest version is required.");
    }
    if manifest.get("engines").and_then(|v| v.get("rexadb")).and_then(Value::as_str).is_none() {
        anyhow::bail!("Manifest engines.rexadb is required.");
    }
    Ok(())
}

pub struct ExtensionsView {
    records: Vec<Value>,
    bundle: Entity<TextareaState>,
    message: Option<String>,
    _subs: Vec<Subscription>,
}

impl ExtensionsView {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let bundle = cx.new(|cx| TextareaState::new(window, cx).auto_grow(8, 20).placeholder("Paste { manifest, code } JSON or a raw extension manifest"));
        let sub = cx.subscribe(&bundle, |_, _, event: &InputEvent, cx| if matches!(event, InputEvent::Change) { cx.notify(); });
        Self { records: load(), bundle, message: None, _subs: vec![sub] }
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
            .child(div().flex_1().min_h_0().overflow_y_scrollbar().px_5().py_4().flex().flex_col().gap_3()
                .when(self.records.is_empty(), |d| d.child(div().rounded_md().border_1().border_color(t.border).p_4().tw_text_sm().text_color(t.muted_foreground).child("No extensions installed yet.")))
                .children(self.records.iter().map(|record| {
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
                    .child(Button::new("extension-install").size(ButtonSize::Sm).icon(IconName::Plus).label("Install extension").on_click(cx.listener(|this, _, window, cx| this.install(window, cx))))
                    .when_some(self.message.clone(), |d, message| d.child(div().tw_text_xs().text_color(t.muted_foreground).child(message)))))
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-features-extensions", |spec, _session: Arc<Session>, window, cx| {
        let TabSpec::View { view, .. } = spec else { return None };
        (view == "extensions").then(|| cx.new(|cx| ExtensionsView::new(window, cx)).into())
    });
}
