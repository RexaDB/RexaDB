//! Port of components/ui/tooltip.tsx and components/studio/studio-tooltip.tsx.
//!
//! ```ignore
//! Tooltip::new("Refresh").child(Button::new("r").ghost().icon(IconName::RefreshCw))
//! Tooltip::studio("New query").side(Side::Right).child(rail_button)   // StudioTooltip
//! Tooltip::new("Run").kbd("⌘↵").child(...)                            // with a Kbd
//! ```
//! Radix behaviour: shows after the provider delay (0ms; StudioTooltip 120ms),
//! hides on pointer leave and on pointer down. Side `top`/center by default.
//!
//! Approximation: the Radix arrow (a bordered, rotated 10px square) is drawn
//! as a plain popover-coloured triangle poking 5px out; `zoom-in-95` is omitted.

use crate::popup::{self, Align, PopupState, Side};
use crate::{ActiveTokens, Kbd, Tw};
use gpui::{
    div, prelude::*, px, svg, AnyElement, App, ElementId, MouseButton, SharedString, Window,
};
use std::time::Duration;

#[derive(IntoElement)]
pub struct Tooltip {
    id: Option<ElementId>,
    label: Option<SharedString>,
    content: Option<AnyElement>,
    kbd: Option<SharedString>,
    side: Side,
    align: Align,
    side_offset: Option<f32>,
    delay_ms: u64,
    studio: bool,
    arrow: bool,
    children: Vec<AnyElement>,
    disabled: bool,
    force_open: bool,
}

impl Tooltip {
    /// `<Tooltip><TooltipTrigger/><TooltipContent>label</TooltipContent></Tooltip>`
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            id: None,
            label: Some(label.into()),
            content: None,
            kbd: None,
            side: Side::Top,
            align: Align::Center,
            side_offset: None,
            delay_ms: 0,
            studio: false,
            arrow: true,
            children: Vec::new(),
            disabled: false,
            force_open: false,
        }
    }
    /// `StudioTooltip`: bg-card, px-2 py-1, no arrow, side bottom, sideOffset 6, 120ms delay.
    pub fn studio(label: impl Into<SharedString>) -> Self {
        Self { studio: true, arrow: false, side: Side::Bottom, side_offset: Some(6.), delay_ms: 120, ..Self::new(label) }
    }
    /// Rich content instead of a text label.
    pub fn content(mut self, el: impl IntoElement) -> Self {
        self.content = Some(el.into_any_element());
        self
    }
    /// Trailing `<Kbd>` (content gets `pr-1.5`).
    pub fn kbd(mut self, k: impl Into<SharedString>) -> Self {
        self.kbd = Some(k.into());
        self
    }
    /// Explicit id (needed when several tooltips share one parent and label).
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
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
        self.side_offset = Some(o);
        self
    }
    pub fn delay(mut self, ms: u64) -> Self {
        self.delay_ms = ms;
        self
    }
    /// `hideArrow`
    pub fn hide_arrow(mut self) -> Self {
        self.arrow = false;
        self
    }
    /// Always shown (gallery previews).
    pub fn force_open(mut self) -> Self {
        self.force_open = true;
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
}

impl ParentElement for Tooltip {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Tooltip {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let id = self.id.clone().unwrap_or_else(|| {
            ElementId::Name(format!("tooltip:{}", self.label.as_deref().unwrap_or("")).into())
        });
        let state = PopupState::keyed(id.clone(), window, cx);
        let (open, generation, bounds) = {
            let s = state.read(cx);
            (s.open, s.generation, s.trigger.clone())
        };
        let t = cx.tokens().clone();
        let delay = self.delay_ms;
        let st = state.clone();
        let mut el = div()
            .id(id.clone())
            .relative()
            .flex_shrink_0()
            .child(popup::bounds_tracker(bounds.clone()))
            .children(self.children);
        if self.disabled {
            return el;
        }
        el = el
            .on_hover(move |hovered, _, cx| {
                let st = st.clone();
                if !*hovered {
                    st.update(cx, |s, cx| {
                        s.open = false;
                        s.position = None;
                        cx.notify();
                    });
                    return;
                }
                // `position` marks "pointer is in"; the delay re-checks it.
                st.update(cx, |s, _| s.position = Some(Default::default()));
                let show = move |cx: &mut App| {
                    st.update(cx, |s, cx| {
                        if s.position.is_some() && !s.open {
                            s.open = true;
                            s.generation += 1;
                            cx.notify();
                        }
                    })
                };
                if delay == 0 {
                    show(cx);
                } else {
                    cx.spawn(async move |cx| {
                        cx.background_executor().timer(Duration::from_millis(delay)).await;
                        cx.update(show);
                    })
                    .detach();
                }
            })
            .on_mouse_down(MouseButton::Left, {
                let st = state.clone();
                move |_, _, cx| {
                    st.update(cx, |s, cx| {
                        s.open = false;
                        s.position = None;
                        cx.notify();
                    })
                }
            });
        if open || self.force_open {
            let text = self.content.unwrap_or_else(|| self.label.clone().unwrap_or_default().into_any_element());
            let has_kbd = self.kbd.is_some();
            let panel = if self.studio {
                // rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md
                div().px_2().py_1().bg(t.card).text_color(t.foreground)
            } else {
                // rounded-lg bg-popover px-3 py-1.5 text-xs border shadow-md max-w-xs gap-1.5
                div()
                    .px_3()
                    .py(px(6.))
                    .when(has_kbd, |d| d.pr(px(6.)))
                    .bg(t.popover)
                    .text_color(t.var_or("--popover-foreground", t.foreground))
            }
            .relative()
            .flex()
            .items_center()
            .gap(px(6.))
            .max_w(px(320.))
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .shadow(popup::shadow_md())
            .tw_text_xs()
            .child(text)
            .children(self.kbd.map(Kbd::new));
            let panel = if self.arrow { panel.child(arrow(self.side, t.popover)) } else { panel };
            // Radix adds the arrow's size (10px) to sideOffset.
            let offset = self.side_offset.unwrap_or(0.) + if self.arrow { 10. } else { 0. };
            let panel = popup::animate_in(panel, popup::sub_id(&id, generation), self.side, 150);
            el = el.child(popup::floating(bounds.get(), self.side, self.align, offset, 0., panel));
        }
        el
    }
}

fn arrow(side: Side, color: gpui::Hsla) -> impl IntoElement {
    let el = svg().path(match side {
        Side::Top => "ui/arrow-down.svg",
        Side::Bottom => "ui/arrow-up.svg",
        Side::Left => "ui/arrow-right.svg",
        Side::Right => "ui/arrow-left.svg",
    });
    let (w, h) = if matches!(side, Side::Top | Side::Bottom) { (10., 5.) } else { (5., 10.) };
    let el = el.absolute().w(px(w)).h(px(h)).text_color(color);
    match side {
        Side::Top => el.bottom(px(-6.)).left(gpui::relative(0.5)).ml(px(-5.)),
        Side::Bottom => el.top(px(-6.)).left(gpui::relative(0.5)).ml(px(-5.)),
        Side::Left => el.right(px(-6.)).top(gpui::relative(0.5)).mt(px(-5.)),
        Side::Right => el.left(px(-6.)).top(gpui::relative(0.5)).mt(px(-5.)),
    }
}
