//! Port of components/studio/settings/danger-zone-setting.tsx: "Reset
//! Everything" with the typed RESET confirmation. Steps run in order with no
//! rollback; any failure stops before local caches are wiped.

use crate::model::SettingsModel;
use gpui::{div, prelude::*, px, App, AppContext, Entity, Focusable, FontWeight, Window};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::Icon;
use rexa_ui::{close_top, open_dialog, with_alpha, ActiveTokens, Button, ButtonSize, Dialog, IconName, TextInput, Tw};
use serde_json::{Map, Value};

pub const CONFIRM_PHRASE: &str = "RESET";

/// Run every reset step; returns the failed step labels.
pub fn reset_everything() -> Vec<String> {
    let mut failures = Vec::new();
    let mut step = |label: &str, r: anyhow::Result<()>| {
        if let Err(e) = r {
            failures.push(format!("{label}: {e}"));
        }
    };
    // 1. Global preferences back to factory defaults (replace semantics).
    step("App preferences", crate::persist::save_studio_settings(&Map::new()));
    step("App theme", crate::persist::save_app_theme("rexadb-dark", "[]"));
    step("Editor theme", crate::persist::save_editor_theme("auto", "[]"));
    step("App font", crate::persist::save_app_font(""));
    step("Keybindings", crate::persist::save_keybindings_file(&Value::Object(crate::keybindings::defaults())));
    step("AI providers", crate::ai::save_settings(&crate::ai::normalize(&Value::Null)));
    step("App icon", crate::app_icon::set("default").map_err(anyhow::Error::msg));
    // 2. Per-connection workspace content (connections themselves stay).
    match rexa_store::Store::open().and_then(|s| Ok((s.connections()?, s))) {
        Err(e) => failures.push(format!("Load connections: {e}")),
        Ok((conns, store)) => {
            for c in conns {
                for (label, err) in store.clear_connection_workspace(c.id) {
                    failures.push(format!("{label} ({}): {err}", c.name));
                }
            }
        }
    }
    if !failures.is_empty() {
        return failures;
    }
    // 3. Workspace session + local caches: the `rexa-db-*` / `theme`
    // localStorage keys the native app migrated into app_settings.
    crate::workspace::forget_all();
    if let Ok(s) = rexa_store::Store::open() {
        for key in s.setting_keys().unwrap_or_default() {
            if key.starts_with("rexa-db-") || key == "theme" {
                s.delete_setting(&key).ok();
            }
        }
    }
    failures
}

struct DangerState {
    input: Entity<InputState>,
    resetting: bool,
}

fn open_reset_dialog(window: &mut Window, cx: &mut App) {
    let input = cx.new(|cx| InputState::new(window, cx).placeholder(CONFIRM_PHRASE));
    let state = cx.new(|_| DangerState { input: input.clone(), resetting: false });
    cx.subscribe(&input, |_, ev: &InputEvent, cx| {
        if matches!(ev, InputEvent::Change) {
            cx.refresh_windows();
        }
    })
    .detach();
    let fh = input.read(cx).focus_handle(cx);
    window.focus(&fh, cx);
    open_dialog(cx, move |_, cx| {
        let t = cx.tokens().clone();
        let st = state.read(cx);
        let confirmed = st.input.read(cx).value().trim().to_uppercase() == CONFIRM_PHRASE;
        let resetting = st.resetting;
        let input = st.input.clone();
        let state2 = state.clone();
        let bullet = |s: &'static str| div().flex().gap_2().child("\u{2022}").child(s);
        Dialog::new()
            .max_w(448.)
            .title("Reset everything?")
            .description("This will reset all settings to their defaults:")
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .pl_2()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(bullet("Appearance, editor, grid, tab, and behavior preferences"))
                    .child(bullet("Custom app, editor, and icon themes"))
                    .child(bullet("App icon"))
                    .child(bullet("Keybindings and AI provider settings (including API keys)"))
                    .child(bullet("Per-connection content: open tabs, dashboards, notes, snippets, folders, query history, and search index"))
                    .child(bullet("Local caches in this browser"))
                    .child(bullet("Workspace connection (you will be signed out of it)")),
            )
            .child(
                div()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child("Saved database connections are kept. Steps apply in order with no rollback: if a step fails, the reset stops and earlier steps may already be applied \u{2014} fix the issue and run it again to finish. This cannot be undone. Type ")
                    .child(div().font_family(rexa_ui::MONO).font_weight(FontWeight::SEMIBOLD).text_color(t.foreground).child(CONFIRM_PHRASE))
                    .child(" to confirm."),
            )
            .child(TextInput::new(&input))
            .footer(Button::new("reset-cancel").outline().size(ButtonSize::Sm).label("Cancel").disabled(resetting).on_click(|_, _, cx| close_top(cx)))
            .footer(
                Button::new("reset-go")
                    .destructive()
                    .size(ButtonSize::Sm)
                    .label(if resetting { "Resetting\u{2026}" } else { "Reset Everything" })
                    .disabled(!confirmed || resetting)
                    .on_click(move |_, _, cx| run_reset(state2.clone(), cx)),
            )
    });
}

fn run_reset(state: Entity<DangerState>, cx: &mut App) {
    state.update(cx, |s, _| s.resetting = true);
    cx.refresh_windows();
    let task = cx.background_executor().spawn(async move { reset_everything() });
    cx.spawn(async move |cx| {
        let failures = task.await;
        cx.update(|cx| {
            if failures.is_empty() {
                rexa_ui::toast::success("Everything reset. Reloading with fresh defaults\u{2026}", cx);
                close_top(cx);
                let model = SettingsModel::global(cx);
                model.update(cx, |m, cx| m.reload(cx));
            } else {
                let n = failures.len();
                rexa_ui::Toast::error(format!(
                    "Reset stopped partway \u{2014} some data was already cleared and {n} step{} failed. Fix the issue and run it again to finish.",
                    if n == 1 { "" } else { "s" }
                ))
                .description(failures.iter().take(3).cloned().collect::<Vec<_>>().join("\n"))
                .show(cx);
                state.update(cx, |s, _| s.resetting = false);
            }
            cx.refresh_windows();
        });
    })
    .detach();
}

/// The Danger Zone card.
pub fn render_danger_zone(highlight: bool, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    div()
        .flex()
        .flex_col()
        .gap_3()
        .tw_rounded_lg()
        .border_1()
        .border_color(with_alpha(t.destructive, if highlight { 0.8 } else { 0.4 }))
        .bg(with_alpha(t.destructive, 0.04))
        .p_4()
        .child(
            div()
                .flex()
                .items_start()
                .gap(px(10.))
                .child(div().mt(px(2.)).child(Icon::new(IconName::TriangleAlert).size_4().text_color(t.destructive)))
                .child(crate::rows::title_block(
                    "Danger Zone",
                    "Reset all preferences to factory defaults, wipe per-connection workspace content and local caches, and disconnect the workspace. Saved connections are kept.",
                    None,
                    cx,
                )),
        )
        .child(
            div().flex().justify_end().child(
                Button::new("danger-reset")
                    .destructive()
                    .size(ButtonSize::Sm)
                    .label("Reset Everything\u{2026}")
                    .on_click(|_, w, cx| open_reset_dialog(w, cx)),
            ),
        )
}
