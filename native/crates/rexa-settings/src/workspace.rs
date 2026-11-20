//! Port of the "workspace" section of components/studio/settings-view.tsx and
//! lib/studio-backend/auth-store.ts: saved workspaces (`app_settings.workspace_list`),
//! the active workspace config (`app_settings.studio_backend_config`), and the
//! invite / sign-in (+ TOTP) forms that talk to `<url>/studio-api/api/*` (what
//! the sidecar's /api/studio-proxy forwards to). The local rexadb-studio server
//! card (local-studio-server-card.tsx) is not ported.

use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, PasswordInput, TextInput, Tw};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub const WORKSPACE_LIST_KEY: &str = "workspace_list";
pub const STUDIO_CONFIG_KEY: &str = "studio_backend_config";
/// sessionStorage `workspace:active`.
static SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceInfo {
    pub studio_url: String,
    pub studio_token: String,
    pub user_id: String,
    pub name: String,
}

fn store_json(key: &str) -> Option<Value> {
    rexa_store::Store::open().ok()?.setting(key).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

pub fn list() -> Vec<WorkspaceInfo> {
    store_json(WORKSPACE_LIST_KEY)
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|w| {
            Some(WorkspaceInfo {
                studio_url: w.get("studioUrl")?.as_str()?.to_string(),
                studio_token: w.get("studioToken").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                user_id: w.get("userId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: w.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn save_list(list: &[WorkspaceInfo]) -> anyhow::Result<()> {
    let v: Vec<Value> = list.iter().map(|w| json!({"studioUrl": w.studio_url, "studioToken": w.studio_token, "userId": w.user_id, "name": w.name})).collect();
    rexa_store::Store::open()?.set_setting(WORKSPACE_LIST_KEY, &Value::Array(v).to_string())
}

/// `studio_backend_config` → (url, token, userId).
pub fn active_config() -> Option<(String, String, String)> {
    let v = store_json(STUDIO_CONFIG_KEY)?;
    Some((v["studioUrl"].as_str()?.to_string(), v["studioToken"].as_str()?.to_string(), v["userId"].as_str().unwrap_or_default().to_string()))
}

fn set_config(url: &str, token: &str, user: &str) -> anyhow::Result<()> {
    rexa_store::Store::open()?.set_setting(STUDIO_CONFIG_KEY, &json!({"studioUrl": url, "studioToken": token, "userId": user}).to_string())
}

fn clear_config() {
    if let Ok(s) = rexa_store::Store::open() {
        s.delete_setting(STUDIO_CONFIG_KEY).ok();
    }
}

pub fn add(w: WorkspaceInfo) -> bool {
    let mut l = list();
    match l.iter().position(|x| x.studio_url == w.studio_url) {
        Some(i) => l[i] = w,
        None => l.push(w),
    }
    save_list(&l).is_ok()
}

pub fn remove(url: &str) {
    let mut l = list();
    l.retain(|w| w.studio_url != url);
    save_list(&l).ok();
    if active_config().is_some_and(|(u, _, _)| u == url) {
        clear_config();
    }
}

/// disconnectStudioWorkspace (deactivate).
pub fn deactivate() {
    SESSION_ACTIVE.store(false, Ordering::SeqCst);
    clear_config();
}

/// Reset Everything: disconnectStudioWorkspace + clearAllStudioData.
pub fn forget_all() {
    deactivate();
}

/// switchWorkspace.
pub fn switch(url: &str) -> bool {
    let Some(w) = list().into_iter().find(|w| w.studio_url == url) else { return false };
    if set_config(&w.studio_url, &w.studio_token, &w.user_id).is_err() {
        return false;
    }
    SESSION_ACTIVE.store(true, Ordering::SeqCst);
    true
}

/// studioApi.{get,post} against the workspace.
async fn studio_api(url: String, token: Option<String>, method: &'static str, path: &'static str, body: Option<Value>) -> anyhow::Result<Value> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build()?;
    let target = format!("{}/studio-api/api{}", url.trim_end_matches('/'), path);
    let mut req = if method == "POST" { client.post(&target) } else { client.get(&target) };
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !ok {
        anyhow::bail!("{}", v.get("error").and_then(|e| e.as_str()).unwrap_or("Studio API error"));
    }
    Ok(v)
}

#[derive(Clone, Copy, PartialEq)]
enum LoginMode {
    Invite,
    Login,
}

pub struct WorkspaceSection {
    add_page: bool,
    mode: LoginMode,
    totp_step: bool,
    temp_token: String,
    busy: bool,
    url: Entity<InputState>,
    invite: Entity<InputState>,
    name: Entity<InputState>,
    email: Entity<InputState>,
    login_email: Entity<InputState>,
    password: Entity<InputState>,
    totp: Entity<InputState>,
    _subs: Vec<gpui::Subscription>,
}

impl WorkspaceSection {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mk = |ph: &str, v: &str, masked: bool, window: &mut Window, cx: &mut Context<Self>| {
            let (ph, v) = (ph.to_string(), v.to_string());
            cx.new(|cx| InputState::new(window, cx).placeholder(ph).masked(masked).default_value(v))
        };
        let url = mk("http://localhost:3000", "http://localhost:3000", false, window, cx);
        let invite = mk("64-character hex token", "", false, window, cx);
        let name = mk("John Doe", "", false, window, cx);
        let email = mk("john@example.com", "", false, window, cx);
        let login_email = mk("john@example.com", "", false, window, cx);
        let password = mk("Your password", "", true, window, cx);
        let totp = mk("000000", "", false, window, cx);
        let mut subs = Vec::new();
        for s in [&url, &invite, &name, &email, &login_email, &password] {
            subs.push(cx.observe(s, |_, _, cx| cx.notify()));
        }
        // TOTP: digits only, max 6.
        subs.push(cx.subscribe_in(&totp, window, |_, s, e: &InputEvent, window, cx| {
            if matches!(e, InputEvent::Change) {
                let v = s.read(cx).value().to_string();
                let d: String = v.chars().filter(|c| c.is_ascii_digit()).take(6).collect();
                if d != v {
                    s.update(cx, |s, cx| s.set_value(d, window, cx));
                }
                cx.notify();
            }
        }));
        Self { add_page: false, mode: LoginMode::Invite, totp_step: false, temp_token: String::new(), busy: false, url, invite, name, email, login_email, password, totp, _subs: subs }
    }

    pub fn set_add_page(&mut self, add: bool, cx: &mut Context<Self>) {
        self.add_page = add;
        cx.notify();
    }

    fn val(s: &Entity<InputState>, cx: &App) -> String {
        s.read(cx).value().to_string()
    }

    fn base_url(&self, cx: &App) -> String {
        Self::val(&self.url, cx).trim().trim_end_matches('/').to_string()
    }

    /// activateWorkspace + loginSuccess tail.
    fn finish(url: String, token: String, user: String, message: &'static str, this: gpui::WeakEntity<Self>, cx: &mut gpui::AsyncApp) {
        let (u2, t2) = (url.clone(), token.clone());
        let name_task = rexa_core::runtime::spawn(async move { studio_api(u2, Some(t2), "GET", "/studio", None).await });
        cx.spawn(async move |cx| {
            let name = name_task.await.ok().and_then(|v| v["data"]["name"].as_str().map(str::to_string)).unwrap_or_else(|| url.clone());
            cx.update(|cx| {
                set_config(&url, &token, &user).ok();
                SESSION_ACTIVE.store(true, Ordering::SeqCst);
                if !add(WorkspaceInfo { studio_url: url.clone(), studio_token: token.clone(), user_id: user.clone(), name }) {
                    rexa_ui::toast::warning("Connected but failed to save to workspace list", cx);
                }
                rexa_ui::toast::success(message, cx);
                this.update(cx, |s, cx| {
                    s.busy = false;
                    s.add_page = false;
                    cx.notify();
                })
                .ok();
            });
        })
        .detach();
    }

    fn accept_invite(&mut self, cx: &mut Context<Self>) {
        let url = self.base_url(cx);
        let body = json!({"token": Self::val(&self.invite, cx).trim(), "name": Self::val(&self.name, cx).trim(), "email": Self::val(&self.email, cx).trim().to_lowercase()});
        self.busy = true;
        cx.notify();
        let u = url.clone();
        let task = rexa_core::runtime::spawn(async move { studio_api(u, None, "POST", "/invites/accept", Some(body)).await });
        cx.spawn(async move |this, cx| {
            match task.await {
                Ok(v) => {
                    let token = v["data"]["studioToken"].as_str().unwrap_or_default().to_string();
                    let user = v["data"]["userId"].as_str().unwrap_or_default().to_string();
                    Self::finish(url, token, user, "Connected to workspace!", this, cx);
                }
                Err(e) => {
                    cx.update(|cx| {
                        rexa_ui::toast::error(e.to_string(), cx);
                        this.update(cx, |s, cx| {
                            s.busy = false;
                            cx.notify();
                        })
                        .ok();
                    });
                }
            }
        })
        .detach();
    }

    fn login_success(url: String, token: String, this: gpui::WeakEntity<Self>, cx: &mut gpui::AsyncApp) {
        let (u2, t2) = (url.clone(), token.clone());
        let me = rexa_core::runtime::spawn(async move { studio_api(u2, Some(t2), "GET", "/auth/me", None).await });
        cx.spawn(async move |cx| match me.await {
            Ok(v) => {
                let user = v["data"]["id"].as_str().unwrap_or_default().to_string();
                Self::finish(url, token, user, "Connected to workspace via sign-in!", this, cx);
            }
            Err(e) => cx.update(|cx| {
                rexa_ui::toast::error(e.to_string(), cx);
                this.update(cx, |s, cx| {
                    s.busy = false;
                    cx.notify();
                })
                .ok();
            }),
        })
        .detach();
    }

    fn login(&mut self, cx: &mut Context<Self>) {
        let email = Self::val(&self.login_email, cx).trim().to_lowercase();
        let pw = Self::val(&self.password, cx);
        if email.is_empty() || pw.is_empty() {
            return;
        }
        let valid = email.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.') && !email.contains(' '));
        if !valid {
            rexa_ui::toast::error("Please enter a valid email address", cx);
            return;
        }
        let url = self.base_url(cx);
        self.busy = true;
        cx.notify();
        let u = url.clone();
        let task = rexa_core::runtime::spawn(async move { studio_api(u, None, "POST", "/auth/login", Some(json!({"email": email, "password": pw}))).await });
        cx.spawn(async move |this, cx| match task.await {
            Ok(v) if v["data"]["step"] == "totp" && v["data"]["tempToken"].is_string() => cx.update(|cx| {
                this.update(cx, |s, cx| {
                    s.temp_token = v["data"]["tempToken"].as_str().unwrap_or_default().to_string();
                    s.totp_step = true;
                    s.busy = false;
                    cx.notify();
                })
                .ok();
            }),
            Ok(v) if v["data"]["studioToken"].is_string() => {
                let token = v["data"]["studioToken"].as_str().unwrap_or_default().to_string();
                Self::login_success(url, token, this, cx);
            }
            other => cx.update(|cx| {
                rexa_ui::toast::error(other.err().map_or("Unexpected login response.".to_string(), |e| e.to_string()), cx);
                this.update(cx, |s, cx| {
                    s.busy = false;
                    cx.notify();
                })
                .ok();
            }),
        })
        .detach();
    }

    fn verify_totp(&mut self, cx: &mut Context<Self>) {
        let code = Self::val(&self.totp, cx).trim().to_string();
        let url = self.base_url(cx);
        let temp = self.temp_token.clone();
        self.busy = true;
        cx.notify();
        let u = url.clone();
        let task = rexa_core::runtime::spawn(async move { studio_api(u, None, "POST", "/auth/login/totp", Some(json!({"tempToken": temp, "code": code}))).await });
        cx.spawn(async move |this, cx| match task.await {
            Ok(v) if v["data"]["studioToken"].is_string() => {
                let token = v["data"]["studioToken"].as_str().unwrap_or_default().to_string();
                Self::login_success(url, token, this, cx);
            }
            other => cx.update(|cx| {
                rexa_ui::toast::error(other.err().map_or("Unexpected TOTP response.".to_string(), |e| e.to_string()), cx);
                this.update(cx, |s, cx| {
                    s.busy = false;
                    cx.notify();
                })
                .ok();
            }),
        })
        .detach();
    }

    fn field(label: &'static str, input: AnyElement, cx: &App) -> AnyElement {
        div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(cx.tokens().muted_foreground).child(label)).child(input).into_any_element()
    }

    fn card(cx: &App) -> gpui::Div {
        let t = cx.tokens();
        div().p_4().flex().flex_col().gap_4().tw_rounded_xl().border_1().border_color(t.studio_border).bg(with_alpha(t.studio_bg, 0.5))
    }

    fn render_add(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let config = active_config();
        let active = config.is_some() && SESSION_ACTIVE.load(Ordering::SeqCst);
        let body: AnyElement = if let Some((url, _, user)) = config.clone() {
            let info = div()
                .flex()
                .flex_col()
                .gap_1()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(format!("URL: {url}"))
                .child(format!("User ID: {user}"))
                .when(!active, |d| d.child(div().italic().text_color(with_alpha(t.foreground, 0.6)).child("Saved credentials found")));
            let u = url.clone();
            Self::card(cx)
                .gap_3()
                .when(active, |d| d.child(div().flex().items_center().gap_2().child(Icon::new(IconName::CircleCheck).size_5().text_color(tw("emerald-500"))).child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Connected"))))
                .child(info)
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(div().flex_1().child(if active {
                            Button::new("ws-deactivate").secondary().size(ButtonSize::Sm).w_full().icon(IconName::LogOut).label("Deactivate").on_click(cx.listener(|_, _, _, cx| {
                                deactivate();
                                rexa_ui::toast::success("Switched to local connections", cx);
                                cx.notify();
                            }))
                        } else {
                            Button::new("ws-reconnect").size(ButtonSize::Sm).w_full().icon(IconName::ArrowRight).label("Reconnect").on_click(cx.listener(|_, _, _, cx| {
                                SESSION_ACTIVE.store(true, Ordering::SeqCst);
                                rexa_ui::toast::success("Reconnected to workspace", cx);
                                cx.notify();
                            }))
                        }))
                        .child(Button::new("ws-forget").destructive().size(ButtonSize::Sm).label("Forget").on_click(cx.listener(move |this, _, _, cx| {
                            if active {
                                remove(&u);
                            }
                            forget_all();
                            this.mode = LoginMode::Invite;
                            this.totp_step = false;
                            rexa_ui::toast::success("Forgotten workspace credentials", cx);
                            cx.notify();
                        }))),
                )
                .into_any_element()
        } else if self.totp_step {
            let code_len = Self::val(&self.totp, cx).len();
            Self::card(cx)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap_2()
                        .child(Icon::new(IconName::Shield).size_8().text_color(t.primary))
                        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Two-Factor Authentication"))
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child("Enter the 6-digit code from your authenticator app")),
                )
                .child(TextInput::new(&self.totp).h(40.))
                .child(
                    Button::new("ws-totp")
                        .w_full()
                        .label(if self.busy { "Verifying..." } else { "Verify & Connect" })
                        .disabled(self.busy || code_len != 6)
                        .on_click(cx.listener(|this, _, _, cx| this.verify_totp(cx))),
                )
                .child(
                    div()
                        .id("ws-back-signin")
                        .w_full()
                        .flex()
                        .justify_center()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .hover(|s| s.text_color(t.foreground))
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, w, cx| {
                            this.totp_step = false;
                            this.temp_token.clear();
                            this.totp.update(cx, |s, cx| s.set_value("", w, cx));
                            cx.notify();
                        }))
                        .child("Back to sign in"),
                )
                .into_any_element()
        } else {
            let tab = |id: &'static str, label: &'static str, on: bool, mode: LoginMode, cx: &mut Context<Self>| {
                div()
                    .id(id)
                    .flex_1()
                    .flex()
                    .justify_center()
                    .tw_rounded_lg()
                    .px_3()
                    .py(px(6.))
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .cursor_pointer()
                    .when(on, |d| d.bg(t.background).text_color(t.foreground).border_1().border_color(with_alpha(t.border, 0.4)).shadow_sm())
                    .when(!on, |d| d.text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.mode = mode;
                        cx.notify();
                    }))
                    .child(label)
            };
            let invite = self.mode == LoginMode::Invite;
            let mut card = Self::card(cx)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .tw_rounded_lg()
                        .bg(with_alpha(t.muted, 0.4))
                        .p_1()
                        .child(tab("ws-tab-invite", "Accept Invite", invite, LoginMode::Invite, cx))
                        .child(tab("ws-tab-login", "Sign In", !invite, LoginMode::Login, cx)),
                )
                .child(Self::field("Workspace URL", TextInput::new(&self.url).h(40.).into_any_element(), cx));
            if invite {
                let ready = !Self::val(&self.invite, cx).trim().is_empty() && !Self::val(&self.name, cx).trim().is_empty() && !Self::val(&self.email, cx).trim().is_empty();
                card = card
                    .child(Self::field("Invite Token", TextInput::new(&self.invite).h(40.).into_any_element(), cx))
                    .child(Self::field("Name", TextInput::new(&self.name).h(40.).into_any_element(), cx))
                    .child(Self::field("Email", TextInput::new(&self.email).h(40.).into_any_element(), cx))
                    .child(
                        Button::new("ws-connect")
                            .w_full()
                            .label(if self.busy { "Connecting..." } else { "Connect to Workspace" })
                            .disabled(self.busy || !ready)
                            .on_click(cx.listener(|this, _, _, cx| this.accept_invite(cx))),
                    );
            } else {
                let ready = !Self::val(&self.login_email, cx).trim().is_empty() && !Self::val(&self.password, cx).is_empty();
                card = card
                    .child(Self::field("Email", TextInput::new(&self.login_email).h(40.).into_any_element(), cx))
                    .child(Self::field("Password", PasswordInput::new("ws-password", &self.password).into_any_element(), cx))
                    .child(
                        Button::new("ws-login")
                            .w_full()
                            .label(if self.busy { "Signing in..." } else { "Sign In & Connect" })
                            .disabled(self.busy || !ready)
                            .on_click(cx.listener(|this, _, _, cx| this.login(cx))),
                    );
            }
            card.into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(t.muted_foreground).child("Connect to an existing workspace"))
            .child(body)
            .into_any_element()
    }

    fn render_list(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let saved = list();
        let active_url = active_config().map(|c| c.0);
        let mut grid = div().flex().flex_wrap().gap(px(10.));
        for ws in &saved {
            let is_active = active_url.as_deref() == Some(ws.studio_url.as_str());
            let (u1, u2) = (ws.studio_url.clone(), ws.studio_url.clone());
            let actions = if is_active {
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(div().flex_1().child(Button::new(SharedString::from(format!("ws-deact-{u1}"))).secondary().size(ButtonSize::Sm).w_full().icon(IconName::LogOut).label("Deactivate").on_click(cx.listener(|_, _, _, cx| {
                        deactivate();
                        rexa_ui::toast::success("Switched to local connections", cx);
                        cx.notify();
                    }))))
                    .child(Button::new(SharedString::from(format!("ws-forget-{u1}"))).destructive().size(ButtonSize::Sm).label("Forget").on_click(cx.listener(move |_, _, _, cx| {
                        remove(&u2);
                        forget_all();
                        rexa_ui::toast::success("Forgotten workspace credentials", cx);
                        cx.notify();
                    })))
            } else {
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(div().flex_1().child(Button::new(SharedString::from(format!("ws-switch-{u1}"))).outline().size(ButtonSize::Sm).w_full().icon(IconName::ArrowRight).label("Switch").on_click(cx.listener(move |_, _, _, cx| {
                        if switch(&u1) {
                            rexa_ui::toast::success("Switched workspace", cx);
                            rexa_core::navigate(rexa_core::Route::Connections, cx);
                        } else {
                            rexa_ui::toast::error("Failed to switch workspace", cx);
                        }
                        cx.notify();
                    }))))
                    .child(Button::new(SharedString::from(format!("ws-rm-{u2}"))).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(cx.listener(move |_, _, _, cx| {
                        remove(&u2);
                        cx.notify();
                    })))
            };
            grid = grid.child(
                div()
                    .w(px(300.))
                    .flex()
                    .flex_col()
                    .justify_between()
                    .gap_3()
                    .tw_rounded_lg()
                    .border_1()
                    .p_3()
                    .when(is_active, |d| d.border_color(with_alpha(t.primary, 0.3)).bg(with_alpha(t.primary, 0.03)))
                    .when(!is_active, |d| d.border_color(t.studio_border).bg(with_alpha(t.studio_bg, 0.3)).hover(|s| s.bg(with_alpha(t.muted, 0.1))))
                    .child(
                        div()
                            .min_w_0()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).overflow_hidden().text_ellipsis().whitespace_nowrap().child(ws.name.clone()))
                                    .when(is_active, |d| {
                                        d.child(div().rounded_full().border_1().border_color(with_alpha(t.primary, 0.2)).px(px(6.)).py(px(2.)).tw_text_10().font_weight(FontWeight::MEDIUM).text_color(t.primary).child("Active"))
                                    }),
                            )
                            .child(div().mt_1().font_family(rexa_ui::MONO).tw_text_10().text_color(with_alpha(t.muted_foreground, 0.6)).overflow_hidden().text_ellipsis().whitespace_nowrap().child(ws.studio_url.clone())),
                    )
                    .child(actions),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(t.muted_foreground).child("Your workspaces"))
            .child(if saved.is_empty() {
                div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.5)).child("No workspaces saved yet.").into_any_element()
            } else {
                grid.into_any_element()
            })
            .into_any_element()
    }
}

impl Render for WorkspaceSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let header_btn = if self.add_page {
            Button::new("ws-back").ghost().size(ButtonSize::Sm).icon(IconName::ArrowLeft).label("Back to workspaces").on_click(cx.listener(|this, _, _, cx| this.set_add_page(false, cx)))
        } else {
            Button::new("ws-add").size(ButtonSize::Sm).icon(IconName::Plus).label("Add workspace").on_click(cx.listener(|this, _, _, cx| this.set_add_page(true, cx)))
        };
        let body = if self.add_page { self.render_add(cx) } else { self.render_list(cx) };
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .child(
                        div()
                            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Workspaces"))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child("Connect to a RexaDB Studio workspace to manage shared connections.")),
                    )
                    .child(header_btn),
            )
            .child(body)
    }
}
