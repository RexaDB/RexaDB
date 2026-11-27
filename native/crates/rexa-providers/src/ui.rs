//! Small shared pieces of the provider screens:
//! - the `px-6 py-4 border-b` page header every studio provider view uses
//!   (`<h1 className="text-sm font-semibold tracking-tight">` + muted `<p>`),
//! - `components/studio/database/empty-state-presentational.tsx`,
//! - the `relative` search `<Input>` with a leading search icon,
//! - a one-field prompt dialog (Create folder / Rename / Move …),
//! - date/byte formatting (`toLocaleString`, `formatBytes`).

use gpui::{div, prelude::*, px, AnyElement, App, Entity, FontWeight, SharedString, WeakEntity, Window};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{with_alpha, ActiveTokens, Button, ButtonSize, Dialog, IconName, OverlayId, TextInput, Tw};

/// Studio provider page header: title + description on the left, actions right.
pub fn page_header(title: &str, description: impl IntoElement, actions: Vec<AnyElement>, cx: &App) -> gpui::Div {
    let t = cx.tokens();
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_between()
        .gap_4()
        .border_b_1()
        .border_color(t.border)
        .px_6()
        .py_4()
        .child(
            div()
                .min_w_0()
                .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).text_color(t.foreground).child(rexa_ui::tight(title.to_string())))
                .child(div().mt(px(2.)).tw_text_sm().text_color(t.muted_foreground).child(description)),
        )
        .child(div().flex().flex_shrink_0().items_center().gap_2().children(actions))
}

/// Inline `<code className="rounded bg-muted px-1">`.
pub fn code(text: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div().rounded(px(4.)).bg(t.muted).px_1().font_family(rexa_ui::MONO).text_size(px(12.)).child(text.to_string()).into_any_element()
}

/// Inline run of text pieces and elements (emulates inline flow inside a `<p>`).
pub fn inline(parts: Vec<AnyElement>) -> AnyElement {
    div().flex().flex_wrap().items_center().gap_x(px(4.)).children(parts).into_any_element()
}

/// `EmptyStatePresentational`.
pub fn empty_state(icon: IconName, title: impl Into<SharedString>, description: Option<SharedString>, children: Option<AnyElement>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .w_full()
        .flex()
        .flex_col()
        .items_center()
        .gap_y_3()
        .px_4()
        .py_10()
        .tw_rounded_lg()
        .border_1()
        .border_dashed()
        .border_color(t.border)
        .bg(t.var_or("--background-surface-100", t.background))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_y_3()
                .items_center()
                .child(Icon::new(icon).size(px(24.)).text_color(t.muted_foreground))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .text_center()
                        .child(div().tw_text_base().child(title.into()))
                        .children(description.map(|d| div().tw_text_sm().text_color(t.muted_foreground).max_w(px(640.)).child(d))),
                ),
        )
        .children(children)
        .into_any_element()
}

/// `<Search className="absolute left-3 …" /><Input className="h-9 pl-9 text-xs" />`.
pub fn search_box(state: &Entity<InputState>, height: f32, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .tw_text_xs()
        .child(
            TextInput::new(state)
                .h(height)
                .prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.5))),
        )
        .into_any_element()
}

/// Spinning-icon refresh button (`<RefreshCw className={cn(loading && "animate-spin")} />`).
/// The spin is approximated by a static icon while disabled.
pub fn refresh_button(id: &'static str, loading: bool, on_click: impl Fn(&mut Window, &mut App) + 'static) -> Button {
    Button::new(id).outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(loading).on_click(move |_, w, cx| on_click(w, cx))
}

/// Uppercase `text-[10px] font-medium tracking-wider` table header cell.
pub fn th(text: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .text_size(px(10.))
        .line_height(px(15.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
        .child(rexa_ui::tracked_text::tracked(text.to_uppercase(), 0.05))
        .into_any_element()
}

/// `StudioSheetContent contained` docked on the right of the view (non-modal):
/// `w-[min(420px,92vw)]`, the h-9 tab-strip header with the pill title, a
/// scrolling body and the compact footer.
pub fn studio_sheet(id: &'static str, title: impl Into<SharedString>, body: AnyElement, footer: Option<AnyElement>, on_close: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .w(px(420.))
        .flex_shrink_0()
        .h_full()
        .flex()
        .flex_col()
        .border_l_1()
        .border_color(t.border)
        .bg(t.background)
        .child(
            div()
                .relative()
                .flex()
                .flex_shrink_0()
                .h_9()
                .items_center()
                .gap_1()
                .border_b_1()
                .border_color(t.border)
                .p_1()
                .pl_3()
                .pr(px(40.))
                .child(
                    div()
                        .h_7()
                        .min_w(px(96.))
                        .max_w(px(208.))
                        .flex()
                        .items_center()
                        .tw_rounded_md()
                        .bg(t.var_or("--studio-tab-active", t.muted))
                        .px_2()
                        .tw_text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .child(div().truncate().child(title.into())),
                )
                .child(
                    div()
                        .absolute()
                        .right(px(6.))
                        .top(px(6.))
                        .child(Button::new(id).ghost().size(ButtonSize::IconXs).icon(IconName::X).on_click(move |_, w, cx| on_close(w, cx))),
                ),
        )
        .child(div().id(SharedString::from(format!("{id}-body"))).flex_1().min_h_0().overflow_y_scroll().child(body))
        .children(footer.map(|f| {
            div()
                .flex()
                .flex_shrink_0()
                .min_h_9()
                .items_center()
                .justify_end()
                .gap_1()
                .border_t_1()
                .border_color(t.border)
                .px_3()
                .py_2()
                .child(f)
        }))
        .into_any_element()
}

pub struct Prompt {
    pub title: String,
    pub description: Option<String>,
    pub label: Option<String>,
    pub hint: Option<String>,
    pub confirm: &'static str,
    pub busy: &'static str,
    pub max_w: f32,
}

impl Prompt {
    pub fn new(title: impl Into<String>, confirm: &'static str, busy: &'static str) -> Self {
        Prompt { title: title.into(), description: None, label: None, hint: None, confirm, busy, max_w: 384. }
    }
}

/// One-input dialog. `is_busy` is read on every render; `submit` runs on the
/// confirm button and on Enter. The caller closes it (by id) on success.
pub fn open_prompt<V: 'static>(
    view: WeakEntity<V>,
    input: Entity<InputState>,
    prompt: Prompt,
    is_busy: impl Fn(&V) -> bool + 'static,
    submit: impl Fn(&mut V, String, &mut gpui::Context<V>) + 'static,
    window: &mut Window,
    cx: &mut App,
) -> OverlayId {
    let submit = std::rc::Rc::new(submit);
    {
        let (view, submit) = (view.clone(), submit.clone());
        cx.subscribe(&input, move |input, event: &InputEvent, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                let value = input.read(cx).value().to_string();
                view.update(cx, |v, cx| submit(v, value, cx)).ok();
            }
        })
        .detach();
    }
    input.update(cx, |s, cx| s.focus(window, cx));
    let is_busy = std::rc::Rc::new(is_busy);
    rexa_ui::open_dialog(cx, move |_, cx| {
        let t = cx.tokens().clone();
        let busy = view.upgrade().is_some_and(|v| is_busy(v.read(cx)));
        let (v1, s1, i1) = (view.clone(), submit.clone(), input.clone());
        let mut d = Dialog::new().max_w(prompt.max_w).title(prompt.title.clone());
        if let Some(desc) = &prompt.description {
            d = d.description(desc.clone());
        }
        let field = div()
            .flex()
            .flex_col()
            .gap_2()
            .children(prompt.label.clone().map(|l| div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(l)))
            .child(TextInput::new(&input))
            .children(prompt.hint.clone().map(|h| div().tw_text_xs().text_color(t.muted_foreground).child(h)));
        d.child(field).footer(
            div()
                .flex()
                .justify_end()
                .gap_2()
                .child(Button::new("prompt-cancel").ghost().size(ButtonSize::Sm).label("Cancel").disabled(busy).on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .child(Button::new("prompt-ok").size(ButtonSize::Sm).label(if busy { prompt.busy } else { prompt.confirm }).disabled(busy).on_click(move |_, _, cx| {
                    let value = i1.read(cx).value().to_string();
                    v1.update(cx, |v, cx| s1(v, value, cx)).ok();
                })),
        )
    })
}

/// Run `fut` on the I/O runtime and hand the result back to the view.
pub fn run<V: 'static, T: Send + 'static>(
    cx: &mut gpui::Context<V>,
    fut: impl std::future::Future<Output = anyhow::Result<T>> + Send + 'static,
    done: impl FnOnce(&mut V, anyhow::Result<T>, &mut gpui::Context<V>) + 'static,
) {
    let task = rexa_core::runtime::spawn(fut);
    cx.spawn(async move |this, cx| {
        let result = task.await;
        this.update(cx, |v, cx| {
            done(v, result, cx);
            cx.notify();
        })
        .ok();
    })
    .detach();
}

/// `await confirm({...})` then `then(view)` when accepted.
pub fn confirm_then<V: 'static>(cx: &mut gpui::Context<V>, opts: rexa_ui::ConfirmOptions, then: impl FnOnce(&mut V, &mut gpui::Context<V>) + 'static) {
    let fut = rexa_ui::confirm(opts, cx);
    cx.spawn(async move |this, cx| {
        if fut.await {
            this.update(cx, |v, cx| then(v, cx)).ok();
        }
    })
    .detach();
}

pub fn copy(text: impl Into<String>, ok: &str, cx: &mut App) {
    cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.into()));
    rexa_ui::Toast::success(ok.to_string()).show(cx);
}

pub fn err_text(e: &anyhow::Error) -> String {
    format!("{e:#}")
}

// ---- formatting -------------------------------------------------------------------------

/// `formatBytes` (lib/studio/storage-utils.ts).
pub fn format_bytes(bytes: Option<f64>) -> String {
    let Some(b) = bytes.filter(|b| !b.is_nan()) else { return "—".into() };
    if b < 1024. {
        format!("{} B", b)
    } else if b < 1024. * 1024. {
        format!("{:.1} KB", b / 1024.)
    } else if b < 1024. * 1024. * 1024. {
        format!("{:.1} MB", b / (1024. * 1024.))
    } else {
        format!("{:.1} GB", b / (1024. * 1024. * 1024.))
    }
}

/// Parse the timestamp shapes Postgres / JSON APIs return.
pub fn parse_ts(value: &str) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(v) {
        return Some(d.with_timezone(&Local));
    }
    for f in ["%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%d %H:%M:%S%#z", "%Y-%m-%dT%H:%M:%S%.f%#z"] {
        if let Ok(d) = DateTime::parse_from_str(v, f) {
            return Some(d.with_timezone(&Local));
        }
    }
    for f in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(v, f) {
            return Some(Utc.from_utc_datetime(&n).with_timezone(&Local));
        }
    }
    if let Ok(n) = v.parse::<f64>() {
        let ms = if n < 1e12 { n * 1000. } else { n };
        return Local.timestamp_millis_opt(ms as i64).single();
    }
    None
}

/// `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })` (en-US).
pub fn date_medium_short(value: &str) -> String {
    parse_ts(value).map(|d| d.format("%b %-d, %Y, %-I:%M %p").to_string()).unwrap_or_else(|| "—".into())
}

/// `new Date(x).toLocaleString()` (en-US).
pub fn date_locale(value: &str) -> String {
    parse_ts(value).map(|d| d.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string()).unwrap_or_else(|| "—".into())
}

/// `new Date(x).toLocaleDateString()` (en-US).
pub fn date_only(value: &str) -> String {
    parse_ts(value).map(|d| d.format("%-m/%-d/%Y").to_string()).unwrap_or_else(|| "—".into())
}

/// SQL string literal body (`'` doubled).
pub fn lit(s: &str) -> String {
    s.replace('\'', "''")
}

/// Postgres boolean text (`t`/`true`).
pub fn truthy(s: &str) -> bool {
    matches!(s.trim(), "t" | "true" | "TRUE" | "1" | "yes")
}

/// Text arrays come back as JSON (`["a"]`) or PG literals (`{a,b}`).
pub fn text_array(s: &str) -> Vec<String> {
    let s = s.trim();
    if s.is_empty() {
        return vec![];
    }
    if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(s) {
        return items.into_iter().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect();
    }
    if let Some(inner) = s.strip_prefix('{').and_then(|r| r.strip_suffix('}')) {
        return inner.split(',').map(|p| p.trim().trim_matches('"').to_string()).filter(|p| !p.is_empty()).collect();
    }
    vec![s.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes() {
        assert_eq!(format_bytes(None), "—");
        assert_eq!(format_bytes(Some(512.)), "512 B");
        assert_eq!(format_bytes(Some(52428800.)), "50.0 MB");
    }

    #[test]
    fn arrays() {
        assert_eq!(text_array("{image/png,image/jpg}"), vec!["image/png", "image/jpg"]);
        assert_eq!(text_array(r#"["a","b"]"#), vec!["a", "b"]);
        assert!(text_array("").is_empty());
    }

    #[test]
    fn timestamps() {
        assert!(parse_ts("2024-01-02 03:04:05.123+00").is_some());
        assert!(parse_ts("2024-01-02T03:04:05Z").is_some());
        assert!(parse_ts("2024-01-02 03:04:05").is_some());
        assert!(parse_ts("nope").is_none());
    }
}
