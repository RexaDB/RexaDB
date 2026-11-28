use crate::{ActiveTokens, Tw};
use gpui::{div, prelude::*, px, App, FontWeight, SharedString, Window};

/// components/ui/kbd.tsx: h-5 min-w-5 rounded-lg px-1 bg-muted text-muted-foreground text-xs font-medium.
#[derive(IntoElement)]
pub struct Kbd {
    text: SharedString,
    px: f32,
}

impl Kbd {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { text: text.into(), px: 4. }
    }

    /// Override horizontal padding (callers often pass `px-1.5`).
    pub fn px(mut self, px: f32) -> Self {
        self.px = px;
        self
    }

    /// "⌘K" on macOS, "Ctrl K" elsewhere.
    pub fn shortcut(key: &str) -> Self {
        Self::new(if cfg!(target_os = "macos") { format!("⌘{key}") } else { format!("Ctrl {key}") })
    }
}

impl RenderOnce for Kbd {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .flex()
            .items_center()
            .justify_center()
            .gap_1()
            .h_5()
            .min_w_5()
            .px(px(self.px))
            .tw_rounded_lg()
            .bg(t.muted)
            .text_color(t.muted_foreground)
            .tw_text_xs()
            .font_weight(FontWeight::MEDIUM)
            .child(self.text)
    }
}
