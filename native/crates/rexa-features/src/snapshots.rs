//! Port of `components/studio/snapshots/snapshots-view.tsx` and
//! `snapshot-detail.tsx`: browse saved snapshots and inspect their schema/data.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, Entity, SharedString, Window};
use gpui_component::input::InputState;
use gpui_component::scroll::ScrollableElement;
use rexa_core::{Registry, Session, TabSpec};
use rexa_drivers::{Driver, Kind, SchemaColumn};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, TextInput, Tw};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf, sync::Arc};

fn snapshot_dir(connection_id: i64) -> PathBuf {
    rexa_store::app_data_dir()
        .join("snapshots")
        .join(connection_id.to_string())
}

fn load_snapshots(connection_id: i64) -> Result<Vec<Value>, String> {
    let dir = snapshot_dir(connection_id);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Could not read snapshots: {error}")),
    };
    let mut snapshots = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read snapshot entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            // A partially written or old snapshot should not hide other files.
            Err(_) => continue,
        };
        if let Ok(snapshot) = serde_json::from_str::<Value>(&content) {
            if snapshot.get("meta").is_some_and(Value::is_object) {
                snapshots.push(snapshot);
            }
        }
    }
    snapshots.sort_by(|a, b| {
        b["meta"]["createdAt"]
            .as_str()
            .cmp(&a["meta"]["createdAt"].as_str())
    });
    Ok(snapshots)
}

fn load_snapshot(connection_id: i64, id: &str) -> Result<Value, String> {
    if !safe_snapshot_id(id) {
        return Err("Invalid snapshot id.".into());
    }
    let path = snapshot_dir(connection_id).join(format!("{id}.json"));
    let content =
        fs::read_to_string(path).map_err(|error| format!("Could not open snapshot: {error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("Snapshot file is invalid: {error}"))
}

fn meta_text(meta: &Value, key: &str) -> String {
    meta.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn number(meta: &Value, key: &str) -> u64 {
    meta.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn supported_engine(kind: Kind) -> Option<&'static str> {
    match kind {
        Kind::Postgres | Kind::SupabaseMgmt => Some("postgres"),
        Kind::MySql => Some("mysql"),
        Kind::Sqlite => Some("sqlite"),
        _ => None,
    }
}

fn safe_snapshot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut separator = false;
    for ch in name.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            if separator && !out.is_empty() {
                out.push('-');
            }
            out.push(ch);
            separator = false;
        } else {
            separator = true;
        }
        if out.len() >= 60 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "snapshot".into()
    } else {
        out
    }
}

fn cell_json(cell: &rexa_drivers::Cell, data_type: &str) -> Value {
    let Some(raw) = cell.as_str() else {
        return Value::Null;
    };
    let kind = data_type.to_ascii_lowercase();
    if matches!(kind.as_str(), "bool" | "boolean" | "bit") {
        return match raw.to_ascii_lowercase().as_str() {
            "true" | "1" => Value::Bool(true),
            "false" | "0" => Value::Bool(false),
            _ => Value::String(raw.to_owned()),
        };
    }
    if kind.contains("int")
        || matches!(
            kind.as_str(),
            "real" | "float" | "double precision" | "numeric" | "decimal"
        )
    {
        if let Ok(n) = raw.parse::<i64>() {
            return json!(n);
        }
        if let Ok(n) = raw.parse::<f64>() {
            if n.is_finite() {
                return json!(n);
            }
        }
    }
    Value::String(raw.to_owned())
}

fn sql_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(value) => {
            if *value {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        Value::Number(value) => value.to_string(),
        _ => format!(
            "'{}'",
            value
                .as_str()
                .unwrap_or_default()
                .replace('\\', "\\\\")
                .replace('\'', "''")
        ),
    }
}

async fn create_snapshot_file(
    driver: Arc<dyn Driver>,
    connection_id: i64,
    connection_string: String,
    name: String,
) -> anyhow::Result<Value> {
    let kind = driver.kind();
    let engine = supported_engine(kind).ok_or_else(|| {
        anyhow::anyhow!("Snapshots currently support PostgreSQL, MySQL, and SQLite.")
    })?;
    let rows = driver.all_tables_with_columns(None).await?;
    let mut grouped: BTreeMap<(String, String), Vec<SchemaColumn>> = BTreeMap::new();
    for row in rows {
        grouped
            .entry((row.table_schema.clone(), row.table_name.clone()))
            .or_default()
            .push(row);
    }
    if grouped.is_empty() {
        anyhow::bail!("No tables were found to include in the snapshot.");
    }

    let dialect = driver.dialect();
    let mut schema_tables = Vec::new();
    let mut data_tables = serde_json::Map::new();
    let mut schema_sql = String::new();
    let mut data_sql = String::new();
    let mut row_count = 0u64;
    for ((schema, table), columns) in grouped {
        let primary_key: Vec<String> = columns
            .iter()
            .filter(|c| c.is_primary)
            .map(|c| c.column_name.clone())
            .collect();
        let foreign_keys: Vec<Value> = columns.iter().filter_map(|c| {
            let foreign_table = c.referenced_table_name.as_ref()?;
            let foreign_column = c.referenced_column_name.as_ref()?;
            Some(json!({"name": format!("fk_{}_{}", table, c.column_name), "columns": [c.column_name], "foreignSchema": c.referenced_table_schema.as_deref().unwrap_or(&schema), "foreignTable": foreign_table, "foreignColumns": [foreign_column]}))
        }).collect();
        let schema_columns: Vec<Value> = columns
            .iter()
            .map(|c| {
                json!({
                    "name": c.column_name, "dataType": c.data_type, "isNullable": c.is_nullable,
                    "defaultValue": c.column_default, "isPrimary": c.is_primary
                })
            })
            .collect();
        let table_ref = dialect.table_ref(&schema, &table);
        let col_names: Vec<String> = columns.iter().map(|c| c.column_name.clone()).collect();
        let select_cols = col_names
            .iter()
            .map(|c| driver.quote_ident(c))
            .collect::<Vec<_>>()
            .join(", ");
        let order = if !primary_key.is_empty() {
            primary_key.clone()
        } else {
            col_names.first().cloned().into_iter().collect()
        };
        let order_clause = if order.is_empty() {
            String::new()
        } else {
            format!(
                " ORDER BY {}",
                order
                    .iter()
                    .map(|c| driver.quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let query = format!("SELECT * FROM {table_ref}{order_clause} LIMIT 500");
        let result = driver.execute(&query, 500).await?;
        let json_rows: Vec<Value> = result
            .rows
            .iter()
            .map(|row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    if let Some(cell) = row.get(index) {
                        object.insert(
                            column.column_name.clone(),
                            cell_json(cell, &column.data_type),
                        );
                    }
                }
                Value::Object(object)
            })
            .collect();
        row_count += json_rows.len() as u64;
        let table_key = format!("{schema}.{table}");
        data_tables.insert(table_key.clone(), Value::Array(json_rows.clone()));
        schema_tables.push(json!({"schema": schema, "name": table, "columns": schema_columns, "primaryKey": primary_key, "indexes": [], "foreignKeys": foreign_keys}));

        let mut definitions: Vec<String> = columns
            .iter()
            .map(|column| {
                format!(
                    "  {} {}{}",
                    driver.quote_ident(&column.column_name),
                    column.data_type,
                    if column.is_nullable { "" } else { " NOT NULL" }
                )
            })
            .collect();
        if !primary_key.is_empty() {
            definitions.push(format!(
                "  PRIMARY KEY ({})",
                primary_key
                    .iter()
                    .map(|c| driver.quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        schema_sql.push_str(&format!(
            "CREATE TABLE {table_ref} (\n{}\n);\n\n",
            definitions.join(",\n")
        ));
        if !json_rows.is_empty() && !col_names.is_empty() {
            for row in json_rows {
                let values = col_names
                    .iter()
                    .map(|column| sql_literal(&row[column]))
                    .collect::<Vec<_>>()
                    .join(", ");
                data_sql.push_str(&format!(
                    "INSERT INTO {table_ref} ({select_cols}) VALUES ({values});\n"
                ));
            }
        }
    }

    let schema = json!({"tables": schema_tables, "views": [], "enums": []});
    let schema_json = serde_json::to_string(&schema)?;
    let mut hash = 0i32;
    for unit in schema_json.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(unit as i32);
    }
    let created_at = chrono::Utc::now();
    let name = name.trim();
    let id = format!(
        "{}-{:03}-{}",
        created_at.format("%Y%m%dT%H%M%S"),
        created_at.timestamp_subsec_millis(),
        slug(name)
    );
    let snapshot = json!({
        "meta": { "id": id, "name": name, "description": "", "createdAt": created_at.to_rfc3339(), "engine": engine,
            "connectionString": connection_string, "tableCount": schema["tables"].as_array().map_or(0, Vec::len),
            "rowCount": row_count, "schemaHash": format!("{:x}", hash.unsigned_abs()) },
        "schemaSQL": schema_sql, "dataSQL": data_sql, "schemaStructured": schema, "dataTables": data_tables
    });
    let dir = snapshot_dir(connection_id);
    fs::create_dir_all(&dir)?;
    let final_path = dir.join(format!("{id}.json"));
    let temp_path = dir.join(format!(".{id}.json.tmp"));
    fs::write(&temp_path, serde_json::to_vec_pretty(&snapshot)?)?;
    fs::rename(&temp_path, &final_path)?;
    Ok(snapshot)
}

pub struct Snapshots {
    connection_id: i64,
    connection_string: String,
    driver: Arc<dyn Driver>,
    snapshots: Vec<Value>,
    selected: Option<Value>,
    error: Option<String>,
    show_schema: bool,
    show_data: bool,
    compare_mode: bool,
    selected_ids: Vec<String>,
    diff: Option<Value>,
    expanded_diffs: std::collections::HashSet<String>,
    name: Entity<InputState>,
    creating: bool,
}

impl Snapshots {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let connection_id = session.connection.id;
        let connection_string = session.connection.connection_string.clone();
        let driver = session.driver.clone();
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("Snapshot name"));
        let (snapshots, error) = match load_snapshots(connection_id) {
            Ok(snapshots) => (snapshots, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Self {
            connection_id,
            connection_string,
            driver,
            snapshots,
            selected: None,
            error,
            show_schema: false,
            show_data: false,
            compare_mode: false,
            selected_ids: Vec::new(),
            diff: None,
            expanded_diffs: std::collections::HashSet::new(),
            name,
            creating: false,
        }
    }

    fn create(&mut self, cx: &mut Context<Self>) {
        if self.creating {
            return;
        }
        let name = self.name.read(cx).value().trim().to_string();
        if name.is_empty() {
            self.error = Some("Enter a snapshot name first.".into());
            cx.notify();
            return;
        }
        if supported_engine(self.driver.kind()).is_none() {
            self.error = Some("Snapshots currently support PostgreSQL, MySQL, and SQLite.".into());
            cx.notify();
            return;
        }
        self.creating = true;
        self.error = None;
        cx.notify();
        let driver = self.driver.clone();
        let id = self.connection_id;
        let connection_string = self.connection_string.clone();
        let task = rexa_core::runtime::spawn(async move {
            create_snapshot_file(driver, id, connection_string, name).await
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.creating = false;
                match result {
                    Ok(snapshot) => {
                        this.snapshots.push(snapshot);
                        this.snapshots.sort_by(|a, b| {
                            b["meta"]["createdAt"]
                                .as_str()
                                .cmp(&a["meta"]["createdAt"].as_str())
                        });
                        this.selected = None;
                        rexa_ui::toast::success("Snapshot created", cx);
                    }
                    Err(error) => {
                        this.error = Some(format!("Could not create snapshot: {error:#}"))
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn delete(&mut self, id: &str, cx: &mut Context<Self>) {
        if !safe_snapshot_id(id) {
            self.error = Some("Invalid snapshot id.".into());
            cx.notify();
            return;
        }
        match fs::remove_file(snapshot_dir(self.connection_id).join(format!("{id}.json"))) {
            Ok(()) => {
                self.snapshots
                    .retain(|s| s["meta"]["id"].as_str() != Some(id));
                self.selected = None;
                self.error = None;
            }
            Err(error) => self.error = Some(format!("Could not delete snapshot: {error}")),
        }
        cx.notify();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        match load_snapshots(self.connection_id) {
            Ok(snapshots) => {
                self.snapshots = snapshots;
                self.error = None;
                self.selected = None;
            }
            Err(error) => self.error = Some(error),
        }
        cx.notify();
    }

    fn open_snapshot(&mut self, id: String, cx: &mut Context<Self>) {
        if self.compare_mode {
            if self.selected_ids.contains(&id) {
                self.selected_ids.retain(|selected| selected != &id);
            } else {
                if self.selected_ids.len() == 2 {
                    self.selected_ids.remove(0);
                }
                self.selected_ids.push(id);
            }
            cx.notify();
            return;
        }
        self.selected = self
            .snapshots
            .iter()
            .find(|snapshot| snapshot["meta"]["id"].as_str() == Some(&id))
            .cloned();
        self.show_schema = false;
        self.show_data = false;
        cx.notify();
    }

    fn compare_selected(&mut self, cx: &mut Context<Self>) {
        if self.selected_ids.len() != 2 {
            return;
        }
        let mut selected = self.selected_ids.clone();
        selected.sort();
        let find = |id: &str| {
            self.snapshots
                .iter()
                .find(|snapshot| snapshot["meta"]["id"].as_str() == Some(id))
        };
        let (Some(older), Some(newer)) = (find(&selected[0]), find(&selected[1])) else {
            self.error = Some("Could not load the selected snapshots.".into());
            cx.notify();
            return;
        };
        self.diff = Some(compare_snapshots(older, newer));
        self.compare_mode = false;
        self.selected_ids.clear();
        cx.notify();
    }

    fn leave_comparison(&mut self, cx: &mut Context<Self>) {
        self.diff = None;
        self.selected_ids.clear();
        cx.notify();
    }

    fn toggle_diff(&mut self, table: String, cx: &mut Context<Self>) {
        if !self.expanded_diffs.remove(&table) {
            self.expanded_diffs.insert(table);
        }
        cx.notify();
    }

    fn render_comparison(&mut self, diff: Value, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let summary = &diff["summary"];
        let schema_changes = diff["schemaChanges"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let data_changes = diff["dataChanges"].as_array().cloned().unwrap_or_default();
        let schema_rows = schema_changes.iter().map(|change| {
            let action = change["action"].as_str().unwrap_or("modified");
            let color = match action {
                "added" => rexa_ui::tw("emerald-500"),
                "removed" => rexa_ui::tw("red-500"),
                _ => rexa_ui::tw("amber-500"),
            };
            div()
                .flex()
                .items_center()
                .gap_2()
                .py_1()
                .tw_text_xs()
                .child(div().text_color(color).child(action.to_owned()))
                .child(
                    div()
                        .text_color(t.muted_foreground)
                        .child(change["type"].as_str().unwrap_or_default().to_owned()),
                )
                .child(
                    div()
                        .font_family(rexa_ui::MONO)
                        .child(change["entityName"].as_str().unwrap_or_default().to_owned()),
                )
                .when(change["details"].as_str().is_some(), |el| {
                    el.child(
                        div()
                            .ml_auto()
                            .text_color(t.muted_foreground)
                            .child(change["details"].as_str().unwrap_or_default().to_owned()),
                    )
                })
        });
        let table_cards = data_changes.iter().map(|change| {
            let table = change["table"].as_str().unwrap_or_default().to_owned();
            let expanded = self.expanded_diffs.contains(&table);
            let added = number(change, "rowsAdded");
            let removed = number(change, "rowsRemoved");
            let modified = number(change, "rowsModified");
            let preview = if expanded {
                let mut lines = Vec::new();
                for (label, rows, sign) in [
                    ("Removed", &change["sampleRemoved"], "−"),
                    ("Added", &change["sampleAdded"], "+"),
                ] {
                    for row in rows.as_array().into_iter().flatten() {
                        lines.push(format!(
                            "{sign} {label}: {}",
                            serde_json::to_string(row).unwrap_or_default()
                        ));
                    }
                }
                for row in change["sampleModified"].as_array().into_iter().flatten() {
                    lines.push(format!(
                        "~ Old: {}",
                        serde_json::to_string(&row["old"]).unwrap_or_default()
                    ));
                    lines.push(format!(
                        "~ New: {}",
                        serde_json::to_string(&row["new"]).unwrap_or_default()
                    ));
                }
                lines.join("\n")
            } else {
                String::new()
            };
            div()
                .flex()
                .flex_col()
                .gap_2()
                .border_1()
                .border_color(t.border)
                .rounded_md()
                .p_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            rexa_ui::widgets::Icon::new(IconName::Table2)
                                .size_4()
                                .text_color(t.muted_foreground),
                        )
                        .child(
                            div()
                                .flex_1()
                                .font_family(rexa_ui::MONO)
                                .tw_text_sm()
                                .child(table.clone()),
                        )
                        .when(added > 0, |el| {
                            el.child(
                                div()
                                    .text_color(rexa_ui::tw("emerald-500"))
                                    .tw_text_xs()
                                    .child(format!("+{added}")),
                            )
                        })
                        .when(removed > 0, |el| {
                            el.child(
                                div()
                                    .text_color(rexa_ui::tw("red-500"))
                                    .tw_text_xs()
                                    .child(format!("−{removed}")),
                            )
                        })
                        .when(modified > 0, |el| {
                            el.child(
                                div()
                                    .text_color(rexa_ui::tw("amber-500"))
                                    .tw_text_xs()
                                    .child(format!("~{modified}")),
                            )
                        })
                        .child(
                            Button::new(format!("diff-expand-{table}"))
                                .ghost()
                                .size(ButtonSize::Sm)
                                .icon(if expanded {
                                    IconName::ChevronDown
                                } else {
                                    IconName::ChevronRight
                                })
                                .label(if expanded { "Hide preview" } else { "Preview" })
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.toggle_diff(table.clone(), cx)
                                })),
                        ),
                )
                .when(expanded && !preview.is_empty(), |el| {
                    el.child(code_block(&preview, &t))
                })
        });
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .px_4()
                    .py_3()
                    .border_b_1()
                    .border_color(t.border)
                    .child(
                        Button::new("snapshot-compare-back")
                            .ghost()
                            .size(ButtonSize::Sm)
                            .icon(IconName::ArrowLeft)
                            .label("Snapshots")
                            .on_click(cx.listener(|this, _, _, cx| this.leave_comparison(cx))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .truncate()
                            .tw_text_sm()
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(format!(
                                "{} → {}",
                                diff["olderName"].as_str().unwrap_or("Older"),
                                diff["newerName"].as_str().unwrap_or("Newer")
                            )),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(summary_card(
                                "Tables Changed",
                                format!(
                                    "{} added · {} removed · {} modified",
                                    number(summary, "tablesAdded"),
                                    number(summary, "tablesRemoved"),
                                    number(summary, "tablesModified")
                                ),
                                &t,
                            ))
                            .child(summary_card(
                                "Rows Added",
                                number(summary, "rowsAdded").to_string(),
                                &t,
                            ))
                            .child(summary_card(
                                "Rows Removed",
                                number(summary, "rowsRemoved").to_string(),
                                &t,
                            )),
                    )
                    .when(!schema_changes.is_empty(), |el| {
                        el.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .border_1()
                                .border_color(t.border)
                                .rounded_md()
                                .p_3()
                                .child(
                                    div()
                                        .tw_text_xs()
                                        .font_weight(gpui::FontWeight::BOLD)
                                        .text_color(t.muted_foreground)
                                        .child(format!(
                                            "SCHEMA CHANGES ({})",
                                            schema_changes.len()
                                        )),
                                )
                                .children(schema_rows),
                        )
                    })
                    .children(table_cards)
                    .when(schema_changes.is_empty() && data_changes.is_empty(), |el| {
                        el.child(
                            div()
                                .rounded_md()
                                .bg(rexa_ui::with_alpha(t.primary, 0.08))
                                .p_3()
                                .tw_text_sm()
                                .child("Snapshots are identical. No changes detected."),
                        )
                    }),
            )
    }
}

impl Render for Snapshots {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        if let Some(diff) = self.diff.clone() {
            return self.render_comparison(diff, cx).into_any_element();
        }
        let selected = self.selected.clone();
        let mut root = div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground);

        if let Some(snapshot) = selected {
            let meta = snapshot.get("meta").cloned().unwrap_or(Value::Null);
            let name = meta_text(&meta, "name");
            let snapshot_id = meta_text(&meta, "id");
            let delete_snapshot_id = snapshot_id.clone();
            let compare_snapshot_id = snapshot_id.clone();
            let tables = snapshot["schemaStructured"]["tables"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let table_lines =
                tables.iter().map(|table| {
                    let schema = table["schema"].as_str().unwrap_or_default();
                    let name = table["name"].as_str().unwrap_or_default();
                    let count = table["columns"].as_array().map_or(0, Vec::len);
                    let table_ref = format!("{schema}.{name}");
                    let snapshot_id = snapshot_id.clone();
                    Button::new(format!("snapshot-table-{table_ref}"))
                    .ghost()
                    .w_full()
                    .child(div().flex().items_center().gap_2().py_1().w_full()
                    .child(div().tw_text_sm().font_family(rexa_ui::MONO).child(table_ref.clone()))
                    .child(
                        div()
                            .ml_auto()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(format!("{count} columns")),
                    ))
                    .on_click(cx.listener(move |_, _, _, cx| {
                        rexa_core::open_tab(
                            TabSpec::View {
                                view: "snapshot-table".into(),
                                params: json!({"snapshotId": snapshot_id, "tableRef": table_ref}),
                            },
                            cx,
                        );
                    }))
                });
            let meta_line = format!(
                "{} · {} tables · {} rows",
                meta_text(&meta, "createdAt"),
                number(&meta, "tableCount"),
                number(&meta, "rowCount")
            );
            root = root
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .px_4()
                        .py_3()
                        .border_b_1()
                        .border_color(t.border)
                        .child(
                            Button::new("snapshots-back")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::ArrowLeft)
                                .label("Snapshots")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.selected = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            div().flex_1().min_w_0().child(
                                div()
                                    .truncate()
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .child(name),
                            ),
                        )
                        .child(
                            Button::new("snapshot-detail-compare")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::GitCompare)
                                .label("Compare…")
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.selected = None;
                                    this.compare_mode = true;
                                    this.selected_ids = vec![compare_snapshot_id.clone()];
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("snapshots-refresh-detail")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::RefreshCw)
                                .label("Refresh")
                                .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                        )
                        .child(
                            Button::new("snapshot-delete")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::Trash)
                                .label("Delete")
                                .on_click(cx.listener(move |_this, _, _, cx| {
                                    let id = delete_snapshot_id.clone();
                                    let confirm = rexa_ui::confirm(
                                        rexa_ui::ConfirmOptions::destructive("Delete snapshot?")
                                            .description(
                                                "This permanently removes the saved snapshot.",
                                            )
                                            .confirm_text("Delete"),
                                        cx,
                                    );
                                    cx.spawn(async move |this, cx| {
                                        if confirm.await {
                                            this.update(cx, |this, cx| this.delete(&id, cx)).ok();
                                        }
                                    })
                                    .detach();
                                })),
                        ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scrollbar()
                        .p_4()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(
                            div()
                                .tw_text_xs()
                                .text_color(t.muted_foreground)
                                .child(meta_line),
                        )
                        .when_some(
                            meta.get("description")
                                .and_then(Value::as_str)
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned),
                            |el, description| el.child(div().tw_text_sm().child(description)),
                        )
                        .child(
                            Button::new("snapshot-schema-sql")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::Code)
                                .label(format!("Schema SQL ({})", tables.len()))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.show_schema = !this.show_schema;
                                    cx.notify();
                                })),
                        )
                        .when(self.show_schema, |el| {
                            el.child(code_block(
                                snapshot["schemaSQL"]
                                    .as_str()
                                    .unwrap_or("-- No schema SQL available --"),
                                &t,
                            ))
                        })
                        .child(
                            Button::new("snapshot-data-sql")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::Database)
                                .label(format!(
                                    "Data SQL ({} rows)",
                                    number(&meta, "rowCount").to_string()
                                ))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.show_data = !this.show_data;
                                    cx.notify();
                                })),
                        )
                        .when(self.show_data, |el| {
                            el.child(code_block(
                                snapshot["dataSQL"]
                                    .as_str()
                                    .unwrap_or("-- No data SQL available --"),
                                &t,
                            ))
                        })
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(
                                    div()
                                        .tw_text_xs()
                                        .font_weight(gpui::FontWeight::BOLD)
                                        .text_color(t.muted_foreground)
                                        .child("TABLES"),
                                )
                                .children(table_lines),
                        ),
                );
            return root.into_any_element();
        }

        root.child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .px_4()
                .py_3()
                .border_b_1()
                .border_color(t.border)
                .child(
                    rexa_ui::widgets::Icon::new(IconName::Camera)
                        .size_4()
                        .text_color(t.muted_foreground),
                )
                .child(
                    div()
                        .flex_1()
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(format!("Snapshots ({})", self.snapshots.len())),
                )
                .when(self.compare_mode, |el| {
                    el.child(
                        Button::new("snapshot-compare-cancel")
                            .ghost()
                            .size(ButtonSize::Sm)
                            .label("Cancel")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.compare_mode = false;
                                this.selected_ids.clear();
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("snapshot-compare-run")
                            .size(ButtonSize::Sm)
                            .icon(IconName::GitCompare)
                            .label("Compare Selected")
                            .disabled(self.selected_ids.len() != 2)
                            .on_click(cx.listener(|this, _, _, cx| this.compare_selected(cx))),
                    )
                })
                .when(!self.compare_mode, |el| {
                    el.when(self.snapshots.len() >= 2, |el| {
                        el.child(
                            Button::new("snapshot-compare-start")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::GitCompare)
                                .label("Compare")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.compare_mode = true;
                                    this.selected_ids.clear();
                                    cx.notify();
                                })),
                        )
                    })
                    .child(div().w(px(190.)).child(TextInput::new(&self.name).h(28.)))
                    .child(
                        Button::new("snapshot-create")
                            .size(ButtonSize::Sm)
                            .icon(if self.creating {
                                IconName::LoaderCircle
                            } else {
                                IconName::Plus
                            })
                            .label(if self.creating {
                                "Creating…"
                            } else {
                                "New Snapshot"
                            })
                            .disabled(self.creating)
                            .on_click(cx.listener(|this, _, _, cx| this.create(cx))),
                    )
                })
                .child(
                    Button::new("snapshots-refresh")
                        .outline()
                        .size(ButtonSize::Sm)
                        .icon(IconName::RefreshCw)
                        .label("Refresh")
                        .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                ),
        )
        .when_some(self.error.clone(), |el, error| {
            el.child(
                div()
                    .px_4()
                    .pt_3()
                    .text_color(t.destructive)
                    .tw_text_sm()
                    .child(error),
            )
        })
        .when(self.snapshots.is_empty() && self.error.is_none(), |el| {
            el.child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap_2()
                    .text_color(t.muted_foreground)
                    .child(
                        rexa_ui::widgets::Icon::new(IconName::Camera)
                            .size_10()
                            .opacity(0.35),
                    )
                    .child(div().tw_text_sm().child("No snapshots yet"))
                    .child(
                        div()
                            .tw_text_xs()
                            .child("Saved database snapshots will appear here."),
                    ),
            )
        })
        .when(!self.snapshots.is_empty(), |el| {
            el.child(
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .children(self.snapshots.iter().filter_map(|snapshot| {
                        let meta = snapshot.get("meta")?;
                        let id = meta_text(meta, "id");
                        let name = meta_text(meta, "name");
                        let created = meta_text(meta, "createdAt");
                        let engine = meta_text(meta, "engine");
                        let summary = format!(
                            "{created} · {engine} · {} tables · {} rows",
                            number(meta, "tableCount"),
                            number(meta, "rowCount")
                        );
                        let is_selected = self.selected_ids.contains(&id);
                        Some(
                            Button::new(format!("snapshot-{id}"))
                                .outline()
                                .w_full()
                                .when(is_selected, |button| button.secondary())
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .w_full()
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .text_left()
                                                .child(
                                                    div()
                                                        .truncate()
                                                        .tw_text_sm()
                                                        .font_weight(gpui::FontWeight::MEDIUM)
                                                        .child(name),
                                                )
                                                .child(
                                                    div()
                                                        .truncate()
                                                        .tw_text_xs()
                                                        .text_color(t.muted_foreground)
                                                        .child(summary),
                                                ),
                                        )
                                        .child(
                                            rexa_ui::widgets::Icon::new(IconName::ChevronRight)
                                                .size_4()
                                                .text_color(t.muted_foreground),
                                        ),
                                )
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.open_snapshot(id.clone(), cx)
                                })),
                        )
                    })),
            )
        })
        .into_any_element()
    }
}

fn summary_card(title: &str, value: String, t: &rexa_ui::Tokens) -> impl IntoElement {
    div()
        .flex_1()
        .min_w_0()
        .border_1()
        .border_color(t.border)
        .rounded_md()
        .p_3()
        .child(
            div()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(title.to_owned()),
        )
        .child(
            div()
                .mt_1()
                .tw_text_sm()
                .font_weight(gpui::FontWeight::MEDIUM)
                .child(value),
        )
}

fn code_block(value: &str, t: &rexa_ui::Tokens) -> impl IntoElement {
    div()
        .max_h(px(320.))
        .overflow_y_scrollbar()
        .rounded_md()
        .bg(t.background)
        .border_1()
        .border_color(t.border)
        .p_3()
        .child(
            div()
                .whitespace_nowrap()
                .text_xs()
                .font_family(rexa_ui::MONO)
                .child(SharedString::from(value.to_owned())),
        )
}

struct SnapshotTable {
    title: String,
    columns: Vec<(String, String)>,
    rows: Vec<Value>,
    error: Option<String>,
}

impl SnapshotTable {
    fn new(session: Arc<Session>, params: Value) -> Self {
        let snapshot_id = params
            .get("snapshotId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let table_ref = params
            .get("tableRef")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match load_snapshot(session.connection.id, snapshot_id) {
            Ok(snapshot) => {
                let table = snapshot["schemaStructured"]["tables"]
                    .as_array()
                    .and_then(|tables| {
                        tables.iter().find(|table| {
                            format!(
                                "{}.{}",
                                table["schema"].as_str().unwrap_or_default(),
                                table["name"].as_str().unwrap_or_default()
                            ) == table_ref
                        })
                    });
                let Some(table) = table else {
                    return Self {
                        title: table_ref.into(),
                        columns: Vec::new(),
                        rows: Vec::new(),
                        error: Some("Table was not found in this snapshot.".into()),
                    };
                };
                let columns = table["columns"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|column| {
                        (
                            column["name"].as_str().unwrap_or_default().to_owned(),
                            column["dataType"].as_str().unwrap_or_default().to_owned(),
                        )
                    })
                    .collect();
                let rows = snapshot["dataTables"][table_ref]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                Self {
                    title: table_ref.into(),
                    columns,
                    rows,
                    error: None,
                }
            }
            Err(error) => Self {
                title: table_ref.into(),
                columns: Vec::new(),
                rows: Vec::new(),
                error: Some(error),
            },
        }
    }
}

impl Render for SnapshotTable {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .px_4()
                    .py_3()
                    .border_b_1()
                    .border_color(t.border)
                    .child(
                        rexa_ui::widgets::Icon::new(IconName::Table)
                            .size_4()
                            .text_color(t.muted_foreground),
                    )
                    .child(
                        div()
                            .flex_1()
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(self.title.clone()),
                    )
                    .child(
                        div()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(format!("{} rows · read-only snapshot", self.rows.len())),
                    ),
            )
            .when_some(self.error.clone(), |el, error| {
                el.child(
                    div()
                        .p_4()
                        .text_color(t.destructive)
                        .tw_text_sm()
                        .child(error),
                )
            })
            .when(self.error.is_none(), |el| {
                let header = div()
                    .flex()
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(t.border)
                    .bg(t.muted)
                    .children(self.columns.iter().map(|(name, kind)| {
                        div()
                            .flex()
                            .flex_col()
                            .justify_center()
                            .px_3()
                            .py_2()
                            .border_r_1()
                            .border_color(t.border)
                            .min_w(px(150.))
                            .child(
                                div()
                                    .tw_text_xs()
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .child(name.clone()),
                            )
                            .child(
                                div()
                                    .tw_text_xs()
                                    .text_color(t.muted_foreground)
                                    .child(kind.clone()),
                            )
                    }));
                el.child(
                    div().flex_1().min_h_0().overflow_scrollbar().child(
                        div()
                            .w_full()
                            .child(header)
                            .children(self.rows.iter().enumerate().map(|(index, row)| {
                                div()
                                    .flex()
                                    .border_b_1()
                                    .border_color(t.border)
                                    .when(index % 2 == 1, |el| el.bg(t.muted))
                                    .children(self.columns.iter().map(|(name, _)| {
                                        let value =
                                            row.get(name).map(json_cell_text).unwrap_or_default();
                                        div()
                                            .min_w(px(150.))
                                            .max_w(px(420.))
                                            .truncate()
                                            .px_3()
                                            .py_2()
                                            .border_r_1()
                                            .border_color(t.border)
                                            .tw_text_xs()
                                            .font_family(rexa_ui::MONO)
                                            .child(value)
                                    }))
                            })),
                    ),
                )
            })
    }
}

fn json_cell_text(value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

fn entries_by_key(value: &Value, kind: &str) -> BTreeMap<String, Value> {
    value["schemaStructured"][kind]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let schema = entry["schema"].as_str()?;
            let name = entry["name"].as_str()?;
            Some((format!("{schema}.{name}"), entry.clone()))
        })
        .collect()
}

fn compare_snapshots(older: &Value, newer: &Value) -> Value {
    let old_tables = entries_by_key(older, "tables");
    let new_tables = entries_by_key(newer, "tables");
    let mut schema_changes = Vec::new();
    for key in new_tables
        .keys()
        .filter(|key| !old_tables.contains_key(*key))
    {
        schema_changes.push(json!({"type":"table", "action":"added", "entityName":key}));
    }
    for key in old_tables
        .keys()
        .filter(|key| !new_tables.contains_key(*key))
    {
        schema_changes.push(json!({"type":"table", "action":"removed", "entityName":key}));
    }
    for (table_key, new_table) in &new_tables {
        let Some(old_table) = old_tables.get(table_key) else {
            continue;
        };
        let old_columns: BTreeMap<String, Value> = old_table["columns"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| Some((c["name"].as_str()?.to_owned(), c.clone())))
            .collect();
        let new_columns: BTreeMap<String, Value> = new_table["columns"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| Some((c["name"].as_str()?.to_owned(), c.clone())))
            .collect();
        for name in new_columns
            .keys()
            .filter(|name| !old_columns.contains_key(*name))
        {
            schema_changes.push(json!({"type":"column", "action":"added", "entityName":format!("{table_key}.{name}")}));
        }
        for name in old_columns
            .keys()
            .filter(|name| !new_columns.contains_key(*name))
        {
            schema_changes.push(json!({"type":"column", "action":"removed", "entityName":format!("{table_key}.{name}")}));
        }
        for (name, new_column) in &new_columns {
            let Some(old_column) = old_columns.get(name) else {
                continue;
            };
            if old_column["dataType"] != new_column["dataType"]
                || old_column["isNullable"] != new_column["isNullable"]
            {
                schema_changes.push(json!({"type":"column", "action":"modified", "entityName":format!("{table_key}.{name}"), "details":format!("{} → {}", old_column["dataType"].as_str().unwrap_or("?"), new_column["dataType"].as_str().unwrap_or("?"))}));
            }
        }
    }
    let old_views = entries_by_key(older, "views");
    let new_views = entries_by_key(newer, "views");
    for key in new_views.keys().filter(|key| !old_views.contains_key(*key)) {
        schema_changes.push(json!({"type":"view", "action":"added", "entityName":key}));
    }
    for key in old_views.keys().filter(|key| !new_views.contains_key(*key)) {
        schema_changes.push(json!({"type":"view", "action":"removed", "entityName":key}));
    }

    let mut data_changes = Vec::new();
    let keys: std::collections::BTreeSet<String> = old_tables
        .keys()
        .chain(new_tables.keys())
        .cloned()
        .collect();
    for key in keys {
        let old_rows = older["dataTables"][&key]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let new_rows = newer["dataTables"][&key]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let original_row_count = old_rows.len().max(new_rows.len());
        let (old_table, new_table) = (old_tables.get(&key), new_tables.get(&key));
        let (mut added, mut removed, mut modified) = (Vec::new(), Vec::new(), Vec::new());
        if old_table.is_none() {
            added = new_rows;
        } else if new_table.is_none() {
            removed = old_rows;
        } else {
            let table = new_table.unwrap();
            let primary_key: Vec<String> = table["primaryKey"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            let columns: Vec<String> = table["columns"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| c["name"].as_str().map(str::to_owned))
                .collect();
            let key_columns = if primary_key.is_empty() {
                columns.clone()
            } else {
                primary_key.clone()
            };
            let row_key = |row: &Value| {
                key_columns
                    .iter()
                    .map(|column| match row.get(column) {
                        None | Some(Value::Null) => "NULL".to_owned(),
                        Some(Value::String(value)) => value.clone(),
                        Some(value) => value.to_string(),
                    })
                    .collect::<Vec<_>>()
                    .join("|")
            };
            let mut old_by_key: BTreeMap<String, Value> = old_rows
                .iter()
                .map(|row| (row_key(row), row.clone()))
                .collect();
            for row in &new_rows {
                let key = row_key(row);
                if let Some(old_row) = old_by_key.remove(&key) {
                    let changed = columns
                        .iter()
                        .filter(|column| !primary_key.contains(column))
                        .any(|column| old_row.get(column) != row.get(column));
                    if changed {
                        modified.push(json!({"old":old_row, "new":row}));
                    }
                } else {
                    added.push(row.clone());
                }
            }
            removed = old_by_key.into_values().collect();
        }
        if !added.is_empty() || !removed.is_empty() || !modified.is_empty() {
            let rows_added = added.len();
            let rows_removed = removed.len();
            let rows_modified = modified.len();
            data_changes.push(json!({
                "table":key, "rowCount":original_row_count,
                "rowsAdded":rows_added, "rowsRemoved":rows_removed, "rowsModified":rows_modified,
                "sampleAdded":added.iter().take(5).cloned().collect::<Vec<_>>(),
                "sampleRemoved":removed.iter().take(5).cloned().collect::<Vec<_>>(),
                "sampleModified":modified.iter().take(5).cloned().collect::<Vec<_>>(),
                "allAdded":added, "allRemoved":removed, "allModified":modified
            }));
        }
    }
    let count = |kind: &str, action: &str| {
        schema_changes
            .iter()
            .filter(|change| change["type"] == kind && change["action"] == action)
            .count()
    };
    let sum = |key: &str| {
        data_changes
            .iter()
            .map(|change| change[key].as_u64().unwrap_or_default())
            .sum::<u64>()
    };
    let tables_modified = schema_changes
        .iter()
        .any(|change| change["type"] == "column" && change["action"] != "removed");
    json!({
        "olderName":older["meta"]["name"], "newerName":newer["meta"]["name"],
        "schemaChanges":schema_changes, "dataChanges":data_changes,
        "summary":{"tablesAdded":count("table","added"), "tablesRemoved":count("table","removed"),
            "tablesModified":tables_modified,
            "rowsAdded":sum("rowsAdded"), "rowsRemoved":sum("rowsRemoved"), "rowsModified":sum("rowsModified")}
    })
}

pub fn init(cx: &mut App) {
    Registry::tab(
        cx,
        "rexa-features-snapshots",
        |spec, session, window, cx| {
            let TabSpec::View { view, params } = spec else {
                return None;
            };
            match view.as_str() {
                "snapshots" => Some(Into::<AnyView>::into(
                    cx.new(|cx| Snapshots::new(session, window, cx)),
                )),
                "snapshot-table" => {
                    let params = params.clone();
                    Some(Into::<AnyView>::into(
                        cx.new(|_| SnapshotTable::new(session, params)),
                    ))
                }
                _ => None,
            }
        },
    );
}
