//! Port of settings and app-level screens: components/studio/{settings-view,settings/,keybindings-view,profile-settings-view,theme-creator/,manage-workspaces-view,extensions*}, components/onboarding, auth page.
//!
//! Public API for other crates:
//! - [`model::SettingsModel`]: the app-wide settings (`app_settings.studio_settings`,
//!   app/editor theme, font, privacy switches). `SettingsModel::global(cx)`
//!   returns the entity; subscribe for [`model::SettingsChanged`]. Helpers
//!   [`model::studio_bool`] / [`model::studio_str`] read one studio key.
//! - `rexa_core::update::UpdateState` global is kept current by [`update`];
//!   [`update::check_for_updates`] / [`update::dismiss`] drive it.
//! - Screens: `Route::ConnectionScreen("settings" | "profile")`, `Route::Auth`;
//!   studio tabs: `TabSpec::Settings { section }`.

pub mod advanced;
pub mod ai;
pub mod app_icon;
pub mod danger;
pub mod keybindings;
pub mod mcp;
pub mod model;
pub mod persist;
pub mod rows;
pub mod search;
pub mod security;
pub mod theme_creator;
pub mod theme_util;
pub mod themes;
pub mod tint;
pub mod update;
pub mod view;
pub mod workspace;

use gpui::{App, AppContext};
use rexa_core::{Registry, Route, TabSpec};

pub fn init(cx: &mut App) {
    let model = model::SettingsModel::global(cx);
    let (id, custom, font) = {
        let m = model.read(cx);
        (m.app_theme_id.clone(), m.custom_app_themes_json(), m.app_font.clone())
    };
    // rexa-app installs the theme from `app_settings` before init; re-apply so
    // settings.json and the `system` appearance are honoured too.
    model::apply_app_theme(&id, &custom, cx);
    model::apply_app_font(&font, cx);
    app_icon::apply_saved();
    update::init(cx);

    Registry::tab(cx, "rexa-settings", |spec, _session, window, cx| match spec {
        // "profile" / "agent" sections map to their pages; everything else is a settings section.
        TabSpec::Settings { section } => Some(match section.as_str() {
            "keybindings" => view::build("keybindings", window, cx).into(),
            "agent" => view::build("ai", window, cx).into(),
            s => view::build(s, window, cx).into(),
        }),
        _ => None,
    });
    Registry::screen(cx, "rexa-settings", |route, window, cx| match route {
        Route::ConnectionScreen(s) if s == "settings" => Some(cx.new(|cx| screen::SettingsScreen::new(window, cx)).into()),
        _ => None,
    });
}

pub mod screen;
