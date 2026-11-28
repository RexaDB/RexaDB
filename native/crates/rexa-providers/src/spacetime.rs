//! Port of components/studio/spacetimedb/{panel-shared,schema-viewer,reducer-panel,
//! log-viewer}.tsx (the `database-spacetimedb-*` tabs) and the reducer helpers
//! of lib/db/spacetimedb-client.ts (`getSpacetimeDbReducers`,
//! `resolveAlgebraicTypeName`).
//!
//! Approximation: the original streams logs (`follow=true`); the driver exposes
//! a bounded fetch, so "live" re-polls every 2 seconds while not paused.

use crate::ui;
use gpui::{div, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{Session, StudioEvent, TabSpec};
use rexa_ui::widgets::{Editor, EditorState, Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Switch, TextInput, Toast, Tw, MONO};
use serde_json::Value as J;
use std::collections::HashMap;
use std::sync::Arc;

pub fn build_tab(view: &str, _params: &J, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    Some(match view {
        "database-spacetimedb-schema" => cx.new(|cx| SchemaViewer::new(session, window, cx)).into(),
        "database-spacetimedb-reducers" => cx.new(|cx| ReducerPanel::new(session, window, cx)).into(),
        "database-spacetimedb-logs" => cx.new(|cx| LogViewer::new(session, window, cx)).into(),
        _ => return None,
    })
}

fn on_refresh<V: 'static>(view: &'static str, cx: &mut Context<V>, f: fn(&mut V, &mut Context<V>)) {
    cx.subscribe(&rexa_core::studio_bus(cx), move |this, _, e: &StudioEvent, cx| {
        if let StudioEvent::TabCommand { tab: TabSpec::View { view: v, .. }, command } = e {
            if v == view && command == "REFRESH_CURRENT_TAB" {
                f(this, cx);
            }
        }
    })
    .detach();
}

fn some_str(v: Option<&J>) -> Option<String> {
    let v = v?;
    v.get("some").and_then(J::as_str).or_else(|| v.as_str()).map(str::to_string)
}

/// `resolveAlgebraicTypeName`.
pub fn type_name(at: &J, ts: &[J]) -> String {
    let Some((k, v)) = at.as_object().and_then(|o| o.iter().next()) else { return "unknown".into() };
    match k.as_str() {
        "Ref" => v.as_u64().and_then(|i| ts.get(i as usize)).map(|t| type_name(t, ts)).unwrap_or_else(|| "Ref".into()),
        "Product" => {
            let els = v.get("elements").and_then(J::as_array).cloned().unwrap_or_default();
            if els.len() == 1 {
                let name = some_str(els[0].get("name")).unwrap_or_default();
                match name.as_str() {
                    "__identity__" => return "Identity".into(),
                    "__timestamp_micros_since_unix_epoch__" => return "Timestamp".into(),
                    "__time_duration__" => return "TimeDuration".into(),
                    "__connection_id__" => return "ConnectionId".into(),
                    "__uuid__" => return "Uuid".into(),
                    "" => {
                        let inner = els[0].get("algebraic_type").and_then(|t| t.as_object()).and_then(|o| o.keys().next().cloned());
                        match inner.as_deref() {
                            Some("U256") => return "Identity".into(),
                            Some("I64") => return "Timestamp".into(),
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
            "Product".into()
        }
        "Sum" => {
            let vars = v.get("variants").and_then(J::as_array).cloned().unwrap_or_default();
            match vars.iter().find(|x| x.pointer("/name/some").and_then(J::as_str) == Some("some")) {
                Some(s) => {
                    let inner = type_name(s.get("algebraic_type").unwrap_or(&J::Null), ts);
                    if inner == "unknown" { "Option".into() } else { format!("Option<{inner}>") }
                }
                None => "Sum".into(),
            }
        }
        "Array" => match v.get("elem_ty") {
            Some(e) => format!("Array<{}>", type_name(e, ts)),
            None => "Array".into(),
        },
        other => other.to_string(),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReducerArg {
    pub name: String,
    pub type_name: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReducerInfo {
    pub name: String,
    pub args: Vec<ReducerArg>,
}

/// `getSpacetimeDbReducers`.
pub fn reducers(module: &J) -> Vec<ReducerInfo> {
    let sections = module.get("sections").and_then(J::as_array).cloned().unwrap_or_default();
    let ts = sections.iter().find_map(|s| s.pointer("/Typespace/types").and_then(J::as_array).cloned()).unwrap_or_default();
    let list = sections.iter().find_map(|s| s.get("Reducers").or_else(|| s.get("reducers")).cloned()).or_else(|| module.get("reducers").cloned()).unwrap_or(J::Null);
    let list = list.get("Reducers").or_else(|| list.get("reducers")).cloned().unwrap_or(list);
    let mut out: Vec<ReducerInfo> = list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|r| {
            let name = some_str(r.get("source_name")).or_else(|| some_str(r.get("name")))?;
            let params = r.get("params").or_else(|| r.get("args")).cloned().unwrap_or(J::Null);
            let args = params.get("elements").and_then(J::as_array).cloned().or_else(|| params.as_array().cloned()).unwrap_or_default();
            Some(ReducerInfo {
                name,
                args: args.iter().map(|a| ReducerArg { name: some_str(a.get("name")).unwrap_or_else(|| "?".into()), type_name: type_name(a.get("algebraic_type").unwrap_or(&J::Null), &ts) }).collect(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn is_lifecycle(name: &str) -> bool {
    ["init", "__init__", "on_connect", "__on_connect__", "on_disconnect", "__on_disconnect__"].contains(&name.to_lowercase().as_str())
}

const PRIMITIVES: [&str; 21] = ["Bool", "String", "I8", "I16", "I32", "I64", "I128", "I256", "U8", "U16", "U32", "U64", "U128", "U256", "F32", "F64", "Identity", "ConnectionId", "Timestamp", "TimeDuration", "Bytes"];
const NUMERIC: [&str; 14] = ["I8", "I16", "I32", "I64", "I128", "I256", "U8", "U16", "U32", "U64", "U128", "U256", "F32", "F64"];

fn base_type(t: &str) -> &str {
    let t = t.strip_prefix("Option<").or_else(|| t.strip_prefix("Array<")).unwrap_or(t);
    t.strip_suffix('>').unwrap_or(t)
}

pub fn is_custom_type(t: &str) -> bool {
    !PRIMITIVES.contains(&base_type(t))
}

/// `parseArgValue`.
pub fn parse_arg(value: &str, t: &str) -> J {
    if t.starts_with("Option<") {
        return if value.is_empty() { J::Null } else { J::String(value.into()) };
    }
    if t.starts_with("Array<") || t.ends_with(']') {
        return J::Array(value.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| J::String(s.into())).collect());
    }
    if NUMERIC.contains(&t) {
        return value.trim().parse::<f64>().ok().and_then(|n| if t.starts_with('F') { serde_json::Number::from_f64(n).map(J::Number) } else if n.fract() == 0. && n.abs() < 9e15 { Some(J::from(n as i64)) } else { serde_json::Number::from_f64(n).map(J::Number) }).unwrap_or(J::Null);
    }
    if t == "Bool" {
        return J::Bool(value == "true" || value == "1");
    }
    J::String(value.into())
}

/// `PanelLoadingError`.
fn loading_error(loading: bool, error: Option<String>, label: &str, retry: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> Option<AnyElement> {
    let t = cx.tokens();
    if loading {
        return Some(div().flex_1().flex().items_center().justify_center().gap_2().tw_text_sm().text_color(t.muted_foreground).child(rexa_ui::Spinner::new(16.)).child(label.to_string()).into_any_element());
    }
    error.map(|e| div().flex_1().flex().flex_col().items_center().justify_center().gap_3().p_8().child(div().tw_text_sm().text_color(t.destructive).child(e)).child(Button::new("stdb-retry").outline().size(ButtonSize::Sm).label("Retry").on_click(move |_, w, cx| retry(w, cx))).into_any_element())
}

fn header(icon: IconName, title: &str, sub: Option<&str>, right: Vec<AnyElement>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .gap_2()
        .px_4()
        .py_2()
        .border_b_1()
        .border_color(t.border)
        .child(Icon::new(icon).size(px(16.)).text_color(t.muted_foreground))
        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(title.to_string()))
        .children(sub.map(|s| div().tw_text_xs().text_color(t.muted_foreground).child(s.to_string())))
        .child(div().flex_1())
        .children(right)
        .into_any_element()
}

// ---- schema viewer -----------------------------------------------------------------------

pub struct SchemaViewer {
    session: Arc<Session>,
    schema: Option<J>,
    loading: bool,
    error: Option<String>,
    copied: bool,
    editor: Entity<EditorState>,
    pending: Option<String>,
}

impl SchemaViewer {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let editor = cx.new(|cx| EditorState::new(window, cx).language("json").line_number(true).soft_wrap(true));
        on_refresh("database-spacetimedb-schema", cx, Self::load);
        let mut this = Self { session, schema: None, loading: true, error: None, copied: false, editor, pending: None };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let d = self.session.driver.clone();
        ui::run(cx, async move { d.spacetimedb_module().await }, |this, r, _| {
            this.loading = false;
            match r {
                Ok(s) => {
                    this.pending = Some(serde_json::to_string_pretty(&s).unwrap_or_default());
                    this.schema = Some(s);
                }
                Err(e) => this.error = Some(ui::err_text(&e)),
            }
        });
    }
}

impl Render for SchemaViewer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(v) = self.pending.take() {
            self.editor.update(cx, |s, cx| s.set_value(v, window, cx));
        }
        let t = cx.tokens().clone();
        let mut right = vec![];
        if let Some(s) = self.schema.clone() {
            let copied = self.copied;
            right.push(
                Button::new("stdb-copy")
                    .outline()
                    .size(ButtonSize::Xs)
                    .icon(if copied { IconName::Check } else { IconName::Copy })
                    .label(if copied { "Copied" } else { "Copy JSON" })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        cx.write_to_clipboard(gpui::ClipboardItem::new_string(serde_json::to_string_pretty(&s).unwrap_or_default()));
                        this.copied = true;
                        cx.notify();
                        cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
                            this.update(cx, |v, cx| {
                                v.copied = false;
                                cx.notify();
                            })
                            .ok();
                        })
                        .detach();
                    }))
                    .into_any_element(),
            );
        }
        right.push(Button::new("stdb-schema-refresh").ghost().size(ButtonSize::IconSm).icon(IconName::RefreshCw).disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element());
        let w = cx.entity().downgrade();
        let body = loading_error(self.loading, self.error.clone(), "Loading schema...", move |_, cx| { w.update(cx, |s, cx| s.load(cx)).ok(); }, cx)
            .unwrap_or_else(|| div().flex_1().min_h_0().font_family(MONO).text_size(px(12.)).child(Editor::new(&self.editor).appearance(false).bordered(false).readonly(true).h_full()).into_any_element());
        div().size_full().flex().flex_col().overflow_hidden().bg(t.background).text_color(t.foreground).child(header(IconName::Eye, "Schema", Some("raw module definition"), right, cx)).child(body)
    }
}

// ---- reducer panel -----------------------------------------------------------------------

pub struct ReducerPanel {
    session: Arc<Session>,
    reducers: Vec<ReducerInfo>,
    loading: bool,
    error: Option<String>,
    search: Entity<InputState>,
    inputs: HashMap<(String, String), Entity<InputState>>,
    bools: HashMap<(String, String), bool>,
    calling: Option<String>,
}

impl ReducerPanel {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search reducers..."));
        cx.subscribe(&search, |_, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::Change) {
                cx.notify();
            }
        })
        .detach();
        on_refresh("database-spacetimedb-reducers", cx, Self::load);
        let mut this = Self { session, reducers: vec![], loading: true, error: None, search, inputs: HashMap::new(), bools: HashMap::new(), calling: None };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let d = self.session.driver.clone();
        ui::run(cx, async move { d.spacetimedb_module().await }, |this, r, _| {
            this.loading = false;
            match r {
                Ok(m) => this.reducers = reducers(&m),
                Err(e) => this.error = Some(ui::err_text(&e)),
            }
        });
    }

    fn ensure_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        for r in &self.reducers {
            for a in &r.args {
                let key = (r.name.clone(), a.name.clone());
                if !self.inputs.contains_key(&key) {
                    let ph = a.type_name.clone();
                    let s = cx.new(|cx| InputState::new(window, cx).placeholder(ph));
                    self.inputs.insert(key, s);
                }
            }
        }
    }

    fn call(&mut self, r: ReducerInfo, cx: &mut Context<Self>) {
        let args: Vec<J> = r
            .args
            .iter()
            .map(|a| {
                let key = (r.name.clone(), a.name.clone());
                let raw = if base_type(&a.type_name) == "Bool" { if self.bools.get(&key).copied().unwrap_or(false) { "true".to_string() } else { "false".to_string() } } else { self.inputs.get(&key).map(|s| s.read(cx).value().to_string()).unwrap_or_default() };
                parse_arg(&raw, &a.type_name)
            })
            .collect();
        self.calling = Some(r.name.clone());
        cx.notify();
        let d = self.session.driver.clone();
        let name = r.name.clone();
        ui::run(cx, async move { d.call_spacetimedb_reducer(&name, &args).await.map(|_| name) }, move |this, res, cx| {
            this.calling = None;
            match res {
                Ok(name) => {
                    Toast::success(format!("Reducer '{name}' called successfully")).description("Executed").show(cx);
                }
                Err(e) => {
                    Toast::error(format!("Reducer '{}' failed", r.name)).description(ui::err_text(&e)).show(cx);
                }
            }
        });
    }
}

impl Render for ReducerPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_inputs(window, cx);
        let t = cx.tokens().clone();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let filtered: Vec<ReducerInfo> = self.reducers.iter().filter(|r| q.is_empty() || r.name.to_lowercase().contains(&q)).cloned().collect();
        let right = vec![
            div().w(px(192.)).child(ui::search_box(&self.search, 28., cx)).into_any_element(),
            Button::new("stdb-red-refresh").ghost().size(ButtonSize::IconSm).icon(IconName::RefreshCw).disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element(),
        ];
        let w = cx.entity().downgrade();
        let body = loading_error(self.loading, self.error.clone(), "Loading reducers...", move |_, cx| { w.update(cx, |s, cx| s.load(cx)).ok(); }, cx).unwrap_or_else(|| {
            if filtered.is_empty() {
                return div().flex_1().flex().items_center().justify_center().tw_text_sm().text_color(t.muted_foreground).child(if q.is_empty() { "No reducers found" } else { "No reducers match your search" }).into_any_element();
            }
            div()
                .id("stdb-reducers")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(div().p_4().flex().flex_col().gap_2().children(filtered.into_iter().map(|r| {
                    let lifecycle = is_lifecycle(&r.name);
                    let custom = r.args.iter().any(|a| is_custom_type(&a.type_name));
                    let can_call = !lifecycle && !custom;
                    let calling = self.calling.as_deref() == Some(&r.name);
                    let r2 = r.clone();
                    let args: Vec<AnyElement> = r
                        .args
                        .iter()
                        .map(|a| {
                            let key = (r.name.clone(), a.name.clone());
                            let control: AnyElement = if base_type(&a.type_name) == "Bool" {
                                let on = self.bools.get(&key).copied().unwrap_or(false);
                                let k2 = key.clone();
                                let w = cx.entity().downgrade();
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(Switch::new(SharedString::from(format!("b-{}-{}", key.0, key.1))).checked(on).on_change(move |v, _, cx| {
                                        let k = k2.clone();
                                        w.update(cx, |this, cx| {
                                            this.bools.insert(k, v);
                                            cx.notify();
                                        })
                                        .ok();
                                    }))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(if on { "true" } else { "false" }))
                                    .into_any_element()
                            } else {
                                div().font_family(MONO).tw_text_xs().child(TextInput::new(&self.inputs[&key]).h(28.)).into_any_element()
                            };
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(div().w(px(112.)).flex_shrink_0().truncate().font_family(MONO).tw_text_xs().text_color(t.muted_foreground).child(a.name.clone()).child(div().ml_1().text_size(px(10.)).text_color(with_alpha(t.muted_foreground, 0.6)).child(format!("({})", a.type_name))))
                                .child(div().flex_1().child(control))
                                .into_any_element()
                        })
                        .collect();
                    div()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.border)
                        .p_3()
                        .bg(with_alpha(t.muted, 0.2))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .mb_2()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(div().font_family(MONO).tw_text_sm().font_weight(FontWeight::MEDIUM).child(r.name.clone()))
                                        .when(lifecycle, |d| d.child(Badge::new("lifecycle").variant(BadgeVariant::Secondary)))
                                        .when(custom, |d| d.child(Badge::new("custom types").variant(BadgeVariant::Outline))),
                                )
                                .child(Button::new(SharedString::from(format!("call-{}", r.name))).size(ButtonSize::Xs).icon(if calling { IconName::LoaderCircle } else { IconName::Play }).label("Call").disabled(!can_call || calling).on_click(cx.listener(move |this, _, _, cx| this.call(r2.clone(), cx)))),
                        )
                        .when(!args.is_empty(), |d| d.child(div().ml_1().flex().flex_col().gap(px(6.)).children(args)))
                        .when(r.args.is_empty(), |d| d.child(div().ml_1().tw_text_xs().text_color(t.muted_foreground).child("No arguments")))
                })))
                .into_any_element()
        });
        div().size_full().flex().flex_col().overflow_hidden().bg(t.background).text_color(t.foreground).child(header(IconName::Terminal, "Reducers", None, right, cx)).child(body)
    }
}

// ---- log viewer --------------------------------------------------------------------------

const LEVELS: [&str; 6] = ["trace", "debug", "info", "warn", "error", "panic"];

fn level_color(level: &str, cx: &App) -> gpui::Hsla {
    match level {
        "debug" => tw("blue-500"),
        "info" => tw("emerald-500"),
        "warn" => tw("amber-500"),
        "error" => tw("red-500"),
        "panic" => tw("red-600"),
        _ => cx.tokens().muted_foreground,
    }
}

fn level_icon(level: &str) -> IconName {
    match level {
        "info" => IconName::Info,
        "warn" => IconName::TriangleAlert,
        "error" | "panic" => IconName::CircleAlert,
        _ => IconName::Bug,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LogLine {
    pub time: String,
    pub level: String,
    pub filename: String,
    pub line_number: Option<i64>,
    pub message: String,
}

pub fn parse_log(v: &J) -> LogLine {
    let s = |k: &str| v.get(k).and_then(J::as_str).unwrap_or("").to_string();
    LogLine { time: s("ts").max(s("time")), level: s("level").to_lowercase(), filename: s("filename"), line_number: v.get("line_number").and_then(J::as_i64), message: s("message") }
}

pub struct LogViewer {
    session: Arc<Session>,
    lines: Vec<LogLine>,
    paused: bool,
    levels: Vec<&'static str>,
    file_filter: Entity<InputState>,
    text_filter: Entity<InputState>,
    connected: bool,
    generation: u64,
}

impl LogViewer {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mk = |p: &str, window: &mut Window, cx: &mut Context<Self>| {
            let s = cx.new(|cx| InputState::new(window, cx).placeholder(p.to_string()));
            cx.subscribe(&s, |_, _, e: &InputEvent, cx| {
                if matches!(e, InputEvent::Change) {
                    cx.notify();
                }
            })
            .detach();
            s
        };
        let file_filter = mk("Filter file...", window, cx);
        let text_filter = mk("Search text...", window, cx);
        let mut this = Self { session, lines: vec![], paused: false, levels: vec!["info", "warn", "error", "panic"], file_filter, text_filter, connected: false, generation: 0 };
        this.start(cx);
        this
    }

    /// `startStream`: fetch the last 1000 lines, then poll while live.
    fn start(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self.lines.clear();
        self.connected = false;
        cx.notify();
        let d = self.session.driver.clone();
        cx.spawn(async move |this, cx| {
            let mut first = true;
            loop {
                let paused = this.update(cx, |v, _| v.paused || v.generation != generation).unwrap_or(true);
                let alive = this.update(cx, |v, _| v.generation == generation).unwrap_or(false);
                if !alive {
                    break;
                }
                if !paused || first {
                    let d2 = d.clone();
                    let r = rexa_core::runtime::spawn(async move { d2.spacetimedb_logs(if first { 1000 } else { 200 }).await }).await;
                    let ok = this
                        .update(cx, |v, cx| {
                            match r {
                                Ok(rows) => {
                                    // Newest first, de-duplicated against what we already show.
                                    let mut fresh: Vec<LogLine> = rows.iter().map(parse_log).collect();
                                    fresh.reverse();
                                    let newest = v.lines.first().map(|l| l.time.clone()).unwrap_or_default();
                                    fresh.retain(|l| l.time > newest || newest.is_empty());
                                    fresh.extend(std::mem::take(&mut v.lines));
                                    fresh.truncate(10_000);
                                    v.lines = fresh;
                                    v.connected = true;
                                }
                                Err(_) => v.connected = false,
                            }
                            cx.notify();
                        })
                        .is_ok();
                    if !ok {
                        break;
                    }
                    first = false;
                }
                cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
            }
        })
        .detach();
    }
}

impl Render for LogViewer {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let ff = self.file_filter.read(cx).value().to_lowercase();
        let tf = self.text_filter.read(cx).value().to_lowercase();
        let filtered: Vec<&LogLine> = self.lines.iter().filter(|l| (self.levels.is_empty() || self.levels.contains(&l.level.as_str())) && (ff.is_empty() || l.filename.to_lowercase().contains(&ff)) && (tf.is_empty() || l.message.to_lowercase().contains(&tf))).collect();
        let levels = div().flex().items_center().gap_1().ml_2().children(LEVELS.iter().map(|lv| {
            let on = self.levels.contains(lv);
            let c = level_color(lv, cx);
            div()
                .id(SharedString::from(format!("lv-{lv}")))
                .flex()
                .items_center()
                .gap_1()
                .px(px(6.))
                .py(px(2.))
                .rounded(px(4.))
                .text_size(px(10.))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .when(on, |d| d.text_color(c).bg(t.muted))
                .when(!on, |d| d.text_color(with_alpha(t.muted_foreground, 0.4)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(i) = this.levels.iter().position(|x| x == lv) {
                        this.levels.remove(i);
                    } else {
                        this.levels.push(lv);
                    }
                    cx.notify();
                }))
                .child(Icon::new(level_icon(lv)).size(px(12.)))
                .child(*lv)
        }));
        let live = if self.connected {
            div().px(px(6.)).rounded(px(6.)).bg(with_alpha(tw("emerald-500"), 0.2)).text_size(px(10.)).text_color(tw("emerald-500")).child("live").into_any_element()
        } else {
            Badge::new("disconnected").variant(BadgeVariant::Secondary).into_any_element()
        };
        let head = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_2()
            .px_4()
            .py_2()
            .border_b_1()
            .border_color(t.border)
            .child(Icon::new(IconName::ScrollText).size(px(16.)).text_color(t.muted_foreground))
            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Logs"))
            .child(levels)
            .child(div().flex_1())
            .child(div().w(px(112.)).tw_text_xs().child(TextInput::new(&self.file_filter).h(28.)))
            .child(div().w(px(144.)).tw_text_xs().child(TextInput::new(&self.text_filter).h(28.)))
            .child(live)
            .child(Button::new("lg-pause").ghost().size(ButtonSize::IconSm).icon(if self.paused { IconName::Play } else { IconName::Pause }).on_click(cx.listener(|this, _, _, cx| {
                this.paused = !this.paused;
                cx.notify();
            })))
            .child(Button::new("lg-restart").ghost().size(ButtonSize::IconSm).icon(IconName::RotateCw).on_click(cx.listener(|this, _, _, cx| this.start(cx))));
        let body: AnyElement = if filtered.is_empty() {
            div().flex_1().flex().flex_col().items_center().justify_center().min_h(px(200.)).gap_2().tw_text_sm().text_color(t.muted_foreground).child(Icon::new(IconName::SearchX).size(px(32.))).child(if self.connected { "No matching log lines" } else { "Connecting to log stream..." }).into_any_element()
        } else {
            div()
                .id("lg-lines")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .font_family(MONO)
                .tw_text_xs()
                .children(filtered.iter().map(|l| {
                    let c = level_color(&l.level, cx);
                    let time = ui::parse_ts(&l.time).map(|d| d.format("%-I:%M:%S %p").to_string()).unwrap_or_default();
                    div()
                        .flex()
                        .items_start()
                        .gap_2()
                        .px_4()
                        .py(px(2.))
                        .border_b_1()
                        .border_color(with_alpha(t.border, 0.1))
                        .hover(|d| d.bg(with_alpha(t.muted, 0.4)))
                        .text_color(c)
                        .when(l.level == "panic", |d| d.font_weight(FontWeight::BOLD))
                        .child(div().w(px(80.)).flex_shrink_0().truncate().text_size(px(10.)).text_color(t.muted_foreground).child(time))
                        .child(div().mt(px(2.)).child(Icon::new(level_icon(&l.level)).size(px(12.))))
                        .child(div().w(px(64.)).flex_shrink_0().truncate().text_size(px(10.)).text_color(t.muted_foreground).child(l.level.clone()))
                        .child(div().w(px(96.)).flex_shrink_0().truncate().text_size(px(10.)).text_color(t.muted_foreground).child(if l.filename.is_empty() { String::new() } else { format!("{}:{}", l.filename, l.line_number.map(|n| n.to_string()).unwrap_or_default()) }))
                        .child(div().flex_1().min_w_0().child(l.message.clone()))
                }))
                .into_any_element()
        };
        let foot = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .px_4()
            .py_1()
            .border_t_1()
            .border_color(t.border)
            .text_size(px(10.))
            .text_color(t.muted_foreground)
            .child(format!("{} lines", filtered.len()))
            .child(div().when(self.paused, |d| d.text_color(tw("amber-500")).font_weight(FontWeight::MEDIUM)).child(if self.paused { "PAUSED" } else if self.connected { "streaming" } else { "disconnected" }));
        div().size_full().flex().flex_col().overflow_hidden().bg(t.background).text_color(t.foreground).child(head).child(body).child(foot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reducers_and_types() {
        let m = json!({"sections": [
            {"Typespace": {"types": [{"Product": {"elements": [{"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}]}}]}},
            {"Reducers": [
                {"source_name": "send_message", "params": {"elements": [{"name": {"some": "text"}, "algebraic_type": {"String": []}}, {"name": {"some": "to"}, "algebraic_type": {"Ref": 0}}]}},
                {"source_name": "init", "params": {"elements": []}}
            ]}
        ]});
        let r = reducers(&m);
        assert_eq!(r[0].name, "init");
        assert_eq!(r[1].args[1].type_name, "Identity");
        assert!(is_lifecycle("__init__"));
        assert!(!is_custom_type("Option<String>"));
        assert!(is_custom_type("Product"));
    }

    #[test]
    fn parses_args() {
        assert_eq!(parse_arg("42", "U32"), json!(42));
        assert_eq!(parse_arg("1.5", "F64"), json!(1.5));
        assert_eq!(parse_arg("true", "Bool"), json!(true));
        assert_eq!(parse_arg("", "Option<String>"), J::Null);
        assert_eq!(parse_arg("a, b", "Array<String>"), json!(["a", "b"]));
        assert_eq!(parse_arg("hi", "String"), json!("hi"));
    }
}
