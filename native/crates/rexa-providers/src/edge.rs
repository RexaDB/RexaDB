//! Port of components/studio/edge-functions/{edge-functions-view,edge-function-view,
//! edge-function-events,edge-secrets-view}.tsx and lib/studio/edge-functions-utils.ts,
//! talking to the Supabase Management API directly (the old app went through the
//! Bun sidecar proxy).
//!
//! Approximations: the Monaco editor is the gpui-component code editor (no
//! TypeScript highlighting); the recharts bar chart is drawn with plain bars.

use crate::data_table::{Column, DataTable, Row, TableState};
use crate::supabase::{self, Access, ConnInfo};
use crate::ui::{self, Prompt};
use gpui::{div, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, FocusHandle, FontWeight, SharedString, Window};
use rexa_core::{Session, StudioEvent, TabSpec};
use rexa_ui::widgets::{Editor, EditorState, Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, Checkbox, ConfirmOptions, Dialog, DropdownMenu, IconName, MenuItem, OverlayId, Select, SelectOption, Switch, TextInput, Toast, Tw, MONO};
use serde_json::Value;
use std::sync::Arc;

pub fn build_tab(view: &str, params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    Some(match view {
        "edge-functions" => cx.new(|cx| EdgeFunctionsView::new(session, window, cx)).into(),
        "edge-secrets" => cx.new(|cx| EdgeSecretsView::new(session, window, cx)).into(),
        "edge-function" => {
            let name = params.get("functionName").or_else(|| params.get("name")).and_then(Value::as_str).unwrap_or_default().to_string();
            cx.new(|cx| EdgeFunctionView::new(session, name, window, cx)).into()
        }
        _ => return None,
    })
}

// ---- edge-functions-utils ---------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EdgeFunction {
    pub slug: String,
    pub name: String,
    pub status: String,
    pub version: Option<i64>,
    pub verify_jwt: Option<bool>,
    pub updated_at: Option<String>,
}

fn normalize_ts(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::Number(n) => {
            let n = n.as_f64()?;
            let ms = if n < 1e12 { n * 1000. } else { n };
            chrono::DateTime::from_timestamp_millis(ms as i64).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        }
        Value::String(s) if !s.is_empty() => Some(ui::parse_ts(s).map(|d| d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)).unwrap_or_else(|| s.clone())),
        _ => None,
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn normalize_function(row: &Value) -> EdgeFunction {
    EdgeFunction {
        slug: s(row, "slug").or_else(|| s(row, "name")).unwrap_or_default(),
        name: s(row, "name").or_else(|| s(row, "slug")).unwrap_or_default(),
        status: s(row, "status").unwrap_or_else(|| "UNKNOWN".into()),
        version: row.get("version").and_then(Value::as_i64),
        verify_jwt: row.get("verify_jwt").and_then(Value::as_bool),
        updated_at: normalize_ts(row.get("updated_at")),
    }
}

pub fn function_url(project_ref: &str, slug: &str) -> String {
    format!("https://{project_ref}.supabase.co/functions/v1/{slug}")
}

/// `timeAgo` ("5 months ago").
pub fn time_ago(value: Option<&str>) -> String {
    let Some(t) = value.and_then(ui::parse_ts) else { return "—".into() };
    let secs = (chrono::Local::now() - t).num_seconds().max(0);
    let plural = |n: i64, unit: &str| format!("{n} {unit}{} ago", if n == 1 { "" } else { "s" });
    if secs < 60 {
        return "just now".into();
    }
    let m = secs / 60;
    if m < 60 {
        return plural(m, "minute");
    }
    let h = m / 60;
    if h < 24 {
        return plural(h, "hour");
    }
    let d = h / 24;
    if d < 30 {
        return plural(d, "day");
    }
    let mo = d / 30;
    if mo < 12 {
        return plural(mo, "month");
    }
    plural(mo / 12, "year")
}

async fn access_for(info: Option<ConnInfo>) -> anyhow::Result<Access> {
    supabase::resolve_access(info).await?.ok_or_else(|| anyhow::anyhow!("Edge Functions are unavailable here."))
}

pub async fn list_functions(a: &Access) -> anyhow::Result<Vec<EdgeFunction>> {
    let rows = supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/functions", a.project_ref), None).await?;
    let mut list: Vec<EdgeFunction> = rows.as_array().map(|r| r.iter().map(normalize_function).filter(|f| !f.slug.is_empty()).collect()).unwrap_or_default();
    list.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(list)
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodeFile {
    pub name: String,
    pub content: String,
}

/// Balanced-bracket JSON string-array extractor for `"key": [...]`.
fn extract_json_string_array(text: &str, key: &str) -> Option<Vec<String>> {
    let key_idx = text.find(&format!("\"{key}\":"))?;
    let start = key_idx + text[key_idx..].find('[')?;
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for (i, ch) in text[start..].char_indices() {
        if in_str {
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
        } else if ch == '"' {
            in_str = true;
        } else if ch == '[' {
            depth += 1;
        } else if ch == ']' {
            depth -= 1;
            if depth == 0 {
                let arr: Vec<Value> = serde_json::from_str(&text[start..start + i + 1]).ok()?;
                return arr.iter().map(|v| v.as_str().map(str::to_string)).collect();
            }
        }
    }
    None
}

/// `extractFunctionSources`.
pub fn extract_function_sources(text: &str) -> Option<Vec<CodeFile>> {
    let names = extract_json_string_array(text, "sources")?;
    let contents = extract_json_string_array(text, "sourcesContent")?;
    if names.is_empty() {
        return None;
    }
    let files: Vec<CodeFile> = names.into_iter().enumerate().map(|(i, name)| CodeFile { name, content: contents.get(i).cloned().unwrap_or_default() }).filter(|f| !f.content.is_empty()).collect();
    (!files.is_empty()).then_some(files)
}

/// `parseMultipartBody`.
pub fn parse_multipart_body(text: &str) -> Vec<CodeFile> {
    let first = text.lines().next().unwrap_or("").trim();
    let Some(boundary) = first.strip_prefix("--").map(|b| b.trim_end_matches("--")).filter(|b| !b.is_empty()) else {
        return vec![CodeFile { name: "index.ts".into(), content: text.into() }];
    };
    let boundary = format!("--{boundary}");
    let mut files = vec![];
    for chunk in text.split(&boundary).skip(1) {
        if chunk.lines().next().unwrap_or("").trim() == "--" {
            continue;
        }
        let name = chunk.find("filename=\"").and_then(|i| {
            let rest = &chunk[i + 10..];
            rest.find('"').map(|j| rest[..j].rsplit('/').next().unwrap_or("").to_string())
        });
        let sep = chunk.find("\r\n\r\n").map(|i| i + 4).or_else(|| chunk.find("\n\n").map(|i| i + 2));
        let Some(sep) = sep else { continue };
        let content = chunk[sep..].strip_suffix("\r\n").or_else(|| chunk[sep..].strip_suffix('\n')).unwrap_or(&chunk[sep..]).to_string();
        let n = files.len() + 1;
        files.push(CodeFile { name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| format!("file-{n}")), content });
    }
    if files.is_empty() {
        vec![CodeFile { name: "index.ts".into(), content: text.into() }]
    } else {
        files
    }
}

async fn fetch_body(a: &Access, slug: &str) -> anyhow::Result<Vec<CodeFile>> {
    let res = supabase::http().get(format!("{}/projects/{}/functions/{}/body", supabase::API, a.project_ref, supabase::enc(slug))).bearer_auth(&a.token).send().await?;
    let status = res.status();
    let bytes = res.bytes().await.unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        anyhow::bail!("Supabase API {}: {}", status.as_u16(), if text.is_empty() { status.canonical_reason().unwrap_or("").to_string() } else { text });
    }
    Ok(extract_function_sources(&text).unwrap_or_else(|| parse_multipart_body(&text)))
}

/// `deployEdgeFunction`: one `file` part per source + a JSON `metadata` part.
async fn deploy(a: &Access, slug: &str, entrypoint: &str, name: Option<String>, verify_jwt: Option<bool>, files: Vec<CodeFile>) -> anyhow::Result<()> {
    if files.is_empty() {
        anyhow::bail!("Nothing to deploy.");
    }
    let mut meta = serde_json::json!({ "entrypoint_path": entrypoint });
    if let Some(n) = name {
        meta["name"] = n.into();
    }
    if let Some(v) = verify_jwt {
        meta["verify_jwt"] = v.into();
    }
    let mut form = reqwest::multipart::Form::new().text("metadata", meta.to_string());
    for f in files {
        form = form.part("file", reqwest::multipart::Part::text(f.content).file_name(f.name).mime_str("application/typescript")?);
    }
    let res = supabase::http().post(format!("{}/projects/{}/functions/deploy?slug={}", supabase::API, a.project_ref, supabase::enc(slug))).bearer_auth(&a.token).multipart(form).send().await?;
    supabase::read_response(res).await.map(|_| ())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionEvent {
    pub timestamp: Option<String>,
    pub message: String,
    pub method: Option<String>,
    pub status: Option<i64>,
    pub request_id: Option<String>,
}

fn escape_clickhouse_like(v: &str) -> String {
    v.replace('\\', "\\\\").replace('\'', "\\'").replace('%', "\\%").replace('_', "\\_")
}

/// `buildFunctionEventsSql` (shown in "Explore via query").
pub fn build_events_sql(slug: &str, source: &str, filter_by_slug: bool) -> String {
    let w = if filter_by_slug { format!("WHERE source_name IN ('{source}') AND event_message LIKE '%{}%'", escape_clickhouse_like(slug)) } else { format!("WHERE source_name IN ('{source}')") };
    format!("SELECT timestamp, event_message FROM logs {w} ORDER BY timestamp DESC LIMIT 100")
}

fn find_log_rows(v: &Value, depth: usize) -> Option<Vec<Value>> {
    if let Some(a) = v.as_array() {
        return Some(a.clone());
    }
    let o = v.as_object().filter(|_| depth < 3)?;
    for k in ["result", "data", "results", "rows", "events", "logs", "items"] {
        if let Some(a) = o.get(k).and_then(Value::as_array) {
            return Some(a.clone());
        }
    }
    o.values().find_map(|x| find_log_rows(x, depth + 1))
}

fn first_match(msg: &str, f: impl Fn(&str) -> bool) -> Option<String> {
    msg.split(|c: char| !c.is_ascii_alphanumeric() && c != '-').find(|w| f(w)).map(str::to_string)
}

pub fn parse_events(rows: &[Value], slug: &str) -> Vec<FunctionEvent> {
    let slug_lower = slug.to_lowercase();
    let mut out = vec![];
    for r in rows {
        let message = r.get("event_message").or_else(|| r.get("message")).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_default();
        let raw = r.get("attributes").or_else(|| r.get("log_attributes")).or_else(|| r.get("metadata"));
        let attrs: serde_json::Map<String, Value> = match raw {
            Some(Value::Object(m)) => m.clone(),
            Some(Value::String(s)) => serde_json::from_str::<Value>(s).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default(),
            _ => Default::default(),
        };
        let hay = format!("{message} {}", Value::Object(attrs.clone())).to_lowercase();
        if !hay.contains(&slug_lower) {
            continue;
        }
        let a = |k: &str| attrs.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
        let method = a("request.method").or_else(|| a("method")).or_else(|| a("http.method")).or_else(|| first_match(&message, |w| matches!(w, "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD")));
        let status_raw = ["response.status_code", "status_code", "status"].iter().find_map(|k| attrs.get(*k).cloned());
        let status = match status_raw {
            Some(Value::Number(n)) => n.as_i64(),
            Some(Value::String(s)) if s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty() => s.parse().ok(),
            Some(_) => None,
            None => first_match(&message, |w| w.len() == 3 && w.chars().all(|c| c.is_ascii_digit()) && ('1'..='5').contains(&w.chars().next().unwrap())).and_then(|w| w.parse().ok()),
        };
        let request_id = a("request.id").or_else(|| a("request_id")).or_else(|| a("id")).or_else(|| first_match(&message, is_uuid));
        let timestamp = normalize_ts(r.get("timestamp")).or_else(|| r.get("timestamp").filter(|v| !v.is_null()).map(|v| v.to_string()));
        out.push(FunctionEvent { timestamp, message, method, status, request_id });
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    out
}

fn is_uuid(w: &str) -> bool {
    let parts: Vec<&str> = w.split('-').collect();
    parts.len() == 5 && [8, 4, 4, 4, 12].iter().zip(&parts).all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// `fetchFunctionEvents`: tries several query shapes, retries 429s with backoff.
pub async fn fetch_events(a: &Access, slug: &str, source: &str, start: chrono::DateTime<chrono::Utc>, end: chrono::DateTime<chrono::Utc>) -> anyhow::Result<Vec<FunctionEvent>> {
    let mut last = anyhow::anyhow!("No logs returned.");
    for attempt in 0..3 {
        match fetch_events_once(a, slug, source, start, end).await {
            Ok(e) => return Ok(e),
            Err(e) => {
                let msg = format!("{e:#}").to_lowercase();
                last = e;
                if !(msg.contains("429") || msg.contains("too many requests")) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(2000 * (attempt + 1))).await;
            }
        }
    }
    Err(last)
}

async fn fetch_events_once(a: &Access, slug: &str, source: &str, start: chrono::DateTime<chrono::Utc>, end: chrono::DateTime<chrono::Utc>) -> anyhow::Result<Vec<FunctionEvent>> {
    let cond = if source == "function_edge_logs" { format!(" AND event_message LIKE '%{}%'", escape_clickhouse_like(slug)) } else { String::new() };
    let queries = [
        format!("SELECT timestamp, event_message, attributes FROM logs WHERE source_name IN ('{source}'){cond} ORDER BY timestamp DESC LIMIT 100"),
        format!("SELECT timestamp, event_message FROM logs WHERE source_name IN ('{source}'){cond} ORDER BY timestamp DESC LIMIT 100"),
        format!("SELECT timestamp, event_message FROM logs WHERE source IN ('{source}'){cond} ORDER BY timestamp DESC LIMIT 100"),
        "SELECT timestamp, event_message FROM logs ORDER BY timestamp DESC LIMIT 100".to_string(),
    ];
    let iso = |d: chrono::DateTime<chrono::Utc>| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut last: Option<anyhow::Error> = None;
    for q in queries {
        let qs: String = url::form_urlencoded::Serializer::new(String::new()).append_pair("sql", &q).append_pair("iso_timestamp_start", &iso(start)).append_pair("iso_timestamp_end", &iso(end)).finish();
        match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/analytics/endpoints/logs?{qs}", a.project_ref), None).await {
            Ok(res) => {
                if let Some(rows) = find_log_rows(&res, 0) {
                    return Ok(parse_events(&rows, slug));
                }
                let msg = ["message", "error", "msg"].iter().find_map(|k| res.get(*k).and_then(Value::as_str)).map(str::to_string);
                last = Some(anyhow::anyhow!(msg.unwrap_or_else(|| "Unexpected response shape from logs endpoint.".into())));
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| anyhow::anyhow!("No logs returned.")))
}

fn open_function_tab(slug: &str, cx: &mut App) {
    if slug.is_empty() {
        return;
    }
    rexa_core::open_tab(TabSpec::View { view: "edge-function".into(), params: serde_json::json!({ "id": format!("edge-function-{slug}"), "name": slug, "functionName": slug }) }, cx);
}

fn load_error_box(id: &'static str, title: &str, err: String, retry: impl Fn(&mut Window, &mut App) + 'static, outline: bool, cx: &App) -> AnyElement {
    let t = cx.tokens();
    let btn = Button::new(id).size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Retry").on_click(move |_, w, cx| retry(w, cx));
    div()
        .mx_auto()
        .w_full()
        .max_w(px(512.))
        .tw_rounded_xl()
        .border_1()
        .border_color(with_alpha(t.destructive, 0.3))
        .bg(with_alpha(t.destructive, 0.1))
        .p_6()
        .flex()
        .flex_col()
        .items_center()
        .text_center()
        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(title.to_string()))
        .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child(err))
        .child(div().mt_3().child(if outline { btn.outline() } else { btn }))
        .into_any_element()
}

fn search_input<V: 'static>(placeholder: &str, window: &mut Window, cx: &mut Context<V>) -> Entity<InputState> {
    let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder.to_string()));
    cx.subscribe(&state, |_, _, e: &InputEvent, cx| {
        if matches!(e, InputEvent::Change) {
            cx.notify();
        }
    })
    .detach();
    state
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

// ---- edge-functions-view ---------------------------------------------------------------

pub struct EdgeFunctionsView {
    info: Option<ConnInfo>,
    functions: Vec<EdgeFunction>,
    project_ref: Option<String>,
    loading: bool,
    load_error: Option<String>,
    search: Entity<InputState>,
    table: Entity<TableState>,
}

impl EdgeFunctionsView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_input("Search function names", window, cx);
        let table = cx.new(|_| TableState::default());
        cx.observe(&table, |_, _, cx| cx.notify()).detach();
        on_refresh("edge-functions", cx, Self::load);
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let mut this = Self { info, functions: vec![], project_ref: None, loading: false, load_error: None, search, table };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let info = self.info.clone();
        ui::run(
            cx,
            async move {
                let a = access_for(info).await?;
                let list = list_functions(&a).await;
                Ok((a.project_ref, list))
            },
            |this, r, cx| {
                this.loading = false;
                match r {
                    Ok((pref, list)) => {
                        this.project_ref = Some(pref);
                        match list {
                            Ok(l) => {
                                this.functions = l;
                                this.load_error = None;
                            }
                            Err(e) => {
                                let m = ui::err_text(&e);
                                Toast::error(m.clone()).show(cx);
                                this.functions.clear();
                                this.load_error = Some(m);
                            }
                        }
                    }
                    Err(e) => {
                        this.functions.clear();
                        this.project_ref = None;
                        this.load_error = Some(ui::err_text(&e));
                    }
                }
            },
        );
    }
}

impl Render for EdgeFunctionsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let visible: Vec<EdgeFunction> = self.functions.iter().filter(|f| q.is_empty() || f.slug.to_lowercase().contains(&q) || f.name.to_lowercase().contains(&q)).cloned().collect();
        let n = visible.len();
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .px_6()
            .py_4()
            .child(div().w_full().max_w(px(384.)).child(ui::search_box(&self.search, 28., cx)))
            .child(Button::new("ef-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))))
            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("Viewing {n} function{} in total", if n == 1 { "" } else { "s" })));
        let body: AnyElement = if self.loading && self.functions.is_empty() {
            div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading functions…").into_any_element()
        } else if let (Some(err), true) = (self.load_error.clone(), self.functions.is_empty()) {
            let w = cx.entity().downgrade();
            load_error_box("ef-retry", "Failed to load functions", err, move |_, cx| { w.update(cx, |v, cx| v.load(cx)).ok(); }, true, cx)
        } else if visible.is_empty() {
            let searching = !q.is_empty();
            ui::empty_state(IconName::SquareFunction, if searching { "No matching functions" } else { "No functions yet" }, Some(if searching { "Try a different search term." } else { "Deploy an Edge Function with the Supabase CLI to see it here." }.into()), None, cx)
        } else {
            let pref = self.project_ref.clone();
            let rows = visible.iter().map(|f| {
                let url = pref.as_deref().map(|p| function_url(p, &f.slug)).unwrap_or_default();
                let (slug, u) = (f.slug.clone(), url.clone());
                Row::new(f.slug.clone())
                    .sort("name", f.slug.clone())
                    .sort("updated", f.updated_at.clone().unwrap_or_default())
                    .cell(div().truncate().font_weight(FontWeight::MEDIUM).child(if f.name.is_empty() { f.slug.clone() } else { f.name.clone() }))
                    .cell(
                        div()
                            .flex()
                            .min_w_0()
                            .w_full()
                            .items_center()
                            .gap(px(6.))
                            .child(div().flex_1().min_w_0().truncate().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(url))
                            .child(div().on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(Button::new(SharedString::from(format!("ef-copy-{}", f.slug))).ghost().size(ButtonSize::IconSm).icon(IconName::Copy).on_click(move |_, _, cx| ui::copy(u.clone(), "Function URL copied.", cx)))),
                    )
                    .cell(div().truncate().text_color(t.muted_foreground).child(time_ago(f.updated_at.as_deref())))
                    .on_click(move |_, cx| open_function_tab(&slug, cx))
            });
            DataTable::new("edge-functions", &self.table)
                .columns([Column::new("name", "Name").fr(1.).sortable(), Column::new("url", "URL").fr(1.6), Column::new("updated", "Updated").fr(0.7).right().sortable()])
                .rows(rows)
                .into_any_element()
        };
        div().size_full().flex().flex_col().overflow_hidden().bg(t.studio_bg).text_color(t.foreground).child(toolbar).child(div().id("ef-body").flex_1().min_h_0().overflow_y_scroll().px_6().pb_6().child(body))
    }
}

// ---- edge-function-events ---------------------------------------------------------------

/// "08 Sep 26 18:46:05".
pub fn format_row_time(v: Option<&str>) -> String {
    v.and_then(ui::parse_ts).map(|d| d.format("%d %b %y %H:%M:%S").to_string()).unwrap_or_else(|| "—".into())
}

fn to_markdown(rows: &[FunctionEvent]) -> String {
    let cell = |v: &str| v.replace('|', "\\|").replace('\n', " ");
    let mut out = vec!["| timestamp | method | status | request | message |".to_string(), "| --- | --- | --- | --- | --- |".to_string()];
    for e in rows {
        out.push(format!("| {} | {} | {} | {} | {} |", cell(&format_row_time(e.timestamp.as_deref())), cell(e.method.as_deref().unwrap_or("")), e.status.map(|s| s.to_string()).unwrap_or_default(), cell(e.request_id.as_deref().unwrap_or("")), cell(&e.message)).trim().to_string());
    }
    out.join("\n")
}

fn to_csv(rows: &[FunctionEvent]) -> String {
    let cell = |v: &str| {
        let s = v.replace('"', "\"\"");
        if s.contains(['"', ',', '\n']) { format!("\"{s}\"") } else { s }
    };
    let mut out = vec!["timestamp,method,status,request_id,message".to_string()];
    for e in rows {
        out.push([format_row_time(e.timestamp.as_deref()), e.method.clone().unwrap_or_default(), e.status.map(|s| s.to_string()).unwrap_or_default(), e.request_id.clone().unwrap_or_default(), e.message.clone()].iter().map(|v| cell(v)).collect::<Vec<_>>().join(","));
    }
    out.join("\n")
}

pub struct EventsExplorer {
    access: Option<Access>,
    function_name: String,
    invocations: bool,
    events: Vec<FunctionEvent>,
    loading: bool,
    loading_older: bool,
    load_error: Option<String>,
    range_hours: f64,
    window_end: Option<chrono::DateTime<chrono::Utc>>,
    search: Entity<InputState>,
    status_filter: String,
    selected: std::collections::BTreeSet<usize>,
    expanded: Option<usize>,
    focus: FocusHandle,
}

impl EventsExplorer {
    fn new(access: Option<Access>, function_name: String, invocations: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_input("Search events", window, cx);
        let mut this = Self { access, function_name, invocations, events: vec![], loading: false, loading_older: false, load_error: None, range_hours: 1., window_end: None, search, status_filter: "all".into(), selected: Default::default(), expanded: None, focus: cx.focus_handle() };
        this.load(false, None, cx);
        this
    }

    fn source(&self) -> &'static str {
        if self.invocations { "function_edge_logs" } else { "function_logs" }
    }

    fn load(&mut self, append: bool, custom_end: Option<chrono::DateTime<chrono::Utc>>, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        let end = custom_end.unwrap_or_else(chrono::Utc::now);
        let start = end - chrono::Duration::milliseconds((self.range_hours * 3_600_000.) as i64);
        if append {
            self.loading_older = true;
        } else {
            self.loading = true;
            self.load_error = None;
            self.selected.clear();
            self.expanded = None;
        }
        cx.notify();
        let (slug, source) = (self.function_name.clone(), self.source());
        ui::run(cx, async move { fetch_events(&a, &slug, source, start, end).await }, move |this, r, cx| {
            match r {
                Err(e) if !append => {
                    this.events.clear();
                    this.load_error = Some(ui::err_text(&e));
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
                Ok(rows) if append => {
                    this.events.extend(rows);
                    this.window_end = Some(end);
                }
                Ok(rows) => {
                    this.events = rows;
                    this.window_end = None;
                }
            }
            this.loading = false;
            this.loading_older = false;
        });
    }

    fn visible(&self, cx: &App) -> Vec<FunctionEvent> {
        let q = self.search.read(cx).value().trim().to_lowercase();
        self.events
            .iter()
            .filter(|e| {
                if self.invocations && self.status_filter != "all" {
                    if let Some(s) = e.status {
                        let want = match self.status_filter.as_str() { "2xx" => 2, "4xx" => 4, _ => 5 };
                        if s / 100 != want {
                            return false;
                        }
                    }
                }
                q.is_empty() || [e.message.as_str(), e.method.as_deref().unwrap_or(""), e.request_id.as_deref().unwrap_or(""), &e.status.map(|s| s.to_string()).unwrap_or_default(), e.timestamp.as_deref().unwrap_or("")].join(" ").to_lowercase().contains(&q)
            })
            .cloned()
            .collect()
    }

    fn export_rows(&self, cx: &App) -> Vec<FunctionEvent> {
        let v = self.visible(cx);
        if self.selected.is_empty() { v } else { v.into_iter().enumerate().filter(|(i, _)| self.selected.contains(i)).map(|(_, e)| e).collect() }
    }

    fn export(&mut self, kind: &str, cx: &mut Context<Self>) {
        let rows = self.export_rows(cx);
        let nothing = |cx: &mut App| {
            Toast::message("Nothing to copy.").show(cx);
        };
        match kind {
            "md" => ui::copy(to_markdown(&rows), "Markdown copied.", cx),
            "json" if rows.is_empty() => nothing(cx),
            "json" => ui::copy(serde_json::to_string_pretty(&rows).unwrap_or_default(), "JSON copied.", cx),
            "csv" => ui::copy(to_csv(&rows), "CSV copied.", cx),
            _ => {
                if rows.is_empty() {
                    Toast::message("Nothing to download.").show(cx);
                    return;
                }
                let name = format!("{}-{}-events.csv", self.function_name, if self.invocations { "invocations" } else { "logs" });
                let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
                let prompt = cx.prompt_for_new_path(&dir, Some(&name));
                let csv = to_csv(&rows);
                let n = rows.len();
                cx.spawn(async move |_, cx| {
                    if let Ok(Ok(Some(p))) = prompt.await {
                        let r = std::fs::write(p, csv);
                        cx.update(|cx| match r {
                            Ok(()) => {
                                Toast::success(format!("Downloaded {n} event{}.", if n == 1 { "" } else { "s" })).show(cx);
                            }
                            Err(e) => {
                                Toast::error(e.to_string()).show(cx);
                            }
                        });
                    }
                })
                .detach();
            }
        }
    }

    fn open_query(&mut self, cx: &mut Context<Self>) {
        let sql = build_events_sql(&self.function_name, self.source(), self.invocations);
        rexa_ui::open_dialog(cx, move |_, cx| {
            let t = cx.tokens().clone();
            let s2 = sql.clone();
            Dialog::new()
                .max_w(576.)
                .title("Explore via query")
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("This is the ClickHouse SQL behind the event list. Run it against the project logs endpoint."))
                .child(div().id("ev-sql").max_h(px(256.)).overflow_y_scroll().tw_rounded_lg().border_1().border_color(t.border).bg(with_alpha(t.muted, 0.3)).p_3().font_family(MONO).text_size(px(11.)).child(sql.clone()))
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("ev-close").ghost().size(ButtonSize::Sm).label("Close").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("ev-copy").size(ButtonSize::Sm).icon(IconName::Copy).label("Copy query").on_click(move |_, _, cx| ui::copy(s2.clone(), "Query copied.", cx))),
                )
        });
    }
}

impl Render for EventsExplorer {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let visible = self.visible(cx);
        let w = cx.entity().downgrade();
        let range = Select::new("ev-range")
            .small()
            .options([SelectOption::new("1", "Last hour").icon(IconName::Clock), SelectOption::new("6", "Last 6 hours").icon(IconName::Clock), SelectOption::new("24", "Last 24 hours").icon(IconName::Clock)])
            .value(Some(format!("{}", self.range_hours as i64)))
            .on_change({
                let w = w.clone();
                move |v, _, cx| {
                    w.update(cx, |s, cx| {
                        s.range_hours = v.parse().unwrap_or(1.);
                        s.events.clear();
                        s.load(false, None, cx);
                    })
                    .ok();
                }
            });
        let status = Select::new("ev-status")
            .small()
            .options([SelectOption::new("all", "Status: all"), SelectOption::new("2xx", "2xx success"), SelectOption::new("4xx", "4xx client errors"), SelectOption::new("5xx", "5xx server errors")])
            .value(Some(self.status_filter.clone()))
            .on_change({
                let w = w.clone();
                move |v, _, cx| {
                    w.update(cx, |s, cx| {
                        s.status_filter = v.to_string();
                        cx.notify();
                    })
                    .ok();
                }
            });
        let export = DropdownMenu::new("ev-export").align(Align::End).trigger(Button::new("ev-export-btn").outline().size(ButtonSize::IconSm).icon(IconName::Download)).menu({
            let w = w.clone();
            move |m, _, _| {
                let item = |label: &'static str, icon: IconName, kbd: &'static str, kind: &'static str| {
                    let w = w.clone();
                    MenuItem::new(label).icon(icon).shortcut(kbd).on_select(move |_, cx| {
                        w.update(cx, |s, cx| s.export(kind, cx)).ok();
                    })
                };
                m.w(224.).item(item("Copy as Markdown", IconName::Copy, "⇧⌘M", "md")).item(item("Copy as JSON", IconName::Copy, "⇧⌘J", "json")).item(item("Copy as CSV", IconName::Copy, "⇧⌘C", "csv")).item(item("Download CSV", IconName::Download, "⇧⌘D", "dl"))
            }
        });
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .px_6()
            .pt_4()
            .child(div().flex_1().max_w(px(384.)).child(ui::search_box(&self.search, 28., cx)))
            .child(Button::new("ev-refresh").outline().size(ButtonSize::IconSm).icon(IconName::RefreshCw).on_click(cx.listener(|this, _, _, cx| this.load(false, None, cx))))
            .child(range)
            .when(self.invocations, |d| d.child(status))
            .child(export)
            .child(div().ml_auto().child(Button::new("ev-query").outline().size(ButtonSize::Sm).label("Explore via query").on_click(cx.listener(|this, _, _, cx| this.open_query(cx)))));
        let filtering = !self.search.read(cx).value().trim().is_empty() || self.status_filter != "all";
        let list: AnyElement = if self.loading && self.events.is_empty() {
            div().py_16().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading events…").into_any_element()
        } else if let Some(err) = self.load_error.clone() {
            div()
                .p_6()
                .flex()
                .flex_col()
                .items_center()
                .text_center()
                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Failed to load events"))
                .child(div().mt_1().max_w(px(448.)).tw_text_xs().text_color(t.muted_foreground).child(err))
                .child(div().mt_3().child(Button::new("ev-retry").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Retry").on_click(cx.listener(|this, _, _, cx| this.load(false, None, cx)))))
                .into_any_element()
        } else if visible.is_empty() {
            div()
                .p_6()
                .child(
                    div()
                        .tw_rounded_xl()
                        .border_1()
                        .border_dashed()
                        .border_color(t.border)
                        .p_10()
                        .flex()
                        .flex_col()
                        .items_center()
                        .text_center()
                        .child(Icon::new(if self.invocations { IconName::Activity } else { IconName::Terminal }).size(px(32.)).text_color(with_alpha(t.muted_foreground, 0.5)))
                        .child(div().mt_3().tw_text_sm().font_weight(FontWeight::MEDIUM).child(if filtering { "No matching events" } else { "No events yet" }))
                        .child(div().mt_1().max_w(px(384.)).tw_text_sm().text_color(t.muted_foreground).child(if filtering { "Try a different search term or filter." } else if self.invocations { "Invoke this function to see its requests here." } else { "Console output from this function will appear here." })),
                )
                .into_any_element()
        } else {
            let rows = visible.iter().enumerate().map(|(i, e)| {
                let open = self.expanded == Some(i);
                let sel = self.selected.contains(&i);
                let line = div()
                    .id(("ev-row", i))
                    .flex()
                    .w_full()
                    .cursor_pointer()
                    .items_center()
                    .gap_3()
                    .px_3()
                    .py(px(10.))
                    .font_family(MONO)
                    .tw_text_xs()
                    .hover(|d| d.bg(with_alpha(t.muted, 0.3)))
                    .when(open, |d| d.bg(with_alpha(t.muted, 0.3)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.expanded = if this.expanded == Some(i) { None } else { Some(i) };
                        cx.notify();
                    }))
                    .child(div().on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(Checkbox::new(("ev-sel", i)).checked(sel).on_change({
                        let w = w.clone();
                        move |_, _, cx| {
                            w.update(cx, |s, cx| {
                                if !s.selected.remove(&i) {
                                    s.selected.insert(i);
                                }
                                cx.notify();
                            })
                            .ok();
                        }
                    })))
                    .child(div().flex_shrink_0().text_color(t.muted_foreground).child(format_row_time(e.timestamp.as_deref())));
                let line = if self.invocations {
                    let badge = match e.status {
                        Some(s) => div().flex_shrink_0().child(Badge::new(s.to_string()).variant(if (200..300).contains(&s) { BadgeVariant::Success } else if s >= 500 { BadgeVariant::Destructive } else if (400..500).contains(&s) { BadgeVariant::Warning } else { BadgeVariant::Secondary })).into_any_element(),
                        None => div().w(px(40.)).flex_shrink_0().text_color(with_alpha(t.muted_foreground, 0.5)).child("—").into_any_element(),
                    };
                    line.child(badge)
                        .child(div().w(px(70.)).flex_shrink_0().truncate().text_color(with_alpha(t.foreground, 0.9)).child(e.method.clone().unwrap_or_else(|| "—".into())))
                        .child(div().w(px(128.)).flex_shrink_0().truncate().text_color(with_alpha(t.foreground, 0.9)).child(self.function_name.clone()))
                        .child(div().flex_1().min_w_0().truncate().text_color(t.muted_foreground).child(e.request_id.clone().unwrap_or_else(|| e.message.clone())))
                } else {
                    line.child(div().flex_1().min_w_0().truncate().text_color(with_alpha(t.foreground, 0.9)).child(if e.message.is_empty() { "—".to_string() } else { e.message.clone() }))
                };
                div()
                    .when(i > 0, |d| d.border_t_1().border_color(t.border))
                    .child(line)
                    .when(open, |d| d.child(div().border_t_1().border_color(t.border).bg(with_alpha(t.muted, 0.2)).px_3().py_2().pl_12().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(if e.message.is_empty() { "‹empty›".to_string() } else { e.message.clone() })))
            });
            div().flex().flex_col().children(rows).into_any_element()
        };
        let n = visible.len();
        let window_end = self.window_end;
        let range_ms = (self.range_hours * 3_600_000.) as i64;
        let footer = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_3()
            .border_t_1()
            .border_color(t.border)
            .px_6()
            .py_4()
            .child(Button::new("ev-older").outline().size(ButtonSize::Sm).icon(IconName::RotateCcwClock).label(if self.loading_older { "Loading…" } else { "Load older" }).disabled(self.loading_older || self.loading).on_click(cx.listener(move |this, _, _, cx| {
                let start = window_end.unwrap_or_else(chrono::Utc::now) - chrono::Duration::milliseconds(range_ms);
                this.load(true, Some(start), cx);
            })))
            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("Showing {n} result{}{}", if n == 1 { "" } else { "s" }, if self.selected.is_empty() { String::new() } else { format!(" ({} selected)", self.selected.len()) })));
        div()
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| {
                let k = &ev.keystroke;
                if k.modifiers.platform && k.modifiers.shift {
                    let kind = match k.key.as_str() { "m" => "md", "j" => "json", "c" => "csv", "d" => "dl", _ => return };
                    this.export(kind, cx);
                    cx.stop_propagation();
                }
            }))
            .on_mouse_down(gpui::MouseButton::Left, cx.listener(|this, _, w, cx| this.focus.focus(w, cx)))
            .flex()
            .flex_1()
            .min_h_0()
            .flex_col()
            .overflow_hidden()
            .child(toolbar)
            .child(div().id("ev-list").mt_4().flex_1().min_h_0().overflow_y_scroll().border_t_1().border_color(t.border).child(list))
            .child(footer)
    }
}

// ---- edge-function-view ------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum FnTab {
    Overview,
    Invocations,
    Logs,
    Code,
    Settings,
}

pub struct EdgeFunctionView {
    info: Option<ConnInfo>,
    function_name: String,
    access: Option<Access>,
    func: Option<EdgeFunction>,
    loading: bool,
    load_error: Option<String>,
    deleting: bool,
    tab: FnTab,
    // overview
    ov_hours: f64,
    ov_events: Vec<FunctionEvent>,
    ov_loading: bool,
    err_events: Vec<FunctionEvent>,
    ov_range: (i64, i64),
    // invocations / logs
    invocations: Option<Entity<EventsExplorer>>,
    logs: Option<Entity<EventsExplorer>>,
    // code
    code_files: Vec<CodeFile>,
    extra_files: Vec<CodeFile>,
    edits: std::collections::HashMap<String, String>,
    code_loading: bool,
    code_loaded: bool,
    code_error: Option<String>,
    active_file: usize,
    editor: Entity<EditorState>,
    editor_file: Option<String>,
    pending_editor: Option<String>,
    deploying: bool,
    add_dialog: Option<OverlayId>,
    // settings
    display_name: Entity<InputState>,
    pending_name: Option<String>,
    verify_jwt: bool,
    saving_settings: bool,
    spec: TabSpec,
}

impl EdgeFunctionView {
    fn new(session: Arc<Session>, function_name: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let editor = cx.new(|cx| EditorState::new(window, cx).language("typescript").line_number(true).folding(false).soft_wrap(false).searchable(true));
        cx.subscribe(&editor, |this: &mut Self, s, e: &InputEvent, cx| {
            if matches!(e, InputEvent::Change) {
                if let Some(name) = this.editor_file.clone() {
                    let v = s.read(cx).value().to_string();
                    this.edits.insert(name, v);
                    cx.notify();
                }
            }
        })
        .detach();
        let display_name = cx.new(|cx| InputState::new(window, cx));
        cx.subscribe(&display_name, |this: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::PressEnter { .. }) {
                this.save_name(cx);
            }
        })
        .detach();
        on_refresh("edge-function", cx, Self::load_function);
        let spec = TabSpec::View { view: "edge-function".into(), params: serde_json::json!({ "id": format!("edge-function-{function_name}") }) };
        let mut this = Self {
            info,
            function_name,
            access: None,
            func: None,
            loading: false,
            load_error: None,
            deleting: false,
            tab: FnTab::Overview,
            ov_hours: 1.,
            ov_events: vec![],
            ov_loading: false,
            err_events: vec![],
            ov_range: (0, 0),
            invocations: None,
            logs: None,
            code_files: vec![],
            extra_files: vec![],
            edits: Default::default(),
            code_loading: false,
            code_loaded: false,
            code_error: None,
            active_file: 0,
            editor,
            editor_file: None,
            pending_editor: None,
            deploying: false,
            add_dialog: None,
            display_name,
            pending_name: None,
            verify_jwt: true,
            saving_settings: false,
            spec,
        };
        this.load_function(cx);
        this
    }

    fn load_function(&mut self, cx: &mut Context<Self>) {
        if self.function_name.is_empty() {
            return;
        }
        self.loading = true;
        cx.notify();
        let (info, slug) = (self.info.clone(), self.function_name.clone());
        ui::run(
            cx,
            async move {
                let a = access_for(info).await?;
                let detail = supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/functions/{}", a.project_ref, supabase::enc(&slug)), None).await;
                Ok((a, detail))
            },
            |this, r, cx| {
                this.loading = false;
                match r {
                    Err(e) => {
                        this.func = None;
                        this.access = None;
                        this.load_error = Some(ui::err_text(&e));
                    }
                    Ok((a, detail)) => {
                        let first = this.access.is_none();
                        this.access = Some(a);
                        match detail {
                            Ok(Value::Null) => this.load_error = Some("Function not found.".into()),
                            Ok(v) => {
                                let f = normalize_function(&v);
                                this.pending_name = Some(f.name.clone());
                                this.verify_jwt = f.verify_jwt.unwrap_or(true);
                                this.func = Some(f);
                                this.load_error = None;
                            }
                            Err(e) => {
                                let m = ui::err_text(&e);
                                Toast::error(m.clone()).show(cx);
                                this.func = None;
                                this.load_error = Some(m);
                            }
                        }
                        if first && this.tab == FnTab::Overview {
                            this.load_overview(cx);
                        }
                    }
                }
            },
        );
    }

    fn load_overview(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        self.ov_loading = true;
        let end = chrono::Utc::now();
        let start = end - chrono::Duration::milliseconds((self.ov_hours * 3_600_000.) as i64);
        self.ov_range = (start.timestamp_millis(), end.timestamp_millis());
        let day = end - chrono::Duration::hours(24);
        let slug = self.function_name.clone();
        cx.notify();
        ui::run(
            cx,
            async move {
                let ranged = fetch_events(&a, &slug, "function_edge_logs", start, end).await;
                let day = fetch_events(&a, &slug, "function_edge_logs", day, end).await;
                Ok((ranged, day))
            },
            |this, r, _| {
                if let Ok((ranged, day)) = r {
                    if let Ok(e) = ranged {
                        this.ov_events = e;
                    }
                    if let Ok(e) = day {
                        this.err_events = e;
                    }
                }
                this.ov_loading = false;
            },
        );
    }

    fn select_tab(&mut self, tab: FnTab, window: &mut Window, cx: &mut Context<Self>) {
        self.tab = tab;
        match tab {
            FnTab::Overview => self.load_overview(cx),
            FnTab::Code if !self.code_loaded && !self.code_loading => self.load_code(cx),
            FnTab::Invocations if self.invocations.is_none() => {
                let (a, n) = (self.access.clone(), self.function_name.clone());
                self.invocations = Some(cx.new(|cx| EventsExplorer::new(a, n, true, window, cx)));
            }
            FnTab::Logs if self.logs.is_none() => {
                let (a, n) = (self.access.clone(), self.function_name.clone());
                self.logs = Some(cx.new(|cx| EventsExplorer::new(a, n, false, window, cx)));
            }
            _ => {}
        }
        cx.notify();
    }

    fn all_files(&self) -> Vec<CodeFile> {
        self.code_files.iter().chain(self.extra_files.iter()).cloned().collect()
    }

    fn code_dirty(&self) -> bool {
        !self.extra_files.is_empty() || self.edits.iter().any(|(n, c)| self.code_files.iter().find(|f| f.name == *n).map(|f| &f.content) != Some(c))
    }

    fn load_code(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        self.code_loading = true;
        self.code_error = None;
        cx.notify();
        let slug = self.function_name.clone();
        ui::run(cx, async move { fetch_body(&a, &slug).await }, |this, r, _| {
            match r {
                Ok(f) => {
                    this.code_files = f;
                    this.code_error = None;
                }
                Err(e) => {
                    this.code_files.clear();
                    this.code_error = Some(ui::err_text(&e));
                }
            }
            this.code_loaded = true;
            this.code_loading = false;
            this.active_file = 0;
            this.editor_file = None;
            this.sync_editor();
        });
    }

    /// Point the editor at the active file (applied in render, which has a Window).
    fn sync_editor(&mut self) {
        let files = self.all_files();
        if files.is_empty() {
            return;
        }
        let f = &files[self.active_file.min(files.len() - 1)];
        if self.editor_file.as_deref() != Some(&f.name) {
            self.editor_file = Some(f.name.clone());
            self.pending_editor = Some(self.edits.get(&f.name).cloned().unwrap_or_else(|| f.content.clone()));
        }
    }

    fn deploy(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        let files = self.all_files();
        if files.is_empty() {
            return;
        }
        let entry = files.iter().find(|f| f.name == "index.ts" || f.name.ends_with("/index.ts")).unwrap_or(&files[0]).name.clone();
        let payload: Vec<CodeFile> = files.iter().map(|f| CodeFile { name: f.name.clone(), content: self.edits.get(&f.name).cloned().unwrap_or_else(|| f.content.clone()) }).collect();
        let name = self.func.as_ref().map(|f| f.name.clone()).filter(|n| !n.is_empty());
        let verify = self.func.as_ref().and_then(|f| f.verify_jwt);
        let slug = self.function_name.clone();
        self.deploying = true;
        cx.notify();
        ui::run(cx, async move { deploy(&a, &slug, &entry, name, verify, payload).await }, |this, r, cx| {
            this.deploying = false;
            match r {
                Ok(()) => {
                    Toast::success("Function deployed.").show(cx);
                    this.edits.clear();
                    this.extra_files.clear();
                    this.load_function(cx);
                    this.load_code(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            }
        });
    }

    fn open_add_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder("utils.ts"));
        let id = ui::open_prompt(cx.entity().downgrade(), input, Prompt::new("Add file", "Add", "Add"), |_: &Self| false, |this, value, cx| this.add_file(value, cx), window, cx);
        self.add_dialog = Some(id);
    }

    fn add_file(&mut self, value: String, cx: &mut Context<Self>) {
        let name = value.trim().to_string();
        if name.is_empty() {
            Toast::error("File name is required.").show(cx);
            return;
        }
        if name.contains('/') {
            Toast::error("Use a plain file name without slashes.").show(cx);
            return;
        }
        if self.all_files().iter().any(|f| f.name == name) {
            Toast::error("A file with that name already exists.").show(cx);
            return;
        }
        self.active_file = self.all_files().len();
        self.extra_files.push(CodeFile { name: name.clone(), content: format!("// {name}\n") });
        self.sync_editor();
        if let Some(id) = self.add_dialog.take() {
            rexa_ui::close_overlay(id, cx);
        }
        cx.notify();
    }

    fn update_function(&mut self, patch: Value, cx: &mut Context<Self>, done: impl FnOnce(&mut Self, anyhow::Result<()>, &mut Context<Self>) + 'static) {
        let Some(a) = self.access.clone() else { return };
        let slug = self.function_name.clone();
        ui::run(cx, async move { supabase::request(&a.token, reqwest::Method::PATCH, &format!("/projects/{}/functions/{}", a.project_ref, supabase::enc(&slug)), Some(patch)).await }, move |this, r, cx| {
            let ok = match r {
                Ok(v) if !v.is_null() => {
                    this.func = Some(normalize_function(&v));
                    Ok(())
                }
                Ok(_) => {
                    this.load_function(cx);
                    Ok(())
                }
                Err(e) => Err(e),
            };
            done(this, ok, cx);
        });
    }

    fn save_name(&mut self, cx: &mut Context<Self>) {
        let name = self.display_name.read(cx).value().trim().to_string();
        if name.is_empty() {
            Toast::error("Display name is required.").show(cx);
            return;
        }
        self.saving_settings = true;
        cx.notify();
        let spec = self.spec.clone();
        self.update_function(serde_json::json!({ "name": name }), cx, move |this, r, cx| {
            this.saving_settings = false;
            match r {
                Ok(()) => {
                    rexa_core::emit_studio(StudioEvent::RenameTab { tab: spec, title: name }, cx);
                    Toast::success("Function renamed.").show(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            }
        });
    }

    fn toggle_verify_jwt(&mut self, next: bool, cx: &mut Context<Self>) {
        self.verify_jwt = next;
        cx.notify();
        self.update_function(serde_json::json!({ "verify_jwt": next }), cx, move |this, r, cx| match r {
            Ok(()) => {
                Toast::success(if next { "JWT verification required." } else { "JWT verification disabled." }).show(cx);
            }
            Err(e) => {
                this.verify_jwt = !next;
                Toast::error(ui::err_text(&e)).show(cx);
            }
        });
    }

    fn delete(&mut self, cx: &mut Context<Self>) {
        if self.access.is_none() {
            return;
        }
        let name = self.function_name.clone();
        let opts = ConfirmOptions::destructive("Delete function").description(format!("Delete \"{name}\"? This removes the deployment and cannot be undone.")).confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            let Some(a) = this.access.clone() else { return };
            this.deleting = true;
            cx.notify();
            let spec = this.spec.clone();
            ui::run(cx, async move { supabase::request(&a.token, reqwest::Method::DELETE, &format!("/projects/{}/functions/{}", a.project_ref, supabase::enc(&name)), None).await.map(|_| name) }, move |this, r, cx| {
                this.deleting = false;
                match r {
                    Ok(name) => {
                        Toast::success(format!("Function \"{name}\" deleted.")).show(cx);
                        rexa_core::open_tab(TabSpec::View { view: "edge-functions".into(), params: Value::Object(Default::default()) }, cx);
                        rexa_core::emit_studio(StudioEvent::CloseTab(spec), cx);
                    }
                    Err(e) => {
                        Toast::error(ui::err_text(&e)).show(cx);
                    }
                }
            });
        });
    }

    fn render_overview(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let total = self.ov_events.len();
        let count = |lo: i64, hi: i64| self.ov_events.iter().filter(|e| e.status.is_some_and(|s| s >= lo && s < hi)).count();
        let (c5, c4) = (count(500, 600), count(400, 500));
        let pct = |n: usize| if total > 0 { format!("{}%", ((n as f64 / total as f64) * 100.).round() as i64) } else { "0%".into() };
        let err_count = self.err_events.iter().filter(|e| e.status.is_some_and(|s| (400..600).contains(&s))).count();
        let stat = |dot: gpui::Hsla, label: &'static str, value: String| {
            div()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .tw_text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(div().size(px(6.)).rounded_full().bg(dot))
                        .child(rexa_ui::tracked_text::tracked(label.to_uppercase(), 0.05))
                        .child(Icon::new(IconName::CircleQuestionMark).size(px(14.))),
                )
                .child(div().mt(px(6.)).text_size(px(30.)).line_height(px(36.)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(value))
        };
        let ranges: [(f64, &str); 4] = [(0.25, "15 min"), (1., "1 hour"), (3., "3 hours"), (24., "1 day")];
        let seg = div().flex().overflow_hidden().tw_rounded_lg().border_1().border_color(t.border).children(ranges.iter().enumerate().map(|(i, (h, label))| {
            let active = (self.ov_hours - h).abs() < f64::EPSILON;
            let h = *h;
            div()
                .id(("ov-range", i))
                .h_8()
                .flex()
                .items_center()
                .px_3()
                .tw_text_xs()
                .cursor_pointer()
                .when(i < 3, |d| d.border_r_1().border_color(t.border))
                .when(active, |d| d.bg(t.foreground).font_weight(FontWeight::MEDIUM).text_color(t.background))
                .when(!active, |d| d.text_color(t.muted_foreground).hover(|d| d.bg(with_alpha(t.muted, 0.5)).text_color(t.foreground)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.ov_hours = h;
                    this.load_overview(cx);
                }))
                .child(*label)
        }));
        let dash = self.access.as_ref().map(|a| format!("https://supabase.com/dashboard/project/{}/functions/{}", a.project_ref, self.function_name));
        let chart: AnyElement = if self.ov_loading && self.ov_events.is_empty() {
            div().size_full().flex().items_center().justify_center().tw_text_sm().text_color(t.muted_foreground).child("Loading invocations…").into_any_element()
        } else if total == 0 {
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .tw_rounded_xl()
                .border_1()
                .border_dashed()
                .border_color(t.border)
                .text_center()
                .child(Icon::new(IconName::ChartColumn).size(px(24.)).text_color(with_alpha(t.muted_foreground, 0.5)))
                .child(div().mt_3().tw_text_sm().font_weight(FontWeight::MEDIUM).child("No data to show"))
                .child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child("It may take up to 24 hours for data to refresh"))
                .into_any_element()
        } else {
            let (start, end) = self.ov_range;
            let span = (end - start).max(1) as f64;
            let mut bins = [0usize; 48];
            for e in &self.ov_events {
                if let Some(ts) = e.timestamp.as_deref().and_then(ui::parse_ts) {
                    let ms = ts.timestamp_millis();
                    if ms >= start && ms <= end {
                        let idx = (((ms - start) as f64 / span) * 48.).floor().min(47.) as usize;
                        bins[idx] += 1;
                    }
                }
            }
            let max = *bins.iter().max().unwrap_or(&1).max(&1) as f32;
            let axis = |ms: i64| chrono::DateTime::from_timestamp_millis(ms).map(|d| d.with_timezone(&chrono::Local).format("%b %-d, %-I:%M%P").to_string()).unwrap_or_default();
            div()
                .size_full()
                .flex()
                .flex_col()
                .child(div().flex_1().min_h_0().flex().items_end().gap(px(3.)).border_b_1().border_color(t.border).children(bins.iter().map(|n| div().flex_1().h(gpui::relative(*n as f32 / max)).bg(gpui::rgb(0x3ECF8E)))))
                .child(div().flex().flex_shrink_0().items_center().justify_between().pt(px(6.)).font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(axis(start)).child(axis(end)))
                .into_any_element()
        };
        let n = self.err_events.len();
        div()
            .flex()
            .flex_col()
            .p_6()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_start()
                    .justify_between()
                    .gap_4()
                    .child(div().flex().flex_wrap().gap_10().child(stat(t.muted_foreground, "Total invocations", total.to_string())).child(stat(tw("red-400"), "5xx rate", pct(c5))).child(stat(tw("amber-400"), "4xx rate", pct(c4))))
                    .child(div().flex().items_center().gap_2().child(seg).children(dash.map(|url| Button::new("ov-dash").outline().size(ButtonSize::IconSm).icon(IconName::ExternalLink).on_click(move |_, _, cx| cx.open_url(&url))))),
            )
            .child(div().mt_6().h(px(220.)).child(chart))
            .child(div().my_6().border_t_1().border_color(t.border))
            .child(div().flex().items_center().justify_between().gap_4().child(div().tw_text_xl().font_weight(FontWeight::MEDIUM).child("Errors in the last 24h")).child(Button::new("ov-logs").outline().size(ButtonSize::Sm).icon(IconName::ExternalLink).label("View logs").on_click(cx.listener(|this, _, w, cx| this.select_tab(FnTab::Logs, w, cx)))))
            .child(
                div()
                    .mt_4()
                    .flex()
                    .items_center()
                    .gap_3()
                    .tw_rounded_xl()
                    .border_1()
                    .border_dashed()
                    .border_color(t.border)
                    .p_5()
                    .tw_text_sm()
                    .child(Icon::new(IconName::Eye).size(px(16.)).text_color(t.muted_foreground))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap_x(px(4.))
                            .text_color(t.muted_foreground)
                            .child("There have been")
                            .child(div().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(format!("{n} invocation{}", if n == 1 { "" } else { "s" })))
                            .child("since last deploy and")
                            .child(if err_count == 0 { div().child("no errors.") } else { div().font_weight(FontWeight::MEDIUM).text_color(t.destructive).child(format!("{err_count} error{}.", if err_count == 1 { "" } else { "s" })) }),
                    ),
            )
            .into_any_element()
    }

    fn render_code(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let files = self.all_files();
        let list = files.iter().enumerate().map(|(i, f)| {
            let original = self.code_files.iter().find(|o| o.name == f.name).map(|o| o.content.clone());
            let dirty = match original {
                None => true,
                Some(o) => self.edits.get(&f.name).is_some_and(|e| *e != o),
            };
            div()
                .id(("code-file", i))
                .flex()
                .h_9()
                .w_full()
                .items_center()
                .gap_2()
                .px_3()
                .tw_text_xs()
                .cursor_pointer()
                .hover(|d| d.bg(with_alpha(t.muted, 0.6)))
                .when(i == self.active_file, |d| d.bg(t.muted))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.active_file = i;
                    this.sync_editor();
                    cx.notify();
                }))
                .child(Icon::new(IconName::File).size(px(14.)).text_color(t.muted_foreground))
                .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).child(f.name.rsplit('/').next().unwrap_or(&f.name).to_string()))
                .when(dirty, |d| d.child(div().size(px(6.)).flex_shrink_0().rounded_full().bg(tw("amber-400"))))
        });
        let main: AnyElement = if self.code_loading && files.is_empty() {
            div().size_full().flex().items_center().justify_center().tw_text_sm().text_color(t.muted_foreground).child("Loading source…").into_any_element()
        } else if let Some(err) = self.code_error.clone() {
            div().size_full().flex().items_center().justify_center().p_6().child(div().tw_rounded_lg().border_1().border_color(with_alpha(t.destructive, 0.3)).bg(with_alpha(t.destructive, 0.1)).p_4().text_center().tw_text_xs().text_color(t.muted_foreground).child(err)).into_any_element()
        } else if files.is_empty() {
            div().size_full().flex().items_center().justify_center().tw_text_sm().text_color(t.muted_foreground).child("No source available.").into_any_element()
        } else {
            div().size_full().pt_3().font_family(MONO).text_size(px(13.)).child(Editor::new(&self.editor).appearance(false).bordered(false).h_full()).into_any_element()
        };
        let dirty = self.code_dirty();
        div()
            .flex()
            .flex_1()
            .min_h_0()
            .flex_col()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div()
                            .w(px(208.))
                            .flex_shrink_0()
                            .flex()
                            .flex_col()
                            .border_r_1()
                            .border_color(t.border)
                            .child(div().flex().items_center().justify_between().px_3().py_2().child(ui::th("Files", cx)).child(Button::new("code-add").ghost().size(ButtonSize::Xs).icon(IconName::Plus).label("Add File").on_click(cx.listener(|this, _, w, cx| this.open_add_file(w, cx)))))
                            .child(div().id("code-files").flex_1().min_h_0().overflow_y_scroll().pb_2().children(list)),
                    )
                    .child(div().flex_1().min_w_0().child(main)),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .justify_end()
                    .gap_2()
                    .border_t_1()
                    .border_color(t.border)
                    .px_4()
                    .py_3()
                    .when(dirty, |d| d.child(div().tw_text_xs().text_color(t.muted_foreground).child("Unsaved changes")))
                    .child(Button::new("code-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(self.code_loading).on_click(cx.listener(|this, _, _, cx| {
                        this.edits.clear();
                        this.load_code(cx);
                    })))
                    .child(Button::new("code-deploy").size(ButtonSize::Sm).label(if self.deploying { "Deploying…" } else { "Deploy updates" }).disabled(!dirty || self.deploying || files.is_empty()).on_click(cx.listener(|this, _, _, cx| this.deploy(cx)))),
            )
            .into_any_element()
    }

    fn render_settings(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let row = |label: AnyElement, desc: AnyElement, control: AnyElement, last: bool| {
            div().flex().items_center().gap_8().py_5().when(!last, |d| d.border_b_1().border_color(t.border)).child(div().flex_1().min_w_0().child(label).child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child(desc))).child(div().w(px(320.)).flex_shrink_0().flex().justify_end().child(control))
        };
        let name_desc = ui::inline(vec![div().child("Shown in the dashboard. The URL slug stays").into_any_element(), div().rounded(px(4.)).bg(t.muted).px_1().font_family(MONO).text_size(px(11.)).child(self.function_name.clone()).into_any_element(), div().child(".").into_any_element()]);
        let w = cx.entity().downgrade();
        div()
            .overflow_hidden()
            .tw_rounded_xl()
            .border_1()
            .border_color(t.border)
            .bg(with_alpha(t.card, 0.4))
            .child(div().border_b_1().border_color(t.border).px_5().py_3().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight("Settings"))))
            .child(
                div()
                    .px_5()
                    .child(row(
                        div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Display name").into_any_element(),
                        name_desc,
                        div().flex().w_full().gap_2().child(div().flex_1().child(TextInput::new(&self.display_name).h(36.))).child(Button::new("fn-save-name").size(ButtonSize::Sm).label(if self.saving_settings { "Saving…" } else { "Save" }).disabled(self.saving_settings).on_click(cx.listener(|this, _, _, cx| this.save_name(cx)))).into_any_element(),
                        false,
                    ))
                    .child(row(
                        div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("JWT verification").into_any_element(),
                        div().child(if self.verify_jwt { "Invocations require a valid JWT." } else { "Anyone can invoke this function without a token." }).into_any_element(),
                        Switch::new("fn-jwt").checked(self.verify_jwt).on_change(move |v, _, cx| { w.update(cx, |s, cx| s.toggle_verify_jwt(v, cx)).ok(); }).into_any_element(),
                        false,
                    ))
                    .child(row(
                        div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.destructive).child("Delete function").into_any_element(),
                        div().child("Removes the deployment. This cannot be undone.").into_any_element(),
                        Button::new("fn-delete").outline().size(ButtonSize::Sm).icon(IconName::Trash).label(if self.deleting { "Deleting…" } else { "Delete" }).colors(gpui::transparent_black(), t.muted, t.destructive).disabled(self.deleting).on_click(cx.listener(|this, _, _, cx| this.delete(cx))).into_any_element(),
                        true,
                    )),
            )
            .into_any_element()
    }
}

impl Render for EdgeFunctionView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(v) = self.pending_editor.take() {
            self.editor.update(cx, |s, cx| s.set_value(v, window, cx));
        }
        if let Some(v) = self.pending_name.take() {
            self.display_name.update(cx, |s, cx| s.set_value(v, window, cx));
        }
        let t = cx.tokens().clone();
        let title = self.func.as_ref().map(|f| f.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| self.function_name.clone());
        let url = self.access.as_ref().map(|a| function_url(&a.project_ref, &self.function_name));
        let updated = self.func.as_ref().and_then(|f| f.updated_at.clone());
        let header = div()
            .px_6()
            .pt_5()
            .child(div().truncate().tw_text_2xl().font_weight(FontWeight::MEDIUM).child(rexa_ui::tight(title)))
            .child(
                div()
                    .mt(px(6.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_x_4()
                    .gap_y_1()
                    .tw_text_sm()
                    .text_color(t.muted_foreground)
                    .children(url.map(|u| {
                        let u2 = u.clone();
                        div().flex().min_w_0().items_center().gap(px(6.)).child(div().truncate().font_family(MONO).text_size(px(13.)).child(u)).child(Button::new("fn-copy-url").ghost().size(ButtonSize::IconXs).icon(IconName::Copy).on_click(move |_, _, cx| ui::copy(u2.clone(), "Function URL copied.", cx)))
                    }))
                    .children(updated.map(|u| div().flex().flex_shrink_0().items_center().gap(px(6.)).text_size(px(13.)).child(Icon::new(IconName::Clock).size(px(14.))).child(div().underline().child(time_ago(Some(&u)))))),
            );
        let tabs = [(FnTab::Overview, "Overview"), (FnTab::Invocations, "Invocations"), (FnTab::Logs, "Logs"), (FnTab::Code, "Code"), (FnTab::Settings, "Settings")];
        let tab_bar = div().border_b_1().border_color(t.border).px_3().child(div().flex().gap_1().children(tabs.iter().enumerate().map(|(i, (tab, label))| {
            let active = self.tab == *tab;
            let tab = *tab;
            div()
                .id(("fn-tab", i))
                .relative()
                .px_3()
                .py_2()
                .tw_text_sm()
                .cursor_pointer()
                .when(active, |d| d.font_weight(FontWeight::MEDIUM).text_color(t.foreground))
                .when(!active, |d| d.text_color(t.muted_foreground).hover(|d| d.text_color(t.foreground)))
                .on_click(cx.listener(move |this, _, w, cx| this.select_tab(tab, w, cx)))
                .child(*label)
                .when(active, |d| d.child(div().absolute().left_3().right_3().bottom_0().h(px(2.)).bg(t.foreground)))
        })));
        let content: AnyElement = if self.loading && self.func.is_none() && self.load_error.is_none() {
            div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading function…").into_any_element()
        } else if let (Some(err), true) = (self.load_error.clone(), self.func.is_none()) {
            let w = cx.entity().downgrade();
            div().p_6().child(load_error_box("fn-retry", "Failed to load function", err, move |_, cx| { w.update(cx, |v, cx| v.load_function(cx)).ok(); }, false, cx)).into_any_element()
        } else {
            match self.tab {
                FnTab::Overview => self.render_overview(cx),
                FnTab::Invocations => self.invocations.clone().map(|e| e.into_any_element()).unwrap_or_else(|| div().into_any_element()),
                FnTab::Logs => self.logs.clone().map(|e| e.into_any_element()).unwrap_or_else(|| div().into_any_element()),
                FnTab::Code => self.render_code(cx),
                FnTab::Settings => div().mx_auto().flex().w_full().max_w(px(896.)).flex_col().gap_6().p_6().child(self.render_settings(cx)).into_any_element(),
            }
        };
        let scroll = matches!(self.tab, FnTab::Overview | FnTab::Settings);
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(tab_bar)
            .child(if scroll { div().id("fn-body").flex_1().min_h_0().overflow_y_scroll().child(content).into_any_element() } else { div().flex().flex_1().min_h_0().flex_col().child(content).into_any_element() })
    }
}

// ---- edge-secrets-view -------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Secret {
    name: String,
    value: Option<String>,
    updated_at: Option<String>,
}

pub struct EdgeSecretsView {
    info: Option<ConnInfo>,
    access: Option<Access>,
    secrets: Vec<Secret>,
    loading: bool,
    load_error: Option<String>,
    search: Entity<InputState>,
    table: Entity<TableState>,
    edit_name: Option<String>,
    name_draft: Entity<InputState>,
    value_draft: Entity<InputState>,
    saving: bool,
    dialog: Option<OverlayId>,
}

pub fn valid_secret_name(name: &str) -> bool {
    let mut c = name.chars();
    c.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_') && c.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

impl EdgeSecretsView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_input("Search secrets…", window, cx);
        let table = cx.new(|_| TableState::default());
        cx.observe(&table, |_, _, cx| cx.notify()).detach();
        let name_draft = cx.new(|cx| InputState::new(window, cx).placeholder("MY_API_KEY"));
        let value_draft = cx.new(|cx| InputState::new(window, cx).placeholder("Secret value").masked(true));
        cx.subscribe(&value_draft, |this: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::PressEnter { .. }) {
                this.save(cx);
            }
        })
        .detach();
        on_refresh("edge-secrets", cx, Self::load);
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let mut this = Self { info, access: None, secrets: vec![], loading: false, load_error: None, search, table, edit_name: None, name_draft, value_draft, saving: false, dialog: None };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let info = self.info.clone();
        ui::run(
            cx,
            async move {
                let a = supabase::resolve_access(info).await?.ok_or_else(|| anyhow::anyhow!("Secrets are unavailable here."))?;
                let rows = supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/secrets", a.project_ref), None).await;
                Ok((a, rows))
            },
            |this, r, cx| {
                this.loading = false;
                match r {
                    Err(e) => {
                        this.secrets.clear();
                        this.access = None;
                        this.load_error = Some(ui::err_text(&e));
                    }
                    Ok((a, rows)) => {
                        this.access = Some(a);
                        match rows {
                            Ok(v) => {
                                let mut list: Vec<Secret> = v.as_array().map(|rows| rows.iter().map(|r| Secret { name: s(r, "name").unwrap_or_default(), value: r.get("value").filter(|v| !v.is_null()).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())), updated_at: normalize_ts(r.get("updated_at")) }).filter(|s| !s.name.is_empty()).collect()).unwrap_or_default();
                                list.sort_by(|a, b| a.name.cmp(&b.name));
                                this.secrets = list;
                                this.load_error = None;
                            }
                            Err(e) => {
                                let m = ui::err_text(&e);
                                Toast::error(m.clone()).show(cx);
                                this.secrets.clear();
                                this.load_error = Some(m);
                            }
                        }
                    }
                }
            },
        );
    }

    fn open_dialog(&mut self, edit: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.edit_name = edit.clone();
        self.name_draft.update(cx, |s, cx| s.set_value(edit.clone().unwrap_or_default(), window, cx));
        self.value_draft.update(cx, |s, cx| s.set_value("", window, cx));
        if edit.is_none() {
            self.name_draft.update(cx, |s, cx| s.focus(window, cx));
        } else {
            self.value_draft.update(cx, |s, cx| s.focus(window, cx));
        }
        let weak = cx.entity().downgrade();
        let (name, value) = (self.name_draft.clone(), self.value_draft.clone());
        self.dialog = Some(rexa_ui::open_dialog(cx, move |_, cx| {
            let Some(view) = weak.upgrade() else { return Dialog::new() };
            let (edit, saving) = { let v = view.read(cx); (v.edit_name.clone(), v.saving) };
            let t = cx.tokens().clone();
            let v2 = view.clone();
            Dialog::new()
                .max_w(384.)
                .title(edit.as_ref().map(|n| format!("Update \"{n}\"")).unwrap_or_else(|| "Add a new secret".into()))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(div().flex().flex_col().gap(px(6.)).child(rexa_ui::Label::new("Name")).child(div().font_family(MONO).tw_text_xs().child(TextInput::new(&name).h(36.).disabled(edit.is_some()))))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(rexa_ui::Label::new("Value"))
                                .child(div().font_family(MONO).tw_text_xs().child(TextInput::new(&value).h(36.)))
                                .child(div().text_size(px(11.)).text_color(t.muted_foreground).child("Values are write-only — they can't be read back after saving.")),
                        ),
                )
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("sec-cancel").ghost().size(ButtonSize::Sm).label("Cancel").disabled(saving).on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("sec-save").size(ButtonSize::Sm).label(if saving { "Saving…" } else if edit.is_some() { "Update" } else { "Add" }).disabled(saving).on_click(move |_, _, cx| v2.update(cx, |s, cx| s.save(cx)))),
                )
        }));
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        if self.saving {
            return;
        }
        let name = self.name_draft.read(cx).value().trim().to_string();
        let value = self.value_draft.read(cx).value().to_string();
        if name.is_empty() {
            Toast::error("Secret name is required.").show(cx);
            return;
        }
        if !valid_secret_name(&name) {
            Toast::error("Use letters, numbers, and underscores, starting with a letter or underscore.").show(cx);
            return;
        }
        if value.is_empty() {
            Toast::error("Secret value is required.").show(cx);
            return;
        }
        let Some(a) = self.access.clone() else { return };
        self.saving = true;
        cx.notify();
        let editing = self.edit_name.is_some();
        ui::run(cx, async move { supabase::request(&a.token, reqwest::Method::POST, &format!("/projects/{}/secrets", a.project_ref), Some(serde_json::json!([{ "name": name, "value": value }]))).await.map(|_| name) }, move |this, r, cx| {
            this.saving = false;
            match r {
                Ok(name) => {
                    Toast::success(if editing { format!("Secret \"{name}\" updated.") } else { format!("Secret \"{name}\" added.") }).show(cx);
                    if let Some(id) = this.dialog.take() {
                        rexa_ui::close_overlay(id, cx);
                    }
                    this.load(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            }
        });
    }

    fn delete(&mut self, name: String, cx: &mut Context<Self>) {
        if self.access.is_none() {
            return;
        }
        let opts = ConfirmOptions::destructive("Delete secret").description(format!("Delete secret \"{name}\"? Functions using it will break on next deploy.")).confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            let Some(a) = this.access.clone() else { return };
            ui::run(cx, async move { supabase::request(&a.token, reqwest::Method::DELETE, &format!("/projects/{}/secrets", a.project_ref), Some(serde_json::json!([name.clone()]))).await.map(|_| name) }, |this, r, cx| match r {
                Ok(name) => {
                    Toast::success(format!("Secret \"{name}\" deleted.")).show(cx);
                    this.load(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            });
        });
    }
}

impl Render for EdgeSecretsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let visible: Vec<Secret> = self.secrets.iter().filter(|s| q.is_empty() || s.name.to_lowercase().contains(&q)).cloned().collect();
        let header = ui::page_header(
            "Secrets",
            "Environment variables for your Edge Functions. Values are write-only and never shown back.",
            vec![
                Button::new("sec-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element(),
                Button::new("sec-add").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Add secret").on_click(cx.listener(|this, _, w, cx| this.open_dialog(None, w, cx))).into_any_element(),
            ],
            cx,
        );
        let body: AnyElement = if self.loading && self.secrets.is_empty() {
            div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading secrets…").into_any_element()
        } else if let (Some(err), true) = (self.load_error.clone(), self.secrets.is_empty()) {
            let w = cx.entity().downgrade();
            load_error_box("sec-retry", "Failed to load secrets", err, move |_, cx| { w.update(cx, |v, cx| v.load(cx)).ok(); }, true, cx)
        } else if visible.is_empty() {
            let searching = !q.is_empty();
            ui::empty_state(
                IconName::KeyRound,
                if searching { "No matching secrets" } else { "No secrets yet" },
                Some(if searching { "Try a different search term." } else { "Add a secret to expose it as an environment variable in your functions." }.into()),
                (!searching).then(|| div().mt_2().child(Button::new("sec-add-empty").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Add secret").on_click(cx.listener(|this, _, w, cx| this.open_dialog(None, w, cx)))).into_any_element()),
                cx,
            )
        } else {
            let w = cx.entity().downgrade();
            let rows = visible.iter().map(|s| {
                let (n1, n2, n3) = (s.name.clone(), s.name.clone(), s.name.clone());
                let (w1, w2, w3) = (w.clone(), w.clone(), w.clone());
                Row::new(s.name.clone())
                    .sort("name", s.name.clone())
                    .sort("updated", s.updated_at.clone().unwrap_or_default())
                    .cell(div().truncate().font_family(MONO).text_size(px(11.)).font_weight(FontWeight::MEDIUM).child(s.name.clone()))
                    .cell(div().truncate().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child("••••••••"))
                    .cell(div().truncate().text_color(t.muted_foreground).child(time_ago(s.updated_at.as_deref())))
                    .cell(
                        div()
                            .flex()
                            .w_full()
                            .justify_end()
                            .gap_1()
                            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .child(Button::new(SharedString::from(format!("sec-edit-{n1}"))).ghost().size(ButtonSize::IconSm).icon(IconName::Pencil).on_click(move |_, win, cx| { let n = n1.clone(); w1.update(cx, |v, cx| v.open_dialog(Some(n), win, cx)).ok(); }))
                            .child(Button::new(SharedString::from(format!("sec-del-{n2}"))).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(move |_, _, cx| { let n = n2.clone(); w2.update(cx, |v, cx| v.delete(n, cx)).ok(); })),
                    )
                    .on_click(move |win, cx| {
                        let n = n3.clone();
                        w3.update(cx, |v, cx| v.open_dialog(Some(n), win, cx)).ok();
                    })
            });
            DataTable::new("edge-secrets", &self.table)
                .columns([Column::new("name", "Name").fr(1.2).sortable(), Column::new("value", "Value").fr(1.), Column::new("updated", "Updated").fr(0.8).sortable(), Column::new("actions", "").px(88.).right()])
                .rows(rows)
                .into_any_element()
        };
        let _ = &self.secrets.first().map(|s| s.value.clone());
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(div().id("sec-body").flex_1().min_h_0().overflow_y_scroll().p_6().child(div().mb_4().max_w(px(384.)).child(ui::search_box(&self.search, 28., cx))).child(body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_eszip_sources() {
        let blob = "binary\u{0}junk {\"version\":3,\"sources\":[\"file:///src/index.ts\"],\"sourcesContent\":[\"Deno.serve(() => new Response(\\\"]\\\"))\"]} tail";
        let files = extract_function_sources(blob).unwrap();
        assert_eq!(files[0].name, "file:///src/index.ts");
        assert!(files[0].content.contains("Deno.serve"));
        assert!(extract_function_sources("plain text").is_none());
    }

    #[test]
    fn parses_multipart() {
        let body = "--abc\r\nContent-Disposition: form-data; name=\"file\"; filename=\"src/index.ts\"\r\n\r\nconsole.log(1)\r\n--abc--\r\n";
        let files = parse_multipart_body(body);
        assert_eq!(files, vec![CodeFile { name: "index.ts".into(), content: "console.log(1)".into() }]);
        assert_eq!(parse_multipart_body("export {}")[0].name, "index.ts");
    }

    #[test]
    fn events_parse_and_filter() {
        let rows = vec![
            serde_json::json!({"timestamp": 1_700_000_000_000_000i64, "event_message": "POST | 200 | https://x.supabase.co/functions/v1/hello", "attributes": {"request.id": "r1"}}),
            serde_json::json!({"timestamp": "2024-01-01T00:00:00Z", "event_message": "GET | 404 | /functions/v1/other"}),
        ];
        let ev = parse_events(&rows, "hello");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].method.as_deref(), Some("POST"));
        assert_eq!(ev[0].status, Some(200));
        assert_eq!(ev[0].request_id.as_deref(), Some("r1"));
    }

    #[test]
    fn misc() {
        assert!(valid_secret_name("MY_KEY_1"));
        assert!(!valid_secret_name("1KEY"));
        assert!(!valid_secret_name("A-B"));
        assert_eq!(function_url("ref", "hello"), "https://ref.supabase.co/functions/v1/hello");
        assert!(build_events_sql("a_b", "function_edge_logs", true).contains("LIKE '%a\\_b%'"));
        assert_eq!(time_ago(None), "—");
        let csv = to_csv(&[FunctionEvent { message: "a,b".into(), ..Default::default() }]);
        assert!(csv.ends_with("\"a,b\""));
    }
}
