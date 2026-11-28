//! Port of the studio's persistence (hooks/use-studio.ts local state,
//! hooks/use-studio-data-persistence.ts, hooks/use-studio-persistence.ts,
//! lib/studio/persist-local-state.ts, lib/db/studio-storage-crud.ts):
//!
//! - "local" keys the old app kept in WebKit localStorage
//!   (`rexa-db-tabs-<id>`, `rexa-db-active-tab-<id>`, `rexa-db-sidebar-view-<id>`,
//!   `rexa-db-sidebar-visible-<id>`, `rexa-db-layout-prefs`) now live in
//!   `app_settings` under the same keys; first read migrates them from WebKit.
//! - the shared tables `open_tabs` and `connection_settings` are written too,
//!   so the old app and this one restore the same workspace.

use crate::split_layout::SplitViewState;
use crate::tabs::{StudioTab, GLOBAL_SQL_CONTEXT_ID};
use anyhow::Result;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

pub fn tabs_key(id: i64) -> String {
    format!("rexa-db-tabs-{id}")
}
pub fn active_tab_key(id: i64) -> String {
    format!("rexa-db-active-tab-{id}")
}
pub fn sidebar_view_key(id: i64) -> String {
    format!("rexa-db-sidebar-view-{id}")
}
pub fn sidebar_visible_key(id: i64) -> String {
    format!("rexa-db-sidebar-visible-{id}")
}
pub fn restore_key(id: i64) -> String {
    format!("rexa-db-restore-state-{id}")
}
pub const LAYOUT_PREFS_KEY: &str = "rexa-db-layout-prefs";
pub const RAIL_ORDER_KEY: &str = "modern-ui-rail-order";

fn open() -> Result<Connection> {
    let db = Connection::open_with_flags(
        rexa_store::Store::database_path(),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch(
        r#"CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT, updated_at INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS open_tabs (id TEXT PRIMARY KEY NOT NULL, connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
             type TEXT NOT NULL, name TEXT NOT NULL, schema TEXT, query TEXT, "order" INTEGER NOT NULL, pinned INTEGER DEFAULT 0);
           CREATE TABLE IF NOT EXISTS connection_settings (connection_id INTEGER PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
             active_tab_id TEXT, sidebar_sort_mode TEXT DEFAULT 'alphabetical', sidebar_view TEXT DEFAULT 'tables', split_view TEXT);"#,
    )?;
    Ok(db)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// A "localStorage" read: app_settings first, else the old WebKit store
/// (copied into app_settings so later reads stay local).
pub fn local_get(key: &str) -> Option<String> {
    let db = open().ok()?;
    let found: Option<Option<String>> = db
        .query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()?;
    if let Some(v) = found {
        return v;
    }
    let migrated = rexa_store::WebStore::open().and_then(|w| w.get(key).ok().flatten())?;
    db.execute(
        "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
        params![key, migrated, now_millis()],
    )
    .ok();
    Some(migrated)
}

/// persistLocalState: set, or remove when `value` is None.
pub fn local_set(key: &str, value: Option<&str>) {
    let Ok(db) = open() else { return };
    match value {
        Some(v) => db.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, v, now_millis()],
        ),
        // Keep a NULL row so a removed key is not re-migrated from WebKit.
        None => db.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, NULL, ?2)
             ON CONFLICT(key) DO UPDATE SET value = NULL, updated_at = excluded.updated_at",
            params![key, now_millis()],
        ),
    }
    .ok();
}

/// `rexa-db-layout-prefs` ({"appShellLayout":false,"modernUiLayout":true}).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPrefs {
    #[serde(default)]
    pub app_shell_layout: bool,
    #[serde(default = "yes")]
    pub modern_ui_layout: bool,
}
fn yes() -> bool {
    true
}

pub fn layout_prefs() -> LayoutPrefs {
    local_get(LAYOUT_PREFS_KEY)
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(LayoutPrefs { app_shell_layout: false, modern_ui_layout: true })
}

/// Everything the studio restores for a connection.
#[derive(Clone, Debug)]
pub struct StudioUiState {
    pub tabs: Vec<StudioTab>,
    pub active_tab_id: Option<String>,
    /// None = no section open (rail item deselected).
    pub sidebar_view: Option<String>,
    pub sidebar_visible: bool,
    pub sidebar_sort_mode: String,
    pub split_view: Option<SplitViewState>,
}

/// Default first tab (`Query 1`) per database flavour (use-studio.ts).
pub fn default_query(db_type: &str) -> &'static str {
    match db_type {
        "mongodb" => "db.collection.find({}).limit(100)",
        "redis" => "PING",
        "clickhouse" => "SELECT * FROM system.tables LIMIT 10;",
        "mssql" => "SELECT TOP 10 * FROM information_schema.tables;",
        "oracle" => "SELECT * FROM all_tables ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;",
        _ => "SELECT * FROM information_schema.tables LIMIT 10;",
    }
}

pub fn load(connection_id: i64, db_type: &str) -> StudioUiState {
    let restore = local_get(&restore_key(connection_id)).as_deref() != Some("0");
    let db = open().ok();

    let local_tabs: Option<Vec<StudioTab>> = restore
        .then(|| local_get(&tabs_key(connection_id)))
        .flatten()
        .and_then(|v| serde_json::from_str::<Vec<StudioTab>>(&v).ok());

    let mut tabs = match local_tabs {
        Some(t) => t,
        None => db.as_ref().map(|db| shared_tabs(db, connection_id)).unwrap_or_default(),
    };
    tabs.retain(StudioTab::is_restorable);
    if tabs.is_empty() && local_get(&tabs_key(connection_id)).is_none() {
        let mut t = StudioTab::new(GLOBAL_SQL_CONTEXT_ID, "sql", "Query 1");
        t.query = Some(default_query(db_type).into());
        tabs.push(t);
    }

    let settings: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> = db.as_ref().and_then(|db| {
        db.query_row(
            "SELECT active_tab_id, sidebar_view, sidebar_sort_mode, split_view FROM connection_settings WHERE connection_id = ?1",
            [connection_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten()
    });
    let (db_active, _db_view, db_sort, db_split) = settings.unwrap_or((None, None, None, None));

    let local_active = restore.then(|| local_get(&active_tab_key(connection_id))).flatten();
    let candidate = local_active.or(db_active).or_else(|| tabs.first().map(|t| t.id.clone()));
    let active_tab_id = match candidate {
        Some(c) if tabs.iter().any(|t| t.id == c) => Some(c),
        _ => tabs.first().map(|t| t.id.clone()),
    };

    let sidebar_view = restore
        .then(|| local_get(&sidebar_view_key(connection_id)))
        .flatten()
        .filter(|v| !v.is_empty() && v != "null")
        .or(Some("tables".into()));
    let sidebar_visible = local_get(&sidebar_visible_key(connection_id)).as_deref() != Some("0");

    StudioUiState {
        tabs,
        active_tab_id,
        sidebar_view,
        sidebar_visible,
        sidebar_sort_mode: db_sort.unwrap_or_else(|| "alphabetical".into()),
        split_view: db_split.and_then(|s| serde_json::from_str(&s).ok()),
    }
}

/// getStudioTabs: ids are stored scoped as `c<connectionId>:<tabId>`.
fn shared_tabs(db: &Connection, connection_id: i64) -> Vec<StudioTab> {
    let prefix = format!("c{connection_id}:");
    let Ok(mut stmt) = db.prepare(
        r#"SELECT id, type, name, schema, query, COALESCE(pinned, 0) FROM open_tabs WHERE connection_id = ?1 ORDER BY "order""#,
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([connection_id], |r| {
        let id: String = r.get(0)?;
        let mut t = StudioTab::new(id.strip_prefix(&prefix).unwrap_or(&id), r.get::<_, String>(1)?, r.get::<_, String>(2)?);
        t.schema = r.get(3)?;
        t.query = r.get(4)?;
        if r.get::<_, i64>(5)? != 0 {
            t.pinned = Some(true);
        }
        Ok(t)
    });
    rows.map(|r| r.filter_map(|t| t.ok()).collect()).unwrap_or_default()
}

/// The local (immediate) half: tabs + active tab.
pub fn save_local_tabs(connection_id: i64, tabs: &[StudioTab], active: Option<&str>) {
    let restore = local_get(&restore_key(connection_id)).as_deref() != Some("0");
    let json = serde_json::to_string(tabs).ok();
    local_set(&tabs_key(connection_id), json.as_deref().filter(|_| restore));
    local_set(&active_tab_key(connection_id), active.filter(|_| restore));
}

pub fn save_local_sidebar(connection_id: i64, view: Option<&str>, visible: bool) {
    if let Some(v) = view {
        local_set(&sidebar_view_key(connection_id), Some(v));
    }
    local_set(&sidebar_visible_key(connection_id), Some(if visible { "1" } else { "0" }));
}

/// saveStudioTabs (debounced by the caller, like the old 1s timeout).
pub fn save_shared_tabs(connection_id: i64, tabs: &[StudioTab]) -> Result<()> {
    let mut db = open()?;
    let tx = db.transaction()?;
    tx.execute("DELETE FROM open_tabs WHERE connection_id = ?1", [connection_id])?;
    for (i, t) in tabs.iter().filter(|t| t.kind != "database-object").enumerate() {
        tx.execute(
            r#"INSERT OR REPLACE INTO open_tabs(id, connection_id, type, name, schema, query, "order", pinned)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![
                format!("c{connection_id}:{}", t.id),
                connection_id,
                t.kind,
                t.name,
                t.schema,
                t.query,
                i as i64,
                t.is_pinned() as i64
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// The `settings` save of use-studio-data-persistence.ts (studio columns only).
pub fn save_shared_settings(
    connection_id: i64,
    active_tab_id: Option<&str>,
    sidebar_view: Option<&str>,
    sidebar_sort_mode: &str,
    split: &SplitViewState,
) -> Result<()> {
    let db = open()?;
    let split = serde_json::to_string(split)?;
    db.execute(
        "INSERT INTO connection_settings(connection_id, active_tab_id, sidebar_view, sidebar_sort_mode, split_view)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(connection_id) DO UPDATE SET active_tab_id = excluded.active_tab_id,
           sidebar_view = COALESCE(excluded.sidebar_view, connection_settings.sidebar_view),
           sidebar_sort_mode = excluded.sidebar_sort_mode, split_view = excluded.split_view",
        params![connection_id, active_tab_id, sidebar_view, sidebar_sort_mode, split],
    )?;
    Ok(())
}

/// Global studio settings (`app_settings.studio_settings`) the shell reads.
#[derive(Clone, Debug)]
pub struct GlobalStudioSettings {
    pub schema_explorer: bool,
    pub database_explorer: bool,
    pub show_table_count: bool,
    pub preview_tabs: bool,
    pub auto_close_pane: bool,
    pub restore_app_state: bool,
    /// commandMenuSections: (id, visible)
    pub command_menu_sections: Vec<(String, bool)>,
    pub tui_mode: bool,
    pub noise_bg_enabled: bool,
    pub noise_bg_opacity: f32,
    pub noise_bg_size: f32,
    pub noise_bg_color: String,
    pub noise_bg_blend_mode: String,
    pub noise_bg_translucent: bool,
}

pub fn global_settings() -> GlobalStudioSettings {
    let v: serde_json::Value = rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting("studio_settings").ok().flatten())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    let b = |k: &str, d: bool| v.get(k).and_then(|x| x.as_bool()).unwrap_or(d);
    GlobalStudioSettings {
        schema_explorer: b("schemaExplorer", false),
        database_explorer: b("databaseExplorer", false),
        show_table_count: b("showTableCount", true),
        preview_tabs: b("previewTabs", false),
        auto_close_pane: b("autoClosePane", false),
        restore_app_state: b("restoreAppState", true),
        tui_mode: b("tuiMode", false),
        noise_bg_enabled: b("noiseBgEnabled", false),
        noise_bg_opacity: v.get("noiseBgOpacity").and_then(|x| x.as_f64()).unwrap_or(30.) as f32,
        noise_bg_size: v.get("noiseBgSize").and_then(|x| x.as_f64()).unwrap_or(50.) as f32,
        noise_bg_color: v.get("noiseBgColor").and_then(|x| x.as_str()).unwrap_or("#000000").to_string(),
        noise_bg_blend_mode: v.get("noiseBgBlendMode").and_then(|x| x.as_str()).unwrap_or("overlay").to_string(),
        noise_bg_translucent: b("noiseBgTranslucent", false),
        command_menu_sections: v
            .get("commandMenuSections")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| Some((s.get("id")?.as_str()?.to_string(), s.get("isVisible")?.as_bool()?)))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// Tags (`tags`) and table tags (`table_tags`, "schema.table" → tag names).
pub fn load_tags(connection_id: i64) -> (Vec<(String, String)>, std::collections::HashMap<String, Vec<String>>) {
    let mut tags = Vec::new();
    let mut table_tags: std::collections::HashMap<String, Vec<String>> = Default::default();
    let Ok(db) = open() else { return (tags, table_tags) };
    if let Ok(mut s) = db.prepare("SELECT name, color FROM tags WHERE connection_id = ?1 ORDER BY id") {
        if let Ok(rows) = s.query_map([connection_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            tags = rows.flatten().collect();
        }
    }
    if let Ok(mut s) = db.prepare("SELECT table_name, tag_name FROM table_tags WHERE connection_id = ?1") {
        if let Ok(rows) = s.query_map([connection_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            for (t, n) in rows.flatten() {
                table_tags.entry(t).or_default().push(n);
            }
        }
    }
    (tags, table_tags)
}

/// saveStudioTags + saveStudioTableTags.
pub fn save_tags(
    connection_id: i64,
    tags: &[(String, String)],
    table_tags: &std::collections::HashMap<String, Vec<String>>,
) -> Result<()> {
    let mut db = open()?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS table_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE, table_name TEXT NOT NULL, tag_name TEXT NOT NULL);",
    )?;
    let tx = db.transaction()?;
    tx.execute("DELETE FROM tags WHERE connection_id = ?1", [connection_id])?;
    for (n, c) in tags {
        tx.execute("INSERT INTO tags(connection_id, name, color) VALUES (?1, ?2, ?3)", params![connection_id, n, c])?;
    }
    tx.execute("DELETE FROM table_tags WHERE connection_id = ?1", [connection_id])?;
    for (t, names) in table_tags {
        for n in names {
            tx.execute(
                "INSERT INTO table_tags(connection_id, table_name, tag_name) VALUES (?1, ?2, ?3)",
                params![connection_id, t, n],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_in_temp_data_dir() {
        let dir = std::env::temp_dir().join(format!("rexa-studio-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("REXADB_DATA_DIR", &dir);
        let id = -42; // never exists in WebKit storage
        open().unwrap().execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY); INSERT INTO connections VALUES (-42);").unwrap();
        let fresh = load(id, "postgres");
        assert_eq!(fresh.tabs.len(), 1);
        assert_eq!(fresh.tabs[0].id, GLOBAL_SQL_CONTEXT_ID);
        let mut t = StudioTab::new("table-public-a", "table", "a");
        t.schema = Some("public".into());
        let tabs = vec![fresh.tabs[0].clone(), t];
        save_local_tabs(id, &tabs, Some("table-public-a"));
        save_shared_tabs(id, &tabs).unwrap();
        save_shared_settings(id, Some("table-public-a"), Some("sql"), "tags", &SplitViewState::new(None)).unwrap();
        let back = load(id, "postgres");
        assert_eq!(back.tabs, tabs);
        assert_eq!(back.active_tab_id.as_deref(), Some("table-public-a"));
        assert_eq!(back.sidebar_sort_mode, "tags");
        let db = open().unwrap();
        assert_eq!(shared_tabs(&db, id).len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}
