//! Port of components/ui/user-avatar-dropdown.tsx: the header account button
//! (initial tile + name + ChevronsUpDown) opening a `w-56 bg-popover
//! border-studio-border` dropdown with the account label, optional plan pill,
//! email / "Local mode", extra items, Settings and Sign Out / Sign In.

use crate::menu::{DropdownMenu, Menu, MenuItem};
use crate::theme::with_alpha;
use crate::{ActiveTokens, Align, IconName, Tw};
use gpui::{div, prelude::*, px, App, ElementId, FontWeight, SharedString, Window};
use gpui_component::Icon;
use std::rc::Rc;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
type ExtraItems = Rc<dyn Fn(Menu, &mut Window, &mut App) -> Menu>;

#[derive(IntoElement)]
pub struct UserAvatarDropdown {
    id: ElementId,
    display_name: SharedString,
    email: Option<SharedString>,
    signed_in: bool,
    session_active: bool,
    local_mode: bool,
    sleek: bool,
    plan: Option<SharedString>,
    on_settings: Option<Handler>,
    on_logout: Option<Handler>,
    on_sign_in: Option<Handler>,
    extra: Option<ExtraItems>,
    open_on_mount: bool,
}

impl UserAvatarDropdown {
    pub fn new(id: impl Into<ElementId>, display_name: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            display_name: display_name.into(),
            email: None,
            signed_in: false,
            session_active: false,
            local_mode: false,
            sleek: false,
            plan: None,
            on_settings: None,
            on_logout: None,
            on_sign_in: None,
            extra: None,
            open_on_mount: false,
        }
    }
    /// A signed-in `user` (shows the email and Sign Out).
    pub fn user(mut self, email: Option<impl Into<SharedString>>) -> Self {
        self.signed_in = true;
        self.email = email.map(Into::into);
        self
    }
    /// `isSessionActive` (otherwise a CloudOff "Not synced to cloud" marker shows).
    pub fn session_active(mut self, a: bool) -> Self {
        self.session_active = a;
        self
    }
    pub fn local_mode(mut self, l: bool) -> Self {
        self.local_mode = l;
        self
    }
    pub fn sleek(mut self, s: bool) -> Self {
        self.sleek = s;
        self
    }
    /// `plan.label` → "<Label> Plan" pill.
    pub fn plan(mut self, p: impl Into<SharedString>) -> Self {
        self.plan = Some(p.into());
        self
    }
    pub fn on_settings(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_settings = Some(Rc::new(f));
        self
    }
    pub fn on_logout(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_logout = Some(Rc::new(f));
        self
    }
    pub fn on_sign_in(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_sign_in = Some(Rc::new(f));
        self
    }
    /// Open on first render (gallery previews).
    pub fn open_on_mount(mut self) -> Self {
        self.open_on_mount = true;
        self
    }
    /// `children`: items inserted after the account label.
    pub fn items(mut self, f: impl Fn(Menu, &mut Window, &mut App) -> Menu + 'static) -> Self {
        self.extra = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for UserAvatarDropdown {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let initial: SharedString = self.display_name.chars().next().map(|c| c.to_uppercase().collect::<String>()).unwrap_or_default().into();
        let name = self.display_name.clone();
        let sleek = self.sleek;
        let trigger_t = t.clone();
        let trigger_name = name.clone();
        let open_on_mount = self.open_on_mount;
        DropdownMenu::new(self.id.clone())
            .align(Align::End)
            .when(open_on_mount, |d| d.open_on_mount())
            .trigger_with(move |_| {
                let t = trigger_t;
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_2()
                    .h(px(if sleek { 32. } else { 36. }))
                    .tw_text_xs()
                    .border_1()
                    .border_color(t.studio_border)
                    .tw_rounded_lg()
                    .bg(with_alpha(t.background, 0.15))
                    .hover(|s| s.bg(with_alpha(t.background, 0.25)))
                    .cursor_pointer()
                    .child(
                        div()
                            .size_5()
                            .tw_rounded_lg()
                            .bg(with_alpha(t.primary, 0.1))
                            .text_color(t.primary)
                            .flex()
                            .items_center()
                            .justify_center()
                            .tw_text_xs()
                            .font_weight(FontWeight::BOLD)
                            .child(initial),
                    )
                    .child(div().max_w(px(100.)).truncate().child(trigger_name))
                    .child(Icon::new(IconName::ChevronsUpDown).size_3().text_color(with_alpha(t.muted_foreground, 0.4)))
            })
            .menu(move |m, window, cx| {
                let t = cx.tokens().clone();
                let label = div()
                    .px(px(6.))
                    .py_1()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(name.clone()))
                            .when(self.signed_in && !self.session_active, |d| {
                                d.child(Icon::new(IconName::CloudOff).size(px(14.)).text_color(t.muted_foreground))
                            }),
                    )
                    .children(self.plan.clone().map(|p| {
                        let mut label: String = p.chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
                        label.push_str(&p.chars().skip(1).collect::<String>());
                        div().flex().child(
                            div()
                                .px_2()
                                .py(px(2.))
                                .rounded(px(4.))
                                .tw_text_xs()
                                .font_weight(FontWeight::MEDIUM)
                                .bg(with_alpha(t.primary, 0.1))
                                .text_color(t.primary)
                                .border_1()
                                .border_color(with_alpha(t.primary, 0.2))
                                .child(format!("{label} Plan")),
                        )
                    }))
                    .when(self.signed_in, |d| {
                        d.child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).truncate().child(self.email.clone().unwrap_or_default()))
                    })
                    .when(!self.signed_in && self.local_mode, |d| {
                        d.child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Local mode"))
                    });
                let mut m = m.w(224.).bg(t.popover).ring_color(t.studio_border).separator_color(t.studio_border).custom(label);
                if let Some(extra) = &self.extra {
                    m = extra(m, window, cx);
                }
                let settings = self.on_settings.clone();
                m = m.separator().item(
                    MenuItem::new("Settings").icon(IconName::Settings).icon_size(14.).gap(8.).text_xs().on_select(move |w, cx| {
                        if let Some(f) = &settings {
                            f(w, cx)
                        }
                    }),
                );
                if self.signed_in {
                    let logout = self.on_logout.clone();
                    m = m.separator().item(
                        MenuItem::new("Sign Out")
                            .icon(IconName::LogOut)
                            .icon_size(14.)
                            .gap(8.)
                            .text_xs()
                            .text_color(t.destructive)
                            .on_select(move |w, cx| {
                                if let Some(f) = &logout {
                                    f(w, cx)
                                }
                            }),
                    );
                } else if let Some(sign_in) = self.on_sign_in.clone() {
                    m = m.separator().item(MenuItem::new("Sign In").icon(IconName::LogIn).icon_size(14.).gap(8.).text_xs().on_select(move |w, cx| sign_in(w, cx)));
                }
                m
            })
    }
}
