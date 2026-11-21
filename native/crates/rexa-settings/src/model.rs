//! Port of hooks/use-global-studio-settings.ts, hooks/use-global-app-theme.ts,
//! hooks/use-global-editor-theme.ts, hooks/use-global-app-font-family.ts and
//! hooks/use-app-font-family.ts: one app-wide settings model, loaded once,
//! persisted on every change (replace semantics, like the hooks' save effects)
//! and applied live (app theme → `rexa_ui::theme::install`, font → `rexa_ui::app_font`).
//!
//! Other crates read settings with [`SettingsModel::read`] / [`studio_bool`] etc.
//! and can `cx.subscribe(&SettingsModel::global(cx), …)` for [`SettingsChanged`].

use crate::persist;
use gpui::{App, AppContext, Context, Entity, EventEmitter, Global, WindowAppearance};
use serde_json::{Map, Value};

pub const DIAGNOSTICS_STORAGE_KEY: &str = "rexa-db-diagnostics-enabled";
pub const AUTO_UPDATE_CHECKS_STORAGE_KEY: &str = "rexa-db-auto-update-checks";
pub const DEFAULT_ICON_THEME_ID: &str = "lucide";
pub const DEFAULT_DARK_THEME_ID: &str = "rexadb-dark";

/// Field defaults of useGlobalStudioSettings (the `useState` initial values).
pub fn studio_default(key: &str) -> Value {
    use serde_json::json;
    match key {
        "appZoom" => json!(100),
        "executionMode" => json!("direct"),
        "infiniteTableScrolling" => json!(false),
        "rowSpacing" => json!("standard"),
        "alternatingRowColors" => json!(false),
        "editorFontSize" => json!("14px"),
        "editorFontFamily" => json!(""),
        "sqlEditorEngine" => json!("monaco"),
        "tuiMode" => json!(false),
        "tuiTheme" => json!("auto"),
        "commandMenuSections" => json!([]),
        "agentProvider" => json!("openai"),
        "agentModel" | "agentApiKey" => json!(""),
        "glassmorphicHeaders" | "gridAnimations" | "sleekSelection" | "colorizedPills" | "relativeDates"
        | "richJsonInspector" | "dataBars" | "skeletonLoaders" | "sleekLayout" => json!(false),
        "fastTableLoading" => json!(true),
        "showTabIndicator" => json!(true),
        "iconThemeId" => json!(DEFAULT_ICON_THEME_ID),
        "customIconThemes" => json!([]),
        "restoreAppState" => json!(true),
        "openConnectionsInNewWindow" | "schemaExplorer" | "databaseExplorer" => json!(false),
        "showTableCount" | "tableExpansion" => json!(true),
        "redisKeyTreeView" | "hideWindowActions" | "rlsPolicyTabEditor" | "autoClosePane" | "confirmSheetClose"
        | "sidebarToggleBeforeConnection" | "autoSaveQueries" | "vimMode" => json!(false),
        "slashAiTrigger" | "resultTabsEnabled" | "showPendingChangesBanner" => json!(true),
        "previewTabs" | "noiseBgEnabled" | "noiseBgTranslucent" => json!(false),
        "noiseBgOpacity" => json!(30),
        "noiseBgSize" => json!(50),
        "noiseBgBlendMode" => json!("overlay"),
        "noiseBgColor" => json!("#000000"),
        "buttonStyle" => json!("raised"),
        "sqlFormatTabWidth" => json!(2),
        "sqlFormatUseTabs" => json!(false),
        "sqlFormatKeywordCase" => json!("upper"),
        "sqlFormatDataTypeCase" | "sqlFormatFunctionCase" | "sqlFormatIdentifierCase" => json!("preserve"),
        "sqlFormatLogicalOperatorNewline" => json!("before"),
        "sqlFormatExpressionWidth" => json!(50),
        "sqlFormatLinesBetweenQueries" => json!(2),
        "sqlFormatDenseOperators" | "sqlFormatNewlineBeforeSemicolon" => json!(false),
        _ => Value::Null,
    }
}

/// Every key the save payload writes (same order as the hook's payload).
pub const STUDIO_KEYS: &[&str] = &[
    "appZoom", "executionMode", "infiniteTableScrolling", "rowSpacing", "alternatingRowColors", "editorFontSize",
    "editorFontFamily", "sqlEditorEngine", "tuiMode", "tuiTheme", "commandMenuSections", "agentProvider", "agentModel",
    "agentApiKey", "glassmorphicHeaders", "gridAnimations", "sleekSelection", "colorizedPills", "relativeDates",
    "richJsonInspector", "dataBars", "skeletonLoaders", "fastTableLoading", "sleekLayout", "showTabIndicator",
    "iconThemeId", "customIconThemes", "restoreAppState", "openConnectionsInNewWindow", "schemaExplorer",
    "databaseExplorer", "showTableCount", "tableExpansion", "redisKeyTreeView", "hideWindowActions",
    "rlsPolicyTabEditor", "autoClosePane", "confirmSheetClose", "sidebarToggleBeforeConnection",
    "showPendingChangesBanner", "autoSaveQueries", "vimMode", "slashAiTrigger", "previewTabs", "resultTabsEnabled",
    "noiseBgEnabled", "noiseBgOpacity", "noiseBgSize", "noiseBgBlendMode", "noiseBgColor", "noiseBgTranslucent",
    "buttonStyle", "sqlFormatTabWidth", "sqlFormatUseTabs", "sqlFormatKeywordCase", "sqlFormatDataTypeCase",
    "sqlFormatFunctionCase", "sqlFormatIdentifierCase", "sqlFormatLogicalOperatorNewline", "sqlFormatExpressionWidth",
    "sqlFormatLinesBetweenQueries", "sqlFormatDenseOperators", "sqlFormatNewlineBeforeSemicolon",
];

/// A custom app theme (lib/studio/app-themes.ts CustomAppTheme).
#[derive(Clone, Debug, PartialEq)]
pub struct NamedTheme {
    pub id: String,
    pub name: String,
    /// `base` for app themes, empty for editor themes.
    pub base: String,
    pub raw: Value,
}

impl NamedTheme {
    fn from_value(v: &Value) -> Option<Self> {
        Some(Self {
            id: v.get("id")?.as_str()?.to_string(),
            name: v.get("name").and_then(|n| n.as_str()).unwrap_or_default().to_string(),
            base: v.get("base").and_then(|n| n.as_str()).unwrap_or_default().to_string(),
            raw: v.clone(),
        })
    }
}

fn parse_theme_list(json: &str) -> Vec<NamedTheme> {
    serde_json::from_str::<Vec<Value>>(json).unwrap_or_default().iter().filter_map(NamedTheme::from_value).collect()
}

/// Built-in app themes (BUILTIN_APP_THEMES): (id, name).
pub fn builtin_app_themes() -> Vec<(String, String)> {
    #[derive(serde::Deserialize)]
    struct T {
        id: String,
        #[serde(default)]
        name: String,
    }
    let themes: Vec<T> = serde_json::from_str(include_str!("../../../assets/themes.json")).unwrap_or_default();
    themes.into_iter().map(|t| (t.id, t.name)).collect()
}

pub const EDITOR_BUILTIN_THEMES: &[(&str, &str)] =
    &[("auto", "Auto (follow app)"), ("studio-dark", "Studio Dark"), ("light", "Light"), ("vs-dark", "VS Dark"), ("hc-black", "High Contrast")];

pub struct SettingsModel {
    pub studio: Map<String, Value>,
    pub app_theme_id: String,
    pub custom_app_themes: Vec<NamedTheme>,
    pub editor_theme_id: String,
    pub custom_editor_themes: Vec<NamedTheme>,
    pub app_font: String,
    pub diagnostics: bool,
    pub auto_update_checks: bool,
    /// Last save error, surfaced as a toast by the view.
    pub last_error: Option<String>,
}

/// Emitted after any change; `key` is the studio key or one of
/// "appThemeId", "customAppThemes", "editorThemeId", "customEditorThemes", "appFontFamily".
#[derive(Clone, Debug)]
pub struct SettingsChanged {
    pub key: String,
}

impl EventEmitter<SettingsChanged> for SettingsModel {}

struct SettingsGlobal(Entity<SettingsModel>);
impl Global for SettingsGlobal {}

impl SettingsModel {
    pub fn load() -> Self {
        let (app_theme_id, custom_app) = persist::load_app_theme();
        let (editor_theme_id, custom_editor) = persist::load_editor_theme();
        Self {
            studio: persist::load_studio_settings(),
            app_theme_id,
            custom_app_themes: parse_theme_list(&custom_app),
            editor_theme_id,
            custom_editor_themes: parse_theme_list(&custom_editor),
            app_font: persist::load_app_font(),
            diagnostics: persist::read_switch(DIAGNOSTICS_STORAGE_KEY, false),
            auto_update_checks: persist::read_switch(AUTO_UPDATE_CHECKS_STORAGE_KEY, true),
            last_error: None,
        }
    }

    /// The app-wide model (created on first use).
    pub fn global(cx: &mut App) -> Entity<Self> {
        if let Some(g) = cx.try_global::<SettingsGlobal>() {
            return g.0.clone();
        }
        let e = cx.new(|_| Self::load());
        cx.set_global(SettingsGlobal(e.clone()));
        e
    }

    pub fn read(cx: &App) -> Option<&Self> {
        Some(cx.try_global::<SettingsGlobal>()?.0.read(cx))
    }

    // ---- studio settings --------------------------------------------------------------

    pub fn value(&self, key: &str) -> Value {
        match self.studio.get(key) {
            Some(v) if !v.is_null() => v.clone(),
            _ => studio_default(key),
        }
    }

    pub fn bool(&self, key: &str) -> bool {
        if key == "fastTableLoading" {
            return resolve_fast_table_loading(&self.studio);
        }
        self.value(key).as_bool().unwrap_or_else(|| studio_default(key).as_bool().unwrap_or(false))
    }

    pub fn str(&self, key: &str) -> String {
        match self.value(key) {
            Value::String(s) => s,
            Value::Number(n) => n.to_string(),
            _ => studio_default(key).as_str().unwrap_or_default().to_string(),
        }
    }

    pub fn num(&self, key: &str) -> f64 {
        self.value(key).as_f64().or_else(|| studio_default(key).as_f64()).unwrap_or(0.)
    }

    /// The full save payload: every known key (current or default) plus any
    /// unknown keys already stored, so nothing written by the old app is lost.
    pub fn studio_payload(&self) -> Map<String, Value> {
        let mut out = self.studio.clone();
        for key in STUDIO_KEYS {
            let v = if *key == "fastTableLoading" { Value::Bool(self.bool(key)) } else { self.value(key) };
            out.insert((*key).to_string(), v);
        }
        out.insert("fastTableLoadingDefaultMigrated".into(), Value::Bool(true));
        out
    }

    pub fn set(&mut self, key: &str, value: impl Into<Value>, cx: &mut Context<Self>) {
        self.studio.insert(key.to_string(), value.into());
        if key == "buttonStyle" {
            rexa_ui::button::set_global_style(&self.str(key), cx);
        }
        let payload = self.studio_payload();
        self.last_error = persist::save_studio_settings(&payload).err().map(|e| e.to_string());
        self.changed(key, cx);
    }

    fn changed(&mut self, key: &str, cx: &mut Context<Self>) {
        cx.emit(SettingsChanged { key: key.to_string() });
        cx.notify();
    }

    // ---- app theme --------------------------------------------------------------------

    pub fn custom_app_themes_json(&self) -> String {
        Value::Array(self.custom_app_themes.iter().map(|t| t.raw.clone()).collect()).to_string()
    }

    pub fn set_app_theme(&mut self, id: &str, cx: &mut Context<Self>) {
        self.app_theme_id = id.to_string();
        self.save_app_theme(cx);
        self.changed("appThemeId", cx);
    }

    pub fn set_custom_app_themes(&mut self, themes: Vec<NamedTheme>, cx: &mut Context<Self>) {
        self.custom_app_themes = themes;
        self.save_app_theme(cx);
        self.changed("customAppThemes", cx);
    }

    fn save_app_theme(&mut self, cx: &mut Context<Self>) {
        self.last_error = persist::save_app_theme(&self.app_theme_id, &self.custom_app_themes_json()).err().map(|e| e.to_string());
        apply_app_theme(&self.app_theme_id, &self.custom_app_themes_json(), cx);
        apply_app_font(&self.app_font, cx);
    }

    /// handleRemoveAppTheme: drop it, falling back to rexadb-dark if it was active.
    pub fn remove_custom_app_theme(&mut self, id: &str, cx: &mut Context<Self>) {
        self.custom_app_themes.retain(|t| t.id != id);
        if self.app_theme_id == id {
            self.app_theme_id = DEFAULT_DARK_THEME_ID.into();
        }
        self.save_app_theme(cx);
        self.changed("customAppThemes", cx);
    }

    // ---- editor theme -----------------------------------------------------------------

    pub fn custom_editor_themes_json(&self) -> String {
        Value::Array(self.custom_editor_themes.iter().map(|t| t.raw.clone()).collect()).to_string()
    }

    pub fn set_editor_theme(&mut self, id: &str, cx: &mut Context<Self>) {
        self.editor_theme_id = id.to_string();
        self.last_error =
            persist::save_editor_theme(&self.editor_theme_id, &self.custom_editor_themes_json()).err().map(|e| e.to_string());
        self.changed("editorThemeId", cx);
    }

    pub fn set_custom_editor_themes(&mut self, themes: Vec<NamedTheme>, cx: &mut Context<Self>) {
        self.custom_editor_themes = themes;
        self.last_error =
            persist::save_editor_theme(&self.editor_theme_id, &self.custom_editor_themes_json()).err().map(|e| e.to_string());
        self.changed("customEditorThemes", cx);
    }

    pub fn remove_custom_editor_theme(&mut self, id: &str, cx: &mut Context<Self>) {
        let mut next = self.custom_editor_themes.clone();
        next.retain(|t| t.id != id);
        if self.editor_theme_id == id {
            self.editor_theme_id = "auto".into();
        }
        self.set_custom_editor_themes(next, cx);
    }

    // ---- font -------------------------------------------------------------------------

    pub fn set_app_font(&mut self, font: &str, cx: &mut Context<Self>) {
        self.app_font = font.to_string();
        self.last_error = persist::save_app_font(font).err().map(|e| e.to_string());
        apply_app_font(font, cx);
        self.changed("appFontFamily", cx);
    }

    // ---- privacy switches (usePrivacySwitch) ------------------------------------------

    pub fn set_diagnostics(&mut self, v: bool, cx: &mut Context<Self>) {
        persist::write_switch(DIAGNOSTICS_STORAGE_KEY, v);
        self.diagnostics = persist::read_switch(DIAGNOSTICS_STORAGE_KEY, false);
        self.changed(DIAGNOSTICS_STORAGE_KEY, cx);
    }

    pub fn set_auto_update_checks(&mut self, v: bool, cx: &mut Context<Self>) {
        persist::write_switch(AUTO_UPDATE_CHECKS_STORAGE_KEY, v);
        self.auto_update_checks = persist::read_switch(AUTO_UPDATE_CHECKS_STORAGE_KEY, true);
        self.changed(AUTO_UPDATE_CHECKS_STORAGE_KEY, cx);
    }

    /// Re-read everything from disk (after Reset Everything / a migration).
    pub fn reload(&mut self, cx: &mut Context<Self>) {
        *self = Self::load();
        apply_app_theme(&self.app_theme_id, &self.custom_app_themes_json(), cx);
        apply_app_font(&self.app_font, cx);
        self.changed("*", cx);
    }
}

/// resolveFastTableLoading (lib/studio/fast-table-loading.ts): before the
/// default flipped to `true`, a stored `false` was only the old default.
pub fn resolve_fast_table_loading(d: &Map<String, Value>) -> bool {
    if d.get("fastTableLoadingDefaultMigrated") == Some(&Value::Bool(true)) {
        d.get("fastTableLoading") != Some(&Value::Bool(false))
    } else {
        true
    }
}

/// The theme id to render: `system` follows the OS appearance (resolveSystemTheme:
/// dark → rexadb-dark, light → the base light tokens).
pub fn resolve_theme_id(id: &str, appearance: WindowAppearance) -> String {
    if id == "system" {
        match appearance {
            WindowAppearance::Dark | WindowAppearance::VibrantDark => DEFAULT_DARK_THEME_ID.into(),
            _ => "light".into(),
        }
    } else {
        id.to_string()
    }
}

/// useGlobalAppTheme's apply effect: install the resolved tokens app-wide.
pub fn apply_app_theme(id: &str, custom_json: &str, cx: &mut App) {
    let resolved = resolve_theme_id(id, cx.window_appearance());
    rexa_ui::theme::install(rexa_ui::theme::load(Some(&resolved), Some(custom_json)), cx);
    cx.refresh_windows();
}

/// useAppFontFamily: `--app-font-sans` = the custom stack (first family used).
pub fn apply_app_font(font: &str, cx: &mut App) {
    rexa_ui::app_font::set(font, cx);
    cx.refresh_windows();
}

/// Read a studio boolean from the global model, falling back to the default.
pub fn studio_bool(key: &str, cx: &App) -> bool {
    SettingsModel::read(cx).map_or_else(|| studio_default(key).as_bool().unwrap_or(false), |m| m.bool(key))
}

pub fn studio_str(key: &str, cx: &App) -> String {
    SettingsModel::read(cx)
        .map_or_else(|| studio_default(key).as_str().unwrap_or_default().to_string(), |m| m.str(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_fast_table_loading() {
        assert_eq!(studio_default("appZoom"), Value::from(100));
        assert_eq!(studio_default("sqlFormatKeywordCase"), Value::from("upper"));
        let mut m = Map::new();
        m.insert("fastTableLoading".into(), Value::Bool(false));
        assert!(resolve_fast_table_loading(&m));
        m.insert("fastTableLoadingDefaultMigrated".into(), Value::Bool(true));
        assert!(!resolve_fast_table_loading(&m));
        assert!(STUDIO_KEYS.iter().all(|k| !studio_default(k).is_null()));
    }

    #[test]
    fn system_theme_follows_appearance() {
        assert_eq!(resolve_theme_id("system", WindowAppearance::Dark), "rexadb-dark");
        assert_eq!(resolve_theme_id("system", WindowAppearance::Light), "light");
        assert_eq!(resolve_theme_id("void-blue", WindowAppearance::Light), "void-blue");
    }
}
