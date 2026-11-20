//! Port of schema tooling: components/studio/{create-*-view,create-object-common,
//! erd/,data-catalog-view,database/}, components/studio/grid/{add,edit}-column-sheet,
//! components/connections/connection-schema-compare-screen, lib/dictionary.
//!
//! Tabs this crate builds (see `rexa-studio/src/lib.rs` for the hosting contract):
//! - `TabSpec::Create { object }` for `create-{table,index,enum,schema,trigger,database}`.
//! - `TabSpec::View { view: "database-<view>" }` for the database object lists
//!   (tables, functions, triggers, enums, indexes, extensions, sequences,
//!   packages, synonyms, db-links, materialized-views, rls-policies, sessions,
//!   locks, catalog, schema) and `database-object` / `rls-policy-edit`.
//! - `TabSpec::Erd { schema }` (schema diagram fallback).
//!
//! Screens: `Route::ConnectionScreen("compare")` (schema compare).
//!
//! Public API for other crates:
//! - [`open_add_column_sheet`] / [`open_edit_column_sheet`]: the grid's
//!   add/edit column sheets (add-column-sheet.tsx / edit-column-sheet.tsx).
//! - [`prefill`]: hand values to a create tab before opening it (edit enum,
//!   edit/duplicate trigger).

pub mod actions;
pub mod column_sheet;
pub mod column_types;
pub mod common;
pub mod create;
pub mod data_table;
pub mod erd;
pub mod lists;
pub mod object_view;
pub mod prefill;
pub mod sheet;

pub use column_sheet::{open_add_column_sheet, open_edit_column_sheet, ColumnSheetTarget};

use gpui::{AnyView, App, AppContext, Window};
use rexa_core::{Registry, Session, TabSpec};
use std::sync::Arc;

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-schema", build_tab);
}

fn str_param(params: &serde_json::Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

fn build_tab(spec: &TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    match spec {
        TabSpec::View { view, params } => {
            let schema = str_param(params, "schema");
            if view == "database-object" {
                return Some(object_view::build(params, window, cx));
            }
            if view == "rls-policy-edit" {
                let spec = spec.clone();
                return Some(cx.new(|cx| lists::rls::RlsPolicyEditorView::new(spec, params, session, window, cx)).into());
            }
            let v = view.strip_prefix("database-")?;
            lists::build(v, spec, schema, params, session, window, cx)
        }
        TabSpec::Erd { schema } => Some(erd::build(spec, Some(schema.clone()), session, cx)),
        TabSpec::Create { object, schema } => create::build(object, schema.clone(), spec, session, window, cx),
        _ => None,
    }
}

#[allow(unused)]
fn _new<V: 'static + gpui::Render>(cx: &mut App, f: impl FnOnce(&mut gpui::Context<V>) -> V) -> AnyView {
    cx.new(f).into()
}
