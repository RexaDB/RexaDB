//! Create tabs (`TabSpec::Create`): ports of components/studio/create-object-common.tsx,
//! components/studio/shared/create-resource-shell.tsx, target-table-select.tsx and
//! the `create-{schema,database,enum,index,trigger,table}-view.tsx` views, with the
//! studio's `handleCreate*` / `handleUpdateEnum` runners.

pub mod index;
pub mod simple;
pub mod table;
pub mod trigger;

use gpui::{div, prelude::*, px, AnyElement, AnyView, App, AppContext, ElementId, FontWeight, SharedString, Window};
use rexa_core::{emit_studio, open_tab, Session, StudioEvent, TabSpec};
use rexa_ui::widgets::Icon;
use rexa_ui::{with_alpha, ActiveTokens, Button, IconName, Select, SelectOption, Spinner, Tw, MONO};
use std::sync::Arc;

pub fn build(object: &str, schema: Option<String>, spec: &TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    let schema = schema.unwrap_or_else(|| crate::common::default_schema(&session));
    let spec = spec.clone();
    Some(match object {
        "schema" => cx.new(|cx| simple::CreateSchemaView::new(spec, session, window, cx)).into(),
        "database" => cx.new(|cx| simple::CreateDatabaseView::new(spec, session, window, cx)).into(),
        "enum" => cx.new(|cx| simple::CreateEnumView::new(spec, session, schema, window, cx)).into(),
        "index" => cx.new(|cx| index::CreateIndexView::new(spec, session, schema, window, cx)).into(),
        "trigger" => cx.new(|cx| trigger::CreateTriggerView::new(spec, session, schema, window, cx)).into(),
        "table" => cx.new(|cx| table::CreateTableView::new(spec, session, schema, window, cx)).into(),
        _ => return None,
    })
}

/// `switchAwayFromTab(tabId, 'database-<view>')`: close the create tab, show the list.
pub fn switch_away(spec: &TabSpec, view: &str, cx: &mut App) {
    emit_studio(StudioEvent::CloseTab(spec.clone()), cx);
    open_tab(TabSpec::View { view: format!("database-{view}"), params: serde_json::Value::Null }, cx);
}

/// `closeCreateTab` + `openDatabaseTab('tables')`.
pub fn close_and_open_tables(spec: &TabSpec, cx: &mut App) {
    switch_away(spec, "tables", cx);
}

/// The primary submit button of both shells (h-9 px-6 text-xs font-bold, spinner while creating).
pub fn submit_button(id: &'static str, label: &str, busy_label: &str, busy: bool, disabled: bool, on_click: impl Fn(&mut Window, &mut App) + 'static) -> AnyElement {
    let b = Button::new(id).disabled(disabled).on_click(move |_, w, cx| on_click(w, cx));
    let b = if busy {
        b.child(div().flex().items_center().gap_2().child(Spinner::new(16.)).child(busy_label.to_string()))
    } else {
        b.label(label.to_string())
    };
    div().h_9().flex().items_center().tw_text_xs().font_weight(FontWeight::BOLD).child(b).into_any_element()
}

/// `CreateResourceShell` / `CreateObjectShell` / the enum view's header:
/// bordered header with title, description (+ optional schema chip) and submit,
/// then a centered scrolling body of `max_w` px.
pub fn shell(
    id: &'static str,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    schema: Option<&str>,
    max_w: f32,
    submit: AnyElement,
    body: AnyElement,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens();
    let mut desc = div().flex().flex_wrap().items_center().tw_text_sm().text_color(t.muted_foreground).mt_1().child(description.into());
    if let Some(s) = schema {
        desc = desc
            .child(div().ml_1().px_1().rounded(px(4.)).bg(t.muted).text_color(t.foreground).font_family(MONO).font_weight(FontWeight::BOLD).child(s.to_string()))
            .child(".");
    }
    div()
        .size_full()
        .flex()
        .flex_col()
        .bg(t.background)
        .text_color(t.foreground)
        .overflow_hidden()
        .child(
            div().flex_shrink_0().p_6().border_b_1().border_color(t.border).bg(with_alpha(t.muted, 0.3)).child(
                div()
                    .max_w(px(max_w))
                    .w_full()
                    .mx_auto()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(div().child(div().tw_text_sm().font_weight(FontWeight::BOLD).child(title.into())).child(desc))
                    .child(submit),
            ),
        )
        .child(div().id(ElementId::Name(format!("{id}-body").into())).flex_1().overflow_y_scroll().p_6().child(div().max_w(px(max_w)).w_full().mx_auto().child(body)))
        .into_any_element()
}

/// Uppercase-tracked section label with an icon (`text-xs font-bold tracking-widest`).
pub fn section_label(icon: Option<IconName>, text: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex()
        .items_center()
        .gap_2()
        .tw_text_xs()
        .font_weight(FontWeight::BOLD)
        .text_color(t.muted_foreground)
        .children(icon.map(|i| Icon::new(i).size(px(14.))))
        .child(rexa_ui::tracked_text::tracked(text.to_string(), 0.1))
        .into_any_element()
}

/// `TargetTableSelect`.
pub fn target_table_select(id: &'static str, selected: &str, tables: &[String], loading: bool, on_select: impl Fn(SharedString, &mut Window, &mut App) + 'static, cx: &App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap_4()
        .child(section_label(Some(IconName::Table2), "Target Table", cx))
        .child(
            Select::new(id)
                .w_full()
                .placeholder(if loading { "Loading tables..." } else { "Select a table" })
                .options(tables.iter().map(|t| SelectOption::simple(t.clone())))
                .value(Some(selected.to_string()).filter(|s| !s.is_empty()))
                .on_change(on_select),
        )
        .into_any_element()
}
