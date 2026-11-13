//! Port of components/studio/command-menu.tsx (Cmd+K palette): Create /
//! Navigation / Connections / Tables / Functions / Schemas groups, cmdk-style
//! scoring (`defaultFilter`), keyboard navigation and the "Enter Select" footer.

use crate::icons::{self, Ico};
use crate::keybindings;
use crate::menu::MenuAction;
use crate::studio::Studio;
use gpui::{div, prelude::*, px, AnyElement, Context, Entity, KeyDownEvent, SharedString, Window};
use gpui_component::input::{InputEvent, InputState};
use rexa_ui::{ActiveTokens, Kbd, Tw};
use std::rc::Rc;

pub struct CommandMenuState {
    pub input: Entity<InputState>,
    pub selected: usize,
    _sub: gpui::Subscription,
}

pub struct Item {
    pub label: String,
    pub keywords: Vec<String>,
    pub icon: Ico,
    pub shortcut: Option<String>,
    pub action: MenuAction,
}

pub struct Group {
    pub id: &'static str,
    pub title: String,
    pub items: Vec<Item>,
}

/// cmdk's command-score, simplified: prefix > word-start > substring > subsequence.
pub fn score(value: &str, search: &str, keywords: &[String]) -> f32 {
    let hay = format!("{} {}", value, keywords.join(" ")).to_lowercase();
    let needle = search.trim().to_lowercase();
    if needle.is_empty() {
        return 1.;
    }
    if hay.starts_with(&needle) {
        return 1.;
    }
    if let Some(pos) = hay.find(&needle) {
        let at_word = pos == 0 || hay.as_bytes()[pos - 1] == b' ';
        return if at_word { 0.9 } else { 0.7 };
    }
    let mut chars = hay.chars();
    let mut gaps = 0;
    for c in needle.chars() {
        let mut found = false;
        for h in chars.by_ref() {
            if h == c {
                found = true;
                break;
            }
            gaps += 1;
        }
        if !found {
            return 0.;
        }
    }
    (0.5 - gaps as f32 * 0.005).max(0.05)
}

fn item(label: impl Into<String>, keywords: &[&str], icon: Ico, shortcut: Option<String>, action: impl Fn(&mut Studio, &mut Window, &mut Context<Studio>) + 'static) -> Item {
    Item {
        label: label.into(),
        keywords: keywords.iter().map(|s| s.to_string()).collect(),
        icon,
        shortcut,
        action: Rc::new(action),
    }
}

impl Studio {
    pub fn toggle_command_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.command_menu.is_some() {
            self.close_command_menu(window, cx);
            return;
        }
        let (singular_plural, ns) = match self.db_type {
            "mongodb" => ("collections", "databases"),
            "redis" => ("keys", "databases"),
            _ => ("tables", "schemas"),
        };
        let input = cx.new(|cx| {
            InputState::new(window, cx).placeholder(format!("Search commands, {singular_plural}, {ns}..."))
        });
        let sub = cx.subscribe_in(&input, window, |this, _, e: &InputEvent, window, cx| match e {
            InputEvent::Change => {
                if let Some(m) = this.command_menu.as_mut() {
                    m.selected = 0;
                }
                cx.notify();
            }
            InputEvent::PressEnter { .. } => this.execute_selected_command(window, cx),
            _ => {}
        });
        input.update(cx, |i, cx| i.focus(window, cx));
        self.command_menu = Some(CommandMenuState { input, selected: 0, _sub: sub });
        cx.notify();
    }

    pub fn close_command_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.command_menu = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    fn command_groups(&self) -> Vec<Group> {
        let kb = &self.keybindings;
        let sc = |kind: &str, fallback: &str| Some(keybindings::shortcut_label(kb, kind, fallback));
        let l = icons::lucide;
        let db = self.db_type;
        let (is_mongo, is_redis, is_pg) = (db == "mongodb", db == "redis", db == "postgres" || db == "supabase-mgmt");
        let visible = |id: &str| self.settings.command_menu_sections.iter().find(|(s, _)| s == id).is_none_or(|(_, v)| *v);
        let mut groups = Vec::new();

        if visible("create") {
            let mut items = vec![item(
                if is_redis { "New Command" } else { "New Query" },
                if is_mongo { &["mongo", "json", "shell", "query", "editor"] } else if is_redis { &["redis", "command", "editor"] } else { &["sql", "editor", "query"] },
                l("plus"),
                sc("OPEN_SQL_EDITOR", "Cmd+N"),
                |s, _, cx| s.open_sql_editor(None, None, None, cx),
            )];
            if !is_redis {
                items.push(item(if is_mongo { "Create Collection" } else { "Create Table" }, &["table", "ddl"], l("table-2"), None, |s, _, cx| s.open_simple("create-table", cx)));
            }
            if is_pg {
                items.push(item("Create Schema", &["schema", "namespace"], l("database"), None, |s, _, cx| s.open_simple("create-schema", cx)));
                items.push(item("Create Database", &["database", "db"], l("database"), None, |s, _, cx| s.open_simple("create-database", cx)));
                items.push(item("Create Enum", &["enum", "type"], l("plus"), None, |s, _, cx| s.open_simple("create-enum", cx)));
                items.push(item("Create Index", &["index", "performance"], l("plus"), None, |s, _, cx| s.open_simple("create-index", cx)));
                items.push(item("Create Trigger", &["trigger", "function"], l("plus"), None, |s, _, cx| s.open_simple("create-trigger", cx)));
            } else if db != "sqlite" && !is_redis {
                items.push(item("Create Database", &["database", "db"], l("database"), None, |s, _, cx| s.open_simple("create-database", cx)));
            }
            groups.push(Group { id: "create", title: if is_mongo { "Mongo Create" } else { "Create" }.into(), items });
        }
        if visible("navigation") {
            groups.push(Group {
                id: "navigation",
                title: "Navigation".into(),
                items: vec![
                    item("Query History", &["history", "queries"], l("clock"), None, |s, _, cx| s.open_simple("history", cx)),
                    item("Schema Diagram", &["diagram", "er", "schema", "graph"], l("git-fork"), sc("OPEN_DATABASE_VIEW", "Cmd+Shift+D"), |s, _, cx| s.open_database_tab("schema", cx)),
                    item("Toggle Navigator", &["sidebar", "navigator"], l("panels-top-left"), sc("TOGGLE_SIDEBAR", "Cmd+B"), |s, _, cx| {
                        let open = s.sidebar_open();
                        s.set_sidebar_open(!open, cx)
                    }),
                    item("Refresh Data", &["reload", "refresh"], l("refresh-cw"), None, |s, _, cx| s.tab_command("REFRESH_CURRENT_TAB", cx)),
                    item("Export Schema / Data", &["export", "schema", "data", "csv", "json", "sql"], l("workflow"), None, |s, _, cx| s.open_simple("import-export", cx)),
                    item("Snapshots", &["snapshot", "backup", "diff", "compare", "version"], l("camera"), None, |s, _, cx| s.open_simple("snapshots", cx)),
                    item("Open Browser", &["browser", "web", "internet", "url"], l("globe"), None, |s, _, cx| {
                        let mut t = crate::tabs::StudioTab::new(format!("browser-{}", crate::tabs::uid()), "browser", "Browser");
                        t.extra.insert("url".into(), "https://www.google.com".into());
                        s.open_tab(t, false, cx)
                    }),
                    item("Manage Extensions", &["extension", "extensions", "plugin", "marketplace", "install"], l("puzzle"), None, |s, _, cx| s.open_simple("extensions", cx)),
                    item("Search All Tables...", &["search", "find", "universal", "global", "cross-table"], l("search"), sc("OPEN_UNIVERSAL_SEARCH", "Cmd+Shift+F"), |s, _, cx| {
                        s.open_simple("universal-search", cx)
                    }),
                ],
            });
        }
        if visible("connections") {
            groups.push(Group {
                id: "connections",
                title: "Connections".into(),
                items: vec![item("Manage Connections", &["connections", "switch", "new"], l("log-out"), None, |s, _, cx| s.go_home(cx))],
            });
        }
        let names: Vec<String> = self.tables.iter().map(|t| t.name.clone()).collect();
        if visible("tables") && !names.is_empty() {
            let plural = match db {
                "mongodb" => "Collections",
                "redis" => "Keys",
                _ => "Tables",
            };
            groups.push(Group {
                id: "tables",
                title: plural.into(),
                items: names
                    .into_iter()
                    .map(|name| {
                        let n = name.clone();
                        item(name.clone(), &["table", &name], l("table-2"), None, move |s, _, cx| s.open_table(&n, None, cx))
                    })
                    .collect(),
            });
        }
        let functions: Vec<String> = self
            .objects
            .iter()
            .filter(|o| matches!(o.kind, crate::catalog::ObjectKind::Function | crate::catalog::ObjectKind::Procedure))
            .map(|o| o.name.clone())
            .collect();
        if visible("functions") && !functions.is_empty() {
            groups.push(Group {
                id: "functions",
                title: "Functions".into(),
                items: functions
                    .into_iter()
                    .map(|f| item(f.clone(), &["function", &f], l("square-function"), None, |s, _, cx| s.open_database_tab("functions", cx)))
                    .collect(),
            });
        }
        if visible("schemas") && !self.schemas.is_empty() {
            groups.push(Group {
                id: "schemas",
                title: if is_mongo || is_redis { "Databases" } else { "Schemas" }.into(),
                items: self
                    .schemas
                    .iter()
                    .map(|sch| {
                        let s2 = sch.clone();
                        item(sch.clone(), &["schema", sch], l("database"), None, move |s, _, cx| s.set_selected_schema(s2.clone(), cx))
                    })
                    .collect(),
            });
        }
        groups
    }

    fn filtered_command_groups(&self, cx: &gpui::App) -> Vec<Group> {
        let search = self.command_menu.as_ref().map(|m| m.input.read(cx).value().to_string()).unwrap_or_default();
        let groups = self.command_groups();
        if search.trim().is_empty() {
            return groups;
        }
        let mut scored: Vec<(f32, Group)> = groups
            .into_iter()
            .filter_map(|mut g| {
                let mut items: Vec<(f32, Item)> = g
                    .items
                    .drain(..)
                    .map(|i| (score(&format!("{} {}", g.title, i.label), &search, &i.keywords), i))
                    .filter(|(s, _)| *s > 0.)
                    .collect();
                if items.is_empty() {
                    return None;
                }
                items.sort_by(|a, b| b.0.total_cmp(&a.0));
                let max = items[0].0;
                g.items = items.into_iter().map(|(_, i)| i).collect();
                Some((max, g))
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        scored.into_iter().map(|(_, g)| g).collect()
    }

    fn execute_selected_command(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(sel) = self.command_menu.as_ref().map(|m| m.selected) else { return };
        let action = self.filtered_command_groups(cx).into_iter().flat_map(|g| g.items).nth(sel).map(|i| i.action);
        if let Some(action) = action {
            self.close_command_menu(window, cx);
            action(self, window, cx);
        }
    }

    pub fn render_command_menu(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let state = self.command_menu.as_ref()?;
        let input = state.input.clone();
        let selected = state.selected;
        let t = cx.tokens().clone();
        let groups = self.filtered_command_groups(cx);
        let total: usize = groups.iter().map(|g| g.items.len()).sum();

        let mut list = div().id("command-list").flex().flex_col().h(px(320.)).overflow_y_scroll();
        if total == 0 {
            list = list.child(div().py_6().text_center().tw_text_sm().child("No matching commands."));
        }
        let mut index = 0;
        for (gi, g) in groups.into_iter().enumerate() {
            if gi > 0 {
                list = list.child(div().h(px(1.)).bg(t.border));
            }
            let mut group = div().flex().flex_col().p_1().px_2().child(
                div().px_2().py(px(6.)).tw_text_xs().font_weight(gpui::FontWeight::MEDIUM).text_color(t.muted_foreground).child(g.title.clone()),
            );
            for it in g.items {
                let i = index;
                index += 1;
                let action = it.action.clone();
                let is_sel = i == selected;
                group = group.child(
                    div()
                        .id(SharedString::from(format!("cmd-{}-{}", g.id, i)))
                        .flex()
                        .items_center()
                        .gap_2()
                        .tw_rounded_lg()
                        .px_2()
                        .py(px(6.))
                        .tw_text_sm()
                        .cursor_default()
                        .when(is_sel, |d| d.bg(t.muted).text_color(t.foreground))
                        .on_mouse_move(cx.listener(move |this, _, _, cx| {
                            if let Some(m) = this.command_menu.as_mut() {
                                if m.selected != i {
                                    m.selected = i;
                                    cx.notify();
                                }
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.close_command_menu(window, cx);
                            action(this, window, cx);
                        }))
                        .child(it.icon.el(16., t.foreground))
                        .child(div().flex_1().overflow_hidden().text_ellipsis().whitespace_nowrap().child(it.label))
                        .children(it.shortcut.map(|s| div().ml_auto().tw_text_xs().text_color(t.muted_foreground).child(s))),
                );
            }
            list = list.child(group);
        }

        let panel = div()
            .id("command-menu")
            .occlude()
            .w(px(512.))
            .max_w_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.studio_border)
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .shadow_2xl()
            .on_key_down(cx.listener(move |this, e: &KeyDownEvent, window, cx| {
                let key = e.keystroke.key.as_str();
                match key {
                    "down" | "up" => {
                        if let Some(m) = this.command_menu.as_mut() {
                            m.selected = if key == "down" { (m.selected + 1).min(total.saturating_sub(1)) } else { m.selected.saturating_sub(1) };
                        }
                        cx.stop_propagation();
                        cx.notify();
                    }
                    "escape" => {
                        this.close_command_menu(window, cx);
                        cx.stop_propagation();
                    }
                    _ => {}
                }
            }))
            .child(
                // CommandInput: border-b px-3, search icon, h-11 input
                div()
                    .flex()
                    .items_center()
                    .h(px(44.))
                    .px_3()
                    .border_b_1()
                    .border_color(t.border)
                    .child(icons::lucide("search").el(16., t.foreground).opacity(0.5).mr_2())
                    .child(div().flex_1().tw_text_sm().child(gpui_component::input::Input::new(&input).appearance(false))),
            )
            .child(list)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .h_10()
                    .px_4()
                    .border_t_1()
                    .border_color(t.studio_border)
                    .bg(t.studio_bg)
                    .tw_text_xs()
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(t.muted_foreground)
                    .child(Kbd::new("Enter"))
                    .child("Select"),
            );
        Some(crate::dialogs::modal_layer("command-menu-layer", 0.8, panel.into_any_element(), cx, |this, window, cx| {
            this.close_command_menu(window, cx)
        }))
    }
}
