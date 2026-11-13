//! Popup menus of the studio: components/ui/context-menu.tsx and
//! components/ui/dropdown-menu.tsx look (ring-1 ring-border, rounded-lg, p-1,
//! `--menu-bg` → popover), rendered by the shell so context menus and
//! dropdowns share one implementation.

use crate::icons::Ico;
use crate::studio::{OpenMenu, Studio};
use gpui::{
    anchored, deferred, div, point, prelude::*, px, AnyElement, Context, Hsla, MouseButton, Pixels, Point,
    SharedString, Window,
};
use rexa_ui::{white, with_alpha, ActiveTokens, Tw};
use std::rc::Rc;

pub type MenuAction = Rc<dyn Fn(&mut Studio, &mut Window, &mut Context<Studio>)>;

#[derive(Clone, Copy, PartialEq)]
pub enum Tone {
    Normal,
    Destructive,
    /// text-amber-500 (Truncate Table)
    Amber,
    /// text-red-500 (Delete Table)
    Red,
}

#[derive(Clone, Copy, PartialEq)]
pub enum MenuStyle {
    /// context-menu.tsx items: px-2 py-1.5 text-xs
    Context,
    /// dropdown-menu.tsx items: px-1.5 py-1 text-sm gap-1.5
    Dropdown,
}

pub enum MenuEntry {
    Label(SharedString),
    Separator,
    Item {
        label: SharedString,
        icon: Option<Ico>,
        tone: Tone,
        checked: bool,
        swatch: Option<Hsla>,
        disabled: bool,
        action: MenuAction,
    },
    Submenu {
        label: SharedString,
        items: Vec<MenuEntry>,
    },
}

impl MenuEntry {
    pub fn item(label: impl Into<SharedString>, action: impl Fn(&mut Studio, &mut Window, &mut Context<Studio>) + 'static) -> Self {
        MenuEntry::Item {
            label: label.into(),
            icon: None,
            tone: Tone::Normal,
            checked: false,
            swatch: None,
            disabled: false,
            action: Rc::new(action),
        }
    }
    pub fn icon(mut self, ico: Ico) -> Self {
        if let MenuEntry::Item { icon, .. } = &mut self {
            *icon = Some(ico);
        }
        self
    }
    pub fn tone(mut self, t: Tone) -> Self {
        if let MenuEntry::Item { tone, .. } = &mut self {
            *tone = t;
        }
        self
    }
    pub fn checked(mut self, c: bool) -> Self {
        if let MenuEntry::Item { checked, .. } = &mut self {
            *checked = c;
        }
        self
    }
    pub fn swatch(mut self, color: Hsla) -> Self {
        if let MenuEntry::Item { swatch, .. } = &mut self {
            *swatch = Some(color);
        }
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        if let MenuEntry::Item { disabled, .. } = &mut self {
            *disabled = d;
        }
        self
    }
}


impl Studio {
    pub fn open_menu(&mut self, id: impl Into<SharedString>, position: Point<Pixels>, min_width: f32, items: Vec<MenuEntry>, cx: &mut Context<Self>) {
        self.menu = Some(OpenMenu { id: id.into(), position, min_width, items, open_sub: None });
        cx.notify();
    }

    pub fn close_menu(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            cx.notify();
        }
    }

    pub fn menu_is_open(&self, id: &str) -> bool {
        self.menu.as_ref().is_some_and(|m| m.id.as_ref() == id)
    }

    pub fn render_menu(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = self.menu.as_ref()?;
        let style = if menu.id.starts_with("dd:") { MenuStyle::Dropdown } else { MenuStyle::Context };
        let body = menu_box(&menu.items, style, menu.min_width, menu.open_sub, true, cx);
        Some(
            deferred(
                anchored()
                    .position(menu.position)
                    .snap_to_window_with_margin(px(8.))
                    .child(
                        div()
                            .occlude()
                            .on_mouse_down_out(cx.listener(|this, _, _, cx| this.close_menu(cx)))
                            .child(body),
                    ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }
}

fn menu_box(items: &[MenuEntry], style: MenuStyle, min_width: f32, open_sub: Option<usize>, top: bool, cx: &mut Context<Studio>) -> gpui::Div {
    let t = cx.tokens().clone();
    let bg = t.var("--menu-bg").unwrap_or(t.popover);
    let mut el = div()
        .flex()
        .flex_col()
        .min_w(px(min_width))
        .p_1()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .bg(bg)
        .text_color(t.foreground)
        .shadow(vec![gpui::BoxShadow {
            color: gpui::hsla(0., 0., 0., 0.25),
            offset: point(px(0.), px(25.)),
            blur_radius: px(50.),
            spread_radius: px(-12.),
            inset: false,
        }]);
    for (i, entry) in items.iter().enumerate() {
        el = el.child(render_entry(entry, i, style, open_sub == Some(i) && top, top, &t, cx));
    }
    el
}

fn render_entry(entry: &MenuEntry, index: usize, style: MenuStyle, sub_open: bool, top: bool, t: &rexa_ui::Tokens, cx: &mut Context<Studio>) -> AnyElement {
    let hover_bg = if t.dark { white(0.1) } else { t.accent };
    let row = |id: SharedString| {
        let mut r = div().id(id).flex().items_center().gap(px(6.)).tw_rounded_lg().whitespace_nowrap().cursor_default();
        r = match style {
            MenuStyle::Context => r.px_2().py(px(6.)).tw_text_xs(),
            MenuStyle::Dropdown => r.px(px(6.)).py_1().tw_text_sm(),
        };
        r
    };
    match entry {
        MenuEntry::Label(l) => div()
            .px(px(6.))
            .py_1()
            .tw_text_xs()
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(t.muted_foreground)
            .child(l.clone())
            .into_any_element(),
        MenuEntry::Separator => div().mx(px(-4.)).my_1().h(px(1.)).bg(t.border).into_any_element(),
        MenuEntry::Item { label, icon, tone, checked, swatch, disabled, action } => {
            let color = match tone {
                Tone::Normal => t.foreground,
                Tone::Destructive => t.destructive,
                Tone::Amber => rexa_ui::tw("amber-500"),
                Tone::Red => rexa_ui::tw("red-500"),
            };
            let hover = match tone {
                Tone::Normal => hover_bg,
                Tone::Destructive => with_alpha(t.destructive, if t.dark { 0.2 } else { 0.1 }),
                Tone::Amber => with_alpha(rexa_ui::tw("amber-500"), 0.1),
                Tone::Red => with_alpha(rexa_ui::tw("red-500"), 0.1),
            };
            let icon_size = if style == MenuStyle::Context { 14. } else { 16. };
            let action = action.clone();
            let disabled = *disabled;
            row(SharedString::from(format!("menu-item-{index}-{label}")))
                .text_color(color)
                .when(disabled, |r| r.opacity(0.5))
                .when(!disabled, |r| {
                    r.hover(move |s| s.bg(hover)).on_click(cx.listener(move |this, _, window, cx| {
                        this.menu = None;
                        action(this, window, cx);
                        cx.notify();
                    }))
                })
                .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                    if *hovered && top {
                        if let Some(m) = this.menu.as_mut() {
                            if m.open_sub.is_some() {
                                m.open_sub = None;
                                cx.notify();
                            }
                        }
                    }
                }))
                .children(swatch.map(|c| div().size(px(8.)).mr_2().tw_rounded_lg().bg(c)))
                .children(icon.map(|i| i.el(icon_size, if *tone == Tone::Normal { t.muted_foreground } else { color })))
                .child(div().flex_1().child(label.clone()))
                .when(*checked, |r| r.child(crate::icons::lucide("check").el(14., rexa_ui::tw("emerald-500"))))
                .into_any_element()
        }
        MenuEntry::Submenu { label, items } => {
            let sub = sub_open.then(|| {
                div()
                    .absolute()
                    .left_full()
                    .top(px(-5.))
                    .pl_1()
                    .child(menu_box(items, style, 128., None, false, cx))
            });
            row(SharedString::from(format!("menu-sub-{index}-{label}")))
                .relative()
                .when(sub_open, |r| r.bg(hover_bg))
                .hover(move |s| s.bg(hover_bg))
                .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                    if *hovered {
                        if let Some(m) = this.menu.as_mut() {
                            m.open_sub = Some(index);
                            cx.notify();
                        }
                    }
                }))
                .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, _, cx| {
                    if let Some(m) = this.menu.as_mut() {
                        m.open_sub = Some(index);
                        cx.notify();
                    }
                }))
                .child(div().flex_1().child(label.clone()))
                .child(crate::icons::lucide("chevron-right").el(16., t.muted_foreground))
                .children(sub)
                .into_any_element()
        }
    }
}
