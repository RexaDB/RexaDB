//! Port of components/ui/dropdown-menu.tsx and components/ui/context-menu.tsx
//! (Radix menus): items with icons / shortcuts / destructive variant,
//! checkbox and radio items, labels, separators and nested sub-menus, with
//! Radix keyboard behaviour (↑/↓/Home/End move, →/Enter open a sub-menu,
//! ← closes it, Enter/Space select, Esc closes, pointer hover highlights).
//!
//! ```ignore
//! DropdownMenu::new("conn-actions")
//!     .trigger(Button::new("t").ghost().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
//!     .menu(|m, _, _| m
//!         .item(MenuItem::new("Edit").icon(IconName::Pencil).shortcut("⌘E").on_select(|_, _| {}))
//!         .separator()
//!         .sub("Export", |m, _, _| m.item(MenuItem::new("CSV")))
//!         .item(MenuItem::new("Delete").destructive()))
//! ```

use crate::popup::{self, Align, PopupState, Side};
use crate::theme::{white, with_alpha, Tokens};
use crate::tracked_text::tracked;
use crate::{ActiveTokens, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnyElement, App, Bounds, Context, ElementId, Entity, FontWeight,
    KeyDownEvent, MouseButton, Pixels, SharedString, Window,
};
use gpui_component::Icon;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
pub type MenuBuilder = Rc<dyn Fn(Menu, &mut Window, &mut App) -> Menu>;

/// Which original component's classes to use.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum MenuStyle {
    #[default]
    Dropdown,
    Context,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Plain,
    Check(bool),
    Radio(bool),
}

pub struct MenuItem {
    label: SharedString,
    icon: Option<IconName>,
    icon_size: Option<f32>,
    leading: Option<AnyElement>,
    shortcut: Option<SharedString>,
    destructive: bool,
    disabled: bool,
    inset: bool,
    kind: Kind,
    keep_open: bool,
    on_select: Option<Handler>,
}

impl MenuItem {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            icon_size: None,
            leading: None,
            shortcut: None,
            destructive: false,
            disabled: false,
            inset: false,
            kind: Kind::Plain,
            keep_open: false,
            on_select: None,
        }
    }
    /// `DropdownMenuCheckboxItem`
    pub fn checkbox(label: impl Into<SharedString>, checked: bool) -> Self {
        Self { kind: Kind::Check(checked), ..Self::new(label) }
    }
    /// `DropdownMenuRadioItem`
    pub fn radio(label: impl Into<SharedString>, checked: bool) -> Self {
        Self { kind: Kind::Radio(checked), ..Self::new(label) }
    }
    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }
    /// Override the icon size (dropdown default `size-4`, context default `size-3.5`).
    pub fn icon_size(mut self, size: f32) -> Self {
        self.icon_size = Some(size);
        self
    }
    /// Any leading element (provider logo, color dot…) instead of an icon.
    pub fn leading(mut self, el: impl IntoElement) -> Self {
        self.leading = Some(el.into_any_element());
        self
    }
    /// `DropdownMenuShortcut` text, e.g. "⌘K".
    pub fn shortcut(mut self, s: impl Into<SharedString>) -> Self {
        self.shortcut = Some(s.into());
        self
    }
    /// `variant="destructive"`
    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// `inset` (pl-7)
    pub fn inset(mut self) -> Self {
        self.inset = true;
        self
    }
    /// Keep the menu open after selecting (Radix `onSelect={e => e.preventDefault()}`).
    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }
    pub fn on_select(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(f));
        self
    }
}

enum Entry {
    Item(MenuItem),
    Sub(MenuItem, MenuBuilder),
    Label(SharedString, bool),
    Separator,
    Custom(AnyElement),
}

/// The content of a menu (`DropdownMenuContent` / `ContextMenuContent`).
pub struct Menu {
    entries: Vec<Entry>,
    style: MenuStyle,
    min_w: Option<f32>,
    w: Option<f32>,
    max_h: Option<f32>,
}

impl Menu {
    pub fn new(style: MenuStyle) -> Self {
        Self { entries: Vec::new(), style, min_w: None, w: None, max_h: None }
    }
    pub fn item(mut self, item: MenuItem) -> Self {
        self.entries.push(Entry::Item(item));
        self
    }
    pub fn items(mut self, items: impl IntoIterator<Item = MenuItem>) -> Self {
        self.entries.extend(items.into_iter().map(Entry::Item));
        self
    }
    /// `DropdownMenuSub` with a `SubTrigger` labelled `label`.
    pub fn sub(self, label: impl Into<SharedString>, f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        self.sub_item(MenuItem::new(label), f)
    }
    /// Sub-menu whose trigger has an icon etc.
    pub fn sub_item(mut self, trigger: MenuItem, f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        self.entries.push(Entry::Sub(trigger, Rc::new(f)));
        self
    }
    pub fn label(mut self, text: impl Into<SharedString>) -> Self {
        self.entries.push(Entry::Label(text.into(), false));
        self
    }
    pub fn label_inset(mut self, text: impl Into<SharedString>) -> Self {
        self.entries.push(Entry::Label(text.into(), true));
        self
    }
    pub fn separator(mut self) -> Self {
        // Radix renders leading/trailing/double separators as-is; callers rely on that rarely,
        // but collapse duplicates the way most menus are written conditionally.
        if !matches!(self.entries.last(), None | Some(Entry::Separator)) {
            self.entries.push(Entry::Separator);
        }
        self
    }
    /// Arbitrary non-interactive content (headers, account cards…).
    pub fn custom(mut self, el: impl IntoElement) -> Self {
        self.entries.push(Entry::Custom(el.into_any_element()));
        self
    }
    pub fn when(self, cond: bool, f: impl FnOnce(Self) -> Self) -> Self {
        if cond { f(self) } else { self }
    }
    /// `className="w-56"` etc.
    pub fn w(mut self, w: f32) -> Self {
        self.w = Some(w);
        self
    }
    pub fn min_w(mut self, w: f32) -> Self {
        self.min_w = Some(w);
        self
    }
    pub fn max_h(mut self, h: f32) -> Self {
        self.max_h = Some(h);
        self
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ---- state ---------------------------------------------------------------------

/// Highlight / open sub-menu of one menu level.
pub struct MenuLevel {
    highlighted: Option<usize>,
    sub_open: Option<usize>,
    sub: Option<Entity<MenuLevel>>,
    rows: Vec<Rc<Cell<Bounds<Pixels>>>>,
    generation: usize,
}

impl MenuLevel {
    fn new() -> Self {
        Self { highlighted: None, sub_open: None, sub: None, rows: Vec::new(), generation: 0 }
    }
    fn reset(&mut self) {
        self.highlighted = None;
        self.sub_open = None;
        self.sub = None;
    }
    fn open_sub(&mut self, ix: usize, highlight_first: Option<usize>, cx: &mut Context<Self>) {
        if self.sub_open != Some(ix) {
            self.sub_open = Some(ix);
            self.generation += 1;
            let sub = cx.new(|_| MenuLevel::new());
            self.sub = Some(sub);
        }
        if let (Some(first), Some(sub)) = (highlight_first, &self.sub) {
            sub.update(cx, |s, cx| {
                s.highlighted = Some(first);
                cx.notify();
            });
        }
        cx.notify();
    }
    fn close_sub(&mut self, cx: &mut Context<Self>) {
        if self.sub_open.take().is_some() {
            self.sub = None;
            cx.notify();
        }
    }
}

#[derive(Clone)]
struct NavItem {
    selectable: bool,
    sub: bool,
    handler: Option<Handler>,
    keep_open: bool,
    /// For sub items: index of the sub-menu's first selectable row.
    sub_first: Option<usize>,
}

struct NavLevel {
    level: Entity<MenuLevel>,
    items: Vec<NavItem>,
}

type Nav = Rc<RefCell<Vec<NavLevel>>>;

// ---- rendering -------------------------------------------------------------------

struct Ctx {
    close: Handler,
    nav: Nav,
    id: ElementId,
}

fn highlight_bg(t: &Tokens, style: MenuStyle, kind: Kind, destructive: bool) -> gpui::Hsla {
    if destructive {
        return with_alpha(t.destructive, if t.dark { 0.2 } else { 0.1 });
    }
    // Context checkbox/radio items only have `focus:bg-accent`.
    let accent_only = style == MenuStyle::Context && kind != Kind::Plain;
    if t.dark && !accent_only { white(0.1) } else { t.accent }
}

fn first_selectable(menu: &Menu) -> Option<usize> {
    menu.entries.iter().position(|e| match e {
        Entry::Item(i) | Entry::Sub(i, _) => !i.disabled,
        _ => false,
    })
}

fn render_row(
    ix: usize,
    item: MenuItem,
    sub: Option<&MenuBuilder>,
    style: MenuStyle,
    level: &Entity<MenuLevel>,
    ctx: &Rc<Ctx>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> (AnyElement, Option<AnyElement>) {
    let state = level.read(cx);
    let highlighted = state.highlighted == Some(ix);
    let sub_open = sub.is_some() && state.sub_open == Some(ix);
    let row_bounds = state.rows.get(ix).cloned().unwrap_or_default();
    let active = highlighted || sub_open;
    let fg = t.var_or("--popover-foreground", t.foreground);
    let accent_fg = t.accent_foreground;
    let text = if item.destructive { t.destructive } else if active { accent_fg } else { fg };
    let context = style == MenuStyle::Context;

    let mut row = div()
        .id(ix)
        .relative()
        .flex()
        .items_center()
        .tw_rounded_lg()
        .whitespace_nowrap()
        .text_color(text)
        .child(popup::bounds_tracker(row_bounds.clone()));

    // Paddings / type per component.
    row = match (style, item.kind, sub.is_some()) {
        (MenuStyle::Dropdown, Kind::Plain, _) => row.gap(px(6.)).px(px(6.)).py_1().tw_text_sm(),
        (MenuStyle::Dropdown, _, _) => row.gap(px(6.)).py_1().pl(px(6.)).pr_8().tw_text_sm(),
        (MenuStyle::Context, Kind::Plain, true) => row.gap_2().px_2().py(px(6.)).tw_text_sm(),
        (MenuStyle::Context, Kind::Plain, false) => row.gap_2().px_2().py(px(6.)).tw_text_xs(),
        (MenuStyle::Context, _, _) => row.gap_2().py(px(6.)).pl_8().pr_2().tw_text_sm(),
    };
    if item.inset && !context {
        row = row.pl_7();
    }
    if active {
        row = row.bg(highlight_bg(t, style, item.kind, item.destructive));
    }
    if item.disabled {
        row = row.opacity(0.5);
    }

    // Indicators.
    match (style, item.kind) {
        (MenuStyle::Dropdown, Kind::Check(true) | Kind::Radio(true)) => {
            row = row.child(
                div().absolute().right_2().flex().items_center().justify_center()
                    .child(Icon::new(IconName::Check).size_4()),
            );
        }
        (MenuStyle::Context, Kind::Check(on)) => {
            row = row.child(
                div().absolute().left_2().size(px(14.)).flex().items_center().justify_center()
                    .when(on, |d| d.child(Icon::new(IconName::Check).size_4())),
            );
        }
        (MenuStyle::Context, Kind::Radio(on)) => {
            row = row.child(
                div().absolute().left_2().size(px(14.)).flex().items_center().justify_center()
                    .when(on, |d| d.child(div().size_2().rounded_full().bg(text))),
            );
        }
        _ => {}
    }

    let icon_size = item.icon_size.unwrap_or(if context { 14. } else { 16. });
    row = row
        .children(item.icon.map(|i| Icon::new(i).size(px(icon_size)).flex_shrink_0()))
        .children(item.leading)
        .child(item.label.clone());
    if let Some(shortcut) = item.shortcut.clone() {
        row = row.child(
            div()
                .ml_auto()
                .pl_4()
                .tw_text_xs()
                .text_color(if active && !context { accent_fg } else { t.muted_foreground })
                .child(tracked(shortcut, 0.1)),
        );
    }
    if sub.is_some() {
        row = row.child(div().ml_auto().child(Icon::new(IconName::ChevronRight).size_4()));
    }

    let mut sub_panel = None;
    if !item.disabled {
        let lv = level.clone();
        let is_sub = sub.is_some();
        row = row.on_hover(move |hovered, _, cx| {
            lv.update(cx, |s, cx| {
                if *hovered {
                    s.highlighted = Some(ix);
                    if is_sub {
                        s.open_sub(ix, None, cx);
                    } else if s.sub_open.is_some() {
                        s.close_sub(cx);
                    }
                } else if s.highlighted == Some(ix) && s.sub_open != Some(ix) {
                    s.highlighted = None;
                }
                cx.notify();
            });
        });
        if let Some(builder) = sub {
            let lv = level.clone();
            row = row.on_click(move |_, _, cx| lv.update(cx, |s, cx| s.open_sub(ix, None, cx)));
            if sub_open {
                let sub_level = level.read(cx).sub.clone();
                if let Some(sub_level) = sub_level {
                    let generation = level.read(cx).generation;
                    let menu = builder(Menu::new(style), window, cx);
                    let panel = render_panel(menu, &sub_level, true, ctx, popup::sub_id(&ctx.id, format!("sub{generation}")), window, cx);
                    sub_panel = Some(popup::floating(row_bounds.get(), Side::Right, Align::Start, 8., -3., panel));
                }
            }
        } else {
            let handler = item.on_select.clone();
            let close = ctx.close.clone();
            let keep_open = item.keep_open;
            row = row.on_click(move |_, window, cx| {
                if !keep_open {
                    close(window, cx);
                }
                if let Some(h) = &handler {
                    h(window, cx);
                }
            });
        }
    }
    (row.into_any_element(), sub_panel)
}

fn render_panel(
    menu: Menu,
    level: &Entity<MenuLevel>,
    is_sub: bool,
    ctx: &Rc<Ctx>,
    anim_id: impl Into<ElementId>,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let t = cx.tokens().clone();
    let style = menu.style;
    let count = menu.entries.len();
    level.update(cx, |s, _| s.rows.resize_with(count, Default::default));

    let mut nav_items = Vec::with_capacity(count);
    let mut children = Vec::with_capacity(count);
    let mut subs = Vec::new();
    for (ix, entry) in menu.entries.into_iter().enumerate() {
        match entry {
            Entry::Item(item) => {
                nav_items.push(NavItem {
                    selectable: !item.disabled,
                    sub: false,
                    handler: item.on_select.clone(),
                    keep_open: item.keep_open,
                    sub_first: None,
                });
                let (row, _) = render_row(ix, item, None, style, level, ctx, &t, window, cx);
                children.push(row);
            }
            Entry::Sub(item, builder) => {
                // Peek at the sub-menu to know its first row for keyboard opening.
                let first = first_selectable(&builder(Menu::new(style), window, cx));
                nav_items.push(NavItem { selectable: !item.disabled, sub: true, handler: None, keep_open: true, sub_first: first });
                let (row, sub) = render_row(ix, item, Some(&builder), style, level, ctx, &t, window, cx);
                children.push(row);
                subs.extend(sub);
            }
            Entry::Label(text, inset) => {
                nav_items.push(NavItem { selectable: false, sub: false, handler: None, keep_open: false, sub_first: None });
                let el = match style {
                    MenuStyle::Dropdown => div()
                        .px(px(6.))
                        .py_1()
                        .tw_text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .when(inset, |d| d.pl_7()),
                    MenuStyle::Context => div().px_2().py(px(6.)).tw_text_sm().font_weight(FontWeight::SEMIBOLD),
                };
                children.push(el.text_color(t.muted_foreground).child(text).into_any_element());
            }
            Entry::Separator => {
                nav_items.push(NavItem { selectable: false, sub: false, handler: None, keep_open: false, sub_first: None });
                children.push(div().h(px(1.)).my_1().mx(px(-4.)).bg(t.border).into_any_element());
            }
            Entry::Custom(el) => {
                nav_items.push(NavItem { selectable: false, sub: false, handler: None, keep_open: false, sub_first: None });
                children.push(el);
            }
        }
    }
    ctx.nav.borrow_mut().push(NavLevel { level: level.clone(), items: nav_items });

    let (min_w, shadows) = match (style, is_sub) {
        (MenuStyle::Dropdown, false) => (192., popup::shadow_md()),
        (MenuStyle::Dropdown, true) => (96., popup::shadow_lg()),
        (MenuStyle::Context, false) => (160., popup::shadow_2xl()),
        (MenuStyle::Context, true) => (128., popup::shadow_lg()),
    };
    let panel = div()
        .id("menu-content")
        .flex()
        .flex_col()
        .min_w(px(menu.min_w.unwrap_or(min_w)))
        .when_some(menu.w, |d, w| d.w(px(w)))
        .when_some(menu.max_h, |d, h| d.max_h(px(h)))
        .p_1()
        .tw_rounded_lg()
        .bg(t.menu_bg())
        .text_color(t.var_or("--popover-foreground", t.foreground))
        .shadow(popup::with_ring(shadows, t.border))
        .overflow_y_scroll()
        .occlude()
        .children(children);
    div().child(popup::animate_in(div().child(panel), anim_id, Side::Bottom, 100)).children(subs)
}

/// Keyboard handling on the focused root panel; acts on the deepest open level.
fn handle_key(event: &KeyDownEvent, nav: &[NavLevel], close: &Handler, window: &mut Window, cx: &mut App) -> bool {
    // Find the deepest level that is actually open (sub levels are pushed after parents).
    let Some(depth) = (0..nav.len()).rev().find(|&i| i == 0 || nav[i - 1].level.read(cx).sub_open.is_some()) else {
        return false;
    };
    let cur = &nav[depth];
    let selectable: Vec<usize> = cur.items.iter().enumerate().filter(|(_, i)| i.selectable).map(|(ix, _)| ix).collect();
    let highlighted = cur.level.read(cx).highlighted;
    let step = |dir: i32| -> Option<usize> {
        if selectable.is_empty() {
            return None;
        }
        let pos = highlighted.and_then(|h| selectable.iter().position(|&s| s == h));
        let n = selectable.len() as i32;
        let next = match pos {
            // Radix menus don't loop.
            Some(p) => (p as i32 + dir).clamp(0, n - 1),
            None if dir > 0 => 0,
            None => n - 1,
        };
        Some(selectable[next as usize])
    };
    let set = |ix: Option<usize>, cx: &mut App| {
        cur.level.update(cx, |s, cx| {
            s.highlighted = ix;
            if s.sub_open.is_some() && s.sub_open != ix {
                s.close_sub(cx);
            }
            cx.notify();
        })
    };
    match event.keystroke.key.as_str() {
        "down" => set(step(1), cx),
        "up" => set(step(-1), cx),
        "home" => set(selectable.first().copied(), cx),
        "end" => set(selectable.last().copied(), cx),
        "escape" => close(window, cx),
        "left" if depth > 0 => nav[depth - 1].level.update(cx, |s, cx| s.close_sub(cx)),
        "right" | "enter" | "space" => {
            let Some(ix) = highlighted else { return true };
            let Some(item) = cur.items.get(ix) else { return true };
            if item.sub {
                let first = item.sub_first;
                cur.level.update(cx, |s, cx| s.open_sub(ix, first, cx));
            } else if event.keystroke.key != "right" {
                if !item.keep_open {
                    close(window, cx);
                }
                if let Some(h) = &item.handler {
                    h(window, cx);
                }
            }
        }
        _ => return false,
    }
    true
}

/// Render an open menu panel (shared by dropdown / context / custom triggers).
fn render_menu(
    id: ElementId,
    state: &Entity<PopupState>,
    builder: &MenuBuilder,
    style: MenuStyle,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let level = window.use_keyed_state(popup::sub_id(&id, "level"), cx, |_, _| MenuLevel::new());
    let st = state.clone();
    let lv = level.clone();
    let close: Handler = Rc::new(move |window, cx| {
        lv.update(cx, |l, _| l.reset());
        st.update(cx, |s, cx| s.hide(window, cx));
    });
    let generation = state.read(cx).generation;
    let ctx = Rc::new(Ctx { close: close.clone(), nav: Rc::new(RefCell::new(Vec::new())), id: id.clone() });
    let menu = builder(Menu::new(style), window, cx);
    let panel = render_panel(menu, &level, false, &ctx, popup::sub_id(&id, generation), window, cx);
    let focus = state.read(cx).focus.clone();
    let trigger = state.read(cx).trigger.clone();
    let content = state.read(cx).content.clone();
    let nav = ctx.nav.clone();
    let close_out = close.clone();
    let close_key = close;
    div()
        .id(("menu-root", generation))
        .relative()
        .track_focus(&focus)
        .child(popup::bounds_tracker(content))
        .on_key_down(move |event, window, cx| {
            if handle_key(event, &nav.borrow(), &close_key, window, cx) {
                cx.stop_propagation();
            }
        })
        .on_mouse_down_out(move |event, window, cx| {
            // Clicks on the trigger toggle via the trigger itself.
            if style == MenuStyle::Dropdown && trigger.get().contains(&event.position) {
                return;
            }
            close_out(window, cx);
        })
        .child(panel)
}

// ---- DropdownMenu ------------------------------------------------------------------

/// `<DropdownMenu><DropdownMenuTrigger/><DropdownMenuContent/></DropdownMenu>`.
/// Opens on left mouse-down (like Radix), toggles on re-press.
#[derive(IntoElement)]
pub struct DropdownMenu {
    id: ElementId,
    trigger: Option<Box<dyn FnOnce(bool) -> AnyElement>>,
    builder: Option<MenuBuilder>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    full_width: bool,
}

impl DropdownMenu {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            trigger: None,
            builder: None,
            side: Side::Bottom,
            align: Align::Start,
            side_offset: 4.,
            align_offset: 0.,
            full_width: false,
        }
    }
    pub fn trigger(mut self, el: impl IntoElement + 'static) -> Self {
        self.trigger = Some(Box::new(move |_| el.into_any_element()));
        self
    }
    /// Trigger that renders differently while open (`aria-expanded`).
    pub fn trigger_with<E: IntoElement>(mut self, f: impl FnOnce(bool) -> E + 'static) -> Self {
        self.trigger = Some(Box::new(move |open| f(open).into_any_element()));
        self
    }
    pub fn menu(mut self, f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        self.builder = Some(Rc::new(f));
        self
    }
    pub fn side(mut self, side: Side) -> Self {
        self.side = side;
        self
    }
    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
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
    pub fn w_full(mut self) -> Self {
        self.full_width = true;
        self
    }
}

impl RenderOnce for DropdownMenu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = PopupState::keyed(self.id.clone(), window, cx);
        let open = state.read(cx).open;
        let trigger_bounds = state.read(cx).trigger.clone();
        let st = state.clone();
        let mut el = div()
            .id(self.id.clone())
            .relative()
            .flex_shrink_0()
            .when(self.full_width, |d| d.w_full())
            .child(popup::bounds_tracker(trigger_bounds.clone()))
            .children(self.trigger.map(|f| f(open)))
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                st.update(cx, |s, cx| s.toggle(window, cx));
            });
        if open {
            if let Some(builder) = &self.builder {
                let panel = render_menu(self.id.clone(), &state, builder, MenuStyle::Dropdown, window, cx);
                el = el.child(popup::floating(
                    trigger_bounds.get(),
                    self.side,
                    self.align,
                    self.side_offset,
                    self.align_offset,
                    panel,
                ));
            }
        }
        el
    }
}

// ---- ContextMenu ---------------------------------------------------------------------

/// `<ContextMenu><ContextMenuTrigger>{child}</ContextMenuTrigger><ContextMenuContent/></ContextMenu>`:
/// right-click anywhere on the child opens the menu at the pointer.
#[derive(IntoElement)]
pub struct ContextMenu {
    id: ElementId,
    children: Vec<AnyElement>,
    builder: Option<MenuBuilder>,
    full: bool,
    on_open: Option<Handler>,
}

impl ContextMenu {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), children: Vec::new(), builder: None, full: false, on_open: None }
    }
    pub fn menu(mut self, f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        self.builder = Some(Rc::new(f));
        self
    }
    /// Make the trigger area fill its parent (`size-full`).
    pub fn size_full(mut self) -> Self {
        self.full = true;
        self
    }
    /// Called when the menu opens (e.g. to select the right-clicked row).
    pub fn on_open(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open = Some(Rc::new(f));
        self
    }
}

impl ParentElement for ContextMenu {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for ContextMenu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = PopupState::keyed(self.id.clone(), window, cx);
        let (open, position) = (state.read(cx).open, state.read(cx).position);
        let st = state.clone();
        let on_open = self.on_open.clone();
        let mut el = div()
            .id(self.id.clone())
            .relative()
            .when(self.full, |d| d.size_full())
            .children(self.children)
            .on_mouse_down(MouseButton::Right, move |event, window, cx| {
                let pos = event.position;
                st.update(cx, |s, cx| {
                    s.generation += 1; // re-run the entrance when re-opened elsewhere
                    s.show(window, cx);
                    s.position = Some(pos);
                });
                if let Some(f) = &on_open {
                    f(window, cx);
                }
                cx.stop_propagation();
            });
        if open {
            if let (Some(builder), Some(pos)) = (&self.builder, position) {
                let panel = render_menu(self.id.clone(), &state, builder, MenuStyle::Context, window, cx);
                el = el.child(popup::floating_at(pos, panel));
            }
        }
        el
    }
}

/// Render a menu panel inline (not floating) with row `highlighted` lit —
/// for the ui gallery and visual diffs.
pub fn preview(
    id: impl Into<ElementId>,
    style: MenuStyle,
    highlighted: Option<usize>,
    f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let id: ElementId = id.into();
    let level = window.use_keyed_state(popup::sub_id(&id, "preview"), cx, move |_, _| {
        let mut l = MenuLevel::new();
        l.highlighted = highlighted;
        l
    });
    let ctx = Rc::new(Ctx { close: Rc::new(|_, _| {}), nav: Rc::new(RefCell::new(Vec::new())), id: id.clone() });
    let menu = f(Menu::new(style), window, cx);
    render_panel(menu, &level, false, &ctx, popup::sub_id(&id, "anim"), window, cx).into_any_element()
}
