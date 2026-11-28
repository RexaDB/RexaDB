//! Small private building blocks shared by the connection screens: the
//! `Input` variants connection-manager.tsx styles with
//! `bg-background border-border/60 h-9`, the segmented toggles
//! (`rounded-lg border border-border/60 bg-muted/40 p-0.5`) and the shared
//! provider-logo rendering (shared/provider-logo.tsx).

use crate::providers;
use gpui::{div, img, prelude::*, px, svg, AnyElement, App, Entity, FontWeight, Focusable, ObjectFit, SharedString, Window};
use gpui_component::input::{Input, InputState};
use rexa_ui::controls::INPUT_PX;
use rexa_ui::theme::with_alpha;
use rexa_ui::{ActiveTokens, Tw, MONO};

/// `<Input className="bg-background border-border/60 h-9 [font-mono]" />`.
#[derive(IntoElement)]
pub struct FieldInput {
    state: Entity<InputState>,
    h: f32,
    mono: bool,
    muted_bg: bool,
    pl: Option<f32>,
}

impl FieldInput {
    pub fn new(state: &Entity<InputState>) -> Self {
        Self { state: state.clone(), h: 36., mono: false, muted_bg: false, pl: None }
    }
    pub fn h(mut self, h: f32) -> Self {
        self.h = h;
        self
    }
    pub fn mono(mut self) -> Self {
        self.mono = true;
        self
    }
    pub fn pl(mut self, pl: f32) -> Self {
        self.pl = Some(pl);
        self
    }
    /// `bg-muted/30 border-border/40` (folder prompt).
    pub fn muted(mut self) -> Self {
        self.muted_bg = true;
        self
    }
}

impl RenderOnce for FieldInput {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let focused = self.state.read(cx).focus_handle(cx).is_focused(window);
        div()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .h(px(self.h))
            .px(px(10.))
            .when_some(self.pl, |d, pl| d.pl(px(pl)))
            .tw_rounded_lg()
            .border_1()
            .border_color(if focused {
                t.border
            } else if self.muted_bg {
                with_alpha(t.border, 0.4)
            } else {
                with_alpha(t.border, 0.6)
            })
            .bg(if self.muted_bg { with_alpha(t.muted, 0.3) } else { t.background })
            .tw_text_sm()
            .when(self.mono, |d| d.font_family(MONO))
            .child(div().flex_1().min_w_0().mx(px(-INPUT_PX)).child(Input::new(&self.state).appearance(false)))
    }
}

/// A segmented two-option toggle. `full` = `grid grid-cols-2 p-1 gap-1` with
/// `rounded-md px-3 py-1.5 text-sm` buttons (PlanetScale/Oracle); otherwise the
/// compact `p-0.5` / `px-3 py-1 text-xs` SSH toggles.
pub fn segmented(
    id: &'static str,
    options: &[(&'static str, bool)],
    large: bool,
    grid: bool,
    on_pick: impl Fn(usize, &mut Window, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens().clone();
    let on_pick = std::rc::Rc::new(on_pick);
    let mut row = div()
        .flex()
        .tw_rounded_lg()
        .border_1()
        .border_color(with_alpha(t.border, 0.6))
        .bg(with_alpha(t.muted, 0.4))
        .p(px(if large { 4. } else { 2. }))
        .when(large, |d| d.gap_1());
    row = if grid { row.w_full() } else { row };
    for (i, (label, active)) in options.iter().enumerate() {
        let on_pick = on_pick.clone();
        let mut b = div()
            .id((id, i))
            .flex()
            .items_center()
            .justify_center()
            .gap_1()
            .border_1()
            .cursor_pointer()
            .font_weight(FontWeight::MEDIUM)
            .when(grid, |d| d.flex_1())
            .on_click(move |_, window, cx| on_pick(i, window, cx));
        b = if large { b.tw_rounded_md().px_3().py(px(6.)).tw_text_sm() } else { b.tw_rounded_lg().px_3().py_1().tw_text_xs() };
        b = if *active {
            b.border_color(with_alpha(t.border, 0.6)).bg(t.background).text_color(t.foreground).when(large, |d| d.shadow_sm())
        } else {
            b.border_color(gpui::transparent_black()).text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground))
        };
        if *label == "Private Key" {
            b = b.child(gpui_component::Icon::new(rexa_ui::IconName::KeyRound).size(px(14.)));
        }
        row = row.child(b.child(*label));
    }
    row.into_any_element()
}

/// `<ProviderLogo type=…>` / the card logo: SpacetimeDB is a currentColor SVG.
pub fn provider_logo(provider: &str, size: f32, cx: &App) -> AnyElement {
    let t = cx.tokens();
    match provider {
        "spacetimedb" => svg().path("brand/spacetimedb.svg").size(px(size)).text_color(t.foreground).into_any_element(),
        "supabase" | "supabase-mgmt" => img("brand/supabase.svg").size(px(size)).into_any_element(),
        "neon" => img("brand/neon.svg").size(px(size)).into_any_element(),
        _ => {
            let logo = providers::card(provider).map_or_else(|| providers::logo_for(provider), |c| c.logo);
            img(logo).size(px(size)).object_fit(ObjectFit::Contain).into_any_element()
        }
    }
}

/// `<Label className="text-sm font-medium">`.
pub fn label(text: impl Into<SharedString>) -> rexa_ui::Label {
    rexa_ui::Label::new(text)
}

/// `p.text-xs.text-muted-foreground`.
pub fn hint(text: impl Into<SharedString>, cx: &App) -> gpui::Div {
    div().tw_text_xs().text_color(cx.tokens().muted_foreground).child(text.into())
}

/// `space-y-2` field wrapper.
pub fn field(label_text: impl Into<SharedString>, input: impl IntoElement) -> gpui::Div {
    div().flex().flex_col().gap_2().child(label(label_text)).child(input)
}

pub fn input_state(window: &mut Window, cx: &mut App, value: &str, placeholder: &str) -> Entity<InputState> {
    let (value, placeholder) = (value.to_string(), placeholder.to_string());
    cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(value))
}

pub fn password_state(window: &mut Window, cx: &mut App, value: &str) -> Entity<InputState> {
    let value = value.to_string();
    cx.new(|cx| InputState::new(window, cx).masked(true).default_value(value))
}

pub fn value(state: &Entity<InputState>, cx: &App) -> String {
    state.read(cx).value().to_string()
}

pub fn set_value(state: &Entity<InputState>, v: &str, window: &mut Window, cx: &mut App) {
    let v = v.to_string();
    state.update(cx, |s, cx| s.set_value(v, window, cx));
}

pub fn focus(state: &Entity<InputState>, window: &mut Window, cx: &mut App) {
    let h = state.read(cx).focus_handle(cx);
    window.focus(&h, cx);
}
