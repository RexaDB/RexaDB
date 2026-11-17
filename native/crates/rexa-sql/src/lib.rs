//! Port of the SQL editor: components/studio/{sql-editor,sql-editor-panel,sql-query-input,monaco-sql-input,sql-query-find,query-history-view,snippet-*,editor-header}.

pub mod completion;
pub mod editor_theme;
pub mod explain;
pub mod export;
pub mod format;
pub mod highlight;
pub mod monaco_input;
pub mod monarch_words;
pub mod results_grid;
pub mod sql_text;
pub mod store;
pub mod suggestions;
pub mod tokenizer;

use gpui::App;

pub fn init(cx: &mut App) {
    monaco_input::init(cx);
}
