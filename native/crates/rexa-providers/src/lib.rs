//! Provider-specific studio views.
//!
//! The first native provider tab is a Redis key browser. It uses the driver's
//! bounded metadata scan and displays the value of a selected key without
//! exposing Redis commands in the UI.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_drivers::{Kind, RedisKeyInfo};
use rexa_ui::widgets::{InputEvent, InputState};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, MONO};
use serde_json::Value;
use std::sync::Arc;

mod common;
mod database_views;
mod team;

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-providers", build_tab);
    Registry::screen(cx, "rexa-providers", team::build_screen);
}

fn build_tab(spec: &TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    let TabSpec::View { view, params } = spec else { return None };
    if let Some(tab) = database_views::build_tab(spec, session.clone(), window, cx) { return Some(tab); }
    if view == "manage-workspaces" {
        return Some(cx.new(|cx| team::Workspaces::new(window, cx)).into());
    }
    if view != "redis" && view != "redis-keys" && view != "redis-browser" { return None; }
    if session.driver.kind() != Kind::Redis {
        return Some(cx.new(|cx| RedisKeys::unsupported(session, window, cx)).into());
    }
    let spec = spec.clone();
    let params = params.clone();
    Some(cx.new(|cx| RedisKeys::new(spec, params, session, window, cx)).into())
}

pub struct RedisKeys {
    session: Arc<Session>,
    pattern: Entity<InputState>,
    keys: Vec<RedisKeyInfo>,
    selected: Option<String>,
    value: Option<String>,
    loading: bool,
    error: Option<String>,
    db: Option<String>,
    _subs: Vec<gpui::Subscription>,
}

impl RedisKeys {
    fn unsupported(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let pattern = cx.new(|cx| InputState::new(window, cx).placeholder("Redis key pattern (e.g. cache:*)"));
        Self { session, pattern, keys: vec![], selected: None, value: None, loading: false, error: Some("The Redis browser requires a Redis connection.".into()), db: None, _subs: vec![] }
    }

    fn new(spec: TabSpec, params: Value, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let pattern = cx.new(|cx| InputState::new(window, cx).default_value("*".to_string()).placeholder("Redis key pattern (e.g. cache:*)"));
        let spec_for_sub = spec.clone();
        let subs = vec![
            cx.subscribe(&pattern, |this, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    this.load_keys(cx);
                }
            }),
            cx.subscribe(&rexa_core::studio_bus(cx), move |this, _, event: &rexa_core::StudioEvent, cx| {
                if let rexa_core::StudioEvent::TabCommand { tab, command } = event {
                    if tab == &spec_for_sub && command == "REFRESH_CURRENT_TAB" { this.load_keys(cx); }
                }
            }),
        ];
        let mut this = Self {
            session,
            pattern,
            keys: vec![],
            selected: None,
            value: None,
            loading: false,
            error: None,
            db: params.get("db").and_then(Value::as_str).map(str::to_owned),
            _subs: subs,
        };
        this.load_keys(cx);
        this
    }

    fn load_keys(&mut self, cx: &mut Context<Self>) {
        let pattern = self.pattern.read(cx).value().trim().to_string();
        let pattern = if pattern.is_empty() { "*".to_string() } else { pattern };
        let db = self.db.clone();
        let driver = self.session.driver.clone();
        self.loading = true;
        self.error = None;
        cx.notify();
        let task = runtime::spawn(async move { driver.redis_keys(&pattern, 500, db.as_deref()).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |view, cx| {
                view.loading = false;
                match result {
                    Ok(keys) => {
                        if view.selected.as_ref().is_some_and(|key| !keys.iter().any(|row| &row.key == key)) {
                            view.selected = None;
                            view.value = None;
                        }
                        view.keys = keys;
                    }
                    Err(error) => view.error = Some(format!("{error:#}")),
                }
                cx.notify();
            }).ok();
        }).detach();
    }

    fn select_key(&mut self, key: String, kind: String, cx: &mut Context<Self>) {
        self.selected = Some(key.clone());
        self.value = None;
        self.error = None;
        cx.notify();
        let command = rexa_drivers::redis_key_command(&key, &kind);
        let driver = self.session.driver.clone();
        let task = runtime::spawn(async move { driver.execute(&command, 500).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |view, cx| {
                match result {
                    Ok(result) => {
                        let rows: Vec<Vec<&str>> = result.rows.iter().map(|r| r.iter().map(|c| c.display()).collect()).collect();
                        view.value = Some(if rows.is_empty() {
                            "(empty)".to_string()
                        } else {
                            rows.into_iter().map(|r| r.join("  ")).collect::<Vec<_>>().join("\n")
                        });
                    }
                    Err(error) => view.error = Some(format!("{error:#}")),
                }
                cx.notify();
            }).ok();
        }).detach();
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        div().flex().items_center().gap_2().p_3().border_b_1().border_color(t.border)
            .child(div().flex_1().max_w(px(420.)).child(rexa_ui::TextInput::new(&self.pattern)))
            .child(Button::new("redis-refresh").size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").on_click(cx.listener(|this, _, _, cx| this.load_keys(cx))))
            .child(div().text_xs().text_color(t.muted_foreground).child(SharedString::from(if self.loading { "Scanning…".to_string() } else { format!("{} keys (limit 500)", self.keys.len()) })))
    }
}

impl Render for RedisKeys {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let header = self.render_header(cx);
        let key_rows = self.keys.iter().map(|row| {
            let key = row.key.clone();
            let kind = row.r#type.clone();
            let selected = self.selected.as_deref() == Some(key.as_str());
            let ttl = row.ttl_seconds.map(rexa_drivers::format_ttl_human).unwrap_or_else(|| "—".into());
            let size = row.size.map(|n| n.to_string()).unwrap_or_else(|| "—".into());
            div().id(SharedString::from(format!("redis-key-{}", key))).flex().items_center().gap_3().px_3().py_2().cursor_pointer()
                .when(selected, |d| d.bg(t.accent.opacity(0.18)))
                .hover(|d| d.bg(t.accent.opacity(0.10)))
                .on_click(cx.listener(move |this, _, _, cx| this.select_key(key.clone(), kind.clone(), cx)))
                .child(div().flex_1().font_family(MONO).text_sm().text_color(t.foreground).child(row.key.clone()))
                .child(div().w(px(70.)).text_xs().text_color(t.muted_foreground).child(row.r#type.clone()))
                .child(div().w(px(72.)).text_xs().text_color(t.muted_foreground).child(format!("TTL {ttl}")))
                .child(div().w(px(54.)).text_right().text_xs().text_color(t.muted_foreground).child(format!("{size} B")))
        });
        let selected = self.selected.clone();
        let content = if let Some(error) = self.error.as_ref() {
            div().p_4().text_sm().text_color(t.muted_foreground).child(error.clone()).into_any_element()
        } else {
            div().flex().flex_1().min_h_0()
                .child(div().w(px(520.)).flex_shrink_0().overflow_y_scrollbar().children(key_rows))
                .child(div().flex_1().min_w_0().border_l_1().border_color(t.border).flex().flex_col()
                    .child(div().px_3().py_2().border_b_1().border_color(t.border).text_sm().font_weight(FontWeight::MEDIUM).child(selected.unwrap_or_else(|| "Select a key".into())))
                    .child(div().flex_1().overflow_y_scrollbar().p_3().font_family(MONO).text_sm().text_color(t.foreground).child(self.value.clone().unwrap_or_else(|| "Key value appears here".into()))))
                .into_any_element()
        };
        div().flex().flex_col().size_full().bg(t.background).text_color(t.foreground).child(header).child(content)
    }
}
