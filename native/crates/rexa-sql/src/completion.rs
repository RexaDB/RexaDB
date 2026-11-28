//! The completion provider monaco-sql-input.tsx registers
//! (`registerCompletionItemProvider("sql", { triggerCharacters: [".", " ", '"', "`", "["] })`),
//! answering from [`crate::suggestions::get_sql_suggestions`].

use crate::suggestions::{get_sql_suggestions, SchemaEntry, SuggestionKind};
use anyhow::Result;
use gpui::{App, Task, Window};
use gpui_component::input::{CompletionProvider, Rope, RopeExt};
use lsp_types::{CompletionContext, CompletionItem, CompletionItemKind, CompletionResponse, CompletionTextEdit, Range, TextEdit};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub struct SqlCompletionProvider {
    pub schema: Rc<RefCell<Vec<SchemaEntry>>>,
    pub db_type: String,
    /// No completions in AI mode (the provider is disposed there in the original).
    pub ai_mode: Rc<Cell<bool>>,
}

impl CompletionProvider for SqlCompletionProvider {
    fn completions(&self, text: &Rope, offset: usize, _: CompletionContext, _: &mut Window, _: &mut App) -> Task<Result<CompletionResponse>> {
        if self.ai_mode.get() || matches!(self.db_type.as_str(), "mongodb" | "redis") {
            return Task::ready(Ok(CompletionResponse::Array(vec![])));
        }
        let query = text.to_string();
        let Some(result) = get_sql_suggestions(&query, offset, &self.schema.borrow(), &self.db_type) else {
            return Task::ready(Ok(CompletionResponse::Array(vec![])));
        };
        let range = Range { start: text.offset_to_position(result.token_start), end: text.offset_to_position(result.token_end) };
        let items = result
            .items
            .into_iter()
            .enumerate()
            .map(|(i, item)| CompletionItem {
                label: item.label,
                kind: Some(match item.kind {
                    SuggestionKind::Table => CompletionItemKind::CLASS,
                    SuggestionKind::Column => CompletionItemKind::FIELD,
                    SuggestionKind::Function => CompletionItemKind::FUNCTION,
                    SuggestionKind::Keyword => CompletionItemKind::KEYWORD,
                }),
                detail: item.detail,
                sort_text: Some(format!("{i:04}")),
                filter_text: item.filter_text,
                text_edit: Some(CompletionTextEdit::Edit(TextEdit { range, new_text: item.insert_text })),
                ..Default::default()
            })
            .collect();
        Task::ready(Ok(CompletionResponse::Array(items)))
    }

    fn is_completion_trigger(&self, _offset: usize, new_text: &str, _: &mut App) -> bool {
        // Monaco's quick suggestions open on word characters; plus the trigger characters.
        let mut chars = new_text.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => c.is_alphanumeric() || matches!(c, '_' | '.' | ' ' | '"' | '`' | '['),
            _ => false,
        }
    }
}
