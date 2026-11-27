//! Locally saved ERD projects and a lightweight GPUI designer. Editing these
//! projects never runs DDL against the connected database.

use crate::{
    common,
    erd::{self, DiagramColumn, DiagramTable},
};
use gpui::{
    canvas, div, point, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity,
    MouseButton, MouseDownEvent, MouseMoveEvent, PathBuilder, Pixels, Point, SharedString, Window,
};
use gpui_component::input::{Input, InputState};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

const DESIGN_NODE_WIDTH: f32 = 240.;
const DESIGN_NODE_HEADER: f32 = 30.;
const DESIGN_NODE_ROW: f32 = 24.;

#[derive(Clone)]
struct NodeDrag {
    id: String,
    start: Point<Pixels>,
    origin: (f32, f32),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    name: String,
    schema_name: String,
    db_type: String,
    #[serde(default)]
    tables: Vec<DiagramTable>,
    #[serde(default)]
    positions: std::collections::HashMap<String, (f32, f32)>,
}

const KEY_PREFIX: &str = "rexadb.erd.projects.v1.";

fn key(connection_id: i64) -> String {
    format!("{KEY_PREFIX}{connection_id}")
}

fn load(connection_id: i64) -> Vec<Project> {
    rexa_store::Store::open()
        .ok()
        .and_then(|store| store.setting(&key(connection_id)).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(connection_id: i64, projects: &[Project]) -> anyhow::Result<()> {
    rexa_store::Store::open()?.set_setting(&key(connection_id), &serde_json::to_string(projects)?)
}

fn uid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("erd-{nanos:x}")
}

fn open_project(project: &Project, cx: &mut App) {
    rexa_core::open_tab(
        TabSpec::View {
            view: "erd-project".into(),
            params: serde_json::json!({ "id": format!("erd-project-{}", project.id), "projectId": project.id, "name": project.name }),
        },
        cx,
    );
}

pub struct ProjectList {
    session: Arc<Session>,
    projects: Vec<Project>,
    message: Option<String>,
}

impl ProjectList {
    fn new(session: Arc<Session>) -> Self {
        let projects = load(session.connection.id);
        Self {
            session,
            projects,
            message: None,
        }
    }

    fn create(&mut self, cx: &mut Context<Self>) {
        let project = Project {
            id: uid(),
            name: "New ERD".into(),
            schema_name: common::default_schema(&self.session),
            db_type: common::db_type(&self.session).into(),
            tables: Vec::new(),
            positions: Default::default(),
        };
        self.projects.insert(0, project.clone());
        match save(self.session.connection.id, &self.projects) {
            Ok(()) => {
                self.message = Some("ERD project created locally.".into());
                open_project(&project, cx);
            }
            Err(error) => self.message = Some(format!("Could not save ERD project: {error:#}")),
        }
        cx.notify();
    }

    fn import(&mut self, cx: &mut Context<Self>) {
        let session = self.session.clone();
        let schema = common::default_schema(&session);
        let task = runtime::spawn(async move {
            let rows = session
                .driver
                .all_tables_with_columns(Some(&schema))
                .await?;
            let tables = erd::tables_from_columns(&rows)
                .into_iter()
                .filter(|t| t.schema.eq_ignore_ascii_case(&schema))
                .collect();
            anyhow::Ok((schema, common::db_type(&session).to_string(), tables))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok((schema_name, db_type, tables)) => {
                        let project = Project {
                            id: uid(),
                            name: format!("{schema_name} ERD"),
                            schema_name,
                            db_type,
                            tables,
                            positions: Default::default(),
                        };
                        this.projects.insert(0, project.clone());
                        match save(this.session.connection.id, &this.projects) {
                            Ok(()) => {
                                this.message = Some(format!(
                                    "Imported {} tables into a local ERD project.",
                                    project.tables.len()
                                ));
                                open_project(&project, cx);
                            }
                            Err(error) => {
                                this.message =
                                    Some(format!("Could not save imported ERD: {error:#}"))
                            }
                        }
                    }
                    Err(error) => {
                        this.message = Some(format!("Could not import schema: {error:#}"))
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn delete(&mut self, id: &str, cx: &mut Context<Self>) {
        self.projects.retain(|p| p.id != id);
        match save(self.session.connection.id, &self.projects) {
            Ok(()) => self.message = Some("ERD project deleted.".into()),
            Err(error) => self.message = Some(format!("Could not save project list: {error:#}")),
        }
        cx.notify();
    }
}

impl Render for ProjectList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground)
            .child(div().flex().items_center().justify_between().px_5().py_3().border_b_1().border_color(t.border)
                .child(div().font_weight(gpui::FontWeight::SEMIBOLD).child("ERD projects"))
                .child(div().flex().gap_2()
                    .child(Button::new("erd-import-schema").outline().size(ButtonSize::Sm).icon(IconName::Download).label("Import current schema").on_click(cx.listener(|this, _, _, cx| this.import(cx))))
                    .child(Button::new("erd-new-project").size(ButtonSize::Sm).icon(IconName::Plus).label("New ERD").on_click(cx.listener(|this, _, _, cx| this.create(cx))))))
            .child(div().flex_1().min_h_0().overflow_y_scrollbar().p_5().flex().flex_col().gap_2()
                .when(self.projects.is_empty(), |d| d.child(div().rounded_md().border_1().border_color(t.border).p_5().tw_text_sm().text_color(t.muted_foreground).child("Create an empty design or import the current database schema. ERD edits are saved locally and never applied to the database.")))
                .children(self.projects.iter().map(|project| {
                    let id = project.id.clone();
                    let open = project.clone();
                    let delete_id = id.clone();
                    div().flex().items_center().gap_3().rounded_md().border_1().border_color(t.border).bg(t.card).p_3()
                        .child(div().flex_1().flex().flex_col().gap_1()
                            .child(div().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child(project.name.clone()))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} · {} tables · {}", project.schema_name, project.tables.len(), project.db_type))))
                        .child(Button::new(format!("erd-open-{id}")).outline().size(ButtonSize::Sm).label("Open").on_click(move |_, _, cx| open_project(&open, cx)))
                        .child(Button::new(format!("erd-delete-{id}")).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(cx.listener(move |this, _, _, cx| this.delete(&delete_id, cx))))
                }))
                .when_some(self.message.clone(), |d, message| d.child(div().tw_text_xs().text_color(t.muted_foreground).child(message))))
    }
}

pub struct ProjectEditor {
    session: Arc<Session>,
    project: Project,
    title: Entity<InputState>,
    table_name: Entity<InputState>,
    edit_table_name: Entity<InputState>,
    column_name: Entity<InputState>,
    column_type: Entity<InputState>,
    edit_column_name: Entity<InputState>,
    edit_column_type: Entity<InputState>,
    reference_table: Entity<InputState>,
    reference_column: Entity<InputState>,
    selected_table: Option<String>,
    selected_column: Option<String>,
    show_canvas: bool,
    node_drag: Option<NodeDrag>,
    message: Option<String>,
}

impl ProjectEditor {
    fn new(
        params: &serde_json::Value,
        session: Arc<Session>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let project_id = params
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let mut project = load(session.connection.id)
            .into_iter()
            .find(|p| p.id == project_id)
            .unwrap_or_else(|| Project {
                id: project_id.to_owned(),
                name: "Missing ERD".into(),
                schema_name: common::default_schema(&session),
                db_type: common::db_type(&session).into(),
                tables: vec![],
                positions: Default::default(),
            });
        if project.positions.is_empty() {
            for (index, table) in project.tables.iter().enumerate() {
                project.positions.insert(
                    table.name.clone(),
                    (
                        36. + (index % 3) as f32 * 280.,
                        36. + (index / 3) as f32 * 240.,
                    ),
                );
            }
        }
        let title = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(project.name.clone())
                .placeholder("ERD name")
        });
        let table_name = cx.new(|cx| InputState::new(window, cx).placeholder("table_name"));
        let edit_table_name = cx.new(|cx| InputState::new(window, cx).placeholder("table name"));
        let column_name = cx.new(|cx| InputState::new(window, cx).placeholder("column_name"));
        let column_type = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value("TEXT")
                .placeholder("type")
        });
        let edit_column_name = cx.new(|cx| InputState::new(window, cx).placeholder("column name"));
        let edit_column_type = cx.new(|cx| InputState::new(window, cx).placeholder("column type"));
        let reference_table =
            cx.new(|cx| InputState::new(window, cx).placeholder("references table (optional)"));
        let reference_column = cx.new(|cx| InputState::new(window, cx).placeholder("column"));
        let mut this = Self {
            session,
            project,
            title,
            table_name,
            edit_table_name,
            column_name,
            column_type,
            edit_column_name,
            edit_column_type,
            reference_table,
            reference_column,
            selected_table: None,
            selected_column: None,
            show_canvas: false,
            node_drag: None,
            message: None,
        };
        this.persist(cx);
        this
    }

    fn persist(&mut self, cx: &mut Context<Self>) {
        let mut projects = load(self.session.connection.id);
        if let Some(index) = projects.iter().position(|p| p.id == self.project.id) {
            projects[index] = self.project.clone();
        } else {
            projects.insert(0, self.project.clone());
        }
        self.message = save(self.session.connection.id, &projects)
            .err()
            .map(|e| format!("Save failed: {e:#}"));
        if self.message.is_none() {
            rexa_core::emit_studio(
                rexa_core::StudioEvent::RenameTab {
                    tab: TabSpec::View {
                        view: "erd-project".into(),
                        params: serde_json::json!({ "id": format!("erd-project-{}", self.project.id), "projectId": self.project.id }),
                    },
                    title: self.project.name.clone(),
                },
                cx,
            );
        }
    }

    fn rename(&mut self, cx: &mut Context<Self>) {
        let name = self.title.read(cx).value().trim().to_string();
        if !name.is_empty() {
            self.project.name = name;
            self.persist(cx);
        }
        cx.notify();
    }

    fn add_table(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = self.table_name.read(cx).value().trim().to_string();
        if name.is_empty() {
            self.message = Some("Enter a table name.".into());
            cx.notify();
            return;
        }
        if self
            .project
            .tables
            .iter()
            .any(|t| t.name.eq_ignore_ascii_case(&name))
        {
            self.message = Some("That table already exists in this ERD.".into());
            cx.notify();
            return;
        }
        self.project.tables.push(DiagramTable {
            schema: self.project.schema_name.clone(),
            name: name.clone(),
            columns: vec![DiagramColumn {
                name: "id".into(),
                r#type: "INTEGER".into(),
                is_primary: true,
                is_nullable: false,
                references: None,
            }],
        });
        let index = self.project.tables.len() - 1;
        self.project.positions.insert(
            name.clone(),
            (
                36. + (index % 3) as f32 * 280.,
                36. + (index / 3) as f32 * 240.,
            ),
        );
        self.selected_table = Some(name.clone());
        self.selected_column = None;
        self.edit_table_name
            .update(cx, |s, cx| s.set_value(name, window, cx));
        self.table_name
            .update(cx, |s, cx| s.set_value(String::new(), window, cx));
        self.persist(cx);
        cx.notify();
    }

    fn add_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(table_name) = self.selected_table.clone() else {
            self.message = Some("Select a table first.".into());
            cx.notify();
            return;
        };
        let name = self.column_name.read(cx).value().trim().to_string();
        let ty = self.column_type.read(cx).value().trim().to_string();
        let target_table = self.reference_table.read(cx).value().trim().to_string();
        let target_column = self.reference_column.read(cx).value().trim().to_string();
        if name.is_empty() || ty.is_empty() {
            self.message = Some("Column name and type are required.".into());
            cx.notify();
            return;
        }
        let references = if target_table.is_empty() && target_column.is_empty() {
            None
        } else {
            if target_table.is_empty() || target_column.is_empty() {
                self.message = Some("Provide both the referenced table and column.".into());
                cx.notify();
                return;
            }
            let target = self
                .project
                .tables
                .iter()
                .find(|table| table.name.eq_ignore_ascii_case(&target_table));
            if target.is_none_or(|table| {
                !table
                    .columns
                    .iter()
                    .any(|column| column.name.eq_ignore_ascii_case(&target_column))
            }) {
                self.message =
                    Some("The referenced table and column must exist in this ERD.".into());
                cx.notify();
                return;
            }
            Some((
                self.project.schema_name.clone(),
                target_table,
                target_column,
            ))
        };
        let Some(table) = self
            .project
            .tables
            .iter_mut()
            .find(|t| t.name == table_name)
        else {
            return;
        };
        if table
            .columns
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(&name))
        {
            self.message = Some("That column already exists.".into());
            cx.notify();
            return;
        }
        table.columns.push(DiagramColumn {
            name,
            r#type: ty,
            is_primary: false,
            is_nullable: true,
            references,
        });
        self.selected_column = None;
        self.column_name
            .update(cx, |s, cx| s.set_value(String::new(), window, cx));
        self.reference_table
            .update(cx, |s, cx| s.set_value(String::new(), window, cx));
        self.reference_column
            .update(cx, |s, cx| s.set_value(String::new(), window, cx));
        self.persist(cx);
        cx.notify();
    }

    fn select_column(
        &mut self,
        table_name: String,
        column_name: String,
        column_type: String,
        reference: Option<(String, String)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selected_table = Some(table_name);
        self.selected_column = Some(column_name.clone());
        self.edit_column_name
            .update(cx, |s, cx| s.set_value(column_name, window, cx));
        self.edit_column_type
            .update(cx, |s, cx| s.set_value(column_type, window, cx));
        let (target_table, target_column) = reference
            .map_or((String::new(), String::new()), |(table, column)| {
                (table, column)
            });
        self.reference_table
            .update(cx, |s, cx| s.set_value(target_table, window, cx));
        self.reference_column
            .update(cx, |s, cx| s.set_value(target_column, window, cx));
        cx.notify();
    }

    fn select_table(&mut self, name: String, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_table = Some(name.clone());
        self.selected_column = None;
        self.edit_table_name
            .update(cx, |s, cx| s.set_value(name, window, cx));
        cx.notify();
    }

    fn rename_table(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(old_name) = self.selected_table.clone() else {
            return;
        };
        let new_name = self.edit_table_name.read(cx).value().trim().to_string();
        if new_name.is_empty() {
            self.message = Some("Table name is required.".into());
            cx.notify();
            return;
        }
        if self.project.tables.iter().any(|t| {
            !t.name.eq_ignore_ascii_case(&old_name) && t.name.eq_ignore_ascii_case(&new_name)
        }) {
            self.message = Some("That table name is already in use.".into());
            cx.notify();
            return;
        }
        if let Some(table) = self.project.tables.iter_mut().find(|t| t.name == old_name) {
            table.name = new_name.clone();
        }
        if let Some(position) = self.project.positions.remove(&old_name) {
            self.project.positions.insert(new_name.clone(), position);
        }
        for table in &mut self.project.tables {
            for column in &mut table.columns {
                if let Some((_, target, _)) = &mut column.references {
                    if target == &old_name {
                        *target = new_name.clone();
                    }
                }
            }
        }
        self.selected_table = Some(new_name.clone());
        self.edit_table_name
            .update(cx, |s, cx| s.set_value(new_name, window, cx));
        self.persist(cx);
        cx.notify();
    }

    fn toggle_column_primary(&mut self, cx: &mut Context<Self>) {
        let (Some(table_name), Some(column_name)) =
            (self.selected_table.clone(), self.selected_column.clone())
        else {
            return;
        };
        if let Some(column) = self
            .project
            .tables
            .iter_mut()
            .find(|t| t.name == table_name)
            .and_then(|t| t.columns.iter_mut().find(|c| c.name == column_name))
        {
            column.is_primary = !column.is_primary;
            if column.is_primary {
                column.is_nullable = false;
            }
            self.persist(cx);
        }
        cx.notify();
    }

    fn toggle_column_nullable(&mut self, cx: &mut Context<Self>) {
        let (Some(table_name), Some(column_name)) =
            (self.selected_table.clone(), self.selected_column.clone())
        else {
            return;
        };
        if let Some(column) = self
            .project
            .tables
            .iter_mut()
            .find(|t| t.name == table_name)
            .and_then(|t| t.columns.iter_mut().find(|c| c.name == column_name))
        {
            if column.is_primary {
                self.message = Some("Primary key columns cannot be nullable.".into());
            } else {
                column.is_nullable = !column.is_nullable;
                self.persist(cx);
            }
        }
        cx.notify();
    }

    fn update_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(table_name), Some(old_name)) =
            (self.selected_table.clone(), self.selected_column.clone())
        else {
            return;
        };
        let new_name = self.edit_column_name.read(cx).value().trim().to_string();
        let new_type = self.edit_column_type.read(cx).value().trim().to_string();
        let target_table = self.reference_table.read(cx).value().trim().to_string();
        let target_column = self.reference_column.read(cx).value().trim().to_string();
        if new_name.is_empty() || new_type.is_empty() {
            self.message = Some("Column name and type are required.".into());
            cx.notify();
            return;
        }
        let references = if target_table.is_empty() && target_column.is_empty() {
            None
        } else {
            if target_table.is_empty() || target_column.is_empty() {
                self.message = Some("Provide both the referenced table and column, or leave both blank to clear the reference.".into());
                cx.notify();
                return;
            }
            if self
                .project
                .tables
                .iter()
                .find(|table| table.name.eq_ignore_ascii_case(&target_table))
                .is_none_or(|table| {
                    !table
                        .columns
                        .iter()
                        .any(|column| column.name.eq_ignore_ascii_case(&target_column))
                })
            {
                self.message =
                    Some("The referenced table and column must exist in this ERD.".into());
                cx.notify();
                return;
            }
            Some((
                self.project.schema_name.clone(),
                target_table,
                target_column,
            ))
        };
        let Some(table) = self
            .project
            .tables
            .iter_mut()
            .find(|t| t.name == table_name)
        else {
            return;
        };
        if table.columns.iter().any(|c| {
            !c.name.eq_ignore_ascii_case(&old_name) && c.name.eq_ignore_ascii_case(&new_name)
        }) {
            self.message = Some("That column name is already in use.".into());
            cx.notify();
            return;
        }
        let Some(column) = table.columns.iter_mut().find(|c| c.name == old_name) else {
            return;
        };
        column.name = new_name.clone();
        column.r#type = new_type;
        column.references = references;
        if old_name != new_name {
            for source in &mut self.project.tables {
                for col in &mut source.columns {
                    if let Some((_, target, target_col)) = &mut col.references {
                        if target == &table_name && target_col == &old_name {
                            *target_col = new_name.clone();
                        }
                    }
                }
            }
        }
        self.selected_column = Some(new_name.clone());
        self.edit_column_name
            .update(cx, |s, cx| s.set_value(new_name, window, cx));
        self.persist(cx);
        cx.notify();
    }

    fn delete_table(&mut self, name: &str, cx: &mut Context<Self>) {
        self.project.tables.retain(|table| table.name != name);
        self.project.positions.remove(name);
        for table in &mut self.project.tables {
            for column in &mut table.columns {
                if column
                    .references
                    .as_ref()
                    .is_some_and(|(_, target, _)| target == name)
                {
                    column.references = None;
                }
            }
        }
        if self.selected_table.as_deref() == Some(name) {
            self.selected_table = None;
            self.selected_column = None;
        }
        self.persist(cx);
        cx.notify();
    }

    fn delete_column(&mut self, table_name: &str, column_name: &str, cx: &mut Context<Self>) {
        if let Some(table) = self
            .project
            .tables
            .iter_mut()
            .find(|table| table.name == table_name)
        {
            table.columns.retain(|column| column.name != column_name);
        }
        for table in &mut self.project.tables {
            for column in &mut table.columns {
                if column
                    .references
                    .as_ref()
                    .is_some_and(|(_, target, target_column)| {
                        target == table_name && target_column == column_name
                    })
                {
                    column.references = None;
                }
            }
        }
        self.persist(cx);
        if self.selected_table.as_deref() == Some(table_name)
            && self.selected_column.as_deref() == Some(column_name)
        {
            self.selected_column = None;
        }
        cx.notify();
    }

    fn copy_sql(&self, cx: &mut Context<Self>) {
        if self.project.tables.is_empty() {
            rexa_ui::Toast::info("Add at least one table first.").show(cx);
            return;
        }
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(erd::build_schema_sql(
            &self.project.tables,
            &self.project.schema_name,
            &self.project.db_type,
        )));
        rexa_ui::Toast::success("ERD SQL copied to clipboard").show(cx);
    }

    fn auto_layout(&mut self, cx: &mut Context<Self>) {
        for (index, table) in self.project.tables.iter().enumerate() {
            self.project.positions.insert(
                table.name.clone(),
                (
                    36. + (index % 3) as f32 * 280.,
                    36. + (index / 3) as f32 * 240.,
                ),
            );
        }
        self.persist(cx);
        cx.notify();
    }

    fn diagram_canvas(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let max_x = self
            .project
            .tables
            .iter()
            .filter_map(|table| self.project.positions.get(&table.name).map(|p| p.0))
            .fold(0f32, f32::max);
        let max_y = self
            .project
            .tables
            .iter()
            .filter_map(|table| self.project.positions.get(&table.name).map(|p| p.1))
            .fold(0f32, f32::max);
        let width = (max_x + DESIGN_NODE_WIDTH + 80.).max(640.);
        let height = (max_y
            + DESIGN_NODE_HEADER
            + self
                .project
                .tables
                .iter()
                .map(|t| t.columns.len() as f32 * DESIGN_NODE_ROW)
                .fold(80f32, f32::max)
            + 80.)
            .max(420.);
        let mut lines = Vec::new();
        for source in &self.project.tables {
            let Some(&(sx, sy)) = self.project.positions.get(&source.name) else {
                continue;
            };
            for (row, column) in source.columns.iter().enumerate() {
                let Some((_, target_name, target_column)) = &column.references else {
                    continue;
                };
                let Some(target) = self
                    .project
                    .tables
                    .iter()
                    .find(|table| table.name == *target_name)
                else {
                    continue;
                };
                let Some(&(tx, ty)) = self.project.positions.get(&target.name) else {
                    continue;
                };
                let target_row = target
                    .columns
                    .iter()
                    .position(|column| column.name == *target_column)
                    .unwrap_or(0);
                lines.push((
                    sx + DESIGN_NODE_WIDTH,
                    sy + DESIGN_NODE_HEADER + row as f32 * DESIGN_NODE_ROW + DESIGN_NODE_ROW / 2.,
                    tx,
                    ty + DESIGN_NODE_HEADER
                        + target_row as f32 * DESIGN_NODE_ROW
                        + DESIGN_NODE_ROW / 2.,
                ));
            }
        }
        let line_color = t.muted_foreground;
        let mut content = div().relative().w(px(width)).h(px(height)).child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    for (x1, y1, x2, y2) in &lines {
                        let mut path = PathBuilder::stroke(px(1.5));
                        path.move_to(point(bounds.origin.x + px(*x1), bounds.origin.y + px(*y1)));
                        path.line_to(point(bounds.origin.x + px(*x2), bounds.origin.y + px(*y2)));
                        if let Ok(path) = path.build() {
                            window.paint_path(path, line_color);
                        }
                    }
                },
            )
            .absolute()
            .size_full(),
        );
        for table in &self.project.tables {
            let Some(&(x, y)) = self.project.positions.get(&table.name) else {
                continue;
            };
            let id = table.name.clone();
            let header = table.name.clone();
            let columns: Vec<_> = table
                .columns
                .iter()
                .map(|column| {
                    let marker = if column.is_primary {
                        "🔑 "
                    } else if column.references.is_some() {
                        "↗ "
                    } else {
                        ""
                    };
                    let label = format!("{marker}{}", column.name);
                    let ty = column.r#type.clone();
                    (label, ty)
                })
                .collect();
            let position = (x, y);
            content = content.child(
                div()
                    .absolute()
                    .left(px(x))
                    .top(px(y))
                    .w(px(DESIGN_NODE_WIDTH))
                    .rounded_md()
                    .border_1()
                    .border_color(t.border)
                    .bg(t.card)
                    .shadow_sm()
                    .child(
                        div()
                            .h(px(DESIGN_NODE_HEADER))
                            .px_3()
                            .flex()
                            .items_center()
                            .bg(t.accent.opacity(0.14))
                            .border_b_1()
                            .border_color(t.border)
                            .cursor_move()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, e: &MouseDownEvent, _, _| {
                                    this.node_drag = Some(NodeDrag {
                                        id: id.clone(),
                                        start: e.position,
                                        origin: position,
                                    });
                                }),
                            )
                            .child(
                                div()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .tw_text_sm()
                                    .child(header),
                            ),
                    )
                    .children(columns.into_iter().map(|(name, ty)| {
                        div()
                            .h(px(DESIGN_NODE_ROW))
                            .px_2()
                            .flex()
                            .items_center()
                            .border_b_1()
                            .border_color(t.border.opacity(0.45))
                            .child(
                                div()
                                    .flex_1()
                                    .font_family(rexa_ui::MONO)
                                    .tw_text_xs()
                                    .child(name),
                            )
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(ty))
                    })),
            )
        }
        let move_listener = cx.listener(|this, event: &MouseMoveEvent, _, cx| {
            if event.pressed_button != Some(MouseButton::Left) {
                return;
            }
            if let Some(drag) = &this.node_drag {
                let position = (
                    drag.origin.0 + f32::from(event.position.x - drag.start.x),
                    drag.origin.1 + f32::from(event.position.y - drag.start.y),
                );
                this.project.positions.insert(drag.id.clone(), position);
                cx.notify();
            }
        });
        let up_listener = cx.listener(|this, _, _, cx| {
            if this.node_drag.take().is_some() {
                this.persist(cx);
                cx.notify();
            }
        });
        div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_scrollbar()
            .bg(t.studio_bg)
            .on_mouse_move(move_listener)
            .on_mouse_up(MouseButton::Left, up_listener)
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.node_drag.take().is_some() {
                        this.persist(cx);
                        cx.notify();
                    }
                }),
            )
            .child(content)
            .into_any_element()
    }
}

impl Render for ProjectEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let selected = self.selected_table.clone();
        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground)
            .child(div().flex().items_center().gap_3().px_4().py_3().border_b_1().border_color(t.border)
                .child(div().w(px(300.)).child(Input::new(&self.title).appearance(false)))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("Local design · {}", self.project.schema_name)))
                .child(div().flex_1())
                .child(Button::new("erd-project-save-name").outline().size(ButtonSize::Sm).icon(IconName::Check).label("Save name").on_click(cx.listener(|this, _, _, cx| this.rename(cx))))
                .child(Button::new("erd-project-toggle-diagram").outline().size(ButtonSize::Sm).label(if self.show_canvas { "Edit" } else { "Diagram" }).on_click(cx.listener(|this, _, _, cx| { this.show_canvas = !this.show_canvas; cx.notify(); })))
                .when(self.show_canvas, |d| d.child(Button::new("erd-project-auto-layout").outline().size(ButtonSize::Sm).label("Auto layout").on_click(cx.listener(|this, _, _, cx| this.auto_layout(cx)))))
                .child(Button::new("erd-project-copy-sql").outline().size(ButtonSize::Sm).icon(IconName::Copy).label("Copy SQL").on_click(cx.listener(|this, _, _, cx| this.copy_sql(cx)))))
            .child(div().flex().flex_1().min_h_0()
                .child(div().w(px(300.)).flex_shrink_0().border_r_1().border_color(t.border).flex().flex_col()
                    .child(div().p_3().flex().gap_2().child(div().flex_1().child(Input::new(&self.table_name))).child(Button::new("erd-project-add-table").size(ButtonSize::Sm).icon(IconName::Plus).on_click(cx.listener(|this, _, window, cx| this.add_table(window, cx)))))
                    .child(div().flex_1().min_h_0().overflow_y_scrollbar().p_2().flex().flex_col().gap_1()
                        .when(self.project.tables.is_empty(), |d| d.child(div().p_3().tw_text_xs().text_color(t.muted_foreground).child("No tables yet. Add one or import the current schema from the ERD projects screen.")))
                        .children(self.project.tables.iter().map(|table| {
                            let name = table.name.clone(); let del = name.clone();
                            div().id(SharedString::from(format!("erd-select-table-{name}"))).flex().items_center().gap_1().rounded_md().px_2().py_1().cursor_pointer().when(selected.as_deref() == Some(name.as_str()), |d| d.bg(t.accent.opacity(0.16)))
                                .on_click(cx.listener(move |this, _, window, cx| this.select_table(name.clone(), window, cx)))
                                .child(div().flex_1().child(div().tw_text_sm().child(table.name.clone())).child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} columns", table.columns.len()))))
                                .child(Button::new(format!("erd-delete-table-{del}")).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(cx.listener(move |this, _, _, cx| { cx.stop_propagation(); this.delete_table(&del, cx); })))
                        }))))
                .child(div().flex_1().min_w_0().overflow_y_scrollbar().p_5()
                    .when(self.show_canvas, |d| d.child(self.diagram_canvas(cx)))
                    .when(!self.show_canvas, |d| d
                    .when_some(self.project.tables.iter().find(|table| Some(table.name.as_str()) == selected.as_deref()), |d, table| {
                        d.child(div().flex().flex_col().gap_3()
                            .child(div().tw_text_lg().font_weight(gpui::FontWeight::SEMIBOLD).child(table.name.clone()))
                            .child(div().flex().items_center().gap_2()
                                .child(div().w(px(240.)).child(Input::new(&self.edit_table_name)))
                                .child(Button::new("erd-project-rename-table").outline().size(ButtonSize::Sm).icon(IconName::Check).label("Rename table").on_click(cx.listener(|this, _, window, cx| this.rename_table(window, cx)))))
                            .child(div().flex().flex_col().gap_1().children(table.columns.iter().map(|column| {
                                let table_name = table.name.clone(); let column_name = column.name.clone(); let column_type = column.r#type.clone();
                                let reference = column.references.as_ref().map(|(_, table, column)| (table.clone(), column.clone()));
                                let (table_for_select, column_for_select, type_for_select, reference_for_select) = (table_name.clone(), column_name.clone(), column_type.clone(), reference);
                                div().flex().items_center().gap_3().border_b_1().border_color(t.border).px_2().py_2()
                                    .id(SharedString::from(format!("erd-select-column-{}-{}", table_name, column.name)))
                                    .cursor_pointer()
                                    .when(self.selected_column.as_deref() == Some(column.name.as_str()), |d| d.bg(t.accent.opacity(0.12)))
                                    .on_click(cx.listener(move |this, _, window, cx| this.select_column(table_for_select.clone(), column_for_select.clone(), type_for_select.clone(), reference_for_select.clone(), window, cx)))
                                    .child(div().flex_1().font_family(rexa_ui::MONO).tw_text_sm().child(column.name.clone()))
                                    .child(div().w(px(140.)).tw_text_xs().text_color(t.muted_foreground).child(column.r#type.clone()))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(if column.is_primary { "PRIMARY KEY" } else if column.is_nullable { "NULL" } else { "NOT NULL" }))
                                    .child(Button::new(format!("erd-delete-column-{table_name}-{column_name}")).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(cx.listener(move |this, _, _, cx| { cx.stop_propagation(); this.delete_column(&table_name, &column_name, cx); })))
                            })))
                            .child(div().flex().items_center().gap_2().pt_3()
                                .child(div().w(px(210.)).child(Input::new(&self.edit_column_name)))
                                .child(div().w(px(150.)).child(Input::new(&self.edit_column_type)))
                                .child(Button::new("erd-project-update-column").outline().size(ButtonSize::Sm).icon(IconName::Check).label("Update column").disabled(self.selected_column.is_none()).on_click(cx.listener(|this, _, window, cx| this.update_column(window, cx))))
                                .child(Button::new("erd-project-toggle-primary").outline().size(ButtonSize::Sm).icon(IconName::Key).label("Primary key").disabled(self.selected_column.is_none()).on_click(cx.listener(|this, _, _, cx| this.toggle_column_primary(cx))))
                                .child(Button::new("erd-project-toggle-nullable").outline().size(ButtonSize::Sm).icon(IconName::Diamond).label("Toggle nullable").disabled(self.selected_column.is_none()).on_click(cx.listener(|this, _, _, cx| this.toggle_column_nullable(cx)))))
                            .child(div().flex().items_center().gap_2().pt_3()
                                .child(div().w(px(210.)).child(Input::new(&self.column_name)))
                                .child(div().w(px(150.)).child(Input::new(&self.column_type)))
                                .child(div().w(px(170.)).child(Input::new(&self.reference_table)))
                                .child(div().w(px(120.)).child(Input::new(&self.reference_column)))
                                .child(Button::new("erd-project-add-column").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Add column").on_click(cx.listener(|this, _, window, cx| this.add_column(window, cx)))))
                        )
                    })
                    .when(self.project.tables.is_empty(), |d| d.child(div().tw_text_sm().text_color(t.muted_foreground).child("Design the table structure here. This editor saves a local model; Copy SQL exports the DDL for review.")))
                    .when_some(self.message.clone(), |d, message| d.child(div().pt_3().tw_text_xs().text_color(t.muted_foreground).child(message))))))
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-erd-projects", |spec, session, window, cx| {
        let TabSpec::View { view, params } = spec else {
            return None;
        };
        match view.as_str() {
            "erd-designer" => Some(Into::<AnyView>::into(cx.new(|_| ProjectList::new(session)))),
            "erd-project" => {
                let params = params.clone();
                Some(Into::<AnyView>::into(
                    cx.new(|cx| ProjectEditor::new(&params, session, window, cx)),
                ))
            }
            _ => None,
        }
    });
}
