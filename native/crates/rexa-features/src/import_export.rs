//! Port of components/studio/import-export-view.tsx (+ the `handleExportDatabaseBundle` /
//! `handleImportDatabaseBundle` callbacks of hooks/use-studio.ts and
//! `exportDatabaseBundle` / `importDatabaseBundle` of lib/db/export-helpers.ts).
//!
//! Native-only extra: opened with `{table, schema, format}` params it exports a single
//! table (the grid toolbar's export menu routes here).

use gpui::{div, percentage, prelude::*, px, Animation, AnimationExt, App, AppContext, AsyncApp, Context, FontWeight, Hsla, WeakEntity, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, StudioEvent, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::widgets::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// `importExportProgress` of use-studio.
#[derive(Clone)]
struct Progress {
    title: String,
    steps: [&'static str; 3],
    current_step: usize,
}

pub struct ImportExport {
    session: Arc<Session>,
    table_export: Option<(String, String, String)>,
    import_format: &'static str,
    file: Option<PathBuf>,
    progress: Option<Progress>,
    busy: bool,
}

fn set_step(this: &WeakEntity<ImportExport>, step: usize, cx: &mut AsyncApp) {
    this.update(cx, |this, cx| {
        if let Some(p) = this.progress.as_mut() {
            p.current_step = step;
        }
        cx.notify();
    })
    .ok();
}

impl ImportExport {
    fn new(session: Arc<Session>, params: &Value) -> Self {
        let table_export = params.get("table").and_then(Value::as_str).map(|table| {
            (
                params.get("schema").and_then(Value::as_str).unwrap_or_default().to_string(),
                table.to_string(),
                params.get("format").and_then(Value::as_str).unwrap_or("csv").to_string(),
            )
        });
        Self { session, table_export, import_format: "sql", file: None, progress: None, busy: false }
    }

    fn export(&mut self, format: &'static str, cx: &mut Context<Self>) {
        let driver = self.session.driver.clone();
        let connection = self.session.connection.clone();
        let table_export = self.table_export.clone();
        if table_export.is_none() && !driver.kind().is_postgres_catalog() {
            // exportDatabaseBundle is Postgres-only.
            rexa_ui::toast::error("Database bundle export is currently supported only for PostgreSQL connections.", cx);
            return;
        }
        self.busy = true;
        self.progress = Some(Progress {
            title: format!("Exporting {}", format.to_uppercase()),
            steps: ["Preparing export", "Generating bundle", "Downloading file"],
            current_step: 0,
        });
        cx.notify();
        cx.spawn(async move |this, cx| {
            set_step(&this, 1, cx);
            let generated = runtime::spawn(async move {
                if let Some((schema, table, _)) = table_export {
                    return export_table(driver, &schema, &table, format).await;
                }
                let snapshot = super::snapshots::create_snapshot_file(driver, None, connection.connection_string.clone(), "export".into()).await?;
                let schema = snapshot.get("schemaSQL").and_then(Value::as_str).unwrap_or_default();
                let data = snapshot.get("dataSQL").and_then(Value::as_str).unwrap_or_default();
                build_bundle(schema, data, format)
            })
            .await
            .map_err(|e| anyhow::anyhow!("{e:#}"));
            let content = match generated {
                Ok(content) => content,
                Err(error) => {
                    this.update(cx, |this, cx| {
                        let message = error.to_string();
                        rexa_ui::toast::error(if message.is_empty() { "Failed to export database".to_string() } else { message }, cx);
                        this.busy = false;
                        this.progress = None;
                        cx.notify();
                    })
                    .ok();
                    return;
                }
            };
            set_step(&this, 2, cx);
            // `link.download = rexa-db-export-<ms>.<format>` → a save dialog into ~/Downloads.
            let suggested = format!("rexa-db-export-{}.{}", chrono::Utc::now().timestamp_millis(), format);
            let directory = std::env::var("HOME").map(|home| PathBuf::from(home).join("Downloads")).unwrap_or_default();
            let prompt = cx.update(|cx| cx.prompt_for_new_path(&directory, Some(&suggested)));
            let saved = match prompt.await {
                Ok(Ok(Some(path))) => runtime::spawn(async move {
                    tokio::task::spawn_blocking(move || std::fs::write(path, content)).await??;
                    anyhow::Ok(true)
                })
                .await
                .map_err(|e| anyhow::anyhow!("{e:#}")),
                Ok(Ok(None)) | Err(_) => Ok(false),
                Ok(Err(error)) => Err(anyhow::anyhow!("Could not open save dialog: {error:#}")),
            };
            this.update(cx, |this, cx| {
                match saved {
                    Ok(true) => {
                        rexa_ui::toast::success(format!("Database exported as {}", format.to_uppercase()), cx);
                    }
                    Ok(false) => {}
                    Err(error) => {
                        rexa_ui::toast::error(format!("{error:#}"), cx);
                    }
                }
                this.busy = false;
                this.progress = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// `<Input type="file">`: native file picker.
    fn choose_file(&mut self, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await {
                this.update(cx, |this, cx| {
                    this.file = paths.into_iter().next();
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn import(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.file.clone() else { return };
        let format = self.import_format;
        let confirm = rexa_ui::confirm(
            rexa_ui::ConfirmOptions::destructive("Import will replace current database")
                .description("This will drop existing schemas/data and rebuild from the backup file. Continue?")
                .confirm_text("Import and Recreate"),
            cx,
        );
        let driver = self.session.driver.clone();
        let connection_string = self.session.connection.connection_string.clone();
        cx.spawn(async move |this, cx| {
            if !confirm.await {
                return;
            }
            this.update(cx, |this, cx| {
                this.busy = true;
                this.progress = Some(Progress {
                    title: format!("Importing {}", format.to_uppercase()),
                    steps: ["Reading file", "Applying backup", "Refreshing workspace"],
                    current_step: 0,
                });
                cx.notify();
            })
            .ok();
            let content = runtime::spawn(async move { anyhow::Ok(tokio::task::spawn_blocking(move || std::fs::read_to_string(path)).await??) })
                .await
                .map_err(|e| anyhow::anyhow!("{e:#}"));
            set_step(&this, 1, cx);
            let applied = match content {
                Ok(content) => runtime::spawn(async move {
                    if !driver.kind().is_postgres_catalog() {
                        anyhow::bail!("Database bundle import is currently supported only for PostgreSQL connections.");
                    }
                    let full_sql = parse_bundle(&content, format)?;
                    if full_sql.trim().is_empty() {
                        anyhow::bail!("Import file does not contain a valid SQL payload.");
                    }
                    let noop = |_: &str, _: usize, _: usize, _: &str| {};
                    super::transfer::apply::reset_and_apply_sql(&driver, &connection_string, &full_sql, None, &noop).await?;
                    anyhow::Ok(())
                })
                .await
                .map_err(|e| anyhow::anyhow!("{e:#}")),
                Err(e) => Err(e),
            };
            if applied.is_ok() {
                set_step(&this, 2, cx);
                // loadInitialDataWithConn → the explorer and open tabs reload.
                cx.update(|cx| rexa_core::emit_studio(StudioEvent::SchemaChanged, cx));
            }
            this.update(cx, |this, cx| {
                match applied {
                    Ok(()) => {
                        rexa_ui::toast::success("Database imported successfully", cx);
                    }
                    Err(error) => {
                        let message = error.to_string();
                        rexa_ui::toast::error(if message.is_empty() { "Failed to import database".into() } else { message }, cx);
                    }
                }
                this.busy = false;
                this.progress = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

/// The SQL / JSON / CSV bundle bodies of `exportDatabaseBundle`.
fn build_bundle(schema: &str, data: &str, format: &str) -> anyhow::Result<String> {
    let full_sql = format!("{schema}\n{data}");
    let generated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    Ok(match format {
        "sql" => full_sql,
        "json" => serde_json::to_string_pretty(&json!({
            "format": "rexa-db-export-v1",
            "generatedAt": generated_at,
            "schemaSql": schema,
            "dataSql": data,
            "fullSql": full_sql,
        }))?,
        "csv" => {
            use base64::Engine;
            [
                "section,key,value".to_string(),
                format!("meta,format,{}", csv_cell("rexa-db-export-v1")),
                format!("meta,generated_at,{}", csv_cell(&generated_at)),
                format!("payload,full_sql_base64,{}", csv_cell(&base64::engine::general_purpose::STANDARD.encode(full_sql))),
            ]
            .join("\n")
        }
        _ => anyhow::bail!("Unsupported export format."),
    })
}

/// `importDatabaseBundle`'s payload extraction for the selected import format.
fn parse_bundle(content: &str, format: &str) -> anyhow::Result<String> {
    match format {
        "sql" => Ok(content.to_string()),
        "json" => {
            let value: Value = serde_json::from_str(content)?;
            if let Some(sql) = value.get("fullSql").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                return Ok(sql.to_string());
            }
            let schema = value.get("schemaSql").and_then(Value::as_str).unwrap_or_default();
            let data = value.get("dataSql").and_then(Value::as_str).unwrap_or_default();
            Ok(format!("{schema}\n\n{data}"))
        }
        _ => {
            use base64::Engine;
            for line in content.replace("\r\n", "\n").split('\n') {
                if line.is_empty() || line.starts_with("section,") {
                    continue;
                }
                let cells = parse_csv_line(line);
                if cells.len() >= 3 && cells[0] == "payload" && cells[1] == "full_sql_base64" {
                    let payload = cells[2..].join(",");
                    let bytes = base64::engine::general_purpose::STANDARD.decode(payload.trim()).unwrap_or_default();
                    return Ok(String::from_utf8_lossy(&bytes).into_owned());
                }
            }
            Ok(String::new())
        }
    }
}

/// `parseCsvLine` of export-helpers.
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => out.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    out.push(current);
    out
}

fn spin(id: &'static str, size: f32, color: Hsla) -> impl IntoElement {
    Icon::new(IconName::LoaderCircle)
        .size(px(size))
        .text_color(color)
        .with_animation(id, Animation::new(Duration::from_secs(1)).repeat(), |i, t| i.rotate(percentage(t)))
}

/// `<Label className="text-xs">`: text-xs leading-none font-medium.
fn small_label(text: &'static str) -> impl IntoElement {
    div().text_size(px(12.)).line_height(px(12.)).font_weight(FontWeight::MEDIUM).child(text)
}

impl Render for ImportExport {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let secondary = t.var_or("--secondary", t.muted);
        // `space-y-* border border-border rounded-lg p-5 bg-secondary/20`
        let section = |gap: f32| div().flex().flex_col().gap(px(gap)).rounded(px(10.)).border_1().border_color(t.border).bg(with_alpha(secondary, 0.2)).p_5();
        let heading = |icon: IconName, color: &str, text: String| {
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(Icon::new(icon).size(px(16.)).text_color(tw(color)))
                .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(text))
        };
        let busy = self.busy;

        let progress = self.progress.clone().filter(|_| busy).map(|progress| {
            section(12.)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(spin("ie-progress", 16., tw("blue-500")))
                        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(progress.title.clone())),
                )
                .child(div().flex().flex_col().gap(px(6.)).children(progress.steps.iter().enumerate().map(|(index, step)| {
                    let done = index < progress.current_step;
                    let active = index == progress.current_step;
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .tw_text_xs()
                        .child(if done {
                            Icon::new(IconName::CircleCheck).size(px(14.)).text_color(tw("emerald-500")).into_any_element()
                        } else if active {
                            spin("ie-step", 14., tw("blue-500")).into_any_element()
                        } else {
                            div().size(px(14.)).rounded(px(10.)).border_1().border_color(with_alpha(t.muted_foreground, 0.3)).into_any_element()
                        })
                        .child(div().text_color(if done || active { t.foreground } else { t.muted_foreground }).child(*step))
                })))
        });

        let table_export = self.table_export.clone();
        let export_section = if let Some((_, table, format)) = table_export.as_ref() {
            let format: &'static str = match format.as_str() {
                "sql" => "sql",
                "json" => "json",
                _ => "csv",
            };
            section(16.)
                .child(heading(IconName::Download, "blue-500", format!("Export {table}")))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Export this table's current rows as JSON, CSV, or SQL insert statements."))
                .child(
                    div().flex().child(
                        Button::new("export-table")
                            .size(ButtonSize::Sm)
                            .icon(IconName::Download)
                            .label(format!("Export {}", format.to_uppercase()))
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, _, cx| this.export(format, cx))),
                    ),
                )
        } else {
            section(16.)
                .child(heading(IconName::Download, "blue-500", "Export Schema / Data".into()))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("SQL exports schema definitions. JSON and CSV export database data."))
                .child(div().flex().flex_wrap().gap_2().children(["sql", "json", "csv"].into_iter().map(|format| {
                    let button = Button::new(format!("export-{format}"))
                        .size(ButtonSize::Sm)
                        .icon(IconName::Download)
                        .label(format!("Export {}", format.to_uppercase()))
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, _, cx| this.export(format, cx)));
                    if format == "sql" { button } else { button.secondary() }
                })))
        };

        let file_label = self
            .file
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "no file selected".into());
        let import_format = self.import_format;
        let import_section = section(16.)
            .child(heading(IconName::Upload, "amber-500", "Import Full Database".into()))
            .child(div().tw_text_xs().text_color(t.muted_foreground).child("Import will replace current schemas/data with the uploaded backup."))
            .child(
                div().flex().flex_col().gap_2().child(small_label("Import Format")).child(div().flex().items_center().gap_2().children(
                    ["sql", "json", "csv"].into_iter().map(|format| {
                        let button = Button::new(format!("import-format-{format}"))
                            .size(ButtonSize::Sm)
                            .child(div().tw_text_xs().child(format.to_uppercase()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.import_format = format;
                                cx.notify();
                            }));
                        if import_format == format { button } else { button.secondary() }
                    }),
                )),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(small_label("Backup File"))
                    // `<Input type="file">`: the shadcn input chrome with WebKit's
                    // "Choose File" control (file:bg-transparent file:font-medium).
                    .child(
                        div()
                            .id("import-file")
                            .h_9()
                            .w_full()
                            .flex()
                            .items_center()
                            .gap_2()
                            .px_3()
                            .rounded(px(8.))
                            .border_1()
                            .border_color(t.input)
                            .when(t.dark, |d| d.bg(with_alpha(t.input, 0.3)))
                            .tw_text_sm()
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.choose_file(cx)))
                            .child(div().flex_shrink_0().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child("Choose File"))
                            .child(div().min_w_0().truncate().text_color(t.foreground).child(file_label)),
                    ),
            )
            .child(
                div().flex().child(
                    Button::new("import-recreate")
                        .destructive()
                        .size(ButtonSize::Sm)
                        .icon(IconName::FileUp)
                        .label("Import And Recreate")
                        .disabled(self.file.is_none() || busy)
                        .on_click(cx.listener(|this, _, _, cx| this.import(cx))),
                ),
            );

        div()
            .id("import-export")
            .size_full()
            .overflow_y_scrollbar()
            .bg(t.background)
            .text_color(t.foreground)
            .child(
                div()
                    .mx_auto()
                    .w_full()
                    .max_w(px(768.))
                    .flex()
                    .flex_col()
                    .gap(px(40.))
                    .py_12()
                    .px_6()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Export"))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child("Export schema as SQL or export data as JSON/CSV.")),
                    )
                    .children(progress)
                    .child(export_section)
                    .when(table_export.is_none(), |page| page.child(import_section)),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_round_trips_through_each_format() {
        for format in ["sql", "json", "csv"] {
            let bundle = build_bundle("CREATE TABLE a (id int);", "INSERT INTO a VALUES (1);", format).unwrap();
            let sql = parse_bundle(&bundle, format).unwrap();
            assert_eq!(sql, "CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);", "{format}");
        }
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(
        cx,
        "rexa-features-import-export",
        |spec, session, _window, cx| {
            let TabSpec::View { view, params } = spec else {
                return None;
            };
            if view != "import-export" {
                return None;
            }
            let params = params.clone();
            Some(cx.new(|_| ImportExport::new(session, &params)).into())
        },
    );
}

async fn export_table(
    driver: Arc<dyn rexa_drivers::Driver>,
    schema: &str,
    table: &str,
    format: &str,
) -> anyhow::Result<String> {
    if matches!(
        driver.kind(),
        Kind::MongoDb | Kind::Redis | Kind::SpacetimeDb
    ) {
        anyhow::bail!(
            "Table export is not supported for {} connections.",
            driver.kind().as_str()
        );
    }
    let dialect = driver.dialect();
    let table_ref = dialect.table_ref(schema, table);
    let result = driver
        .execute_readonly(&format!("SELECT * FROM {table_ref}"), 10_000)
        .await?;
    if result.truncated {
        anyhow::bail!("Table export is limited to 10,000 rows and this table exceeds that limit.");
    }
    let mut records = Vec::with_capacity(result.rows.len());
    for row in &result.rows {
        let mut record = serde_json::Map::new();
        for (index, column) in result.columns.iter().enumerate() {
            let cell = row
                .get(index)
                .ok_or_else(|| anyhow::anyhow!("A row did not match the result columns."))?;
            record.insert(
                column.clone(),
                cell.as_str()
                    .map(|s| Value::String(s.to_string()))
                    .unwrap_or(Value::Null),
            );
        }
        records.push(Value::Object(record));
    }
    match format {
        "json" => Ok(serde_json::to_string_pretty(&records)?),
        "csv" => {
            let mut lines = vec![result
                .columns
                .iter()
                .map(|v| csv_cell(v))
                .collect::<Vec<_>>()
                .join(",")];
            lines.extend(result.rows.iter().map(|row| {
                row.iter()
                    .map(|cell| csv_cell(cell.as_str().unwrap_or_default()))
                    .collect::<Vec<_>>()
                    .join(",")
            }));
            Ok(lines.join("\n"))
        }
        "sql" => {
            if result.columns.is_empty() {
                anyhow::bail!("The selected table has no exportable columns.");
            }
            let columns = result
                .columns
                .iter()
                .map(|column| dialect.quote_ident(column))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(result
                .rows
                .iter()
                .map(|row| {
                    let values = row
                        .iter()
                        .map(|cell| {
                            cell.as_str()
                                .map(|value| dialect.quote_str(value))
                                .unwrap_or_else(|| "NULL".into())
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!("INSERT INTO {table_ref} ({columns}) VALUES ({values});")
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
        _ => anyhow::bail!("Unsupported export format."),
    }
}

fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}
