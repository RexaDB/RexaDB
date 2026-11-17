//! Port of the table data editor: components/studio/{data-grid-ag,grid/,table-editor-view,data-table-toolbar,toolbar/,insert-row-sheet,fk-selection-sheet,pending-changes-banner,review-sheet,saved-table-views,import-export-view}, hooks/use-table-data-mutations.

pub mod cells;
pub mod filters;
pub mod settings;

use gpui::App;

pub fn init(_cx: &mut App) {}
