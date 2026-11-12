//! components/ui/badge.tsx
use crate::theme::{tw, white, with_alpha};
use crate::{ActiveTokens, Tw};
use gpui::{div, prelude::*, px, App, FontWeight, Hsla, SharedString, Window};

#[derive(Clone, Copy, PartialEq, Default)]
pub enum BadgeVariant {
    #[default]
    Default,
    Secondary,
    Destructive,
    Outline,
    Success,
    Warning,
    Info,
    Ghost,
}

#[derive(IntoElement)]
pub struct Badge {
    text: SharedString,
    variant: BadgeVariant,
}

impl Badge {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { text: text.into(), variant: BadgeVariant::Default }
    }
    pub fn variant(mut self, v: BadgeVariant) -> Self {
        self.variant = v;
        self
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        let d = t.dark;
        let (border, bg, fg): (Hsla, Hsla, Hsla) = match self.variant {
            BadgeVariant::Default => (with_alpha(t.primary, if d { 0.3 } else { 0.25 }), with_alpha(t.primary, if d { 0.2 } else { 0.15 }), t.primary),
            BadgeVariant::Secondary if d => (white(0.1), white(0.06), tw("neutral-300")),
            BadgeVariant::Secondary => (t.border, with_alpha(t.muted, 0.6), t.muted_foreground),
            BadgeVariant::Destructive => (with_alpha(t.destructive, if d { 0.3 } else { 0.25 }), with_alpha(t.destructive, if d { 0.2 } else { 0.15 }), t.destructive),
            BadgeVariant::Outline if d => (white(0.12), white(0.04), tw("neutral-300")),
            BadgeVariant::Outline => (t.border, with_alpha(t.muted, 0.4), t.muted_foreground),
            BadgeVariant::Success if d => (with_alpha(tw("emerald-400"), 0.2), with_alpha(tw("emerald-400"), 0.15), tw("emerald-300")),
            BadgeVariant::Success => (with_alpha(tw("emerald-500"), 0.25), with_alpha(tw("emerald-500"), 0.15), tw("emerald-700")),
            BadgeVariant::Warning if d => (with_alpha(tw("amber-400"), 0.2), with_alpha(tw("amber-400"), 0.15), tw("amber-200")),
            BadgeVariant::Warning => (with_alpha(tw("amber-500"), 0.25), with_alpha(tw("amber-500"), 0.15), tw("amber-700")),
            BadgeVariant::Info if d => (with_alpha(tw("violet-400"), 0.2), with_alpha(tw("violet-400"), 0.15), tw("violet-300")),
            BadgeVariant::Info => (with_alpha(tw("violet-500"), 0.25), with_alpha(tw("violet-500"), 0.15), tw("violet-700")),
            BadgeVariant::Ghost => (gpui::transparent_black(), gpui::transparent_black(), t.foreground),
        };
        // h-6 gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .gap(px(6.))
            .h_6()
            .px_3()
            .rounded_full()
            .border_1()
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .tw_text_xs()
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .overflow_hidden()
            .child(self.text)
    }
}
