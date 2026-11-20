//! The connections-home settings dialog (connection-manager.tsx,
//! `connectionScreen === "settings"`): `DialogContent h-[80vh] w-[80vw] p-0`
//! over `bg-black/40`, hosting AppSettingsView. Closing returns to the list.

use crate::view::SettingsView;
use gpui::{div, prelude::*, AppContext, Context, Entity, FocusHandle, Window};
use rexa_ui::{ActiveTokens, Tw};

pub struct SettingsScreen {
    view: Entity<SettingsView>,
    focus: FocusHandle,
}

impl SettingsScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let section = std::env::var("REXA_SETTINGS_SECTION").unwrap_or_else(|_| "general".into());
        let view = cx.new(|cx| SettingsView::new(&section, window, cx));
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self { view, focus }
    }
}

fn close(cx: &mut gpui::App) {
    rexa_core::navigate(rexa_core::Route::Connections, cx);
}

impl Render for SettingsScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let size = window.viewport_size();
        div()
            .id("settings-screen")
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .bg(t.studio_bg)
            .on_key_down(|e: &gpui::KeyDownEvent, _, cx| {
                if e.keystroke.key == "escape" && !rexa_ui::overlays::has_open_overlay(cx) {
                    close(cx);
                }
            })
            .child(
                div()
                    .id("settings-overlay")
                    .absolute()
                    .inset_0()
                    .bg(gpui::hsla(0., 0., 0., 0.4))
                    .flex()
                    .items_center()
                    .justify_center()
                    .on_click(|_, _, cx| close(cx))
                    .child(
                        div()
                            .id("settings-dialog")
                            .w(size.width * 0.8)
                            .h(size.height * 0.8)
                            .flex()
                            .overflow_hidden()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(t.border)
                            .bg(t.background)
                            .shadow_lg()
                            // Clicks inside the dialog must not reach the overlay.
                            .on_click(|_, _, cx| cx.stop_propagation())
                            .child(self.view.clone()),
                    ),
            )
    }
}
