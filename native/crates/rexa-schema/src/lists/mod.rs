//! The `database-<view>` tabs of studio-main-content.tsx (`renderPaneBody`'s
//! `paneViewMode === "database"` branch) and their shared per-tab state: the
//! schema filter (`selectedSchema`), the search box, sort/page state, and
//! reloads on `SchemaChanged` / `REFRESH_CURRENT_TAB`.

pub mod catalog_list;
pub mod enums;
pub mod extensions;
pub mod functions;
pub mod indexes;
pub mod triggers;

use crate::common;
use crate::data_table::TableState;
use gpui::{AnyView, App, AppContext, Context, Entity, Window};
use rexa_core::{studio_bus, Session, StudioEvent, TabSpec};
use rexa_ui::widgets::{InputEvent, InputState};
use std::sync::Arc;

/// State every list tab shares.
pub struct ListBase {
    pub spec: TabSpec,
    pub session: Arc<Session>,
    pub schemas: Vec<String>,
    pub schema: String,
    pub search: Entity<InputState>,
    pub table: Entity<TableState>,
    pub loading: bool,
    pub loaded_once: bool,
    pub error: Option<String>,
    _subs: Vec<gpui::Subscription>,
}

pub trait ListView: gpui::Render + Sized + 'static {
    fn base(&mut self) -> &mut ListBase;
    /// (Re)fetch the list for `base().schema`.
    fn load(&mut self, cx: &mut Context<Self>);
}

impl ListBase {
    pub fn new<V: ListView>(
        spec: TabSpec,
        session: Arc<Session>,
        schema: Option<String>,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<V>,
    ) -> Self {
        let placeholder = placeholder.to_string();
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let table = cx.new(|_| TableState { sort: None, page: 1 });
        let mut subs = vec![
            cx.subscribe(&search, |v: &mut V, _, e: &InputEvent, cx| {
                if matches!(e, InputEvent::Change) {
                    v.base().table.update(cx, |t, _| t.reset_page());
                }
                cx.notify()
            }),
            cx.observe(&table, |_, _, cx| cx.notify()),
        ];
        let my_spec = spec.clone();
        subs.push(cx.subscribe(&studio_bus(cx), move |v: &mut V, _, e: &StudioEvent, cx| match e {
            StudioEvent::SchemaChanged => v.load(cx),
            StudioEvent::TabCommand { tab, command } if *tab == my_spec && command == "REFRESH_CURRENT_TAB" => v.load(cx),
            _ => {}
        }));
        let schema = schema.unwrap_or_else(|| common::default_schema(&session));
        // fetchSchemas for the schema filter.
        let task = common::load_schemas(&session);
        cx.spawn(async move |this, cx| {
            if let Ok(list) = task.await {
                this.update(cx, |v, cx| {
                    v.base().schemas = list;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
        ListBase {
            spec,
            session,
            schemas: Vec::new(),
            schema,
            search,
            table,
            loading: true,
            loaded_once: false,
            error: None,
            _subs: subs,
        }
    }

    pub fn query(&self, cx: &App) -> String {
        self.search.read(cx).value().to_string()
    }

    pub fn set_schema<V: ListView>(v: &mut V, schema: String, cx: &mut Context<V>) {
        let b = v.base();
        if b.schema == schema {
            return;
        }
        b.schema = schema;
        b.table.update(cx, |t, _| t.reset_page());
        v.load(cx);
        cx.notify();
    }
}

/// Spawn a catalog fetch and store its result with `apply`.
pub fn fetch<V: ListView, T: Send + 'static>(
    cx: &mut Context<V>,
    fut: impl std::future::Future<Output = anyhow::Result<T>> + 'static,
    apply: impl FnOnce(&mut V, T) + 'static,
) {
    cx.spawn(async move |this, cx| {
        let r = fut.await;
        this.update(cx, |v, cx| {
            let b = v.base();
            b.loading = false;
            b.loaded_once = true;
            match r {
                Ok(data) => {
                    v.base().error = None;
                    apply(v, data);
                }
                Err(e) => {
                    let msg = format!("{e:#}");
                    v.base().error = Some(msg.clone());
                    rexa_ui::Toast::error(msg).show(cx);
                }
            }
            cx.notify();
        })
        .ok();
    })
    .detach();
}

pub fn build(
    view: &str,
    spec: &TabSpec,
    schema: Option<String>,
    _params: &serde_json::Value,
    session: Arc<Session>,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyView> {
    let spec = spec.clone();
    Some(match view {
        "indexes" => cx.new(|cx| indexes::IndexesList::new(spec, session, schema, window, cx)).into(),
        "extensions" => cx.new(|cx| extensions::ExtensionsList::new(spec, session, schema, window, cx)).into(),
        "packages" | "sequences" | "synonyms" | "db-links" | "materialized-views" => {
            use catalog_list::{CatalogKind as K, CatalogList};
            let k = match view {
                "packages" => K::Packages,
                "sequences" => K::Sequences,
                "synonyms" => K::Synonyms,
                "db-links" => K::DbLinks,
                _ => K::MaterializedViews,
            };
            cx.new(|cx| CatalogList::new(k, spec, session, schema, window, cx)).into()
        }
        "triggers" => cx.new(|cx| triggers::TriggersList::new(spec, session, schema, window, cx)).into(),
        "functions" => cx.new(|cx| functions::FunctionsList::new(spec, session, schema, window, cx)).into(),
        "enums" => cx.new(|cx| enums::EnumsList::new(spec, session, schema, window, cx)).into(),
        _ => return None,
    })
}
