//! Small form controls:
//! - components/ui/switch.tsx (`Switch`)
//! - components/ui/checkbox.tsx (`Checkbox`)
//! - components/ui/label.tsx (`Label`)
//! - components/ui/textarea.tsx (`TextArea`)
//! - components/ui/password-input.tsx (`PasswordInput`)
//! - components/ui/input-group.tsx (`InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupText`)

use crate::popup;
use crate::theme::with_alpha;
use crate::{ActiveTokens, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnimationExt, AnyElement, App, ClickEvent, ElementId, Entity, Focusable,
    FontWeight, SharedString, Window,
};
use gpui_component::input::{Input, InputState, Textarea, TextareaState};
use gpui_component::Icon;
use std::rc::Rc;
use std::time::Duration;

/// gpui-component's `Input` always pads single-line text by `Size::Medium.input_px()`;
/// the Tailwind wrappers here own the padding, so it is cancelled with a negative margin.
pub const INPUT_PX: f32 = 10.;

type ChangeHandler =Rc<dyn Fn(bool, &mut Window, &mut App)>;

// ---- Switch ------------------------------------------------------------------------

/// `inline-flex h-4 w-7 rounded-lg border border-transparent`, checked `bg-primary`,
/// unchecked `bg-input`; thumb `size-3 bg-white`, `translate-x-3` when checked
/// (transition-transform 150ms).
#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    checked: bool,
    disabled: bool,
    on_change: Option<ChangeHandler>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), checked: false, disabled: false, on_change: None }
    }
    pub fn checked(mut self, c: bool) -> Self {
        self.checked = c;
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// Called with the new value (`onCheckedChange`).
    pub fn on_change(mut self, f: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let checked = self.checked;
        // Animate only when the value changed since the last frame.
        let last = window.use_keyed_state(popup::sub_id(&self.id, "last"), cx, |_, _| checked);
        let changed = *last.read(cx) != checked;
        if changed {
            last.update(cx, |v, _| *v = checked);
        }
        let generation = window.use_keyed_state(popup::sub_id(&self.id, "gen"), cx, |_, _| 0usize);
        if changed {
            generation.update(cx, |g, _| *g += 1);
        }
        let g = *generation.read(cx);
        let thumb = div().size_3().rounded_full().bg(gpui::white());
        let thumb = thumb.with_animation(
            popup::sub_id(&self.id, format!("thumb{g}")),
            gpui::Animation::new(Duration::from_millis(if g == 0 { 0 } else { 150 })).with_easing(popup::css_ease),
            move |d, v| {
                let x = if checked { 12. * v } else { 12. * (1. - v) };
                d.ml(px(x))
            },
        );
        let on_change = self.on_change;
        div()
            .id(self.id)
            .flex()
            .flex_shrink_0()
            .items_center()
            .h_4()
            .w_7()
            .tw_rounded_lg()
            .border_1()
            .border_color(gpui::transparent_black())
            .bg(if checked { t.primary } else { t.input })
            .child(thumb)
            .when(self.disabled, |d| d.opacity(0.5))
            .when(!self.disabled, |d| {
                d.cursor_pointer().when_some(on_change, |d, f| d.on_click(move |_, w, cx| f(!checked, w, cx)))
            })
    }
}

// ---- Checkbox ----------------------------------------------------------------------

/// `h-4 w-4 rounded-lg border border-primary`, checked `bg-primary text-primary-foreground`
/// with a 16px Check.
#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    checked: bool,
    disabled: bool,
    on_change: Option<ChangeHandler>,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), checked: false, disabled: false, on_change: None }
    }
    pub fn checked(mut self, c: bool) -> Self {
        self.checked = c;
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    pub fn on_change(mut self, f: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Checkbox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        let checked = self.checked;
        let on_change = self.on_change;
        div()
            .id(self.id)
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size_4()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.primary)
            .when(checked, |d| {
                d.bg(t.primary)
                    .text_color(t.var_or("--primary-foreground", gpui::white()))
                    .child(Icon::new(IconName::Check).size_4().flex_shrink_0())
            })
            .when(self.disabled, |d| d.opacity(0.5))
            .when(!self.disabled, |d| {
                d.cursor_pointer().when_some(on_change, |d, f| {
                    d.on_click(move |_, w, cx| {
                        cx.stop_propagation();
                        f(!checked, w, cx)
                    })
                })
            })
    }
}

/// multi-select.tsx's square checkbox: `h-4 w-4 rounded-[3px] border`,
/// checked `border-primary bg-primary text-primary-foreground` + Check `h-3 w-3`.
pub fn square_check(checked: bool, cx: &App) -> impl IntoElement {
    let t = cx.tokens();
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .size_4()
        .rounded(px(3.))
        .border_1()
        .border_color(if checked { t.primary } else { t.border })
        .when(checked, |d| {
            d.bg(t.primary)
                .text_color(t.var_or("--primary-foreground", gpui::white()))
                .child(Icon::new(IconName::Check).size_3())
        })
}

// ---- Label -------------------------------------------------------------------------

/// `flex items-center gap-2 text-sm leading-none font-medium select-none`.
#[derive(IntoElement)]
pub struct Label {
    id: Option<ElementId>,
    text: Option<SharedString>,
    children: Vec<AnyElement>,
    disabled: bool,
    on_click: Option<Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>>,
}

impl Label {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { id: None, text: Some(text.into()), children: Vec::new(), disabled: false, on_click: None }
    }
    /// `peer-disabled:opacity-50`
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// `htmlFor`: clicking the label activates its control.
    pub fn on_click(mut self, id: impl Into<ElementId>, f: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.id = Some(id.into());
        self.on_click = Some(Rc::new(f));
        self
    }
}

impl ParentElement for Label {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Label {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let el = div()
            .flex()
            .items_center()
            .gap_2()
            .text_size(px(14.))
            .line_height(px(14.))
            .font_weight(FontWeight::MEDIUM)
            .when(self.disabled, |d| d.opacity(0.5))
            .children(self.children)
            .children(self.text);
        match (self.id, self.on_click) {
            (Some(id), Some(f)) if !self.disabled => el.id(id).cursor_pointer().on_click(move |e, w, cx| f(e, w, cx)).into_any_element(),
            _ => el.into_any_element(),
        }
    }
}

// ---- TextArea ----------------------------------------------------------------------

/// `rounded-lg border border-input dark:bg-input/30 px-2.5 py-2 text-sm min-h-16 w-full`.
/// Create the state with `cx.new(|cx| TextareaState::new(window, cx).auto_grow(3, 12))`.
#[derive(IntoElement)]
pub struct TextArea {
    state: Entity<TextareaState>,
    min_h: f32,
    h: Option<f32>,
    disabled: bool,
    invalid: bool,
}

impl TextArea {
    pub fn new(state: &Entity<TextareaState>) -> Self {
        Self { state: state.clone(), min_h: 64., h: None, disabled: false, invalid: false }
    }
    pub fn min_h(mut self, h: f32) -> Self {
        self.min_h = h;
        self
    }
    pub fn h(mut self, h: f32) -> Self {
        self.h = Some(h);
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// `aria-invalid`
    pub fn invalid(mut self, i: bool) -> Self {
        self.invalid = i;
        self
    }
}

impl RenderOnce for TextArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let focused = self.state.read(cx).focus_handle(cx).is_focused(window);
        div()
            .w_full()
            .min_h(px(self.min_h))
            .when_some(self.h, |d, h| d.h(px(h)))
            // px-2.5 py-2 come from the editor paddings (Medium: 10 / 8).
            .tw_rounded_lg()
            .border_1()
            .border_color(if self.invalid {
                if t.dark { with_alpha(t.destructive, 0.5) } else { t.destructive }
            } else if focused {
                t.border
            } else {
                t.input
            })
            .bg(field_bg(&t, self.disabled))
            .tw_text_sm()
            .when(self.disabled, |d| d.opacity(0.5))
            .child(Textarea::new(&self.state).appearance(false).disabled(self.disabled).h_full())
    }
}

fn field_bg(t: &crate::Tokens, disabled: bool) -> gpui::Hsla {
    if disabled {
        with_alpha(t.input, if t.dark { 0.8 } else { 0.5 })
    } else if t.dark {
        with_alpha(t.input, 0.3)
    } else {
        gpui::transparent_black()
    }
}

// ---- PasswordInput -----------------------------------------------------------------

/// password-input.tsx: an `Input` with `bg-background border-border/60 h-9 pr-8`
/// and an Eye / EyeOff toggle at `right-2` (`h-4 w-4`, muted → foreground on hover).
/// Create the state with `.masked(true)`.
#[derive(IntoElement)]
pub struct PasswordInput {
    id: ElementId,
    state: Entity<InputState>,
    disabled: bool,
}

impl PasswordInput {
    pub fn new(id: impl Into<ElementId>, state: &Entity<InputState>) -> Self {
        Self { id: id.into(), state: state.clone(), disabled: false }
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
}

impl RenderOnce for PasswordInput {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let masked_state = window.use_keyed_state(popup::sub_id(&self.id, "masked"), cx, |_, _| true);
        let masked = *masked_state.read(cx);
        let focused = self.state.read(cx).focus_handle(cx).is_focused(window);
        let state = self.state.clone();
        div()
            .relative()
            .flex()
            .items_center()
            .w_full()
            .h_9()
            .pl(px(10.))
            .pr_8()
            .tw_rounded_lg()
            .border_1()
            .border_color(if focused { t.border } else { with_alpha(t.border, 0.6) })
            .bg(t.background)
            .tw_text_sm()
            .when(self.disabled, |d| d.opacity(0.5))
            .child(div().flex_1().min_w_0().mx(px(-INPUT_PX)).child(Input::new(&self.state).appearance(false).disabled(self.disabled)))
            .child(
                div()
                    .id(self.id)
                    .absolute()
                    .right_2()
                    .cursor_pointer()
                    .text_color(t.muted_foreground)
                    .hover(|s| s.text_color(t.foreground))
                    .child(Icon::new(if masked { IconName::Eye } else { IconName::EyeOff }).size_4())
                    .on_click(move |_, window, cx| {
                        let next = !*masked_state.read(cx);
                        masked_state.update(cx, |m, _| *m = next);
                        state.update(cx, |s, cx| s.set_masked(next, window, cx));
                    }),
            )
    }
}

// ---- InputGroup --------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Default)]
pub enum AddonAlign {
    #[default]
    InlineStart,
    InlineEnd,
    BlockStart,
    BlockEnd,
}

/// `InputGroup`: `h-8 rounded-lg border border-input dark:bg-input/30`, focus →
/// `border-border`; an `InputGroupInput` (borderless) with addons on either side.
#[derive(IntoElement)]
pub struct InputGroup {
    state: Option<Entity<InputState>>,
    textarea: Option<Entity<TextareaState>>,
    addons: Vec<(AddonAlign, AnyElement)>,
    disabled: bool,
    invalid: bool,
    h: Option<f32>,
}

impl InputGroup {
    pub fn new(state: &Entity<InputState>) -> Self {
        Self { state: Some(state.clone()), textarea: None, addons: Vec::new(), disabled: false, invalid: false, h: None }
    }
    /// With an `InputGroupTextarea` (height grows, `flex-col` with block addons).
    pub fn textarea(state: &Entity<TextareaState>) -> Self {
        Self { state: None, textarea: Some(state.clone()), addons: Vec::new(), disabled: false, invalid: false, h: None }
    }
    /// `InputGroupAddon align=…` containing `el` (icons get `size-4`, text muted).
    pub fn addon(mut self, align: AddonAlign, el: impl IntoElement) -> Self {
        self.addons.push((align, el.into_any_element()));
        self
    }
    pub fn start(self, el: impl IntoElement) -> Self {
        self.addon(AddonAlign::InlineStart, el)
    }
    pub fn end(self, el: impl IntoElement) -> Self {
        self.addon(AddonAlign::InlineEnd, el)
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    pub fn invalid(mut self, i: bool) -> Self {
        self.invalid = i;
        self
    }
    pub fn h(mut self, h: f32) -> Self {
        self.h = Some(h);
        self
    }
}

impl RenderOnce for InputGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let focused = self.state.as_ref().map(|s| s.read(cx).focus_handle(cx).is_focused(window)).unwrap_or(false)
            || self.textarea.as_ref().map(|s| s.read(cx).focus_handle(cx).is_focused(window)).unwrap_or(false);
        let block = self.addons.iter().any(|(a, _)| matches!(a, AddonAlign::BlockStart | AddonAlign::BlockEnd))
            || self.textarea.is_some();
        let has_start = self.addons.iter().any(|(a, _)| *a == AddonAlign::InlineStart);
        let has_end = self.addons.iter().any(|(a, _)| *a == AddonAlign::InlineEnd);
        let addon = |align: AddonAlign, el: AnyElement| {
            // text-muted-foreground gap-2 py-1.5 text-sm font-medium flex items-center justify-center
            let d = div()
                .flex()
                .items_center()
                .gap_2()
                .py(px(6.))
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.muted_foreground)
                .child(el);
            match align {
                AddonAlign::InlineStart => d.justify_center().pl_2(),
                AddonAlign::InlineEnd => d.justify_center().pr_2(),
                AddonAlign::BlockStart => d.w_full().justify_start().px(px(10.)).pt_2(),
                AddonAlign::BlockEnd => d.w_full().justify_start().px(px(10.)).pb_2(),
            }
        };
        let mut starts = Vec::new();
        let mut ends = Vec::new();
        for (align, el) in self.addons {
            match align {
                AddonAlign::InlineStart | AddonAlign::BlockStart => starts.push(addon(align, el)),
                AddonAlign::InlineEnd | AddonAlign::BlockEnd => ends.push(addon(align, el)),
            }
        }
        // Control paddings: px-2.5, reduced to 6px next to an inline addon.
        let control = div()
            .flex_1()
            .min_w_0()
            .pl(px(if has_start { 6. } else { 10. }))
            .pr(px(if has_end { 6. } else { 10. }))
            .when(block, |d| d.w_full())
            .when(self.textarea.is_some(), |d| d.mx(px(-10.)))
            .children(self.state.map(|s| div().mx(px(-INPUT_PX)).child(Input::new(&s).appearance(false).disabled(self.disabled)).into_any_element()))
            .children(self.textarea.map(|s| Textarea::new(&s).appearance(false).disabled(self.disabled).into_any_element()));
        div()
            .relative()
            .flex()
            .when(block, |d| d.flex_col())
            .when(!block, |d| d.items_center().h(px(self.h.unwrap_or(32.))))
            .w_full()
            .min_w_0()
            .tw_rounded_lg()
            .border_1()
            .border_color(if self.invalid { t.destructive } else if focused { t.border } else { t.input })
            .bg(field_bg(&t, self.disabled))
            .tw_text_sm()
            .when(self.disabled, |d| d.opacity(0.5))
            .children(starts)
            .child(control)
            .children(ends)
    }
}

/// `InputGroupButton` (size xs): `h-6 gap-1 rounded-[calc(var(--radius)-3px)] px-1.5`, ghost.
pub fn input_group_button(id: impl Into<ElementId>) -> crate::Button {
    crate::Button::new(id).ghost().size(crate::ButtonSize::Xs)
}

/// `InputGroupText`: muted text-sm with gap-2.
pub fn input_group_text(text: impl Into<SharedString>, cx: &App) -> impl IntoElement {
    div().flex().items_center().gap_2().tw_text_sm().text_color(cx.tokens().muted_foreground).child(text.into())
}
