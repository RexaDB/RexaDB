//! Port of components/studio/profile-settings-view.tsx (local-mode branch: the
//! native app has no cloud session, so the signed-in profile / subscription /
//! settings-sync branch is not shown) and components/auth-page.tsx / app/auth
//! (`Route::Auth`): email OTP sign-in needs the cloud backend and only reports
//! that; "Continue Locally" is fully ported (activateLocalUserProfile).

use gpui::{div, linear_color_stop, linear_gradient, prelude::*, px, AppContext, Context, Entity, FontWeight, Window};
use gpui_component::input::InputState;
use gpui_component::Icon;
use rexa_ui::{with_alpha, ActiveTokens, Button, ButtonSize, IconName, TextInput, Tw};

pub const LOCAL_MODE_KEY: &str = "rexa-db-local-mode";
pub const LOCAL_NAME_KEY: &str = "rexa-db-local-name";
pub const DISPLAY_NAME_KEY: &str = "rexa-db-display-name";

/// useAuthState().localDisplayName: the stored local profile name.
pub fn local_display_name() -> String {
    let stored = rexa_store::Store::open().ok().and_then(|s| s.stored_user_profile().ok().flatten()).and_then(|(n, _)| n);
    stored
        .or_else(|| crate::persist::local_get(DISPLAY_NAME_KEY))
        .or_else(|| crate::persist::local_get(LOCAL_NAME_KEY))
        .map(|s| s.trim().trim_matches('"').to_string())
        .unwrap_or_default()
}

/// activateLocalUserProfile.
pub fn activate_local(name: &str) -> anyhow::Result<()> {
    let name = if name.trim().is_empty() { "Local" } else { name.trim() };
    crate::persist::local_set(LOCAL_MODE_KEY, "1")?;
    crate::persist::local_set(LOCAL_NAME_KEY, name)?;
    rexa_store::Store::open()?.activate_local_user(name)
}

pub struct ProfileSettingsView {
    /// Rendered as a connections-home screen (adds the Back row).
    standalone: bool,
}

impl ProfileSettingsView {
    pub fn new(standalone: bool) -> Self {
        Self { standalone }
    }
}

impl Render for ProfileSettingsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let name = local_display_name();
        let initial = name.trim().chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_else(|| "L".into());
        let secondary = t.var_or("--secondary", t.muted);
        div()
            .id("profile-settings")
            .size_full()
            .overflow_y_scroll()
            .bg(t.background)
            .text_color(t.foreground)
            .child(
                div()
                    .mx_auto()
                    .w_full()
                    .max_w(px(896.))
                    .flex()
                    .flex_col()
                    .px_6()
                    .py_8()
                    .when(self.standalone, |d| {
                        d.child(div().mb_4().child(
                            Button::new("profile-back").ghost().icon(IconName::ArrowLeft).label("Back").on_click(|_, _, cx| rexa_core::go_back(cx)),
                        ))
                    })
                    .child(
                        div()
                            .mx_auto()
                            .w_full()
                            .max_w(px(576.))
                            .flex()
                            .flex_col()
                            .px_2()
                            .pt_10()
                            .gap_6()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap_3()
                                    .child(
                                        div()
                                            .size_20()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .rounded(px(16.))
                                            .border_1()
                                            .border_color(with_alpha(t.border, 0.6))
                                            .bg(t.primary)
                                            .tw_text_sm()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(t.var_or("--primary-foreground", t.background))
                                            .child(initial),
                                    )
                                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(if name.is_empty() { "Local User".to_string() } else { name }))
                                    .child(
                                        div()
                                            .h_8()
                                            .flex()
                                            .items_center()
                                            .tw_rounded_lg()
                                            .border_1()
                                            .border_color(t.studio_border)
                                            .bg(with_alpha(secondary, 0.4))
                                            .px_3()
                                            .tw_text_xs()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.muted_foreground)
                                            .child("Local Mode"),
                                    )
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Local data only \u{2022} Cloud disabled")),
                            )
                            .child(
                                div()
                                    .tw_rounded_lg()
                                    .border_1()
                                    .border_color(t.studio_border)
                                    .bg(with_alpha(t.studio_bg, 0.4))
                                    .p_6()
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap_3()
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Sign in to manage subscriptions and cloud sync."))
                                    .child(Button::new("profile-signin").label("Sign In").on_click(|_, _, cx| {
                                        crate::persist::local_remove(LOCAL_MODE_KEY).ok();
                                        rexa_core::navigate(rexa_core::Route::Auth, cx);
                                    })),
                            ),
                    ),
            )
    }
}

pub struct AuthPage {
    sign_up: bool,
    email: Entity<InputState>,
    name: Entity<InputState>,
    local_name: Entity<InputState>,
}

impl AuthPage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let stored = local_display_name();
        Self {
            sign_up: false,
            email: cx.new(|cx| InputState::new(window, cx).placeholder("john@example.com")),
            name: cx.new(|cx| InputState::new(window, cx).placeholder("John Doe")),
            local_name: cx.new(|cx| InputState::new(window, cx).placeholder("Your name").default_value(stored)),
        }
    }

    fn continue_local(&mut self, cx: &mut Context<Self>) {
        let name = self.local_name.read(cx).value().trim().to_string();
        if name.is_empty() {
            rexa_ui::toast::error("Enter a display name to continue locally.", cx);
            return;
        }
        match activate_local(&name) {
            Ok(()) => rexa_core::navigate(rexa_core::Route::Connections, cx),
            Err(e) => {
                rexa_ui::toast::error(format!("Failed to switch to local mode. {e}"), cx);
            }
        }
    }

    fn request_otp(&mut self, cx: &mut Context<Self>) {
        let email = self.email.read(cx).value().trim().to_lowercase();
        if email.is_empty() {
            rexa_ui::toast::error("Please enter your email.", cx);
            return;
        }
        if self.sign_up && self.name.read(cx).value().trim().is_empty() {
            rexa_ui::toast::error("Please enter your name.", cx);
            return;
        }
        rexa_ui::toast::error("Cloud sign-in is not available in this build. Continue locally instead.", cx);
    }
}

impl Render for AuthPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let field = |label: &'static str, input: &Entity<InputState>| {
            div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child(label)).child(TextInput::new(input).h(40.))
        };
        let tab = |id: &'static str, label: &'static str, on: bool, cx: &mut Context<Self>| {
            div()
                .id(id)
                .flex_1()
                .h_9()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_md()
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .when(on, |d| d.bg(t.accent).text_color(t.accent_foreground))
                .when(!on, |d| d.text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.sign_up = id == "auth-signup";
                    cx.notify();
                }))
                .child(label)
        };
        div()
            .size_full()
            .relative()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .overflow_hidden()
            // bg-[radial-gradient(ellipse_at_top)] from-studio-row-hover/60 via-studio-bg: GPUI has no
            // radial gradients, so a top-down linear fade approximates the ellipse.
            .child(div().absolute().inset_0().bg(linear_gradient(180., linear_color_stop(with_alpha(t.studio_row_hover, 0.6), 0.), linear_color_stop(t.studio_bg, 0.6))))
            .child(
                div().size_full().flex().items_center().justify_center().p_4().child(
                    div()
                        .w_full()
                        .max_w(px(384.))
                        .flex()
                        .flex_col()
                        .gap_6()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .mb_2()
                                .child(Button::new("auth-back").ghost().size(ButtonSize::Icon).icon(IconName::ArrowLeft).on_click(|_, _, cx| rexa_core::navigate(rexa_core::Route::Connections, cx)))
                                .child(div().flex_1().flex().justify_center().pr_9().child(div().tw_text_sm().font_weight(FontWeight::BOLD).child(rexa_ui::tight("Login or Sign Up")))),
                        )
                        .child(
                            div()
                                .bg(with_alpha(t.studio_bg, 0.8))
                                .border_1()
                                .border_color(with_alpha(t.studio_border, 0.6))
                                .tw_rounded_lg()
                                .p_6()
                                .shadow_xl()
                                .child(
                                    div()
                                        .flex()
                                        .gap_2()
                                        .mb_6()
                                        .bg(with_alpha(t.muted, 0.4))
                                        .p_1()
                                        .tw_rounded_lg()
                                        .child(tab("auth-signin", "Sign In", !self.sign_up, cx))
                                        .child(tab("auth-signup", "Sign Up", self.sign_up, cx)),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap_4()
                                        .when(self.sign_up, |d| d.child(field("Name", &self.name)))
                                        .child(field("Email", &self.email))
                                        .child(Button::new("auth-continue").w_full().label("Continue with Email").on_click(cx.listener(|this, _, _, cx| this.request_otp(cx)))),
                                )
                                .child(
                                    div()
                                        .mt_4()
                                        .flex()
                                        .flex_col()
                                        .gap_3()
                                        .child(field("Local display name", &self.local_name))
                                        .child(Button::new("auth-local").outline().w_full().label("Continue Locally").on_click(cx.listener(|this, _, _, cx| this.continue_local(cx)))),
                                ),
                        )
                        .child(div().flex().justify_center().tw_text_xs().text_color(t.muted_foreground).child(format!("Version {}", crate::update::app_version()))),
                ),
            )
    }
}

#[allow(unused)]
fn _i(_: Icon) {}
