//! Port of components/connections/* (and lib/connections): the Connections
//! home, new/edit connection flows, provider account screens.

pub mod accounts;
pub mod fields;
pub mod form;
pub mod home;
mod http;
pub mod providers;
mod select;
mod widgets;

use gpui::{App, AppContext};
use rexa_core::{Registry, Route};

/// Connection-manager screens this crate renders. Others ("settings",
/// "profile", "compare", "transfer[:id]", "cloud-sync") are left to the
/// crates that own them.
fn owns(route: &Route) -> bool {
    match route {
        Route::Connections | Route::EditConnection(_) => true,
        Route::ConnectionScreen(s) => {
            matches!(s.as_str(), "list" | "new-select" | "jdbc-picker")
                || s.starts_with("new-form:")
                || accounts::AccountKind::from_screen(s).is_some()
        }
        _ => false,
    }
}

pub fn init(cx: &mut App) {
    Registry::screen(cx, "rexa-connections", |route, window, cx| {
        if !owns(route) {
            return None;
        }
        let route = route.clone();
        Some(cx.new(|cx| home::ConnectionsScreen::new(window, cx).with_route(&route, window, cx)).into())
    });
}
