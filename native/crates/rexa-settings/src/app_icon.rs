//! Port of components/studio/settings/app-icon-setting.tsx + lib/app-icon.ts and
//! the `get_app_icon` / `set_app_icon` / `set_custom_app_icon` commands in
//! src-tauri/src/app_icon.rs: the choice lives in `<app data>/app-icon/selection`
//! (custom image in `custom.png`) and is applied to the Dock with
//! `NSApplication.setApplicationIconImage` on macOS.

use gpui::{div, img, prelude::*, App, Image, ImageFormat, SharedString};
use rexa_ui::{ActiveTokens, Button, IconName, Tw};
use std::path::PathBuf;
use std::sync::Arc;

pub const PRESETS: [(&str, &str); 4] = [("default", "RexaDB"), ("halloween", "Halloween"), ("mummy", "Mummy"), ("skeleton", "Skeleton")];
pub const CUSTOM_ID: &str = "custom";

fn preset_bytes(id: &str) -> Option<&'static [u8]> {
    match id {
        "default" => Some(include_bytes!("../../../../public/app-icons/default.png")),
        "halloween" => Some(include_bytes!("../../../../public/app-icons/halloween.png")),
        "mummy" => Some(include_bytes!("../../../../public/app-icons/mummy.png")),
        "skeleton" => Some(include_bytes!("../../../../public/app-icons/skeleton.png")),
        _ => None,
    }
}

fn icon_dir() -> PathBuf {
    rexa_store::app_data_dir().join("app-icon")
}

/// read_selection: unknown ids or a missing custom image fall back to "default".
pub fn selected() -> String {
    let dir = icon_dir();
    let saved = std::fs::read_to_string(dir.join("selection")).unwrap_or_default();
    let id = saved.trim();
    if (preset_bytes(id).is_some() && id != "default") || (id == CUSTOM_ID && dir.join("custom.png").is_file()) {
        id.to_string()
    } else {
        "default".into()
    }
}

fn custom_bytes() -> Option<Vec<u8>> {
    std::fs::read(icon_dir().join("custom.png")).ok()
}

/// set_app_icon.
pub fn set(id: &str) -> Result<(), String> {
    let dir = icon_dir();
    let known = preset_bytes(id).is_some() || (id == CUSTOM_ID && dir.join("custom.png").is_file());
    if !known {
        return Err(format!("Unknown app icon: {id}"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("selection"), id).map_err(|e| e.to_string())?;
    apply(if id == "default" { None } else if id == CUSTOM_ID { custom_bytes() } else { preset_bytes(id).map(<[u8]>::to_vec) });
    Ok(())
}

/// set_custom_app_icon (the original also crops to a square and adds the
/// macOS tile margin before saving; here the PNG is stored as given).
pub fn set_custom(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("The image is too large.".into());
    }
    let dir = icon_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("custom.png"), bytes).map_err(|e| e.to_string())?;
    set(CUSTOM_ID)
}

/// apply_saved: put the saved icon in place at launch.
pub fn apply_saved() {
    let id = selected();
    if id != "default" {
        apply(if id == CUSTOM_ID { custom_bytes() } else { preset_bytes(&id).map(<[u8]>::to_vec) });
    }
}

#[cfg(target_os = "macos")]
fn apply(bytes: Option<Vec<u8>>) {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    let image = bytes.and_then(|b| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&b)));
    // nil restores the bundle icon.
    unsafe { app.setApplicationIconImage(image.as_deref()) };
}

#[cfg(not(target_os = "macos"))]
fn apply(_bytes: Option<Vec<u8>>) {}

fn tile_image(id: &str) -> Option<Arc<Image>> {
    let bytes = if id == CUSTOM_ID { custom_bytes()? } else { preset_bytes(id)?.to_vec() };
    Some(Arc::new(Image::from_bytes(ImageFormat::Png, bytes)))
}

/// AppIconSetting row: preset tiles (h-10 w-10 rounded-md border-2, active
/// border-primary), the custom tile when one exists, and "+ Custom".
pub fn render_app_icon_setting(highlight: bool, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    let current = selected();
    let has_custom = icon_dir().join("custom.png").is_file();
    let tile = |id: &'static str, label: &'static str| {
        let active = current == id;
        div()
            .id(SharedString::from(format!("app-icon-{id}")))
            .size_10()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .tw_rounded_md()
            .border_2()
            .border_color(if active { t.primary } else { gpui::transparent_black() })
            .when(!active, |d| d.hover(|s| s.border_color(t.border)))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                if let Err(e) = set(id) {
                    rexa_ui::toast::error(format!("Could not change the app icon: {e}"), cx);
                }
                cx.refresh_windows();
            })
            .children(tile_image(id).map(|i| img(i).size_full()))
            .child(div().absolute().invisible().child(label))
    };
    let mut row = div().flex().items_center().gap_1();
    for (id, label) in PRESETS {
        row = row.child(tile(id, label));
    }
    if has_custom {
        row = row.child(tile(CUSTOM_ID, "Custom"));
    }
    row = row.child(div().ml_1().child(Button::new("app-icon-custom").outline().icon(IconName::Plus).label("Custom").on_click(|_, _, cx| {
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn(async move |cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(p) = paths.first() else { return };
            let res = std::fs::read(p).map_err(|e| e.to_string()).and_then(|b| set_custom(&b));
            cx.update(|cx| {
                if let Err(e) = res {
                    rexa_ui::toast::error(format!("Could not use that image: {e}"), cx);
                }
                cx.refresh_windows();
            });
        })
        .detach();
    })));
    crate::rows::setting_row("App Icon", "Changes the icon in the Dock or taskbar while Rexa DB is running.", row, highlight, cx)
}
