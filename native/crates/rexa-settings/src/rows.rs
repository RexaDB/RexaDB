//! Port of the row primitives in components/studio/settings-view.tsx:
//! `SettingRow`, `ToggleSetting` (the custom w-10 h-5 toggle), `SwitchSetting`,
//! `SelectSetting`, plus the search-highlight ring (`ring-2 ring-primary/50`).

use crate::model::SettingsModel;
use gpui::{div, prelude::*, px, AnyElement, App, Entity, FontWeight, SharedString, Window};
use rexa_ui::{with_alpha, ActiveTokens, Select, SelectOption, Switch, Tw};
use serde_json::Value;

/// `SettingRow`: `flex items-center justify-between border-t border-border py-3`.
/// `highlight` draws the search deep-link ring (`rounded-lg ring-2 ring-primary/50`).
pub fn setting_row(
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    control: impl IntoElement,
    highlight: bool,
    cx: &App,
) -> gpui::Div {
    let t = cx.tokens();
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .border_t_1()
        .border_color(t.border)
        .py_3()
        .when(highlight, |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
        .child(title_block(title, description, None, cx))
        .child(div().flex_shrink_0().child(control))
}

/// The left column: `font-medium text-xs` title over `text-xs text-muted-foreground`.
pub fn title_block(
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    max_w: Option<f32>,
    cx: &App,
) -> gpui::Div {
    let t = cx.tokens();
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .flex_shrink_1()
        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(title.into()))
        .child(
            div()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .when_some(max_w, |d, w| d.max_w(px(w)))
                .child(description.into()),
        )
}

/// The `ToggleSetting` button: `w-10 h-5 rounded-lg border border-border`,
/// `bg-primary`/`bg-muted`; knob `w-3.5 h-3.5 top-0.5`, `translate-x-5.5`
/// (primary-foreground) / `translate-x-0.5` (muted-foreground/50).
pub fn toggle_button(
    id: impl Into<gpui::ElementId>,
    value: bool,
    cx: &App,
    on_change: impl Fn(bool, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let t = cx.tokens();
    let knob = if value {
        t.var_or("--primary-foreground", t.background)
    } else {
        with_alpha(t.muted_foreground, 0.5)
    };
    div()
        .id(id.into())
        .relative()
        .w_10()
        .h_5()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .bg(if value { t.primary } else { t.muted })
        .cursor_pointer()
        .on_click(move |_, w, cx| on_change(!value, w, cx))
        .child(
            div()
                .absolute()
                .top(px(1.))
                .left(px(if value { 21. } else { 1. }))
                .size(px(14.))
                .tw_rounded_lg()
                .bg(knob),
        )
}

pub fn model_toggle(model: &Entity<SettingsModel>, key: &'static str, cx: &App) -> impl IntoElement {
    let value = model.read(cx).bool(key);
    let m = model.clone();
    toggle_button(SharedString::from(format!("toggle-{key}")), value, cx, move |v, _, cx| {
        m.update(cx, |m, cx| m.set(key, v, cx))
    })
}

pub fn model_switch(model: &Entity<SettingsModel>, key: &'static str) -> impl Fn(&App) -> Switch {
    let m = model.clone();
    move |cx: &App| {
        let m2 = m.clone();
        Switch::new(SharedString::from(format!("switch-{key}")))
            .checked(m.read(cx).bool(key))
            .on_change(move |v, _, cx| m2.update(cx, |m, cx| m.set(key, v, cx)))
    }
}

/// `SelectSetting` control: `h-8 bg-secondary/50 border-border text-xs` + width.
pub fn model_select(
    model: &Entity<SettingsModel>,
    key: &'static str,
    options: &[(&str, &str)],
    width: f32,
    disabled: bool,
    numeric: bool,
    cx: &App,
) -> impl IntoElement {
    let value = model.read(cx).str(key);
    let m = model.clone();
    div().when(disabled, |d| d.opacity(0.6)).child(
        Select::new(SharedString::from(format!("select-{key}")))
            .w(px(width))
            .disabled(disabled)
            .options(options.iter().map(|(v, l)| SelectOption::new(v.to_string(), l.to_string())))
            .value(Some(value))
            .on_change(move |v, _, cx| {
                let value = if numeric {
                    v.parse::<i64>().map(Value::from).unwrap_or_else(|_| Value::from(v.to_string()))
                } else {
                    Value::from(v.to_string())
                };
                m.update(cx, |m, cx| m.set(key, value, cx))
            }),
    )
}

/// `<h2 className="text-sm font-semibold">`.
pub fn section_title(text: &'static str) -> impl IntoElement {
    div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(text)
}

/// `<h3 className="text-sm font-medium">` group headings in Advanced.
pub fn group_title(text: &'static str) -> impl IntoElement {
    div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(text)
}

/// `text-xs font-semibold tracking-wider text-muted-foreground` sub-headings.
pub fn sub_heading(text: &'static str, cx: &App) -> impl IntoElement {
    div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(cx.tokens().muted_foreground).child(text)
}

pub fn spinner(size: f32, cx: &App) -> AnyElement {
    let _ = cx;
    rexa_ui::Spinner::new(size).into_any_element()
}
