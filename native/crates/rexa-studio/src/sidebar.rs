//! Port of components/studio/studio-shell-sidebar.tsx (Modern UI: `hideBack`,
//! so the open rail section's panel fills the card), sidebar-common.tsx /
//! sidebar-header.tsx row chrome and components/app-shell/app-sidebar.tsx
//! (the sidebar card). Panels: Tables (explorer.rs), SQL snippets, Dashboards,
//! Notes, Database views, Authentication, Workflows; sections owned by other
//! crates (Payments, Storage, Edge Functions, ERD, Extensions) list their entry tabs.

use crate::icons::{self, Ico};
use crate::menu::{MenuEntry, Tone};
use crate::studio::Studio;
use crate::tabs::{self, StudioTab};
use gpui::{div, img, prelude::*, px, AnyElement, Context, MouseButton, SharedString};
use rexa_ui::{white, ActiveTokens, Tw};
use rusqlite::{params, Connection, OpenFlags};

/// Logo for a connection type (components/shared/provider-logo.tsx).
pub fn provider_logo(kind: &str, size: f32) -> AnyElement {
    let file = match kind {
        "mysql" => "providers/mysql.png",
        "mariadb" => "providers/mariadb.png",
        "mongo" | "mongodb" => "providers/MongoDB.png",
        "redis" => "providers/redis.png",
        "sqlite" | "rqlite" | "valtown" => "providers/sqlite.png",
        "turso" => "providers/Turso.png",
        "clickhouse" => "providers/clickhouse.png",
        "sqlserver" | "mssql" => "providers/sqlserver.png",
        "supabase" | "supabase-mgmt" => "providers/supabase.png",
        "neon" => "providers/neon.png",
        "timescale" => "providers/timescale.png",
        "planetscale" => "providers/planetscale.png",
        "cockroachdb" => "providers/cockroachdb.png",
        "jdbc" => "providers/jdbc.svg",
        "oracle" => "providers/Oracle.svg",
        _ => "providers/postgres.png",
    };
    img(file).size(px(size)).flex_shrink_0().into_any_element()
}

#[derive(Clone)]
pub struct ListItem {
    pub id: String,
    pub name: String,
    pub query: String,
}

/// Snippets, dashboards, notes and workflows of the connection.
#[derive(Default)]
pub struct SideLists {
    pub snippets: Vec<ListItem>,
    pub dashboards: Vec<ListItem>,
    pub notes: Vec<ListItem>,
    pub workflows: Vec<ListItem>,
}

fn db() -> Option<Connection> {
    Connection::open_with_flags(rexa_store::Store::database_path(), OpenFlags::SQLITE_OPEN_READ_WRITE).ok()
}

fn json_list(raw: Option<String>) -> Vec<ListItem> {
    raw.and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            Some(ListItem {
                id: v.get("id")?.as_str()?.to_string(),
                name: v.get("name").and_then(|n| n.as_str()).unwrap_or("Untitled").to_string(),
                query: String::new(),
            })
        })
        .collect()
}

impl SideLists {
    pub fn load(connection_id: i64) -> Self {
        let Some(db) = db() else { return Self::default() };
        let mut out = Self::default();
        if let Ok(mut s) = db.prepare("SELECT id, name, query FROM snippets WHERE connection_id = ?1 ORDER BY created_at") {
            if let Ok(rows) = s.query_map([connection_id], |r| Ok(ListItem { id: r.get(0)?, name: r.get(1)?, query: r.get(2)? })) {
                out.snippets = rows.flatten().collect();
            }
        }
        out.dashboards = json_list(db.query_row("SELECT dashboards_json FROM dashboard_state WHERE connection_id = ?1", [connection_id], |r| r.get(0)).ok());
        out.notes = json_list(db.query_row("SELECT notes_json FROM note_state WHERE connection_id = ?1", [connection_id], |r| r.get(0)).ok());
        if let Ok(mut s) = db.prepare("SELECT id, name FROM workflows WHERE connection_id = ?1 OR connection_id IS NULL ORDER BY rowid DESC") {
            if let Ok(rows) = s.query_map([connection_id], |r| Ok(ListItem { id: r.get(0)?, name: r.get(1)?, query: String::new() })) {
                out.workflows = rows.flatten().collect();
            }
        }
        out
    }
}

/// Mutations of the JSON-array state tables (dashboards / notes).
fn edit_json_list(connection_id: i64, table: &str, column: &str, f: impl FnOnce(&mut Vec<serde_json::Value>)) {
    let Some(db) = db() else { return };
    let raw: Option<String> = db.query_row(&format!("SELECT {column} FROM {table} WHERE connection_id = ?1"), [connection_id], |r| r.get(0)).ok();
    let mut list: Vec<serde_json::Value> = raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    f(&mut list);
    let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    db.execute(&format!("UPDATE {table} SET {column} = ?1, updated_at = ?2 WHERE connection_id = ?3"), params![json, now, connection_id]).ok();
}


impl Studio {
    /// ROW: flex h-8 w-full items-center gap-2 rounded-lg px-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground
    pub fn sidebar_row(&self, id: impl Into<SharedString>, active: bool, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        div()
            .id(id.into())
            .flex()
            .flex_shrink_0()
            .w_full()
            .h_8()
            .items_center()
            .gap_2()
            .tw_rounded_lg()
            .px_1()
            .tw_text_sm()
            .cursor_pointer()
            .text_color(if active { t.foreground } else { t.muted_foreground })
            .when(active, |d| d.bg(white(0.1)))
            .hover(move |s| s.bg(white(0.05)).text_color(t.foreground))
    }

    fn row_label(text: impl Into<SharedString>) -> impl IntoElement {
        div().flex_1().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().child(text.into())
    }

    /// SidebarItemWithMenu: row + three-dot (MoreHorizontal) menu inside the hover surface.
    fn row_with_menu(&self, key: String, icon: Ico, label: String, open: impl Fn(&mut Studio, &mut Context<Studio>) + 'static, actions: Vec<MenuEntry>, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let menu_id = format!("dd:row-{key}");
        let menu_open = self.menu_is_open(&menu_id);
        let group = SharedString::from(format!("row-{key}"));
        let actions = std::rc::Rc::new(std::cell::RefCell::new(Some(actions)));
        let label2 = label.clone();
        self.sidebar_row(format!("row-{key}"), menu_open, cx)
            .group(group.clone())
            .on_click(cx.listener(move |this, _, _, cx| open(this, cx)))
            .child(icon.el(16., gpui::Hsla::default()))
            .child(Self::row_label(label))
            .child(
                div()
                    .id(SharedString::from(format!("row-menu-{key}")))
                    .size_6()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .justify_center()
                    .tw_rounded_md()
                    .text_color(t.muted_foreground)
                    .hover(move |s| s.bg(white(0.1)).text_color(t.foreground))
                    .map(|d| if menu_open { d.opacity(1.) } else { d.opacity(0.).group_hover(group.clone(), |s| s.opacity(1.)) })
                    .on_mouse_down(MouseButton::Left, cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let mut items = vec![MenuEntry::Label(label2.clone().into()), MenuEntry::Separator];
                        if let Some(a) = actions.borrow_mut().take() {
                            items.extend(a);
                        }
                        this.open_menu(menu_id.clone(), e.position, 160., items, cx);
                    }))
                    .child(icons::lucide("ellipsis").el(14., gpui::Hsla::default())),
            )
            .into_any_element()
    }

    fn new_row(&self, id: &str, label: &str, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        self.sidebar_row(id.to_string(), false, cx).child(icons::lucide("plus").el(16., gpui::Hsla::default())).child(label.to_string())
    }

    pub fn reload_lists(&mut self, cx: &mut Context<Self>) {
        self.lists = SideLists::load(self.connection_id);
        cx.notify();
    }

    fn render_sql_panel(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let mut col = div().flex().flex_col().gap(px(2.)).pt_1().child(
            self.new_row("new-query", "New query", cx).on_click(cx.listener(|this, _, _, cx| this.open_sql_editor(None, None, None, cx))),
        );
        for s in self.lists.snippets.clone() {
            let (open_s, dup, del) = (s.clone(), s.clone(), s.clone());
            let actions = vec![
                MenuEntry::item("Duplicate", move |this, _, cx| {
                    if let Some(db) = db() {
                        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
                        db.execute(
                            "INSERT INTO snippets(id, connection_id, folder_id, name, query, created_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
                            params![tabs::uid(), this.connection_id, format!("{} (copy)", dup.name), dup.query, now],
                        )
                        .ok();
                    }
                    this.reload_lists(cx);
                })
                .icon(icons::lucide("copy")),
                MenuEntry::Separator,
                MenuEntry::item("Delete", move |this, _, cx| {
                    if let Some(db) = db() {
                        db.execute("DELETE FROM snippets WHERE id = ?1", [&del.id]).ok();
                    }
                    this.reload_lists(cx);
                })
                .icon(icons::lucide("trash-2"))
                .tone(Tone::Destructive),
            ];
            col = col.child(self.row_with_menu(
                format!("snippet-{}", s.id),
                icons::S_CODE2,
                s.name.clone(),
                move |this, cx| {
                    // openSnippet: tab id sql-<snippetId>
                    let mut tab = StudioTab::new(format!("sql-{}", open_s.id), "sql", open_s.name.clone());
                    tab.query = Some(open_s.query.clone());
                    this.open_tab(tab, true, cx);
                },
                actions,
                cx,
            ));
        }
        col.into_any_element()
    }

    fn render_json_list_panel(&mut self, kind: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let (items, new_label, icon, table, column) = match kind {
            "dashboard" => (self.lists.dashboards.clone(), "New dashboard", icons::S_WIDGET, "dashboard_state", "dashboards_json"),
            _ => (self.lists.notes.clone(), "New note", icons::S_PEN, "note_state", "notes_json"),
        };
        let mut col = div().flex().flex_col().gap(px(2.)).pt_1().child(self.new_row(&format!("new-{kind}"), new_label, cx).on_click(cx.listener(move |this, _, _, cx| {
            let id = tabs::uid();
            let name = if kind == "dashboard" { "New Dashboard" } else { "New Note" };
            let mut tab = StudioTab::new(format!("{kind}-{id}"), kind, name);
            tab.extra.insert("create".into(), true.into());
            this.open_tab(tab, false, cx);
        })));
        for it in items {
            let (o, d) = (it.clone(), it.clone());
            let conn = self.connection_id;
            let actions = vec![MenuEntry::item("Delete", move |this, _, cx| {
                let id = d.id.clone();
                edit_json_list(conn, table, column, |list| list.retain(|v| v.get("id").and_then(|x| x.as_str()) != Some(id.as_str())));
                let tab_id = format!("{kind}-{}", d.id);
                if let Some(t) = this.tabs.iter().find(|t| t.base() == tab_id).map(|t| t.id.clone()) {
                    this.close_tab(&t, cx);
                }
                this.reload_lists(cx);
            })
            .icon(icons::lucide("trash-2"))
            .tone(Tone::Destructive)];
            col = col.child(self.row_with_menu(
                format!("{kind}-{}", it.id),
                icon,
                it.name.clone(),
                move |this, cx| this.open_tab(StudioTab::new(format!("{kind}-{}", o.id), kind, o.name.clone()), true, cx),
                actions,
                cx,
            ));
        }
        col.into_any_element()
    }

    fn render_database_panel(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let db = self.db_type;
        let pg = matches!(db, "postgres" | "supabase-mgmt");
        let routine = pg || db == "mssql" || db == "mysql";
        let items: Vec<(&str, &str, bool)> = vec![
            ("Schema Diagram", "schema", true),
            ("Data Catalog", "catalog", true),
            (if db == "mongodb" { "Collections" } else { "Tables" }, "tables", true),
            ("Functions", "functions", routine),
            ("Triggers", "triggers", routine),
            ("Enums", "enums", pg),
            ("Indexes", "indexes", pg || db == "mysql"),
            ("Sequences", "sequences", pg),
        ];
        let active_view = self.active_tab().filter(|t| t.kind.starts_with("database-")).map(|t| t.kind.trim_start_matches("database-").to_string());
        let mut col = div().flex().flex_col().gap(px(2.)).pt_1();
        for (label, view, show) in items {
            if !show {
                continue;
            }
            let icon = tabs::registry_icon(&format!("database-{view}")).unwrap_or(icons::S_DATABASE);
            col = col.child(
                self.sidebar_row(format!("db-view-{view}"), active_view.as_deref() == Some(view), cx)
                    .on_click(cx.listener(move |this, _, _, cx| this.open_database_tab(view, cx)))
                    .child(icon.el(16., gpui::Hsla::default()))
                    .child(label.to_string()),
            );
        }
        col.into_any_element()
    }

    fn render_simple_panel(&mut self, entries: Vec<(&'static str, &'static str, Ico)>, cx: &mut Context<Self>) -> AnyElement {
        let active = self.active_tab().map(|t| t.kind.clone());
        let mut col = div().flex().flex_col().gap(px(2.)).pt_1();
        for (label, kind, icon) in entries {
            col = col.child(
                self.sidebar_row(format!("simple-{kind}"), active.as_deref() == Some(kind), cx)
                    .on_click(cx.listener(move |this, _, _, cx| this.open_simple(kind, cx)))
                    .child(icon.el(16., gpui::Hsla::default()))
                    .child(label),
            );
        }
        col.into_any_element()
    }

    fn render_workflows_panel(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let mut col = div().flex().flex_col().gap(px(2.)).pt_1().child(self.new_row("new-workflow", "New workflow", cx).on_click(cx.listener(|this, _, _, cx| {
            let mut tab = StudioTab::new("workflow", "workflow", "Workflow");
            tab.extra.insert("create".into(), true.into());
            this.open_tab(tab, false, cx);
        })));
        for w in self.lists.workflows.clone() {
            let o = w.clone();
            col = col.child(
                self.sidebar_row(format!("wf-{}", w.id), false, cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut tab = StudioTab::new(format!("workflow-{}", o.id), "workflow", o.name.clone());
                        tab.extra.insert("workflowId".into(), o.id.clone().into());
                        this.open_tab(tab, false, cx);
                    }))
                    .child(icons::S_WORKFLOW.el(16., gpui::Hsla::default()))
                    .child(Self::row_label(w.name)),
            );
        }
        col.into_any_element()
    }

    /// The sidebar card (AppSidebar inner: bg shell-content-bg, rounded-lg, border, p-1).
    pub fn render_sidebar(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let section = self.sidebar_view.clone().unwrap_or_else(|| "tables".into());
        let l = icons::lucide;
        let body: AnyElement = match section.as_str() {
            "tables" => self.render_explorer(window, cx),
            "sql" => self.render_sql_panel(cx),
            "dashboard" => self.render_json_list_panel("dashboard", cx),
            "notes" => self.render_json_list_panel("note", cx),
            "database" => self.render_database_panel(cx),
            "auth" => {
                let neon = self.connection.as_ref().is_some_and(|c| c.kind == "neon");
                let mut e = vec![("Users", "auth-users", icons::S_SHIELD), ("Sessions", "auth-sessions", icons::S_SHIELD)];
                if !neon {
                    e.push(("Providers", "auth-providers", icons::S_SHIELD));
                }
                self.render_simple_panel(e, cx)
            }
            "workflows" => self.render_workflows_panel(cx),
            "payments" => self.render_simple_panel(
                vec![
                    ("Setup", "payments-setup", l("settings")),
                    ("Plans", "payments-plans", l("box")),
                    ("Customers", "payments-customers", l("user")),
                    ("Subscriptions", "payments-subscriptions", l("history")),
                    ("Revenue", "payments-revenue", l("chart-column")),
                    ("Webhooks", "payments-webhooks", l("zap")),
                ],
                cx,
            ),
            "storage" => self.render_simple_panel(
                vec![("Files", "storage-files", l("folder-open")), ("Policies", "storage-policies", l("shield")), ("Settings", "storage-settings", l("settings"))],
                cx,
            ),
            "edge-functions" => self.render_simple_panel(vec![("Functions", "edge-functions", l("square-function")), ("Secrets", "edge-secrets", l("key-round"))], cx),
            "erd" => self.render_simple_panel(vec![("New ERD", "erd-designer", l("git-fork"))], cx),
            "extensions" => self.render_simple_panel(vec![("Manage Extensions", "extensions", l("puzzle"))], cx),
            _ => div().into_any_element(),
        };
        let scrolls = section != "tables";
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
            .p_1()
            .child(
                div()
                    .id("sidebar-panel")
                    .flex_1()
                    .min_h_0()
                    .px(px(2.))
                    .flex()
                    .flex_col()
                    .when(scrolls, |d| d.overflow_y_scroll().pb_2())
                    .child(body),
            )
            .into_any_element()
    }
}
