use std::path::PathBuf;

/// Same resolution as `get_app_data_dir` in src-tauri: prefer the legacy
/// Electron directory when it exists, otherwise the Tauri app data dir.
pub fn app_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("REXADB_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let legacy = legacy_electron_dir();
    if legacy.as_ref().is_some_and(|dir| dir.exists()) {
        return legacy.unwrap();
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.rexadb")
}

fn legacy_electron_dir() -> Option<PathBuf> {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        dirs::data_dir().map(|d| d.join("rexa-db"))
    } else {
        dirs::config_dir().map(|d| d.join("rexa-db"))
    }
}
