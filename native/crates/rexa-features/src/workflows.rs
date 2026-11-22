//! Native editor for persisted workflow definitions. Workflow execution and
//! scheduling are intentionally left to the existing workflow runtime.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, Entity, Window};
use gpui_component::input::{Input, InputState, Textarea, TextareaState};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{Registry, Session, StudioEvent, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
struct Workflow {
    id: String,
    name: String,
    description: String,
    nodes: String,
    edges: String,
}

fn open_db() -> rusqlite::Result<Connection> {
    let db = Connection::open_with_flags(
        rexa_store::Store::database_path(),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY NOT NULL,
            connection_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            nodes_json TEXT NOT NULL DEFAULT '[]',
            edges_json TEXT NOT NULL DEFAULT '[]',
            schedule_enabled INTEGER DEFAULT 0,
            schedule_type TEXT,
            schedule_value TEXT,
            last_run_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )?;
    // Sidecar installs may have an older version of this table.
    for (name, declaration) in [
        ("connection_id", "INTEGER"),
        ("description", "TEXT"),
        ("edges_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("schedule_enabled", "INTEGER DEFAULT 0"),
        ("schedule_type", "TEXT"),
        ("schedule_value", "TEXT"),
        ("last_run_at", "INTEGER"),
    ] {
        let mut stmt = db.prepare("PRAGMA table_info(workflows)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if !columns.iter().any(|column| column == name) {
            db.execute_batch(&format!(
                "ALTER TABLE workflows ADD COLUMN {name} {declaration}"
            ))?;
        }
    }
    Ok(db)
}

fn load_workflow(id: &str) -> rusqlite::Result<Option<Workflow>> {
    let db = open_db()?;
    db.query_row(
        "SELECT id, name, COALESCE(description, ''), COALESCE(nodes_json, '[]'), COALESCE(edges_json, '[]') FROM workflows WHERE id = ?1",
        [id],
        |row| {
            Ok(Workflow {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                nodes: row.get(3)?,
                edges: row.get(4)?,
            })
        },
    )
    .optional()
}

fn timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as i64)
}

fn generated_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(
        "workflow-{}-{}",
        timestamp(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

fn save_workflow(connection_id: i64, workflow: &Workflow) -> rusqlite::Result<()> {
    let db = open_db()?;
    let now = timestamp();
    db.execute(
        "INSERT INTO workflows(id, connection_id, name, description, nodes_json, edges_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             nodes_json = excluded.nodes_json, edges_json = excluded.edges_json, updated_at = excluded.updated_at",
        (
            &workflow.id,
            connection_id,
            &workflow.name,
            &workflow.description,
            &workflow.nodes,
            &workflow.edges,
            now,
        ),
    )?;
    Ok(())
}

pub struct WorkflowEditor {
    connection_id: i64,
    workflow_id: String,
    tab_id: String,
    name: Entity<InputState>,
    description: Entity<TextareaState>,
    nodes: Entity<TextareaState>,
    edges: Entity<TextareaState>,
    not_found: bool,
    message: Option<String>,
}

impl WorkflowEditor {
    fn new(
        params: &Value,
        session: Arc<Session>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let tab_id = params
            .get("baseId")
            .or_else(|| params.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("workflow")
            .split("::pane::")
            .next()
            .unwrap_or("workflow")
            .to_string();
        let saved_workflow_id = params
            .get("workflowId")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                tab_id
                    .strip_prefix("workflow-")
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
            });
        let workflow_id = saved_workflow_id.clone().unwrap_or_else(generated_id);
        let existing = load_workflow(&workflow_id).ok().flatten();
        // The create marker is persisted with the tab. Treat it as a one-time
        // request so restoring a saved tab never resets its workflow contents.
        let is_new = existing.is_none()
            && (params
                .get("create")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || saved_workflow_id.is_none());
        let not_found = !is_new && existing.is_none();
        let workflow = existing.unwrap_or_else(|| Workflow {
            id: workflow_id.clone(),
            name: "Untitled workflow".into(),
            description: String::new(),
            nodes: "[]".into(),
            edges: "[]".into(),
        });
        if is_new {
            if let Err(error) = save_workflow(session.connection.id, &workflow) {
                eprintln!("Could not create workflow: {error}");
            }
        }
        let name = cx.new(|cx| InputState::new(window, cx).default_value(workflow.name));
        let description = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(2, 8)
                .default_value(workflow.description)
        });
        let nodes = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(8, 24)
                .default_value(workflow.nodes)
        });
        let edges = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(5, 16)
                .default_value(workflow.edges)
        });
        Self {
            connection_id: session.connection.id,
            workflow_id,
            tab_id,
            name,
            description,
            nodes,
            edges,
            not_found,
            message: None,
        }
    }

    fn add_node(&mut self, node_type: &str, window: &mut Window, cx: &mut Context<Self>) {
        let current_nodes = self.nodes.read(cx).value().to_string();
        let mut nodes: Vec<Value> = match serde_json::from_str(&current_nodes) {
            Ok(nodes) => nodes,
            Err(error) => {
                self.message = Some(format!("Fix the node JSON before adding a node: {error}"));
                cx.notify();
                return;
            }
        };
        static NODE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!(
            "node_{}_{}",
            timestamp(),
            NODE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let title = match node_type {
            "trigger-manual" => "Manual Trigger",
            _ => "SQL Query",
        };
        let config = if node_type == "db-query" {
            json!({"sql":"SELECT 1"})
        } else {
            json!({"initialData":{}})
        };
        nodes.push(json!({
            "id": id,
            "type": node_type,
            "name": title,
            "position": {"x": 80, "y": 80 + (nodes.len() as i64 * 100)},
            "config": config
        }));
        let text = serde_json::to_string_pretty(&nodes).unwrap_or_else(|_| "[]".into());
        self.nodes
            .update(cx, |state, cx| state.set_value(text, window, cx));
        self.message = Some(format!("Added {title}. Save to keep the change."));
        cx.notify();
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let nodes = self.nodes.read(cx).value().to_string();
        let edges = self.edges.read(cx).value().to_string();
        for (label, source) in [("Node", &nodes), ("Edge", &edges)] {
            match serde_json::from_str::<Value>(source) {
                Ok(value) if value.is_array() => {}
                Ok(_) => {
                    self.message = Some(format!("{label} JSON must be an array."));
                    cx.notify();
                    return;
                }
                Err(error) => {
                    self.message = Some(format!("{label} JSON is invalid: {error}"));
                    cx.notify();
                    return;
                }
            }
        }
        let name = self.name.read(cx).value().trim().to_string();
        let workflow = Workflow {
            id: self.workflow_id.clone(),
            name: if name.is_empty() {
                "Untitled workflow".into()
            } else {
                name
            },
            description: self.description.read(cx).value().to_string(),
            nodes,
            edges,
        };
        match save_workflow(self.connection_id, &workflow) {
            Ok(()) => {
                self.message = Some("Workflow saved.".into());
                rexa_core::emit_studio(
                    StudioEvent::RenameTab {
                        tab: TabSpec::View {
                            view: "workflow".into(),
                            params: json!({"id":self.tab_id}),
                        },
                        title: workflow.name,
                    },
                    cx,
                );
                rexa_core::emit_studio(
                    StudioEvent::WorkflowsChanged {
                        connection_id: self.connection_id,
                    },
                    cx,
                );
            }
            Err(error) => self.message = Some(format!("Could not save workflow: {error}")),
        }
        cx.notify();
    }
}

impl gpui::Render for WorkflowEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tokens = cx.tokens().clone();
        if self.not_found {
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_color(tokens.muted_foreground)
                .child("Workflow not found. Refresh the workflows list to reopen it.");
        }

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(tokens.studio_bg)
            .text_color(tokens.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .px_5()
                    .py_3()
                    .border_b_1()
                    .border_color(tokens.border)
                    .child(Input::new(&self.name).appearance(false).w(px(320.)))
                    .child(
                        Button::new("workflow-save")
                            .size(ButtonSize::Sm)
                            .icon(IconName::Check)
                            .label("Save")
                            .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
                    ),
            )
            .when_some(self.message.clone(), |el, message| {
                el.child(
                    div()
                        .px_5()
                        .py_2()
                        .tw_text_xs()
                        .text_color(tokens.muted_foreground)
                        .child(message),
                )
            })
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_5()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().tw_text_sm().child("Description").child(Textarea::new(&self.description).h(px(96.))))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().tw_text_sm().child("Workflow nodes (JSON)"))
                            .child(
                                div().flex().gap_2()
                                    .child(Button::new("workflow-add-trigger").outline().size(ButtonSize::Sm).icon(IconName::Play).label("Manual trigger").on_click(cx.listener(|this, _, window, cx| this.add_node("trigger-manual", window, cx))))
                                    .child(Button::new("workflow-add-query").outline().size(ButtonSize::Sm).icon(IconName::Database).label("SQL query").on_click(cx.listener(|this, _, window, cx| this.add_node("db-query", window, cx)))),
                            ),
                    )
                    .child(Textarea::new(&self.nodes).h(px(420.)).appearance(false))
                    .child(div().tw_text_sm().child("Workflow edges (JSON)"))
                    .child(Textarea::new(&self.edges).h(px(180.)).appearance(false))
                    .child(div().tw_text_xs().text_color(tokens.muted_foreground).child("Edit the workflow definition here. Running workflows and schedules are not available in the native editor yet.")),
            )
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(
        cx,
        "rexa-features-workflows",
        |spec, session, window, cx| {
            let TabSpec::View { view, params } = spec else {
                return None;
            };
            if view != "workflow" {
                return None;
            }
            let params = params.clone();
            Some(Into::<AnyView>::into(
                cx.new(|cx| WorkflowEditor::new(&params, session, window, cx)),
            ))
        },
    );
}
