// ─── Data dictionary backend (Outerbase column-descriptor / data-catalog /
// ─── data-decorator parity) ────────────────────────────────────────────────
//
// Stores per-connection table descriptions, column descriptions, and column
// display decorators in a single JSON file under the app-data dir
// (`data-dictionary.json`). This is app metadata, not relational data, so a
// file store — same pattern as auth-storage.json / keybindings.json — keeps
// it out of both the sidecar's sqlite.db (no cross-process SQLite locking)
// and the sidecar itself (no new HTTP endpoints).
//
// Writes are atomic (temp file + rename) and serialized through a process-
// wide mutex. Keys are `schema.table` / `schema.table.column`, lower-capped
// and length-capped to keep the file bounded.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::get_app_data_dir;

static DICTIONARY_FILE_LOCK: Mutex<()> = Mutex::new(());

const MAX_DESCRIPTION_LEN: usize = 5_000;
const MAX_KEY_PART_LEN: usize = 256;

fn dictionary_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = get_app_data_dir(app);
    fs::create_dir_all(&dir).ok();
    dir.join("data-dictionary.json")
}

#[derive(Debug, Default, Serialize, Deserialize)]
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

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_dictionary(app: &tauri::AppHandle) -> DictionaryFile {
    fs::read_to_string(dictionary_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_dictionary(app: &tauri::AppHandle, data: &DictionaryFile) -> Result<(), String> {
    let path = dictionary_path(app);
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_part(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("schema/table/column names must not be empty".to_string());
    }
    if trimmed.len() > MAX_KEY_PART_LEN {
        return Err("schema/table/column names are too long".to_string());
    }
    if trimmed.contains('\0') {
        return Err("names must not contain NUL bytes".to_string());
    }
    Ok(trimmed.to_string())
}

/// Escape `\` and `.` so dotted identifiers can't collide:
/// `public` + `audit.events` -> `public.audit\.events`, distinct from
/// `public.audit` + `events` -> `public\.audit.events`. Mirrors the TS helper.
fn escape_part(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('.', "\\.")
}

fn table_key(schema: &str, table: &str) -> Result<String, String> {
    Ok(format!(
        "{}.{}",
        escape_part(&normalize_part(schema)?),
        escape_part(&normalize_part(table)?)
    ))
}

fn column_key(schema: &str, table: &str, column: &str) -> Result<String, String> {
    Ok(format!(
        "{}.{}.{}",
        escape_part(&normalize_part(schema)?),
        escape_part(&normalize_part(table)?),
        escape_part(&normalize_part(column)?)
    ))
}

fn normalize_description(raw: &str) -> String {
    let mut out: String = raw.trim().chars().take(MAX_DESCRIPTION_LEN).collect();
    out = out.replace('\0', "");
    out
}

#[derive(Debug, Serialize)]
pub struct DictionaryScopeView {
    tables: BTreeMap<String, String>,
    columns: BTreeMap<String, String>,
    decorators: BTreeMap<String, serde_json::Value>,
    updated_at: BTreeMap<String, u64>,
}

fn scope_view(scope: &ConnectionScope) -> DictionaryScopeView {
    let mut updated_at = BTreeMap::new();
    for (k, v) in scope.tables.iter().chain(scope.columns.iter()) {
        updated_at.insert(k.clone(), v.updated_at);
    }
    DictionaryScopeView {
        tables: scope
            .tables
            .iter()
            .map(|(k, v)| (k.clone(), v.description.clone()))
            .collect(),
        columns: scope
            .columns
            .iter()
            .map(|(k, v)| (k.clone(), v.description.clone()))
            .collect(),
        decorators: scope.decorators.clone(),
        updated_at,
    }
}

#[tauri::command]
pub fn dictionary_get(
    app: tauri::AppHandle,
    connection_id: i64,
) -> Result<DictionaryScopeView, String> {
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let data = read_dictionary(&app);
    let scope = data.connections.get(&connection_id.to_string());
    Ok(scope.map(scope_view).unwrap_or(DictionaryScopeView {
        tables: BTreeMap::new(),
        columns: BTreeMap::new(),
        decorators: BTreeMap::new(),
        updated_at: BTreeMap::new(),
    }))
}

/// Flat export of every connection scope (keys are connection ids). The
/// dictionary is small metadata, so a single call powers cross-connection
/// catalog search without N round trips.
#[tauri::command]
pub fn dictionary_get_all(
    app: tauri::AppHandle,
) -> Result<BTreeMap<String, DictionaryScopeView>, String> {
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let data = read_dictionary(&app);
    Ok(data
        .connections
        .iter()
        .map(|(k, v)| (k.clone(), scope_view(v)))
        .collect())
}

#[tauri::command]
pub fn dictionary_set_table(
    app: tauri::AppHandle,
    connection_id: i64,
    schema: String,
    table: String,
    description: String,
) -> Result<bool, String> {
    let key = table_key(&schema, &table)?;
    let normalized = normalize_description(&description);
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let mut data = read_dictionary(&app);
    let scope = data
        .connections
        .entry(connection_id.to_string())
        .or_default();
    if normalized.is_empty() {
        scope.tables.remove(&key);
    } else {
        scope.tables.insert(
            key,
            DescriptionEntry {
                description: normalized,
                updated_at: now_millis(),
            },
        );
    }
    write_dictionary(&app, &data)?;
    Ok(true)
}

#[tauri::command]
pub fn dictionary_set_column(
    app: tauri::AppHandle,
    connection_id: i64,
    schema: String,
    table: String,
    column: String,
    description: String,
) -> Result<bool, String> {
    let key = column_key(&schema, &table, &column)?;
    let normalized = normalize_description(&description);
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let mut data = read_dictionary(&app);
    let scope = data
        .connections
        .entry(connection_id.to_string())
        .or_default();
    if normalized.is_empty() {
        scope.columns.remove(&key);
    } else {
        scope.columns.insert(
            key,
            DescriptionEntry {
                description: normalized,
                updated_at: now_millis(),
            },
        );
    }
    write_dictionary(&app, &data)?;
    Ok(true)
}

/// Validate the decorator payload shape: a JSON object with a known `kind`.
/// Unknown or malformed payloads are rejected so a bad write can never break
/// grid rendering. `None` deletes the decorator for the column.
fn validate_decorator(value: &serde_json::Value) -> Result<(), String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "decorator must be a JSON object".to_string())?;
    match obj.get("kind").and_then(|k| k.as_str()) {
        Some("enum-map") => {
            if obj.get("mapping").and_then(|m| m.as_object()).is_none() {
                return Err("enum-map decorator requires a `mapping` object".to_string());
            }
            Ok(())
        }
        Some("mask") => Ok(()),
        Some("prefix-suffix") => Ok(()),
        Some("truncate") => {
            let max = obj.get("maxLength").and_then(|v| v.as_u64()).unwrap_or(0);
            if max == 0 || max > 10_000 {
                return Err("truncate decorator requires 1 <= maxLength <= 10000".to_string());
            }
            Ok(())
        }
        Some("date-format") => Ok(()),
        Some(other) => Err(format!("unknown decorator kind: {}", other)),
        None => Err("decorator requires a `kind` field".to_string()),
    }
}

#[tauri::command]
pub fn dictionary_set_decorator(
    app: tauri::AppHandle,
    connection_id: i64,
    schema: String,
    table: String,
    column: String,
    decorator: Option<serde_json::Value>,
) -> Result<bool, String> {
    let key = column_key(&schema, &table, &column)?;
    if let Some(ref value) = decorator {
        validate_decorator(value)?;
    }
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let mut data = read_dictionary(&app);
    let scope = data
        .connections
        .entry(connection_id.to_string())
        .or_default();
    match decorator {
        Some(value) => {
            scope.decorators.insert(key, value);
        }
        None => {
            scope.decorators.remove(&key);
        }
    }
    write_dictionary(&app, &data)?;
    Ok(true)
}

/// Drop a connection's whole scope (call when a connection is deleted).
#[tauri::command]
pub fn dictionary_delete_scope(app: tauri::AppHandle, connection_id: i64) -> Result<bool, String> {
    let _guard = DICTIONARY_FILE_LOCK.lock().unwrap();
    let mut data = read_dictionary(&app);
    let removed = data
        .connections
        .remove(&connection_id.to_string())
        .is_some();
    if removed {
        write_dictionary(&app, &data)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_key_trims_and_joins() {
        assert_eq!(table_key("public", "users").unwrap(), "public.users");
        assert_eq!(table_key("  public ", "users").unwrap(), "public.users");
    }

    #[test]
    fn keys_reject_empty_and_nul() {
        assert!(table_key("", "users").is_err());
        assert!(table_key("public", "").is_err());
        assert!(column_key("public", "users", "").is_err());
        assert!(table_key("pub\0lic", "users").is_err());
    }

    #[test]
    fn keys_reject_overlong_parts() {
        let long = "x".repeat(MAX_KEY_PART_LEN + 1);
        assert!(table_key(&long, "users").is_err());
    }

    #[test]
    fn column_key_joins_three_parts() {
        assert_eq!(
            column_key("public", "users", "id").unwrap(),
            "public.users.id"
        );
    }

    #[test]
    fn dotted_identifiers_do_not_collide() {
        let a = table_key("public", "audit.events").unwrap();
        let b = table_key("public.audit", "events").unwrap();
        assert_ne!(a, b);
        assert_eq!(a, r"public.audit\.events");
        assert_eq!(b, r"public\.audit.events");
    }

    #[test]
    fn description_trims_and_caps_length() {
        assert_eq!(normalize_description("  hello  "), "hello");
        assert_eq!(normalize_description(""), "");
        let long = "y".repeat(MAX_DESCRIPTION_LEN + 100);
        assert_eq!(normalize_description(&long).len(), MAX_DESCRIPTION_LEN);
        assert_eq!(normalize_description("a\0b"), "ab");
    }

    #[test]
    fn decorator_validation_accepts_known_kinds() {
        for kind in [
            "enum-map",
            "mask",
            "prefix-suffix",
            "truncate",
            "date-format",
        ] {
            let mut value = serde_json::json!({ "kind": kind });
            if kind == "enum-map" {
                value = serde_json::json!({ "kind": kind, "mapping": { "a": "A" } });
            }
            if kind == "truncate" {
                value = serde_json::json!({ "kind": kind, "maxLength": 80 });
            }
            assert!(validate_decorator(&value).is_ok(), "kind {}", kind);
        }
    }

    #[test]
    fn decorator_validation_rejects_bad_payloads() {
        assert!(validate_decorator(&serde_json::json!(null)).is_err());
        assert!(validate_decorator(&serde_json::json!("mask")).is_err());
        assert!(validate_decorator(&serde_json::json!({})).is_err());
        assert!(validate_decorator(&serde_json::json!({ "kind": "bogus" })).is_err());
        assert!(validate_decorator(&serde_json::json!({ "kind": "enum-map" })).is_err());
        assert!(validate_decorator(&serde_json::json!({ "kind": "truncate" })).is_err());
        assert!(
            validate_decorator(&serde_json::json!({ "kind": "truncate", "maxLength": 0 })).is_err()
        );
        assert!(validate_decorator(
            &serde_json::json!({ "kind": "truncate", "maxLength": 50_000 })
        )
        .is_err());
    }

    #[test]
    fn scope_view_flattens_entries() {
        let mut scope = ConnectionScope::default();
        scope.tables.insert(
            "public.users".to_string(),
            DescriptionEntry {
                description: "note".to_string(),
                updated_at: 7,
            },
        );
        let view = scope_view(&scope);
        assert_eq!(
            view.tables.get("public.users").map(String::as_str),
            Some("note")
        );
        assert_eq!(view.updated_at.get("public.users"), Some(&7));
        assert!(view.columns.is_empty());
    }
}
