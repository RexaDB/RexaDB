//! RexaDB's design system for GPUI: the old app's theme tokens and
//! pixel-matched ports of components/ui/*. Feature crates build screens only
//! from these (plus raw `div()` styled with tokens), never from
//! gpui-component directly, so the look stays consistent and fixable in one place.

pub mod assets;
pub mod badge;
pub mod button;
pub mod images;
pub mod input;
pub mod kbd;
pub mod separator;
pub mod theme;
pub mod tracked_text;
pub mod tw;

pub use badge::{Badge, BadgeVariant};
pub use button::{Button, ButtonSize, ButtonVariant};
pub use gpui_kit_assets::IconName;
pub use input::TextInput;
pub use kbd::Kbd;
pub use separator::Separator;
pub use theme::{parse_color, tw, white, with_alpha, ActiveTokens, Tokens, MONO, SANS};
pub use tracked_text::{tight, TrackedText};
pub use tw::Tw;

/// Overlay widgets not yet re-implemented pixel-exact. Use them through these
/// paths so swapping in a custom implementation later is a one-place change.
/// Their colors already follow the tokens via `theme::install`.
pub mod overlay {
    pub use gpui_component::dialog;
    pub use gpui_component::menu;
    pub use gpui_component::notification;
    pub use gpui_component::popover;
    pub use gpui_component::select;
    pub use gpui_component::tooltip;
    pub use gpui_component::WindowExt;
}

pub mod widgets {
    pub use gpui_component::checkbox::Checkbox;
    pub use gpui_component::input::{Editor, EditorState, Input, InputEvent, InputState};
    pub use gpui_component::resizable;
    pub use gpui_component::switch::Switch;
    pub use gpui_component::tab;
    pub use gpui_component::table;
    pub use gpui_component::{h_flex, v_flex, Icon, Sizable, Size};
}

/// Call once at startup (after `gpui_component::init`).
pub fn init(cx: &mut gpui::App) {
    gpui_component::init(cx);
}
