//! First-window flows: components/gates/settings-migration-gate.tsx +
//! components/studio/settings-migration-dialog.tsx, and
//! components/onboarding/onboarding-flow.tsx (shown by connections-page.tsx
//! when there is no stored user profile and `rexa-db-onboarding-complete` is
//! not "1"). Both are skipped when the app starts on a `REXA_ROUTE` (dev /
//! screenshot runs) so they never cover another screen's capture.

use crate::model::{SettingsModel, DEFAULT_DARK_THEME_ID};
use gpui::{div, img, prelude::*, px, App, AppContext, Entity, FontWeight, Image, ImageFormat, SharedString, Window};
use gpui_component::input::InputState;
use gpui_component::Icon;
use rexa_ui::{close_top, open_dialog, tw, white, with_alpha, ActiveTokens, Button, Dialog, IconName, TextInput, Tw};
use std::sync::Arc;

pub const ONBOARDING_COMPLETE_KEY: &str = "rexa-db-onboarding-complete";

pub fn init(cx: &mut App) {
    if std::env::var("REXA_ROUTE").is_ok_and(|v| !v.is_empty()) {
        return;
    }
    // Wait for the first window (opened right after the crates' init).
    cx.spawn(async move |cx| {
        for _ in 0..100 {
            cx.background_executor().timer(std::time::Duration::from_millis(100)).await;
            if cx.update(|cx| !cx.windows().is_empty()) {
                break;
            }
        }
        cx.background_executor().timer(std::time::Duration::from_millis(200)).await;
        cx.update(|cx| {
            if crate::persist::is_migration_needed() {
                open_migration_dialog(cx);
            } else {
                maybe_open_onboarding(cx);
            }
        });
    })
    .detach();
}

// ---- settings migration -------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Status {
    Pending,
    Done,
    Error,
}

struct Migration {
    status: Status,
    error: Option<String>,
}

pub fn open_migration_dialog(cx: &mut App) {
    let state = cx.new(|_| Migration { status: Status::Pending, error: None });
    open_dialog(cx, move |_, cx| {
        let t = cx.tokens().clone();
        let st = state.read(cx);
        let (status, error) = (st.status, st.error.clone());
        let steps = ["Reading settings from database...", "Writing settings file...", "Verifying migration...", "Migration complete!"];
        let mut list = div().flex().flex_col().gap(px(10.)).py_2();
        for (i, label) in steps.iter().enumerate() {
            let s = match status {
                Status::Done => Status::Done,
                Status::Error if i == 0 => Status::Error,
                _ => Status::Pending,
            };
            let icon = match s {
                Status::Done => Icon::new(IconName::CircleCheck).size_4().text_color(tw("green-500")).into_any_element(),
                Status::Error => Icon::new(IconName::CircleX).size_4().text_color(tw("red-500")).into_any_element(),
                Status::Pending => div().size_4().rounded_full().border_2().border_color(t.muted).into_any_element(),
            };
            let color = match s {
                Status::Done => tw("green-400"),
                Status::Error => tw("red-400"),
                Status::Pending => t.muted_foreground,
            };
            list = list.child(div().flex().items_center().gap_3().child(icon).child(div().tw_text_xs().text_color(color).child(*label)));
        }
        let (s1, s2) = (state.clone(), state.clone());
        let mut d = Dialog::new()
            .max_w(448.)
            .hide_close()
            .header(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .tw_text_base()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(Icon::new(IconName::Database).size_4().text_color(tw("blue-500")))
                    .child("Settings Migration"),
            )
            // `.header()` replaces the title block, so the description is a child.
            .child(div().tw_text_sm().text_color(t.muted_foreground).child("We've moved settings to a JSON file for better performance and editability. Your settings will be migrated automatically."))
            .child(list);
        if let Some(e) = error {
            d = d.child(
                div()
                    .tw_rounded_lg()
                    .bg(with_alpha(tw("red-500"), 0.1))
                    .border_1()
                    .border_color(with_alpha(tw("red-500"), 0.2))
                    .p_3()
                    .child(div().tw_text_xs().text_color(tw("red-400")).child(e))
                    .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Your settings are still safely stored in the database. You can try again or continue using the app as before.")),
            );
        }
        if status == Status::Done {
            d = d.child(
                div().tw_rounded_lg().bg(with_alpha(t.muted, 0.5)).border_1().border_color(t.border).p_3().child(
                    div()
                        .flex()
                        .items_start()
                        .gap_2()
                        .child(Icon::new(IconName::FileBraces).size(px(14.)).text_color(t.muted_foreground))
                        .child(
                            div()
                                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Settings stored at:"))
                                .child(div().mt(px(2.)).tw_text_xs().font_family(rexa_ui::MONO).text_color(t.muted_foreground).child("~/.config/Rexa DB/settings.json")),
                        ),
                ),
            );
        }
        let migrate = move |s: Entity<Migration>, cx: &mut App| {
            let res = crate::persist::migrate_settings_to_file().and_then(|_| crate::persist::clear_migrated_sqlite_settings());
            s.update(cx, |m, _| match res {
                Ok(()) => m.status = Status::Done,
                Err(e) => {
                    m.status = Status::Error;
                    m.error = Some(e.to_string());
                }
            });
            cx.refresh_windows();
        };
        match status {
            Status::Pending => {
                d = d
                    .footer(Button::new("mig-later").outline().label("Not now").on_click(|_, _, cx| {
                        close_top(cx);
                        maybe_open_onboarding(cx);
                    }))
                    .footer(Button::new("mig-go").icon(IconName::ArrowRight).label("Migrate Settings").on_click(move |_, _, cx| migrate(s1.clone(), cx)));
            }
            Status::Error => {
                d = d
                    .footer(Button::new("mig-retry").outline().label("Retry Migration").on_click(move |_, _, cx| migrate(s2.clone(), cx)))
                    .footer(Button::new("mig-skip").ghost().label("Continue without migrating").on_click(|_, _, cx| close_top(cx)));
            }
            Status::Done => {
                d = d.footer(Button::new("mig-continue").icon(IconName::CircleCheck).label("Continue").on_click(|_, _, cx| {
                    close_top(cx);
                    // window.location.reload(): re-read everything from the new file.
                    SettingsModel::global(cx).update(cx, |m, cx| m.reload(cx));
                }));
            }
        }
        d
    });
}

// ---- onboarding -------------------------------------------------------------------------

const TIPS: [&str; 4] = [
    "RexaDB connects to Postgres, Supabase, SpacetimeDB, Neon, SQLite and more \u{2014} all from one unified workspace.",
    "Turn on Schema Explorer in Settings to browse tables, functions, triggers and indexes without leaving the sidebar.",
    "You can pin favorite tables and queries for quick access from the sidebar.",
    "Export query results as CSV or JSON with a single click from the results grid.",
];

fn should_onboard() -> bool {
    let has_profile = rexa_store::Store::open().ok().and_then(|s| s.stored_user_profile().ok().flatten()).is_some();
    !has_profile && crate::persist::local_get(ONBOARDING_COMPLETE_KEY).as_deref() != Some("1")
}

pub fn maybe_open_onboarding(cx: &mut App) {
    if should_onboard() {
        open_onboarding(cx);
    }
}

struct Onboarding {
    step: usize,
    name: Option<Entity<InputState>>,
}

pub fn open_onboarding(cx: &mut App) {
    let state = cx.new(|_| Onboarding { step: 0, name: None });
    let image = Arc::new(Image::from_bytes(ImageFormat::Png, include_bytes!("../../../../public/onboarding.png").to_vec()));
    open_dialog(cx, move |window, cx| {
        let t = cx.tokens().clone();
        if state.read(cx).name.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx).placeholder("Your name"));
            state.update(cx, |s, _| s.name = Some(input));
        }
        let (step, name) = {
            let s = state.read(cx);
            (s.step, s.name.clone().unwrap())
        };
        let vp = window.viewport_size();
        let (w, h) = ((vp.width * 0.94).min(px(1200.)), vp.height * 0.86);
        let go = |st: Entity<Onboarding>, n: usize| move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| st.update(cx, |s, cx| { s.step = n; cx.notify(); cx.refresh_windows(); });
        let primary = |id: &'static str, label: &'static str| {
            div()
                .id(id)
                .h(px(44.))
                .w_full()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_xl()
                .bg(t.primary)
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.var_or("--primary-foreground", t.background))
                .cursor_pointer()
                .hover(|s| s.bg(with_alpha(t.primary, 0.9)))
                .child(label)
        };
        let heading = |title: &'static str, sub: &'static str| {
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(px(30.)).line_height(px(36.)).font_weight(FontWeight::BOLD).child(rexa_ui::tight(title)))
                .child(div().text_color(t.muted_foreground).child(sub))
        };
        let current_theme = SettingsModel::global(cx).read(cx).app_theme_id.clone();
        let body: gpui::AnyElement = match step {
            0 => div().flex().flex_col().gap_6().child(heading("Welcome to RexaDB", "Let's get your workspace set up. This will only take a moment.")).child(primary("ob-start", "Get Started").on_click(go(state.clone(), 1))).into_any_element(),
            1 => {
                let mut pills = div().flex().gap_3();
                for (id, label) in [("system", "System"), ("light", "Light"), (DEFAULT_DARK_THEME_ID, "Dark")] {
                    let selected = current_theme == id;
                    pills = pills.child(
                        div()
                            .id(SharedString::from(format!("ob-theme-{id}")))
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap(px(10.))
                            .tw_rounded_xl()
                            .border_1()
                            .px_4()
                            .py_3()
                            .tw_text_sm()
                            .cursor_pointer()
                            .when(selected, |d| d.border_color(t.primary).bg(with_alpha(t.primary, 0.1)).text_color(t.foreground))
                            .when(!selected, |d| d.border_color(t.border).text_color(t.muted_foreground).hover(|s| s.border_color(with_alpha(t.foreground, 0.3)).text_color(t.foreground)))
                            .on_click(move |_, _, cx| SettingsModel::global(cx).update(cx, |m, cx| m.set_app_theme(id, cx)))
                            .child(
                                div()
                                    .size_4()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded_full()
                                    .border_1()
                                    .border_color(if selected { t.primary } else { t.border })
                                    .when(selected, |d| d.bg(t.primary).child(Icon::new(IconName::Check).size(px(10.)).text_color(t.var_or("--primary-foreground", t.background)))),
                            )
                            .child(label),
                    );
                }
                div().flex().flex_col().gap_6().child(heading("Which look works for you?", "You can change this anytime in Settings.")).child(pills).child(primary("ob-continue", "Continue").on_click(go(state.clone(), 2))).into_any_element()
            }
            _ => {
                let n2 = name.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap_6()
                    .child(heading("Sign in or continue free", "Sync your connections across devices, or stay fully local."))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Cloud sign-in is not available in this build."))
                    .child(
                        div().flex().flex_col().gap_2().child(TextInput::new(&name).h(44.)).child(
                            div()
                                .id("ob-free")
                                .h(px(44.))
                                .w_full()
                                .flex()
                                .items_center()
                                .justify_center()
                                .tw_rounded_xl()
                                .border_1()
                                .border_color(with_alpha(t.border, 0.6))
                                .bg(with_alpha(t.background, 0.7))
                                .tw_text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(with_alpha(t.foreground, 0.8))
                                .cursor_pointer()
                                .hover(|s| s.bg(with_alpha(t.muted, 0.5)).text_color(t.foreground))
                                .on_click(move |_, _, cx| {
                                    let v = n2.read(cx).value().trim().to_string();
                                    if v.is_empty() {
                                        rexa_ui::toast::error("Please enter your name.", cx);
                                        return;
                                    }
                                    match crate::profile::activate_local(&v) {
                                        Ok(()) => {
                                            crate::persist::local_set(ONBOARDING_COMPLETE_KEY, "1").ok();
                                            rexa_ui::toast::success(format!("Welcome, {v}."), cx);
                                            close_top(cx);
                                            rexa_core::navigate(rexa_core::Route::Connections, cx);
                                        }
                                        Err(_) => {
                                            rexa_ui::toast::error("Failed to continue. Try again.", cx);
                                        }
                                    }
                                })
                                .child("Continue Free"),
                        ),
                    )
                    .into_any_element()
            }
        };
        let dots = div().flex().items_center().gap(px(6.)).children((0..3).map(|i| {
            div().h_1().w_8().rounded_full().bg(if i == step { t.primary } else if i < step { with_alpha(t.primary, 0.5) } else { t.muted })
        }));
        let back = (step > 0).then(|| {
            div()
                .id("ob-back")
                .absolute()
                .left_10()
                .top_8()
                .size_9()
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .border_1()
                .border_color(t.border)
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(|s| s.border_color(with_alpha(t.foreground, 0.3)).text_color(t.foreground))
                .on_click(go(state.clone(), step - 1))
                .child(Icon::new(IconName::ChevronLeft).size_4())
        });
        Dialog::new().w(f32::from(w)).padding(0.).hide_close().child(
            div()
                .h(h)
                .flex()
                .bg(t.studio_bg)
                .tw_rounded_xl()
                .overflow_hidden()
                .child(
                    div()
                        .relative()
                        .m_3()
                        .w(w * 0.42)
                        .flex_shrink_0()
                        .tw_rounded_xl()
                        .overflow_hidden()
                        .child(img(image.clone()).absolute().inset_0().size_full().object_fit(gpui::ObjectFit::Cover))
                        .child(div().absolute().inset_0().bg(gpui::hsla(0., 0., 0., 0.4)))
                        .child(
                            div()
                                .absolute()
                                .top(px(56.))
                                .left_0()
                                .right_0()
                                .px_8()
                                .flex()
                                .flex_col()
                                .items_center()
                                .child(div().mb_3().tw_text_11().font_weight(FontWeight::SEMIBOLD).text_color(white(0.7)).child("TIP"))
                                .child(div().max_w(px(320.)).tw_text_lg().text_color(white(0.9)).text_center().child(TIPS[step % TIPS.len()])),
                        ),
                )
                .child(
                    div()
                        .relative()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .px(px(56.))
                        .py_10()
                        .children(back)
                        .child(div().flex_1().flex().flex_col().justify_center().max_w(px(448.)).child(body))
                        .child(dots),
                ),
        )
    });
}
