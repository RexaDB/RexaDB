//! Port of components/app-shell/app-header.tsx (the tab strip inside the
//! content card when the view isn't split) and components/studio/modern-pane-tabs.tsx
//! (per-pane strips when split). Pills: h-7 min-w-24 max-w-52 rounded-md px-2 text-xs.
//! Middle click closes, drag reorders within a pane, right click opens the tab menu.

use crate::icons::{self, Ico};
use crate::menu::MenuEntry;
use crate::studio::Studio;
use crate::tabs::{self, StudioTab};
use gpui::{div, prelude::*, px, Context, MouseButton, SharedString, Window};
use rexa_ui::{white, with_alpha, ActiveTokens, Tw};

/// Drag payload for tab reordering.
#[derive(Clone)]
pub struct DraggedTab {
    pub id: String,
    pub name: SharedString,
}

impl Render for DraggedTab {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // studio-interface.tsx tabSplitDrag ghost: h-10 px-3 text-xs border bg-studio-tab-active shadow-lg
        let t = cx.tokens();
        div()
            .h_10()
            .flex()
            .items_center()
            .px_3()
            .min_w(px(140.))
            .max_w(px(220.))
            .tw_text_xs()
            .font_weight(gpui::FontWeight::MEDIUM)
            .border_1()
            .border_color(t.studio_border)
            .bg(t.var("--studio-tab-active").unwrap_or(t.background))
            .text_color(t.foreground)
            .shadow_lg()
            .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(self.name.clone()))
    }
}

impl Studio {
    fn tab_pill(&self, tab: &StudioTab, active: bool, show_dirty: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let id = tab.id.clone();
        let group = SharedString::from(format!("tab-{}", tab.id));
        let active_bg = t.var("--studio-tab-active").unwrap_or(t.background);
        let (bg, hover_bg) = if t.dark { (white(0.07), white(0.12)) } else { (gpui::hsla(0., 0., 0., 0.05), gpui::hsla(0., 0., 0., 0.1)) };
        let drop_target = self.tab_drag_over.as_deref() == Some(tab.id.as_str());
        let (id_click, id_mid, id_close, id_drop, id_menu, id_dbl) = (id.clone(), id.clone(), id.clone(), id.clone(), id.clone(), id.clone());
        let name: SharedString = tab.name.clone().into();
        let preview = tab.is_preview();
        div()
            .id(SharedString::from(format!("tab-pill-{}", tab.id)))
            .group(group.clone())
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(6.))
            .h_7()
            .min_w(px(96.))
            .max_w(px(208.))
            .px_2()
            .tw_rounded_md()
            .tw_text_xs()
            .cursor_pointer()
            .map(|d| {
                if active {
                    d.bg(active_bg).text_color(t.foreground)
                } else {
                    d.bg(bg).text_color(t.muted_foreground).hover(move |s| s.bg(hover_bg).text_color(t.foreground))
                }
            })
            .when(drop_target, |d| d.border_l_2().border_color(with_alpha(t.foreground, 0.5)))
            .on_click(cx.listener(move |this, e: &gpui::ClickEvent, _, cx| {
                if e.click_count() >= 2 {
                    this.confirm_preview(&id_dbl, cx);
                }
                this.switch_tab(&id_click, cx);
            }))
            .on_mouse_down(MouseButton::Middle, cx.listener(move |this, _, _, cx| this.close_tab(&id_mid, cx)))
            .on_mouse_down(MouseButton::Right, cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                let items = this.tab_menu(&id_menu);
                this.open_menu("tab-menu", e.position, 160., items, cx);
            }))
            .on_drag(DraggedTab { id: id.clone(), name: name.clone() }, |d, _, _, cx| cx.new(|_| d.clone()))
            .on_drag_move(cx.listener(move |this, e: &gpui::DragMoveEvent<DraggedTab>, _, cx| {
                let over = e.bounds.contains(&e.event.position) && e.drag(cx).id != id_drop;
                let target = id_drop.clone();
                if over && this.tab_drag_over.as_deref() != Some(target.as_str()) {
                    this.tab_drag_over = Some(target);
                    cx.notify();
                }
            }))
            .on_drop(cx.listener(move |this, d: &DraggedTab, _, cx| {
                this.tab_drag_over = None;
                // Only within the same pane (groupTabsByPane).
                if this.split.pane_for_tab(&d.id) == this.split.pane_for_tab(&id) {
                    this.reorder_tab(&d.id, &id, cx);
                }
            }))
            .child(tabs::tab_icon(&tab.kind).el(16., gpui::Hsla::default()).text_color(if active { t.foreground } else { t.muted_foreground }))
            .when(show_dirty && tab.is_dirty(), |d| d.child(div().size(px(6.)).flex_shrink_0().rounded_full().bg(with_alpha(t.foreground, 0.7))))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .when(preview, |d| d.italic())
                    .child(name),
            )
            .when(!tab.is_pinned(), |d| {
                d.child(
                    div()
                        .id(SharedString::from(format!("tab-close-{}", tab.id)))
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_center()
                        .size_4()
                        .rounded(px(4.))
                        .hover(|s| s.bg(white(0.1)))
                        .map(|d| if active { d.opacity(0.7).hover(|s| s.opacity(1.)) } else { d.opacity(0.).group_hover(group.clone(), |s| s.opacity(1.)) })
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.stop_propagation();
                            this.close_tab(&id_close, cx);
                        }))
                        .child(icons::lucide("x").el(12., t.foreground)),
                )
            })
            .when(tab.is_pinned(), |d| d.child(icons::lucide("pin").el(12., t.muted_foreground)))
    }

    /// Right-click tab menu (pin / close / close others / split).
    fn tab_menu(&self, id: &str) -> Vec<MenuEntry> {
        let pinned = self.tabs.iter().find(|t| t.id == id).is_some_and(|t| t.is_pinned());
        let (a, b, c) = (id.to_string(), id.to_string(), id.to_string());
        vec![
            MenuEntry::item(if pinned { "Unpin Tab" } else { "Pin Tab" }, move |s, _, cx| s.toggle_pin(&a, cx)),
            MenuEntry::Separator,
            MenuEntry::item("Close", move |s, _, cx| s.close_tab(&b, cx)).disabled(pinned),
            MenuEntry::item("Close Others", move |s, _, cx| {
                let others: Vec<String> = s.tabs.iter().filter(|t| t.id != c && !t.is_pinned()).map(|t| t.id.clone()).collect();
                for o in others {
                    s.close_tab(&o, cx);
                }
            }),
            MenuEntry::Separator,
            MenuEntry::item("Split Pane", |s, _, cx| s.create_split(cx)),
        ]
    }

    fn small_icon_button(&self, id: &str, ico: Ico, size: f32, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        // Button ghost size icon-sm with className "size-6 text-muted-foreground"
        let t = cx.tokens().clone();
        let hover = if t.dark { white(0.06) } else { with_alpha(t.muted, 0.6) };
        div()
            .id(SharedString::from(id.to_string()))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size_6()
            .tw_rounded_lg()
            .cursor_pointer()
            .text_color(t.muted_foreground)
            .hover(move |s| s.bg(hover).text_color(t.foreground))
            .child(ico.el(size, gpui::Hsla::default()))
    }

    /// AppHeader (Modern UI: h-9 p-1 border-b, tabs + "+" + split controls).
    pub fn render_app_header(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let active = self.active_tab_id.clone();
        let tabs: Vec<StudioTab> = self.tabs.clone();
        let mut strip = div().id("app-header-tabs").flex().min_w_0().flex_1().items_center().gap(px(6.)).overflow_x_scroll();
        for tab in &tabs {
            strip = strip.child(self.tab_pill(tab, active.as_deref() == Some(tab.id.as_str()), false, cx));
        }
        strip = strip.child(
            self.small_icon_button("new-tab", icons::lucide("plus"), 16., cx)
                .on_click(cx.listener(|this, _, _, cx| this.open_sql_editor(None, None, None, cx))),
        );
        let split_btn = self
            .small_icon_button("split-pane", icons::lucide("columns-2"), 16., cx)
            .on_click(cx.listener(|this, _, _, cx| this.create_split(cx)));
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .gap_1()
            .h_9()
            .p_1()
            .border_b_1()
            .border_color(t.border)
            .child(div().flex().min_w_0().flex_1().items_center().gap_1().child(strip).child(div().flex().flex_shrink_0().items_center().gap(px(2.)).child(split_btn)))
    }

    /// ModernPaneTabs for one pane of a split.
    pub fn render_pane_tabs(&mut self, pane: &str, pane_active: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let ids = self.tab_ids();
        let pane_tab_ids = self.split.tabs_for_pane(&ids, pane);
        let pane_active_tab = self.split.pane_state.get(pane).and_then(|p| p.active_tab_id.clone());
        let tabs: Vec<StudioTab> = self.tabs.iter().filter(|t| pane_tab_ids.contains(&t.id)).cloned().collect();
        let mut strip = div().id(SharedString::from(format!("pane-tabs-{pane}"))).flex().min_w_0().flex_1().items_center().gap_1().overflow_x_scroll();
        for tab in &tabs {
            strip = strip.child(self.tab_pill(tab, pane_active_tab.as_deref() == Some(tab.id.as_str()), true, cx));
        }
        let p = pane.to_string();
        strip = strip.child(
            self.small_icon_button(&format!("pane-new-{pane}"), icons::lucide("plus"), 14., cx)
                .rounded(px(4.))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.activate_pane(&p, cx);
                    this.open_sql_editor(None, None, None, cx);
                })),
        );
        let p2 = pane.to_string();
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_1()
            .h_9()
            .p_1()
            .overflow_hidden()
            .border_b_1()
            .border_color(t.border)
            .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, _, cx| this.activate_pane(&p2, cx)))
            .child(strip)
            .when(pane_active, |d| {
                d.child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .gap(px(2.))
                        .child(
                            self.small_icon_button("pane-split", icons::lucide("columns-2"), 14., cx)
                                .rounded(px(4.))
                                .on_click(cx.listener(|this, _, _, cx| this.create_split(cx))),
                        )
                        .child(
                            self.small_icon_button("pane-close", icons::lucide("x"), 14., cx)
                                .rounded(px(4.))
                                .on_click(cx.listener(|this, _, _, cx| this.close_active_pane(cx))),
                        ),
                )
            })
    }
}
