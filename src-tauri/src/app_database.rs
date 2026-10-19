//! Read-only access to the local application's SQLite database.
//!
//! The sidecar still owns mutations and the other persistence domains. This
//! first migration slice moves connection-list reads into the Rust backend;
//! callers keep the existing sidecar fallback outside the desktop runtime.

use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

static APP_DB_LOCK: Mutex<()> = Mutex::new(());

fn db_path(app: &tauri::AppHandle) -> PathBuf {
    let legacy = crate::get_app_data_dir(app).join("sqlite.db");
    if legacy.exists() {
        return legacy;
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| crate::get_app_data_dir(app))
        .join("sqlite.db")
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create app database directory: {error}"))?;
    }
    let db =
        Connection::open(path).map_err(|error| format!("Could not open app database: {error}"))?;
    db.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|error| error.to_string())?;
    ensure_connection_tables(&db)?;
    Ok(db)
}

fn ensure_connection_tables(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS connections (
           id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
           connection_string TEXT NOT NULL, connection_type TEXT,
           created_at INTEGER NOT NULL, sort_order INTEGER, environment TEXT,
           color TEXT, \"group\" TEXT, is_favorite INTEGER DEFAULT 0,
           last_active INTEGER, host TEXT, port TEXT, database TEXT,
           username TEXT, password TEXT, ssl_mode TEXT, auth_token TEXT,
           credential_ref TEXT, credential_secret TEXT
         );
         CREATE TABLE IF NOT EXISTS connection_groups (
           id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS connection_group_members (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
           group_id INTEGER NOT NULL REFERENCES connection_groups(id) ON DELETE CASCADE
         );",
    )
    .map_err(|error| format!("Could not initialize app connection tables: {error}"))?;

    let migrations = [
        ("connection_type", "TEXT"),
        ("sort_order", "INTEGER"),
        ("environment", "TEXT"),
        ("color", "TEXT"),
        ("group", "TEXT"),
        ("is_favorite", "INTEGER DEFAULT 0"),
        ("last_active", "INTEGER"),
        ("host", "TEXT"),
        ("port", "TEXT"),
        ("database", "TEXT"),
        ("username", "TEXT"),
        ("password", "TEXT"),
        ("ssl_mode", "TEXT"),
        ("auth_token", "TEXT"),
        ("credential_ref", "TEXT"),
        ("credential_secret", "TEXT"),
    ];
    let mut stmt = db
        .prepare("PRAGMA table_info(connections)")
        .map_err(|error| error.to_string())?;
    let existing = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(stmt);
    for (column, declaration) in migrations {
        if !existing.contains(column) {
            let quoted = if column == "group" {
                "\"group\""
            } else {
                column
            };
            db.execute_batch(&format!(
                "ALTER TABLE connections ADD COLUMN {quoted} {declaration}"
            ))
            .map_err(|error| format!("Could not migrate connections.{column}: {error}"))?;
        }
    }
    Ok(())
}

fn row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let mut object = Map::new();
    for index in 0..row.as_ref().column_count() {
        let name = row.as_ref().column_name(index)?.to_string();
        let value = match row.get_ref(index)? {
            rusqlite::types::ValueRef::Null => Value::Null,
            rusqlite::types::ValueRef::Integer(value) => json!(value),
            rusqlite::types::ValueRef::Real(value) => json!(value),
            rusqlite::types::ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
            rusqlite::types::ValueRef::Blob(value) => json!(value),
        };
        object.insert(name, value);
    }
    Ok(Value::Object(object))
}

fn list_connections(db: &Connection) -> Result<Value, String> {
    let mut stmt = db
        .prepare("SELECT * FROM connections ORDER BY sort_order DESC, created_at DESC")
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query_map([], row_json)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for row in &mut rows {
        let id = row.get("id").and_then(Value::as_i64).unwrap_or_default();
        let groups = {
            let mut groups_stmt = db.prepare(
                "SELECT g.name FROM connection_group_members m JOIN connection_groups g ON g.id = m.group_id WHERE m.connection_id = ?1 ORDER BY g.name"
            ).map_err(|error| error.to_string())?;
            groups_stmt
                .query_map([id], |group| group.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        if let Some(object) = row.as_object_mut() {
            object.insert("groups".into(), json!(groups));
        }
    }
    Ok(json!(rows))
}

/// Return locally saved connections without opening SQLite in the sidecar.
#[tauri::command]
pub fn app_database_list_connections(app: tauri::AppHandle) -> Result<Value, String> {
    let _guard = APP_DB_LOCK
        .lock()
        .map_err(|_| "App database lock is unavailable".to_string())?;
    list_connections(&open_db(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_migrates_connection_tables_and_reads_groups() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_string TEXT NOT NULL, created_at INTEGER NOT NULL);").unwrap();
        ensure_connection_tables(&db).unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at, sort_order) VALUES (1, 'local', 'postgres://example', 1, 2)", []).unwrap();
        db.execute(
            "INSERT INTO connection_groups (name, created_at) VALUES ('Personal', 1)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO connection_group_members (connection_id, group_id) VALUES (1, 1)",
            [],
        )
        .unwrap();
        let rows = list_connections(&db).unwrap();
        assert_eq!(rows[0]["connectionString"], Value::Null);
        assert_eq!(rows[0]["connection_string"], "postgres://example");
        assert_eq!(rows[0]["groups"], json!(["Personal"]));
    }
}
