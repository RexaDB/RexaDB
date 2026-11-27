//! Port of components/studio/ai/ai-chat-sheet.tsx (embedded sidebar mode) with
//! its parts: ai-chat-history-menu.tsx, ai-message-list.tsx,
//! ai-message-content.tsx, ai-empty-state.tsx, ai-sql-block.tsx,
//! agent-trace.tsx, shimmer-label.tsx, approval-card.tsx, task-rows.tsx,
//! ai-permission-dialog.tsx and agent-sidebar-prompt-bar.tsx (Pill variant).
//!
//! CSS emulation notes:
//! - `truncate` → `overflow_hidden + text_ellipsis + whitespace_nowrap`.
//! - The shimmer gradient on "Thinking" and the rainbow sweep / pop-in
//!   animations are not reproduced (static muted text).
//! - The prompt bar's "wide" layout is decided by a character-count heuristic
//!   instead of measuring the text against the inline input width.
//! - Inline `code` gets the muted background through a text highlight (no
//!   padding / monospace inside a run).

use crate::agent::ApprovalQuestion;
use crate::hub::AiHub;
use crate::markdown::{self, Block, InlineKind, SqlToken};
use gpui::{
    div, img, prelude::*, px, AnyElement, App, Context, Entity, FontWeight, HighlightStyle, KeyDownEvent, ScrollHandle, SharedString, StyledText,
    Subscription, Window,
};
use gpui_component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_component::Icon;
use rexa_core::{StudioEvent, TabSpec};
use rexa_ui::{tw, white, with_alpha, ActiveTokens, Button, ButtonSize, Dialog, DropdownMenu, IconName, MenuItem, Tokens, Tooltip, Tw};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Menu {
    At,
    Slash,
}

struct Source {
    key: String,
    name: String,
    desc: String,
    glyph: IconName,
}

#[derive(Default)]
struct ApprovalState {
    qi: usize,
    answers: HashMap<usize, Vec<usize>>,
    custom: HashMap<usize, Entity<InputState>>,
    sent: bool,
    closed: bool,
}

pub struct AiChat {
    hub: Entity<AiHub>,
    draft: Entity<TextareaState>,
    scroll: ScrollHandle,
    dismissed: bool,
    plus_open: bool,
    model_open: bool,
    active_row: usize,
    attachments: Vec<String>,
    approvals: HashMap<String, ApprovalState>,
    task_open: HashMap<String, bool>,
    trace_expanded: Option<bool>,
    last_len: usize,
    _subs: Vec<Subscription>,
}

/// `parseToken`: `(^|\s)([@/])([\w-]*)$`.
fn parse_token(draft: &str) -> Option<(Menu, String, usize)> {
    let start = draft.rfind(|c: char| c.is_whitespace()).map_or(0, |i| i + draft[i..].chars().next().map_or(1, char::len_utf8));
    let word = &draft[start..];
    let mut chars = word.chars();
    let kind = match chars.next()? {
        '@' => Menu::At,
        '/' => Menu::Slash,
        _ => return None,
    };
    let query: String = chars.collect();
    if !query.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    Some((kind, query.to_lowercase(), start))
}

const COMMANDS: &[(&str, &str, &str)] = &[
    ("explain", "/explain", "Explain a query plan"),
    ("summarize", "/summarize", "Summarize a table"),
    ("generate", "/generate", "Generate SQL"),
    ("compare", "/compare", "Compare schemas"),
];

fn provider_logo(provider: &str) -> Option<&'static str> {
    Some(match provider {
        "openai" => "providers/openai.svg",
        "anthropic" => "providers/anthropic_black.svg",
        "google" => "providers/google.svg",
        "openrouter" => "providers/openrouter_light.svg",
        "ollama" => "providers/ollama-logo-black-light-svg.svg",
        "kilo" => "providers/kilo.svg",
        _ => return None,
    })
}

/// `ProviderBadge`.
fn provider_badge(provider: &str, size: f32, t: &Tokens) -> AnyElement {
    match provider_logo(provider) {
        // `dark:invert` for monochrome logos is not emulated.
        Some(src) => img(src).size(px(size)).flex_shrink_0().into_any_element(),
        None => div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size(px(size))
            .rounded(px(3.))
            .bg(t.muted)
            .text_size(px(8.))
            .font_weight(FontWeight::BOLD)
            .text_color(t.muted_foreground)
            .child(provider.chars().next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_default())
            .into_any_element(),
    }
}

fn icon(name: IconName, size: f32, color: gpui::Hsla) -> Icon {
    Icon::new(name).size(px(size)).text_color(color)
}

fn truncate(d: gpui::Div) -> gpui::Div {
    d.overflow_hidden().text_ellipsis().whitespace_nowrap()
}

impl AiChat {
    pub fn new(hub: Entity<AiHub>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let draft = cx.new(|cx| TextareaState::new(window, cx).auto_grow(1, 5).submit_on_enter(true).placeholder("Write a message..."));
        let mut subs = vec![cx.observe(&hub, |this, hub, cx| {
            let len: usize = hub.read(cx).messages.iter().map(|m| m.content.len()).sum::<usize>() + hub.read(cx).messages.len();
            if len != this.last_len {
                this.last_len = len;
                this.scroll.scroll_to_bottom();
            }
            cx.notify();
        })];
        subs.push(cx.subscribe_in(&draft, window, |this, _, ev: &InputEvent, window, cx| match ev {
            InputEvent::Change => {
                this.dismissed = false;
                this.plus_open = false;
                this.active_row = 0;
                cx.notify();
            }
            InputEvent::PressEnter { shift: false, .. } => this.send(window, cx),
            _ => {}
        }));
        hub.update(cx, |h, cx| {
            h.reload_settings(cx);
            h.load_chats(cx);
        });
        AiChat {
            hub,
            draft,
            scroll: ScrollHandle::new(),
            dismissed: false,
            plus_open: false,
            model_open: false,
            active_row: 0,
            attachments: Vec::new(),
            approvals: HashMap::new(),
            task_open: HashMap::new(),
            trace_expanded: None,
            last_len: 0,
            _subs: subs,
        }
    }

    fn draft_text(&self, cx: &App) -> String {
        self.draft.read(cx).value().to_string()
    }

    fn set_draft(&mut self, text: String, window: &mut Window, cx: &mut Context<Self>) {
        self.draft.update(cx, |s, cx| {
            s.set_value(text, window, cx);
            s.focus(window, cx);
        });
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let draft = self.draft_text(cx);
        // An open @ / slash menu takes Enter.
        if self.menu(&draft).is_some() && !self.rows(&draft, cx).is_empty() {
            let rows = self.rows(&draft, cx);
            let idx = self.active_row.min(rows.len() - 1);
            let key = rows[idx].key.clone();
            self.pick(&key, window, cx);
            return;
        }
        let disabled = self.hub.read(cx).models().is_empty();
        if (draft.trim().is_empty() && self.attachments.is_empty()) || disabled {
            return;
        }
        let mut text = draft.trim().to_string();
        if !self.attachments.is_empty() {
            text.push_str(&format!("\n\n[attached: {}]", self.attachments.join(", ")));
        }
        self.attachments.clear();
        self.plus_open = false;
        self.model_open = false;
        self.trace_expanded = None;
        self.set_draft(String::new(), window, cx);
        let res = self.hub.update(cx, |h, cx| h.send_from_prompt_bar(text, cx));
        if let Err(e) = res {
            rexa_ui::toast::error(format!("{e:#}"), cx);
        }
    }

    fn menu(&self, draft: &str) -> Option<Menu> {
        if self.plus_open {
            return Some(Menu::At);
        }
        if self.dismissed {
            return None;
        }
        parse_token(draft).map(|(m, _, _)| m)
    }

    fn sources(&self, cx: &App) -> Vec<Source> {
        let hub = self.hub.read(cx);
        let mut ranked = hub.catalog.clone();
        let selected = hub.session.driver.kind().default_schema(&hub.session.connection.connection_string);
        ranked.sort_by(|a, b| (a.schema != selected, format!("{}.{}", a.schema, a.table)).cmp(&(b.schema != selected, format!("{}.{}", b.schema, b.table))));
        let mut out = vec![Source { key: "attach".into(), name: "Add photos & files".into(), desc: "Upload from your computer".into(), glyph: IconName::Paperclip }];
        for e in ranked.iter().take(20) {
            out.push(Source { key: format!("table:{}.{}", e.schema, e.table), name: format!("{}.{}", e.schema, e.table), desc: format!("{} columns", e.columns.len()), glyph: IconName::Table });
        }
        out.push(Source { key: "web".into(), name: "Web search".into(), desc: "Real-time news and info".into(), glyph: IconName::Globe });
        out.push(Source { key: "cmd".into(), name: "Commands".into(), desc: "Type / to see commands".into(), glyph: IconName::Command });
        out
    }

    fn rows(&self, draft: &str, cx: &App) -> Vec<Source> {
        let query = if self.plus_open { String::new() } else { parse_token(draft).map(|(_, q, _)| q).unwrap_or_default() };
        match self.menu(draft) {
            Some(Menu::At) => self.sources(cx).into_iter().filter(|s| s.name.to_lowercase().contains(&query) || s.key.to_lowercase().contains(&query)).collect(),
            Some(Menu::Slash) => COMMANDS
                .iter()
                .filter(|(_, name, desc)| name[1..].starts_with(&query) || desc.to_lowercase().contains(&query))
                .map(|(k, n, d)| Source { key: format!("cmd:{k}"), name: n.to_string(), desc: d.to_string(), glyph: IconName::Command })
                .collect(),
            None => Vec::new(),
        }
    }

    /// `pick`.
    fn pick(&mut self, key: &str, window: &mut Window, cx: &mut Context<Self>) {
        let draft = self.draft_text(cx);
        let prefix = parse_token(&draft).map(|(_, _, start)| draft[..start].to_string()).unwrap_or(draft.clone());
        if key == "attach" {
            self.plus_open = false;
            let rx = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: true, prompt: None });
            let token = parse_token(&draft).is_some();
            cx.spawn_in(window, async move |this, cx| {
                if let Ok(Ok(Some(paths))) = rx.await {
                    this.update_in(cx, |this, window, cx| {
                        this.attachments.extend(paths.iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string())));
                        if token {
                            this.set_draft(prefix, window, cx);
                        }
                        cx.notify();
                    })
                    .ok();
                }
            })
            .detach();
            return;
        }
        let rows = self.rows(&draft, cx);
        let Some(row) = rows.iter().find(|r| r.key == key) else { return };
        let next = if key.starts_with("cmd:") { format!("{prefix}{} ", row.name) } else { format!("{prefix}@{} ", row.name) };
        self.plus_open = false;
        self.dismissed = false;
        self.set_draft(next, window, cx);
        cx.notify();
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let draft = self.draft_text(cx);
        let key = ev.keystroke.key.as_str();
        if self.menu(&draft).is_some() {
            let n = self.rows(&draft, cx).len();
            if n > 0 {
                match key {
                    "down" | "up" => {
                        self.active_row = if key == "down" { (self.active_row + 1) % n } else { (self.active_row + n - 1) % n };
                        cx.stop_propagation();
                        cx.notify();
                        return;
                    }
                    "tab" => {
                        let k = self.rows(&draft, cx)[self.active_row.min(n - 1)].key.clone();
                        self.pick(&k, window, cx);
                        cx.stop_propagation();
                        return;
                    }
                    _ => {}
                }
            }
        }
        if key == "escape" {
            self.dismissed = true;
            self.plus_open = false;
            self.model_open = false;
            cx.notify();
        }
    }

    fn open_settings(cx: &mut App) {
        rexa_core::emit_studio(StudioEvent::OpenSettings { section: Some("ai".into()) }, cx);
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        let id = self.hub.read(cx).connection_id;
        rexa_core::emit_studio(StudioEvent::CloseTab(TabSpec::View { view: "ai-chat".into(), params: json!({"connectionId": id}) }), cx);
    }

    fn open_permissions(&mut self, cx: &mut Context<Self>) {
        let hub = self.hub.clone();
        let current = crate::settings::permission_mode(&hub.read(cx).settings).to_string();
        let draft = cx.new(|_| PermissionDraft(current));
        rexa_ui::open_dialog(cx, move |_, cx| {
            let t = cx.tokens().clone();
            let sel = draft.read(cx).0.clone();
            let option = |value: &'static str, title: &'static str, desc: &'static str| {
                let selected = sel == value;
                let d = draft.clone();
                div()
                    .id(value)
                    .flex()
                    .w_full()
                    .items_start()
                    .gap_3()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .px_4()
                    .py_3()
                    .cursor_pointer()
                    .when(selected, |d| d.bg(with_alpha(t.muted, 0.3)))
                    .hover(|s| s.bg(with_alpha(t.muted, 0.4)))
                    .on_click(move |_, _, cx| d.update(cx, |d, cx| {
                        d.0 = value.into();
                        cx.notify();
                    }))
                    .child(
                        div()
                            .mt(px(2.))
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .size_5()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(if selected { t.primary } else { t.border })
                            .when(selected, |d| d.bg(t.primary))
                            .when(selected, |d| d.child(icon(IconName::Check, 12., t.var("--primary-foreground").unwrap_or(t.background)))),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(title))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(desc)),
                    )
            };
            let (d2, h2) = (draft.clone(), hub.clone());
            Dialog::new()
                .max_w(460.)
                .title("Permissions")
                .description("Choose how much access the assistant has in this chat.")
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(option("schema_only", "Schema only", "The assistant can inspect tables, columns, and structure, but not read database rows."))
                        .child(option("schema_with_data", "Schema with database data (read only)", "The assistant can inspect schema and read database data through read-only access.")),
                )
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("perm-cancel").ghost().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("perm-confirm").label("Confirm").on_click(move |_, _, cx| {
                            let mode = d2.read(cx).0.clone();
                            h2.update(cx, |h, cx| h.set_permission_mode(&mode, cx));
                            rexa_ui::close_top(cx);
                        })),
                )
        });
    }

    fn delete_chat(&mut self, chat_id: String, cx: &mut Context<Self>) {
        let hub = self.hub.clone();
        let title = hub.read(cx).chats.iter().find(|c| c.id == chat_id).map(|c| c.title.clone());
        let desc = match title {
            Some(t) => format!("\"{t}\" and its conversation will be permanently removed. This cannot be undone."),
            None => "This chat and its conversation will be permanently removed. This cannot be undone.".into(),
        };
        let ok = rexa_ui::confirm(rexa_ui::ConfirmOptions { description: Some(desc.into()), ..rexa_ui::ConfirmOptions::destructive("Delete chat?").confirm_text("Delete") }, cx);
        cx.spawn(async move |_, cx| {
            if ok.await {
                cx.update(|cx| {
                    if let Err(e) = hub.update(cx, |h, cx| h.remove_chat(&chat_id, cx)) {
                        rexa_ui::toast::error(format!("Failed to delete chat. {e}"), cx);
                    }
                });
            }
        })
        .detach();
    }

    // ---- render pieces ---------------------------------------------------------------------

    fn header_button(id: &'static str, name: IconName, tip: &'static str, t: &Tokens, f: impl Fn(&mut Window, &mut App) + 'static) -> impl IntoElement {
        let hover_bg = if t.dark { white(0.06) } else { with_alpha(t.muted, 0.6) };
        Tooltip::studio(tip).child(
            div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .size_8()
                .tw_rounded_lg()
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(move |s| s.bg(hover_bg))
                .on_click(move |_, w, cx| f(w, cx))
                .child(Icon::new(name).size(px(14.))),
        )
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let hub = self.hub.read(cx);
        let title = hub.active_title();
        let chats = hub.chats.clone();
        let active = hub.active_chat_id.clone();
        let (h1, h2) = (self.hub.clone(), self.hub.clone());
        let this = cx.entity().downgrade();
        let this2 = this.clone();
        let history = DropdownMenu::new("ai-history")
            .align(rexa_ui::Align::Start)
            .trigger(
                div()
                    .id("ai-history-trigger")
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h_7()
                    .px_2()
                    .tw_rounded_md()
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(white(0.06)))
                    .child(truncate(div().max_w(px(180.))).child(title))
                    .child(div().opacity(0.7).child(Icon::new(IconName::ChevronDown).size(px(12.)))),
            )
            .menu(move |mut m, _, cx| {
                let t = cx.tokens().clone();
                m = m.w(256.);
                let h = h1.clone();
                m = m.item(MenuItem::new("New Chat").icon(IconName::Plus).text_xs().on_select(move |_, cx| h.update(cx, |h, cx| h.start_new_chat(cx))));
                if !chats.is_empty() {
                    m = m.separator();
                }
                for c in &chats {
                    let (h, id) = (h2.clone(), c.id.clone());
                    let (del_id, this) = (c.id.clone(), this.clone());
                    let is_active = active.as_deref() == Some(c.id.as_str());
                    let row = div()
                        .flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .gap_3()
                        .child(truncate(div().flex_1().min_w_0()).child(c.title.clone()))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .when(is_active, |d| d.child(div().opacity(0.7).child(Icon::new(IconName::ChevronRight).size(px(14.)))))
                                .child(
                                    Tooltip::studio("Delete Chat").side(rexa_ui::Side::Right).child(
                                        div()
                                            .id(SharedString::from(format!("del-{}", c.id)))
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .size_6()
                                            .tw_rounded_md()
                                            .text_color(t.muted_foreground)
                                            .hover(|s| s.text_color(tw("red-500")))
                                            .on_mouse_down(gpui::MouseButton::Left, move |_, _, cx| {
                                                cx.stop_propagation();
                                                let id = del_id.clone();
                                                this.update(cx, |this, cx| this.delete_chat(id, cx)).ok();
                                            })
                                            .child(Icon::new(IconName::Trash).size(px(12.))),
                                    ),
                                ),
                        );
                    m = m.item(MenuItem::new("").text_xs().leading(row.flex_1()).on_select(move |_, cx| h.update(cx, |h, cx| h.select_chat(&id, cx))));
                }
                m
            });
        let hub_new = self.hub.clone();
        div()
            .flex()
            .flex_shrink_0()
            .h(px(44.))
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(t.border)
            .px_4()
            .child(div().flex().items_center().child(history))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(Self::header_button("ai-new", IconName::Plus, "New Chat", &t, move |_, cx| hub_new.update(cx, |h, cx| h.start_new_chat(cx))))
                    .child(Self::header_button("ai-settings", IconName::Settings, "AI Settings", &t, |_, cx| Self::open_settings(cx)))
                    .child(Self::header_button("ai-perm", IconName::Shield, "Permissions", &t, {
                        let this = this2.clone();
                        move |_, cx| {
                            this.update(cx, |this, cx| this.open_permissions(cx)).ok();
                        }
                    }))
                    .child(Self::header_button("ai-close", IconName::X, "Close AI", &t, {
                        let this = this2.clone();
                        move |_, cx| {
                            this.update(cx, |this, cx| this.close(cx)).ok();
                        }
                    })),
            )
    }

    fn inline(text: &str, t: &Tokens) -> StyledText {
        let mut s = String::new();
        let mut highlights = Vec::new();
        for (kind, run) in markdown::inline_runs(text) {
            let start = s.len();
            s.push_str(&run);
            match kind {
                InlineKind::Bold => highlights.push((start..s.len(), HighlightStyle { font_weight: Some(FontWeight::SEMIBOLD), color: Some(t.foreground), ..Default::default() })),
                InlineKind::Code => highlights.push((start..s.len(), HighlightStyle { background_color: Some(t.muted), ..Default::default() })),
                InlineKind::Text => {}
            }
        }
        StyledText::new(s).with_highlights(highlights)
    }

    fn sql_block(&self, idx: String, query: &str, t: &Tokens) -> AnyElement {
        let mut highlights = Vec::new();
        for (range, kind) in markdown::sql_tokens(query) {
            let color = match kind {
                SqlToken::Comment => t.muted_foreground,
                SqlToken::String => tw("emerald-400"),
                SqlToken::Number => tw("amber-300"),
                SqlToken::Keyword => tw("blue-400"),
                SqlToken::Plain => t.foreground,
            };
            highlights.push((range, HighlightStyle { color: Some(color), ..Default::default() }));
        }
        let code = StyledText::new(query.to_string()).with_highlights(highlights);
        let (q1, q2) = (query.to_string(), query.to_string());
        let btn = |id: String, name: IconName, label: &'static str| {
            div()
                .id(SharedString::from(id))
                .flex()
                .items_center()
                .gap_1()
                .h_6()
                .px(px(6.))
                .tw_rounded_md()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(|s| s.bg(white(0.06)))
                .child(Icon::new(name).size(px(12.)))
                .child(label)
        };
        div()
            .overflow_hidden()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.card)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(t.border)
                    .px(px(10.))
                    .py(px(6.))
                    .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(t.muted_foreground).child("SQL"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(Tooltip::studio("Open in Editor").child(btn(format!("sql-open-{idx}"), IconName::ExternalLink, "Open in Editor").on_click(move |_, _, cx| send_to_sql(&q1, false, cx))))
                            .child(Tooltip::studio("Run Query").child(btn(format!("sql-run-{idx}"), IconName::Play, "Run").on_click(move |_, _, cx| send_to_sql(&q2, true, cx)))),
                    ),
            )
            .child(div().bg(t.background).px(px(10.)).py_2().font_family(rexa_ui::MONO).tw_text_xs().line_height(px(20.)).child(code))
            .into_any_element()
    }

    fn task_rows(&self, key: &str, block: &markdown::TaskBlock, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let list = block.list;
        let mut wrap = div().flex().flex_col().w_full().max_w(px(440.));
        wrap = if list { wrap.overflow_hidden().tw_rounded_xl().bg(t.card).border_1().border_color(t.border).shadow_sm() } else { wrap.gap_2() };
        for (i, task) in block.tasks.iter().enumerate() {
            let k = format!("{key}:{}", task.id);
            let open = self.task_open.get(&k).copied().unwrap_or(false);
            let clickable = !task.details.is_empty();
            let (badge_bg, badge_fg, glyph): (gpui::Hsla, gpui::Hsla, Option<IconName>) = match task.status.as_str() {
                "completed" => (with_alpha(tw("emerald-500"), 0.15), tw("emerald-500"), Some(IconName::Check)),
                "failed" => (with_alpha(t.destructive, 0.15), t.destructive, Some(IconName::X)),
                _ => (gpui::transparent_black(), t.foreground, None),
            };
            let badge = div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(22.))
                .rounded_full()
                .bg(badge_bg)
                .text_color(badge_fg)
                .when(glyph.is_none(), |d| d.border(px(1.5)).border_color(if task.status == "in_progress" { t.foreground } else { t.border }).text_size(px(10.5)).font_weight(FontWeight::SEMIBOLD).child((i + 1).to_string()))
                .when_some(glyph, |d, g| d.child(Icon::new(g).size(px(12.))));
            let pill = match task.status.as_str() {
                "completed" => Some(("Completed", with_alpha(tw("emerald-500"), 0.1), tw("emerald-500"))),
                "failed" => Some(("Failed", with_alpha(t.destructive, 0.1), t.destructive)),
                _ => None,
            };
            let kc = k.clone();
            let mut row = div()
                .flex()
                .flex_col()
                .overflow_hidden()
                .hover(|s| s.bg(with_alpha(t.muted, 0.5)))
                .child(
                    div()
                        .id(SharedString::from(format!("task-{k}")))
                        .flex()
                        .h(px(44.))
                        .w_full()
                        .items_center()
                        .gap(px(10.))
                        .px(px(10.))
                        .when(clickable, |d| d.cursor_pointer())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let v = this.task_open.get(&kc).copied().unwrap_or(false);
                            this.task_open.insert(kc.clone(), !v);
                            cx.notify();
                        }))
                        .child(div().flex().size_6().flex_shrink_0().items_center().justify_center().child(badge))
                        .child(truncate(div().flex_1().min_w_0()).text_size(px(13.)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(task.label.clone()))
                        .children(task.amount.clone().map(|a| div().text_size(px(12.5)).text_color(t.muted_foreground).child(a)))
                        .children(pill.map(|(l, bg, fg)| div().flex().items_center().h(px(22.)).rounded_full().bg(bg).px_2().text_size(px(11.5)).font_weight(FontWeight::MEDIUM).text_color(fg).child(l)))
                        .when(clickable, |d| d.child(div().flex().size_7().items_center().justify_center().text_color(with_alpha(t.muted_foreground, 0.7)).child(Icon::new(if open { IconName::ChevronUp } else { IconName::ChevronDown }).size(px(15.))))),
                )
                .when(open, |d| {
                    d.child(
                        div().flex().mb(px(10.)).gap(px(10.)).px(px(10.)).child(div().w(px(24.)).flex().justify_center().child(div().w(px(1.)).h_full().bg(t.border))).child(
                            div().flex().flex_1().flex_col().gap(px(6.)).children(task.details.iter().map(|(l, m)| {
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(l.clone()))
                                    .child(div().font_family(rexa_ui::MONO).text_size(px(11.5)).text_color(with_alpha(t.muted_foreground, 0.7)).child(m.clone()))
                            })),
                        ),
                    )
                });
            row = if list {
                row.when(i + 1 < block.tasks.len(), |d| d.border_b_1().border_color(t.border))
            } else {
                row.bg(t.card).border_1().border_color(t.border).shadow_sm().rounded(px(if open { 14. } else { 22. }))
            };
            wrap = wrap.child(row);
        }
        wrap.into_any_element()
    }

    fn approval_card(&mut self, key: String, questions: &[ApprovalQuestion], resettable: bool, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let n = questions.len();
        let state = self.approvals.entry(key.clone()).or_default();
        let qi = state.qi.min(n.saturating_sub(1));
        if state.closed {
            let k = key.clone();
            return div()
                .id(SharedString::from(format!("appr-open-{key}")))
                .tw_rounded_lg()
                .bg(t.card)
                .border_1()
                .border_color(t.border)
                .shadow_sm()
                .px_3()
                .py_2()
                .text_size(px(12.5))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .cursor_pointer()
                .hover(|s| s.bg(t.muted))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(s) = this.approvals.get_mut(&k) {
                        s.closed = false;
                    }
                    cx.notify();
                }))
                .child("Open approval")
                .into_any_element();
        }
        if state.sent {
            let k = key.clone();
            return div()
                .flex()
                .w_full()
                .max_w(px(320.))
                .items_center()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .rounded_full()
                        .bg(with_alpha(tw("emerald-500"), 0.1))
                        .py_1()
                        .pr(px(10.))
                        .pl_1()
                        .text_size(px(12.5))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(tw(if t.dark { "emerald-400" } else { "emerald-600" }))
                        .child(div().flex().items_center().justify_center().size(px(18.)).rounded_full().bg(tw("emerald-500")).text_color(gpui::white()).child(Icon::new(IconName::Check).size(px(11.))))
                        .child("Answers sent"),
                )
                .when(resettable, |d| {
                    d.child(
                        div()
                            .id(SharedString::from(format!("appr-reset-{key}")))
                            .tw_text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .cursor_pointer()
                            .hover(|s| s.text_color(t.foreground))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.approvals.insert(k.clone(), ApprovalState::default());
                                cx.notify();
                            }))
                            .child("Start over"),
                    )
                })
                .into_any_element();
        }
        let q = &questions[qi];
        let custom = state.custom.entry(qi).or_insert_with(|| cx.new(|cx| InputState::new(window, cx).placeholder("Something else…"))).clone();
        let picked = state.answers.get(&qi).cloned().unwrap_or_default();
        let has_answer = !picked.is_empty() || !custom.read(cx).value().trim().is_empty();
        let last = qi + 1 == n;
        let mut options = div().flex().flex_col().gap_1().mt(px(10.));
        for (i, opt) in q.options.iter().enumerate() {
            let on = picked.contains(&i);
            let radio = q.kind == "radio";
            let k = key.clone();
            let mark = div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .size_4()
                .when(radio, |d| d.rounded_full())
                .when(!radio, |d| d.rounded(px(5.)))
                .when(on, |d| d.bg(t.foreground).text_color(t.background))
                .when(!on, |d| d.border(px(1.5)).border_color(t.border))
                .when(on && radio, |d| d.child(div().size(px(6.)).rounded_full().bg(t.background)))
                .when(on && !radio, |d| d.child(Icon::new(IconName::Check).size(px(12.))));
            options = options.child(
                div()
                    .id(SharedString::from(format!("appr-{key}-{qi}-{i}")))
                    .flex()
                    .w_full()
                    .items_center()
                    .gap(px(6.))
                    .tw_rounded_lg()
                    .pl_1()
                    .pr_2()
                    .py_1()
                    .cursor_pointer()
                    .hover(|s| s.bg(t.muted))
                    .on_click(cx.listener(move |this, _, window, cx| this.toggle_option(&k, qi, i, window, cx)))
                    .child(mark)
                    .child(div().text_size(px(13.)).line_height(px(13.)).text_color(if on { t.foreground } else { t.muted_foreground }).child(opt.clone())),
            );
        }
        options = options.child(div().flex().items_center().gap(px(6.)).tw_rounded_lg().pl_1().pr_2().py_1().child(div().flex_1().min_w_0().pl(px(6.)).text_size(px(13.)).child(Input::new(&custom).appearance(false))));
        let (k_prev, k_next, k_skip, k_send) = (key.clone(), key.clone(), key.clone(), key.clone());
        let qs_send: Vec<ApprovalQuestion> = questions.to_vec();
        let nav = |id: String, name: IconName, disabled: bool| {
            div()
                .id(SharedString::from(id))
                .flex()
                .items_center()
                .justify_center()
                .size(px(18.))
                .rounded(px(5.))
                .when(disabled, |d| d.opacity(0.3))
                .when(!disabled, |d| d.cursor_pointer().hover(|s| s.text_color(t.foreground)))
                .child(Icon::new(name).size(px(14.)))
        };
        div()
            .w_full()
            .max_w(px(320.))
            .child(
                div()
                    .relative()
                    .overflow_hidden()
                    .tw_rounded_xl()
                    .bg(t.card)
                    .shadow_sm()
                    .border_1()
                    .border_color(t.border)
                    .child(
                        div()
                            .id(SharedString::from(format!("appr-x-{key}")))
                            .absolute()
                            .right(px(10.))
                            .top(px(10.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .size_7()
                            .rounded_full()
                            .text_color(t.muted_foreground)
                            .cursor_pointer()
                            .hover(|s| s.bg(t.muted).text_color(t.foreground))
                            .on_click(cx.listener({
                                let k = key.clone();
                                move |this, _, _, cx| {
                                    if let Some(s) = this.approvals.get_mut(&k) {
                                        s.closed = true;
                                    }
                                    cx.notify();
                                }
                            }))
                            .child(Icon::new(IconName::X).size(px(14.))),
                    )
                    .child(div().p_4().child(div().pr_7().text_size(px(14.)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(q.q.clone())).child(options))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_3()
                            .border_t_1()
                            .border_color(t.border)
                            .bg(with_alpha(t.muted, 0.2))
                            .px_4()
                            .py(px(10.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .text_color(t.muted_foreground)
                                    .child(nav(format!("appr-prev-{key}"), IconName::ChevronUp, qi == 0).on_click(cx.listener(move |this, _, _, cx| this.goto(&k_prev, qi.saturating_sub(1), cx))))
                                    .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(format!("{} / {}", qi + 1, n)))
                                    .child(nav(format!("appr-next-{key}"), IconName::ChevronDown, last).on_click(cx.listener(move |this, _, _, cx| {
                                        if !last {
                                            this.goto(&k_next, qi + 1, cx)
                                        }
                                    }))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(Button::new(SharedString::from(format!("appr-skip-{key}"))).ghost().size(ButtonSize::Sm).label("Skip").on_click(cx.listener(move |this, _, _, cx| {
                                        if last {
                                            if let Some(s) = this.approvals.get_mut(&k_skip) {
                                                s.closed = true;
                                            }
                                            cx.notify();
                                        } else {
                                            this.goto(&k_skip, qi + 1, cx);
                                        }
                                    })))
                                    .child(Button::new(SharedString::from(format!("appr-send-{key}"))).size(ButtonSize::Sm).label(if last { "Send" } else { "Continue" }).disabled(!has_answer).on_click(cx.listener(move |this, _, _, cx| {
                                        if last {
                                            this.send_approval(&k_send, &qs_send, cx);
                                        } else {
                                            this.goto(&k_send, qi + 1, cx);
                                        }
                                    }))),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn goto(&mut self, key: &str, qi: usize, cx: &mut Context<Self>) {
        if let Some(s) = self.approvals.get_mut(key) {
            s.qi = qi;
        }
        cx.notify();
    }

    fn toggle_option(&mut self, key: &str, qi: usize, i: usize, window: &mut Window, cx: &mut Context<Self>) {
        let n_questions = self.current_questions(key, cx).len();
        let Some(questions) = Some(self.current_questions(key, cx)) else { return };
        let radio = questions.get(qi).is_none_or(|q| q.kind == "radio");
        let Some(s) = self.approvals.get_mut(key) else { return };
        let picked = s.answers.entry(qi).or_default();
        if radio {
            *picked = vec![i];
            if let Some(c) = s.custom.get(&qi) {
                c.update(cx, |c, cx| c.set_value("", window, cx));
            }
            if qi + 1 < n_questions {
                let k = key.to_string();
                cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(std::time::Duration::from_millis(480)).await;
                    this.update(cx, |this, cx| this.goto(&k, qi + 1, cx)).ok();
                })
                .detach();
            }
        } else if let Some(pos) = picked.iter().position(|x| *x == i) {
            picked.remove(pos);
        } else {
            picked.push(i);
        }
        cx.notify();
    }

    /// Questions behind an approval card key ("pending" or "<message id>:<block>").
    fn current_questions(&self, key: &str, cx: &App) -> Vec<ApprovalQuestion> {
        let hub = self.hub.read(cx);
        if key.starts_with("pending:") {
            return hub.pending_approval.as_ref().map(|(_, q)| q.clone()).unwrap_or_default();
        }
        let Some((mid, bidx)) = key.rsplit_once(':') else { return Vec::new() };
        let Some(m) = hub.messages.iter().find(|m| m.id == mid) else { return Vec::new() };
        let Ok(bidx) = bidx.parse::<usize>() else { return Vec::new() };
        match markdown::parse_blocks(&m.content).get(bidx) {
            Some(Block::Code { code, .. }) => markdown::parse_approval_block(code).map(|(q, _)| q).unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn send_approval(&mut self, key: &str, questions: &[ApprovalQuestion], cx: &mut Context<Self>) {
        let Some(s) = self.approvals.get_mut(key) else { return };
        let payload: Vec<Value> = questions
            .iter()
            .enumerate()
            .map(|(idx, q)| {
                let selected: Vec<String> = s.answers.get(&idx).into_iter().flatten().filter_map(|i| q.options.get(*i).cloned()).collect();
                let custom = s.custom.get(&idx).map(|c| c.read(cx).value().trim().to_string()).filter(|c| !c.is_empty());
                let mut v = json!({"question": q.q, "type": q.kind, "selected": selected});
                if let Some(c) = custom {
                    v["custom"] = Value::from(c);
                }
                v
            })
            .collect();
        s.sent = true;
        if key.starts_with("pending:") {
            self.approvals.remove(key);
        }
        let res = self.hub.update(cx, |h, cx| h.submit_approval(payload, cx));
        if let Err(e) = res {
            rexa_ui::toast::error(format!("{e:#}"), cx);
        }
        cx.notify();
    }

    fn message_content(&mut self, msg_id: &str, content: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut col = div().flex().flex_col().gap_3().tw_text_sm().line_height(px(28.)).text_color(t.foreground);
        for (i, block) in markdown::parse_blocks(content).into_iter().enumerate() {
            let key = format!("{msg_id}:{i}");
            let el: AnyElement = match block {
                Block::Paragraph(text) => div().child(Self::inline(&text, &t)).into_any_element(),
                Block::List(items) => div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .pl_5()
                    .children(items.iter().map(|item| div().relative().child(div().absolute().left(px(-14.)).child("•")).child(Self::inline(item, &t))))
                    .into_any_element(),
                Block::Code { language, code } => {
                    let lang = language.to_lowercase();
                    if lang == "sql" {
                        self.sql_block(key, &code, &t)
                    } else if let Some(tb) = ["tasks", "task", "task-rows", "task_rows"].contains(&lang.as_str()).then(|| markdown::parse_task_block(&code)).flatten() {
                        self.task_rows(&key, &tb, &t, cx)
                    } else if let Some((qs, resettable)) = ["approval", "ask", "questions", "question"].contains(&lang.as_str()).then(|| markdown::parse_approval_block(&code)).flatten() {
                        self.approval_card(key, &qs, resettable, window, cx)
                    } else {
                        div()
                            .overflow_hidden()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(t.border)
                            .bg(with_alpha(t.muted, 0.4))
                            .p_3()
                            .font_family(rexa_ui::MONO)
                            .tw_text_xs()
                            .line_height(px(24.))
                            .child(code)
                            .into_any_element()
                    }
                }
                Block::Table { headers, rows } => {
                    let cell = |s: &str, head: bool| {
                        div().flex_1().min_w(px(60.)).px_3().py_2().when(head, |d| d.font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground)).child(Self::inline(s, &t))
                    };
                    div()
                        .overflow_hidden()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.border)
                        .tw_text_xs()
                        .child(div().flex().bg(with_alpha(t.muted, 0.4)).border_b_1().border_color(t.border).children(headers.iter().map(|h| cell(h, true))))
                        .children(rows.iter().enumerate().map(|(ri, r)| div().flex().when(ri + 1 < rows.len(), |d| d.border_b_1().border_color(t.border)).children(r.iter().map(|c| cell(c, false)))))
                        .into_any_element()
                }
            };
            col = col.child(el);
        }
        col.into_any_element()
    }

    fn empty_state(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let hub = self.hub.read(cx);
        let ideas: Vec<String> = hub.catalog.iter().take(3).flat_map(|e| [format!("Show the schema for {}", e.table), format!("Give me a summary of {}.{}", e.schema, e.table)]).take(4).collect();
        div()
            .flex()
            .flex_col()
            .gap_6()
            .px_2()
            .py_4()
            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(rexa_ui::tight("How can I assist you?")))
            .child(
                div().flex().flex_col().gap_3().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child("Ideas")).children(ideas.into_iter().enumerate().map(|(i, idea)| {
                    let text = idea.clone();
                    div()
                        .id(("ai-idea", i))
                        .flex()
                        .w_full()
                        .items_center()
                        .gap_3()
                        .tw_text_sm()
                        .text_color(t.foreground)
                        .cursor_pointer()
                        .hover(|s| s.text_color(with_alpha(t.foreground, 0.8)))
                        .on_click(cx.listener(move |this, _, window, cx| this.set_draft(text.clone(), window, cx)))
                        .child(icon(IconName::FileText, 16., t.muted_foreground).flex_shrink_0())
                        .child(idea)
                })),
            )
            .into_any_element()
    }

    /// `AgentTrace`.
    fn trace(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let hub = self.hub.read(cx);
        let steps = hub.steps.clone();
        let active = hub.is_sending;
        let has_rows = !steps.is_empty();
        let expanded = self.trace_expanded.unwrap_or(has_rows);
        let n = steps.len();
        div()
            .flex()
            .flex_col()
            .w_full()
            .child(
                div()
                    .id("ai-trace")
                    .flex()
                    .items_center()
                    .gap_2()
                    .mx(px(-6.))
                    .px(px(6.))
                    .py_1()
                    .tw_rounded_md()
                    .when(has_rows, |d| d.cursor_pointer().hover(|s| s.bg(t.muted)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if has_rows {
                            this.trace_expanded = Some(!expanded);
                            cx.notify();
                        }
                    }))
                    // ShimmerLabel: the moving gradient is approximated by muted text.
                    .child(div().text_size(px(13.)).font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).whitespace_nowrap().child("Thinking"))
                    .child(div().font_family(rexa_ui::MONO).text_size(px(11.5)).text_color(t.muted_foreground).child(hub.elapsed_label()))
                    .when(has_rows, |d| d.child(icon(if expanded { IconName::ChevronUp } else { IconName::ChevronDown }, 14., t.muted_foreground))),
            )
            .when(expanded && has_rows, |d| {
                d.child(
                    div().relative().mt_1().ml(px(5.)).pl_4().child(div().absolute().left(px(3.)).top(px(-8.)).bottom(px(2.)).w(px(1.)).bg(t.border)).child(div().flex().flex_col().gap_1().py_1().children(steps.into_iter().enumerate().map(
                        |(i, step)| {
                            let done = !active || i + 1 < n;
                            div()
                                .flex()
                                .min_h_7()
                                .w_full()
                                .items_center()
                                .gap_2()
                                .rounded(px(6.))
                                .px(px(6.))
                                .py(px(2.))
                                .child(if done {
                                    icon(IconName::Check, 14., t.muted_foreground).into_any_element()
                                } else {
                                    div().size_3().flex_shrink_0().rounded_full().border(px(1.5)).border_color(t.border).into_any_element()
                                })
                                .child(truncate(div().min_w_0()).text_size(px(12.5)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(step))
                        },
                    ))),
                )
            })
            .into_any_element()
    }

    fn render_menus(&self, draft: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let t = cx.tokens().clone();
        let mut out = Vec::new();
        if let Some(menu) = self.menu(draft) {
            let rows = self.rows(draft, cx);
            let query = parse_token(draft).map(|(_, q, _)| q).unwrap_or_default();
            let active = self.active_row.min(rows.len().saturating_sub(1));
            out.push(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom(gpui::relative(1.))
                    .mb_2()
                    .flex()
                    .flex_col()
                    .max_h(px(260.))
                    .overflow_hidden()
                    .rounded(px(10.))
                    .border_1()
                    .border_color(t.border)
                    .bg(t.popover)
                    .p_1()
                    .shadow_lg()
                    .occlude()
                    .child(
                        div()
                            .id("ai-at-menu")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .pr_1()
                            .children(rows.iter().enumerate().map(|(i, row)| {
                                let key = row.key.clone();
                                div()
                                    .id(SharedString::from(format!("at-{}", row.key)))
                                    .flex()
                                    .h_9()
                                    .w_full()
                                    .items_center()
                                    .gap(px(10.))
                                    .rounded(px(6.))
                                    .px_2()
                                    .cursor_pointer()
                                    .when(i == active, |d| d.bg(t.muted))
                                    .hover(|s| s.bg(with_alpha(t.muted, 0.5)))
                                    .on_click(cx.listener(move |this, _, window, cx| this.pick(&key, window, cx)))
                                    .when(menu == Menu::At, |d| d.child(div().flex().size_5().flex_shrink_0().items_center().justify_center().text_color(t.muted_foreground).child(Icon::new(row.glyph.clone()).size(px(15.)))))
                                    .child(div().flex_shrink_0().text_size(px(12.5)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(row.name.clone()))
                                    .child(truncate(div().flex_1().min_w_0()).tw_text_xs().text_color(t.muted_foreground).child(row.desc.clone()))
                            }))
                            .when(rows.is_empty(), |d| d.child(div().flex().h_9().items_center().px_2().tw_text_xs().text_color(t.muted_foreground).child(format!("No matches for “{query}”")))),
                    )
                    .child(
                        div()
                            .mt_1()
                            .flex_shrink_0()
                            .border_t_1()
                            .border_color(t.border)
                            .px_2()
                            .pt(px(6.))
                            .pb_1()
                            .text_size(px(11.))
                            .text_color(t.muted_foreground)
                            .child(if menu == Menu::At { "Type to search sources & files" } else { "Type to search commands" }),
                    )
                    .into_any_element(),
            );
        }
        if self.model_open {
            let hub = self.hub.read(cx);
            let models = hub.models();
            let selected = hub.selected_model_key();
            let mut list = div()
                .id("ai-model-menu")
                .absolute()
                .left_0()
                .bottom(gpui::relative(1.))
                .mb_2()
                .w_80()
                .max_h(px(260.))
                .overflow_y_scroll()
                .rounded(px(10.))
                .border_1()
                .border_color(t.border)
                .bg(t.popover)
                .p_1()
                .shadow_lg()
                .occlude();
            if models.is_empty() {
                list = list.child(
                    div()
                        .px_2()
                        .py_6()
                        .flex()
                        .flex_col()
                        .items_center()
                        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child("No models available"))
                        .child(div().mt_1().text_size(px(11.)).line_height(px(16.)).text_color(t.muted_foreground).child("Add an API provider in AI Settings. Local CLI agents require the desktop app.")),
                );
            }
            for m in models {
                let on = selected.as_deref() == Some(m.key.as_str());
                let (p, md) = (m.provider.clone(), m.model.clone());
                list = list.child(
                    div()
                        .id(SharedString::from(format!("model-{}", m.key)))
                        .flex()
                        .h_8()
                        .w_full()
                        .items_center()
                        .gap_2()
                        .rounded(px(6.))
                        .px_2()
                        .cursor_pointer()
                        .hover(|s| s.bg(t.muted))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.model_open = false;
                            this.hub.update(cx, |h, cx| h.select_model(&p, &md, cx));
                            this.draft.update(cx, |s, cx| s.focus(window, cx));
                        }))
                        .child(provider_badge(&m.tag, 14., &t))
                        .child(truncate(div().flex_1().min_w_0()).text_size(px(12.5)).font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(m.name.clone()))
                        .child(div().flex_shrink_0().text_size(px(11.)).text_color(t.muted_foreground).child(m.tag.clone()))
                        .child(div().flex_shrink_0().text_color(t.foreground).when(!on, |d| d.invisible()).child(Icon::new(IconName::Check).size(px(13.)))),
                );
            }
            list = list.child(div().my_1().border_t_1().border_color(t.border)).child(
                div()
                    .id("model-settings")
                    .flex()
                    .h_8()
                    .w_full()
                    .items_center()
                    .gap_2()
                    .rounded(px(6.))
                    .px_2()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(t.muted))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.model_open = false;
                        Self::open_settings(cx);
                        cx.notify();
                    }))
                    .child(Icon::new(IconName::Plus).size(px(13.)))
                    .child("AI Settings…"),
            );
            out.push(list.into_any_element());
        }
        out
    }

    fn prompt_bar(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let draft = self.draft_text(cx);
        let hub = self.hub.read(cx);
        let streaming = hub.is_sending;
        let models = hub.models();
        let disabled = models.is_empty();
        let model = hub.selected_model_key().and_then(|k| models.iter().find(|m| m.key == k).cloned());
        let can_send = (!draft.trim().is_empty() || !self.attachments.is_empty()) && !disabled;
        // Emulates the measured "needs full width" switch of the original.
        let wide = draft.contains('\n') || draft.chars().count() > 34;
        let round = if !self.attachments.is_empty() || wide { 24. } else { 999. };
        let plus = div()
            .id("ai-plus")
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size_7()
            .rounded_full()
            .text_color(t.muted_foreground)
            .when(self.plus_open, |d| d.bg(t.muted).text_color(t.foreground))
            .when(disabled, |d| d.opacity(0.4))
            .when(!disabled, |d| d.cursor_pointer().hover(|s| s.bg(t.muted).text_color(t.foreground)))
            .on_click(cx.listener(move |this, _, window, cx| {
                if disabled {
                    return;
                }
                this.model_open = false;
                this.plus_open = !this.plus_open;
                this.draft.update(cx, |s, cx| s.focus(window, cx));
                cx.notify();
            }))
            .child(Icon::new(IconName::Plus).size(px(16.)));
        let model_btn = div()
            .id("ai-model")
            .flex()
            .flex_shrink_0()
            .h_7()
            .items_center()
            .gap(px(6.))
            .px_2()
            .rounded_full()
            .text_size(px(12.))
            .font_weight(FontWeight::MEDIUM)
            .when(streaming, |d| d.opacity(0.4))
            .when(!streaming && model.is_some(), |d| d.cursor_pointer().hover(|s| s.bg(t.muted)))
            .when(!streaming && model.is_none(), |d| d.cursor_pointer())
            .on_click(cx.listener(move |this, _, _, cx| {
                if !streaming {
                    this.plus_open = false;
                    this.model_open = !this.model_open;
                    cx.notify();
                }
            }))
            .children(model.as_ref().map(|m| provider_badge(&m.tag, 14., &t)))
            .child(div().text_color(if model.is_some() { t.foreground } else { with_alpha(t.muted_foreground, 0.7) }).child(model.as_ref().map(|m| m.name.clone()).unwrap_or_else(|| "Select model".into())))
            .child(div().text_color(with_alpha(t.muted_foreground, 0.6)).child(Icon::new(IconName::ChevronDown).size(px(11.))));
        let action = if streaming {
            div()
                .id("ai-stop")
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .size_7()
                .rounded_full()
                .bg(t.destructive)
                .text_color(gpui::white())
                .shadow_sm()
                .cursor_pointer()
                .hover(|s| s.bg(with_alpha(t.destructive, 0.9)))
                .on_click(cx.listener(|this, _, _, cx| this.hub.update(cx, |h, cx| h.stop(cx))))
                .child(div().size(px(10.)).rounded(px(1.)).bg(gpui::white()))
        } else {
            div()
                .id("ai-send")
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .size_7()
                .rounded_full()
                .bg(if can_send { t.foreground } else { t.border })
                .text_color(if can_send { t.background } else { t.muted_foreground })
                .when(!can_send, |d| d.opacity(0.4))
                .when(can_send, |d| d.cursor_pointer())
                .on_click(cx.listener(|this, _, window, cx| this.send(window, cx)))
                .child(Icon::new(IconName::ArrowUp).size(px(16.)))
        };
        let input = div().flex_1().min_w_0().min_h_7().px_1().py(px(5.)).text_size(px(13.)).line_height(px(18.)).when(disabled, |d| d.opacity(0.6)).child(Textarea::new(&self.draft).appearance(false).disabled(disabled));
        let attachments = (!self.attachments.is_empty()).then(|| {
            div().flex().flex_wrap().gap(px(6.)).pt(px(2.)).px_1().children(self.attachments.iter().enumerate().map(|(i, f)| {
                div()
                    .flex()
                    .h_6()
                    .items_center()
                    .gap(px(6.))
                    .bg(t.muted)
                    .py_1()
                    .pr_1()
                    .pl(px(6.))
                    .text_size(px(11.5))
                    .text_color(t.muted_foreground)
                    .shadow_sm()
                    .border_1()
                    .border_color(t.border)
                    .rounded_full()
                    .child(Icon::new(IconName::File).size(px(12.)))
                    .child(truncate(div().max_w(px(144.))).child(f.clone()))
                    .child(
                        div()
                            .id(("ai-att-x", i))
                            .flex()
                            .size_6()
                            .my(px(-4.))
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .cursor_pointer()
                            .hover(|s| s.bg(t.border).text_color(t.foreground))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.attachments.remove(i);
                                cx.notify();
                            }))
                            .child(Icon::new(IconName::X).size(px(10.))),
                    )
            }))
        });
        let controls = if wide {
            div().flex().flex_col().gap(px(6.)).child(input).child(div().flex().items_end().gap_1().child(plus).child(model_btn).child(div().flex_1()).child(action))
        } else {
            div().flex().items_center().gap_1().child(plus).child(input).child(model_btn).child(action)
        };
        let menus = self.render_menus(&draft, cx);
        div()
            .relative()
            .w_full()
            .capture_key_down(cx.listener(Self::on_key))
            .children(menus)
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.8))
                    .bg(t.card)
                    .shadow_sm()
                    .gap(px(6.))
                    .p(px(6.))
                    .rounded(px(round))
                    .children(attachments)
                    .child(controls),
            )
            .into_any_element()
    }
}

struct PermissionDraft(String);

/// `handleSendAiSqlToEditor` / `handleRunAiSql`: the native studio has no
/// global SQL sheet hook from this crate, so the query opens in a new SQL tab
/// (and runs there for "Run").
fn send_to_sql(query: &str, run: bool, cx: &mut App) {
    let id = format!("ai-sql-{}", crate::chat_store::random_id());
    let spec = TabSpec::Query { id, title: "AI Query".into(), sql: query.to_string() };
    rexa_core::open_tab(spec.clone(), cx);
    if run {
        rexa_core::emit_studio(StudioEvent::TabCommand { tab: spec, command: "RUN_ACTIVE_QUERY".into() }, cx);
    }
}

impl Render for AiChat {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let hub = self.hub.read(cx);
        let messages = hub.messages.clone();
        let sending = hub.is_sending;
        let pending = hub.pending_approval.clone();
        if hub.is_sending {
            // Keep the elapsed counter ticking.
            window.request_animation_frame();
        }
        let mut list = div().flex().flex_col().gap_5().mx_auto().max_w(px(672.)).w_full();
        if messages.is_empty() {
            list = list.child(self.empty_state(cx));
        }
        for m in &messages {
            if m.role == "user" {
                list = list.child(
                    div().flex().justify_end().child(
                        div()
                            .max_w(gpui::relative(0.8))
                            .rounded(px(16.))
                            .bg(white(0.08))
                            .px_4()
                            .py(px(10.))
                            .tw_text_sm()
                            .line_height(px(24.))
                            .text_color(t.foreground)
                            .child(m.content.clone()),
                    ),
                );
            } else if !m.content.is_empty() || m.meta_json.is_some() {
                let el = self.message_content(&m.id, &m.content, window, cx);
                list = list.child(el);
            }
        }
        let mut body = div().px_4().pt_4().child(list);
        if let Some((id, qs)) = pending {
            let card = self.approval_card(format!("pending:{id}"), &qs, true, window, cx);
            body = body.child(div().pt_2().pb_2().child(div().mx_auto().max_w(px(672.)).child(card)));
        }
        if sending {
            body = body.child(div().pt(px(if messages.is_empty() { 24. } else { 8. })).pb_2().child(div().mx_auto().max_w(px(672.)).child(self.trace(cx))));
        }
        let header = self.render_header(cx);
        let bar = self.prompt_bar(cx);
        div()
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
            .text_color(t.foreground)
            .child(header)
            .child(div().id("ai-messages").flex_1().min_h_0().overflow_y_scroll().track_scroll(&self.scroll).child(body).child(div().h(px(176.))))
            .child(div().absolute().left_0().right_0().bottom_0().px_3().pb_3().child(bar))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens() {
        assert!(parse_token("hello @us").is_some_and(|(m, q, s)| m == Menu::At && q == "us" && s == 6));
        assert!(parse_token("/ex").is_some_and(|(m, _, _)| m == Menu::Slash));
        assert!(parse_token("a@b").is_none());
        assert!(parse_token("@x.y").is_none());
        assert!(parse_token("hi").is_none());
    }
}
