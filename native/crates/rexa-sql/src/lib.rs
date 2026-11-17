//! Port of the SQL editor: components/studio/{sql-editor,sql-editor-panel,sql-query-input,monaco-sql-input,sql-query-find,query-history-view,snippet-*,editor-header}.

pub mod editor_theme;
pub mod export;
pub mod store;
pub mod highlight;
pub mod monarch_words;
pub mod sql_text;
pub mod suggestions;
pub mod tokenizer;

use gpui::App;

pub fn init(_cx: &mut App) {}
