//! Port of components/connections/* (and lib/connections): the Connections
//! home, new/edit connection flows, provider account screens.

pub mod fields;
pub mod home;
pub mod providers;

use gpui::{AppContext, App};
use rexa_core::{Registry, Route};

pub fn init(cx: &mut App) {
    Registry::screen(cx, "rexa-connections", |route, window, cx| match route {
        Route::Connections => Some(cx.new(|cx| home::ConnectionsScreen::new(window, cx)).into()),
        _ => None,
    });
}
