//! Rust read boundary for the local application's SQLite database.

use rusqlite::Connection;
use serde_json::{json, Map, Value};
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
        .prepare("SELECT id, name, connection_string AS connectionString, connection_type AS connectionType, host, port, database, username, password, ssl_mode AS sslMode, auth_token AS authToken, credential_ref AS credentialRef, credential_secret AS credentialSecret, created_at AS createdAt, sort_order AS sortOrder, environment, color, \"group\", is_favorite AS isFavorite, last_active AS lastActive FROM connections WHERE connection_string NOT LIKE 'dev://local/%' ORDER BY sort_order DESC, created_at DESC")
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
            let groups = groups_stmt
                .query_map([id], |group| group.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            groups
        };
        if let Some(object) = row.as_object_mut() {
            object.insert("groups".into(), json!(groups));
        }
    }
    Ok(json!(rows))
}

/// Return locally saved connections from SQLite without enabling writes.
#[tauri::command]
pub fn app_database_list_connections(
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let _guard = APP_DB_LOCK
        .lock()
        .map_err(|_| "App database lock is unavailable".to_string())?;
    let path = db_path(&app);
    if !path.exists() {
        return Ok(json!([]));
    }
    let db = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Could not open app database read-only: {error}"))?;
    list_connections(&db)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_connections_and_groups_without_writing() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_string TEXT NOT NULL, connection_type TEXT, host TEXT, port TEXT, database TEXT, username TEXT, password TEXT, ssl_mode TEXT, auth_token TEXT, credential_ref TEXT, credential_secret TEXT, created_at INTEGER NOT NULL, sort_order INTEGER, environment TEXT, color TEXT, \"group\" TEXT, is_favorite INTEGER, last_active INTEGER);
            CREATE TABLE connection_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER);
            CREATE TABLE connection_group_members (connection_id INTEGER NOT NULL, group_id INTEGER NOT NULL);").unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at, sort_order) VALUES (1, 'local', 'postgres://example', 1, 2)", []).unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at, sort_order) VALUES (2, 'placeholder', 'dev://local/2', 2, 3)", []).unwrap();
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
        assert_eq!(rows.as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["connectionString"], "postgres://example");
        assert_eq!(rows[0]["groups"], json!(["Personal"]));
    }
}
