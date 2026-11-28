//! Port of the settings persistence the old app splits across
//! lib/db/file-settings.ts, lib/db/app-admin-actions.ts (sidecar) and the
//! `settings_*` Tauri commands in src-tauri/src/lib.rs:
//!
//! - Global settings (`studio_settings`, `app_theme_id`, `custom_app_themes`,
//!   `editor_theme_id`, `custom_editor_themes`, `app_font_family`) live in
//!   `<desktop settings dir>/settings.json` once the user migrated, otherwise in
//!   `sqlite.db` → `app_settings`. Reads try the file first; writes go to the
//!   file only when it already exists (same rule as `update_desktop_settings`).
//! - Values the old app kept in browser `localStorage` (privacy switches,
//!   onboarding flag, dismissed update, …) are read once from the WebKit store
//!   and from then on kept in `app_settings` under the same key (PORTING.md).
//! - Keybindings live in `<app data>/keybindings.json` (settings_get_keybindings).

use anyhow::Result;
use rexa_store::Store;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

pub const STUDIO_SETTINGS_KEY: &str = "studio_settings";
pub const APP_THEME_ID_KEY: &str = "app_theme_id";
pub const CUSTOM_APP_THEMES_KEY: &str = "custom_app_themes";
pub const EDITOR_THEME_ID_KEY: &str = "editor_theme_id";
pub const CUSTOM_EDITOR_THEMES_KEY: &str = "custom_editor_themes";
pub const APP_FONT_FAMILY_KEY: &str = "app_font_family";

/// The keys a settings.json migration moves (settings-migration.ts SETTINGS_KEYS).
pub const MIGRATED_KEYS: [&str; 6] = [
    STUDIO_SETTINGS_KEY,
    APP_THEME_ID_KEY,
    CUSTOM_APP_THEMES_KEY,
    EDITOR_THEME_ID_KEY,
    CUSTOM_EDITOR_THEMES_KEY,
    APP_FONT_FAMILY_KEY,
];

static FILE_LOCK: Mutex<()> = Mutex::new(());

/// `get_desktop_settings_dir` / file-settings.ts `getAppDataDirSync`:
/// `~/Library/Application Support/Rexa DB` on macOS, `%APPDATA%\Rexa DB` on
/// Windows, `$XDG_CONFIG_HOME/Rexa DB` elsewhere. With `REXADB_DATA_DIR` set
/// (tests / dev against a copied database) it is `<that dir>/Rexa DB`, so a
/// copied database never touches the real settings file.
pub fn desktop_settings_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("REXADB_DATA_DIR") {
        return PathBuf::from(dir).join("Rexa DB");
    }
    if cfg!(target_os = "linux") {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("Rexa DB")
    } else {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("Rexa DB")
    }
}

pub fn settings_file_path() -> PathBuf {
    desktop_settings_dir().join("settings.json")
}

pub fn settings_file_exists() -> bool {
    settings_file_path().exists()
}

/// readSettingsJson: the parsed object, or None if missing / not an object.
pub fn read_settings_file() -> Option<Map<String, Value>> {
    let text = std::fs::read_to_string(settings_file_path()).ok()?;
    match serde_json::from_str::<Value>(&text).ok()? {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

/// writeSettingsJson: pretty JSON via temp file + rename.
pub fn write_settings_file(data: &Map<String, Value>) -> Result<()> {
    let dir = desktop_settings_dir();
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(data)?)?;
    std::fs::rename(&tmp, dir.join("settings.json"))?;
    Ok(())
}

/// `update_desktop_settings`: read-modify-write, a no-op returning false when
/// the file does not exist yet (callers then fall back to SQLite).
pub fn update_settings_file(mutate: impl FnOnce(&mut Map<String, Value>)) -> Result<bool> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(mut current) = read_settings_file() else { return Ok(false) };
    mutate(&mut current);
    current.insert("_version".into(), Value::from(1));
    write_settings_file(&current)?;
    Ok(true)
}

fn store() -> Result<Store> {
    Store::open()
}

// ---- studio settings ---------------------------------------------------------------

/// getGlobalStudioSettings: file `studio_settings`, then `app_settings.studio_settings`.
pub fn load_studio_settings() -> Map<String, Value> {
    if let Some(Value::Object(m)) = read_settings_file().and_then(|mut f| f.remove(STUDIO_SETTINGS_KEY)) {
        return m;
    }
    store()
        .ok()
        .and_then(|s| s.setting(STUDIO_SETTINGS_KEY).ok().flatten())
        .and_then(|v| serde_json::from_str::<Value>(v.trim()).ok())
        .and_then(|v| match v {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .unwrap_or_default()
}

/// saveGlobalStudioSettings (replace semantics).
pub fn save_studio_settings(settings: &Map<String, Value>) -> Result<()> {
    let value = Value::Object(settings.clone());
    if update_settings_file(|f| {
        f.insert(STUDIO_SETTINGS_KEY.into(), value.clone());
    })? {
        return Ok(());
    }
    store()?.set_setting(STUDIO_SETTINGS_KEY, &serde_json::to_string(&value)?)
}

// ---- app / editor theme ------------------------------------------------------------

fn file_or_sqlite_string(key: &str) -> Option<String> {
    if let Some(f) = read_settings_file() {
        if let Some(v) = f.get(key).and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
    }
    store().ok()?.setting(key).ok().flatten()
}

fn save_pair(a: (&str, String), b: (&str, String)) -> Result<()> {
    if update_settings_file(|f| {
        f.insert(a.0.into(), Value::from(a.1.clone()));
        f.insert(b.0.into(), Value::from(b.1.clone()));
    })? {
        return Ok(());
    }
    let s = store()?;
    s.set_setting(a.0, &a.1)?;
    s.set_setting(b.0, &b.1)
}

/// getGlobalAppThemeSettings → (appThemeId, customAppThemes JSON).
pub fn load_app_theme() -> (String, String) {
    let id = file_or_sqlite_string(APP_THEME_ID_KEY).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "rexadb-dark".into());
    let custom = file_or_sqlite_string(CUSTOM_APP_THEMES_KEY).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "[]".into());
    (id, custom)
}

/// saveGlobalAppThemeSettings / settings_save_app_theme.
pub fn save_app_theme(id: &str, custom_json: &str) -> Result<()> {
    let id = if id.trim().is_empty() { "zinc-dark-white".to_string() } else { id.trim().to_string() };
    let custom = if custom_json.trim().is_empty() { "[]".to_string() } else { custom_json.trim().to_string() };
    save_pair((APP_THEME_ID_KEY, id), (CUSTOM_APP_THEMES_KEY, custom))
}

/// getGlobalEditorThemeSettings → (editorThemeId, customEditorThemes JSON).
pub fn load_editor_theme() -> (String, String) {
    let id = file_or_sqlite_string(EDITOR_THEME_ID_KEY).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "auto".into());
    let custom = file_or_sqlite_string(CUSTOM_EDITOR_THEMES_KEY).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "[]".into());
    (id, custom)
}

pub fn save_editor_theme(id: &str, custom_json: &str) -> Result<()> {
    let id = if id.trim().is_empty() { "auto".to_string() } else { id.trim().to_string() };
    let custom = if custom_json.trim().is_empty() { "[]".to_string() } else { custom_json.trim().to_string() };
    save_pair((EDITOR_THEME_ID_KEY, id), (CUSTOM_EDITOR_THEMES_KEY, custom))
}

// ---- app font ----------------------------------------------------------------------

/// getAppFontFamily (file, then `app_settings`; the legacy
/// `connection_settings.custom_font_family` column is not consulted).
pub fn load_app_font() -> String {
    file_or_sqlite_string(APP_FONT_FAMILY_KEY).map(|s| s.trim().to_string()).unwrap_or_default()
}

/// saveAppFontFamily: empty deletes the key.
pub fn save_app_font(font: &str) -> Result<()> {
    let normalized = font.trim().to_string();
    if update_settings_file(|f| {
        if normalized.is_empty() {
            f.remove(APP_FONT_FAMILY_KEY);
        } else {
            f.insert(APP_FONT_FAMILY_KEY.into(), Value::from(normalized.clone()));
        }
    })? {
        return Ok(());
    }
    let s = store()?;
    if normalized.is_empty() {
        s.delete_setting(APP_FONT_FAMILY_KEY)
    } else {
        s.set_setting(APP_FONT_FAMILY_KEY, &normalized)
    }
}

// ---- localStorage-backed values ----------------------------------------------------

/// A value the old app kept in `localStorage`: `app_settings[key]`, else the
/// WebKit store (copied into `app_settings` on first read).
pub fn local_get(key: &str) -> Option<String> {
    let s = store().ok();
    if let Some(v) = s.as_ref().and_then(|s| s.setting(key).ok().flatten()) {
        return Some(v);
    }
    let v = rexa_store::WebStore::open()?.get(key).ok().flatten()?;
    if let Some(s) = s {
        s.set_setting(key, &v).ok();
    }
    Some(v)
}

pub fn local_set(key: &str, value: &str) -> Result<()> {
    store()?.set_setting(key, value)
}

pub fn local_remove(key: &str) -> Result<()> {
    store()?.delete_setting(key)
}

/// readPrivacySwitch: JSON `true`/`false`; unreadable counts as off.
pub fn read_switch(key: &str, fallback: bool) -> bool {
    match local_get(key) {
        None => fallback,
        Some(raw) => serde_json::from_str::<Value>(&raw).map(|v| v == Value::Bool(true)).unwrap_or(false),
    }
}

pub fn write_switch(key: &str, value: bool) {
    local_set(key, if value { "true" } else { "false" }).ok();
}

// ---- keybindings -------------------------------------------------------------------

pub fn keybindings_path() -> PathBuf {
    rexa_store::app_data_dir().join("keybindings.json")
}

pub fn load_keybindings_file() -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(keybindings_path()).ok()?).ok()
}

/// saveKeybindingsFile: pretty JSON.
pub fn save_keybindings_file(value: &Value) -> Result<()> {
    let path = keybindings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

// ---- settings.json migration (settings-migration.ts) -------------------------------

/// isMigrationNeeded: no settings.json yet and `app_settings` holds any migrated key.
pub fn is_migration_needed() -> bool {
    if settings_file_exists() {
        return false;
    }
    let Ok(s) = store() else { return false };
    MIGRATED_KEYS.iter().any(|k| s.setting(k).ok().flatten().is_some())
}

/// migrateSettingsFromSqlite: build and write settings.json, then read it back.
pub fn migrate_settings_to_file() -> Result<()> {
    let s = store()?;
    let mut data = Map::new();
    data.insert("_version".into(), Value::from(1));
    data.insert("_migrated".into(), Value::Bool(true));
    for key in MIGRATED_KEYS {
        let Some(value) = s.setting(key)? else { continue };
        if key == STUDIO_SETTINGS_KEY {
            if value.trim().is_empty() {
                continue;
            }
            data.insert(key.into(), serde_json::from_str(&value).unwrap_or(Value::Object(Map::new())));
        } else if !value.is_empty() {
            data.insert(key.into(), Value::from(value));
        }
    }
    write_settings_file(&data)?;
    read_settings_file().ok_or_else(|| anyhow::anyhow!("Migrated file could not be read back. Settings remain in SQLite."))?;
    Ok(())
}

/// clearMigratedSqliteSettings.
pub fn clear_migrated_sqlite_settings() -> Result<()> {
    let s = store()?;
    for key in MIGRATED_KEYS {
        s.delete_setting(key)?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Point REXADB_DATA_DIR at a fresh temp dir with an empty app DB.
    pub fn temp_env() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rexa-settings-test-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("REXADB_DATA_DIR", &dir);
        let db = rusqlite::Connection::open(dir.join("sqlite.db")).unwrap();
        db.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT, updated_at INTEGER NOT NULL)", []).unwrap();
        dir
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    pub static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn sqlite_then_file_round_trip() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _dir = temp_env();
        assert!(load_studio_settings().is_empty());
        let mut m = Map::new();
        m.insert("appZoom".into(), Value::from(120));
        save_studio_settings(&m).unwrap();
        assert_eq!(load_studio_settings().get("appZoom"), Some(&Value::from(120)));
        save_app_theme("light", "").unwrap();
        assert_eq!(load_app_theme(), ("light".to_string(), "[]".to_string()));
        save_app_font("  Inter ").unwrap();
        assert_eq!(load_app_font(), "Inter");
        save_app_font("").unwrap();
        assert_eq!(load_app_font(), "");

        assert!(is_migration_needed());
        migrate_settings_to_file().unwrap();
        clear_migrated_sqlite_settings().unwrap();
        assert!(!is_migration_needed());
        assert_eq!(load_studio_settings().get("appZoom"), Some(&Value::from(120)));
        // Writes now go to the file.
        m.insert("appZoom".into(), Value::from(90));
        save_studio_settings(&m).unwrap();
        assert_eq!(read_settings_file().unwrap()["studio_settings"]["appZoom"], Value::from(90));
        assert_eq!(load_app_theme().0, "light");
    }

    #[test]
    fn switches_default_and_parse() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _dir = temp_env();
        assert!(!read_switch("rexa-db-diagnostics-enabled-test", false));
        write_switch("rexa-db-diagnostics-enabled-test", true);
        assert!(read_switch("rexa-db-diagnostics-enabled-test", false));
    }
}
