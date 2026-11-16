//! RexaDB's design system for GPUI: the old app's theme tokens and
//! pixel-matched ports of components/ui/*. Feature crates build screens only
//! from these (plus raw `div()` styled with tokens), never from
//! gpui-component directly, so the look stays consistent and fixable in one place.

pub mod assets;
pub mod badge;
pub mod button;
pub mod calendar;
pub mod command;
pub mod controls;
pub mod disclosure;
pub mod display;
pub mod gallery;
pub mod images;
pub mod input;
pub mod kbd;
pub mod menu;
pub mod overlays;
pub mod popover;
pub mod popup;
pub mod select;
pub mod scroll_area;
pub mod separator;
pub mod sidebar;
pub mod theme;
pub mod toast;
pub mod tooltip;
pub mod tracked_text;
pub mod tw;
pub mod user_avatar_dropdown;

pub use badge::{Badge, BadgeVariant};
pub use button::{Button, ButtonSize, ButtonVariant};
pub use controls::{
    input_group_button, input_group_text, square_check, AddonAlign, Checkbox, InputGroup, Label, PasswordInput, Switch,
    TextArea,
};
pub use gpui_kit_assets::IconName;
pub use input::TextInput;
pub use kbd::Kbd;
pub use menu::{ContextMenu, DropdownMenu, Menu, MenuItem, MenuStyle};
pub use overlays::{
    close_all_overlays, close_overlay, close_top, confirm, open_alert_dialog, open_dialog, open_sheet,
    AlertDialog, AlertDialogSize, ConfirmOptions, Dialog, OverlayId, Sheet,
};
pub use popup::{Align, Side};
pub use popover::{Popover, PopoverCtl};
pub use calendar::{Calendar, Date};
pub use command::{open_command_dialog, open_command_dialog_with, Command, CommandGroup, CommandItem, CommandSearchBar};
pub use disclosure::{tabs_content, Accordion, Collapsible, Tabs};
pub use scroll_area::ScrollArea;
pub use select::{Combobox, MultiSelect, Select, SelectEntry, SelectOption};
pub use display::{
    avatar_group, skeleton, Alert, Avatar, AvatarSize, Card, FallbackAvatar, Progress, Spinner, Table,
};
pub use toast::{Toast, ToastKind};
pub use tooltip::Tooltip;
pub use separator::Separator;
pub use theme::{parse_color, tw, white, with_alpha, ActiveTokens, Tokens, MONO, SANS};
pub use tracked_text::{tight, TrackedText};
pub use tw::Tw;
pub use user_avatar_dropdown::UserAvatarDropdown;
pub use sidebar::{SidebarButtonSize, SidebarMenuButton, Sidebar, SidebarVariant};

/// Legacy gpui-component re-exports, kept so existing code keeps compiling.
/// New code should use the pixel-exact ports at the crate root instead:
/// `DropdownMenu`/`ContextMenu`/`Menu` (menus), `open_dialog`/`open_alert_dialog`/
/// `open_sheet`/`confirm` (dialogs), `Toast` (notifications), `Popover`,
/// `Select`/`Combobox`/`MultiSelect`, `Tooltip`, `Switch`, `Checkbox`, `Tabs`,
/// `TextArea`, `InputGroup`, `ScrollArea` … (see `screen:ui-gallery`).
/// The new modules are also reachable under these paths as `overlay::rexa`.
pub mod overlay {
    pub use gpui_component::dialog;
    pub use gpui_component::menu;
    pub use gpui_component::notification;
    pub use gpui_component::popover;
    pub use gpui_component::select;
    pub use gpui_component::tooltip;
    pub use gpui_component::WindowExt;
    /// The rexa-ui ports of the same overlays.
    pub mod rexa {
        pub use crate::command::*;
        pub use crate::menu::*;
        pub use crate::overlays::*;
        pub use crate::popover::*;
        pub use crate::select::*;
        pub use crate::toast::{self, Toast, ToastKind};
        pub use crate::tooltip::*;
    }
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
    // Registered after gpui-component so our modal layer / toaster draw above its layers.
    gpui_base::Root::register_plugin::<overlays::OverlayLayer>(cx, overlays::OverlayLayer::new);
    rexa_core::Registry::screen(cx, "rexa-ui", |route, window, cx| match route {
        rexa_core::Route::ConnectionScreen(s) if s == "ui-gallery" => {
            use gpui::AppContext;
            Some(cx.new(|cx| gallery::Gallery::new(window, cx)).into())
        }
        _ => None,
    });
}
