//! The user's choice of app icon.
//!
//! The choice lives in the app data dir rather than in the frontend settings
//! because it has to apply at launch, before any webview exists, and because
//! it belongs to this machine, so it stays out of settings sync.
//!
//! This swaps the running app's icon only. The bundle stays untouched, since
//! changing a signed `.app` would break its signature and the updater.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::image::Image;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Webview};

const DEFAULT_ID: &str = "default";
const CUSTOM_ID: &str = "custom";
const SELECTION_FILE: &str = "selection";
const CUSTOM_FILE: &str = "custom.png";
const MAX_CUSTOM_BYTES: usize = 16 * 1024 * 1024;

fn preset_bytes(id: &str) -> Option<&'static [u8]> {
    match id {
        "halloween" => Some(include_bytes!("../icons/app-icons/halloween.png")),
        "mummy" => Some(include_bytes!("../icons/app-icons/mummy.png")),
        "skeleton" => Some(include_bytes!("../icons/app-icons/skeleton.png")),
        _ => None,
    }
}

fn icon_dir(app: &AppHandle) -> PathBuf {
    crate::get_app_data_dir(app).join("app-icon")
}

/// The saved choice. Anything unknown, or a custom choice whose image is gone,
/// falls back to the default icon.
fn read_selection(dir: &Path) -> String {
    let saved = fs::read_to_string(dir.join(SELECTION_FILE)).unwrap_or_default();
    let id = saved.trim();
    let usable = preset_bytes(id).is_some() || (id == CUSTOM_ID && dir.join(CUSTOM_FILE).is_file());
    if usable { id.to_string() } else { DEFAULT_ID.to_string() }
}

fn write_selection(dir: &Path, id: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(SELECTION_FILE), id).map_err(|e| e.to_string())
}

/// PNG bytes for a choice. `None` means the app's own icon.
fn icon_bytes(dir: &Path, id: &str) -> Option<Vec<u8>> {
    if id == CUSTOM_ID {
        return fs::read(dir.join(CUSTOM_FILE)).ok();
    }
    preset_bytes(id).map(<[u8]>::to_vec)
}

#[cfg(target_os = "macos")]
fn apply(app: &AppHandle, bytes: Option<Vec<u8>>) {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let _ = app.run_on_main_thread(move || {
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let ns_app = NSApplication::sharedApplication(main_thread);
        let image = bytes.and_then(|bytes| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&bytes)));
        // Passing nil restores the icon from the bundle.
        unsafe { ns_app.setApplicationIconImage(image.as_deref()) };
    });
}

#[cfg(not(target_os = "macos"))]
fn window_icon(app: &AppHandle, bytes: Option<&[u8]>) -> Option<Image<'static>> {
    match bytes {
        Some(bytes) => Image::from_bytes(bytes).ok().map(|image| image.to_owned()),
        None => app.default_window_icon().map(|image| image.clone().to_owned()),
    }
}

#[cfg(not(target_os = "macos"))]
fn apply(app: &AppHandle, bytes: Option<Vec<u8>>) {
    use tauri::Manager;

    let Some(icon) = window_icon(app, bytes.as_deref()) else {
        return;
    };
    for window in app.webview_windows().values() {
        let _ = window.set_icon(icon.clone());
    }
}

/// Puts the saved icon in place at launch.
pub fn apply_saved(app: &AppHandle) {
    let dir = icon_dir(app);
    let id = read_selection(&dir);
    if id != DEFAULT_ID {
        apply(app, icon_bytes(&dir, &id));
    }
}

/// Windows and Linux icons are per window, so windows opened later need the
/// choice too. macOS has a single app icon and needs nothing here.
#[cfg(not(target_os = "macos"))]
pub fn apply_to_new_window(webview: &Webview) {
    use tauri::Manager;

    let app = webview.app_handle();
    let dir = icon_dir(app);
    let id = read_selection(&dir);
    if id == DEFAULT_ID {
        return;
    }
    if let Some(icon) = window_icon(app, icon_bytes(&dir, &id).as_deref()) {
        let _ = webview.window().set_icon(icon);
    }
}

#[cfg(target_os = "macos")]
pub fn apply_to_new_window(_webview: &Webview) {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconState {
    selected: String,
    has_custom: bool,
}

#[tauri::command]
pub fn get_app_icon(app: AppHandle) -> AppIconState {
    let dir = icon_dir(&app);
    AppIconState {
        selected: read_selection(&dir),
        has_custom: dir.join(CUSTOM_FILE).is_file(),
    }
}

#[tauri::command]
pub fn set_app_icon(app: AppHandle, id: String) -> Result<(), String> {
    let dir = icon_dir(&app);
    let known = id == DEFAULT_ID
        || preset_bytes(&id).is_some()
        || (id == CUSTOM_ID && dir.join(CUSTOM_FILE).is_file());
    if !known {
        return Err(format!("Unknown app icon: {id}"));
    }
    write_selection(&dir, &id)?;
    apply(&app, icon_bytes(&dir, &id));
    Ok(())
}

#[tauri::command]
pub fn get_custom_app_icon(app: AppHandle) -> Result<Response, String> {
    fs::read(icon_dir(&app).join(CUSTOM_FILE))
        .map(Response::new)
        .map_err(|e| e.to_string())
}

fn validate_custom_icon(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_CUSTOM_BYTES {
        return Err("That image is too large.".to_string());
    }
    Image::from_bytes(bytes)
        .map(|_| ())
        .map_err(|_| "That image could not be read as a PNG.".to_string())
}

/// Takes the PNG as a raw request body, which spares a megabyte of JSON.
#[tauri::command]
pub fn set_custom_app_icon(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw image bytes.".to_string());
    };
    validate_custom_icon(bytes)?;
    let dir = icon_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(CUSTOM_FILE), bytes).map_err(|e| e.to_string())?;
    write_selection(&dir, CUSTOM_ID)?;
    apply(&app, Some(bytes.clone()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rexadb-app-icon-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn selection_defaults_when_missing_or_unknown() {
        let dir = temp_dir("unknown");
        assert_eq!(read_selection(&dir), DEFAULT_ID);
        write_selection(&dir, "../../etc/passwd").unwrap();
        assert_eq!(read_selection(&dir), DEFAULT_ID);
    }

    #[test]
    fn selection_keeps_presets() {
        let dir = temp_dir("preset");
        write_selection(&dir, "mummy").unwrap();
        assert_eq!(read_selection(&dir), "mummy");
    }

    #[test]
    fn custom_selection_needs_its_image() {
        let dir = temp_dir("custom");
        write_selection(&dir, CUSTOM_ID).unwrap();
        assert_eq!(read_selection(&dir), DEFAULT_ID);
        fs::write(dir.join(CUSTOM_FILE), b"png").unwrap();
        assert_eq!(read_selection(&dir), CUSTOM_ID);
    }

    #[test]
    fn presets_are_valid_pngs() {
        for id in ["halloween", "mummy", "skeleton"] {
            validate_custom_icon(preset_bytes(id).unwrap()).unwrap();
        }
    }

    #[test]
    fn rejects_bytes_that_are_not_a_png() {
        assert!(validate_custom_icon(b"not an image").is_err());
    }
}
