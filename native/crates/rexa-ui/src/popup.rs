//! Shared machinery for Radix-style floating content (Popper): placement
//! (`side` / `align` / `sideOffset`), the open/close state kept per trigger,
//! the open animation and the Tailwind shadows/rings the panels use.
//!
//! Radix animates content with tw-animate-css: `fade-in-0 zoom-in-95
//! slide-in-from-<side>-2` over `duration-100` (`ease`). GPUI can't scale
//! arbitrary elements, so the zoom part is omitted; fade + 8px slide are kept.

use gpui::{
    anchored, canvas, deferred, point, AnimationExt, prelude::*, px, Anchor, AnyElement, App, BoxShadow,
    Bounds, Context, Div, ElementId, FocusHandle, Hsla, Pixels, Point, Window,
};
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Side {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

/// Open/close state of one floating panel, kept with `window.use_keyed_state`.
pub struct PopupState {
    pub open: bool,
    /// Trigger bounds from the last paint.
    pub trigger: Rc<Cell<Bounds<Pixels>>>,
    /// Content bounds from the last paint (for clicks that should not dismiss).
    pub content: Rc<Cell<Bounds<Pixels>>>,
    /// Context menus open at the pointer instead of the trigger.
    pub position: Option<Point<Pixels>>,
    pub focus: FocusHandle,
    prev_focus: Option<FocusHandle>,
    /// Bumped on every open so the entrance animation restarts.
    pub generation: usize,
}

impl PopupState {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            open: false,
            trigger: Rc::new(Cell::new(Bounds::default())),
            content: Rc::new(Cell::new(Bounds::default())),
            position: None,
            focus: cx.focus_handle(),
            prev_focus: None,
            generation: 0,
        }
    }

    pub fn keyed(id: impl Into<ElementId>, window: &mut Window, cx: &mut App) -> gpui::Entity<Self> {
        window.use_keyed_state(id, cx, |_, cx| Self::new(cx))
    }

    pub fn show(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.open {
            self.prev_focus = window.focused(cx);
            self.generation += 1;
        }
        self.open = true;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn hide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.open {
            return;
        }
        self.open = false;
        self.position = None;
        if let Some(prev) = self.prev_focus.take() {
            prev.focus(window, cx);
        }
        cx.notify();
    }

    pub fn toggle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.open { self.hide(window, cx) } else { self.show(window, cx) }
    }
}

/// A child id scoped under `id` (`ElementId::NamedChild`).
pub fn sub_id(id: &ElementId, name: impl std::fmt::Display) -> ElementId {
    ElementId::NamedChild(std::sync::Arc::new(id.clone()), name.to_string().into())
}

/// An invisible child that records its parent's bounds each paint.
/// The parent must be `relative()`.
pub fn bounds_tracker(cell: Rc<Cell<Bounds<Pixels>>>) -> impl IntoElement {
    canvas(move |bounds, _, _| cell.set(bounds), |_, _, _, _| {}).absolute().inset_0()
}

/// Place `panel` next to `target` the way Radix Popper does and wrap it in
/// `deferred(anchored())` so it draws above everything. Flips to the
/// opposite side when it doesn't fit.
pub fn floating(
    target: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    panel: impl IntoElement,
) -> AnyElement {
    let (anchor, corner) = match (side, align) {
        (Side::Bottom, Align::Start) => (Anchor::TopLeft, Anchor::BottomLeft),
        (Side::Bottom, Align::Center) => (Anchor::TopCenter, Anchor::BottomCenter),
        (Side::Bottom, Align::End) => (Anchor::TopRight, Anchor::BottomRight),
        (Side::Top, Align::Start) => (Anchor::BottomLeft, Anchor::TopLeft),
        (Side::Top, Align::Center) => (Anchor::BottomCenter, Anchor::TopCenter),
        (Side::Top, Align::End) => (Anchor::BottomRight, Anchor::TopRight),
        (Side::Right, Align::Start) => (Anchor::TopLeft, Anchor::TopRight),
        (Side::Right, Align::Center) => (Anchor::LeftCenter, Anchor::RightCenter),
        (Side::Right, Align::End) => (Anchor::BottomLeft, Anchor::BottomRight),
        (Side::Left, Align::Start) => (Anchor::TopRight, Anchor::TopLeft),
        (Side::Left, Align::Center) => (Anchor::RightCenter, Anchor::LeftCenter),
        (Side::Left, Align::End) => (Anchor::BottomRight, Anchor::BottomLeft),
    };
    let offset = match side {
        Side::Bottom => point(px(align_offset), px(side_offset)),
        Side::Top => point(px(align_offset), px(-side_offset)),
        Side::Right => point(px(side_offset), px(align_offset)),
        Side::Left => point(px(-side_offset), px(align_offset)),
    };
    deferred(
        anchored()
            .anchor(anchor)
            .attach(target, corner)
            .offset(offset)
            .snap_to_window_with_margin(px(8.))
            .child(panel),
    )
    .priority(1)
    .into_any_element()
}

/// Panel at an absolute window position (context menus).
pub fn floating_at(position: Point<Pixels>, panel: impl IntoElement) -> AnyElement {
    deferred(anchored().position(position).snap_to_window_with_margin(px(8.)).child(panel))
        .priority(1)
        .into_any_element()
}

/// tw-animate-css entrance: fade-in-0 + slide-in-from-<side>-2.
pub fn animate_in(
    el: Div,
    id: impl Into<ElementId>,
    side: Side,
    duration_ms: u64,
) -> impl IntoElement {
    el.with_animation(
        id,
        gpui::Animation::new(Duration::from_millis(duration_ms)).with_easing(css_ease),
        move |el, t| {
            let d = px(8. * (1. - t));
            let el = el.opacity(t);
            match side {
                Side::Bottom => el.mt(-d),
                Side::Top => el.mt(d),
                Side::Right => el.ml(-d),
                Side::Left => el.ml(d),
            }
        },
    )
}

/// CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1).
pub fn css_ease(t: f32) -> f32 {
    cubic_bezier(0.25, 0.1, 0.25, 1.0, t)
}

/// CSS `ease-in-out` = cubic-bezier(0.42, 0, 0.58, 1).
pub fn css_ease_in_out(t: f32) -> f32 {
    cubic_bezier(0.42, 0., 0.58, 1., t)
}

/// Evaluate a CSS cubic-bezier timing function at progress `t`.
pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    let bez = |a: f32, b: f32, s: f32| 3. * a * s * (1. - s).powi(2) + 3. * b * s * s * (1. - s) + s.powi(3);
    // Solve x(s) = t by bisection (monotonic for valid CSS curves).
    let (mut lo, mut hi) = (0f32, 1f32);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.;
        if bez(x1, x2, mid) < t { lo = mid } else { hi = mid }
    }
    bez(y1, y2, (lo + hi) / 2.)
}

// ---- Tailwind shadows ----------------------------------------------------------

fn sh(y: f32, blur: f32, spread: f32, alpha: f32) -> BoxShadow {
    BoxShadow {
        color: gpui::hsla(0., 0., 0., alpha),
        offset: point(px(0.), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
        inset: false,
    }
}

/// `ring-1 ring-<color>`: a 1px box-shadow outside the box (no layout space).
pub fn ring(color: Hsla) -> BoxShadow {
    BoxShadow { color, offset: point(px(0.), px(0.)), blur_radius: px(0.), spread_radius: px(1.), inset: false }
}

pub fn shadow_xs() -> Vec<BoxShadow> {
    vec![sh(1., 2., 0., 0.05)]
}
pub fn shadow_sm() -> Vec<BoxShadow> {
    vec![sh(1., 3., 0., 0.1), sh(1., 2., -1., 0.1)]
}
pub fn shadow_md() -> Vec<BoxShadow> {
    vec![sh(4., 6., -1., 0.1), sh(2., 4., -2., 0.1)]
}
pub fn shadow_lg() -> Vec<BoxShadow> {
    vec![sh(10., 15., -3., 0.1), sh(4., 6., -4., 0.1)]
}
pub fn shadow_2xl() -> Vec<BoxShadow> {
    vec![sh(25., 50., -12., 0.25)]
}

/// Shadows + an outer ring (ring paints above the drop shadows, as in CSS).
pub fn with_ring(mut shadows: Vec<BoxShadow>, color: Hsla) -> Vec<BoxShadow> {
    shadows.push(ring(color));
    shadows
}
