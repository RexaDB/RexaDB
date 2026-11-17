//! Port of the table data editor: components/studio/{data-grid-ag,grid/,table-editor-view,data-table-toolbar,toolbar/,insert-row-sheet,fk-selection-sheet,pending-changes-banner,review-sheet,saved-table-views}, @rexadbapp/data-table's grid, hooks/use-table-data-mutations.
//!
//! The studio shell hosts [`view::TableEditor`] for `TabSpec::Table` tabs and
//! sends it `StudioEvent::TabCommand`s (REFRESH_CURRENT_TAB,
//! COMMIT_PENDING_CHANGES, OPEN_INSERT_SHEET, TOGGLE_PENDING_CHANGES_PANEL).

pub mod cells;
mod debug;
mod editor;
pub mod filters;
mod footer;
mod grid;
pub mod settings;
mod sheets;
mod toolbar;
pub mod view;

use gpui::{App, AppContext};
use rexa_core::{Registry, TabSpec};

/// "Open referenced table with filter" (`onNavigateToTable`): the filter a
/// table tab should apply when it opens (or is re-focused) next.
pub mod pending_filters {
    use std::collections::HashMap;
    use std::sync::Mutex;

    static FILTERS: Mutex<Option<HashMap<(String, String), String>>> = Mutex::new(None);

    pub fn set(schema: &str, table: &str, filter: String) {
        FILTERS.lock().unwrap().get_or_insert_with(HashMap::new).insert((schema.into(), table.into()), filter);
    }

    pub fn take(schema: &str, table: &str) -> Option<String> {
        FILTERS.lock().unwrap().as_mut()?.remove(&(schema.to_string(), table.to_string()))
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-grid", |spec, session, window, cx| match spec {
        TabSpec::Table { schema, table } => {
            let (schema, table) = (schema.clone(), table.clone());
            Some(cx.new(|cx| view::TableEditor::new(schema, table, session, window, cx)).into())
        }
        _ => None,
    });
}
