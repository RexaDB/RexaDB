use crate::results::ResultsDelegate;
use rexa_core::runtime;
use gpui::{
    actions, div, prelude::*, px, App, Context, Entity, KeyBinding, SharedString, Window,
};
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::input::{Editor, EditorState};
use gpui_component::table::{DataTable, TableState};
use gpui_component::{h_flex, resizable_panel, v_flex, v_resizable, ActiveTheme, Disableable, Sizable};
use rexa_drivers::{Driver, QueryResult, TableRef, DEFAULT_ROW_LIMIT};
use rexa_store::{SavedConnection, Store};
use std::sync::Arc;

actions!(rexa, [RunQuery]);

const CONTEXT: &str = "Workspace";

pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-enter", RunQuery, Some(CONTEXT)),
        KeyBinding::new("ctrl-enter", RunQuery, Some(CONTEXT)),
    ]);
}

struct SchemaNode {
    name: String,
    expanded: bool,
    tables: Option<Vec<TableRef>>,
}

struct Session {
    connection_id: i64,
    driver: Arc<dyn Driver>,
    schemas: Vec<SchemaNode>,
}

enum Status {
    Idle,
    Running,
    Done { rows: usize, affected: Option<u64>, millis: u128, truncated: bool },
    Failed(SharedString),
}

pub struct Workspace {
    connections: Vec<SavedConnection>,
    store_error: Option<SharedString>,
    connecting: Option<i64>,
    connect_error: Option<SharedString>,
    session: Option<Session>,
    editor: Entity<EditorState>,
    results: Entity<TableState<ResultsDelegate>>,
    status: Status,
}

impl Workspace {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (connections, store_error) = match Store::open().and_then(|s| s.connections()) {
            Ok(list) => (list, None),
            Err(err) => (Vec::new(), Some(format!("{err:#}").into())),
        };
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language("sql")
                .placeholder("-- Write SQL, then press ⌘↵ to run")
        });
        let results = cx.new(|cx| {
            TableState::new(ResultsDelegate::default(), window, cx)
                .col_movable(false)
                .sortable(false)
                .cell_selectable(true)
        });
        Self {
            connections,
            store_error,
            connecting: None,
            connect_error: None,
            session: None,
            editor,
            results,
            status: Status::Idle,
        }
    }

    pub fn connect(&mut self, id: i64, cx: &mut Context<Self>) {
        let Some(saved) = self.connections.iter().find(|c| c.id == id).cloned() else { return };
        self.connecting = Some(id);
        self.connect_error = None;
        cx.notify();

        let task = runtime::spawn(async move {
            // Keychain reads can block on a system prompt; keep them off the UI thread too.
            let creds = tokio::task::spawn_blocking({
                let saved = saved.clone();
                move || rexa_store::resolve_credentials(&saved, None)
            })
            .await??;
            let driver = rexa_drivers::connect_detect(&saved.kind, &creds.connection_string).await?;
            let schemas = driver.schemas().await?;
            Ok((driver, schemas))
        });

        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.connecting != Some(id) {
                    return; // superseded by another connect
                }
                this.connecting = None;
                match result {
                    Ok((driver, schemas)) => {
                        if let Ok(store) = Store::open() {
                            store.touch_connection(id).ok();
                        }
                        let first = schemas.first().cloned();
                        this.session = Some(Session {
                            connection_id: id,
                            driver,
                            schemas: schemas
                                .into_iter()
                                .map(|name| SchemaNode { name, expanded: false, tables: None })
                                .collect(),
                        });
                        if let Some(first) = first {
                            this.toggle_schema(&first, cx);
                        }
                    }
                    Err(err) => this.connect_error = Some(format!("{err:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn toggle_schema(&mut self, name: &str, cx: &mut Context<Self>) {
        let Some(session) = self.session.as_mut() else { return };
        let Some(node) = session.schemas.iter_mut().find(|s| s.name == name) else { return };
        node.expanded = !node.expanded;
        cx.notify();
        if !node.expanded || node.tables.is_some() {
            return;
        }
        let (driver, schema, conn_id) = (session.driver.clone(), name.to_string(), session.connection_id);
        let task = runtime::spawn(async move { driver.tables(&schema).await });
        let name = name.to_string();
        cx.spawn(async move |this, cx| {
            let tables = task.await;
            this.update(cx, |this, cx| {
                let Some(session) = this.session.as_mut().filter(|s| s.connection_id == conn_id) else { return };
                if let Some(node) = session.schemas.iter_mut().find(|s| s.name == name) {
                    match tables {
                        Ok(t) => node.tables = Some(t),
                        Err(err) => {
                            node.expanded = false;
                            this.status = Status::Failed(format!("{err:#}").into());
                        }
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_table(&mut self, table: TableRef, window: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = &self.session else { return };
        let sql = session.driver.select_preview_sql(&table, 1000);
        self.editor.update(cx, |editor, cx| editor.set_value(sql.clone(), window, cx));
        self.execute(sql, cx);
    }

    fn run_query(&mut self, _: &RunQuery, _: &mut Window, cx: &mut Context<Self>) {
        let editor = self.editor.read(cx);
        let selected = editor.selected_text().to_string();
        let sql = if selected.trim().is_empty() { editor.value().to_string() } else { selected };
        if !sql.trim().is_empty() {
            self.execute(sql, cx);
        }
    }

    fn execute(&mut self, sql: String, cx: &mut Context<Self>) {
        let Some(session) = &self.session else {
            self.status = Status::Failed("Connect to a database first.".into());
            cx.notify();
            return;
        };
        if matches!(self.status, Status::Running) {
            return;
        }
        self.status = Status::Running;
        cx.notify();
        let driver = session.driver.clone();
        let task = runtime::spawn(async move { driver.execute(&sql, DEFAULT_ROW_LIMIT).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.show_result(result, cx);
            })
            .ok();
        })
        .detach();
    }

    fn show_result(&mut self, result: anyhow::Result<QueryResult>, cx: &mut Context<Self>) {
        match result {
            Ok(result) => {
                self.status = Status::Done {
                    rows: result.rows.len(),
                    affected: result.affected,
                    millis: result.elapsed.as_millis(),
                    truncated: result.truncated,
                };
                self.results.update(cx, |table, cx| {
                    table.delegate_mut().set_result(&result);
                    table.refresh(cx);
                });
            }
            Err(err) => {
                self.status = Status::Failed(format!("{err:#}").into());
                self.results.update(cx, |table, cx| {
                    table.delegate_mut().clear();
                    table.refresh(cx);
                });
            }
        }
        cx.notify();
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let mut list = v_flex().id("sidebar-scroll").flex_1().overflow_y_scroll().p_1().gap_px();

        if let Some(err) = &self.store_error {
            list = list.child(div().p_2().text_xs().text_color(theme.danger).child(err.clone()));
        }
        if self.connections.is_empty() && self.store_error.is_none() {
            list = list.child(
                div().p_2().text_xs().text_color(theme.muted_foreground)
                    .child("No saved connections yet."),
            );
        }

        for conn in &self.connections {
            let id = conn.id;
            let active = self.session.as_ref().is_some_and(|s| s.connection_id == id);
            let connecting = self.connecting == Some(id);
            let supported = rexa_drivers::Kind::detect(&conn.kind, &conn.connection_string).is_some();
            let label = if connecting { format!("{} …", conn.name) } else { conn.name.clone() };
            list = list.child(
                h_flex()
                    .id(("conn", id as u64))
                    .px_2()
                    .py_1()
                    .gap_2()
                    .rounded_md()
                    .text_sm()
                    .when(active, |el| el.bg(theme.sidebar_accent).text_color(theme.sidebar_accent_foreground))
                    .when(!supported, |el| el.text_color(theme.muted_foreground))
                    .hover(|el| el.bg(theme.sidebar_accent))
                    .child(div().size(px(8.)).rounded_full().bg(if active { theme.success } else { theme.border }))
                    .child(div().flex_1().overflow_hidden().text_ellipsis().whitespace_nowrap().child(label))
                    .child(div().text_xs().text_color(theme.muted_foreground).child(conn.kind.clone()))
                    .on_click(cx.listener(move |this, _, _, cx| this.connect(id, cx))),
            );
            if active {
                list = list.child(self.render_tree(cx));
            }
        }

        if let Some(err) = &self.connect_error {
            list = list.child(div().p_2().text_xs().text_color(theme.danger).child(err.clone()));
        }

        v_flex()
            .size_full()
            .bg(theme.sidebar)
            .border_r_1()
            .border_color(theme.sidebar_border)
            .child(
                div().px_3().py_2().text_xs().font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(theme.muted_foreground).child("CONNECTIONS"),
            )
            .child(list)
    }

    fn render_tree(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let mut tree = v_flex().pl_3().gap_px();
        let Some(session) = &self.session else { return tree };
        for (si, schema) in session.schemas.iter().enumerate() {
            let name = schema.name.clone();
            tree = tree.child(
                h_flex()
                    .id(("schema", si))
                    .px_2()
                    .py_0p5()
                    .gap_1()
                    .rounded_sm()
                    .text_sm()
                    .hover(|el| el.bg(theme.sidebar_accent))
                    .child(div().w_3().text_color(theme.muted_foreground).child(if schema.expanded { "▾" } else { "▸" }))
                    .child(schema.name.clone())
                    .on_click(cx.listener(move |this, _, _, cx| this.toggle_schema(&name, cx))),
            );
            if !schema.expanded {
                continue;
            }
            match &schema.tables {
                None => tree = tree.child(div().pl_6().text_xs().text_color(theme.muted_foreground).child("Loading…")),
                Some(tables) if tables.is_empty() => {
                    tree = tree.child(div().pl_6().text_xs().text_color(theme.muted_foreground).child("No tables"))
                }
                Some(tables) => {
                    for (ti, table) in tables.iter().enumerate() {
                        let t = table.clone();
                        tree = tree.child(
                            h_flex()
                                .id(SharedString::from(format!("t-{si}-{ti}")))
                                .pl_6()
                                .pr_2()
                                .py_0p5()
                                .gap_1()
                                .rounded_sm()
                                .text_sm()
                                .hover(|el| el.bg(theme.sidebar_accent))
                                .child(div().text_xs().text_color(theme.muted_foreground).child(if table.is_view { "◇" } else { "▦" }))
                                .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(table.name.clone()))
                                .on_click(cx.listener(move |this, _, window, cx| this.open_table(t.clone(), window, cx))),
                        );
                    }
                }
            }
        }
        tree
    }

    fn render_status(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let (text, color): (SharedString, _) = match &self.status {
            Status::Idle => ("Ready".into(), theme.muted_foreground),
            Status::Running => ("Running…".into(), theme.muted_foreground),
            Status::Done { rows, affected: Some(n), millis, .. } if *rows == 0 => {
                (format!("{n} row(s) affected · {millis} ms").into(), theme.muted_foreground)
            }
            Status::Done { rows, millis, truncated, .. } => (
                format!("{rows} row(s){} · {millis} ms", if *truncated { format!(" (limited to {DEFAULT_ROW_LIMIT})") } else { String::new() }).into(),
                theme.muted_foreground,
            ),
            Status::Failed(err) => (err.clone(), theme.danger),
        };
        div()
            .id("status")
            .px_3()
            .py_1()
            .max_h(px(140.))
            .overflow_y_scroll()
            .border_t_1()
            .border_color(theme.border)
            .text_xs()
            .text_color(color)
            .child(text)
    }
}

impl Render for Workspace {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let running = matches!(self.status, Status::Running);
        let connected = self.session.is_some();

        let toolbar = h_flex()
            .px_3()
            .py_1p5()
            .gap_2()
            .border_b_1()
            .border_color(theme.border)
            .child(
                Button::new("run")
                    .primary()
                    .small()
                    .label("Run  ⌘↵")
                    .loading(running)
                    .disabled(!connected || running)
                    .on_click(cx.listener(|this, _, window, cx| this.run_query(&RunQuery, window, cx))),
            )
            .child(div().flex_1())
            .child(div().text_xs().text_color(theme.muted_foreground).child(
                self.session
                    .as_ref()
                    .and_then(|s| self.connections.iter().find(|c| c.id == s.connection_id))
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| "Not connected".into()),
            ));

        let main = v_resizable("editor-results")
            .child(resizable_panel().size(px(280.)).child(
                div().size_full().child(Editor::new(&self.editor).h_full().bordered(false)),
            ))
            .child(resizable_panel().child(
                v_flex()
                    .size_full()
                    .child(div().flex_1().min_h_0().child(DataTable::new(&self.results).stripe(true).bordered(false)))
                    .child(self.render_status(cx)),
            ));

        let _ = window;
        h_flex()
            .key_context(CONTEXT)
            .on_action(cx.listener(Self::run_query))
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(div().w(px(260.)).h_full().flex_shrink_0().child(self.render_sidebar(cx)))
            .child(v_flex().flex_1().h_full().min_w_0().child(toolbar).child(div().flex_1().min_h_0().child(main)))
    }
}
