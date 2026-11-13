//! Port of components/app-shell/modern-status-bar.tsx: the 32px footer
//! (connection · database · settings sync · pending changes | Ask AI · Agents ·
//! history · schema cache · Threads).

use crate::icons::{self, Ico};
use crate::studio::Studio;
use gpui::{div, prelude::*, px, AnyElement, Context, Hsla, SharedString};
use rexa_ui::{tw, white, ActiveTokens, Tw};

impl Studio {
    /// itemClass: min-h-6 gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white/8
    fn status_item(&self, id: &str, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        div()
            .id(SharedString::from(format!("status-{id}")))
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(6.))
            .min_h_6()
            .px_2()
            .py_1()
            .rounded(px(6.))
            .tw_text_11()
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(t.muted_foreground)
            .hover(move |s| s.bg(white(0.08)).text_color(t.foreground))
    }

    fn status_sep(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        div().mx(px(2.)).h_3().w(px(1.)).flex_shrink_0().bg(t.border)
    }

    fn status_icon(ico: Ico, color: Hsla) -> impl IntoElement {
        ico.el(12., color)
    }

    pub fn render_status_bar(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let fg = t.muted_foreground;
        let name: SharedString = self.connection.as_ref().map(|c| c.name.clone()).unwrap_or_else(|| "No connection".into()).into();
        let db: SharedString = if self.current_database.is_empty() { "Database".into() } else { self.current_database.clone().into() };
        let dirty = self.tabs.iter().filter(|t| t.is_dirty()).count();

        let pending = if dirty > 0 {
            self.status_item("pending", cx)
                .child(div().size(px(6.)).rounded_full().bg(tw("sky-500")))
                .child(format!("{dirty} unsaved"))
        } else {
            self.status_item("pending", cx).child(Self::status_icon(icons::lucide("check"), fg)).child("No pending changes")
        };

        let left = div()
            .flex()
            .items_center()
            .gap_1()
            .child(
                self.status_item("connection", cx)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, window, cx| this.open_settings(Some("general".into()), window, cx)))
                    .child(div().max_w(px(150.)).overflow_hidden().text_ellipsis().whitespace_nowrap().child(name)),
            )
            .child(self.status_sep(cx))
            .child(
                self.status_item("database", cx)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.sidebar_view = Some("database".into());
                        this.sidebar_visible = true;
                        this.persist(cx);
                    }))
                    .child(Self::status_icon(icons::S_DATABASE, fg))
                    .child(div().max_w(px(140.)).overflow_hidden().text_ellipsis().whitespace_nowrap().child(db)),
            )
            .child(self.status_sep(cx))
            .child(
                // Settings sync needs a signed-in account; locally it is off.
                self.status_item("sync", cx)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.open_simple("profile-settings", cx)))
                    .child(Self::status_icon(icons::lucide("cloud-off"), fg))
                    .child("Settings not synced"),
            )
            .child(self.status_sep(cx))
            .child(pending);

        let ai_open = self.ai_open;
        let threads_open = self.threads_open;
        let syncing = self.fetching_schemas || self.fetching_tables;
        let right = div()
            .ml_auto()
            .flex()
            .min_w_0()
            .items_center()
            .gap_1()
            .child(
                self.status_item("ask-ai", cx)
                    .cursor_pointer()
                    .when(ai_open, |d| d.bg(white(0.08)).text_color(t.foreground))
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_ai(cx)))
                    .child(Self::status_icon(icons::lucide("sparkles"), gpui::Hsla::default()))
                    .child("Ask AI"),
            )
            .child(
                self.status_item("agents", cx)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.open_simple("agents", cx)))
                    .child(Self::status_icon(icons::lucide("bot"), gpui::Hsla::default()))
                    .child("Agents"),
            )
            .child(
                self.status_item("history", cx)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.open_simple("history", cx)))
                    .child(Self::status_icon(icons::lucide("clock"), gpui::Hsla::default())),
            )
            .child(
                self.status_item("schema-cache", cx)
                    .child(Self::status_icon(icons::lucide(if syncing { "loader-circle" } else { "check" }), fg))
                    .child(if syncing { "Schema cache syncing…" } else { "Schema cache ready" }),
            )
            .child(
                self.status_item("threads", cx)
                    .cursor_pointer()
                    .when(threads_open, |d| d.bg(white(0.08)).text_color(t.foreground))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.threads_open = !this.threads_open;
                        cx.notify();
                    }))
                    .child(Self::status_icon(icons::lucide("messages-square"), gpui::Hsla::default()))
                    .child("Threads"),
            );

        div()
            .relative()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_1()
            .min_h_8()
            .px_3()
            .py_1()
            .bg(t.sidebar)
            .child(left)
            .child(right)
            .into_any_element()
    }
}
