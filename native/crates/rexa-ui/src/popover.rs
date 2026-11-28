//! Port of components/ui/popover.tsx: `PopoverContent` is
//! `w-72 rounded-lg border bg-popover p-4 shadow-md`, align center, sideOffset 4.
//! The trigger toggles on click; outside press and Esc close it.
//!
//! ```ignore
//! Popover::new("filters")
//!     .trigger(Button::new("f").outline().label("Filters"))
//!     .content(|ctl, _, _| div().child("…").child(Button::new("x").on_click({ let ctl = ctl.clone(); move |_, w, cx| ctl.close(w, cx) })))
//! ```

use crate::popup::{self, Align, PopupState, Side};
use crate::{ActiveTokens, Tw};
use gpui::{div, prelude::*, px, AnyElement, App, ElementId, Entity, MouseButton, Window};
use std::rc::Rc;

/// Lets popover content close (or check) its popover.
#[derive(Clone)]
pub struct PopoverCtl(Entity<PopupState>);

impl PopoverCtl {
    pub fn close(&self, window: &mut Window, cx: &mut App) {
        self.0.update(cx, |s, cx| s.hide(window, cx));
    }
    pub fn is_open(&self, cx: &App) -> bool {
        self.0.read(cx).open
    }
}

type Content = Rc<dyn Fn(&PopoverCtl, &mut Window, &mut App) -> AnyElement>;

#[derive(IntoElement)]
pub struct Popover {
    id: ElementId,
    trigger: Option<Box<dyn FnOnce(bool) -> AnyElement>>,
    content: Option<Content>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    w: Option<f32>,
    match_trigger_width: bool,
    padding: f32,
    full_width: bool,
}

impl Popover {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            trigger: None,
            content: None,
            side: Side::Bottom,
            align: Align::Center,
            side_offset: 4.,
            align_offset: 0.,
            w: Some(288.),
            match_trigger_width: false,
            padding: 16.,
            full_width: false,
        }
    }
    pub fn trigger(mut self, el: impl IntoElement + 'static) -> Self {
        self.trigger = Some(Box::new(move |_| el.into_any_element()));
        self
    }
    pub fn trigger_with<E: IntoElement>(mut self, f: impl FnOnce(bool) -> E + 'static) -> Self {
        self.trigger = Some(Box::new(move |open| f(open).into_any_element()));
        self
    }
    pub fn content<E: IntoElement>(mut self, f: impl Fn(&PopoverCtl, &mut Window, &mut App) -> E + 'static) -> Self {
        self.content = Some(Rc::new(move |c, w, cx| f(c, w, cx).into_any_element()));
        self
    }
    pub fn side(mut self, s: Side) -> Self {
        self.side = s;
        self
    }
    pub fn align(mut self, a: Align) -> Self {
        self.align = a;
        self
    }
    pub fn side_offset(mut self, o: f32) -> Self {
        self.side_offset = o;
        self
    }
    pub fn align_offset(mut self, o: f32) -> Self {
        self.align_offset = o;
        self
    }
    /// Content width (default `w-72`); `None` sizes to content.
    pub fn w(mut self, w: Option<f32>) -> Self {
        self.w = w;
        self
    }
    /// `w-[var(--radix-popover-trigger-width)]`
    pub fn match_trigger_width(mut self) -> Self {
        self.match_trigger_width = true;
        self
    }
    /// Content padding (default `p-4`; `p-0` for lists).
    pub fn p(mut self, p: f32) -> Self {
        self.padding = p;
        self
    }
    pub fn w_full(mut self) -> Self {
        self.full_width = true;
        self
    }
}

impl RenderOnce for Popover {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = PopupState::keyed(self.id.clone(), window, cx);
        let (open, generation, bounds, focus) = {
            let s = state.read(cx);
            (s.open, s.generation, s.trigger.clone(), s.focus.clone())
        };
        let st = state.clone();
        let mut el = div()
            .id(self.id.clone())
            .relative()
            .flex_shrink_0()
            .when(self.full_width, |d| d.w_full())
            .child(popup::bounds_tracker(bounds.clone()))
            .children(self.trigger.map(|f| f(open)))
            .on_click(move |_, window, cx| st.update(cx, |s, cx| s.toggle(window, cx)));
        if let (true, Some(content)) = (open, self.content) {
            let t = cx.tokens().clone();
            let ctl = PopoverCtl(state.clone());
            let body = content(&ctl, window, cx);
            let width = if self.match_trigger_width { Some(f32::from(bounds.get().size.width)) } else { self.w };
            let (st_out, st_key) = (state.clone(), state.clone());
            let trigger = bounds.clone();
            let panel = div()
                .id("popover-content")
                .track_focus(&focus)
                .when_some(width, |d, w| d.w(px(w)))
                .p(px(self.padding))
                .tw_rounded_lg()
                .border_1()
                .border_color(t.border)
                .bg(t.popover)
                .text_color(t.var_or("--popover-foreground", t.foreground))
                .shadow(popup::shadow_md())
                .occlude()
                .child(body)
                .on_key_down(move |e, window, cx| {
                    if e.keystroke.key == "escape" {
                        st_key.update(cx, |s, cx| s.hide(window, cx));
                        cx.stop_propagation();
                    }
                })
                .on_mouse_down_out(move |e, window, cx| {
                    if !trigger.get().contains(&e.position) {
                        st_out.update(cx, |s, cx| s.hide(window, cx));
                    }
                })
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation());
            let panel = popup::animate_in(div().child(panel), popup::sub_id(&self.id, generation), self.side, 150);
            el = el.child(popup::floating(bounds.get(), self.side, self.align, self.side_offset, self.align_offset, panel));
        }
        el
    }
}
