//! Port of settings and app-level screens: components/studio/{settings-view,settings/,keybindings-view,profile-settings-view,theme-creator/,manage-workspaces-view,extensions*}, components/onboarding, auth page.
//!
//! Public API for other crates:
//! - [`model::SettingsModel`]: the app-wide settings (`app_settings.studio_settings`,
//!   app/editor theme, font, privacy switches). `SettingsModel::global(cx)`
//!   returns the entity; subscribe for [`model::SettingsChanged`]. Helpers
//!   [`model::studio_bool`] / [`model::studio_str`] read one studio key.
//! - `rexa_core::update::UpdateState` global is kept current by [`update`].

pub mod model;
pub mod persist;

use gpui::App;

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
}
