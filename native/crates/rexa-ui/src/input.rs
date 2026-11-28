//! components/ui/input.tsx: h-8 rounded-lg border border-input bg-transparent
//! (dark: bg-input/30) px-2.5 py-1 text-sm, placeholder muted-foreground.
//! Text editing comes from gpui-component's `InputState`; this only supplies the chrome.

use crate::theme::with_alpha;
use crate::{ActiveTokens, Tw};
use gpui::{div, prelude::*, px, AnyElement, App, Entity, Focusable, Window};
use gpui_component::input::{Input, InputState};

#[derive(IntoElement)]
pub struct TextInput {
    state: Entity<InputState>,
    height: f32,
    prefix: Option<AnyElement>,
    suffix: Option<AnyElement>,
    disabled: bool,
}

impl TextInput {
    pub fn new(state: &Entity<InputState>) -> Self {
        Self { state: state.clone(), height: 32., prefix: None, suffix: None, disabled: false }
    }
    pub fn h(mut self, height: f32) -> Self {
        self.height = height;
        self
    }
    pub fn prefix(mut self, el: impl IntoElement) -> Self {
        self.prefix = Some(el.into_any_element());
        self
    }
    pub fn suffix(mut self, el: impl IntoElement) -> Self {
        self.suffix = Some(el.into_any_element());
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
}

impl RenderOnce for TextInput {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let focused = self.state.read(cx).focus_handle(cx).is_focused(window);
        div()
            .flex()
            .items_center()
            .gap_2()
            .w_full()
            .min_w_0()
            .h(px(self.height))
            .px(px(10.))
            .tw_rounded_lg()
            .border_1()
            .border_color(if focused { t.border } else { t.input })
            .bg(if self.disabled {
                with_alpha(t.input, if t.dark { 0.8 } else { 0.5 })
            } else if t.dark {
                with_alpha(t.input, 0.3)
            } else {
                gpui::transparent_black()
            })
            .tw_text_sm()
            .when(self.disabled, |s| s.opacity(0.5))
            .children(self.prefix)
            .child(
                div().flex_1().min_w_0().mx(px(-crate::controls::INPUT_PX)).child(
                    Input::new(&self.state).appearance(false).disabled(self.disabled),
                ),
            )
            .children(self.suffix)
    }
}
