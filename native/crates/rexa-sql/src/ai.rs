//! UI hook points of hooks/use-sql-ai-generation.ts and hooks/use-sql-ai-settings.ts.
//!
//! The AI calls themselves belong to rexa-ai: it installs a generator with
//! [`set_sql_ai_generator`]. Until then the editor behaves like the original
//! with no models configured ("Add Models", and a toast pointing at settings).

use crate::sql_text::{extract_first_code_block, format_ai_snippet_for_editor};
use crate::suggestions::SchemaEntry;
use anyhow::Result;
use gpui::{App, Global, Task};
use std::rc::Rc;

/// What `useSqlAiGeneration` sends along with the prompt.
#[derive(Clone, Debug)]
pub struct SqlAiRequest {
    pub connection_id: i64,
    pub db_type: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub selected_namespace: Option<String>,
    pub schema: Vec<SchemaEntry>,
}

pub trait SqlAiGenerator {
    /// Whether any model is usable (`hasAnyModels`).
    fn has_any_models(&self, cx: &App) -> bool;
    /// Raw model reply (a fenced code block + 1–3 explanation lines, as
    /// `buildSqlAiEditorPrompt` asks for).
    fn generate(&self, request: SqlAiRequest, cx: &mut App) -> Task<Result<String>>;
}

struct SqlAi(Rc<dyn SqlAiGenerator>);
impl Global for SqlAi {}

pub fn set_sql_ai_generator(generator: Rc<dyn SqlAiGenerator>, cx: &mut App) {
    cx.set_global(SqlAi(generator));
}

pub fn sql_ai_generator(cx: &App) -> Option<Rc<dyn SqlAiGenerator>> {
    cx.try_global::<SqlAi>().map(|g| g.0.clone())
}

/// `generateCommentedSnippet`'s post-processing of the reply.
pub fn commented_snippet(db_type: &str, reply: &str) -> String {
    let snippet = extract_first_code_block(reply);
    let without = match (reply.find("```"), reply.rfind("```")) {
        (Some(a), Some(b)) if b > a => format!("{}{}", &reply[..a], &reply[b + 3..]),
        _ => String::new(),
    };
    let explanation: Vec<String> =
        without.lines().map(str::trim).filter(|l| !l.is_empty()).take(3).map(str::to_string).collect();
    format_ai_snippet_for_editor(db_type, &snippet, &explanation)
}
