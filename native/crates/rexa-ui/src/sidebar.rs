//! Port of components/ui/sidebar.tsx (shadcn sidebar primitives).
//!
//! Layout pieces are plain functions returning styled `Div`s so callers keep
//! full control; interactive pieces are builders:
//! ```ignore
//! Sidebar::new().collapsed(c).child(sidebar_header().child(..))
//!     .child(sidebar_content().child(sidebar_group().child(sidebar_group_label("Tables"))
//!         .child(sidebar_menu().child(SidebarMenuButton::new("t1").icon(IconName::Table).label("users").active(true)))))
//! ```
//! Approximation: the 200ms `transition-[width]` on collapse is not animated.

use crate::popup;
use crate::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnyElement, App, Div, ElementId, FontWeight, Hsla, SharedString,
    StyleRefinement, Window,
};
use gpui_component::Icon;
use std::rc::Rc;

pub const SIDEBAR_WIDTH: f32 = 256.;
pub const SIDEBAR_WIDTH_ICON: f32 = 48.;

#[derive(Clone, Copy, PartialEq, Default)]
pub enum SidebarVariant {
    #[default]
    Sidebar,
    Floating,
    Inset,
}

struct Colors {
    bg: Hsla,
    fg: Hsla,
    accent: Hsla,
    accent_fg: Hsla,
    border: Hsla,
}

fn colors(cx: &App) -> Colors {
    let t = cx.tokens();
    Colors {
        bg: t.sidebar,
        fg: t.var_or("--sidebar-foreground", t.foreground),
        accent: t.var_or("--sidebar-accent", t.accent),
        accent_fg: t.var_or("--sidebar-accent-foreground", t.accent_foreground),
        border: t.var_or("--sidebar-border", t.border),
    }
}

/// `Sidebar` (side left, `collapsible="icon"` when `collapsed`).
#[derive(IntoElement)]
pub struct Sidebar {
    variant: SidebarVariant,
    collapsed: bool,
    right: bool,
    width: f32,
    children: Vec<AnyElement>,
}

impl Sidebar {
    pub fn new() -> Self {
        Self { variant: SidebarVariant::Sidebar, collapsed: false, right: false, width: SIDEBAR_WIDTH, children: Vec::new() }
    }
    pub fn variant(mut self, v: SidebarVariant) -> Self {
        self.variant = v;
        self
    }
    /// `data-state="collapsed"` with `collapsible="icon"`.
    pub fn collapsed(mut self, c: bool) -> Self {
        self.collapsed = c;
        self
    }
    pub fn side_right(mut self) -> Self {
        self.right = true;
        self
    }
    /// `--sidebar-width` override.
    pub fn width(mut self, w: f32) -> Self {
        self.width = w;
        self
    }
}

impl Default for Sidebar {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Sidebar {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Sidebar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = colors(cx);
        let t = cx.tokens().clone();
        let floating = matches!(self.variant, SidebarVariant::Floating | SidebarVariant::Inset);
        let w = match (self.collapsed, floating) {
            (false, _) => self.width,
            (true, false) => SIDEBAR_WIDTH_ICON,
            (true, true) => SIDEBAR_WIDTH_ICON + 16. + 2.,
        };
        let inner = div()
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .bg(c.bg)
            .when(self.variant == SidebarVariant::Floating, |d| {
                d.tw_rounded_lg().shadow(popup::with_ring(popup::shadow_sm(), c.border))
            })
            .children(self.children);
        div()
            .flex_shrink_0()
            .h_full()
            .w(px(w))
            .flex()
            .flex_col()
            .text_color(c.fg)
            .when(floating, |d| d.p_2())
            .when(!floating, |d| {
                let d = d.border_color(t.border);
                if self.right { d.border_l_1() } else { d.border_r_1() }
            })
            .child(inner)
    }
}

/// `SidebarHeader` / `SidebarFooter`: `flex flex-col gap-2 p-2`.
pub fn sidebar_header() -> Div {
    div().flex().flex_col().gap_2().p_2()
}
pub fn sidebar_footer() -> Div {
    div().flex().flex_col().gap_2().p_2()
}

/// `SidebarContent`: `flex min-h-0 flex-1 flex-col overflow-auto` (no scrollbar).
pub fn sidebar_content(id: impl Into<ElementId>) -> gpui::Stateful<Div> {
    div().id(id).flex().flex_col().flex_1().min_h_0().overflow_y_scroll()
}

/// `SidebarSeparator`: `mx-2 h-px bg-sidebar-border`.
pub fn sidebar_separator(cx: &App) -> Div {
    div().mx_2().h(px(1.)).flex_shrink_0().bg(colors(cx).border)
}

/// `SidebarGroup`: `relative flex w-full min-w-0 flex-col px-1 py-2`.
pub fn sidebar_group() -> Div {
    div().relative().flex().flex_col().w_full().min_w_0().px_1().py_2()
}

/// `SidebarGroupLabel`: `h-8 px-2 text-xs font-medium text-sidebar-foreground/70`
/// (hidden in icon mode via `-mt-8 opacity-0`).
pub fn sidebar_group_label(text: impl Into<SharedString>, collapsed: bool, cx: &App) -> Div {
    let c = colors(cx);
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .h_8()
        .px_2()
        .rounded(px(8.))
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(crate::with_alpha(c.fg, 0.7))
        .when(collapsed, |d| d.mt(px(-32.)).opacity(0.))
        .child(text.into())
}

/// `SidebarGroupAction`: `absolute top-3.5 right-3 w-5 aspect-square rounded-md`, hover accent.
pub fn sidebar_group_action(id: impl Into<ElementId>, icon: IconName, cx: &App) -> gpui::Stateful<Div> {
    let c = colors(cx);
    div()
        .id(id)
        .absolute()
        .top(px(14.))
        .right_3()
        .size_5()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.))
        .text_color(c.fg)
        .cursor_pointer()
        .hover(move |s| s.bg(c.accent).text_color(c.accent_fg))
        .child(Icon::new(icon).size_4())
}

/// `SidebarGroupContent` (`w-full text-sm`) / `SidebarMenu` (`flex flex-col`).
pub fn sidebar_group_content() -> Div {
    div().w_full().tw_text_sm()
}
pub fn sidebar_menu() -> Div {
    div().flex().flex_col().w_full().min_w_0()
}

#[derive(Clone, Copy, PartialEq, Default)]
pub enum SidebarButtonSize {
    Sm,
    #[default]
    Default,
    Lg,
}

/// `SidebarMenuItem` + `SidebarMenuButton` (+ optional `SidebarMenuAction` / `SidebarMenuBadge`).
#[derive(IntoElement)]
pub struct SidebarMenuButton {
    id: ElementId,
    icon: Option<IconName>,
    leading: Option<AnyElement>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    active: bool,
    outline: bool,
    size: SidebarButtonSize,
    collapsed: bool,
    disabled: bool,
    action: Option<AnyElement>,
    badge: Option<SharedString>,
    on_click: Option<Rc<dyn Fn(&mut Window, &mut App)>>,
    style: StyleRefinement,
}

impl SidebarMenuButton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            icon: None,
            leading: None,
            label: None,
            children: Vec::new(),
            active: false,
            outline: false,
            size: SidebarButtonSize::Default,
            collapsed: false,
            disabled: false,
            action: None,
            badge: None,
            on_click: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn icon(mut self, i: IconName) -> Self {
        self.icon = Some(i);
        self
    }
    pub fn leading(mut self, el: impl IntoElement) -> Self {
        self.leading = Some(el.into_any_element());
        self
    }
    pub fn label(mut self, l: impl Into<SharedString>) -> Self {
        self.label = Some(l.into());
        self
    }
    /// `isActive`
    pub fn active(mut self, a: bool) -> Self {
        self.active = a;
        self
    }
    /// `variant="outline"`
    pub fn outline(mut self) -> Self {
        self.outline = true;
        self
    }
    pub fn size(mut self, s: SidebarButtonSize) -> Self {
        self.size = s;
        self
    }
    /// Icon mode (`size-8 p-2`, label hidden).
    pub fn collapsed(mut self, c: bool) -> Self {
        self.collapsed = c;
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// `SidebarMenuAction` (shown on hover of the item, e.g. a "⋯" dropdown).
    pub fn action(mut self, el: impl IntoElement) -> Self {
        self.action = Some(el.into_any_element());
        self
    }
    /// `SidebarMenuBadge`
    pub fn badge(mut self, b: impl Into<SharedString>) -> Self {
        self.badge = Some(b.into());
        self
    }
    pub fn on_click(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(f));
        self
    }
}

impl ParentElement for SidebarMenuButton {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for SidebarMenuButton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarMenuButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = colors(cx);
        let t = cx.tokens().clone();
        let (h, text_xs) = match self.size {
            SidebarButtonSize::Sm => (28., true),
            SidebarButtonSize::Default => (32., false),
            SidebarButtonSize::Lg => (48., false),
        };
        let group: SharedString = format!("sb-item-{:?}", self.id).into();
        let has_action = self.action.is_some();
        let on_click = self.on_click.clone();
        let mut button = div()
            .id(self.id.clone())
            .flex()
            .w_full()
            .items_center()
            .gap_2()
            .overflow_hidden()
            .rounded(px(8.))
            .p_2()
            .h(px(h))
            .when(text_xs, |d| d.tw_text_xs())
            .when(!text_xs, |d| d.tw_text_sm())
            .when(has_action, |d| d.pr_8())
            .when(self.collapsed, |d| d.size_8().p_2().when(self.size == SidebarButtonSize::Lg, |d| d.p_0()))
            .when(self.outline, |d| d.bg(t.background).shadow(vec![popup::ring(c.border)]))
            .when(self.active, |d| d.bg(c.accent).font_weight(FontWeight::MEDIUM).text_color(c.accent_fg))
            .children(self.icon.map(|i| Icon::new(i).size_4().flex_shrink_0()))
            .children(self.leading)
            .when(!self.collapsed, |d| {
                d.children(self.label.map(|l| div().min_w_0().truncate().child(l))).children(self.children)
            });
        if self.disabled {
            button = button.opacity(0.5);
        } else {
            button = button.cursor_pointer().hover(move |s| s.bg(c.accent).text_color(c.accent_fg));
            if let Some(f) = on_click {
                button = button.on_click(move |_, w, cx| f(w, cx));
            }
        }
        let mut item = div().relative().group(group.clone()).child(button);
        item.style().refine(&self.style);
        let top = match self.size {
            SidebarButtonSize::Sm => 4.,
            SidebarButtonSize::Default => 6.,
            SidebarButtonSize::Lg => 10.,
        };
        if !self.collapsed {
            if let Some(action) = self.action {
                // md:opacity-0, group-hover / focus-within → 100.
                item = item.child(
                    div()
                        .absolute()
                        .top(px(top))
                        .right_1()
                        .size_5()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.))
                        .text_color(c.fg)
                        .opacity(0.)
                        .group_hover(group.clone(), |s| s.opacity(1.))
                        .child(action),
                );
            }
            if let Some(b) = self.badge {
                item = item.child(
                    div()
                        .absolute()
                        .top(px(top))
                        .right_1()
                        .h_5()
                        .min_w_5()
                        .px_1()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.))
                        .tw_text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if self.active { c.accent_fg } else { c.fg })
                        .child(b),
                );
            }
        }
        item
    }
}

/// `SidebarMenuSub`: `mx-3.5 flex flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5`.
pub fn sidebar_menu_sub(cx: &App) -> Div {
    div().mx(px(14.)).flex().flex_col().gap_1().min_w_0().border_l_1().border_color(colors(cx).border).px(px(10.)).py(px(2.))
}

/// `SidebarMenuSubButton` (`h-7 px-2 rounded-md`, md = text-sm, sm = text-xs).
pub fn sidebar_menu_sub_button(id: impl Into<ElementId>, label: impl Into<SharedString>, active: bool, small: bool, cx: &App) -> gpui::Stateful<Div> {
    let c = colors(cx);
    div()
        .id(id)
        .flex()
        .h_7()
        .min_w_0()
        .items_center()
        .gap_2()
        .overflow_hidden()
        .rounded(px(8.))
        .px_2()
        .ml(px(-1.))
        .text_color(if active { c.accent_fg } else { c.fg })
        .when(active, |d| d.bg(c.accent))
        .map(|d| if small { d.tw_text_xs() } else { d.tw_text_sm() })
        .cursor_pointer()
        .hover(move |s| s.bg(c.accent).text_color(c.accent_fg))
        .child(div().truncate().child(label.into()))
}

/// `SidebarMenuSkeleton`: `h-8 px-2 gap-2` with an optional icon and a 50–90% text bar.
pub fn sidebar_menu_skeleton(id: impl Into<ElementId>, show_icon: bool, width_pct: f32, cx: &App) -> impl IntoElement {
    let id: ElementId = id.into();
    div()
        .flex()
        .h_8()
        .items_center()
        .gap_2()
        .rounded(px(8.))
        .px_2()
        .when(show_icon, |d| d.child(crate::display::skeleton(popup::sub_id(&id, "icon"), |d| d.size_4().rounded(px(8.)), cx)))
        .child(crate::display::skeleton(popup::sub_id(&id, "text"), move |d| d.h_4().flex_1().max_w(gpui::relative(width_pct / 100.)), cx))
}

/// `SidebarTrigger`: ghost icon-sm button with PanelLeft.
pub fn sidebar_trigger(id: impl Into<ElementId>, on_toggle: impl Fn(&mut Window, &mut App) + 'static) -> Button {
    Button::new(id).ghost().size(ButtonSize::IconSm).icon(IconName::PanelLeft).on_click(move |_, w, cx| on_toggle(w, cx))
}

/// `SidebarRail`: a 16px hit area on the sidebar edge showing a 2px line on hover; click toggles.
pub fn sidebar_rail(id: impl Into<ElementId>, collapsed: bool, on_toggle: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> impl IntoElement {
    let c = colors(cx);
    let id: ElementId = id.into();
    let group: SharedString = format!("rail-{id:?}").into();
    div()
        .id(id)
        .group(group.clone())
        .absolute()
        .top_0()
        .bottom_0()
        .right(px(-8.))
        .w_4()
        .cursor(if collapsed { gpui::CursorStyle::ResizeRight } else { gpui::CursorStyle::ResizeLeft })
        .on_click(move |_, w, cx| on_toggle(w, cx))
        .child(div().absolute().top_0().bottom_0().left(px(7.)).w(px(2.)).group_hover(group, move |s| s.bg(c.border)))
}

/// `SidebarInset`: the main content beside an inset sidebar
/// (`m-2 ml-0 rounded-lg shadow-sm bg-background`).
pub fn sidebar_inset(inset: bool, cx: &App) -> Div {
    let t = cx.tokens();
    div()
        .relative()
        .flex()
        .flex_col()
        .flex_1()
        .w_full()
        .bg(t.background)
        .when(inset, |d| d.m_2().ml_0().tw_rounded_lg().shadow(popup::shadow_sm()))
}

/// `SidebarInput`: `h-8 w-full bg-background shadow-none`.
pub fn sidebar_input(state: &gpui::Entity<gpui_component::input::InputState>) -> crate::TextInput {
    crate::TextInput::new(state).h(32.)
}
