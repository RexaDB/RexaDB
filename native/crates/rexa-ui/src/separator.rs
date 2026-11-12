use crate::ActiveTokens;
use gpui::{div, prelude::*, px, App, Window};

/// components/ui/separator.tsx: 1px bg-border line.
#[derive(IntoElement)]
pub struct Separator {
    vertical: bool,
}

impl Separator {
    pub fn horizontal() -> Self {
        Self { vertical: false }
    }
    pub fn vertical() -> Self {
        Self { vertical: true }
    }
}

impl RenderOnce for Separator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let el = div().flex_shrink_0().bg(cx.tokens().border);
        if self.vertical { el.w(px(1.)).h_full() } else { el.h(px(1.)).w_full() }
    }
}
