//! Native SQL / JSON / CSV database bundle import and export.

use gpui::{div, prelude::*, px, App, AppContext, Context, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ImportExport {
    session: Arc<Session>,
    table_export: Option<(String, String, String)>,
    error: Option<String>,
    busy: bool,
}

impl ImportExport {
    fn new(session: Arc<Session>, params: &Value) -> Self {
        let table_export = params.get("table").and_then(Value::as_str).map(|table| {
            (
                params
                    .get("schema")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                table.to_string(),
                params
                    .get("format")
                    .and_then(Value::as_str)
                    .unwrap_or("csv")
                    .to_string(),
            )
        });
        Self {
            session,
            table_export,
            error: None,
            busy: false,
        }
    }

    fn export(&mut self, format: &'static str, cx: &mut Context<Self>) {
        let suggested = format!(
            "rexadb-export-{}.{}",
            chrono::Utc::now().format("%Y%m%d-%H%M%S"),
            format
        );
        let directory = std::env::var("HOME")
            .map(|home| std::path::PathBuf::from(home).join("Downloads"))
            .unwrap_or_default();
        let prompt = cx.prompt_for_new_path(&directory, Some(&suggested));
        let driver = self.session.driver.clone();
        let connection = self.session.connection.clone();
        let table_export = self.table_export.clone();
        self.busy = true;
        self.error = None;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = match prompt.await {
                Ok(Ok(Some(path))) => {
                    let task = runtime::spawn(async move {
                        let content = if let Some((schema, table, _)) = table_export {
                            export_table(driver, &schema, &table, format).await?
                        } else {
                            let snapshot = super::snapshots::create_snapshot_file(driver, None, connection.connection_string.clone(), "export".into()).await?;
                            let schema = snapshot.get("schemaSQL").and_then(Value::as_str).unwrap_or_default();
                            let data = snapshot.get("dataSQL").and_then(Value::as_str).unwrap_or_default();
                            let full_sql = format!("{schema}\n{data}");
                            match format {
                                "sql" => full_sql,
                                "json" => serde_json::to_string_pretty(&json!({
                                    "format": "rexa-db-export-v1",
                                    "generatedAt": chrono::Utc::now().to_rfc3339(),
                                    "schemaSql": schema,
                                    "dataSql": data,
                                    "fullSql": full_sql,
                                }))?,
                                "csv" => {
                                    use base64::Engine;
                                    format!("section,key,value\nmeta,format,rexa-db-export-v1\npayload,full_sql_base64,{}\n", base64::engine::general_purpose::STANDARD.encode(full_sql))
                                }
                                _ => anyhow::bail!("Unsupported export format."),
                            }
                        };
                        let output_path = path.clone();
                        tokio::task::spawn_blocking(move || std::fs::write(output_path, content)).await??;
                        anyhow::Ok(path)
                    });
                    task.await.map_err(|e| anyhow::anyhow!("{e:#}"))
                }
                Ok(Ok(None)) | Err(_) => Err(anyhow::anyhow!("Export cancelled.")),
                Ok(Err(error)) => Err(anyhow::anyhow!("Could not open save dialog: {error:#}")),
            };
            this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(path) => { rexa_ui::toast::success(format!("Export saved to {}", path.display()), cx); }
                    Err(error) if error.to_string() != "Export cancelled." => {
                        this.error = Some(format!("Export failed: {error:#}"));
                        rexa_ui::toast::error(this.error.clone().unwrap_or_default(), cx);
                    }
                    Err(_) => {}
                }
                cx.notify();
            }).ok();
        }).detach();
    }

    fn import(&mut self, cx: &mut Context<Self>) {
        let confirm = rexa_ui::confirm(
            rexa_ui::ConfirmOptions::destructive("Run the selected database backup?")
                .description("This executes SQL from the file against the current database. Existing data is not cleared automatically, but the script may change or remove objects.")
                .confirm_text("Run SQL"),
            cx,
        );
        let driver = self.session.driver.clone();
        self.busy = true;
        self.error = None;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = if confirm.await {
                let prompt = cx.update(|cx| {
                    cx.prompt_for_paths(gpui::PathPromptOptions {
                        files: true,
                        directories: false,
                        multiple: false,
                        prompt: Some("Select a RexaDB SQL, JSON, or CSV backup".into()),
                    })
                });
                match prompt.await {
                    Ok(Ok(Some(paths))) => match paths.first() {
                        Some(path) => {
                            let path = path.clone();
                            let task = runtime::spawn(async move {
                                let content = tokio::task::spawn_blocking(move || {
                                    std::fs::read_to_string(path)
                                })
                                .await??;
                                let full_sql = parse_bundle(&content)?;
                                if full_sql.trim().is_empty() {
                                    anyhow::bail!("The backup does not contain SQL.");
                                }
                                let applied = driver.execute_script(&full_sql, 1000).await?;
                                if let Some(error) = applied.error {
                                    anyhow::bail!(
                                        "Statement {} failed: {}",
                                        error.statement_index + 1,
                                        error.message
                                    );
                                }
                                Ok::<_, anyhow::Error>(applied.results.len())
                            });
                            task.await.map_err(|e| anyhow::anyhow!("{e:#}"))
                        }
                        None => Err(anyhow::anyhow!("No file was selected.")),
                    },
                    Ok(Ok(None)) | Err(_) => Err(anyhow::anyhow!("Import cancelled.")),
                    Ok(Err(error)) => Err(anyhow::anyhow!("Could not open file dialog: {error:#}")),
                }
            } else {
                Err(anyhow::anyhow!("Import cancelled."))
            };
            this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(count) => {
                        rexa_ui::toast::success(format!("Backup applied ({count} statements)"), cx);
                    }
                    Err(error) if error.to_string() != "Import cancelled." => {
                        this.error = Some(format!("Import failed: {error:#}"));
                        rexa_ui::toast::error(this.error.clone().unwrap_or_default(), cx);
                    }
                    Err(_) => {}
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

fn parse_bundle(content: &str) -> anyhow::Result<String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        if let Some(sql) = value.get("fullSql").and_then(Value::as_str) {
            return Ok(sql.to_string());
        }
        let schema = value
            .get("schemaSql")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let data = value
            .get("dataSql")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Ok(format!("{schema}\n{data}"));
    }
    if content.trim_start().starts_with("section,key,value") {
        let payload = content
            .lines()
            .find_map(|line| {
                let mut cells = line.splitn(3, ',');
                (cells.next() == Some("payload") && cells.next() == Some("full_sql_base64"))
                    .then(|| cells.next().unwrap_or_default())
            })
            .ok_or_else(|| anyhow::anyhow!("CSV backup has no SQL payload."))?;
        use base64::Engine;
        return String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(payload.trim())?,
        )
        .map_err(Into::into);
    }
    Ok(content.to_string())
}

impl Render for ImportExport {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let table_export = self.table_export.clone();
        let export_heading = table_export
            .as_ref()
            .map(|(_, table, _)| format!("Export {table}"))
            .unwrap_or_else(|| "Export database bundle".into());
        let export_description = if table_export.is_some() {
            "Export this table's current rows as JSON, CSV, or SQL insert statements."
        } else {
            "SQL, JSON, and CSV contain the database schema and table data. Export supports PostgreSQL, MySQL, and SQLite connections."
        };
        let export_buttons: Vec<&'static str> = table_export
            .as_ref()
            .map(|(_, _, format)| match format.as_str() {
                "sql" => vec!["sql"],
                "json" => vec!["json"],
                _ => vec!["csv"],
            })
            .unwrap_or_else(|| vec!["sql", "json", "csv"]);
        div().size_full().overflow_y_scrollbar().bg(t.studio_bg).text_color(t.foreground)
            .child(div().mx_auto().max_w(px(720.)).flex().flex_col().gap_6().px_6().py_10()
                .child(div().flex().flex_col().gap_2()
                    .child(div().tw_text_lg().font_weight(gpui::FontWeight::SEMIBOLD).child("Import and export"))
                    .child(div().tw_text_sm().text_color(t.muted_foreground).child("Create a complete SQL backup, or run an existing RexaDB backup against this connection.")))
                .child(div().flex().flex_col().gap_3().rounded(px(10.)).border_1().border_color(t.border).bg(t.card).p_5()
                    .child(div().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child(export_heading))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(export_description))
                    .child(div().flex().flex_wrap().gap_2().children(export_buttons.into_iter().map(|format| {
                        let label = format!("Export {}", format.to_uppercase());
                        Button::new(format!("export-{format}")).outline().size(ButtonSize::Sm).icon(IconName::Download).label(label).disabled(self.busy).on_click(cx.listener(move |this,_,_,cx|this.export(format,cx)))
                    }))))
                .when(table_export.is_none(), |page| page.child(div().flex().flex_col().gap_3().rounded(px(10.)).border_1().border_color(t.border).bg(t.card).p_5()
                    .child(div().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child("Import backup"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Runs SQL from a .sql backup or a RexaDB JSON/CSV bundle. The script may create, change, or remove database objects."))
                    .child(Button::new("import-backup").outline().size(ButtonSize::Sm).icon(IconName::Upload).label(if self.busy { "Working…" } else { "Choose backup file" }).disabled(self.busy).on_click(cx.listener(|this,_,_,cx|this.import(cx))))))
                .when_some(self.error.clone(), |el,error|el.child(div().tw_text_sm().text_color(t.destructive).child(error)))
                .when(self.session.driver.kind() != Kind::Postgres && self.session.driver.kind() != Kind::SupabaseMgmt && self.session.driver.kind() != Kind::MySql && self.session.driver.kind() != Kind::Sqlite, |el| el.child(div().tw_text_xs().text_color(t.muted_foreground).child("Full database export is not implemented for this driver yet."))))
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
