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

/// Columns returned for each connection, as (column, JSON key). Every one
/// after `connection_string` was added by a later sidecar migration, so an
/// older database may not have it yet.
const CONNECTION_COLUMNS: &[(&str, &str)] = &[
    ("id", "id"),
    ("name", "name"),
    ("connection_string", "connectionString"),
    ("connection_type", "connectionType"),
    ("host", "host"),
    ("port", "port"),
    ("database", "database"),
    ("username", "username"),
    ("password", "password"),
    ("ssl_mode", "sslMode"),
    ("auth_token", "authToken"),
    ("credential_ref", "credentialRef"),
    ("credential_secret", "credentialSecret"),
    ("created_at", "createdAt"),
    ("sort_order", "sortOrder"),
    ("environment", "environment"),
    ("color", "color"),
    ("tags", "tags"),
    ("icon", "icon"),
    ("group", "group"),
    ("is_favorite", "isFavorite"),
    ("last_active", "lastActive"),
];

fn table_columns(db: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = db
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .map_err(|error| error.to_string())?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(columns)
}

/// This read is read-only and can run before the sidecar has migrated the
/// database, so columns that don't exist yet come back as null instead of
/// failing the whole list.
fn connections_query(existing: &[String]) -> String {
    let has = |column: &str| existing.iter().any(|name| name == column);
    let select = CONNECTION_COLUMNS
        .iter()
        .map(|(column, key)| {
            if has(column) {
                format!("\"{column}\" AS \"{key}\"")
            } else {
                format!("NULL AS \"{key}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let order = if has("sort_order") {
        "sort_order DESC, created_at DESC"
    } else {
        "created_at DESC"
    };
    format!(
        "SELECT {select} FROM connections WHERE connection_string NOT LIKE 'dev://local/%' ORDER BY {order}"
    )
}

fn list_connections(db: &Connection) -> Result<Value, String> {
    let existing = table_columns(db, "connections")?;
    if existing.is_empty() {
        return Ok(json!([]));
    }
    let mut stmt = db
        .prepare(&connections_query(&existing))
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query_map([], row_json)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let has_groups = !table_columns(db, "connection_groups")?.is_empty()
        && !table_columns(db, "connection_group_members")?.is_empty();
    for row in &mut rows {
        let id = row.get("id").and_then(Value::as_i64).unwrap_or_default();
        let groups = if has_groups {
            let mut groups_stmt = db.prepare(
                "SELECT g.name FROM connection_group_members m JOIN connection_groups g ON g.id = m.group_id WHERE m.connection_id = ?1 ORDER BY g.name"
            ).map_err(|error| error.to_string())?;
            let groups = groups_stmt
                .query_map([id], |group| group.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            groups
        } else {
            Vec::new()
        };
        if let Some(object) = row.as_object_mut() {
            object.insert("groups".into(), json!(groups));
            // Stored as JSON text; the HTTP API returns these as an array.
            let mut tags = object
                .get("tags")
                .and_then(Value::as_str)
                .and_then(|tags| serde_json::from_str::<Vec<String>>(tags).ok())
                .unwrap_or_default();
            // Before the sidecar's tags migration, a connection's tag still
            // lives in `environment`; show it the way the migration will store it.
            if tags.is_empty() {
                if let Some(environment) = object
                    .get("environment")
                    .and_then(Value::as_str)
                    .filter(|environment| !environment.is_empty())
                {
                    tags.push(environment.to_string());
                }
            }
            object.insert("tags".into(), json!(tags));
        }
    }
    Ok(json!(rows))
}

/// Return locally saved connections from SQLite without enabling writes.
#[tauri::command]
pub fn app_database_list_connections(app: tauri::AppHandle) -> Result<Value, String> {
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
        db.execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_string TEXT NOT NULL, connection_type TEXT, host TEXT, port TEXT, database TEXT, username TEXT, password TEXT, ssl_mode TEXT, auth_token TEXT, credential_ref TEXT, credential_secret TEXT, created_at INTEGER NOT NULL, sort_order INTEGER, environment TEXT, color TEXT, tags TEXT, icon TEXT, \"group\" TEXT, is_favorite INTEGER, last_active INTEGER);
            CREATE TABLE connection_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER);
            CREATE TABLE connection_group_members (connection_id INTEGER NOT NULL, group_id INTEGER NOT NULL);").unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at, sort_order, tags, icon) VALUES (1, 'local', 'postgres://example', 1, 2, '[\"prod\"]', 'emoji:🚀')", []).unwrap();
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
        assert_eq!(rows[0]["tags"], json!(["prod"]));
        assert_eq!(rows[0]["icon"], "emoji:🚀");
    }

    #[test]
    fn reads_databases_the_sidecar_has_not_migrated_yet() {
        let db = Connection::open_in_memory().unwrap();
        // The original schema: no tags, icon, sort_order or group tables.
        db.execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_string TEXT NOT NULL, created_at INTEGER NOT NULL, environment TEXT);").unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at, environment) VALUES (1, 'old', 'postgres://old', 1, 'production')", []).unwrap();
        db.execute("INSERT INTO connections (id, name, connection_string, created_at) VALUES (2, 'newer', 'postgres://newer', 2)", []).unwrap();
        let rows = list_connections(&db).unwrap();
        let rows = rows.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["name"], "newer");
        assert_eq!(rows[0]["tags"], json!([]));
        assert_eq!(rows[0]["icon"], Value::Null);
        assert_eq!(rows[0]["groups"], json!([]));
        assert_eq!(rows[1]["tags"], json!(["production"]));
    }

    #[test]
    fn reads_nothing_before_the_connections_table_exists() {
        let db = Connection::open_in_memory().unwrap();
        assert_eq!(list_connections(&db).unwrap(), json!([]));
    }
}
