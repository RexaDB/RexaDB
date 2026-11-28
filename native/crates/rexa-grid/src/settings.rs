//! Port of the grid-related fields of `hooks/use-global-studio-settings.ts`
//! (stored as JSON in `app_settings.studio_settings`), `lib/studio/fast-table-loading.ts`,
//! and the per-table hidden columns (`app_settings` key
//! `column_visibility:<connectionId>:<schema>.<table>`, `lib/db/actions-core.ts`).

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowSpacing {
    Compact,
    Standard,
    Relaxed,
}

impl RowSpacing {
    /// `rowHeight` in data-grid.tsx.
    pub fn row_height(self) -> f32 {
        match self {
            RowSpacing::Compact => 28.,
            RowSpacing::Standard => 32.,
            RowSpacing::Relaxed => 36.,
        }
    }
}

#[derive(Debug, Clone)]
pub struct GridSettings {
    /// `executionMode === "review"`: edits queue as pending changes.
    pub review_mode: bool,
    pub infinite_scrolling: bool,
    pub row_spacing: RowSpacing,
    pub grid_animations: bool,
    pub colorized_pills: bool,
    pub relative_dates: bool,
    pub rich_json_inspector: bool,
    pub data_bars: bool,
    pub skeleton_loaders: bool,
    pub fast_table_loading: bool,
    pub show_pending_changes_banner: bool,
}

impl Default for GridSettings {
    fn default() -> Self {
        Self::from_json(&Value::Null)
    }
}

impl GridSettings {
    pub fn from_json(v: &Value) -> Self {
        let b = |k: &str, d: bool| v.get(k).and_then(Value::as_bool).unwrap_or(d);
        GridSettings {
            review_mode: v.get("executionMode").and_then(Value::as_str) == Some("review"),
            infinite_scrolling: b("infiniteTableScrolling", false),
            row_spacing: match v.get("rowSpacing").and_then(Value::as_str) {
                Some("compact") => RowSpacing::Compact,
                Some("relaxed") => RowSpacing::Relaxed,
                _ => RowSpacing::Standard,
            },
            grid_animations: b("gridAnimations", false),
            colorized_pills: b("colorizedPills", false),
            relative_dates: b("relativeDates", false),
            rich_json_inspector: b("richJsonInspector", false),
            data_bars: b("dataBars", false),
            skeleton_loaders: b("skeletonLoaders", false),
            // `resolveFastTableLoading`: on unless explicitly false.
            fast_table_loading: v.get("fastTableLoading") != Some(&Value::Bool(false)),
            show_pending_changes_banner: b("showPendingChangesBanner", true),
        }
    }

    pub fn load() -> Self {
        let v = rexa_store::Store::open()
            .ok()
            .and_then(|s| s.setting("studio_settings").ok().flatten())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(Value::Null);
        Self::from_json(&v)
    }
}

fn visibility_key(connection_id: i64, schema: &str, table: &str) -> String {
    format!("column_visibility:{connection_id}:{schema}.{table}")
}

/// `getColumnVisibility`.
pub fn load_hidden_columns(connection_id: i64, schema: &str, table: &str) -> Vec<String> {
    rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting(&visibility_key(connection_id, schema, table)).ok().flatten())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// `saveColumnVisibility`.
pub fn save_hidden_columns(connection_id: i64, schema: &str, table: &str, hidden: &[String]) {
    if let Ok(store) = rexa_store::Store::open() {
        let json = serde_json::to_string(hidden).unwrap_or_else(|_| "[]".into());
        store.set_setting(&visibility_key(connection_id, schema, table), &json).ok();
    }
}

/// `storageKey` of saved-table-views.tsx / toolbar-layout.tsx: FNV-1a of the connection string.
pub fn connection_hash(connection: &str) -> String {
    let mut hash: u32 = 2166136261;
    let s = if connection.is_empty() { "default" } else { connection };
    for unit in s.encode_utf16() {
        hash = (hash ^ unit as u32).wrapping_mul(16777619);
    }
    to_base36(hash)
}

fn to_base36(mut n: u32) -> String {
    if n == 0 {
        return "0".into();
    }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_original() {
        let s = GridSettings::default();
        assert!(!s.review_mode && s.fast_table_loading && s.show_pending_changes_banner);
        assert_eq!(s.row_spacing.row_height(), 32.);
        let s = GridSettings::from_json(&serde_json::json!({"executionMode": "review", "rowSpacing": "compact", "fastTableLoading": false}));
        assert!(s.review_mode && !s.fast_table_loading);
        assert_eq!(s.row_spacing.row_height(), 28.);
        assert_eq!(to_base36(35), "z");
    }
}
