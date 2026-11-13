//! Port of the `sonner` toaster as configured in app/layout.tsx
//! (`position="bottom-right"`, `.rexa-toast*` classes from globals.css) with
//! sonner 2's own geometry: 356px wide, 24px viewport offset, 14px gap, 3
//! visible, 4s lifetime, collapsed stack that expands on hover (pausing the
//! timers), 400ms enter slide, 200ms exit.
//!
//! ```ignore
//! rexa_ui::toast::success("Saved", cx);
//! Toast::error("Query failed").description(err.to_string()).show(cx);
//! let id = Toast::loading("Exporting…").show(cx);
//! Toast::success("Exported").id(id).show(cx); // replaces the loading toast
//! ```
//!
//! Approximation: sonner's CSS transitions of the *other* toasts when the
//! stack changes are not animated (they move instantly); the stacked scale is
//! emulated by shrinking the card around its centre.

use crate::popup::{self, bounds_tracker};
use crate::theme::mix;
use crate::{ActiveTokens, Tw};
use gpui::{
    div, prelude::*, px, svg, AnimationExt, AnyElement, App, AppContext, Bounds, Entity,
    FontWeight, Global, Pixels, SharedString, Window,
};
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

const WIDTH: f32 = 356.;
const OFFSET: f32 = 24.;
const GAP: f32 = 14.;
const VISIBLE: usize = 3;
const LIFETIME: Duration = Duration::from_millis(4000);
const EXIT: Duration = Duration::from_millis(200);

pub type ToastId = usize;
type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ToastKind {
    Default,
    Success,
    Error,
    Warning,
    Info,
    Loading,
}

/// `toast(...)` options.
pub struct Toast {
    id: Option<ToastId>,
    kind: ToastKind,
    title: SharedString,
    description: Option<SharedString>,
    action: Option<(SharedString, Handler)>,
    cancel: Option<(SharedString, Handler)>,
    duration: Option<Duration>,
}

impl Toast {
    pub fn new(kind: ToastKind, title: impl Into<SharedString>) -> Self {
        Self { id: None, kind, title: title.into(), description: None, action: None, cancel: None, duration: None }
    }
    pub fn message(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Default, t)
    }
    pub fn success(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Success, t)
    }
    pub fn error(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Error, t)
    }
    pub fn warning(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Warning, t)
    }
    pub fn info(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Info, t)
    }
    /// `toast.loading` — stays until replaced (`.id(id)`) or dismissed.
    pub fn loading(t: impl Into<SharedString>) -> Self {
        Self::new(ToastKind::Loading, t)
    }
    /// Update an existing toast in place (sonner's `{ id }` option).
    pub fn id(mut self, id: ToastId) -> Self {
        self.id = Some(id);
        self
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    pub fn action(mut self, label: impl Into<SharedString>, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.action = Some((label.into(), Rc::new(f)));
        self
    }
    pub fn cancel(mut self, label: impl Into<SharedString>, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.cancel = Some((label.into(), Rc::new(f)));
        self
    }
    pub fn duration(mut self, d: Duration) -> Self {
        self.duration = Some(d);
        self
    }
    pub fn show(self, cx: &mut App) -> ToastId {
        show(self, cx)
    }
}

pub fn success(t: impl Into<SharedString>, cx: &mut App) -> ToastId {
    Toast::success(t).show(cx)
}
pub fn error(t: impl Into<SharedString>, cx: &mut App) -> ToastId {
    Toast::error(t).show(cx)
}
pub fn warning(t: impl Into<SharedString>, cx: &mut App) -> ToastId {
    Toast::warning(t).show(cx)
}
pub fn info(t: impl Into<SharedString>, cx: &mut App) -> ToastId {
    Toast::info(t).show(cx)
}
pub fn message(t: impl Into<SharedString>, cx: &mut App) -> ToastId {
    Toast::message(t).show(cx)
}

struct Live {
    id: ToastId,
    toast: Toast,
    deadline: Option<Instant>,
    removing: Option<Instant>,
    height: Rc<Cell<Bounds<Pixels>>>,
    generation: usize,
}

pub struct Toaster {
    toasts: Vec<Live>, // oldest first
    next_id: ToastId,
    expanded: bool,
    paused_at: Option<Instant>,
}

struct ToasterGlobal(Entity<Toaster>);
impl Global for ToasterGlobal {}

pub(crate) fn store(cx: &mut App) -> Entity<Toaster> {
    if let Some(g) = cx.try_global::<ToasterGlobal>() {
        return g.0.clone();
    }
    let e = cx.new(|_| Toaster { toasts: Vec::new(), next_id: 1, expanded: false, paused_at: None });
    cx.set_global(ToasterGlobal(e.clone()));
    e
}

fn show(toast: Toast, cx: &mut App) -> ToastId {
    let s = store(cx);
    let id = s.update(cx, |s, cx| {
        let lifetime = toast.duration.unwrap_or(LIFETIME);
        let deadline = (toast.kind != ToastKind::Loading).then(|| Instant::now() + lifetime);
        let id = match toast.id.and_then(|id| s.toasts.iter_mut().find(|l| l.id == id && l.removing.is_none())) {
            Some(live) => {
                live.toast = toast;
                live.deadline = deadline;
                live.id
            }
            None => {
                let id = toast.id.unwrap_or_else(|| {
                    s.next_id += 1;
                    s.next_id - 1
                });
                s.toasts.push(Live { id, toast, deadline, removing: None, height: Default::default(), generation: id });
                id
            }
        };
        cx.notify();
        id
    });
    // One timer per toast; re-checks while paused or when the deadline moved.
    cx.spawn(async move |cx| loop {
        let wait = cx.update(|cx| {
            let s = store(cx).read(cx);
            let live = s.toasts.iter().find(|l| l.id == id)?;
            if live.removing.is_some() {
                return None;
            }
            let deadline = live.deadline?;
            Some(if s.paused_at.is_some() { Duration::from_millis(250) } else { deadline.saturating_duration_since(Instant::now()) })
        });
        let Some(wait) = wait else { break };
        if wait.is_zero() {
            cx.update(|cx| dismiss(id, cx));
            break;
        }
        cx.background_executor().timer(wait).await;
    })
    .detach();
    id
}

/// `toast.dismiss(id)`: plays the exit and removes it.
pub fn dismiss(id: ToastId, cx: &mut App) {
    let s = store(cx);
    s.update(cx, |s, cx| {
        if let Some(l) = s.toasts.iter_mut().find(|l| l.id == id && l.removing.is_none()) {
            l.removing = Some(Instant::now());
            cx.notify();
        }
    });
    cx.spawn(async move |cx| {
        cx.background_executor().timer(EXIT).await;
        cx.update(|cx| {
            store(cx).update(cx, |s, cx| {
                s.toasts.retain(|l| l.id != id);
                if s.toasts.is_empty() {
                    s.expanded = false;
                    s.paused_at = None;
                }
                cx.notify();
            })
        });
    })
    .detach();
}

fn set_expanded(expanded: bool, cx: &mut App) {
    store(cx).update(cx, |s, cx| {
        if s.expanded == expanded {
            return;
        }
        s.expanded = expanded;
        if expanded {
            s.paused_at = Some(Instant::now());
        } else if let Some(at) = s.paused_at.take() {
            let paused = at.elapsed();
            for l in &mut s.toasts {
                if let Some(d) = &mut l.deadline {
                    *d += paused;
                }
            }
        }
        cx.notify();
    });
}

fn icon(kind: ToastKind) -> Option<&'static str> {
    match kind {
        ToastKind::Success => Some("sonner/success.svg"),
        ToastKind::Error => Some("sonner/error.svg"),
        ToastKind::Warning => Some("sonner/warning.svg"),
        ToastKind::Info => Some("sonner/info.svg"),
        _ => None,
    }
}

/// sonner's 12-bar spinner (`.sonner-loading-bar`, 1.2s).
fn spinner(color: gpui::Hsla) -> impl IntoElement {
    let bars = (0..12usize).map(move |i| {
        let angle = i as f32 * 30f32.to_radians();
        // bar: 24% × 8% of a 16px box, translated 146% of its width from the centre.
        let (bw, bh) = (16. * 0.24, 16. * 0.08);
        let r = bw * 1.46;
        let (x, y) = (8. + r * angle.cos() - bw / 2., 8. + r * angle.sin() - bh / 2.);
        div()
            .absolute()
            .left(px(x))
            .top(px(y))
            .w(px(bw))
            .h(px(bh.max(1.)))
            .rounded(px(6.))
            .bg(color)
            .with_animation(
                ("sonner-bar", i),
                gpui::Animation::new(Duration::from_millis(1200)).repeat(),
                move |d, t| {
                    // animation-delay -(1.2 - 0.1 i)s, opacity 1 → .15 linear.
                    let phase = (t + (12 - i) as f32 / 12.) % 1.;
                    d.opacity(1. - 0.85 * phase)
                },
            )
    });
    div().relative().size_4().children(bars)
}

pub(crate) fn render_toaster(window: &mut Window, cx: &mut App) -> Option<AnyElement> {
    let s = store(cx);
    if s.read(cx).toasts.is_empty() {
        return None;
    }
    let t = cx.tokens().clone();
    let _ = window;
    let expanded = s.read(cx).expanded;
    let card = t.card;
    let (success, error, warning, info) = (
        t.var_or("--success", crate::tw("emerald-500")),
        t.destructive,
        t.var_or("--warning", crate::tw("yellow-500")),
        t.var_or("--info", crate::tw("violet-500")),
    );
    let fg = t.foreground;
    let primary_fg = t.var_or("--primary-foreground", gpui::white());

    // Newest first.
    let toasts: Vec<_> = s.read(cx).toasts.iter().rev().map(|l| {
        (l.id, l.toast.kind, l.toast.title.clone(), l.toast.description.clone(),
         l.toast.action.clone(), l.toast.cancel.clone(), l.removing, l.height.clone(), l.generation)
    }).collect();
    let heights: Vec<f32> = toasts.iter().map(|x| f32::from(x.7.get().size.height).max(1.)).collect();
    let front_h = heights.first().copied().unwrap_or(54.);
    let mut container_h = 0.;
    let mut offset = 0.;
    let mut children = Vec::new();
    for (i, (id, kind, title, description, action, cancel, removing, height_cell, generation)) in toasts.into_iter().enumerate() {
        let (bg, border, icon_color) = match kind {
            ToastKind::Success => (mix(success, 0.12, card), mix(success, 0.25, t.border), success),
            ToastKind::Error => (mix(error, 0.12, card), mix(error, 0.25, t.border), error),
            ToastKind::Warning => (mix(warning, 0.12, card), mix(warning, 0.25, t.border), warning),
            ToastKind::Info => (mix(info, 0.12, card), mix(info, 0.25, t.border), info),
            _ => (card, t.border, fg),
        };
        let h = heights[i];
        let visible = i < VISIBLE;
        let (bottom, w, card_h, show_content) = if expanded {
            let b = offset;
            offset += h + GAP;
            (b, WIDTH, h, true)
        } else if i == 0 {
            (0., WIDTH, h, true)
        } else {
            let scale = 1. - 0.05 * i as f32;
            (GAP * i as f32 + front_h / 2. - front_h * scale / 2., WIDTH * scale, front_h * scale, false)
        };
        container_h = f32::max(container_h, bottom + card_h);

        let icon_el = match kind {
            ToastKind::Loading => Some(div().size_4().ml(px(-3.)).mr_1().flex_shrink_0().child(spinner(t.muted_foreground)).into_any_element()),
            k => icon(k).map(|path| {
                div()
                    .relative()
                    .size_4()
                    .ml(px(-3.))
                    .mr_1()
                    .flex_shrink_0()
                    .child(svg().path(path).absolute().left(px(-1.)).top(px(-2.)).size(px(20.)).text_color(icon_color))
                    .into_any_element()
            }),
        };
        let button = |label: SharedString, f: Handler, primary: bool, key: &'static str| {
            div()
                .id((key, id))
                .flex()
                .items_center()
                .flex_shrink_0()
                .h_6()
                .px_2()
                .rounded(px(t.radius))
                .text_size(px(12.))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .bg(if primary { t.primary } else { t.muted })
                .text_color(if primary { primary_fg } else { t.muted_foreground })
                .child(label)
                .on_click(move |_, window, cx| {
                    f(window, cx);
                    dismiss(id, cx);
                })
        };
        let has_buttons = action.is_some() || cancel.is_some();
        let inner = div()
            .relative()
            .flex()
            .items_center()
            .gap(px(6.))
            .w(px(WIDTH - 2.))
            .p_4()
            .text_size(px(13.))
            .child(bounds_tracker(height_cell))
            .children(icon_el)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .min_w_0()
                    .child(div().line_height(px(19.5)).font_weight(FontWeight::MEDIUM).child(title))
                    .children(description.map(|d| div().line_height(px(18.2)).text_color(t.muted_foreground).child(d))),
            )
            .when(has_buttons, |d| {
                d.child(
                    div()
                        .ml_auto()
                        .flex()
                        .gap(px(6.))
                        .children(cancel.map(|(l, f)| button(l, f, false, "toast-cancel")))
                        .children(action.map(|(l, f)| button(l, f, true, "toast-action"))),
                )
            });
        let el = div()
            .absolute()
            .bottom(px(bottom))
            .right(px((WIDTH - w) / 2.))
            .w(px(w))
            .h(px(card_h))
            .overflow_hidden()
            .rounded(px(8.))
            .border_1()
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .shadow(vec![gpui::BoxShadow {
                color: gpui::hsla(0., 0., 0., 0.1),
                offset: gpui::point(px(0.), px(4.)),
                blur_radius: px(12.),
                spread_radius: px(0.),
                inset: false,
            }])
            .when(!visible, |d| d.opacity(0.))
            .child(div().when(!show_content, |d| d.opacity(0.)).child(inner));
        let el = if let Some(at) = removing {
            let elapsed = at.elapsed().as_secs_f32() / EXIT.as_secs_f32();
            let _ = elapsed;
            el.with_animation(("toast-out", id), gpui::Animation::new(EXIT), move |d, v| {
                d.opacity(1. - v).mb(px(-card_h * if i == 0 { 1. } else { 0.4 } * v))
            })
            .into_any_element()
        } else {
            el.with_animation(
                ("toast-in", generation),
                gpui::Animation::new(Duration::from_millis(400)).with_easing(popup::css_ease),
                move |d, v| d.opacity(v).mb(px(-card_h * (1. - v))),
            )
            .into_any_element()
        };
        children.push(el);
    }
    // Draw oldest underneath.
    children.reverse();
    Some(
        div()
            .id("sonner-toaster")
            .absolute()
            .right(px(OFFSET))
            .bottom(px(OFFSET))
            .w(px(WIDTH))
            .h(px(container_h))
            .occlude()
            .on_hover(|hovered, _, cx| set_expanded(*hovered, cx))
            .tw_text_sm()
            .children(children)
            .into_any_element(),
    )
}
