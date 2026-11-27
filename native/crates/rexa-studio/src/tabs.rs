//! Port of lib/studio/types.ts (`StudioInitialTab`) and lib/studio/tab-registry.tsx:
//! the persisted tab record, per-type defaults/icons, and the mapping between
//! old-app tab records and `rexa_core::TabSpec` (what other crates build views for).

use crate::icons::{self, Ico};
use crate::split_layout::base_tab_id;
use rexa_core::TabSpec;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const GLOBAL_SQL_CONTEXT_ID: &str = "__global_sql_context__";

/// One open tab, serialized exactly like the old app's `rexa-db-tabs-<id>`
/// entries. Unknown fields (bucketName, erdId, databaseObject, …) are kept.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioTab {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_preview: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl StudioTab {
    pub fn new(id: impl Into<String>, kind: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            base_id: None,
            kind: kind.into(),
            name: name.into(),
            schema: None,
            query: None,
            dirty: None,
            pinned: None,
            is_preview: None,
            extra: Map::new(),
        }
    }
    pub fn is_dirty(&self) -> bool {
        self.dirty.unwrap_or(false)
    }
    pub fn is_pinned(&self) -> bool {
        self.pinned.unwrap_or(false)
    }
    pub fn is_preview(&self) -> bool {
        self.is_preview.unwrap_or(false)
    }
    /// getTabBaseId
    pub fn base(&self) -> &str {
        self.base_id.as_deref().unwrap_or_else(|| base_tab_id(&self.id))
    }
    /// isRestorableTab: object tabs restored without their snapshot have nothing to show.
    pub fn is_restorable(&self) -> bool {
        self.kind != "database-object" || self.extra.get("databaseObject").is_some_and(|v| !v.is_null())
    }
}

/// Short random id like the old `uid()` (Math.random base36, 7 chars).
pub fn uid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut x = nanos ^ COUNTER.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 33;
    let alphabet = b"0123456789abcdefghijklmnopqrstuvwxyz";
    (0..7).map(|i| alphabet[((x >> (i * 6)) % 36) as usize] as char).collect()
}

pub struct TabConfig {
    pub default_name: &'static str,
    /// Canonical icon key of TAB_ICON_COMPONENTS.
    pub icon: &'static str,
    pub group: &'static str,
}

/// TAB_REGISTRY entries (default name, icon key, group).
pub fn config(kind: &str) -> Option<TabConfig> {
    let c = |default_name, icon, group| Some(TabConfig { default_name, icon, group });
    match kind {
        "table" => c("Table", "table", "content"),
        "sql" => c("New Query", "sql", "content"),
        "dashboard" => c("Dashboard", "dashboard", "content"),
        "note" => c("Note", "book-open", "content"),
        "workflow" => c("Workflow", "workflow", "content"),
        "erd-designer" => c("ERD Designer", "schema", "content"),
        "erd-project" => c("ERD Project", "schema", "content"),
        "browser" => c("Browser", "browser", "content"),
        "create-table" => c("New Table", "create-table", "create"),
        "create-key" => c("New Key", "create-key", "create"),
        "create-enum" => c("New Enum", "list-tree", "create"),
        "create-index" => c("New Index", "key", "create"),
        "create-trigger" => c("New Trigger", "zap", "create"),
        "create-schema" => c("New Schema", "folder-tree", "create"),
        "create-database" => c("New Database", "database", "create"),
        "database-schema" => c("Schema Diagram", "schema", "database"),
        "database-tables" => c("Tables List", "tables", "database"),
        "database-functions" => c("Functions", "function", "database"),
        "database-extensions" => c("Extensions", "boxes", "database"),
        "database-triggers" => c("Triggers", "zap", "database"),
        "database-enums" => c("Enumerated Types", "list-tree", "database"),
        "database-indexes" => c("Indexes", "key", "database"),
        "database-packages" => c("Packages", "boxes", "database"),
        "database-sequences" => c("Sequences", "list-tree", "database"),
        "database-synonyms" => c("Synonyms", "link", "database"),
        "database-db-links" => c("DB Links", "globe", "database"),
        "database-materialized-views" => c("Materialized Views", "tables", "database"),
        "database-rls-policies" => c("RLS Policies", "shield", "database"),
        "database-catalog" => c("Data Catalog", "book-open", "database"),
        "database-sessions" => c("Sessions", "clock", "database"),
        "database-locks" => c("Locks", "lock", "database"),
        "database-explain-plan" => c("Explain Plan", "scan-search", "database"),
        "database-backup-restore" => c("Backup & Restore", "archive", "database"),
        "database-spacetimedb-reducers" => c("Reducers", "zap", "database"),
        "database-spacetimedb-logs" => c("Logs", "terminal", "database"),
        "database-spacetimedb-schema" => c("Raw Schema", "book-open", "database"),
        "import-export" => c("Export", "download", "special"),
        "history" => c("Query History", "history", "special"),
        "analytics" => c("Analytics", "chart", "special"),
        "advisor" => c("Advisor", "chart", "special"),
        "database-object" => c("Database Object", "file", "special"),
        "rls-policy-edit" => c("Policy", "shield", "special"),
        "snapshots" => c("Snapshots", "camera", "special"),
        "snapshot-table" => c("Snapshot Table", "table", "special"),
        "diff-table" => c("Diff Table", "diff", "special"),
        "connect-studio" => c("Workspace Studio", "server", "special"),
        "manage-workspaces" => c("Workspaces", "settings", "special"),
        "auth-users" => c("Users", "user", "auth"),
        "auth-sessions" => c("Sessions", "clock", "auth"),
        "auth-providers" => c("Providers", "shield", "auth"),
        "payments-plans" => c("Plans", "boxes", "payments"),
        "payments-customers" => c("Customers", "user", "payments"),
        "payments-subscriptions" => c("Subscriptions", "history", "payments"),
        "payments-revenue" => c("Revenue", "chart", "payments"),
        "payments-webhooks" => c("Webhooks", "zap", "payments"),
        "payments-setup" => c("Setup", "settings", "payments"),
        "edge-functions" => c("Functions", "edge-function", "edge-functions"),
        "edge-secrets" => c("Secrets", "key", "edge-functions"),
        "edge-function" => c("Function", "edge-function", "edge-functions"),
        "storage-files" => c("Files", "storage-files", "storage"),
        "storage-settings" => c("Settings", "settings", "storage"),
        "storage-policies" => c("Policies", "shield", "storage"),
        "storage-bucket" => c("Bucket", "storage", "storage"),
        "settings" => c("Settings", "settings", "settings"),
        "agent-settings" => c("Agent Settings", "settings", "settings"),
        "profile-settings" => c("Profile Settings", "user", "settings"),
        "keybindings" => c("Keybindings", "key", "settings"),
        "extensions" => c("Extensions", "extensions", "settings"),
        "extension-view" => c("Extension View", "extensions", "content"),
        "extension-panel" => c("Extension Panel", "extensions", "content"),
        _ => None,
    }
}

/// TAB_ICON_COMPONENTS (lucide via the themed proxy, i.e. plain Lucide by default).
pub fn icon_for_key(key: &str) -> Option<Ico> {
    let l = icons::lucide;
    Some(match key {
        "table" => l("table-2"),
        "sql" => l("code-xml"),
        "file" => l("file-code"),
        "dashboard" => l("layout-dashboard"),
        "workflow" => l("workflow"),
        "create-table" => l("plus"),
        "create-key" | "key" => l("key-round"),
        "list-tree" => l("list"),
        "zap" => l("zap"),
        "folder-tree" | "storage-files" => l("folder-open"),
        "database" => l("database"),
        "schema" | "diff" => l("git-fork"),
        "tables" => l("layout-grid"),
        "function" => l("square-function"),
        "boxes" => l("box"),
        "shield" => l("shield"),
        "clock" => l("clock"),
        "lock" => l("lock"),
        "link" => l("link-2"),
        "globe" | "browser" => l("globe"),
        "scan-search" => l("search"),
        "archive" => l("file-archive"),
        "terminal" => l("terminal"),
        "book-open" => l("book-open"),
        "download" => l("download"),
        "history" => l("history"),
        "chart" => l("chart-column"),
        "settings" => l("settings"),
        "user" => l("user"),
        "server" => l("server"),
        "camera" => l("camera"),
        "storage" => l("hard-drive"),
        "edge-function" => l("square-function"),
        "extensions" => l("puzzle"),
        _ => return None,
    })
}

/// getTabIcon(type): the registry icon (used by the Database sidebar panel).
pub fn registry_icon(kind: &str) -> Option<Ico> {
    config(kind).and_then(|c| icon_for_key(c.icon))
}

/// STUDIO_TAB_ICONS: tab-strip icon per type (Solar overrides for the main ones).
pub fn tab_icon(kind: &str) -> Ico {
    match kind {
        "table" => icons::S_TABLE,
        "sql" => icons::S_CODE2,
        "dashboard" => icons::S_WIDGET,
        "note" => icons::lucide("book-open"),
        "analytics" | "advisor" => icons::S_CHART,
        "settings" | "agent-settings" => icons::S_SETTINGS,
        "profile-settings" => icons::S_USER,
        "history" => icons::S_HISTORY,
        "workflow" => icons::S_WORKFLOW,
        other => registry_icon(other).unwrap_or(icons::S_TABLE),
    }
}

fn str_param(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// Settings tabs ↔ `TabSpec::Settings { section }`.
const SETTINGS_TABS: [(&str, &str); 3] =
    [("profile-settings", "profile"), ("keybindings", "keybindings"), ("agent-settings", "agent")];

/// The spec a tab's view is built from. A second, alternate spec is tried
/// when no factory claims the first (see `specs_for`).
pub fn tab_to_spec(tab: &StudioTab) -> TabSpec {
    let kind = tab.kind.as_str();
    match kind {
        "table" => TabSpec::Table { schema: tab.schema.clone().unwrap_or_default(), table: tab.name.clone() },
        "sql" => TabSpec::Query {
            id: tab.base().to_string(),
            title: tab.name.clone(),
            sql: tab.query.clone().unwrap_or_default(),
        },
        k if k.starts_with("create-") => TabSpec::Create {
            object: k.trim_start_matches("create-").to_string(),
            schema: tab.schema.clone(),
        },
        "settings" => TabSpec::Settings {
            section: tab.extra.get("section").and_then(|v| v.as_str()).unwrap_or("general").to_string(),
        },
        k if SETTINGS_TABS.iter().any(|(t, _)| *t == k) => TabSpec::Settings {
            section: SETTINGS_TABS.iter().find(|(t, _)| *t == k).unwrap().1.to_string(),
        },
        _ => TabSpec::View { view: kind.to_string(), params: tab_params(tab) },
    }
}

/// Specs to try, in order, when building a tab's view.
pub fn specs_for(tab: &StudioTab, selected_schema: Option<&str>) -> Vec<TabSpec> {
    let primary = tab_to_spec(tab);
    let mut out = vec![primary];
    if matches!(tab.kind.as_str(), "database-schema" | "erd-designer") {
        out.push(TabSpec::Erd {
            schema: tab.schema.clone().or(selected_schema.map(str::to_string)).unwrap_or_default(),
        });
    }
    out
}

/// The whole tab record as JSON (id, name, schema, query and every extra field).
pub fn tab_params(tab: &StudioTab) -> Value {
    serde_json::to_value(tab).unwrap_or(Value::Null)
}

/// Inverse of `tab_to_spec` for `StudioEvent::OpenTab` requests from other crates.
/// Returns None for specs that open the settings modal instead of a tab.
pub fn spec_to_tab(spec: &TabSpec) -> Option<StudioTab> {
    Some(match spec {
        TabSpec::Table { schema, table } => {
            let id = format!("table-{schema}-{table}");
            let mut t = StudioTab::new(id.clone(), "table", table.clone());
            t.base_id = Some(id);
            t.schema = Some(schema.clone());
            t
        }
        TabSpec::Query { id, title, sql } => {
            let id = if id.is_empty() { format!("sql-new-{}", uid()) } else { id.clone() };
            let name = if title.is_empty() { "New Query".to_string() } else { title.clone() };
            let mut t = StudioTab::new(id, "sql", name);
            t.query = Some(sql.clone());
            t
        }
        TabSpec::Erd { schema } => {
            let mut t = StudioTab::new("database-schema", "database-schema", "Schema Diagram");
            if !schema.is_empty() {
                t.schema = Some(schema.clone());
            }
            t
        }
        TabSpec::Create { object, schema } => {
            let kind = format!("create-{object}");
            let name = config(&kind).map_or("New", |c| c.default_name);
            let mut t = StudioTab::new(kind.clone(), kind, name);
            t.schema = schema.clone();
            t
        }
        TabSpec::Settings { section } => {
            let (kind, _) = SETTINGS_TABS.iter().find(|(_, s)| s == section)?;
            StudioTab::new(*kind, *kind, config(kind).unwrap().default_name)
        }
        TabSpec::View { view, params } => {
            let default_id = view.clone();
            let id = str_param(params, "id").unwrap_or(default_id);
            let name = str_param(params, "name")
                .or_else(|| str_param(params, "title"))
                .or_else(|| config(view).map(|c| c.default_name.to_string()))
                .unwrap_or_else(|| view.clone());
            let mut t = StudioTab::new(id, view.clone(), name);
            if let Value::Object(map) = params {
                for (k, v) in map {
                    match k.as_str() {
                        "id" | "name" | "type" => {}
                        "schema" => t.schema = v.as_str().map(str::to_string),
                        "query" => t.query = v.as_str().map(str::to_string),
                        "baseId" => t.base_id = v.as_str().map(str::to_string),
                        _ => {
                            t.extra.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
            t
        }
    })
}

/// Whether `spec` addresses `tab` (used for CloseTab / MarkDirty / RenameTab):
/// queries match by id, tables by schema + name, views by type (+ id when given).
pub fn spec_matches(spec: &TabSpec, tab: &StudioTab) -> bool {
    match (spec, tab_to_spec(tab)) {
        (TabSpec::Query { id, .. }, TabSpec::Query { id: tid, .. }) => id == &tid || id == &tab.id,
        (TabSpec::Table { schema, table }, TabSpec::Table { schema: s, table: t }) => schema == &s && table == &t,
        (TabSpec::View { view, params }, TabSpec::View { view: v, .. }) => {
            view == &v && str_param(params, "id").is_none_or(|id| id == tab.id || id == tab.base())
        }
        (a, b) => a == &b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_old_tab_json() {
        let json = r#"[{"id":"table-public-blog","baseId":"table-public-blog","type":"table","name":"blog","schema":"public"},{"id":"sql-new-2gel1sp","type":"sql","name":"New Query","query":"SELECT * FROM blog","dirty":false,"isPreview":false},{"id":"storage-bucket-x","type":"storage-bucket","name":"x","bucketName":"x"}]"#;
        let tabs: Vec<StudioTab> = serde_json::from_str(json).unwrap();
        assert_eq!(tabs[2].extra.get("bucketName").and_then(|v| v.as_str()), Some("x"));
        let back: Vec<StudioTab> = serde_json::from_str(&serde_json::to_string(&tabs).unwrap()).unwrap();
        assert_eq!(back, tabs);
        assert_eq!(tab_to_spec(&tabs[0]), TabSpec::Table { schema: "public".into(), table: "blog".into() });
        assert!(matches!(tab_to_spec(&tabs[2]), TabSpec::View { ref view, .. } if view == "storage-bucket"));
    }

    #[test]
    fn spec_roundtrip() {
        let spec = TabSpec::Table { schema: "s".into(), table: "t".into() };
        let tab = spec_to_tab(&spec).unwrap();
        assert_eq!(tab.id, "table-s-t");
        assert!(spec_matches(&spec, &tab));
        let view = TabSpec::View { view: "history".into(), params: Value::Null };
        let tab = spec_to_tab(&view).unwrap();
        assert_eq!(tab.name, "Query History");
        assert!(spec_matches(&view, &tab));
    }
}
