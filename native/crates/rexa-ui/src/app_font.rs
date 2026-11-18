//! The user's custom app font (Settings → General → Custom Font Family,
//! hooks/use-app-font-family.ts). The old app sets `--app-font-sans` to the
//! typed CSS font stack; GPUI takes one family name, so the first family of the
//! stack is used (quotes stripped). Generic CSS names fall back to [`SANS`].

use crate::theme::SANS;
use gpui::{App, Global, SharedString};

#[derive(Default)]
struct AppFont(Option<SharedString>);
impl Global for AppFont {}

/// First concrete family of a CSS font stack, or None for empty / generic-only stacks.
pub fn first_family(stack: &str) -> Option<String> {
    stack
        .split(',')
        .map(|f| f.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_string())
        .find(|f| !f.is_empty() && !matches!(f.as_str(), "sans-serif" | "serif" | "monospace" | "system-ui" | "-apple-system" | "ui-sans-serif" | "inherit"))
}

/// Set (or clear with "") the custom font; also points gpui-component's theme at it.
pub fn set(stack: &str, cx: &mut App) {
    let family = first_family(stack).map(SharedString::from);
    let effective = family.clone().unwrap_or_else(|| SANS.into());
    gpui_component::theme::Theme::global_mut(cx).font_family = effective;
    cx.set_global(AppFont(family));
}

/// The family to render UI text in: the custom font, else [`SANS`].
pub fn family(cx: &App) -> SharedString {
    cx.try_global::<AppFont>().and_then(|f| f.0.clone()).unwrap_or_else(|| SANS.into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn picks_first_family() {
        assert_eq!(super::first_family(r#""IBM Plex Sans", "Segoe UI", sans-serif"#).as_deref(), Some("IBM Plex Sans"));
        assert_eq!(super::first_family("sans-serif"), None);
        assert_eq!(super::first_family("  "), None);
    }
}
