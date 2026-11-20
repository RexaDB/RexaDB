//! Port of lib/dictionary/{types,helpers,client,native}.ts + hooks/use-data-dictionary.ts
//! and its storage backend src-tauri/src/dictionary.rs: per-connection table /
//! column descriptions and column display decorators in `data-dictionary.json`
//! under the app-data dir (same file and shape as the old app, so both share it).
//!
//! Public API: [`get_scope`], [`set_table_description`], [`set_column_description`],
//! [`set_column_decorator`], [`delete_scope`], [`apply_column_decorator`],
//! [`table_key`] / [`column_key`], [`fetch_native_comments`], [`build_catalog_entries`],
//! [`search_catalog`].

use anyhow::{bail, Result};
use rexa_drivers::{Driver, Kind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());
const MAX_DESCRIPTION_LEN: usize = 5_000;
const MAX_KEY_PART_LEN: usize = 256;

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
struct DescriptionEntry {
    description: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    updated_at: u64,
}

fn is_zero(v: &u64) -> bool {
    *v == 0
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ConnectionScope {
    #[serde(default)]
    tables: BTreeMap<String, DescriptionEntry>,
    #[serde(default)]
    columns: BTreeMap<String, DescriptionEntry>,
    #[serde(default)]
    decorators: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct DictionaryFile {
    #[serde(default)]
    connections: BTreeMap<String, ConnectionScope>,
}

/// `DictionaryScope`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DictionaryScope {
    pub tables: BTreeMap<String, String>,
    pub columns: BTreeMap<String, String>,
    pub decorators: BTreeMap<String, serde_json::Value>,
    pub updated_at: BTreeMap<String, u64>,
}

fn path() -> std::path::PathBuf {
    let dir = rexa_store::app_data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("data-dictionary.json")
}

fn read() -> DictionaryFile {
    std::fs::read_to_string(path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write(d: &DictionaryFile) -> Result<()> {
    let p = path();
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(d)?)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn normalize_part(raw: &str) -> Result<String> {
    let t = raw.trim();
    if t.is_empty() {
        bail!("schema/table/column names must not be empty");
    }
    if t.len() > MAX_KEY_PART_LEN {
        bail!("schema/table/column names are too long");
    }
    if t.contains('\0') {
        bail!("names must not contain NUL bytes");
    }
    Ok(t.to_string())
}

fn escape_part(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('.', "\\.")
}

/// `tableKey` (dots and backslashes escaped).
pub fn table_key(schema: &str, table: &str) -> String {
    format!("{}.{}", escape_part(schema.trim()), escape_part(table.trim()))
}

/// `columnKey`.
pub fn column_key(schema: &str, table: &str, column: &str) -> String {
    format!("{}.{}.{}", escape_part(schema.trim()), escape_part(table.trim()), escape_part(column.trim()))
}

fn normalize_description(raw: &str) -> String {
    raw.trim().chars().take(MAX_DESCRIPTION_LEN).collect::<String>().replace('\0', "")
}

/// `getDictionaryScope`.
pub fn get_scope(connection_id: i64) -> DictionaryScope {
    if connection_id <= 0 {
        return DictionaryScope::default();
    }
    let _g = LOCK.lock().unwrap();
    let d = read();
    let Some(s) = d.connections.get(&connection_id.to_string()) else { return DictionaryScope::default() };
    let mut updated_at = BTreeMap::new();
    for (k, v) in s.tables.iter().chain(s.columns.iter()) {
        updated_at.insert(k.clone(), v.updated_at);
    }
    DictionaryScope {
        tables: s.tables.iter().map(|(k, v)| (k.clone(), v.description.clone())).collect(),
        columns: s.columns.iter().map(|(k, v)| (k.clone(), v.description.clone())).collect(),
        decorators: s.decorators.iter().filter(|(_, v)| validate_decorator(v).is_ok()).map(|(k, v)| (k.clone(), v.clone())).collect(),
        updated_at,
    }
}

fn update(connection_id: i64, f: impl FnOnce(&mut ConnectionScope)) -> Result<()> {
    if connection_id <= 0 {
        bail!("No connection selected — descriptions can't be saved yet.");
    }
    let _g = LOCK.lock().unwrap();
    let mut d = read();
    f(d.connections.entry(connection_id.to_string()).or_default());
    write(&d)
}

/// `setTableDescription` (empty removes).
pub fn set_table_description(connection_id: i64, schema: &str, table: &str, description: &str) -> Result<()> {
    let key = format!("{}.{}", escape_part(&normalize_part(schema)?), escape_part(&normalize_part(table)?));
    let n = normalize_description(description);
    update(connection_id, |s| {
        if n.is_empty() {
            s.tables.remove(&key);
        } else {
            s.tables.insert(key, DescriptionEntry { description: n, updated_at: now_millis() });
        }
    })
}

/// `setColumnDescription` (empty removes).
pub fn set_column_description(connection_id: i64, schema: &str, table: &str, column: &str, description: &str) -> Result<()> {
    let key = format!("{}.{}.{}", escape_part(&normalize_part(schema)?), escape_part(&normalize_part(table)?), escape_part(&normalize_part(column)?));
    let n = normalize_description(description);
    update(connection_id, |s| {
        if n.is_empty() {
            s.columns.remove(&key);
        } else {
            s.columns.insert(key, DescriptionEntry { description: n, updated_at: now_millis() });
        }
    })
}

/// `validate_decorator` / `isValidDecorator`.
pub fn validate_decorator(v: &serde_json::Value) -> Result<()> {
    let o = v.as_object().ok_or_else(|| anyhow::anyhow!("decorator must be a JSON object"))?;
    match o.get("kind").and_then(|k| k.as_str()) {
        Some("enum-map") if o.get("mapping").and_then(|m| m.as_object()).is_none() => bail!("enum-map decorator requires a `mapping` object"),
        Some("truncate") => {
            let m = o.get("maxLength").and_then(|v| v.as_u64()).unwrap_or(0);
            if m == 0 || m > 10_000 {
                bail!("truncate decorator requires 1 <= maxLength <= 10000");
            }
            Ok(())
        }
        Some("enum-map" | "mask" | "prefix-suffix" | "date-format") => Ok(()),
        Some(other) => bail!("unknown decorator kind: {other}"),
        None => bail!("decorator requires a `kind` field"),
    }
}

/// `setColumnDecorator` (`None` deletes).
pub fn set_column_decorator(connection_id: i64, schema: &str, table: &str, column: &str, decorator: Option<serde_json::Value>) -> Result<()> {
    if let Some(d) = &decorator {
        validate_decorator(d)?;
    }
    let key = format!("{}.{}.{}", escape_part(&normalize_part(schema)?), escape_part(&normalize_part(table)?), escape_part(&normalize_part(column)?));
    update(connection_id, |s| match decorator {
        Some(d) => {
            s.decorators.insert(key, d);
        }
        None => {
            s.decorators.remove(&key);
        }
    })
}

/// `deleteDictionaryScope`.
pub fn delete_scope(connection_id: i64) -> Result<()> {
    let _g = LOCK.lock().unwrap();
    let mut d = read();
    if d.connections.remove(&connection_id.to_string()).is_some() {
        write(&d)?;
    }
    Ok(())
}

/// `DecoratedDisplay`.
#[derive(Debug, Clone, PartialEq)]
pub struct DecoratedDisplay {
    pub display: String,
    /// The raw value is hidden (masking) — callers must not copy it.
    pub masked: bool,
}

fn relative_time(ms_ago: i64) -> String {
    let abs = ms_ago.unsigned_abs();
    let (minute, hour, day) = (60_000u64, 3_600_000u64, 86_400_000u64);
    let dir = if ms_ago >= 0 { " ago" } else { " from now" };
    if abs < minute {
        return "just now".into();
    }
    let (n, unit) = if abs < hour { (abs / minute, "min") } else if abs < day { (abs / hour, "hour") } else { (abs / day, "day") };
    format!("{n} {unit}{}{dir}", if n == 1 { "" } else { "s" })
}

/// `applyColumnDecorator`: how a cell value renders under a decorator (`None` value = SQL NULL).
pub fn apply_column_decorator(value: Option<&str>, decorator: Option<&serde_json::Value>) -> DecoratedDisplay {
    let plain = |t: String| DecoratedDisplay { display: t, masked: false };
    let Some(value) = value else { return plain("NULL".into()) };
    let Some(d) = decorator else { return plain(value.to_string()) };
    match d.get("kind").and_then(|k| k.as_str()) {
        Some("enum-map") => plain(d.get("mapping").and_then(|m| m.get(value)).and_then(|v| v.as_str()).unwrap_or(value).to_string()),
        Some("mask") => {
            let mc = d.get("maskChar").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("•");
            let chars: Vec<char> = value.chars().collect();
            let visible = (d.get("visibleChars").and_then(|v| v.as_i64()).unwrap_or(0).max(0) as usize).min(chars.len());
            let hidden = chars.len() - visible;
            if hidden == 0 {
                return plain(value.to_string());
            }
            DecoratedDisplay { display: format!("{}{}", mc.repeat(hidden.min(64)), chars[chars.len() - visible..].iter().collect::<String>()), masked: true }
        }
        Some("prefix-suffix") => plain(format!("{}{value}{}", d.get("prefix").and_then(|v| v.as_str()).unwrap_or(""), d.get("suffix").and_then(|v| v.as_str()).unwrap_or(""))),
        Some("truncate") => {
            let m = d.get("maxLength").and_then(|v| v.as_u64()).unwrap_or(0).clamp(1, 10_000) as usize;
            if value.chars().count() <= m {
                plain(value.to_string())
            } else {
                plain(format!("{}\u{2026}", value.chars().take(m).collect::<String>()))
            }
        }
        Some("date-format") => {
            // Only "relative" is reformatted; the locale formats keep the raw text.
            let fmt = d.get("format").and_then(|v| v.as_str()).unwrap_or("datetime");
            match (fmt, parse_millis(value)) {
                ("relative", Some(ms)) => {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
                    plain(relative_time(now - ms))
                }
                _ => plain(value.to_string()),
            }
        }
        _ => plain(value.to_string()),
    }
}

/// Parse `YYYY-MM-DD[ T]HH:MM:SS` (UTC assumed) into epoch millis.
fn parse_millis(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, time) = s.split_once(|c| c == ' ' || c == 'T').unwrap_or((s, "00:00:00"));
    let d: Vec<i64> = date.split('-').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    if d.len() != 3 {
        return None;
    }
    let t: Vec<i64> = time.split(|c: char| c == ':' || c == '.' || c == '+' || c == 'Z').take(3).map(|x| x.get(..2).unwrap_or(x).parse().ok()).collect::<Option<_>>()?;
    let (y, m, day) = (d[0], d[1], d[2]);
    let (yy, mm) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + t.first().copied().unwrap_or(0) * 3600 + t.get(1).copied().unwrap_or(0) * 60 + t.get(2).copied().unwrap_or(0)) * 1000)
}

/// `NativeCommentMaps`: database-level comments keyed like the dictionary.
#[derive(Debug, Default, Clone)]
pub struct NativeComments {
    pub tables: BTreeMap<String, String>,
    pub columns: BTreeMap<String, String>,
}

/// `fetchNativeComments` (Postgres `obj_description`/`col_description`, MySQL
/// `information_schema` comments). Other engines report none.
pub async fn fetch_native_comments(driver: &dyn Driver, schema: &str) -> Result<NativeComments> {
    let lit = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let mut out = NativeComments::default();
    match driver.kind() {
        Kind::Postgres | Kind::SupabaseMgmt => {
            let t = driver
                .execute(&format!("SELECT n.nspname, c.relname, obj_description(c.oid, 'pg_class') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {} AND c.relkind IN ('r','p','v','m','f') AND obj_description(c.oid, 'pg_class') IS NOT NULL", lit(schema)), 10_000)
                .await?;
            for r in &t.rows {
                if let (Some(s), Some(tb), Some(d)) = (r[0].as_str(), r[1].as_str(), r[2].as_str()) {
                    out.tables.insert(table_key(s, tb), d.to_string());
                }
            }
            let c = driver
                .execute(&format!("SELECT n.nspname, c.relname, a.attname, col_description(c.oid, a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {} AND a.attnum > 0 AND NOT a.attisdropped AND col_description(c.oid, a.attnum) IS NOT NULL", lit(schema)), 50_000)
                .await?;
            for r in &c.rows {
                if let (Some(s), Some(tb), Some(col), Some(d)) = (r[0].as_str(), r[1].as_str(), r[2].as_str(), r[3].as_str()) {
                    out.columns.insert(column_key(s, tb, col), d.to_string());
                }
            }
        }
        Kind::MySql => {
            let t = driver.execute(&format!("SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = {} AND TABLE_COMMENT <> ''", lit(schema)), 10_000).await?;
            for r in &t.rows {
                if let (Some(s), Some(tb), Some(d)) = (r[0].as_str(), r[1].as_str(), r[2].as_str()) {
                    out.tables.insert(table_key(s, tb), d.to_string());
                }
            }
            let c = driver.execute(&format!("SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {} AND COLUMN_COMMENT <> ''", lit(schema)), 50_000).await?;
            for r in &c.rows {
                if let (Some(s), Some(tb), Some(col), Some(d)) = (r[0].as_str(), r[1].as_str(), r[2].as_str(), r[3].as_str()) {
                    out.columns.insert(column_key(s, tb, col), d.to_string());
                }
            }
        }
        _ => {}
    }
    Ok(out)
}

/// `setPostgresComment`: write the description as a native `COMMENT ON`.
pub fn postgres_comment_sql(schema: &str, table: &str, column: Option<&str>, description: &str) -> String {
    let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let val = if description.trim().is_empty() { "NULL".to_string() } else { format!("'{}'", description.replace('\'', "''")) };
    match column {
        Some(c) => format!("COMMENT ON COLUMN {}.{}.{} IS {val};", q(schema), q(table), q(c)),
        None => format!("COMMENT ON TABLE {}.{} IS {val};", q(schema), q(table)),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DescriptionSource {
    Local,
    Native,
}

/// `mergeDescription`: local overrides native.
pub fn merge_description(local: Option<&String>, native: Option<&String>) -> (Option<String>, Option<DescriptionSource>) {
    if let Some(l) = local.filter(|l| !l.trim().is_empty()) {
        return (Some(l.clone()), Some(DescriptionSource::Local));
    }
    if let Some(n) = native.filter(|n| !n.trim().is_empty()) {
        return (Some(n.clone()), Some(DescriptionSource::Native));
    }
    (None, None)
}

#[derive(Debug, Clone)]
pub struct CatalogColumnEntry {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary: bool,
    pub is_foreign_key: bool,
    pub description: Option<String>,
    pub source: Option<DescriptionSource>,
    pub decorator: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct CatalogTableEntry {
    pub schema: String,
    pub table: String,
    pub description: Option<String>,
    pub source: Option<DescriptionSource>,
    pub columns: Vec<CatalogColumnEntry>,
}

/// `CatalogSourceTable`.
pub struct CatalogSourceTable {
    pub schema: String,
    pub table: String,
    pub columns: Vec<rexa_drivers::ColumnDetail>,
}

/// `buildCatalogEntries`.
pub fn build_catalog_entries(tables: &[CatalogSourceTable], scope: &DictionaryScope, native: &NativeComments) -> Vec<CatalogTableEntry> {
    tables
        .iter()
        .map(|t| {
            let tk = table_key(&t.schema, &t.table);
            let (description, source) = merge_description(scope.tables.get(&tk), native.tables.get(&tk));
            let columns = t
                .columns
                .iter()
                .map(|c| {
                    let ck = column_key(&t.schema, &t.table, &c.column_name);
                    let (d, s) = merge_description(scope.columns.get(&ck), native.columns.get(&ck));
                    CatalogColumnEntry {
                        schema: t.schema.clone(),
                        table: t.table.clone(),
                        column: c.column_name.clone(),
                        data_type: c.data_type.clone(),
                        is_nullable: c.is_nullable,
                        is_primary: c.is_primary_key,
                        is_foreign_key: c.is_foreign_key,
                        description: d,
                        source: s,
                        decorator: scope.decorators.get(&ck).cloned(),
                    }
                })
                .collect();
            CatalogTableEntry { schema: t.schema.clone(), table: t.table.clone(), description, source, columns }
        })
        .collect()
}

/// `CatalogSearchHit`.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogSearchHit {
    /// "table" | "column"
    pub kind: &'static str,
    pub schema: String,
    pub table: String,
    pub column: Option<String>,
    pub description: Option<String>,
    pub score: u32,
}

/// `searchCatalog`: exact > prefix > contains > description, best first.
/// An empty query lists every table.
pub fn search_catalog(entries: &[CatalogTableEntry], query: &str) -> Vec<CatalogSearchHit> {
    let q = query.trim().to_lowercase();
    let hit = |kind, t: &CatalogTableEntry, column: Option<String>, description: Option<String>, score| CatalogSearchHit { kind, schema: t.schema.clone(), table: t.table.clone(), column, description, score };
    if q.is_empty() {
        return entries.iter().map(|t| hit("table", t, None, t.description.clone(), 0)).collect();
    }
    let rank = |name: &str, desc: Option<&str>, s: [u32; 4]| -> Option<u32> {
        let n = name.to_lowercase();
        if n == q {
            Some(s[0])
        } else if n.starts_with(&q) {
            Some(s[1])
        } else if n.contains(&q) {
            Some(s[2])
        } else if desc.is_some_and(|d| d.to_lowercase().contains(&q)) {
            Some(s[3])
        } else {
            None
        }
    };
    let mut hits = Vec::new();
    for t in entries {
        if let Some(sc) = rank(&t.table, t.description.as_deref(), [100, 70, 50, 30]) {
            hits.push(hit("table", t, None, t.description.clone(), sc));
        }
        for c in &t.columns {
            if let Some(sc) = rank(&c.column, c.description.as_deref(), [90, 60, 40, 25]) {
                hits.push(hit("column", t, Some(c.column.clone()), c.description.clone(), sc));
            }
        }
    }
    hits.sort_by(|a, b| b.score.cmp(&a.score));
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_and_decorators() {
        assert_eq!(table_key("public", "audit.events"), "public.audit\\.events");
        assert_eq!(column_key("a", "b", "c"), "a.b.c");
        let mask = serde_json::json!({"kind": "mask", "visibleChars": 2});
        assert_eq!(apply_column_decorator(Some("secret"), Some(&mask)), DecoratedDisplay { display: "••••et".into(), masked: true });
        let em = serde_json::json!({"kind": "enum-map", "mapping": {"1": "Active"}});
        assert_eq!(apply_column_decorator(Some("1"), Some(&em)).display, "Active");
        assert_eq!(apply_column_decorator(None, Some(&em)).display, "NULL");
        assert_eq!(parse_millis("1970-01-02 00:00:00"), Some(86_400_000));
        assert!(validate_decorator(&serde_json::json!({"kind": "truncate", "maxLength": 0})).is_err());
        assert_eq!(merge_description(Some(&"l".to_string()), Some(&"n".to_string())).1, Some(DescriptionSource::Local));
        assert_eq!(postgres_comment_sql("public", "t", Some("c"), "it's"), "COMMENT ON COLUMN \"public\".\"t\".\"c\" IS 'it''s';");
    }
}
