//! Port of components/app-shell/modern-ui-shell.tsx + components/studio/studio-interface.tsx
//! layout: rail | sidebar card | content card (+ bottom panel) | SQL sheet | AI | threads,
//! the floating title bar and the status bar; plus the keyboard dispatch of
//! hooks/use-studio.ts, use-studio-panel-shortcuts.ts and the shell's chrome toggles.

use crate::keybindings::{self, Keybinding};
use crate::resize::Target;
use crate::studio::{Phase, Studio};
use gpui::{div, prelude::*, px, AnyElement, Context, KeyDownEvent, MouseButton, Window};
use rexa_ui::{ActiveTokens, Tw};

/// Actions handled before editable guards (use-studio.ts "earlyBinding").
const EARLY: &[&str] = &[
    "CLOSE_ACTIVE_TAB",
    "GO_TO_TAB_INDEX",
    "GO_TO_NEXT_TAB",
    "GO_TO_PREVIOUS_TAB",
    "COMMIT_PENDING_CHANGES",
    "RUN_ACTIVE_QUERY",
    "TOGGLE_COMMAND_MENU",
    "TOGGLE_SIDEBAR",
    "OPEN_SQL_EDITOR",
    "OPEN_SETTINGS",
    "OPEN_DATABASE_VIEW",
    "OPEN_SHORTCUT_NAVIGATOR",
    "OPEN_INSERT_SHEET",
    // modern-ui-shell / use-studio-panel-shortcuts / studio-interface (window listeners)
    "TOGGLE_BOTTOM_PANEL",
    "TOGGLE_ACTIVITY_BAR",
    "TOGGLE_STATUS_BAR",
    "TOGGLE_GLOBAL_SQL_PANEL",
    "TOGGLE_AI_PANEL",
    "TOGGLE_PENDING_CHANGES_PANEL",
    "OPEN_UNIVERSAL_SEARCH",
];

impl Studio {
    /// executeKeybindingAction
    pub fn execute_binding(&mut self, b: &Keybinding, window: &mut Window, cx: &mut Context<Self>) -> bool {
        match b.kind.as_str() {
            "NAVIGATE_TABLE" => {
                let (Some(s), Some(t)) = (b.schema.clone(), b.table.clone()) else { return false };
                self.set_selected_schema(s.clone(), cx);
                self.open_table(&t, Some(&s), cx);
            }
            "NAVIGATE_SCHEMA" => {
                let Some(s) = b.schema.clone() else { return false };
                self.set_selected_schema(s, cx);
                self.open_database_tab("schema", cx);
            }
            "GO_TO_TAB_INDEX" => {
                let Some(i) = b.index() else { return false };
                let Some(id) = self.tabs.get(i).map(|t| t.id.clone()) else { return false };
                self.switch_tab(&id, cx);
            }
            "GO_TO_NEXT_TAB" => self.go_relative(1, cx),
            "GO_TO_PREVIOUS_TAB" => self.go_relative(-1, cx),
            "CLOSE_ACTIVE_TAB" => self.close_active_tab(cx),
            "OPEN_SQL_EDITOR" => self.open_sql_editor(None, None, None, cx),
            "RUN_ACTIVE_QUERY" | "STOP_ACTIVE_QUERY" | "REFRESH_CURRENT_TAB" | "COMMIT_PENDING_CHANGES" | "FORMAT_QUERY" | "COPY_QUERY"
            | "OPEN_INSERT_SHEET" => self.tab_command(&b.kind, cx),
            "OPEN_DATABASE_VIEW" => {
                let Some(v) = b.view.clone() else { return false };
                if ["schema", "tables", "functions", "extensions", "triggers", "enums", "indexes", "rls-policies"].contains(&v.as_str()) {
                    self.open_database_tab(&v, cx);
                }
            }
            "OPEN_HISTORY" => self.open_simple("history", cx),
            "OPEN_IMPORT_EXPORT" => self.open_simple("import-export", cx),
            "OPEN_DASHBOARD_HOME" => {
                self.sidebar_view = Some("dashboard".into());
                self.sidebar_visible = true;
                self.persist(cx);
            }
            "OPEN_SETTINGS" => self.open_settings(None, window, cx),
            "OPEN_PROFILE_SETTINGS" => self.open_simple("profile-settings", cx),
            "OPEN_KEYBINDINGS" => self.open_simple("keybindings", cx),
            "OPEN_CREATE_TABLE" => self.open_simple("create-table", cx),
            "OPEN_CREATE_ENUM" => self.open_simple("create-enum", cx),
            "OPEN_CREATE_INDEX" => self.open_simple("create-index", cx),
            "OPEN_CREATE_TRIGGER" => self.open_simple("create-trigger", cx),
            "OPEN_CREATE_SCHEMA" => self.open_simple("create-schema", cx),
            "OPEN_CREATE_DATABASE" => self.open_simple("create-database", cx),
            "TOGGLE_SIDEBAR" => {
                let open = self.sidebar_open();
                self.set_sidebar_open(!open, cx);
            }
            "SET_SIDEBAR_VIEW" => {
                let Some(v) = b.sidebar.clone() else { return false };
                if ["dashboard", "tables", "sql", "database", "import-export", "workflows", "erd"].contains(&v.as_str()) {
                    self.sidebar_view = Some(v);
                    self.sidebar_visible = true;
                    self.persist(cx);
                }
            }
            "TOGGLE_COMMAND_MENU" => self.toggle_command_menu(window, cx),
            "OPEN_UNIVERSAL_SEARCH" => self.open_simple("universal-search", cx),
            "OPEN_SHORTCUT_NAVIGATOR" => self.open_simple("keybindings", cx),
            "TOGGLE_BOTTOM_PANEL" => {
                self.panel_open = !self.panel_open;
                cx.notify();
            }
            "TOGGLE_ACTIVITY_BAR" => {
                self.activity_bar_open = !self.activity_bar_open;
                cx.notify();
            }
            "TOGGLE_STATUS_BAR" => {
                self.status_bar_open = !self.status_bar_open;
                cx.notify();
            }
            "TOGGLE_GLOBAL_SQL_PANEL" => self.toggle_sql_sheet(cx),
            "TOGGLE_AI_PANEL" => self.toggle_ai(cx),
            "TOGGLE_PENDING_CHANGES_PANEL" => self.tab_command("TOGGLE_PENDING_CHANGES_PANEL", cx),
            _ => return false,
        }
        true
    }

    /// Capture phase: Cmd+1…9 tab navigation and the "early" bindings fire even
    /// while an editor has focus.
    fn on_capture_key(&mut self, e: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.command_menu.is_some() || self.dialog.is_some() {
            return;
        }
        let m = &e.keystroke.modifiers;
        if (m.platform || m.control) && !m.shift && !m.alt {
            if let Some(d) = e.keystroke.key.chars().next().and_then(|c| c.to_digit(10)).filter(|d| (1..=9).contains(d)) {
                if e.keystroke.key.len() == 1 {
                    if let Some(id) = self.tabs.get(d as usize - 1).map(|t| t.id.clone()) {
                        self.switch_tab(&id, cx);
                        cx.stop_propagation();
                        return;
                    }
                }
            }
        }
        let Some(combo) = keybindings::combo_from_keystroke(&e.keystroke) else { return };
        let Some(b) = self.keybindings.get(&combo).cloned() else { return };
        if EARLY.contains(&b.kind.as_str()) && self.execute_binding(&b, window, cx) {
            cx.stop_propagation();
        }
    }

    /// Bubble phase: everything else, unless a focused editor consumed the key.
    fn on_key(&mut self, e: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if e.keystroke.key == "escape" && self.menu.is_some() {
            self.close_menu(cx);
            return;
        }
        let m = &e.keystroke.modifiers;
        // Never hijack native clipboard/edit shortcuts; "/" (AI mode) belongs to the SQL editor.
        if (m.platform || m.control) && ["a", "c", "v", "x", "z", "y"].contains(&e.keystroke.key.as_str()) {
            return;
        }
        let Some(combo) = keybindings::combo_from_keystroke(&e.keystroke) else { return };
        if combo == "/" {
            return;
        }
        if let Some(b) = self.keybindings.get(&combo).cloned() {
            if self.execute_binding(&b, window, cx) {
                cx.stop_propagation();
            }
        }
    }

    fn side_column(&mut self, key: &'static str, target: Target, width: f32, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let body: AnyElement = match self.panel_view(key, window, cx) {
            Some(v) => v.into_any_element(),
            None => crate::main_content::TabPlaceholder::element(key, cx),
        };
        div()
            .flex()
            .flex_shrink_0()
            .child(div().mt_10().child(self.resize_handle(key, target, true, cx)))
            .child(
                div()
                    .relative()
                    .mt_10()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .w(px(width))
                    .overflow_hidden()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
                    .child(body),
            )
            .into_any_element()
    }

    fn render_shell(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let content_bg = t.var("--shell-content-bg").unwrap_or(t.studio_bg);
        let sidebar_open = self.sidebar_open();

        // Content card: mt-10 rounded-lg border, tab strip (unless split) + content.
        let header = (!self.split.enabled).then(|| self.render_app_header(cx).into_any_element());
        let main = self.render_main_content(window, cx);
        let card = div()
            .mt_10()
            .flex()
            .flex_1()
            .flex_col()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(content_bg)
            .children(header)
            .child(div().flex().flex_1().flex_col().min_h_0().min_w_0().overflow_hidden().child(main));

        let mut left_col = div().flex().flex_1().flex_col().min_h_0().min_w_0().child(card);
        if self.panel_open {
            let body = match self.panel_view("bottom-sql-panel", window, cx) {
                Some(v) => v.into_any_element(),
                None => crate::main_content::TabPlaceholder::element("bottom-sql-panel", cx),
            };
            left_col = left_col.child(self.resize_handle("panel", Target::Panel, false, cx)).child(
                div()
                    .relative()
                    .flex_shrink_0()
                    .h(px(self.panel_height))
                    .overflow_hidden()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(content_bg)
                    .child(body),
            );
        }

        let mut inset = div().flex().flex_1().min_h_0().min_w_0().mr_2().when(!sidebar_open, |d| d.ml_1()).child(left_col);
        if self.sql_sheet_open {
            let w = self.sql_sheet_width;
            inset = inset.child(self.side_column("sql-sheet", Target::SqlSheet, w, window, cx));
        }
        if self.ai_open {
            let w = self.ai_width;
            inset = inset.child(self.side_column("ai-chat", Target::Ai, w, window, cx));
        }
        if self.threads_open {
            let w = self.threads_width;
            inset = inset.child(self.side_column("ai-threads", Target::Threads, w, window, cx));
        }

        // Sidebar column: width = --sidebar-width, card inset pt-10 pl-1.5 pr-[6px], sash in the gutter.
        let sidebar = sidebar_open.then(|| {
            let w = self.sidebar_width;
            div()
                .relative()
                .flex()
                .flex_shrink_0()
                .h_full()
                .w(px(w))
                .pt_10()
                .pl(px(6.))
                .child(div().flex_1().min_w_0().h_full().child(self.render_sidebar(window, cx)))
                .child(self.resize_handle("sidebar", Target::Sidebar, true, cx))
        });

        let row = div()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .bg(t.sidebar)
            .when(!self.status_bar_open, |d| d.pb_2())
            .when(self.activity_bar_open, |d| d.child(self.render_rail(cx)))
            .children(sidebar)
            .child(inset);

        let mut root = div()
            .id("studio-root")
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .bg(t.sidebar)
            .text_color(t.foreground)
            .font_family(rexa_ui::SANS)
            .child(row)
            .child(self.render_title_bar(cx));
        if self.status_bar_open {
            root = root.child(self.render_status_bar(cx));
        }
        root.into_any_element()
    }
}

impl Render for Studio {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body = match &self.phase {
            Phase::Loading => self.render_loading(cx),
            Phase::Error(e) => {
                let e = e.clone();
                self.render_error(e, cx)
            }
            Phase::Ready => self.render_shell(window, cx),
        };
        let menu = self.render_menu(cx);
        let command = self.render_command_menu(cx);
        let dialog = self.render_dialog(cx);
        let settings = self.render_settings_modal(window, cx);
        div()
            .id("studio")
            .track_focus(&self.focus)
            .key_context("Studio")
            .size_full()
            .relative()
            .capture_key_down(cx.listener(Self::on_capture_key))
            .on_key_down(cx.listener(Self::on_key))
            .on_mouse_move(cx.listener(|this, e, _, cx| this.on_resize_move(e, cx)))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, cx| this.end_resize(cx)))
            .on_drop(cx.listener(|this, _: &crate::tab_strip::DraggedTab, _, cx| {
                this.tab_drag_over = None;
                cx.notify();
            }))
            .child(body)
            .children(settings)
            .children(dialog)
            .children(command)
            .children(menu)
    }
}
