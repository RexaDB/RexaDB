//! Port of components/app-shell/resize-handle.tsx and hooks/use-resize-drag.ts,
//! hooks/use-sidebar-resize.ts, hooks/use-resize-panel.ts: VS Code-style sashes
//! (6px hit target, 2px line on hover/drag, three resting dots) and the
//! drag math for the sidebar, AI / SQL sheet / threads columns, bottom panel
//! and split panes.

use crate::studio::Studio;
use gpui::{div, prelude::*, px, AnyElement, Context, CursorStyle, MouseButton, MouseMoveEvent, Pixels, Point, SharedString};
use rexa_ui::{with_alpha, ActiveTokens};

#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// AppSidebar: 150…500, grows to the right.
    Sidebar,
    /// AI chat column: 320…700, grows to the left.
    Ai,
    /// SQL sheet: 360…800, grows to the left.
    SqlSheet,
    /// Threads: 220…500, grows to the left.
    Threads,
    /// Bottom SQL panel: 120…600, grows upward.
    Panel,
    /// Split pane ratio; `extent` is the split's size along the axis.
    Split { id: String, vertical: bool, extent: f32 },
}

#[derive(Clone, Debug)]
pub struct Drag {
    pub target: Target,
    pub start: Point<Pixels>,
    pub start_value: f32,
}

impl Studio {
    pub fn begin_resize(&mut self, target: Target, start: Point<Pixels>, cx: &mut Context<Self>) {
        let start_value = match &target {
            Target::Sidebar => self.sidebar_width,
            Target::Ai => self.ai_width,
            Target::SqlSheet => self.sql_sheet_width,
            Target::Threads => self.threads_width,
            Target::Panel => self.panel_height,
            Target::Split { id, .. } => split_ratio(&self.split.root, id).unwrap_or(0.5),
        };
        self.resize = Some(Drag { target, start, start_value });
        cx.notify();
    }

    pub fn on_resize_move(&mut self, e: &MouseMoveEvent, cx: &mut Context<Self>) {
        let Some(drag) = self.resize.clone() else { return };
        if e.pressed_button != Some(MouseButton::Left) {
            self.resize = None;
            cx.notify();
            return;
        }
        let dx = f32::from(e.position.x - drag.start.x);
        let dy = f32::from(e.position.y - drag.start.y);
        match drag.target {
            Target::Sidebar => self.sidebar_width = (drag.start_value + dx).clamp(150., 500.),
            Target::Ai => self.ai_width = (drag.start_value - dx).clamp(320., 700.),
            Target::SqlSheet => self.sql_sheet_width = (drag.start_value - dx).clamp(360., 800.),
            Target::Threads => self.threads_width = (drag.start_value - dx).clamp(220., 500.),
            Target::Panel => self.panel_height = (drag.start_value - dy).clamp(120., 600.),
            Target::Split { id, vertical, extent } => {
                let delta = if vertical { dx } else { dy };
                let ratio = (drag.start_value + delta / extent.max(1.)).clamp(0.15, 0.85);
                self.split = self.split.set_ratio(&id, ratio);
            }
        }
        cx.notify();
    }

    pub fn end_resize(&mut self, cx: &mut Context<Self>) {
        if self.resize.take().is_some() {
            if let Some(_) = self.split.pane_ids().get(1) {
                self.persist(cx);
            }
            cx.notify();
        }
    }

    /// ResizeHandle. `vertical` = a column divider (col-resize).
    pub fn resize_handle(&self, id: &str, target: Target, vertical: bool, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        let dragging = self.resize.as_ref().is_some_and(|d| d.target == target);
        let group = SharedString::from(format!("sash-{id}"));
        let line = div()
            .absolute()
            .rounded_full()
            .map(|d| if vertical { d.top_0().bottom_0().left(px(2.)).w(px(2.)) } else { d.left_0().right_0().top(px(2.)).h(px(2.)) })
            .when(dragging, |d| d.bg(with_alpha(t.foreground, 0.45)))
            .when(!dragging, |d| d.group_hover(group.clone(), |s| s.bg(with_alpha(t.foreground, 0.3))));
        let dot = || div().size(px(3.)).flex_shrink_0().rounded_full().bg(t.muted_foreground);
        let dots = div()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(3.))
            .when(vertical, |d| d.flex_col())
            .opacity(if dragging { 0. } else { 0.45 })
            .when(!dragging, |d| d.group_hover(group.clone(), |s| s.opacity(0.)))
            .child(dot())
            .child(dot())
            .child(dot());
        div()
            .id(SharedString::from(format!("resize-{id}")))
            .group(group.clone())
            .relative()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .map(|d| if vertical { d.w(px(6.)).h_full().cursor(CursorStyle::ResizeLeftRight) } else { d.h(px(6.)).w_full().cursor(CursorStyle::ResizeUpDown) })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    this.begin_resize(target.clone(), e.position, cx);
                }),
            )
            .child(line)
            .child(dots)
    }
}

fn split_ratio(node: &crate::split_layout::SplitNode, id: &str) -> Option<f32> {
    match node {
        crate::split_layout::SplitNode::Pane { .. } => None,
        crate::split_layout::SplitNode::Split { id: sid, ratio, first, second, .. } => {
            if sid == id {
                Some(*ratio)
            } else {
                split_ratio(first, id).or_else(|| split_ratio(second, id))
            }
        }
    }
}

#[allow(dead_code)]
fn _unused(_: AnyElement) {}
