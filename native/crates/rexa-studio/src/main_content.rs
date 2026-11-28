//! Port of components/studio/studio-main-content.tsx (pane rendering),
//! split-view.tsx / horizontal-split-view.tsx, welcome-screen.tsx,
//! initial-loading-screen.tsx and loading-dot-spinner.tsx. Tab bodies come from
//! `Registry::build_tab`; tabs no crate has registered yet show `TabPlaceholder`.

use crate::resize::Target;
use crate::split_layout::{SplitDirection, SplitNode};
use crate::studio::Studio;
use gpui::{
    canvas, div, prelude::*, px, relative, Animation, AnimationExt, AnyElement, Context, Pixels, SharedString,
    Window,
};
use rexa_ui::{with_alpha, ActiveTokens, Tw};
use std::time::Duration;

/// Neutral body for tab types whose crate hasn't registered a factory yet.
pub struct TabPlaceholder {
    pub title: SharedString,
    pub kind: SharedString,
}

impl TabPlaceholder {
    /// Inline placeholder for a hosted panel (`kind` = the TabSpec::View id asked for).
    pub fn element(kind: &str, cx: &mut Context<Studio>) -> AnyElement {
        let t = cx.tokens();
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .tw_text_xs()
            .text_color(t.muted_foreground)
            .child(format!("“{kind}” is not available yet."))
            .into_any_element()
    }
}

impl Render for TabPlaceholder {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_1()
            .text_color(t.muted_foreground)
            .child(div().tw_text_sm().text_color(t.foreground).child(self.title.clone()))
            .child(div().tw_text_xs().child(format!("“{}” view is not available yet.", self.kind)))
    }
}

/// LoadingDotSpinner: eight dots on a ring, pulsing in sequence (size sm = 2.2rem).
pub fn loading_dot_spinner(size: f32, color: gpui::Hsla) -> impl IntoElement {
    let dot = size * 0.2;
    let r = size / 2. - dot / 2.;
    let mut el = div().relative().size(px(size));
    for i in 0..8 {
        let angle = (i as f32) * std::f32::consts::FRAC_PI_4;
        let (x, y) = (size / 2. + r * angle.cos() - dot / 2., size / 2. + r * angle.sin() - dot / 2.);
        el = el.child(
            div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .size(px(dot))
                .rounded(px(dot / 2.))
                .bg(color)
                .with_animation(
                    SharedString::from(format!("dot-{i}")),
                    Animation::new(Duration::from_millis(1000)).repeat(),
                    move |d, delta| {
                        // loading-dot-pulse: phase-shifted by 1/8 per dot, opacity .5 → 1 → .5
                        let p = (delta + 1. - i as f32 * 0.125).fract();
                        let o = 0.25 + 0.75 * (1. - (p * 2. - 1.).abs());
                        d.opacity(o)
                    },
                ),
        );
    }
    el
}

impl Studio {
    /// WelcomeScreen
    pub fn render_welcome(&self, on_close_pane: Option<String>, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let (singular, editor) = match self.db_type {
            "mongodb" => ("collection", "query editor"),
            "redis" => ("key", "command editor"),
            _ => ("table", "sql editor"),
        };
        div()
            .relative()
            .flex_1()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .text_color(t.muted_foreground)
            .children(on_close_pane.map(|pane| {
                div().absolute().right_3().top_3().child(
                    div()
                        .id("close-split")
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .h_8()
                        .px_2()
                        .tw_rounded_lg()
                        .tw_text_xs()
                        .text_color(with_alpha(t.muted_foreground, 0.7))
                        .hover(move |s| s.text_color(t.foreground).bg(rexa_ui::white(0.06)))
                        .on_click(cx.listener(move |this, _, _, cx| this.close_pane(&pane, cx)))
                        .child(crate::icons::lucide("x").el(14., t.muted_foreground))
                        .child("Close split"),
                )
            }))
            .child(
                div().max_w(px(576.)).px_8().text_center().child(
                    div().tw_text_sm().text_color(t.foreground).child(format!(
                        "Select a {singular} from the sidebar or open the {editor} to start exploring your data."
                    )),
                ),
            )
            .into_any_element()
    }

    fn render_tab_body(&mut self, tab_id: Option<String>, close_pane: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        match tab_id.filter(|id| self.tabs.iter().any(|t| &t.id == id)) {
            Some(id) => div().size_full().flex().flex_col().min_h_0().child(self.view_for(&id, window, cx)).into_any_element(),
            None => self.render_welcome(close_pane, cx),
        }
    }

    /// Content area of the card: one pane, or the split tree.
    pub fn render_main_content(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if !self.split.enabled {
            let active = self.active_tab_id.clone();
            return self.render_tab_body(active, None, window, cx);
        }
        let root = self.split.root.clone();
        self.render_node(&root, window, cx)
    }

    fn render_node(&mut self, node: &SplitNode, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        match node {
            SplitNode::Pane { id } => self.render_pane(id, window, cx),
            SplitNode::Split { id, direction, ratio, first, second } => {
                let vertical = *direction == SplitDirection::Vertical;
                let a = self.render_node(first, window, cx);
                let b = self.render_node(second, window, cx);
                // Measured extent drives ratio dragging (split-view.tsx uses the container rect).
                let extent = self.split_extents.get(id).copied().unwrap_or(800.);
                let sid = id.clone();
                let handle = self.resize_handle(&format!("split-{id}"), Target::Split { id: id.clone(), vertical, extent }, vertical, cx);
                let ent = cx.entity().downgrade();
                div()
                    .relative()
                    .size_full()
                    .flex()
                    .when(!vertical, |d| d.flex_col())
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                let ext: Pixels = if vertical { bounds.size.width } else { bounds.size.height };
                                if let Some(e) = ent.upgrade() {
                                    e.update(cx, |s, _| {
                                        s.split_extents.insert(sid.clone(), f32::from(ext));
                                    });
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .child(div().min_w_0().min_h_0().flex().flex_col().map(|d| if vertical { d.h_full().w(relative(*ratio)) } else { d.w_full().h(relative(*ratio)) }).child(a))
                    .child(handle)
                    .child(div().flex_1().min_w_0().min_h_0().flex().flex_col().child(b))
                    .into_any_element()
            }
        }
    }

    fn render_pane(&mut self, pane: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let active = self.split.active_pane_id == pane;
        let tab = self.split.pane_state.get(pane).and_then(|p| p.active_tab_id.clone());
        let tabs_bar = self.render_pane_tabs(pane, active, cx).into_any_element();
        let body = self.render_tab_body(tab, Some(pane.to_string()), window, cx);
        let p = pane.to_string();
        div()
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .min_h_0()
            .on_mouse_down(gpui::MouseButton::Left, cx.listener(move |this, _, _, cx| this.activate_pane(&p, cx)))
            .child(tabs_bar)
            .child(div().flex_1().min_h_0().flex().flex_col().child(body))
            .into_any_element()
    }

    /// InitialLoadingScreen
    pub fn render_loading(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens();
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(t.background)
            .child(loading_dot_spinner(35.2, t.primary))
            .into_any_element()
    }

    /// StudioClient error card: "Unable to open connection".
    pub fn render_error(&self, message: SharedString, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(t.background)
            .p_6()
            .child(
                div()
                    .w_full()
                    .max_w(px(448.))
                    .flex()
                    .flex_col()
                    .gap_4()
                    .tw_rounded_xl()
                    .border_1()
                    .border_color(t.border)
                    .p_6()
                    .child(div().tw_text_lg().font_weight(gpui::FontWeight::SEMIBOLD).child("Unable to open connection"))
                    .child(div().tw_text_sm().text_color(t.muted_foreground).child(message))
                    .child(
                        div()
                            .id("back-to-connections")
                            .flex()
                            .w_auto()
                            .self_start()
                            .tw_rounded_md()
                            .border_1()
                            .border_color(t.border)
                            .px_3()
                            .py_2()
                            .tw_text_sm()
                            .cursor_pointer()
                            .hover(move |s| s.bg(t.muted))
                            .on_click(cx.listener(|this, _, _, cx| this.go_home(cx)))
                            .child("Back to connections"),
                    ),
            )
            .into_any_element()
    }
}
