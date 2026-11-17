//! Port of the SQL editor: components/studio/{sql-editor,sql-editor-panel,
//! sql-query-input,monaco-sql-input,sql-query-find,query-history-view,
//! snippet-browser,snippet-common}.tsx, lib/studio/{editor-themes,
//! sql-suggestions,sql-identifier,sql-dialects,split-sql,sql-ai-mode}.ts and
//! the SQL-tab parts of hooks/use-studio.ts.
//!
//! Registers the studio tab factory for `TabSpec::Query` (SQL editor),
//! `View { view: "history" }` (query history) and the hosted
//! `"sql-sheet"` / `"bottom-sql-panel"` panels, plus a dev screen
//! (`screen:dev-sql:<connection id>`).

pub mod ai;
pub mod completion;
mod dev;
pub mod editor_theme;
pub mod explain;
pub mod export;
pub mod format;
pub mod highlight;
pub mod monaco_input;
pub mod monarch_words;
pub mod results_grid;
pub mod sql_editor;
pub mod sql_text;
pub mod store;
pub mod suggestions;
pub mod tokenizer;

use gpui::{App, AppContext};
use rexa_core::{Registry, Route, TabSpec};

pub fn init(cx: &mut App) {
    monaco_input::init(cx);
    Registry::tab(cx, "rexa-sql", |spec, session, window, cx| match spec {
        TabSpec::Query { id, title, sql } => {
            let (id, title, sql) = (id.clone(), title.clone(), sql.clone());
            Some(cx.new(|cx| sql_editor::SqlEditor::new(session, id, title, sql, window, cx)).into())
        }
        _ => None,
    });
    Registry::screen(cx, "rexa-sql", |route, window, cx| {
        let Route::ConnectionScreen(s) = route else { return None };
        let (which, id) = if let Some(id) = s.strip_prefix("dev-sql-history:") {
            ("history", id)
        } else if let Some(id) = s.strip_prefix("dev-sql-panel:") {
            ("panel", id)
        } else {
            ("editor", s.strip_prefix("dev-sql:")?)
        };
        let id: i64 = id.parse().ok()?;
        Some(cx.new(|cx| dev::DevSqlScreen::new(id, which, window, cx)).into())
    });
}
