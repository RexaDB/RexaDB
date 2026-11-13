//! Asset source: the app's own files (provider logos, …) embedded from
//! native/assets, falling back to the complete Lucide catalog that the old
//! app's icon set (lucide-react) is drawn from.

use gpui::{AssetSource, SharedString};
use std::borrow::Cow;

#[derive(rust_embed::RustEmbed)]
#[folder = "../../assets"]
#[include = "providers/*"]
#[include = "brand/*"]
#[include = "sonner/*"]
#[include = "ui/*"]
struct Embedded;

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        if let Some(file) = Embedded::get(path) {
            return Ok(Some(file.data));
        }
        gpui_kit_assets::AllAssets.load(path)
    }

    fn list(&self, path: &str) -> anyhow::Result<Vec<SharedString>> {
        let mut out: Vec<SharedString> = Embedded::iter()
            .filter(|p| p.starts_with(path))
            .map(|p| p.into_owned().into())
            .collect();
        out.extend(gpui_kit_assets::AllAssets.list(path)?);
        Ok(out)
    }
}
