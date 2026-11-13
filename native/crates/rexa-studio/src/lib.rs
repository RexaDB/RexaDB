//! Port of the studio shell: app/studio/*, components/studio/{studio-interface,
//! studio-main-content,studio-shell-sidebar,modern-pane-tabs,command-menu,…},
//! components/app-shell/*, hooks/use-studio*.
//!
//! Tab hosting contract (for crates that build tab bodies):
//! - Register `rexa_core::Registry::tab(cx, "<crate>", factory)`; the shell calls
//!   it with the tab's `TabSpec` (see `tabs::tab_to_spec`) the first time the tab
//!   is shown and keeps the view for the tab's lifetime.
//! - Old tab types map to: `table` → `Table`, `sql` → `Query { id, title, sql }`,
//!   `create-*` → `Create { object }`, `settings`/`profile-settings`/`keybindings`/
//!   `agent-settings` → `Settings { section }`, everything else →
//!   `View { view: <old type>, params: <the whole tab record> }`
//!   (`database-schema` / `erd-designer` fall back to `Erd { schema }`).
//! - Hosted panels are `View { view: "ai-chat" | "ai-threads" | "sql-sheet" |
//!   "bottom-sql-panel", params: { connectionId } }`.
//! - Talk back through `rexa_core::studio_bus`: `OpenTab`, `CloseTab`,
//!   `MarkDirty`, `RenameTab`, `QueryChanged`, `OpenSettings`, `SchemaChanged`;
//!   listen for `TabCommand` to handle keybindings meant for the active tab.

pub mod catalog;
mod command_menu;
mod dialogs;
mod explorer;
mod header;
pub mod icons;
pub mod keybindings;
mod main_content;
mod menu;
pub mod persistence;
mod rail;
mod resize;
mod shell;
mod sidebar;
pub mod split_layout;
mod status_bar;
pub mod studio;
mod tab_strip;
pub mod tabs;

use gpui::{App, AppContext};
use rexa_core::{Registry, Route};

pub fn init(cx: &mut App) {
    Registry::screen(cx, "rexa-studio", |route, window, cx| match route {
        Route::Studio(id) => {
            let id = *id;
            Some(cx.new(|cx| studio::Studio::new(id, window, cx)).into())
        }
        _ => None,
    });
}
