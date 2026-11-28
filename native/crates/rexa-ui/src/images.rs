use base64::{engine::general_purpose::STANDARD, Engine};
use gpui::{Image, ImageFormat};
use std::sync::Arc;

/// Decode a `data:image/...;base64,...` URL (custom connection icons, the user avatar).
pub fn from_data_url(url: &str) -> Option<Arc<Image>> {
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    if !meta.ends_with(";base64") {
        return None;
    }
    let format = match meta.trim_end_matches(";base64") {
        "image/png" => ImageFormat::Png,
        "image/jpeg" | "image/jpg" => ImageFormat::Jpeg,
        "image/gif" => ImageFormat::Gif,
        "image/webp" => ImageFormat::Webp,
        "image/svg+xml" => ImageFormat::Svg,
        "image/bmp" => ImageFormat::Bmp,
        _ => return None,
    };
    let bytes = STANDARD.decode(data.trim()).ok()?;
    Some(Arc::new(Image::from_bytes(format, bytes)))
}
