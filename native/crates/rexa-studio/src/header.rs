//! Port of components/app-shell/modern-vscode-header.tsx (floating title bar:
//! back/forward + connection dropdown + search bar centered, layout toggles on
//! the right), modern-ui-search.tsx, modern-connection-dropdown.tsx,
//! vscode-layout-icons.tsx and customize-layout-popover.tsx (as a menu).

use crate::icons::{self, Ico};
use crate::keybindings;
use crate::menu::MenuEntry;
use crate::studio::Studio;
use gpui::{div, PathBuilder, prelude::*, px, AnyElement, Context, MouseButton, SharedString};
use rexa_ui::{with_alpha, ActiveTokens, Tw};

/// Codicon paths (16×16) used by the layout toggles.
pub mod codicons {
    pub const SIDEBAR_LEFT_ON: &str = "M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z";
    pub const SIDEBAR_LEFT_OFF: &str = "M1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1H3.5C2.122 1 1 2.122 1 3.5ZM12.5 14H7V2H12.5C13.327 2 14 2.673 14 3.5V12.5C14 13.327 13.327 14 12.5 14ZM2 3.5C2 2.673 2.673 2 3.5 2H6V14H3.5C2.673 14 2 13.327 2 12.5V3.5Z";
    pub const SIDEBAR_RIGHT_ON: &str = "M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM9 14V2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H9Z";
    pub const SIDEBAR_RIGHT_OFF: &str = "M12.5 1H3.5C2.122 1 1 2.122 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1ZM2 12.5V3.5C2 2.673 2.673 2 3.5 2H9V14H3.5C2.673 14 2 13.327 2 12.5ZM14 12.5C14 13.327 13.327 14 12.5 14H10V2H12.5C13.327 2 14 2.673 14 3.5V12.5Z";
    pub const PANEL_ON: &str = "M15 12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5C13.881 1 15 2.119 15 3.5V12.5ZM2 10H14V3.5C14 2.672 13.328 2 12.5 2H3.5C2.672 2 2 2.672 2 3.5V10Z";
    pub const PANEL_OFF: &str = "M12.5 1H3.5C2.122 1 1 2.121 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.121 13.878 1 12.5 1ZM14 12.5C14 13.327 13.327 14 12.5 14H3.5C2.673 14 2 13.327 2 12.5V11H14V12.5ZM14 10H2V3.5C2 2.673 2.673 2 3.5 2H12.5C13.327 2 14 2.673 14 3.5V10Z";
    pub const CUSTOMIZE: [&str; 3] = [
        "M5.5 1C6.327 1 7 1.673 7 2.5V13.5C7 14.327 6.327 15 5.5 15H2.5C1.673 15 1 14.327 1 13.5V2.5C1 1.673 1.673 1 2.5 1H5.5ZM2.5 2C2.225 2 2 2.225 2 2.5V13.5C2 13.775 2.225 14 2.5 14H5.5C5.775 14 6 13.775 6 13.5V2.5C6 2.225 5.775 2 5.5 2H2.5Z",
        "M13.5 9C14.327 9 15 9.673 15 10.5V13.5C15 14.327 14.327 15 13.5 15H10.5C9.673 15 9 14.327 9 13.5V10.5C9 9.673 9.673 9 10.5 9H13.5ZM10.5 10C10.225 10 10 10.225 10 10.5V13.5C10 13.775 10.225 14 10.5 14H13.5C13.775 14 14 13.775 14 13.5V10.5C14 10.225 13.775 10 13.5 10H10.5Z",
        "M13.5 1C14.327 1 15 1.673 15 2.5V5.5C15 6.327 14.327 7 13.5 7H10.5C9.673 7 9 6.327 9 5.5V2.5C9 1.673 9.673 1 10.5 1H13.5ZM10.5 2C10.225 2 10 2.225 10 2.5V5.5C10 5.775 10.225 6 10.5 6H13.5C13.775 6 14 5.775 14 5.5V2.5C14 2.225 13.775 2 13.5 2H10.5Z",
    ];
}

/// Paint SVG path data (16×16 viewBox, nonzero fill) at `size` px.
pub fn codicon(paths: Vec<&'static str>, size: f32, color: gpui::Hsla) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let scale = size / 16.;
            for d in &paths {
                if let Some(path) = svg_path(d, bounds.origin, scale) {
                    window.paint_path(path, color);
                }
            }
        },
    )
    .size(px(size))
    .flex_shrink_0()
}

/// Minimal SVG path parser for the codicon subset (M L H V C Z, absolute).
fn svg_path(d: &str, origin: gpui::Point<gpui::Pixels>, scale: f32) -> Option<gpui::Path<gpui::Pixels>> {
    let mut b = PathBuilder::fill();
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in d.chars() {
        if ch.is_ascii_alphabetic() {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            tokens.push(ch.to_string());
        } else if ch == ' ' || ch == ',' {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
        } else if ch == '-' && !cur.is_empty() && !cur.ends_with('e') {
            tokens.push(std::mem::take(&mut cur));
            cur.push(ch);
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    let pt = |x: f32, y: f32| gpui::point(origin.x + px(x * scale), origin.y + px(y * scale));
    let (mut x, mut y, mut sx, mut sy) = (0f32, 0f32, 0f32, 0f32);
    let mut i = 0;
    let mut cmd = 'M';
    let num = |i: &mut usize| -> Option<f32> {
        let v = tokens.get(*i)?.parse::<f32>().ok()?;
        *i += 1;
        Some(v)
    };
    while i < tokens.len() {
        if let Some(c) = tokens[i].chars().next().filter(|c| c.is_ascii_alphabetic()) {
            cmd = c;
            i += 1;
            if cmd == 'Z' || cmd == 'z' {
                b.close();
                x = sx;
                y = sy;
                continue;
            }
        }
        match cmd {
            'M' => {
                x = num(&mut i)?;
                y = num(&mut i)?;
                sx = x;
                sy = y;
                b.move_to(pt(x, y));
                cmd = 'L';
            }
            'L' => {
                x = num(&mut i)?;
                y = num(&mut i)?;
                b.line_to(pt(x, y));
            }
            'H' => {
                x = num(&mut i)?;
                b.line_to(pt(x, y));
            }
            'V' => {
                y = num(&mut i)?;
                b.line_to(pt(x, y));
            }
            'C' => {
                let (x1, y1, x2, y2) = (num(&mut i)?, num(&mut i)?, num(&mut i)?, num(&mut i)?);
                x = num(&mut i)?;
                y = num(&mut i)?;
                b.cubic_bezier_to(pt(x, y), pt(x1, y1), pt(x2, y2));
            }
            _ => return None,
        }
    }
    b.build().ok()
}

impl Studio {
    /// navButtonClass: size-[22px] rounded-[4px] text-muted-foreground hover:bg-sidebar hover:text-foreground [&_svg]:size-3.5
    fn nav_button(&self, id: &str, disabled: bool, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        div()
            .id(SharedString::from(id.to_string()))
            .size(px(22.))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .rounded(px(4.))
            .text_color(t.muted_foreground)
            .when(disabled, |d| d.opacity(0.5))
            .when(!disabled, |d| d.cursor_pointer().hover(move |s| s.bg(t.sidebar).text_color(t.foreground)))
    }

    fn layout_toggle(&self, id: &str, path: &'static str, tooltip: String, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        let tip: SharedString = tooltip.into();
        self.nav_button(id, false, cx)
            .tooltip(move |w, cx| rexa_ui::overlay::tooltip::Tooltip::new(tip.clone()).build(w, cx))
            .child(codicon(vec![path], 14., t.muted_foreground))
    }

    pub fn render_title_bar(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let kb = self.keybindings.clone();
        let shortcut = |kind: &str| keybindings::combo_for(&kb, kind).map(keybindings::format_shortcut);
        let with_sc = |label: &str, kind: &str| match shortcut(kind) {
            Some(s) => format!("{label} ({s})"),
            None => label.to_string(),
        };
        let back = self.nav_button("nav-back", true, cx).child(icons::S_LEFT.el(14., t.muted_foreground));
        let forward = self.nav_button("nav-forward", true, cx).child(icons::S_RIGHT.el(14., t.muted_foreground));

        // ModernConnectionDropdown trigger
        let conn_name: SharedString = self.connection.as_ref().map(|c| c.name.clone()).unwrap_or_default().into();
        let conn_open = self.menu_is_open("dd:header-connections");
        let connection = div()
            .id("header-connection")
            .flex()
            .items_center()
            .gap(px(6.))
            .h(px(22.))
            .max_w(px(180.))
            .px_2()
            .rounded(px(4.))
            .tw_text_11()
            .text_color(t.muted_foreground)
            .cursor_pointer()
            .when(conn_open, |d| d.bg(t.sidebar).text_color(t.foreground))
            .hover(move |s| s.bg(t.sidebar).text_color(t.foreground))
            .on_mouse_down(MouseButton::Left, cx.listener(|this, e: &gpui::MouseDownEvent, _, cx| {
                cx.stop_propagation();
                let items = this.connection_menu_items();
                this.open_menu("dd:header-connections", gpui::point(e.position.x - px(40.), px(32.)), 224., items, cx);
            }))
            .children(self.connection.as_ref().map(|c| crate::sidebar::provider_logo(&c.kind, 14.)))
            .child(div().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().child(conn_name))
            .child(icons::lucide("chevrons-up-down").el(12., t.muted_foreground).opacity(0.7));

        // ModernUISearchBar: h-[22px] w-64 rounded-[4px] border bg-sidebar px-2.5 text-[11px]
        let search_kbd = keybindings::shortcut_label(&kb, "TOGGLE_COMMAND_MENU", "Cmd+K");
        let search = div()
            .id("header-search")
            .flex()
            .items_center()
            .gap(px(6.))
            .h(px(22.))
            .w_64()
            .px(px(10.))
            .rounded(px(4.))
            .border_1()
            .border_color(t.border)
            .bg(t.sidebar)
            .tw_text_11()
            .tw_leading_none()
            .text_color(t.muted_foreground)
            .cursor_pointer()
            .hover(move |s| s.text_color(t.foreground))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(|this, _, window, cx| this.toggle_command_menu(window, cx)))
            .child(icons::lucide("search").el(12., gpui::Hsla::default()))
            .child(div().flex_1().min_w_0().child("Search"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .h(px(14.))
                    .px_1()
                    .rounded(px(4.))
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.background, 0.6))
                    .tw_text_10()
                    .tw_leading_none()
                    .text_color(t.muted_foreground)
                    .child(search_kbd),
            );

        let center = div()
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .child(div().flex().items_center().justify_center().gap_1().child(back).child(forward).child(connection).child(search));

        let sidebar_open = self.sidebar_open();
        let right = div()
            .relative()
            .ml_auto()
            .flex()
            .items_center()
            .justify_end()
            .gap(px(2.))
            .child(
                self.layout_toggle(
                    "toggle-sidebar",
                    if sidebar_open { codicons::SIDEBAR_LEFT_ON } else { codicons::SIDEBAR_LEFT_OFF },
                    with_sc("Toggle Primary Side Bar", "TOGGLE_SIDEBAR"),
                    cx,
                )
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |this, _, _, cx| this.set_sidebar_open(!sidebar_open, cx))),
            )
            .child(
                self.layout_toggle(
                    "toggle-secondary",
                    if self.ai_open { codicons::SIDEBAR_RIGHT_ON } else { codicons::SIDEBAR_RIGHT_OFF },
                    with_sc("Toggle Secondary Side Bar", "TOGGLE_AI_PANEL"),
                    cx,
                )
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(|this, _, _, cx| this.toggle_ai(cx))),
            )
            .child(
                self.layout_toggle(
                    "toggle-panel",
                    if self.panel_open { codicons::PANEL_ON } else { codicons::PANEL_OFF },
                    with_sc("Toggle Panel", "TOGGLE_BOTTOM_PANEL"),
                    cx,
                )
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(|this, _, _, cx| {
                    this.panel_open = !this.panel_open;
                    cx.notify();
                })),
            )
            .child(
                self.nav_button("customize-layout", false, cx)
                    .tooltip(|w, cx| rexa_ui::overlay::tooltip::Tooltip::new("Customize Layout...").build(w, cx))
                    .on_mouse_down(MouseButton::Left, cx.listener(|this, e: &gpui::MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let items = this.customize_layout_items();
                        this.open_menu("dd:customize-layout", gpui::point(e.position.x - px(220.), px(32.)), 240., items, cx);
                    }))
                    .child(codicon(codicons::CUSTOMIZE.to_vec(), 14., t.muted_foreground)),
            );

        // absolute inset-x-0 top-0 h-[measured 40px] px-2, traffic-light inset 72px; drag region.
        div()
            .id("title-bar")
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .h_10()
            .flex()
            .items_center()
            .gap_2()
            .pl(px(72.))
            .pr_2()
            .on_mouse_down(MouseButton::Left, |e, window, _| {
                if e.click_count == 2 {
                    window.titlebar_double_click();
                } else {
                    window.start_window_move();
                }
            })
            .child(center)
            .child(right)
            .into_any_element()
    }

    pub fn connection_menu_items(&self) -> Vec<MenuEntry> {
        let mut items = vec![MenuEntry::Label("Connections".into())];
        if self.connections.is_empty() {
            items.push(MenuEntry::item("No connections", |_, _, _| {}).disabled(true));
        }
        for c in &self.connections {
            let id = c.id;
            items.push(MenuEntry::item(c.name.clone(), move |s, _, cx| s.switch_connection(id, cx)).checked(id == self.connection_id));
        }
        items.push(MenuEntry::Separator);
        items.push(MenuEntry::item("New connection", |s, _, cx| s.go_home(cx)).icon(icons::lucide("plus")));
        items
    }

    /// customize-layout-popover.tsx, condensed to its toggles.
    fn customize_layout_items(&self) -> Vec<MenuEntry> {
        let kb = &self.keybindings;
        let label = |name: &str, kind: &str| match keybindings::combo_for(kb, kind) {
            Some(c) => format!("{name}    {}", keybindings::format_shortcut(c)),
            None => name.to_string(),
        };
        vec![
            MenuEntry::Label("Visibility".into()),
            MenuEntry::item(label("Activity Bar", "TOGGLE_ACTIVITY_BAR"), |s, _, cx| {
                s.activity_bar_open = !s.activity_bar_open;
                cx.notify();
            })
            .checked(self.activity_bar_open),
            MenuEntry::item(label("Primary Side Bar", "TOGGLE_SIDEBAR"), |s, _, cx| {
                let open = s.sidebar_open();
                s.set_sidebar_open(!open, cx)
            })
            .checked(self.sidebar_open()),
            MenuEntry::item(label("Secondary Side Bar", "TOGGLE_AI_PANEL"), |s, _, cx| s.toggle_ai(cx)).checked(self.ai_open),
            MenuEntry::item(label("Panel", "TOGGLE_BOTTOM_PANEL"), |s, _, cx| {
                s.panel_open = !s.panel_open;
                cx.notify();
            })
            .checked(self.panel_open),
            MenuEntry::item(label("Status Bar", "TOGGLE_STATUS_BAR"), |s, _, cx| {
                s.status_bar_open = !s.status_bar_open;
                cx.notify();
            })
            .checked(self.status_bar_open),
        ]
    }

    /// handleToggleAiSheet (sidebar mode): opening AI closes the SQL sheet.
    pub fn toggle_ai(&mut self, cx: &mut Context<Self>) {
        self.ai_open = !self.ai_open;
        if self.ai_open {
            self.sql_sheet_open = false;
        }
        cx.notify();
    }

    pub fn toggle_sql_sheet(&mut self, cx: &mut Context<Self>) {
        self.sql_sheet_open = !self.sql_sheet_open;
        if self.sql_sheet_open {
            self.ai_open = false;
        }
        cx.notify();
    }
}

#[allow(dead_code)]
fn _ico(_: Ico) {}
