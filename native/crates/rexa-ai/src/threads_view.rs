//! Port of components/studio/ai/ai-threads-sidebar.tsx (+ lib/format-relative.ts
//! for the "5m ago" labels). Selecting a thread opens it in the AI chat panel
//! through the shared [`AiHub`].

use crate::chat_store::now_ms;
use crate::hub::AiHub;
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, SharedString, Subscription, Window};
use gpui_component::Icon;
use rexa_core::{StudioEvent, TabSpec};
use rexa_ui::{white, with_alpha, ActiveTokens, IconName, Tooltip, Tw};
use serde_json::json;

/// `formatRelativeTime(ts, { suffix: " ago", nowLabel: "just now" })`.
pub fn format_relative(ts: u64, now: u64) -> String {
    let secs = now.saturating_sub(ts) / 1000;
    if secs < 60 {
        return "just now".into();
    }
    let mins = secs / 60;
    if mins < 60 {
        return format!("{mins}m ago");
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    if days < 7 {
        return format!("{days}d ago");
    }
    // `toLocaleDateString()` (en-US: M/D/YYYY; UTC date).
    let (y, m, d) = civil_from_days((ts / 86_400_000) as i64);
    format!("{m}/{d}/{y}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

pub struct AiThreads {
    hub: Entity<AiHub>,
    _sub: Subscription,
}

impl AiThreads {
    pub fn new(hub: Entity<AiHub>, cx: &mut Context<Self>) -> Self {
        let sub = cx.observe(&hub, |_, _, cx| cx.notify());
        hub.update(cx, |h, cx| h.load_chats(cx));
        AiThreads { hub, _sub: sub }
    }

    fn open_chat_panel(&self, cx: &mut Context<Self>) {
        let id = self.hub.read(cx).connection_id;
        rexa_core::open_tab(TabSpec::View { view: "ai-chat".into(), params: json!({"connectionId": id}) }, cx);
    }
}

impl Render for AiThreads {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let hub = self.hub.read(cx);
        let chats = hub.chats.clone();
        let active = hub.active_chat_id.clone();
        let loading = hub.threads_loading;
        let connection_id = hub.connection_id;
        let header_btn = |id: &'static str, icon: IconName, tip: &'static str, f: Box<dyn Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App)>| {
            Tooltip::new(tip).side(rexa_ui::Side::Bottom).child(
                div()
                    .id(id)
                    .on_click(f)
                    .flex()
                    .items_center()
                    .justify_center()
                    .size_7()
                    .tw_rounded_md()
                    .text_color(t.muted_foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(white(0.08)).text_color(t.foreground))
                    .child(Icon::new(icon).size(px(14.))),
            )
        };
        let now = now_ms();
        let body = if loading && chats.is_empty() {
            div()
                .flex()
                .size_full()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_2()
                .px_4()
                .py_10()
                .child(Icon::new(IconName::RefreshCw).size(px(16.)).text_color(with_alpha(t.muted_foreground, 0.6)))
                .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child("Loading threads…"))
        } else if chats.is_empty() {
            div()
                .flex()
                .size_full()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_2()
                .px_4()
                .py_10()
                .child(Icon::new(IconName::RotateCcwClock).size(px(20.)).text_color(with_alpha(t.muted_foreground, 0.4)))
                .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child("No threads yet. Ask the AI something to get started."))
        } else {
            div().flex().flex_col().gap(px(2.)).children(chats.into_iter().map(|chat| {
                let is_active = active.as_deref() == Some(chat.id.as_str());
                let (sel, del) = (chat.id.clone(), chat.id.clone());
                let group = SharedString::from(format!("thread-{}", chat.id));
                div()
                    .relative()
                    .group(group.clone())
                    .child(
                        div()
                            .id(SharedString::from(format!("thread-row-{}", chat.id)))
                            .flex()
                            .w_full()
                            .items_start()
                            .gap_2()
                            .tw_rounded_md()
                            .border_1()
                            .border_color(if is_active { t.border } else { gpui::transparent_black() })
                            .px_2()
                            .py(px(6.))
                            .cursor_pointer()
                            .when(is_active, |d| d.bg(white(0.08)).text_color(t.foreground))
                            .when(!is_active, |d| d.hover(|s| s.bg(white(0.05))))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.hub.update(cx, |h, cx| h.select_chat(&sel, cx));
                                this.open_chat_panel(cx);
                            }))
                            .child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .flex_col()
                                    .gap(px(2.))
                                    .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_xs().font_weight(FontWeight::MEDIUM).child(if chat.title.is_empty() { "New chat".to_string() } else { chat.title.clone() }))
                                    .child(div().tw_text_10().text_color(with_alpha(t.muted_foreground, 0.6)).child(format_relative(chat.updated_at, now))),
                            ),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("thread-del-{}", chat.id)))
                            .absolute()
                            .right(px(6.))
                            .top(px(8.))
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .flex()
                            .size_5()
                            .items_center()
                            .justify_center()
                            .tw_rounded_md()
                            .text_color(with_alpha(t.muted_foreground, 0.6))
                            .cursor_pointer()
                            .hover(|s| s.bg(white(0.08)).text_color(t.destructive))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let res = this.hub.update(cx, |h, cx| h.remove_chat(&del, cx));
                                if let Err(e) = res {
                                    rexa_ui::toast::error(format!("Failed to delete chat. {e}"), cx);
                                }
                            }))
                            .child(Icon::new(IconName::Trash).size(px(12.))),
                    )
            }))
        };
        let count = self.hub.read(cx).chats.len();
        div()
            .flex()
            .size_full()
            .min_h_0()
            .flex_col()
            .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
            .text_color(t.foreground)
            .child(
                div()
                    .flex()
                    .h(px(44.))
                    .flex_shrink_0()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(t.border)
                    .px_2()
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .px(px(6.))
                            .child(Icon::new(IconName::RotateCcwClock).size(px(14.)).text_color(t.muted_foreground))
                            .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Threads"))
                            .when(count > 0, |d| d.child(div().rounded_full().bg(white(0.08)).px(px(6.)).tw_text_10().text_color(t.muted_foreground).child(count.to_string()))),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.))
                            .child(header_btn("threads-refresh", IconName::RefreshCw, "Refresh", Box::new(cx.listener(|this, _, _, cx| this.hub.update(cx, |h, cx| h.load_chats(cx))))))
                            .child(header_btn("threads-new", IconName::Plus, "New chat", Box::new(cx.listener(|this, _, _, cx| {
                                this.hub.update(cx, |h, cx| h.start_new_chat(cx));
                                this.open_chat_panel(cx);
                            }))))
                            .child(header_btn("threads-close", IconName::X, "Close", Box::new(move |_, _, cx| {
                                rexa_core::emit_studio(StudioEvent::CloseTab(TabSpec::View { view: "ai-threads".into(), params: json!({"connectionId": connection_id}) }), cx);
                            }))),
                    ),
            )
            .child(div().id("threads-list").flex_1().min_h_0().overflow_y_scroll().p(px(6.)).child(body))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn relative() {
        let now = 10_000_000_000;
        assert_eq!(super::format_relative(now - 5_000, now), "just now");
        assert_eq!(super::format_relative(now - 5 * 60_000, now), "5m ago");
        assert_eq!(super::format_relative(now - 3 * 3_600_000, now), "3h ago");
        assert_eq!(super::format_relative(now - 2 * 86_400_000, now), "2d ago");
        assert_eq!(super::format_relative(0, now), "1/1/1970");
    }
}
