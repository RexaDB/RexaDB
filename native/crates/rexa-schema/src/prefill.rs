//! Hand-off of form state to create tabs — the studio-level state the original
//! kept in hooks/use-studio.ts (`newEnumData`/`isEditingEnum` for "Update type",
//! `triggerFormState` for edit/duplicate trigger, `newTableData`).
//!
//! Call a `set_*` then open the create tab (`open_*` do both). A create view that
//! is already open picks the new values up through [`Prefills`]'s events.

use gpui::{App, AppContext, Entity, EventEmitter, Global};
use rexa_core::{open_tab, TabSpec};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EnumPrefill {
    pub schema: String,
    pub name: String,
    pub values: Vec<String>,
    /// "Update type": the original name/values the ALTERs are diffed against.
    pub editing: Option<(String, Vec<String>)>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TriggerPrefill {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub timing: String,
    pub events: Vec<String>,
    pub orientation: String,
    pub function_schema: String,
    pub function_name: String,
    pub enabled: bool,
    /// Edit mode: the trigger being replaced (schema, table, name).
    pub edit: Option<(String, String, String)>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct IndexPrefill {
    pub schema: String,
    pub table: String,
}

#[derive(Default)]
pub struct Prefills {
    pub enum_form: Option<EnumPrefill>,
    pub trigger_form: Option<TriggerPrefill>,
    pub index_form: Option<IndexPrefill>,
    /// create-table: the schema the new table goes into.
    pub table_schema: Option<String>,
}

pub enum PrefillChanged {
    Enum,
    Trigger,
    Index,
}

impl EventEmitter<PrefillChanged> for Prefills {}

struct PrefillsGlobal(Entity<Prefills>);
impl Global for PrefillsGlobal {}

pub fn prefills(cx: &mut App) -> Entity<Prefills> {
    if let Some(g) = cx.try_global::<PrefillsGlobal>() {
        return g.0.clone();
    }
    let e = cx.new(|_| Prefills::default());
    cx.set_global(PrefillsGlobal(e.clone()));
    e
}

pub fn set_enum(p: EnumPrefill, cx: &mut App) {
    prefills(cx).update(cx, |s, cx| {
        s.enum_form = Some(p);
        cx.emit(PrefillChanged::Enum);
    });
}

pub fn take_enum(cx: &mut App) -> Option<EnumPrefill> {
    prefills(cx).update(cx, |s, _| s.enum_form.take())
}

pub fn set_trigger(p: TriggerPrefill, cx: &mut App) {
    prefills(cx).update(cx, |s, cx| {
        s.trigger_form = Some(p);
        cx.emit(PrefillChanged::Trigger);
    });
}

pub fn take_trigger(cx: &mut App) -> Option<TriggerPrefill> {
    prefills(cx).update(cx, |s, _| s.trigger_form.take())
}

pub fn set_index(p: IndexPrefill, cx: &mut App) {
    prefills(cx).update(cx, |s, cx| {
        s.index_form = Some(p);
        cx.emit(PrefillChanged::Index);
    });
}

pub fn take_index(cx: &mut App) -> Option<IndexPrefill> {
    prefills(cx).update(cx, |s, _| s.index_form.take())
}

/// `openEditEnumTab(schema, name, values)`.
pub fn open_edit_enum(schema: &str, name: &str, values: &[String], cx: &mut App) {
    set_enum(
        EnumPrefill {
            schema: schema.into(),
            name: name.into(),
            values: values.to_vec(),
            editing: Some((name.into(), values.to_vec())),
        },
        cx,
    );
    open_tab(TabSpec::Create { object: "enum".into(), schema: Some(schema.into()) }, cx);
}

/// `openCreate*Tab`.
pub fn open_create(object: &str, schema: Option<&str>, cx: &mut App) {
    open_tab(TabSpec::Create { object: object.into(), schema: schema.map(str::to_string) }, cx);
}
