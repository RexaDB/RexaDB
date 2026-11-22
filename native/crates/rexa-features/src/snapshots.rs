//! Port of `components/studio/snapshots/snapshots-view.tsx` and
//! `snapshot-detail.tsx`: browse saved snapshots and inspect their schema/data.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, SharedString, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{Registry, Session, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Arc};

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

fn meta_text(meta: &Value, key: &str) -> String {
    meta.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn number(meta: &Value, key: &str) -> u64 {
    meta.get(key).and_then(Value::as_u64).unwrap_or_default()
}

pub struct Snapshots {
    connection_id: i64,
    snapshots: Vec<Value>,
    selected: Option<Value>,
    error: Option<String>,
    show_schema: bool,
    show_data: bool,
}

impl Snapshots {
    fn new(session: Arc<Session>) -> Self {
        let connection_id = session.connection.id;
        let (snapshots, error) = match load_snapshots(connection_id) {
            Ok(snapshots) => (snapshots, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Self {
            connection_id,
            snapshots,
            selected: None,
            error,
            show_schema: false,
            show_data: false,
        }
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
        self.selected = self
            .snapshots
            .iter()
            .find(|snapshot| snapshot["meta"]["id"].as_str() == Some(&id))
            .cloned();
        self.show_schema = false;
        self.show_data = false;
        cx.notify();
    }
}

impl Render for Snapshots {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
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
            let tables = snapshot["schemaStructured"]["tables"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let table_lines = tables.iter().map(|table| {
                let schema = table["schema"].as_str().unwrap_or_default();
                let name = table["name"].as_str().unwrap_or_default();
                let count = table["columns"].as_array().map_or(0, Vec::len);
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .py_1()
                    .child(
                        div()
                            .tw_text_sm()
                            .font_family(rexa_ui::MONO)
                            .child(format!("{schema}.{name}")),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(format!("{count} columns")),
                    )
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
                            Button::new("snapshots-refresh-detail")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::RefreshCw)
                                .label("Refresh")
                                .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
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
            return root;
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
                        Some(
                            Button::new(format!("snapshot-{id}"))
                                .outline()
                                .w_full()
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
    }
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

pub fn init(cx: &mut App) {
    Registry::tab(
        cx,
        "rexa-features-snapshots",
        |spec, session, _window, cx| {
            let TabSpec::View { view, .. } = spec else {
                return None;
            };
            if view != "snapshots" {
                return None;
            }
            Some(Into::<AnyView>::into(cx.new(|_| Snapshots::new(session))))
        },
    );
}
