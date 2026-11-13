//! Scroll containers with the old app's scrollbars:
//! - [`ScrollArea::radix`] — components/ui/scroll-area.tsx: overlay bar
//!   `w-2.5 border-l border-l-transparent p-[1px]`, thumb `rounded-lg bg-border`,
//!   shown while the pointer is over the area (Radix `type="hover"`) or dragging.
//! - [`ScrollArea::native`] — every other scroll box in the old app gets
//!   globals.css' `::-webkit-scrollbar`: 4px wide, transparent track, thumb
//!   `#27272a` (dark) / `#e2e8f0` (light), 1px transparent border with
//!   `background-clip: content-box` (so 2px visible), radius 20px, always shown
//!   while the content overflows, and it takes its 4px from the layout.
//!
//! ```ignore
//! ScrollArea::native("tables").size_full().child(list)
//! ```

use crate::popup;
use crate::{parse_color, ActiveTokens};
use gpui::{
    div, prelude::*, px, AnyElement, App, Div, ElementId, MouseButton, Pixels, Point, ScrollHandle,
    StyleRefinement, Window,
};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Radix,
    Native,
}

struct ScrollState {
    handle: ScrollHandle,
    hovered: bool,
    /// (pointer y at drag start, scroll offset at drag start)
    drag: Option<(Pixels, Pixels)>,
}

#[derive(IntoElement)]
pub struct ScrollArea {
    id: ElementId,
    kind: Kind,
    root: Div,
    children: Vec<AnyElement>,
    handle: Option<ScrollHandle>,
}

impl ScrollArea {
    pub fn radix(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), kind: Kind::Radix, root: div(), children: Vec::new(), handle: None }
    }
    pub fn native(id: impl Into<ElementId>) -> Self {
        Self { kind: Kind::Native, ..Self::radix(id) }
    }
    /// Use your own handle (to scroll programmatically).
    pub fn track_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.handle = Some(handle.clone());
        self
    }
}

impl Styled for ScrollArea {
    fn style(&mut self) -> &mut StyleRefinement {
        self.root.style()
    }
}

impl ParentElement for ScrollArea {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for ScrollArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let given = self.handle.clone();
        let state = window.use_keyed_state(popup::sub_id(&self.id, "scroll"), cx, move |_, _| ScrollState {
            handle: given.unwrap_or_default(),
            hovered: false,
            drag: None,
        });
        let (handle, hovered, dragging) = {
            let s = state.read(cx);
            (s.handle.clone(), s.hovered, s.drag.is_some())
        };
        let bounds = handle.bounds();
        // Geometry is known only after the first paint.
        if bounds.size.height <= px(0.) {
            window.request_animation_frame();
        }
        let max = handle.max_offset().y;
        let offset = -handle.offset().y;
        let overflowing = max > px(0.5);
        let view_h = bounds.size.height;

        let (bar_w, inset, thumb_color, min_len) = match self.kind {
            Kind::Radix => (10., 1., t.border, 18.),
            Kind::Native => (
                4.,
                1.,
                parse_color(if t.dark { "#27272a" } else { "#e2e8f0" }).unwrap_or(t.border),
                18.,
            ),
        };
        let show = overflowing && (self.kind == Kind::Native || hovered || dragging);
        let track_h = f32::from(view_h) - 2. * inset;
        let content_h = f32::from(view_h + max);
        let thumb_h = (track_h * f32::from(view_h) / content_h.max(1.)).max(min_len).min(track_h);
        let thumb_top = inset + if max > px(0.) { (track_h - thumb_h) * f32::from(offset) / f32::from(max) } else { 0. };

        let st_scroll = state.clone();
        let st_hover = state.clone();
        let st_move = state.clone();
        let st_up = state.clone();
        let scale = if track_h - thumb_h > 0. { f32::from(max) / (track_h - thumb_h) } else { 0. };
        let viewport = div()
            .id(popup::sub_id(&self.id, "viewport"))
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&handle)
            // Native scrollbars take their width from the content box.
            .when(self.kind == Kind::Native && overflowing, |d| d.pr(px(bar_w)))
            .on_scroll(move |_, _, cx| st_scroll.update(cx, |_, cx| cx.notify()))
            .children(self.children);
        let bar = show.then(|| {
            let st_down = state.clone();
            let h = handle.clone();
            let thumb = div()
                .id(popup::sub_id(&self.id, "thumb"))
                .absolute()
                .top(px(thumb_top))
                .left(px(if self.kind == Kind::Radix { 2. } else { 1. }))
                .right(px(inset))
                .h(px(thumb_h))
                .rounded(px(if self.kind == Kind::Radix { 10. } else { 20. }))
                .bg(thumb_color)
                .on_mouse_down(MouseButton::Left, move |e, _, cx| {
                    let start = -h.offset().y;
                    st_down.update(cx, |s, cx| {
                        s.drag = Some((e.position.y, start));
                        cx.notify();
                    });
                    cx.stop_propagation();
                });
            div().absolute().top_0().right_0().bottom_0().w(px(bar_w)).child(thumb)
        });
        self.root
            .id(self.id.clone())
            .relative()
            .overflow_hidden()
            .on_hover(move |h, _, cx| {
                st_hover.update(cx, |s, cx| {
                    s.hovered = *h;
                    cx.notify();
                })
            })
            .on_mouse_move(move |e, _, cx| {
                let Some((y0, off0)) = st_move.read(cx).drag else { return };
                let handle = st_move.read(cx).handle.clone();
                let max = handle.max_offset().y;
                let next = (off0 + (e.position.y - y0) * scale).clamp(px(0.), max);
                handle.set_offset(Point { x: handle.offset().x, y: -next });
                st_move.update(cx, |_, cx| cx.notify());
            })
            .on_mouse_up(MouseButton::Left, move |_, _, cx| {
                st_up.update(cx, |s, cx| {
                    s.drag = None;
                    cx.notify();
                })
            })
            .child(viewport)
            .children(bar)
    }
}
