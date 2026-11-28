//! Port of components/studio/database/add-fk-sheet.tsx (`AddFKSheet`) and the studio's
//! `handleAddForeignKey` (hooks/use-studio.ts), plus `useSheetCloseConfirm`
//! (hooks/use-sheet-close-confirm.tsx) for the `confirmSheetClose` setting.
//!
//! The sheet is `contained` (drawn by the owning view over its area). Opened by the
//! schema diagram's drag-to-connect.

use crate::actions;
use crate::sheet::{title_pill, StudioSheet};
use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, Window};
use rexa_core::Session;
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{with_alpha, ActiveTokens, Button, IconName, Label, Select, SelectOption, TextInput, Toast, Tw, MONO};
use std::sync::Arc;

const FK_ACTIONS: [&str; 5] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

/// `newFKData`
#[derive(Clone, Debug, PartialEq)]
pub struct FkData {
    pub source_schema: String,
    pub source_table: String,
    pub source_column: String,
    pub target_schema: String,
    pub target_table: String,
    pub target_column: String,
}

impl FkData {
    pub fn default_constraint_name(&self) -> String {
        format!("fk_{}_{}_{}", self.source_table, self.source_column, self.target_table)
    }
}

pub struct AddFkSheet {
    pub data: FkData,
    name: Entity<InputState>,
    on_update: String,
    on_delete: String,
    saving: bool,
}

/// `studio_settings.<key>` (use-global-studio-settings), read from the app DB.
pub fn studio_setting_bool(key: &str, default: bool) -> bool {
    rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting("studio_settings").ok().flatten())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get(key).and_then(serde_json::Value::as_bool))
        .unwrap_or(default)
}

/// `useSheetCloseConfirm`: close directly, or ask first when dirty and the
/// `confirmSheetClose` setting is on ("Unsaved changes" — Stay / Leave).
pub fn close_with_confirm(dirty: bool, cx: &mut App, close: impl FnOnce(&mut App) + 'static) {
    if !(dirty && studio_setting_bool("confirmSheetClose", false)) {
        close(cx);
        return;
    }
    let ok = rexa_ui::confirm(
        rexa_ui::ConfirmOptions::destructive("Unsaved changes")
            .description("You have unsaved changes. Are you sure you want to leave?")
            .confirm_text("Leave")
            .cancel_text("Stay"),
        cx,
    );
    cx.spawn(async move |cx| {
        if ok.await {
            cx.update(close);
        }
    })
    .detach();
}

impl AddFkSheet {
    pub fn new(data: FkData, window: &mut Window, cx: &mut App) -> Self {
        let default = data.default_constraint_name();
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("fk_table_column_ref").default_value(default));
        Self { data, name, on_update: "NO ACTION".into(), on_delete: "NO ACTION".into(), saving: false }
    }

    pub fn is_dirty(&self, cx: &App) -> bool {
        self.name.read(cx).value().as_ref() != self.data.default_constraint_name() || self.on_update != "NO ACTION" || self.on_delete != "NO ACTION"
    }

    /// The `Preview DDL` text.
    fn preview(&self, name: &str) -> String {
        let d = &self.data;
        format!(
            "ALTER TABLE \"{}\".\"{}\"\nADD CONSTRAINT \"{}\"\nFOREIGN KEY (\"{}\")\nREFERENCES \"{}\".\"{}\" (\"{}\")\nON UPDATE {} ON DELETE {};",
            d.source_schema, d.source_table, name, d.source_column, d.target_schema, d.target_table, d.target_column, self.on_update, self.on_delete
        )
    }
}

/// `handleAddForeignKey`'s statement (quoteTableRef / quoteIdentifier of the connection).
pub fn add_fk_sql(session: &Session, data: &FkData, constraint: &str, on_update: &str, on_delete: &str) -> String {
    let d = session.driver.dialect();
    format!(
        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}) ON UPDATE {} ON DELETE {};",
        d.table_ref(&data.source_schema, &data.source_table),
        d.quote_ident(constraint),
        d.quote_ident(&data.source_column),
        d.table_ref(&data.target_schema, &data.target_table),
        d.quote_ident(&data.target_column),
        on_update,
        on_delete
    )
}

/// Host views implement this to own the sheet state.
pub trait FkSheetHost: Sized + 'static {
    fn fk_sheet(&mut self) -> &mut Option<AddFkSheet>;
    fn session(&self) -> Arc<Session>;
    /// After a successful direct-mode create (`loadSchemaData`).
    fn on_fk_created(&mut self, cx: &mut Context<Self>);
}

fn confirm<V: FkSheetHost>(v: &mut V, cx: &mut Context<V>) {
    let session = v.session();
    let Some(sheet) = v.fk_sheet().as_mut() else { return };
    if sheet.saving {
        return;
    }
    let name = sheet.name.read(cx).value().to_string();
    let data = sheet.data.clone();
    let sql = add_fk_sql(&session, &data, &name, &sheet.on_update, &sheet.on_delete);
    let description = format!("Add foreign key from {}.{} to {}.{}", data.source_table, data.source_column, data.target_table, data.target_column);
    if rexa_core::review::add_review_action(rexa_core::review::ReviewAction::new("add_fk", description, sql.clone()), cx) {
        *v.fk_sheet() = None;
        cx.notify();
        return;
    }
    sheet.saving = true;
    cx.notify();
    let task = actions::exec(&session, sql);
    cx.spawn(async move |this, cx| {
        let result = task.await;
        this.update(cx, |v, cx| {
            match result {
                Ok(()) => {
                    Toast::success("Foreign key added successfully").show(cx);
                    *v.fk_sheet() = None;
                    rexa_core::emit_studio(rexa_core::StudioEvent::SchemaChanged, cx);
                    v.on_fk_created(cx);
                }
                Err(e) => {
                    if let Some(s) = v.fk_sheet().as_mut() {
                        s.saving = false;
                    }
                    let msg = format!("{e:#}");
                    Toast::error(if msg.is_empty() { "Failed to add foreign key".into() } else { msg }).show(cx);
                }
            }
            cx.notify();
        })
        .ok();
    })
    .detach();
}

/// Close (Cancel / ×) — immediate, as the original's buttons call `onOpenChange(false)`.
fn close<V: FkSheetHost>(v: &mut V, cx: &mut Context<V>) {
    *v.fk_sheet() = None;
    cx.notify();
}

/// Outside interaction: honours `confirmSheetClose` when dirty.
pub fn interact_outside<V: FkSheetHost>(v: &mut V, cx: &mut Context<V>) {
    let Some(sheet) = v.fk_sheet().as_ref() else { return };
    let dirty = sheet.is_dirty(cx);
    let this = cx.entity();
    close_with_confirm(dirty, cx, move |cx| {
        this.update(cx, |v, cx| close(v, cx));
    });
}

fn action_select<V: FkSheetHost>(id: &'static str, label: &'static str, value: String, update: bool, this: Entity<V>) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .child(Label::new(label))
        .child(
            Select::new(id)
                .w_full()
                .small()
                .placeholder("Select action")
                .options(FK_ACTIONS.map(SelectOption::simple))
                .value(Some(value))
                .on_change(move |v, _, cx| {
                    this.update(cx, |host, cx| {
                        if let Some(s) = host.fk_sheet().as_mut() {
                            if update {
                                s.on_update = v.to_string();
                            } else {
                                s.on_delete = v.to_string();
                            }
                        }
                        cx.notify();
                    });
                }),
        )
        .into_any_element()
}

/// Render the open sheet (contained, `sm:max-w-md`).
pub fn render<V: FkSheetHost>(v: &mut V, cx: &mut Context<V>) -> Option<AnyElement> {
    let this = cx.entity();
    let t = cx.tokens().clone();
    let sheet = v.fk_sheet().as_ref()?;
    let d = sheet.data.clone();
    let name = sheet.name.read(cx).value().to_string();
    let preview = sheet.preview(&name);
    let saving = sheet.saving;
    let (on_update, on_delete) = (sheet.on_update.clone(), sheet.on_delete.clone());
    let name_input = sheet.name.clone();
    let mono_primary = |s: String| div().font_family(MONO).text_color(t.primary).child(s);
    let (c1, c2, c3, c4) = (this.clone(), this.clone(), this.clone(), this.clone());
    Some(
        StudioSheet::new("add-fk-sheet")
            .width(448.)
            .title_el(div().flex().min_w_0().items_center().gap_2().child(Icon::new(IconName::Link2).size_5().text_color(t.primary)).child(title_pill("Create Foreign Key".into())))
            .contained(move |_, cx| c1.update(cx, |v, cx| close(v, cx)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_6()
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .tw_text_sm()
                            .text_color(t.muted_foreground)
                            .child("Creating a relationship between\u{a0}")
                            .child(mono_primary(format!("{}.{}", d.source_table, d.source_column)))
                            .child("\u{a0}and\u{a0}")
                            .child(mono_primary(format!("{}.{}", d.target_table, d.target_column)))
                            .child("."),
                    )
                    .child(div().flex().flex_col().gap_2().child(Label::new("Constraint Name")).child(div().font_family(MONO).tw_text_xs().child(TextInput::new(&name_input))))
                    .child(
                        div()
                            .flex()
                            .gap_4()
                            .child(div().flex_1().child(action_select("fk-on-update", "On Update", on_update, true, c2)))
                            .child(div().flex_1().child(action_select("fk-on-delete", "On Delete", on_delete, false, c3))),
                    )
                    .child(
                        div()
                            .p_4()
                            .tw_rounded_lg()
                            .bg(with_alpha(t.muted, 0.5))
                            .border_1()
                            .border_color(with_alpha(t.border, 0.5))
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().tw_text_xs().font_weight(FontWeight::BOLD).text_color(t.muted_foreground).child("Preview DDL"))
                            .child(div().text_size(px(12.)).line_height(px(19.5)).font_family(MONO).text_color(with_alpha(t.primary, 0.9)).child(preview)),
                    ),
            )
            .footer(
                div()
                    .flex()
                    .gap_2()
                    .w_full()
                    .child(div().flex_1().child(Button::new("fk-cancel").outline().w_full().label("Cancel").on_click({
                        let this = this.clone();
                        move |_, _, cx| this.update(cx, |v, cx| close(v, cx))
                    })))
                    .child(div().flex_1().child(Button::new("fk-create").w_full().label("Create Relationship").disabled(saving).on_click(move |_, _, cx| c4.update(cx, |v, cx| confirm(v, cx))))),
            )
            .into_any_element(),
    )
}
