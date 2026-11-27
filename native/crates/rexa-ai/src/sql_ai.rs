//! Port of hooks/use-sql-ai-generation.ts + hooks/use-sql-ai-settings.ts (the
//! editor's "/ prompt" → snippet, installed into rexa-sql through
//! `set_sql_ai_generator`) and `runAgentFilter` / `extractWhereClause` /
//! `dialectRules` of components/studio/data-table-toolbar.tsx (the grid's ⌘↩
//! AI filter). Both go through the same agent as the chat, in `schema_only`
//! permission mode, like the original's `/api/agent/chat/stream` calls.

use crate::agent::{self, ChatRequest};
use crate::db_tools::{CatalogTable, DbCtx};
use crate::settings;
use anyhow::{anyhow, bail, Result};
use gpui::{App, Task};
use rexa_core::Sessions;
use rexa_sql::ai::{SqlAiGenerator, SqlAiRequest};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

fn session(connection_id: i64, cx: &mut App) -> Result<Arc<rexa_core::Session>> {
    cx.default_global::<Sessions>().open.get(&connection_id).cloned().ok_or_else(|| anyhow!("The connection is not open."))
}

/// Run one schema-only agent turn and return the assistant's text.
fn run_oneshot(connection_id: i64, prompt: String, namespace: Option<String>, schema: Vec<CatalogTable>, cx: &mut App) -> Task<Result<String>> {
    let s = settings::load();
    let prepared = (|| -> Result<_> {
        let (provider, model) = settings::pick_provider_and_model(&s)?;
        let cfg = settings::provider_config(&s, &provider, &model)?;
        let session = session(connection_id, cx)?;
        Ok((cfg, session))
    })();
    let (cfg, session) = match prepared {
        Ok(v) => v,
        Err(e) => return Task::ready(Err(e)),
    };
    let db = DbCtx {
        driver: session.driver.clone(),
        db_type: session.driver.kind().as_str().to_string(),
        connection_name: Some(session.connection.name.clone()),
        default_namespace: namespace,
        allow_read: false,
        allow_write: false,
    };
    let req = ChatRequest { provider: cfg, permission_mode: "schema_only".into(), db, exa_api_key: settings::exa_api_key(&s), schema_context: schema, history: Vec::new(), prompt };
    let fut = rexa_core::runtime::spawn(async move {
        let (tx, _rx) = futures::channel::mpsc::unbounded();
        agent::run_chat(req, tx, Arc::new(AtomicBool::new(false))).await
    });
    cx.background_executor().spawn(fut)
}

/// `buildSqlAiEditorPrompt`.
pub fn build_sql_ai_editor_prompt(db_type: &str, prompt: &str) -> String {
    let lang = match db_type {
        "mongodb" => "javascript",
        "redis" => "plaintext",
        _ => "sql",
    };
    [
        "Generate a suggested database snippet for the editor.".to_string(),
        format!("Target language: {lang}."),
        "Return exactly one fenced code block followed by a short explanation.".into(),
        "Do not add any prose before the code block.".into(),
        "After the code block, add 1 to 3 short lines explaining what the query does.".into(),
        "Keep the snippet ready for review in an editor.".into(),
        "If the request implies a mutation, still return it as a suggested snippet only.".into(),
        String::new(),
        "User request:".into(),
        prompt.trim().to_string(),
    ]
    .join("\n")
}

/// The generator rexa-sql calls for "/ prompt" in the editor.
pub struct NativeSqlAi;

impl SqlAiGenerator for NativeSqlAi {
    fn has_any_models(&self, _cx: &App) -> bool {
        settings::has_any_models(&settings::load())
    }

    fn generate(&self, request: SqlAiRequest, cx: &mut App) -> Task<Result<String>> {
        if request.prompt.trim().is_empty() {
            return Task::ready(Err(anyhow!("Type an AI prompt after /.")));
        }
        // `buildLightSchemaContext`: columns capped at 30.
        let schema: Vec<CatalogTable> = request
            .schema
            .iter()
            .filter(|e| !e.name.is_empty())
            .map(|e| CatalogTable {
                schema: if e.schema.is_empty() { request.selected_namespace.clone().unwrap_or_else(|| "public".into()) } else { e.schema.clone() },
                table: e.name.clone(),
                columns: e.columns.iter().take(30).cloned().collect(),
            })
            .collect();
        let prompt = build_sql_ai_editor_prompt(&request.db_type, &request.prompt);
        let task = run_oneshot(request.connection_id, prompt, request.selected_namespace.clone(), schema, cx);
        cx.background_executor().spawn(async move {
            let text = task.await?;
            if rexa_sql::sql_text::extract_first_code_block(&text).trim().is_empty() {
                bail!("The assistant returned an empty snippet.");
            }
            Ok(text)
        })
    }
}

/// `dialectRules`.
pub fn dialect_rules(db_type: &str) -> &'static str {
    match db_type {
        "mysql" | "clickhouse" => "- Quote identifiers with backticks: `col`.\n- String literals in 'single quotes'. Numbers and booleans unquoted.\n- No ILIKE. For fuzzy text match use `col` LIKE '%...%'.",
        "mssql" => "- Quote identifiers with square brackets: [col].\n- String literals in 'single quotes'. Use 1/0 instead of TRUE/FALSE.\n- No ILIKE. For fuzzy text match use CAST([col] AS NVARCHAR(MAX)) LIKE '%...%'.",
        "sqlite" | "duckdb" => "- Quote identifiers with double quotes: \"col\".\n- String literals in 'single quotes'. Numbers unquoted.\n- No ILIKE and no backticks. For fuzzy text match use CAST(\"col\" AS TEXT) LIKE '%...%'.",
        _ => "- Quote identifiers with double quotes: \"col\".\n- String literals in 'single quotes'. Numbers and TRUE/FALSE unquoted.\n- ILIKE is allowed for case-insensitive match, otherwise CAST(\"col\" AS TEXT) LIKE '%...%'.",
    }
}

/// `extractWhereClause`.
pub fn extract_where_clause(raw: &str) -> Option<String> {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return None;
    }
    if let Some(a) = text.find("```") {
        if let Some(b) = text[a + 3..].find("```") {
            let inner = &text[a + 3..a + 3 + b];
            let inner = inner.strip_prefix("sql").or_else(|| inner.strip_prefix("SQL")).unwrap_or(inner);
            text = inner.trim().to_string();
        }
    }
    if text.len() >= 5 && text[..5].eq_ignore_ascii_case("where") && text[5..].starts_with(char::is_whitespace) {
        text = text[5..].trim_start().to_string();
    }
    let text = text.trim_end().trim_end_matches(';').trim().to_string();
    let lower = text.to_ascii_lowercase();
    if text.is_empty() || (lower.starts_with("cannot") && lower[6..].chars().next().is_none_or(|c| !c.is_alphanumeric())) {
        return None;
    }
    Some(text)
}

/// `buildAiFilterPrompt` part of `runAgentFilter`.
pub fn build_filter_prompt(text: &str, schema: &str, table: &str, db_type: &str, columns: &[(String, String)]) -> String {
    let column_lines = columns.iter().map(|(n, t)| format!("- {n} ({t})")).collect::<Vec<_>>().join("\n");
    [
        "You are building a SQL WHERE clause filter for a database table UI.".to_string(),
        format!("Database engine: {}. Follow that engine's syntax exactly.", if db_type.is_empty() { "postgres" } else { db_type }),
        format!("Table: \"{schema}\".\"{table}\""),
        "Columns:".into(),
        column_lines,
        format!("User request: \"{text}\""),
        "Rules:".into(),
        "- Reply with ONLY the WHERE condition, no markdown fences, no explanation.".into(),
        "- NEVER include the word WHERE itself, and never return a SELECT statement.".into(),
        "- Use ONLY the columns listed above.".into(),
        dialect_rules(db_type).into(),
        "- For fuzzy text match follow the dialect rule above.".into(),
        "- If the request cannot be expressed as a filter, reply with exactly: CANNOT".into(),
    ]
    .join("\n")
}

/// The grid's AI filter (`runAgentFilter`): resolves to the WHERE condition.
pub fn generate_ai_filter(connection_id: i64, schema: &str, table: &str, db_type: &str, columns: Vec<(String, String)>, text: &str, cx: &mut App) -> Task<Result<String>> {
    let prompt = build_filter_prompt(text, schema, table, db_type, &columns);
    let ctx = vec![CatalogTable { schema: schema.to_string(), table: table.to_string(), columns }];
    let task = run_oneshot(connection_id, prompt, Some(schema.to_string()).filter(|s| !s.is_empty()), ctx, cx);
    cx.background_executor().spawn(async move {
        let raw = task.await?;
        extract_where_clause(&raw).ok_or_else(|| anyhow!("The agent could not build a filter from that text."))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn where_clause() {
        assert_eq!(extract_where_clause("WHERE \"age\" > 3;").as_deref(), Some("\"age\" > 3"));
        assert_eq!(extract_where_clause("```sql\nname ILIKE '%a%'\n```").as_deref(), Some("name ILIKE '%a%'"));
        assert_eq!(extract_where_clause("CANNOT"), None);
        assert_eq!(extract_where_clause("cannotx = 1").as_deref(), Some("cannotx = 1"));
        assert!(build_filter_prompt("big", "public", "t", "mysql", &[("a".into(), "int".into())]).contains("- a (int)"));
        assert!(build_sql_ai_editor_prompt("mongodb", " x ").contains("Target language: javascript."));
    }
}
