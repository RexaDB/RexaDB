//! App-wide state and the seams feature crates plug into.
//!
//! - [`runtime`]: Tokio runtime for database / network I/O.
//! - [`Route`] + [`navigate`]: page-level navigation (old app: `/`, `/studio`, settings, …).
//! - [`Registry`]: feature crates register screen and studio-tab factories in
//!   their `init(cx)`, so no crate needs to know about the others.
//! - [`Sessions`]: open database connections, shared by every studio tab.

pub mod runtime;
pub mod update;

use anyhow::Result;
use gpui::{AnyView, App, AppContext, Context, Entity, EventEmitter, Global, Window};
use rexa_drivers::Driver;
use rexa_store::SavedConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// ---- navigation ---------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    /// Connections home (connections-page.tsx).
    Connections,
    /// Any other connection-manager screen: "new-select", "settings",
    /// "supabase", "neon-cli", "spacetimedb-account", "planetscale-account", …
    ConnectionScreen(String),
    EditConnection(i64),
    /// Studio for an open connection (/studio?connection=<id>).
    Studio(i64),
    /// Team / workspace studio (/team).
    Team,
    Auth,
}

pub struct Navigator {
    pub route: Route,
    pub history: Vec<Route>,
}

pub struct RouteChanged;
impl EventEmitter<RouteChanged> for Navigator {}

struct NavigatorGlobal(Entity<Navigator>);
impl Global for NavigatorGlobal {}

pub fn navigator(cx: &App) -> Entity<Navigator> {
    cx.global::<NavigatorGlobal>().0.clone()
}

pub fn navigate(route: Route, cx: &mut App) {
    navigator(cx).update(cx, |nav, cx| {
        let prev = std::mem::replace(&mut nav.route, route);
        nav.history.push(prev);
        cx.emit(RouteChanged);
        cx.notify();
    });
}

pub fn go_back(cx: &mut App) {
    navigator(cx).update(cx, |nav, cx| {
        if let Some(prev) = nav.history.pop() {
            nav.route = prev;
            cx.emit(RouteChanged);
            cx.notify();
        }
    });
}

// ---- sessions -----------------------------------------------------------------

pub struct Session {
    pub connection: SavedConnection,
    pub driver: Arc<dyn Driver>,
}

#[derive(Default)]
pub struct Sessions {
    pub open: HashMap<i64, Arc<Session>>,
    vault: Option<Arc<rexa_store::Vault>>,
}

impl Global for Sessions {}

/// Resolve credentials and connect (off the UI thread). Reuses an open session.
pub fn connect(connection: SavedConnection, cx: &mut App) -> gpui::Task<Result<Arc<Session>>> {
    if let Some(s) = cx.default_global::<Sessions>().open.get(&connection.id) {
        return gpui::Task::ready(Ok(s.clone()));
    }
    let vault = cx.default_global::<Sessions>().vault.clone();
    let task = runtime::spawn(async move {
        let creds = tokio::task::spawn_blocking({
            let c = connection.clone();
            move || rexa_store::resolve_credentials(&c, vault.as_deref())
        })
        .await??;
        let driver = rexa_drivers::connect_detect(&connection.kind, &creds.connection_string).await?;
        Ok(Arc::new(Session { connection, driver }))
    });
    cx.spawn(async move |cx| {
        let session = task.await?;
        cx.update(|cx| {
            cx.default_global::<Sessions>().open.insert(session.connection.id, session.clone());
        });
        if let Ok(store) = rexa_store::Store::open() {
            store.touch_connection(session.connection.id).ok();
        }
        Ok(session)
    })
}

/// Install a passphrase-unlocked vault for this app session.
pub fn unlock_credential_vault(vault: rexa_store::Vault, cx: &mut App) {
    cx.default_global::<Sessions>().vault = Some(Arc::new(vault));
}

pub fn credential_vault(cx: &App) -> Option<Arc<rexa_store::Vault>> {
    cx.try_global::<Sessions>().and_then(|sessions| sessions.vault.clone())
}

// ---- studio tabs --------------------------------------------------------------

/// What a studio tab shows. Serializable so open tabs persist like the old
/// app's `rexa-db-tabs-<connectionId>` localStorage entries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TabSpec {
    /// Table data editor (table-editor-view.tsx).
    Table { schema: String, table: String },
    /// SQL editor (sql-editor.tsx).
    Query { id: String, title: String, sql: String },
    /// ER diagram (erd/).
    Erd { schema: String },
    /// Create/alter object views (create-*-view.tsx): "table", "index", "enum", "schema", "trigger", "database".
    Create { object: String, schema: Option<String> },
    /// Settings inside the studio (settings-view.tsx); `section` is the settings page id.
    Settings { section: String },
    /// Everything else (dashboards, notes, storage, query history, …) keyed by
    /// the old app's view id, with free-form parameters.
    View { view: String, #[serde(default)] params: serde_json::Value },
}

pub type TabFactory = fn(&TabSpec, Arc<Session>, &mut Window, &mut App) -> Option<AnyView>;
pub type ScreenFactory = fn(&Route, &mut Window, &mut App) -> Option<AnyView>;

#[derive(Default)]
pub struct Registry {
    screens: Vec<(&'static str, ScreenFactory)>,
    tabs: Vec<(&'static str, TabFactory)>,
}

impl Global for Registry {}

impl Registry {
    /// `owner` is the crate name, for debugging which factory claimed a route.
    pub fn screen(cx: &mut App, owner: &'static str, f: ScreenFactory) {
        cx.default_global::<Registry>().screens.push((owner, f));
    }
    pub fn tab(cx: &mut App, owner: &'static str, f: TabFactory) {
        cx.default_global::<Registry>().tabs.push((owner, f));
    }
    pub fn build_screen(route: &Route, window: &mut Window, cx: &mut App) -> Option<AnyView> {
        let factories = cx.default_global::<Registry>().screens.clone();
        factories.into_iter().find_map(|(_, f)| f(route, window, cx))
    }
    pub fn build_tab(spec: &TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
        let factories = cx.default_global::<Registry>().tabs.clone();
        factories.into_iter().find_map(|(_, f)| f(spec, session.clone(), window, cx))
    }
}

/// Studio-wide requests any tab can raise (open another tab, refresh the
/// schema tree, …). The studio shell subscribes to this.
pub enum StudioEvent {
    OpenTab(TabSpec),
    CloseTab(TabSpec),
    SchemaChanged,
    /// A connection's note collection changed (native notes autosave / creation).
    NotesChanged { connection_id: i64 },
    /// A tab reports unsaved edits (dirty dot in the tab strip, "N unsaved" in the status bar).
    MarkDirty { tab: TabSpec, dirty: bool },
    /// Rename a tab's title (e.g. a saved snippet name).
    RenameTab { tab: TabSpec, title: String },
    /// A SQL tab's text changed; the shell persists it with the tab (`open_tabs.query`).
    QueryChanged { id: String, sql: String },
    /// Shell → tab: a keybinding action meant for the active tab, by its
    /// keybindings.json type ("RUN_ACTIVE_QUERY", "STOP_ACTIVE_QUERY",
    /// "REFRESH_CURRENT_TAB", "COMMIT_PENDING_CHANGES", "FORMAT_QUERY",
    /// "COPY_QUERY", "OPEN_INSERT_SHEET"). Tab views subscribe to the bus and
    /// act when `tab` is theirs.
    TabCommand { tab: TabSpec, command: String },
    /// Open the settings modal at a section ("general", "ai", …).
    OpenSettings { section: Option<String> },
}

/// Emit any studio event on the bus.
pub fn emit_studio(event: StudioEvent, cx: &mut App) {
    studio_bus(cx).update(cx, |_, cx| cx.emit(event));
}

pub struct StudioBus;
impl EventEmitter<StudioEvent> for StudioBus {}
struct StudioBusGlobal(Entity<StudioBus>);
impl Global for StudioBusGlobal {}

pub fn studio_bus(cx: &App) -> Entity<StudioBus> {
    cx.global::<StudioBusGlobal>().0.clone()
}

pub fn open_tab(spec: TabSpec, cx: &mut App) {
    studio_bus(cx).update(cx, |_, cx| cx.emit(StudioEvent::OpenTab(spec)));
}

pub fn init(cx: &mut App) {
    // Federated connections reference other saved connections by id.
    rexa_drivers::set_federated_resolver(|id| {
        let store = rexa_store::Store::open().ok()?;
        let saved = store.connections().ok()?.into_iter().find(|c| c.id == id)?;
        let creds = rexa_store::resolve_credentials(&saved, None).ok()?;
        Some(rexa_drivers::ResolvedConnection {
            connection_type: saved.kind.clone(),
            connection_string: creds.connection_string,
            name: saved.name,
        })
    });
    let nav = cx.new(|_| Navigator { route: Route::Connections, history: Vec::new() });
    cx.set_global(NavigatorGlobal(nav));
    let bus = cx.new(|_| StudioBus);
    cx.set_global(StudioBusGlobal(bus));
    cx.default_global::<Sessions>();
    cx.default_global::<Registry>();
}

#[allow(unused)]
fn _assert_context(_: &mut Context<Navigator>) {}
