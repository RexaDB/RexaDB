//! Port of app/studio/[id]/StudioClient.tsx, hooks/use-studio-bootstrap.ts,
//! hooks/use-studio-title.ts and the tab / sidebar / split state of
//! hooks/use-studio.ts. `Studio` owns the workspace for one connection; the
//! render code lives in the sibling modules (rail, header, sidebar, …).

use crate::catalog::{self, DbObject};
use crate::keybindings::{self, Keybindings};
use crate::persistence::{self, GlobalStudioSettings};
use crate::split_layout::{SplitDirection, SplitViewState, PANE_TAB_DELIMITER};
use crate::tabs::{self, StudioTab};
use gpui::{
    AnyView, App, AppContext, Context, Entity, FocusHandle, Focusable, Pixels, Point, SharedString,
    Subscription, Task, Window,
};
use rexa_core::{runtime, studio_bus, Registry, Session, StudioEvent, TabSpec};
use rexa_drivers::TableRef;
use rexa_store::{SavedConnection, Store};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

pub enum Phase {
    Loading,
    Error(SharedString),
    Ready,
}

/// Table-type filter of the tables filter menu (lib/studio/table-filter.ts).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TypeFilter {
    All,
    Tables,
    Views,
}

/// Open popup menu (context menu or dropdown) — see menu.rs.
pub struct OpenMenu {
    pub id: SharedString,
    pub position: Point<Pixels>,
    pub min_width: f32,
    pub items: Vec<crate::menu::MenuEntry>,
    /// Submenu index currently expanded.
    pub open_sub: Option<usize>,
}

pub enum Dialog {
    Rename { title: SharedString, target: RenameTarget },
    ConfirmDanger { title: SharedString, description: SharedString, confirm: SharedString, action: ConfirmAction },
    TagManager { color: SharedString },
}

#[derive(Clone)]
pub enum RenameTarget {
    Tag(String),
}

#[derive(Clone)]
pub enum ConfirmAction {
    TruncateTable(String, String),
    DropTable(String, String),
}

pub struct Studio {
    pub connection_id: i64,
    pub connection: Option<SavedConnection>,
    pub connections: Vec<SavedConnection>,
    pub phase: Phase,
    pub session: Option<Arc<Session>>,
    pub db_type: &'static str,
    pub focus: FocusHandle,

    // tabs (use-studio.ts openTabs / activeTabId / splitView)
    pub tabs: Vec<StudioTab>,
    pub active_tab_id: Option<String>,
    pub split: SplitViewState,
    pub views: HashMap<String, AnyView>,
    pub tab_drag_over: Option<String>,
    pub split_extents: HashMap<String, f32>,

    // sidebar
    pub sidebar_view: Option<String>,
    pub sidebar_visible: bool,
    pub sidebar_width: f32,
    pub sidebar_sort_mode: String,
    pub rail_order: Vec<String>,

    // Modern UI chrome (modern-ui-shell.tsx)
    pub activity_bar_open: bool,
    pub status_bar_open: bool,
    pub panel_open: bool,
    pub ai_open: bool,
    pub sql_sheet_open: bool,
    pub threads_open: bool,
    pub ai_width: f32,
    pub sql_sheet_width: f32,
    pub threads_width: f32,
    pub panel_height: f32,
    pub panel_views: HashMap<&'static str, AnyView>,
    pub settings_section: Option<String>,
    pub settings_view: Option<AnyView>,
    pub resize: Option<crate::resize::Drag>,

    // catalog
    pub schemas: Vec<String>,
    pub selected_schema: Option<String>,
    pub tables: Vec<TableRef>,
    pub fetching_tables: bool,
    pub fetching_schemas: bool,
    pub objects: Vec<DbObject>,
    pub databases: Vec<String>,
    pub current_database: String,
    pub selected_table: Option<String>,
    pub tags: Vec<(String, String)>,
    pub lists: crate::sidebar::SideLists,
    pub table_tags: HashMap<String, Vec<String>>,

    // explorer UI state (TablesPanel)
    pub search: Entity<gpui_component::input::InputState>,
    pub type_filter: TypeFilter,
    pub case_sensitive: bool,
    pub wildcards: bool,
    pub expanded_sections: HashMap<String, bool>,
    pub expanded_tags: HashMap<String, bool>,
    pub tag_input: Entity<gpui_component::input::InputState>,

    // overlays
    pub menu: Option<OpenMenu>,
    pub command_menu: Option<crate::command_menu::CommandMenuState>,
    pub dialog: Option<Dialog>,

    pub keybindings: Keybindings,
    pub settings: GlobalStudioSettings,
    save_task: Option<Task<()>>,
    /// Dev aid: REXA_STUDIO_DEV=<scenario> (see shell.rs `run_dev`).
    pub dev_scenario: Option<String>,
    _subs: Vec<Subscription>,
}

impl Focusable for Studio {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Studio {
    pub fn new(connection_id: i64, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let connections = Store::open().and_then(|s| s.connections()).unwrap_or_default();
        let connection = connections.iter().find(|c| c.id == connection_id).cloned();
        let kind = connection
            .as_ref()
            .and_then(|c| rexa_drivers::Kind::detect(&c.kind, &c.connection_string));
        let db_type = match (&connection, kind) {
            (Some(c), Some(k)) => catalog::db_type(&c.kind, k),
            _ => "postgres",
        };
        let ui = persistence::load(connection_id, db_type);
        let mut split = ui.split_view.clone().unwrap_or_else(|| SplitViewState::new(ui.active_tab_id.clone()));
        let ids: Vec<String> = ui.tabs.iter().map(|t| t.id.clone()).collect();
        split = split.normalize(&ids, ui.active_tab_id.as_deref());

        let settings = persistence::global_settings();
        let search_placeholder = if settings.schema_explorer { "Search..." } else if db_type == "redis" { "Search keys..." } else { "Search tables..." };
        let search = cx.new(|cx| gpui_component::input::InputState::new(window, cx).placeholder(search_placeholder));
        let tag_input = cx.new(|cx| gpui_component::input::InputState::new(window, cx).placeholder("New tag name…"));
        let mut subs = Vec::new();
        subs.push(cx.subscribe(&search, |_, _, _: &gpui_component::input::InputEvent, cx| cx.notify()));
        subs.push(cx.subscribe_in(&studio_bus(cx), window, Self::on_bus));
        let settings_model = rexa_settings::model::SettingsModel::global(cx);
        subs.push(cx.subscribe(&settings_model, |this, _, event: &rexa_settings::model::SettingsChanged, cx| {
            this.settings = persistence::global_settings();
            if event.key == "schemaExplorer" { this.refresh_tables(cx); }
            cx.notify();
        }));
        let (tags, table_tags) = persistence::load_tags(connection_id);
        let rail_order = persistence::local_get(persistence::RAIL_ORDER_KEY)
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();

        if let Some(c) = &connection {
            window.set_window_title(if c.name.is_empty() { "Rexa DB Studio" } else { &c.name });
        } else {
            window.set_window_title("Connection not found");
        }

        let mut this = Self {
            connection_id,
            connection: connection.clone(),
            connections,
            phase: Phase::Loading,
            session: None,
            db_type,
            focus: cx.focus_handle(),
            tabs: ui.tabs,
            active_tab_id: ui.active_tab_id,
            split,
            views: HashMap::new(),
            tab_drag_over: None,
            split_extents: HashMap::new(),
            sidebar_view: ui.sidebar_view,
            sidebar_visible: ui.sidebar_visible,
            sidebar_width: 256.,
            sidebar_sort_mode: ui.sidebar_sort_mode,
            rail_order,
            activity_bar_open: true,
            status_bar_open: true,
            panel_open: false,
            ai_open: false,
            sql_sheet_open: false,
            threads_open: false,
            ai_width: 400.,
            sql_sheet_width: 480.,
            threads_width: 300.,
            panel_height: 240.,
            panel_views: HashMap::new(),
            settings_section: None,
            settings_view: None,
            resize: None,
            schemas: Vec::new(),
            selected_schema: None,
            tables: Vec::new(),
            fetching_tables: false,
            fetching_schemas: false,
            objects: Vec::new(),
            databases: Vec::new(),
            current_database: String::new(),
            selected_table: None,
            tags,
            lists: crate::sidebar::SideLists::load(connection_id),
            table_tags,
            search,
            type_filter: TypeFilter::All,
            case_sensitive: false,
            wildcards: true,
            expanded_sections: HashMap::from([("tables".to_string(), true)]),
            expanded_tags: HashMap::new(),
            tag_input,
            menu: None,
            command_menu: None,
            dialog: None,
            keybindings: keybindings::load(),
            settings,
            save_task: None,
            dev_scenario: None,
            _subs: subs,
        };
        match connection {
            Some(c) => this.connect(c, cx),
            None => this.phase = Phase::Error("Connection not found.".into()),
        }
        this.focus.focus(window, cx);
        this
    }

    // ---- bootstrap ------------------------------------------------------------

    fn connect(&mut self, connection: SavedConnection, cx: &mut Context<Self>) {
        let task = rexa_core::connect(connection, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(session) => {
                        this.session = Some(session);
                        this.phase = Phase::Ready;
                        this.load_schemas(cx);
                    }
                    Err(err) => this.phase = Phase::Error(format!("{err:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn load_schemas(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        self.fetching_schemas = true;
        let driver = session.driver.clone();
        let task = runtime::spawn(async move {
            let schemas = driver.schemas().await?;
            let current = catalog::current_database(driver.clone()).await;
            let dbs = catalog::load_databases(driver).await.unwrap_or_default();
            anyhow::Ok((schemas, current, dbs))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.fetching_schemas = false;
                if let Ok((schemas, current, (dbs, _))) = result {
                    // getStudioBootstrap: requested → active tab's schema → public → first.
                    let active_schema = this.active_tab().and_then(|t| t.schema.clone());
                    let pick = this
                        .selected_schema
                        .clone()
                        .filter(|s| schemas.contains(s))
                        .or(active_schema.filter(|s| schemas.contains(s)))
                        .or_else(|| schemas.iter().find(|s| *s == "public").cloned())
                        .or_else(|| schemas.first().cloned());
                    this.schemas = schemas;
                    this.current_database = current;
                    this.databases = dbs;
                    if let Some(s) = pick {
                        this.set_selected_schema(s, cx);
                    }
                    this.dev_scenario = std::env::var("REXA_STUDIO_DEV").ok();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn set_selected_schema(&mut self, schema: String, cx: &mut Context<Self>) {
        self.selected_schema = Some(schema);
        self.refresh_tables(cx);
    }

    /// refreshTablesSidebar
    pub fn refresh_tables(&mut self, cx: &mut Context<Self>) {
        let (Some(session), Some(schema)) = (self.session.clone(), self.selected_schema.clone()) else { return };
        self.fetching_tables = true;
        cx.notify();
        let driver = session.driver.clone();
        let want_objects = self.settings.schema_explorer;
        let s2 = schema.clone();
        let task = runtime::spawn(async move {
            let tables = driver.tables(&s2).await?;
            let objects = if want_objects { catalog::load_objects(driver, s2).await.unwrap_or_default() } else { Vec::new() };
            anyhow::Ok((tables, objects))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.selected_schema.as_deref() != Some(schema.as_str()) {
                    return;
                }
                this.fetching_tables = false;
                if let Ok((tables, objects)) = result {
                    this.tables = tables;
                    this.objects = objects;
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    // ---- bus --------------------------------------------------------------------

    fn on_bus(&mut self, _: &Entity<rexa_core::StudioBus>, event: &StudioEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            StudioEvent::OpenTab(spec) => {
                if let TabSpec::Settings { section } = spec {
                    if tabs::spec_to_tab(spec).is_none() {
                        self.open_settings(Some(section.clone()), window, cx);
                        return;
                    }
                }
                if let Some(tab) = tabs::spec_to_tab(spec) {
                    let preview = matches!(spec, TabSpec::Table { .. }) && self.settings.preview_tabs;
                    self.open_tab(tab, preview, cx);
                }
            }
            StudioEvent::CloseTab(spec) => {
                if let Some(id) = self.tabs.iter().find(|t| tabs::spec_matches(spec, t)).map(|t| t.id.clone()) {
                    self.close_tab(&id, cx);
                }
            }
            StudioEvent::SchemaChanged => {
                self.load_schemas(cx);
            }
            StudioEvent::NotesChanged { connection_id } if *connection_id == self.connection_id => {
                self.lists.notes = crate::sidebar::SideLists::load(self.connection_id).notes;
                cx.notify();
            }
            StudioEvent::NotesChanged { .. } => {}
            StudioEvent::WorkflowsChanged { connection_id } if *connection_id == self.connection_id => {
                self.lists.workflows = crate::sidebar::SideLists::load(self.connection_id).workflows;
                cx.notify();
            }
            StudioEvent::WorkflowsChanged { .. } => {}
            StudioEvent::MarkDirty { tab, dirty } => {
                let mut changed = false;
                for t in self.tabs.iter_mut().filter(|t| tabs::spec_matches(tab, t)) {
                    if t.is_dirty() != *dirty {
                        t.dirty = Some(*dirty);
                        if *dirty {
                            t.is_preview = Some(false);
                        }
                        changed = true;
                    }
                }
                if changed {
                    self.persist(cx);
                }
            }
            StudioEvent::RenameTab { tab, title } => {
                for t in self.tabs.iter_mut().filter(|t| tabs::spec_matches(tab, t)) {
                    t.name = title.clone();
                }
                self.persist(cx);
            }
            StudioEvent::TabParamsChanged { tab, patch } => {
                for t in self.tabs.iter_mut().filter(|t| tabs::spec_matches(tab, t)) {
                    if let Some(fields) = patch.as_object() {
                        for (key, value) in fields {
                            t.extra.insert(key.clone(), value.clone());
                        }
                    }
                }
                self.persist(cx);
            }
            StudioEvent::QueryChanged { id, sql } => {
                for t in self.tabs.iter_mut().filter(|t| t.kind == "sql" && (t.id == *id || t.base() == id)) {
                    t.query = Some(sql.clone());
                }
                self.persist(cx);
            }
            StudioEvent::OpenSettings { section } => self.open_settings(section.clone(), window, cx),
            StudioEvent::TabCommand { .. } => {}
        }
    }

    // ---- tabs ------------------------------------------------------------------

    pub fn active_tab(&self) -> Option<&StudioTab> {
        self.active_tab_id.as_ref().and_then(|id| self.tabs.iter().find(|t| &t.id == id))
    }

    pub fn tab_ids(&self) -> Vec<String> {
        self.tabs.iter().map(|t| t.id.clone()).collect()
    }

    pub fn current_pane(&self) -> String {
        self.split.active_pane_id.clone()
    }

    /// Persist: local keys right away, shared tables after 1 s (use-studio-data-persistence.ts).
    pub fn persist(&mut self, cx: &mut Context<Self>) {
        persistence::save_local_tabs(self.connection_id, &self.tabs, self.active_tab_id.as_deref());
        persistence::save_local_sidebar(self.connection_id, self.sidebar_view.as_deref(), self.sidebar_visible);
        let (id, tabs, active, view, sort, split) = (
            self.connection_id,
            self.tabs.clone(),
            self.active_tab_id.clone(),
            self.sidebar_view.clone(),
            self.sidebar_sort_mode.clone(),
            self.split.clone(),
        );
        self.save_task = Some(cx.spawn(async move |_, cx| {
            cx.background_executor().timer(Duration::from_millis(1000)).await;
            cx.background_executor()
                .spawn(async move {
                    if let Err(e) = persistence::save_shared_tabs(id, &tabs) {
                        eprintln!("[rexadb] Failed to save tabs for connection {id}: {e:#}");
                    }
                    if let Err(e) = persistence::save_shared_settings(id, active.as_deref(), view.as_deref(), &sort, &split) {
                        eprintln!("[rexadb] Failed to save settings for connection {id}: {e:#}");
                    }
                })
                .await;
        }));
        cx.notify();
    }

    /// switchTab
    pub fn switch_tab(&mut self, id: &str, cx: &mut Context<Self>) {
        if !self.tabs.iter().any(|t| t.id == id) {
            return;
        }
        let pane = self.split.pane_for_tab(id);
        self.split = self.split.assign_tab(id, &pane, true);
        self.active_tab_id = Some(id.to_string());
        if let Some(t) = self.tabs.iter().find(|t| t.id == id) {
            if t.kind == "table" {
                self.selected_table = Some(t.name.clone());
            }
        }
        self.persist(cx);
    }

    fn pane_scoped_id(&self, base: &str) -> String {
        if self.split.enabled {
            format!("{base}{PANE_TAB_DELIMITER}{}", self.current_pane())
        } else {
            base.to_string()
        }
    }

    /// addTabAndSwitch / buildNewTabs (preview tabs replace the current preview).
    pub fn open_tab(&mut self, mut tab: StudioTab, preview: bool, cx: &mut Context<Self>) {
        if let Some(existing) = self.tabs.iter().find(|t| t.id == tab.id || (t.base() == tab.base() && t.kind == tab.kind && self.split.pane_for_tab(&t.id) == self.current_pane())) {
            let id = existing.id.clone();
            self.switch_tab(&id, cx);
            return;
        }
        if self.split.enabled && !tab.id.contains(PANE_TAB_DELIMITER) && matches!(tab.kind.as_str(), "sql" | "table" | "workflow" | "dashboard" | "note") {
            if tab.base_id.is_none() && tab.kind == "table" {
                tab.base_id = Some(tab.id.clone());
            }
            tab.id = self.pane_scoped_id(&tab.id);
        }
        let id = tab.id.clone();
        if preview && self.settings.preview_tabs {
            tab.is_preview = Some(true);
            if let Some(idx) = self.tabs.iter().position(|t| t.is_preview() && !t.is_pinned() && !t.is_dirty()) {
                let old = self.tabs[idx].id.clone();
                self.views.remove(&old);
                self.tabs[idx] = tab;
            } else {
                self.tabs.push(tab);
            }
        } else {
            self.tabs.push(tab);
        }
        let pane = self.current_pane();
        self.split = self.split.assign_tab(&id, &pane, true);
        self.switch_tab(&id, cx);
    }

    /// handleTableClick
    pub fn open_table(&mut self, table: &str, schema: Option<&str>, cx: &mut Context<Self>) {
        let schema = schema.map(str::to_string).or_else(|| self.selected_schema.clone()).unwrap_or_default();
        let base = format!("table-{schema}-{table}");
        let pane = self.current_pane();
        if let Some(t) = self.tabs.iter().find(|t| t.kind == "table" && t.base() == base && self.split.pane_for_tab(&t.id) == pane) {
            let id = t.id.clone();
            return self.switch_tab(&id, cx);
        }
        if let Some(t) = self.tabs.iter().find(|t| t.kind == "table" && t.base() == base) {
            let id = t.id.clone();
            return self.switch_tab(&id, cx);
        }
        let mut tab = StudioTab::new(base.clone(), "table", table);
        tab.base_id = Some(base);
        tab.schema = Some(schema);
        self.selected_table = Some(table.to_string());
        self.open_tab(tab, true, cx);
    }

    /// openSqlEditor
    pub fn open_sql_editor(&mut self, table: Option<&str>, schema: Option<&str>, initial: Option<String>, cx: &mut Context<Self>) {
        let query = initial.unwrap_or_else(|| match self.db_type {
            "mongodb" => format!("db.{}.find({{}}).limit(100)", table.unwrap_or("collection")),
            "redis" => "PING".into(),
            _ => match (table, schema, &self.session) {
                (Some(t), Some(s), Some(session)) => {
                    let d = &session.driver;
                    let qualified = if s.is_empty() { d.quote_ident(t) } else { format!("{}.{}", d.quote_ident(s), d.quote_ident(t)) };
                    format!("SELECT * FROM {qualified} LIMIT 100")
                }
                _ => String::new(),
            },
        });
        let name = match self.db_type {
            "mongodb" => "New JSON Query",
            "redis" => "New Command",
            _ => "New Query",
        };
        let mut tab = StudioTab::new(format!("sql-new-{}", tabs::uid()), "sql", name);
        tab.query = Some(query);
        self.open_tab(tab, false, cx);
    }

    /// openSimpleTab / openDatabaseTab / create tabs
    pub fn open_simple(&mut self, kind: &str, cx: &mut Context<Self>) {
        let name = tabs::config(kind).map_or(kind, |c| c.default_name).to_string();
        let name = if kind == "database-tables" && self.db_type == "mongodb" { "Collections List".to_string() } else { name };
        let mut tab = StudioTab::new(kind, kind, name);
        if kind.starts_with("create-") || kind.starts_with("database-") {
            tab.schema = self.selected_schema.clone();
        }
        self.open_tab(tab, false, cx);
    }

    pub fn open_database_tab(&mut self, view: &str, cx: &mut Context<Self>) {
        self.open_simple(&format!("database-{view}"), cx);
    }

    pub fn open_object_tab(&mut self, object: &DbObject, cx: &mut Context<Self>) {
        let mut tab = StudioTab::new(object.tab_id(), "database-object", object.name.clone());
        tab.schema = Some(object.schema.clone());
        tab.extra.insert("databaseObject".into(), object.to_json());
        self.open_tab(tab, true, cx);
    }

    /// closeTabById
    pub fn close_tab(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(closed) = self.tabs.iter().find(|t| t.id == id).cloned() else { return };
        if closed.is_pinned() {
            return;
        }
        let ids = self.tab_ids();
        let r = crate::split_layout::resolve_tab_close(self.active_tab_id.as_deref(), id, &ids, &self.split);
        let mut next_split = r.next_split_view;
        let mut next_ids = r.next_tab_ids;
        let mut focus = r.next_focused_tab_id;
        let mut removed = vec![id.to_string()];
        // tryAutoClosePane: an emptied split pane closes itself.
        if self.settings.auto_close_pane && next_split.enabled && next_split.tabs_for_pane(&next_ids, &r.closed_pane_id).is_empty() {
            let (remaining, gone, s, a) = crate::split_layout::resolve_pane_close(&next_ids, &next_split, &r.closed_pane_id);
            next_ids = remaining;
            removed.extend(gone);
            next_split = s;
            focus = a;
        }
        self.tabs.retain(|t| next_ids.contains(&t.id));
        for r in &removed {
            self.views.remove(r);
        }
        self.split = next_split;
        if self.active_tab_id.as_deref() == Some(id) || removed.iter().any(|r| Some(r.as_str()) == self.active_tab_id.as_deref()) {
            self.active_tab_id = None;
            if closed.kind == "table" {
                self.selected_table = None;
            }
            if let Some(f) = focus.filter(|f| self.tabs.iter().any(|t| &t.id == f)) {
                return self.switch_tab(&f, cx);
            }
        }
        self.persist(cx);
    }

    pub fn close_active_tab(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.active_tab_id.clone() {
            self.close_tab(&id, cx);
        }
    }

    /// togglePinTab: pinned tabs move to the front.
    pub fn toggle_pin(&mut self, id: &str, cx: &mut Context<Self>) {
        for t in self.tabs.iter_mut().filter(|t| t.id == id) {
            t.pinned = Some(!t.is_pinned());
            t.is_preview = Some(false);
        }
        let (pinned, rest): (Vec<_>, Vec<_>) = self.tabs.drain(..).partition(|t| t.is_pinned());
        self.tabs = pinned.into_iter().chain(rest).collect();
        self.persist(cx);
    }

    /// confirmPreviewTab (double-click a preview tab)
    pub fn confirm_preview(&mut self, id: &str, cx: &mut Context<Self>) {
        for t in self.tabs.iter_mut().filter(|t| t.id == id && t.is_preview()) {
            t.is_preview = Some(false);
        }
        self.persist(cx);
    }

    /// onReorderTab (app-shell drag reorder)
    pub fn reorder_tab(&mut self, source: &str, target: &str, cx: &mut Context<Self>) {
        let (Some(from), Some(to)) = (self.tabs.iter().position(|t| t.id == source), self.tabs.iter().position(|t| t.id == target)) else { return };
        if from == to {
            return;
        }
        let moved = self.tabs.remove(from);
        self.tabs.insert(to, moved);
        self.persist(cx);
    }

    /// goToRelativeTab
    pub fn go_relative(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.tabs.is_empty() {
            return;
        }
        let idx = self.active_tab_id.as_ref().and_then(|a| self.tabs.iter().position(|t| &t.id == a)).unwrap_or(0) as isize;
        let n = self.tabs.len() as isize;
        let next = ((idx + delta) % n + n) % n;
        let id = self.tabs[next as usize].id.clone();
        self.switch_tab(&id, cx);
    }

    /// createSplit
    pub fn create_split(&mut self, cx: &mut Context<Self>) {
        let ids = self.tab_ids();
        let pane = self.current_pane();
        self.split = self.split.split_pane(&pane, SplitDirection::Vertical, false).normalize(&ids, None);
        self.active_tab_id = None;
        self.persist(cx);
    }

    /// closePaneById
    pub fn close_pane(&mut self, pane: &str, cx: &mut Context<Self>) {
        let ids = self.tab_ids();
        let (remaining, removed, next, active) = crate::split_layout::resolve_pane_close(&ids, &self.split, pane);
        self.tabs.retain(|t| remaining.contains(&t.id));
        for r in removed {
            self.views.remove(&r);
        }
        self.split = next;
        self.active_tab_id = None;
        match active {
            Some(a) => self.switch_tab(&a, cx),
            None => self.persist(cx),
        }
    }

    pub fn close_active_pane(&mut self, cx: &mut Context<Self>) {
        let pane = self.current_pane();
        self.close_pane(&pane, cx);
    }

    pub fn activate_pane(&mut self, pane: &str, cx: &mut Context<Self>) {
        if self.split.active_pane_id == pane {
            return;
        }
        let active = self.split.pane_state.get(pane).and_then(|p| p.active_tab_id.clone());
        self.split = self.split.activate_pane(pane, active.clone());
        self.active_tab_id = active;
        self.persist(cx);
    }

    /// The tab's view, built on first use through the registry.
    pub fn view_for(&mut self, tab_id: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyView {
        if let Some(v) = self.views.get(tab_id) {
            return v.clone();
        }
        let tab = self.tabs.iter().find(|t| t.id == tab_id).cloned();
        let built = match (&tab, &self.session) {
            (Some(tab), Some(session)) => tabs::specs_for(tab, self.selected_schema.as_deref())
                .into_iter()
                .find_map(|spec| Registry::build_tab(&spec, session.clone(), window, cx)),
            _ => None,
        };
        let view = built.unwrap_or_else(|| {
            let (title, kind) = tab.map(|t| (t.name, t.kind)).unwrap_or_default();
            cx.new(|_| crate::main_content::TabPlaceholder { title: title.into(), kind: kind.into() }).into()
        });
        self.views.insert(tab_id.to_string(), view.clone());
        view
    }

    /// Side panels hosted for other crates (AI chat, SQL sheet, threads, bottom panel).
    pub fn panel_view(&mut self, key: &'static str, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyView> {
        if let Some(v) = self.panel_views.get(key) {
            return Some(v.clone());
        }
        let session = self.session.clone()?;
        let spec = TabSpec::View { view: key.to_string(), params: serde_json::json!({ "connectionId": self.connection_id }) };
        let v = Registry::build_tab(&spec, session, window, cx)?;
        self.panel_views.insert(key, v.clone());
        Some(v)
    }

    // ---- sidebar ---------------------------------------------------------------

    /// ModernUIRail.selectView: selecting the active view closes the sidebar.
    pub fn select_view(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.sidebar_view.as_deref() == Some(id) && self.sidebar_visible {
            self.sidebar_view = None;
            self.sidebar_visible = false;
        } else {
            self.sidebar_view = Some(id.to_string());
            self.sidebar_visible = true;
        }
        self.persist(cx);
    }

    /// toggleSidebar / onSidebarOpenChange
    pub fn set_sidebar_open(&mut self, open: bool, cx: &mut Context<Self>) {
        self.sidebar_visible = open;
        if !open {
            self.sidebar_view = None;
        } else if self.sidebar_view.is_none() {
            self.sidebar_view = Some("tables".into());
        }
        self.persist(cx);
    }

    pub fn sidebar_open(&self) -> bool {
        self.sidebar_view.is_some() && self.sidebar_visible
    }

    pub fn set_sort_mode(&mut self, mode: &str, cx: &mut Context<Self>) {
        self.sidebar_sort_mode = mode.to_string();
        self.persist(cx);
    }

    // ---- tags --------------------------------------------------------------------

    fn save_tags(&self) {
        if let Err(e) = persistence::save_tags(self.connection_id, &self.tags, &self.table_tags) {
            eprintln!("[rexadb] Failed to save tags: {e:#}");
        }
    }

    pub fn add_tag(&mut self, name: &str, color: &str, cx: &mut Context<Self>) {
        let name = name.trim();
        if name.is_empty() || self.tags.iter().any(|(n, _)| n == name) {
            return;
        }
        self.tags.push((name.to_string(), color.to_string()));
        self.save_tags();
        cx.notify();
    }

    pub fn remove_tag(&mut self, name: &str, cx: &mut Context<Self>) {
        self.tags.retain(|(n, _)| n != name);
        for v in self.table_tags.values_mut() {
            v.retain(|n| n != name);
        }
        self.table_tags.retain(|_, v| !v.is_empty());
        self.save_tags();
        cx.notify();
    }

    pub fn rename_tag(&mut self, old: &str, new: &str, cx: &mut Context<Self>) {
        let new = new.trim();
        if new.is_empty() {
            return;
        }
        for t in self.tags.iter_mut().filter(|(n, _)| n == old) {
            t.0 = new.to_string();
        }
        for v in self.table_tags.values_mut() {
            for n in v.iter_mut().filter(|n| *n == old) {
                *n = new.to_string();
            }
        }
        self.save_tags();
        cx.notify();
    }

    /// toggleTableTag
    pub fn toggle_table_tag(&mut self, schema: &str, table: &str, tag: &str, cx: &mut Context<Self>) {
        let key = format!("{schema}.{table}");
        let list = self.table_tags.entry(key.clone()).or_default();
        if let Some(i) = list.iter().position(|n| n == tag) {
            list.remove(i);
        } else {
            list.push(tag.to_string());
        }
        if list.is_empty() {
            self.table_tags.remove(&key);
        }
        self.save_tags();
        cx.notify();
    }

    // ---- table actions (sidebar context menu) -------------------------------------

    pub fn run_ddl(&mut self, sql: String, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let task = runtime::spawn(async move { session.driver.execute(&sql, 0).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if let Err(e) = result {
                    eprintln!("[rexadb] {e:#}");
                }
                this.refresh_tables(cx);
                rexa_core::emit_studio(StudioEvent::SchemaChanged, cx);
            })
            .ok();
        })
        .detach();
    }

    pub fn qualified(&self, schema: &str, table: &str) -> String {
        match &self.session {
            Some(s) if !schema.is_empty() => format!("{}.{}", s.driver.quote_ident(schema), s.driver.quote_ident(table)),
            Some(s) => s.driver.quote_ident(table),
            None => table.to_string(),
        }
    }

    // ---- settings modal --------------------------------------------------------------

    pub fn open_settings(&mut self, section: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let section = section.unwrap_or_else(|| "general".into());
        self.settings_view = self.session.clone().and_then(|session| {
            Registry::build_tab(&TabSpec::Settings { section: section.clone() }, session, window, cx)
        });
        self.settings_section = Some(section);
        cx.notify();
    }

    pub fn close_settings(&mut self, cx: &mut Context<Self>) {
        self.settings_section = None;
        self.settings_view = None;
        cx.notify();
    }

    /// Send a keybinding action to the active tab's view.
    pub fn tab_command(&mut self, command: &str, cx: &mut Context<Self>) {
        if let Some(tab) = self.active_tab() {
            let spec = tabs::tab_to_spec(tab);
            rexa_core::emit_studio(StudioEvent::TabCommand { tab: spec, command: command.to_string() }, cx);
        }
    }

    pub fn go_home(&mut self, cx: &mut Context<Self>) {
        rexa_core::navigate(rexa_core::Route::Connections, cx);
    }

    pub fn switch_connection(&mut self, id: i64, cx: &mut Context<Self>) {
        if id != self.connection_id {
            rexa_core::navigate(rexa_core::Route::Studio(id), cx);
        }
    }
}
