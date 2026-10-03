//! Embedded Rust implementation of the RexaDB Studio workspace API.
//!
//! This runs in the Tauri process and stores workspace state beside RexaDB's
//! app data. The API intentionally keeps the Next server's `/api/...` wire
//! shape so the existing workspace client can switch over without a new
//! protocol.

use axum::{
    extract::{Path as AxumPath, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::Sha1;
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tower_http::cors::CorsLayer;

const MIGRATIONS: &[(&str, &str)] = &[
    ("0000_shallow_alex_wilder", include_str!("../migrations/rexadb-studio/0000_shallow_alex_wilder.sql")),
    ("0001_burly_shiver_man", include_str!("../migrations/rexadb-studio/0001_burly_shiver_man.sql")),
    ("0002_vengeful_ben_urich", include_str!("../migrations/rexadb-studio/0002_vengeful_ben_urich.sql")),
    ("0003_rapid_sister_grimm", include_str!("../migrations/rexadb-studio/0003_rapid_sister_grimm.sql")),
    ("0004_abandoned_electro", include_str!("../migrations/rexadb-studio/0004_abandoned_electro.sql")),
    ("0005_white_mantis", include_str!("../migrations/rexadb-studio/0005_white_mantis.sql")),
    ("0006_motionless_lenny_balinger", include_str!("../migrations/rexadb-studio/0006_motionless_lenny_balinger.sql")),
    ("0007_blue_longshot", include_str!("../migrations/rexadb-studio/0007_blue_longshot.sql")),
    ("0008_avatar_store", include_str!("../migrations/rexadb-studio/0008_avatar_store.sql")),
    ("0009_connection_user_grant", include_str!("../migrations/rexadb-studio/0009_connection_user_grant.sql")),
];

const PERMISSIONS: &[(&str, &str, &str)] = &[
    ("connections.create", "Create Connections", "Create new database connections"),
    ("connections.read", "Read Connections", "View connection metadata"),
    ("connections.update", "Update Connections", "Edit connection configuration"),
    ("connections.delete", "Delete Connections", "Remove connections"),
    ("connections.manage_access", "Manage Access", "Grant or revoke access to connections"),
    ("queries.execute", "Execute Queries", "Run arbitrary SQL on a connection"),
    ("queries.readonly", "Read-Only Queries", "Run SELECT-only queries"),
    ("queries.saved", "Saved Queries", "Run predefined saved queries"),
    ("users.read", "Read Users", "View user list and details"),
    ("users.manage", "Manage Users", "Invite, update, or remove users"),
    ("roles.manage", "Manage Roles", "Create, edit, or delete custom roles"),
    ("roles.assign", "Assign Roles", "Change role assignments for users"),
    ("invites.create", "Create Invites", "Generate new invitation tokens"),
    ("invites.view", "View Invites", "List invitation records"),
    ("invites.revoke", "Revoke Invites", "Cancel pending invitations"),
    ("query_logs.view", "View Query Logs", "View query audit trail"),
    ("audit_logs.view", "View Audit Logs", "View API request audit logs"),
    ("permissions.view", "View Permissions", "List available permissions"),
    ("teams.create", "Create Teams", "Create new teams"),
    ("teams.read", "Read Teams", "View team details and members"),
    ("teams.update", "Update Teams", "Edit team name and description"),
    ("teams.delete", "Delete Teams", "Remove teams"),
    ("teams.manage_members", "Manage Members", "Add or remove team members"),
    ("teams.manage_access", "Manage Team Access", "Grant or revoke connection access for teams"),
    ("queries.approve", "Approve Queries", "Approve or reject pending queries"),
    ("kv_store.create", "Create KV Store Entries", "Create new key-value entries"),
    ("kv_store.manage", "Manage KV Store Entries", "View, update, or delete any key-value entry"),
];

const ADMIN_EXCLUDED: &[&str] = &[
    "connections.delete", "roles.manage", "teams.manage_members", "teams.manage_access",
];
const DEVELOPER_PERMISSIONS: &[&str] = &[
    "connections.create", "connections.read", "connections.update", "connections.delete",
    "queries.execute", "queries.readonly", "queries.saved", "permissions.view", "kv_store.create",
];
const VIEWER_PERMISSIONS: &[&str] = &[
    "connections.read", "queries.readonly", "permissions.view", "kv_store.create",
];

#[derive(Clone)]
struct ApiState {
    db: Arc<Mutex<Connection>>,
    jwt_secret: Arc<Vec<u8>>,
    encryption_key: Arc<Vec<u8>>,
    sidecar_api: String,
}

#[derive(Default)]
pub struct EmbeddedStudioState {
    servers: Mutex<Vec<EmbeddedStudioServer>>,
    registry_path: Mutex<Option<PathBuf>>,
}

struct EmbeddedStudioServer {
    id: String,
    name: String,
    data_path: PathBuf,
    legacy_path: bool,
    port: u16,
    url: String,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    state: Option<ApiState>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerRecord {
    id: String,
    name: String,
    port: u16,
    #[serde(default)]
    legacy_path: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub id: String,
    pub name: String,
    pub running: bool,
    pub configured: bool,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
    iat: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    purpose: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct SetupInput {
    #[serde(rename = "adminEmail")]
    pub admin_email: String,
    #[serde(rename = "adminPassword")]
    pub admin_password: String,
}

fn unix_time() -> usize {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as usize
}

fn app_error(status: StatusCode, message: impl Into<String>) -> impl IntoResponse {
    (status, Json(json!({ "error": message.into() })))
}

fn setting_secret(conn: &Connection, key: &str) -> Result<Vec<u8>, String> {
    let existing = conn.query_row(
        "SELECT value FROM rexadb_studio_settings WHERE key = ?1", [key], |row| row.get::<_, String>(0),
    ).optional().map_err(|e| e.to_string())?;
    match existing {
        Some(value) => hex_decode(&value),
        None => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let encoded = hex_encode(&bytes);
            conn.execute("INSERT INTO rexadb_studio_settings (key, value) VALUES (?1, ?2)", params![key, encoded])
                .map_err(|e| e.to_string())?;
            Ok(bytes.to_vec())
        }
    }
}

fn init_db(path: &Path) -> Result<(Connection, Vec<u8>, Vec<u8>), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create workspace data directory: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("Could not open workspace database: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS rexadb_studio_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);")
        .map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS rexadb_studio_migrations (id TEXT PRIMARY KEY NOT NULL);")
        .map_err(|e| e.to_string())?;
    for (id, sql) in MIGRATIONS {
        let applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rexadb_studio_migrations WHERE id = ?1)",
            [id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !applied {
            conn.execute_batch("BEGIN IMMEDIATE;").map_err(|e| e.to_string())?;
            if let Err(error) = conn.execute_batch(sql) {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(format!("Workspace database migration {id} failed: {error}"));
            }
            conn.execute("INSERT INTO rexadb_studio_migrations (id) VALUES (?1)", [id])
                .map_err(|e| e.to_string())?;
            conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
        }
    }
    let jwt_secret = setting_secret(&conn, "jwt_secret")?;
    let encryption_key = setting_secret(&conn, "encryption_key")?;
    Ok((conn, jwt_secret, encryption_key))
}

fn seed_defaults(db: &Connection, now: &str) -> Result<(), String> {
    for (code, name, description) in PERMISSIONS {
        db.execute(
            "INSERT INTO permissions (code, name, description, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(code) DO NOTHING",
            params![code, name, description, now],
        ).map_err(|e| e.to_string())?;
    }
    let role_specs: &[(&str, &str, bool)] = &[
        ("super_admin", "Unrestricted access to all resources and settings", true),
        ("admin", "Full administrative access except destructive actions", true),
        ("developer", "Can manage connections and run queries", true),
        ("viewer", "Read-only access to connections and queries", true),
    ];
    for (name, description, is_system) in role_specs {
        db.execute(
            "INSERT INTO roles (name, description, is_system, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(name) DO NOTHING",
            params![name, description, is_system, now],
        ).map_err(|e| e.to_string())?;
    }
    for (role_name, codes) in [
        ("super_admin", None),
        ("admin", Some("admin")),
        ("developer", Some("developer")),
        ("viewer", Some("viewer")),
    ] {
        let role_id: i64 = db.query_row("SELECT id FROM roles WHERE name = ?1", [role_name], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let mut statement = db.prepare("SELECT id, code FROM permissions").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for permission in rows {
            let (permission_id, code) = permission.map_err(|e| e.to_string())?;
            let allowed = match codes {
                None => true,
                Some("admin") => !ADMIN_EXCLUDED.contains(&code.as_str()),
                Some("developer") => DEVELOPER_PERMISSIONS.contains(&code.as_str()),
                Some("viewer") => VIEWER_PERMISSIONS.contains(&code.as_str()),
                _ => false,
            };
            if allowed {
                db.execute(
                    "INSERT INTO role_permissions (role_id, permission_id) VALUES (?1, ?2) ON CONFLICT(role_id, permission_id) DO NOTHING",
                    params![role_id, permission_id],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub async fn start(app: &tauri::AppHandle, data_dir: PathBuf, sidecar_api: String) -> Result<String, String> {
    restore_servers(app, data_dir, sidecar_api).await?;
    Ok(String::new())
}

pub async fn start_named(app: &tauri::AppHandle, data_dir: PathBuf, sidecar_api: String, id: String, name: String) -> Result<String, String> {
    let root = data_dir.join("rexadb-studio");
    let app_state = app.state::<EmbeddedStudioState>();
    if let Some(url) = app_state.servers.lock().unwrap().iter().find(|server| server.id == id && server.task.as_ref().is_some_and(|task| !task.inner().is_finished())).map(|server| server.url.clone()) {
        return Ok(url);
    }
    let server_record = app_state.servers.lock().unwrap().iter().find(|server| server.id == id)
        .map(|server| ServerRecord { id: server.id.clone(), name: server.name.clone(), port: server.port, legacy_path: server.legacy_path })
        .unwrap_or(ServerRecord { id: id.clone(), name, port: 0, legacy_path: false });
    let path = if server_record.legacy_path { root.join("studio.db") } else { root.join(&id).join("studio.db") };
    let (conn, secret, encryption_key) = init_db(&path)?;
    conn.execute("INSERT INTO rexadb_studio_settings (key, value) VALUES ('server_name', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [&server_record.name]).map_err(|e| e.to_string())?;
    let state = ApiState { db: Arc::new(Mutex::new(conn)), jwt_secret: Arc::new(secret), encryption_key: Arc::new(encryption_key), sidecar_api };
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("http://tauri.localhost"),
            HeaderValue::from_static("http://localhost:3000"),
            HeaderValue::from_static("http://127.0.0.1:3000"),
            HeaderValue::from_static("http://localhost:4173"),
            HeaderValue::from_static("http://127.0.0.1:4173"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    let api_router = Router::new()
        .route("/health", get(health))
        .route("/api/local/status", get(local_status))
        .route("/api/local/setup", post(setup_admin))
        .route("/api/auth/login", post(login))
        .route("/api/auth/login/totp", post(login_totp))
        .route("/api/auth/me", get(auth_me))
        .route("/api/auth", get(auth_me))
        .route("/api/auth/password", post(set_password))
        .route("/api/studio", get(studio_info))
        .route("/api/invites", get(invites_list).post(invite_create))
        .route("/api/invites/accept", post(invite_accept))
        .route("/api/invites/{id}/revoke", post(invite_revoke))
        .route("/api/permissions", get(permissions_list))
        .route("/api/roles", get(roles_list).post(role_create))
        .route("/api/roles/{id}", get(role_get).put(role_update).delete(role_delete))
        .route("/api/users", get(users_list))
        .route("/api/users/{id}", axum::routing::patch(user_update).delete(user_delete))
        .route("/api/users/{id}/avatar", axum::routing::put(user_avatar_upload).delete(user_avatar_delete))
        .route("/api/avatars/{name}", get(avatar_get))
        .route("/api/users/{id}/role", axum::routing::patch(user_assign_role))
        .route("/api/connections", get(connections_list).post(connection_create))
        .route("/api/connections/{id}", get(connection_get).put(connection_update).delete(connection_delete))
        .route("/api/connections/{id}/credentials", get(connection_credentials))
        .route("/api/connections/{id}/access", get(connection_access_list).put(connection_access_set))
        .route("/api/connections/{id}/query", post(connection_query))
        .route("/api/connections/{id}/saved-queries", get(saved_queries_list).post(saved_query_create))
        .route("/api/connections/{id}/saved-queries/{query_id}", axum::routing::put(saved_query_update).delete(saved_query_delete))
        .route("/api/kv-store", get(kv_list).post(kv_create))
        .route("/api/kv-store/{id}", get(kv_get).put(kv_update).delete(kv_delete))
        .route("/api/query-logs", get(query_logs_list))
        .route("/api/audit-logs", get(audit_logs_list))
        .route("/api/teams", get(teams_list).post(team_create))
        .route("/api/teams/{id}", get(team_get).put(team_update).delete(team_delete))
        .route("/api/teams/{id}/members", get(team_members_list).post(team_member_add))
        .route("/api/teams/{id}/members/{user_id}", axum::routing::delete(team_member_remove))
        .route("/api/teams/{id}/access", get(team_access_list).put(team_access_set))
        .route("/api/teams/{id}/permissions", get(team_permissions_list).post(team_permission_add).delete(team_permission_remove))
        .fallback(api_not_found)
        .layer(middleware::from_fn(log_api_request))
        // Axum rejects `Bytes` bodies over 2MB by default, which would break
        // avatar uploads between 2MB and the 5MB limit enforced by
        // `user_avatar_upload`. Raise the framework cap; per-endpoint checks
        // remain authoritative.
        .layer(axum::extract::DefaultBodyLimit::max(6 * 1024 * 1024))
        .layer(cors)
        .with_state(state.clone());
    let router = Router::new().nest("/studio-api", api_router.clone()).merge(api_router);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", server_record.port)).await
        .map_err(|e| format!("Could not bind local Studio server port {}: {e}", server_record.port))?;
    let address: SocketAddr = listener.local_addr().map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{}", address.port());
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("Embedded RexaDB Studio API stopped: {error}");
        }
    });
    let mut servers = app_state.servers.lock().unwrap();
    if let Some(existing) = servers.iter_mut().find(|server| server.id == id) {
        if let Some(task) = existing.task.take() { task.abort(); }
        existing.name = server_record.name.clone();
        existing.data_path = path;
        existing.legacy_path = server_record.legacy_path;
        existing.port = address.port();
        existing.url = url.clone();
        existing.task = Some(task);
        existing.state = Some(state);
    } else {
        servers.push(EmbeddedStudioServer { id, name: server_record.name.clone(), data_path: path, legacy_path: server_record.legacy_path, port: address.port(), url: url.clone(), task: Some(task), state: Some(state) });
    }
    drop(servers);
    persist_registry(&app_state);
    Ok(url)
}

fn read_server_name(path: &Path, fallback: String) -> String {
    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
        .and_then(|db| db.query_row("SELECT value FROM rexadb_studio_settings WHERE key = 'server_name'", [], |row| row.get::<_, String>(0)).optional().ok().flatten())
        .filter(|name| !name.trim().is_empty()).unwrap_or(fallback)
}

fn persist_registry(state: &EmbeddedStudioState) {
    let Some(path) = state.registry_path.lock().unwrap().clone() else { return; };
    let records: Vec<ServerRecord> = state.servers.lock().unwrap().iter().map(|server| ServerRecord {
        id: server.id.clone(), name: server.name.clone(), port: server.port, legacy_path: server.legacy_path,
    }).collect();
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    if let Ok(data) = serde_json::to_vec_pretty(&records) {
        let temp = path.with_extension("json.tmp");
        if std::fs::write(&temp, data).is_ok() {
            if let Err(error) = std::fs::rename(&temp, &path) {
                // Windows does not replace an existing destination with rename.
                if path.exists() {
                    if let Err(remove_error) = std::fs::remove_file(&path) {
                        log::error!("Could not replace local Studio registry {}: {remove_error}", path.display());
                        let _ = std::fs::remove_file(&temp);
                        return;
                    }
                    if let Err(retry_error) = std::fs::rename(&temp, &path) {
                        log::error!("Could not persist local Studio registry {}: {retry_error}", path.display());
                    }
                } else {
                    log::error!("Could not persist local Studio registry {}: {error}", path.display());
                }
            }
        }
    }
}

async fn restore_servers(app: &tauri::AppHandle, data_dir: PathBuf, sidecar_api: String) -> Result<(), String> {
    let root = data_dir.join("rexadb-studio");
    std::fs::create_dir_all(&root).map_err(|error| format!("Could not create local Studio directory: {error}"))?;
    let registry_path = root.join("servers.json");
    let state = app.state::<EmbeddedStudioState>();
    *state.registry_path.lock().unwrap() = Some(registry_path.clone());

    let mut records = if registry_path.exists() {
        let bytes = std::fs::read(&registry_path).map_err(|error| error.to_string())?;
        match serde_json::from_slice::<Vec<ServerRecord>>(&bytes) {
            Ok(records) => records.into_iter().filter(valid_server_record).collect(),
            Err(error) => {
                log::error!("Could not read local Studio server registry {}: {error}", registry_path.display());
                Vec::new()
            }
        }
    } else { Vec::new() };

    let legacy_db = root.join("studio.db");
    if legacy_db.exists() && !records.iter().any(|record| record.legacy_path) {
        records.push(ServerRecord { id: "default".into(), name: read_server_name(&legacy_db, "Local RexaDB Studio".into()), port: 0, legacy_path: true });
    }
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
            let id = entry.file_name().to_string_lossy().to_string();
            let db_path = entry.path().join("studio.db");
            if db_path.exists() && !records.iter().any(|record| record.id == id) {
                records.push(ServerRecord { id: id.clone(), name: read_server_name(&db_path, format!("Local server {}", &id[..id.len().min(8)])), port: 0, legacy_path: false });
            }
        }
    }

    {
        let mut servers = state.servers.lock().unwrap();
        servers.clear();
        for record in &records {
            let data_path = if record.legacy_path { root.join("studio.db") } else { root.join(&record.id).join("studio.db") };
            servers.push(EmbeddedStudioServer { id: record.id.clone(), name: record.name.clone(), data_path, legacy_path: record.legacy_path, port: record.port, url: String::new(), task: None, state: None });
        }
    }
    persist_registry(&state);
    for record in records {
        if let Err(error) = start_named(app, data_dir.clone(), sidecar_api.clone(), record.id.clone(), record.name.clone()).await {
            log::error!("Could not restore local Studio server '{}' ({}): {}", record.name, record.id, error);
        }
    }
    Ok(())
}

fn valid_server_record(record: &ServerRecord) -> bool {
    !record.id.is_empty()
        && record.id.len() <= 64
        && record.id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        && !record.name.trim().is_empty()
}

pub async fn recover_server_for_user(app: &tauri::AppHandle, data_dir: PathBuf, sidecar_api: String, old_url: &str, user_id: &str) -> Result<Option<ServerStatus>, String> {
    let parsed = url::Url::parse(old_url).map_err(|error| format!("Invalid previous local server URL: {error}"))?;
    if !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")) { return Err("Only a local server URL can be recovered.".into()); }
    let old_port = parsed.port().ok_or("Previous local server URL has no port.")?;
    let state = app.state::<EmbeddedStudioState>();
    let mut matched = {
        let servers = state.servers.lock().unwrap();
        servers.iter().find(|server| {
            Connection::open_with_flags(&server.data_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
                .and_then(|db| db.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)", [user_id], |row| row.get::<_, bool>(0)).ok()).unwrap_or(false)
        }).map(|server| (server.id.clone(), server.name.clone(), server.port, server.task.as_ref().is_some_and(|task| !task.inner().is_finished()), server.url.clone()))
    };
    if matched.is_none() {
        let root = data_dir.join("rexadb-studio");
        *state.registry_path.lock().unwrap() = Some(root.join("servers.json"));
        let mut candidates = Vec::new();
        let legacy = root.join("studio.db");
        if legacy.exists() { candidates.push(("default".to_string(), legacy, true)); }
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
                let id = entry.file_name().to_string_lossy().to_string();
                candidates.push((id.clone(), entry.path().join("studio.db"), false));
            }
        }
        for (id, path, legacy_path) in candidates {
            let contains_user = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
                .and_then(|db| db.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)", [user_id], |row| row.get::<_, bool>(0)).ok()).unwrap_or(false);
            if contains_user {
                let fallback = if legacy_path { "Local RexaDB Studio".to_string() } else { format!("Local server {}", &id[..id.len().min(8)]) };
                let name = read_server_name(&path, fallback);
                {
                    let mut servers = state.servers.lock().unwrap();
                    if !servers.iter().any(|server| server.id == id) {
                        servers.push(EmbeddedStudioServer { id: id.clone(), name: name.clone(), data_path: path, legacy_path, port: 0, url: String::new(), task: None, state: None });
                    }
                }
                persist_registry(&state);
                matched = state.servers.lock().unwrap().iter().find(|server| server.id == id)
                    .map(|server| (server.id.clone(), server.name.clone(), server.port, server.task.as_ref().is_some_and(|task| !task.inner().is_finished()), server.url.clone()));
                break;
            }
        }
    }
    let Some((id, name, registered_port, running, current_url)) = matched else { return Ok(None); };
    if running && current_url == old_url {
        return Ok(list_servers(&state).into_iter().find(|server| server.id == id));
    }
    if running { stop_server(&state, &id)?; }
    if let Some(server) = state.servers.lock().unwrap().iter_mut().find(|server| server.id == id) { server.port = old_port; }
    match start_named(app, data_dir.clone(), sidecar_api.clone(), id.clone(), name.clone()).await {
        Ok(_) => {}
        Err(bind_error) => {
            if let Some(server) = state.servers.lock().unwrap().iter_mut().find(|server| server.id == id) { server.port = registered_port; }
            if let Err(fallback_error) = start_named(app, data_dir, sidecar_api, id.clone(), name).await {
                return Err(format!("Could not restore the saved local port ({bind_error}) or restart on the registered port ({fallback_error})."));
            }
        }
    }
    Ok(list_servers(&state).into_iter().find(|server| server.id == id))
}

fn server_configured(server: &EmbeddedStudioServer) -> bool {
    server.state.as_ref().and_then(|state| state.db.lock().ok())
        .and_then(|db| db.query_row("SELECT EXISTS(SELECT 1 FROM users)", [], |row| row.get::<_, bool>(0)).ok())
        .or_else(|| Connection::open_with_flags(&server.data_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
            .and_then(|db| db.query_row("SELECT EXISTS(SELECT 1 FROM users)", [], |row| row.get::<_, bool>(0)).ok()))
        .unwrap_or(false)
}

pub fn list_servers(state: &EmbeddedStudioState) -> Vec<ServerStatus> {
    let mut result: Vec<ServerStatus> = state.servers.lock().unwrap().iter().map(|server| ServerStatus {
        id: server.id.clone(), name: server.name.clone(),
        running: server.task.as_ref().is_some_and(|task| !task.inner().is_finished()),
        configured: server_configured(server),
        url: server.task.as_ref().filter(|task| !task.inner().is_finished()).map(|_| server.url.clone()),
    }).collect();
    result.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    result
}

pub fn add_server(state: &EmbeddedStudioState, id: String, name: String, data_dir: &Path) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err("Invalid local server id.".into());
    }
    if name.trim().is_empty() || name.len() > 100 { return Err("Server name must be between 1 and 100 characters.".into()); }
    *state.registry_path.lock().unwrap() = Some(data_dir.join("rexadb-studio").join("servers.json"));
    let path = data_dir.join("rexadb-studio").join(&id).join("studio.db");
    let mut servers = state.servers.lock().unwrap();
    if let Some(existing) = servers.iter_mut().find(|server| server.id == id) {
        existing.name = name.trim().to_string();
        return Ok(());
    }
    servers.push(EmbeddedStudioServer {
        id, name: name.trim().to_string(), data_path: path, legacy_path: false, port: 0, url: String::new(), task: None, state: None,
    });
    drop(servers);
    persist_registry(state);
    Ok(())
}

pub fn stop_server(state: &EmbeddedStudioState, id: &str) -> Result<(), String> {
    let mut servers = state.servers.lock().unwrap();
    let server = servers.iter_mut().find(|server| server.id == id).ok_or("Local server not found.")?;
    if let Some(task) = server.task.take() { task.abort(); }
    server.state = None;
    server.url.clear();
    Ok(())
}

pub fn delete_server(state: &EmbeddedStudioState, id: &str) -> Result<(), String> {
    let mut servers = state.servers.lock().unwrap();
    let index = servers.iter().position(|server| server.id == id).ok_or("Local server not found.")?;
    if let Some(task) = servers[index].task.take() { task.abort(); }
    let removed = servers.remove(index);
    let path = removed.data_path;
    if removed.legacy_path {
        for suffix in ["", "-wal", "-shm"] {
            let target = PathBuf::from(format!("{}{}", path.display(), suffix));
            if target.exists() { std::fs::remove_file(target).map_err(|e| format!("Could not delete local server data: {e}"))?; }
        }
    } else if let Some(parent) = path.parent() {
        if parent.exists() { std::fs::remove_dir_all(parent).map_err(|e| format!("Could not delete local server data: {e}"))?; }
    }
    drop(servers);
    persist_registry(state);
    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({ "success": true, "service": "rexadb-studio-rust" }))
}

async fn log_api_request(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let response = next.run(request).await;
    log::info!("[rexadb-studio-api] {} {} -> {}", method, path, response.status());
    response
}

async fn api_not_found(request: Request) -> impl IntoResponse {
    let path = request.uri().path();
    app_error(StatusCode::NOT_FOUND, format!("RexaDB Studio API route not found: {path}"))
}

async fn local_status(State(state): State<ApiState>) -> Json<Value> {
    let configured = state.db.lock().unwrap()
        .query_row("SELECT EXISTS(SELECT 1 FROM users)", [], |row| row.get::<_, bool>(0))
        .unwrap_or(false);
    Json(json!({ "success": true, "configured": configured }))
}

async fn setup_admin(State(state): State<ApiState>, Json(input): Json<SetupInput>) -> impl IntoResponse {
    let email = input.admin_email.trim().to_lowercase();
    if !email.contains('@') || input.admin_password.len() < 8 {
        return app_error(StatusCode::BAD_REQUEST, "Enter a valid email and a password of at least 8 characters.").into_response();
    }
    let password_hash = match tokio::task::spawn_blocking(move || hash(input.admin_password, DEFAULT_COST)).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let db = state.db.lock().unwrap();
    let count: i64 = match db.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0)) {
        Ok(count) => count,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if count > 0 {
        return app_error(StatusCode::CONFLICT, "This local workspace already has an admin account.").into_response();
    }
    let now = chrono_like_now();
    if let Err(error) = seed_defaults(&db, &now) {
        return app_error(StatusCode::INTERNAL_SERVER_ERROR, error).into_response();
    }
    let role_id: i64 = match db.query_row("SELECT id FROM roles WHERE name = 'admin'", [], |row| row.get(0)) {
        Ok(id) => id,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let user_id = uuid_like();
    if let Err(error) = db.execute(
        "INSERT INTO users (id, email, name, role_id, is_active, password_hash, created_at) VALUES (?1, ?2, 'Admin', ?3, 1, ?4, ?5)",
        params![user_id, email, role_id, password_hash, now],
    ) {
        return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    (StatusCode::CREATED, Json(json!({ "success": true, "data": { "userId": user_id, "email": email } }))).into_response()
}

async fn login(State(state): State<ApiState>, Json(input): Json<Value>) -> impl IntoResponse {
    let email = input.get("email").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let password = input.get("password").and_then(Value::as_str).unwrap_or("").to_string();
    if email.is_empty() || password.is_empty() {
        return app_error(StatusCode::BAD_REQUEST, "Email and password are required.").into_response();
    }
    let user = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT id, password_hash, is_active, totp_enabled FROM users WHERE lower(email) = ?1",
            [&email],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, bool>(2)?, row.get::<_, bool>(3)?)),
        ).optional()
    };
    let user = match user {
        Ok(Some(user)) => user,
        Ok(None) => return app_error(StatusCode::UNAUTHORIZED, "Invalid email or password").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if !user.2 || !user.1.as_deref().is_some_and(|hash| verify(&password, hash).unwrap_or(false)) {
        return app_error(StatusCode::UNAUTHORIZED, "Invalid email or password").into_response();
    }
    let now = unix_time();
    if user.3 {
        let claims = Claims { sub: user.0, iat: now, exp: now + 5 * 60, purpose: Some("totp".into()) };
        return match encode(&Header::default(), &claims, &EncodingKey::from_secret(&state.jwt_secret)) {
            Ok(temp_token) => (StatusCode::OK, Json(json!({ "data": { "step": "totp", "tempToken": temp_token } }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        };
    }
    let claims = Claims { sub: user.0.clone(), iat: now, exp: now + 60 * 60 * 24 * 30, purpose: None };
    match encode(&Header::default(), &claims, &EncodingKey::from_secret(&state.jwt_secret)) {
        Ok(token) => (StatusCode::OK, Json(json!({ "data": { "studioToken": token } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn login_totp(State(state): State<ApiState>, Json(body): Json<Value>) -> impl IntoResponse {
    let token = body.get("tempToken").and_then(Value::as_str).unwrap_or("");
    let code = body.get("code").and_then(Value::as_str).unwrap_or("");
    let temp = decode::<Claims>(token, &DecodingKey::from_secret(&state.jwt_secret), &Validation::default());
    let user_id = match temp {
        Ok(temp) if temp.claims.purpose.as_deref() == Some("totp") => temp.claims.sub,
        _ => return app_error(StatusCode::UNAUTHORIZED, "Invalid or expired sign-in session.").into_response(),
    };
    let secret = {
        let db = state.db.lock().unwrap();
        db.query_row("SELECT totp_secret FROM users WHERE id = ?1 AND is_active = 1 AND totp_enabled = 1", [&user_id], |row| row.get::<_, Option<String>>(0)).optional()
    };
    let secret = match secret {
        Ok(Some(Some(secret))) => secret,
        Ok(_) => return app_error(StatusCode::UNAUTHORIZED, "Two-factor authentication is not enabled for this account.").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if !verify_totp(&secret, code) { return app_error(StatusCode::UNAUTHORIZED, "Invalid authentication code.").into_response(); }
    let now = unix_time();
    let claims = Claims { sub: user_id, iat: now, exp: now + 60 * 60 * 24 * 30, purpose: None };
    match encode(&Header::default(), &claims, &EncodingKey::from_secret(&state.jwt_secret)) {
        Ok(studio_token) => (StatusCode::OK, Json(json!({ "data": { "studioToken": studio_token } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn set_password(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    let new_password = body.get("newPassword").and_then(Value::as_str).unwrap_or("");
    let current_password = body.get("currentPassword").and_then(Value::as_str).unwrap_or("");
    if !(8..=128).contains(&new_password.len()) {
        return app_error(StatusCode::BAD_REQUEST, "New password must be between 8 and 128 characters.").into_response();
    }
    let existing_hash = {
        let db = state.db.lock().unwrap();
        db.query_row("SELECT password_hash FROM users WHERE id = ?1 AND is_active = 1", [&user_id], |row| row.get::<_, Option<String>>(0)).optional()
    };
    let existing_hash = match existing_hash {
        Ok(Some(hash)) => hash,
        Ok(None) => return app_error(StatusCode::NOT_FOUND, "User not found.").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if let Some(existing_hash) = existing_hash {
        if current_password.is_empty() || !verify(current_password, &existing_hash).unwrap_or(false) {
            return app_error(StatusCode::UNAUTHORIZED, "Current password is incorrect.").into_response();
        }
    }
    let password_hash = match hash(new_password, 10) {
        Ok(hash) => hash,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let db = state.db.lock().unwrap();
    match db.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![password_hash, user_id]) {
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn invite_create(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "invites.create") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    let email = body.get("email").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    if !email.contains('@') { return app_error(StatusCode::BAD_REQUEST, "A valid invite email is required.").into_response(); }
    let supplied_role = body.get("roleId").and_then(Value::as_i64);
    let now = chrono_like_now();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let token = random_hex(32);
    let token_hash = match hash(&token, 10) {
        Ok(value) => value,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let db = state.db.lock().unwrap();
    let role_id = match supplied_role {
        Some(role_id) => role_id,
        None => match db.query_row("SELECT id FROM roles WHERE name = 'viewer'", [], |row| row.get::<_, i64>(0)) {
            Ok(id) => id,
            Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
    };
    let invite_id = db.query_row(
        "INSERT INTO invites (token_hash, email, role_id, status, expires_at, created_by, created_at) VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5, ?6) RETURNING id",
        params![token_hash, email, role_id, expires_at, user_id, now], |row| row.get::<_, i64>(0),
    );
    match invite_id {
        Ok(id) => (StatusCode::CREATED, Json(json!({ "data": { "id": id, "email": email, "token": token, "expiresAt": expires_at } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn invites_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "invites.view") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare(
        "SELECT i.id, i.email, i.status, i.expires_at, i.created_at, i.accepted_at, u.id, u.email, u.name, u.avatar_url, r.id, r.name FROM invites i JOIN users u ON u.id = i.created_by JOIN roles r ON r.id = u.role_id ORDER BY i.created_at DESC",
    ) {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "email": row.get::<_, String>(1)?, "status": row.get::<_, String>(2)?,
        "expiresAt": row.get::<_, String>(3)?, "createdAt": row.get::<_, String>(4)?, "acceptedAt": row.get::<_, Option<String>>(5)?,
        "createdBy": { "id": row.get::<_, String>(6)?, "email": row.get::<_, String>(7)?, "name": row.get::<_, String>(8)?, "avatarUrl": row.get::<_, Option<String>>(9)?, "role": { "id": row.get::<_, i64>(10)?, "name": row.get::<_, String>(11)? } },
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn invite_accept(State(state): State<ApiState>, Json(body): Json<Value>) -> impl IntoResponse {
    let token = body.get("token").and_then(Value::as_str).unwrap_or("").to_string();
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let email = body.get("email").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    if token.is_empty() || name.is_empty() || !email.contains('@') {
        return app_error(StatusCode::BAD_REQUEST, "Invitation token, name, and valid email are required.").into_response();
    }
    let db = state.db.lock().unwrap();
    let invites = db.prepare("SELECT id, token_hash, role_id, expires_at FROM invites WHERE lower(email) = ?1 AND status = 'PENDING'")
        .and_then(|mut statement| statement.query_map([&email], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>()));
    let invites = match invites {
        Ok(invites) => invites,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let now = chrono_like_now();
    let matched = invites.into_iter().find(|invite| invite.3 >= now && verify(&token, &invite.1).unwrap_or(false));
    let (invite_id, _, role_id, _) = match matched {
        Some(invite) => invite,
        None => return app_error(StatusCode::BAD_REQUEST, "Invalid or expired invitation").into_response(),
    };
    let existing_user = db.query_row("SELECT id FROM users WHERE lower(email) = ?1", [&email], |row| row.get::<_, String>(0)).optional();
    let user_id = match existing_user {
        Ok(Some(user_id)) => {
            if let Err(error) = db.execute("UPDATE users SET name = ?1 WHERE id = ?2", params![name, user_id]) {
                return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
            }
            user_id
        }
        Ok(None) => {
            let user_id = uuid_like();
            if let Err(error) = db.execute("INSERT INTO users (id, email, name, role_id, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)", params![user_id, email, name, role_id, now]) {
                return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
            }
            user_id
        }
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if let Err(error) = db.execute("UPDATE invites SET status = 'ACCEPTED', accepted_at = ?1 WHERE id = ?2", params![now, invite_id]) {
        return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    drop(db);
    let timestamp = unix_time();
    let token = encode(&Header::default(), &Claims { sub: user_id.clone(), iat: timestamp, exp: timestamp + 60 * 60 * 24 * 30, purpose: None }, &EncodingKey::from_secret(&state.jwt_secret));
    match token {
        Ok(token) => (StatusCode::OK, Json(json!({ "data": { "userId": user_id, "studioToken": token } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn invite_revoke(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "invites.revoke") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    match db.execute("UPDATE invites SET status = 'REVOKED' WHERE id = ?1 AND status = 'PENDING'", [id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Pending invitation not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

fn token_user_id(headers: &HeaderMap, state: &ApiState) -> Result<String, StatusCode> {
    let token = headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer ")).ok_or(StatusCode::UNAUTHORIZED)?;
    decode::<Claims>(token, &DecodingKey::from_secret(&state.jwt_secret), &Validation::default())
        .and_then(|claims| if claims.claims.purpose.is_none() { Ok(claims) } else { Err(jsonwebtoken::errors::ErrorKind::InvalidToken.into()) })
        .map(|claims| claims.claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)
}

fn require_permission(headers: &HeaderMap, state: &ApiState, permission: &str) -> Result<String, (StatusCode, String)> {
    let user_id = token_user_id(headers, state).map_err(|status| (status, "Invalid or expired workspace token.".to_string()))?;
    let db = state.db.lock().unwrap();
    let has: bool = db.query_row(
        "SELECT EXISTS (
          SELECT 1 FROM users u
          JOIN role_permissions rp ON rp.role_id = u.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE u.id = ?1 AND u.is_active = 1 AND p.code = ?2
        )",
        params![user_id, permission],
        |row| row.get(0),
    ).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if !has { return Err((StatusCode::FORBIDDEN, format!("Missing required permission: {permission}"))); }
    Ok(user_id)
}

async fn permissions_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "permissions.view") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT id, code, name, description FROM permissions ORDER BY id") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "code": row.get::<_, String>(1)?,
        "name": row.get::<_, String>(2)?, "description": row.get::<_, String>(3)?,
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn roles_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "permissions.view") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let result = (|| -> rusqlite::Result<Vec<Value>> {
        let mut roles_statement = db.prepare("SELECT id, name, description, is_system, created_at, (SELECT COUNT(*) FROM users WHERE users.role_id = roles.id) FROM roles ORDER BY name")?;
        let roles = roles_statement.query_map([], |row| Ok((
            row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, bool>(3)?, row.get::<_, String>(4)?, row.get::<_, i64>(5)?,
        )))?;
        let mut data = Vec::new();
        for role in roles {
            let (id, name, description, is_system, created_at, user_count) = role?;
            let mut permissions_statement = db.prepare(
                "SELECT p.id, p.code, p.name, p.description FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?1 ORDER BY p.id",
            )?;
            let permissions = permissions_statement.query_map([id], |row| Ok(json!({
                "id": row.get::<_, i64>(0)?, "code": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?, "description": row.get::<_, String>(3)?,
            })))?.collect::<Result<Vec<_>, _>>()?;
            data.push(json!({ "id": id, "name": name, "description": description, "isSystem": is_system, "createdAt": created_at, "userCount": user_count, "permissions": permissions }));
        }
        Ok(data)
    })();
    match result {
        Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn role_create(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "roles.manage") {
        return app_error(status, error).into_response();
    }
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim();
    let description = body.get("description").and_then(Value::as_str).unwrap_or("");
    let permissions = body.get("permissionIds").and_then(Value::as_array).cloned().unwrap_or_default();
    if name.is_empty() || name.len() > 100 || description.len() > 500 || permissions.is_empty() {
        return app_error(StatusCode::BAD_REQUEST, "Role name and at least one permission are required.").into_response();
    }
    let db = state.db.lock().unwrap();
    let now = chrono_like_now();
    let role_id = db.query_row("INSERT INTO roles (name, description, is_system, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id", params![name, description, now], |row| row.get::<_, i64>(0));
    let role_id = match role_id {
        Ok(id) => id,
        Err(error) if error.to_string().contains("UNIQUE") => return app_error(StatusCode::CONFLICT, "Role already exists").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    for permission_id in permissions.iter().filter_map(Value::as_i64) {
        if let Err(error) = db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?1, ?2)", params![role_id, permission_id]) {
            return app_error(StatusCode::BAD_REQUEST, error.to_string()).into_response();
        }
    }
    (StatusCode::CREATED, Json(json!({ "data": { "id": role_id, "name": name, "description": description, "isSystem": false, "createdAt": now } }))).into_response()
}

async fn role_get(State(state): State<ApiState>, headers: HeaderMap, AxumPath(role_id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "permissions.view") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let role = db.query_row("SELECT id, name, description, is_system, created_at FROM roles WHERE id = ?1", [role_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, bool>(3)?, row.get::<_, String>(4)?)));
    let (id, name, description, is_system, created_at) = match role {
        Ok(role) => role,
        Err(rusqlite::Error::QueryReturnedNoRows) => return app_error(StatusCode::NOT_FOUND, "Role not found").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let mut statement = match db.prepare("SELECT p.id, p.code, p.name, p.description FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?1") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let permissions = statement.query_map([id], |row| Ok(json!({ "id": row.get::<_, i64>(0)?, "code": row.get::<_, String>(1)?, "name": row.get::<_, String>(2)?, "description": row.get::<_, String>(3)? })))
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>());
    match permissions {
        Ok(permissions) => (StatusCode::OK, Json(json!({ "data": { "id": id, "name": name, "description": description, "isSystem": is_system, "createdAt": created_at, "permissions": permissions } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn role_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath(role_id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "roles.manage") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let exists = db.query_row("SELECT EXISTS(SELECT 1 FROM roles WHERE id = ?1)", [role_id], |row| row.get::<_, bool>(0)).unwrap_or(false);
    if !exists { return app_error(StatusCode::NOT_FOUND, "Role not found").into_response(); }
    let name = body.get("name").and_then(Value::as_str);
    let description = body.get("description").and_then(Value::as_str);
    let now_name = match name {
        Some(name) if !name.trim().is_empty() && name.len() <= 100 => Some(name.trim()),
        Some(_) => return app_error(StatusCode::BAD_REQUEST, "Role name is invalid.").into_response(),
        None => None,
    };
    if now_name.is_some() || description.is_some() {
        let result = db.execute("UPDATE roles SET name = COALESCE(?1, name), description = COALESCE(?2, description) WHERE id = ?3", params![now_name, description, role_id]);
        if let Err(error) = result {
            if error.to_string().contains("UNIQUE") { return app_error(StatusCode::CONFLICT, "Role name already taken").into_response(); }
            return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
    }
    if let Some(permissions) = body.get("permissionIds").and_then(Value::as_array) {
        if permissions.is_empty() { return app_error(StatusCode::BAD_REQUEST, "Select at least one permission.").into_response(); }
        let _ = db.execute("DELETE FROM role_permissions WHERE role_id = ?1", [role_id]);
        for permission_id in permissions.iter().filter_map(Value::as_i64) {
            if let Err(error) = db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?1, ?2)", params![role_id, permission_id]) {
                return app_error(StatusCode::BAD_REQUEST, error.to_string()).into_response();
            }
        }
    }
    (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response()
}

async fn role_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath(role_id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "roles.manage") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let system_role = db.query_row("SELECT is_system FROM roles WHERE id = ?1", [role_id], |row| row.get::<_, bool>(0)).optional();
    match system_role {
        Ok(None) => app_error(StatusCode::NOT_FOUND, "Role not found").into_response(),
        Ok(Some(true)) => app_error(StatusCode::FORBIDDEN, "Cannot delete a system role").into_response(),
        Ok(Some(false)) => match db.execute("DELETE FROM roles WHERE id = ?1", [role_id]) {
            Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
            Err(error) => app_error(StatusCode::CONFLICT, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn users_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "users.read") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare(
        "SELECT u.id, u.email, u.name, u.role_id, u.is_active, u.created_at, u.avatar_url, r.name FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC",
    ) {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, String>(0)?, "email": row.get::<_, String>(1)?, "name": row.get::<_, String>(2)?,
        "roleId": row.get::<_, i64>(3)?, "isActive": row.get::<_, bool>(4)?, "createdAt": row.get::<_, String>(5)?,
        "avatarUrl": row.get::<_, Option<String>>(6)?, "role": { "name": row.get::<_, String>(7)? },
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn user_assign_role(State(state): State<ApiState>, headers: HeaderMap, AxumPath(user_id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "roles.assign") {
        return app_error(status, error).into_response();
    }
    let role_id = body.get("roleId").and_then(Value::as_i64).unwrap_or_default();
    let db = state.db.lock().unwrap();
    let role_exists = db.query_row("SELECT EXISTS(SELECT 1 FROM roles WHERE id = ?1)", [role_id], |row| row.get::<_, bool>(0)).unwrap_or(false);
    if !role_exists { return app_error(StatusCode::NOT_FOUND, "Role not found").into_response(); }
    match db.execute("UPDATE users SET role_id = ?1 WHERE id = ?2", params![role_id, user_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "User not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn user_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath(user_id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "users.manage") {
        return app_error(status, error).into_response();
    }
    let name = body.get("name").and_then(Value::as_str);
    let email = body.get("email").and_then(Value::as_str).map(str::to_lowercase);
    let is_active = body.get("isActive").and_then(Value::as_bool);
    if name.is_some_and(|name| name.trim().is_empty() || name.len() > 200) || email.as_deref().is_some_and(|email| !email.contains('@')) {
        return app_error(StatusCode::BAD_REQUEST, "User name or email is invalid.").into_response();
    }
    let db = state.db.lock().unwrap();
    match db.execute("UPDATE users SET name = COALESCE(?1, name), email = COALESCE(?2, email), is_active = COALESCE(?3, is_active) WHERE id = ?4", params![name, email, is_active, user_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "User not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) if error.to_string().contains("UNIQUE") => app_error(StatusCode::CONFLICT, "Email is already in use").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn user_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath(user_id): AxumPath<String>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "users.manage") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    if let Err(error) = db.execute("DELETE FROM invites WHERE created_by = ?1", [&user_id]) {
        return app_error(StatusCode::CONFLICT, error.to_string()).into_response();
    }
    match db.execute("DELETE FROM users WHERE id = ?1", [&user_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "User not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::CONFLICT, error.to_string()).into_response(),
    }
}

const AVATAR_MAX_BYTES: usize = 5 * 1024 * 1024;

fn avatar_extension(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

async fn user_avatar_upload(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(target_id): AxumPath<String>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let caller = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    if body.is_empty() {
        return app_error(StatusCode::BAD_REQUEST, "Image data is required.").into_response();
    }
    if body.len() > AVATAR_MAX_BYTES {
        return app_error(StatusCode::PAYLOAD_TOO_LARGE, "Image must be under 5MB.").into_response();
    }
    let mime = headers.get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok())
        .unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let Some(extension) = avatar_extension(&mime) else {
        return app_error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Only JPEG, PNG, GIF, WebP, and AVIF images are allowed.").into_response();
    };
    {
        let db = state.db.lock().unwrap();
        if !is_user_active(&db, &caller) {
            return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
        }
        let target_exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)",
            [&target_id],
            |row| row.get(0),
        ).unwrap_or(false);
        if !target_exists {
            return app_error(StatusCode::NOT_FOUND, "User not found.").into_response();
        }
    }
    if caller != target_id {
        if let Err((status, error)) = require_permission(&headers, &state, "users.manage") {
            return app_error(status, error).into_response();
        }
    }
    let filename = format!("avatar_{target_id}_{}.{}", random_hex(8), extension);
    let now = chrono_like_now();
    let previous = {
        let db = state.db.lock().unwrap();
        let previous: Option<String> = db.query_row(
            "SELECT avatar_url FROM users WHERE id = ?1",
            [&target_id],
            |row| row.get(0),
        ).unwrap_or(None);
        if let Err(error) = db.execute(
            "INSERT INTO avatars (filename, user_id, mime, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![filename, target_id, mime, body.as_ref(), now],
        ) {
            return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
        if let Err(error) = db.execute("UPDATE users SET avatar_url = ?1 WHERE id = ?2", params![filename, target_id]) {
            return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
        previous
    };
    if let Some(old_filename) = previous.filter(|name| *name != filename) {
        let db = state.db.lock().unwrap();
        let _ = db.execute("DELETE FROM avatars WHERE filename = ?1", [&old_filename]);
    }
    (StatusCode::OK, Json(json!({ "data": { "avatarUrl": filename } }))).into_response()
}

async fn user_avatar_delete(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(target_id): AxumPath<String>,
) -> impl IntoResponse {
    let caller = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    {
        let db = state.db.lock().unwrap();
        if !is_user_active(&db, &caller) {
            return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
        }
        let target_exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)",
            [&target_id],
            |row| row.get(0),
        ).unwrap_or(false);
        if !target_exists {
            return app_error(StatusCode::NOT_FOUND, "User not found.").into_response();
        }
    }
    if caller != target_id {
        if let Err((status, error)) = require_permission(&headers, &state, "users.manage") {
            return app_error(status, error).into_response();
        }
    }
    let db = state.db.lock().unwrap();
    let current: Option<String> = db.query_row(
        "SELECT avatar_url FROM users WHERE id = ?1",
        [&target_id],
        |row| row.get(0),
    ).unwrap_or(None);
    let Some(current) = current.filter(|name| !name.is_empty()) else {
        return app_error(StatusCode::NOT_FOUND, "Avatar not found.").into_response();
    };
    if let Err(error) = db.execute("UPDATE users SET avatar_url = NULL WHERE id = ?1", [&target_id]) {
        return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    let _ = db.execute("DELETE FROM avatars WHERE filename = ?1", [&current]);
    (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response()
}

async fn avatar_get(State(state): State<ApiState>, AxumPath(name): AxumPath<String>) -> impl IntoResponse {
    // Served to plain `<img>` tags without an auth header, so this stays
    // public; filenames are unguessable (`avatar_<uuid>_<rand>.<ext>`).
    let valid = !name.is_empty() && name.len() <= 128 && !name.contains("..")
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-');
    if !valid {
        return app_error(StatusCode::NOT_FOUND, "Avatar not found.").into_response();
    }
    let db = state.db.lock().unwrap();
    let row: Option<(String, Vec<u8>)> = db.query_row(
        "SELECT mime, content FROM avatars WHERE filename = ?1",
        [&name],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().unwrap_or(None);
    match row {
        Some((mime, content)) => {
            let mut response_headers = HeaderMap::new();
            response_headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
            );
            response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
            (StatusCode::OK, response_headers, content).into_response()
        }
        None => app_error(StatusCode::NOT_FOUND, "Avatar not found.").into_response(),
    }
}

async fn connections_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "connections.read") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    let db = state.db.lock().unwrap();
    let can_see_all = db.query_row(
        "SELECT EXISTS (SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ?1 AND u.is_active = 1 AND p.code = 'connections.manage_access')",
        [&user_id], |row| row.get::<_, bool>(0),
    ).unwrap_or(false);
    let query = if can_see_all {
        "SELECT id, name, type, created_by, created_at, updated_at FROM connections ORDER BY created_at DESC"
    } else {
        "SELECT c.id, c.name, c.type, c.created_by, c.created_at, c.updated_at FROM connections c WHERE EXISTS (SELECT 1 FROM connection_access a JOIN users u ON u.role_id = a.role_id WHERE a.connection_id = c.id AND u.id = ?1) OR EXISTS (SELECT 1 FROM connection_access a JOIN team_members tm ON tm.team_id = a.team_id WHERE a.connection_id = c.id AND tm.user_id = ?1) OR EXISTS (SELECT 1 FROM connection_access a WHERE a.connection_id = c.id AND a.user_id = ?1) ORDER BY c.created_at DESC"
    };
    let mut statement = match db.prepare(query) {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = if can_see_all { statement.query_map([], connection_json) } else { statement.query_map([user_id], connection_json) };
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

fn connection_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?, "type": row.get::<_, String>(2)?,
        "createdBy": row.get::<_, String>(3)?, "createdAt": row.get::<_, String>(4)?, "updatedAt": row.get::<_, String>(5)?,
    }))
}

async fn saved_queries_list(State(state): State<ApiState>, headers: HeaderMap, AxumPath(connection_id): AxumPath<String>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "queries.saved") { Ok(id) => id, Err((status, error)) => return app_error(status, error).into_response() };
    if !user_can_access_connection(&state, &user_id, &connection_id) { return app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(); }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT id, connection_id, name, query_text, created_by, created_at FROM saved_queries WHERE connection_id = ?1 ORDER BY name") { Ok(statement) => statement, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() };
    let rows = statement.query_map([connection_id], |row| Ok(json!({ "id": row.get::<_, i64>(0)?, "connectionId": row.get::<_, String>(1)?, "name": row.get::<_, String>(2)?, "queryText": row.get::<_, String>(3)?, "createdBy": row.get::<_, String>(4)?, "createdAt": row.get::<_, String>(5)? })));
    match rows { Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() { Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }, Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
}

async fn saved_query_create(State(state): State<ApiState>, headers: HeaderMap, AxumPath(connection_id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "queries.saved") { Ok(id) => id, Err((status, error)) => return app_error(status, error).into_response() };
    if !user_can_access_connection(&state, &user_id, &connection_id) { return app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(); }
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim();
    let query_text = body.get("queryText").and_then(Value::as_str).unwrap_or("").trim();
    if name.is_empty() || query_text.is_empty() { return app_error(StatusCode::BAD_REQUEST, "Name and query text are required.").into_response(); }
    let db = state.db.lock().unwrap();
    match db.query_row("INSERT INTO saved_queries (connection_id, name, query_text, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id", params![connection_id, name, query_text, user_id, chrono_like_now()], |row| row.get::<_, i64>(0)) {
        Ok(id) => (StatusCode::CREATED, Json(json!({ "data": { "id": id, "connectionId": connection_id, "name": name, "queryText": query_text, "createdBy": user_id } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn saved_query_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath((connection_id, query_id)): AxumPath<(String, i64)>, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "queries.saved") { Ok(id) => id, Err((status, error)) => return app_error(status, error).into_response() };
    if !user_can_access_connection(&state, &user_id, &connection_id) { return app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(); }
    let name = body.get("name").and_then(Value::as_str);
    let query_text = body.get("queryText").and_then(Value::as_str);
    let db = state.db.lock().unwrap();
    match db.execute("UPDATE saved_queries SET name = COALESCE(?1, name), query_text = COALESCE(?2, query_text) WHERE id = ?3 AND connection_id = ?4", params![name, query_text, query_id, connection_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Saved query not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn saved_query_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath((connection_id, query_id)): AxumPath<(String, i64)>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "queries.saved") { Ok(id) => id, Err((status, error)) => return app_error(status, error).into_response() };
    if !user_can_access_connection(&state, &user_id, &connection_id) { return app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(); }
    let db = state.db.lock().unwrap();
    match db.execute("DELETE FROM saved_queries WHERE id = ?1 AND connection_id = ?2", params![query_id, connection_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Saved query not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

fn kv_entry_json(db: &Connection, id: &str) -> rusqlite::Result<Value> {
    let entry = db.query_row("SELECT id, key, value, owner_id, created_at, updated_at FROM kv_store WHERE id = ?1", [id], |row| {
        Ok(json!({ "id": row.get::<_, String>(0)?, "key": row.get::<_, String>(1)?, "value": row.get::<_, String>(2)?, "ownerId": row.get::<_, String>(3)?, "createdAt": row.get::<_, String>(4)?, "updatedAt": row.get::<_, String>(5)? }))
    })?;
    let mut statement = db.prepare("SELECT action, grantee_type, grantee_id FROM kv_store_permissions WHERE kv_id = ?1 ORDER BY id")?;
    let permissions = statement.query_map([id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)))?;
    let mut grouped = json!({ "read": [], "write_value": [], "manage_permissions": [], "delete": [] });
    for permission in permissions {
        let (action, grantee_type, grantee_id) = permission?;
        let grant = if let Some(id) = grantee_id { json!({ "type": grantee_type, "id": id }) } else { json!({ "type": grantee_type }) };
        if let Some(items) = grouped.get_mut(&action).and_then(Value::as_array_mut) { items.push(grant); }
    }
    let mut entry = entry;
    if let Some(object) = entry.as_object_mut() { object.insert("permissions".into(), grouped); }
    Ok(entry)
}

fn kv_has_global_manage(db: &Connection, user_id: &str) -> bool {
    db.query_row("SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ?1 AND u.is_active = 1 AND p.code = 'kv_store.manage')", [user_id], |row| row.get::<_, bool>(0)).unwrap_or(false)
}

fn is_user_active(db: &Connection, user_id: &str) -> bool {
    db.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1 AND is_active = 1)", [user_id], |row| row.get::<_, bool>(0)).unwrap_or(false)
}

fn kv_can_access(db: &Connection, id: &str, user_id: Option<&str>, action: &str) -> rusqlite::Result<bool> {
    let owner = db.query_row("SELECT owner_id FROM kv_store WHERE id = ?1", [id], |row| row.get::<_, String>(0)).optional()?;
    let Some(owner) = owner else { return Ok(false); };
    // A deactivated account's token must stop working: treat inactive callers
    // as anonymous so owner checks and explicit grants no longer apply.
    let user_id = user_id.filter(|candidate| is_user_active(db, candidate));
    let Some(user_id) = user_id else {
        if action != "read" { return Ok(false); }
        return db.query_row("SELECT EXISTS(SELECT 1 FROM kv_store_permissions WHERE kv_id = ?1 AND action = 'read' AND grantee_type = 'public')", [id], |row| row.get(0));
    };
    if owner == user_id || kv_has_global_manage(db, user_id) { return Ok(true); }
    let role_id = db.query_row("SELECT role_id FROM users WHERE id = ?1 AND is_active = 1", [user_id], |row| row.get::<_, i64>(0)).optional()?;
    let Some(role_id) = role_id else { return Ok(false); };
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM kv_store_permissions p WHERE p.kv_id = ?1 AND p.action = ?2 AND (p.grantee_type = 'studio' OR (p.grantee_type = 'user' AND p.grantee_id = ?3) OR (p.grantee_type = 'role' AND p.grantee_id = CAST(?4 AS TEXT)) OR (p.grantee_type = 'team' AND p.grantee_id IN (SELECT CAST(team_id AS TEXT) FROM team_members WHERE user_id = ?3))))",
        params![id, action, user_id, role_id], |row| row.get(0),
    )
}

fn normalize_kv_permissions(value: Option<&Value>) -> Result<Vec<(String, String, Option<String>)>, String> {
    let Some(value) = value else { return Ok(Vec::new()); };
    let list = value.as_array().ok_or("Permissions must be an array.")?;
    let mut result = Vec::new();
    for permission in list {
        let action = permission.get("action").and_then(Value::as_str).unwrap_or("");
        let grantee_type = permission.get("type").and_then(Value::as_str).unwrap_or("");
        let grantee_id = permission.get("id").and_then(|id| id.as_str().map(str::to_string).or_else(|| id.as_i64().map(|n| n.to_string())));
        if !["read", "write_value", "manage_permissions", "delete"].contains(&action)
            || !["user", "role", "team", "studio", "public"].contains(&grantee_type)
            || (["user", "role", "team"].contains(&grantee_type) && grantee_id.is_none())
        { return Err("Invalid key-value permission grant.".to_string()); }
        result.push((action.to_string(), grantee_type.to_string(), grantee_id));
    }
    Ok(result)
}

fn kv_error(error: rusqlite::Error) -> axum::response::Response {
    if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
        app_error(StatusCode::NOT_FOUND, "Key-value entry not found.").into_response()
    } else {
        app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
    }
}

async fn kv_list(State(state): State<ApiState>, headers: HeaderMap, uri: axum::http::Uri) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) { Ok(id) => id, Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response() };
    let scope = uri.query().and_then(|query| url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == "scope").map(|(_, value)| value.into_owned())).unwrap_or_else(|| "all".into());
    let db = state.db.lock().unwrap();
    let all_ids = {
        let mut statement = match db.prepare("SELECT id, owner_id FROM kv_store ORDER BY updated_at DESC") { Ok(statement) => statement, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() };
        let collected = match statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
            Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() { Ok(rows) => rows, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() },
            Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        };
        collected
    };
    let mut data = Vec::new();
    for (id, owner_id) in all_ids {
        let owned = owner_id == user_id;
        if (scope == "owned" && !owned) || (scope == "shared" && owned) { continue; }
        let accessible = kv_has_global_manage(&db, &user_id) || kv_can_access(&db, &id, Some(&user_id), "read").unwrap_or(false);
        if !accessible { continue; }
        match kv_entry_json(&db, &id) { Ok(entry) => data.push(entry), Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
    }
    (StatusCode::OK, Json(json!({ "data": data }))).into_response()
}

async fn kv_create(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "kv_store.create") { Ok(id) => id, Err((status, error)) => return app_error(status, error).into_response() };
    let key = body.get("key").and_then(Value::as_str).unwrap_or("").trim();
    let value = body.get("value").and_then(Value::as_str).unwrap_or("");
    if key.is_empty() || key.len() > 500 || body.get("value").and_then(Value::as_str).is_none() { return app_error(StatusCode::BAD_REQUEST, "Key and string value are required; key must be at most 500 characters.").into_response(); }
    let permissions = match normalize_kv_permissions(body.get("permissions")) { Ok(value) => value, Err(error) => return app_error(StatusCode::BAD_REQUEST, error).into_response() };
    let id = uuid_like();
    let now = chrono_like_now();
    let mut db = state.db.lock().unwrap();
    let exists = db.query_row("SELECT EXISTS(SELECT 1 FROM kv_store WHERE owner_id = ?1 AND key = ?2)", params![user_id, key], |row| row.get::<_, bool>(0)).unwrap_or(false);
    if exists { return app_error(StatusCode::CONFLICT, format!("You already have an entry with key \"{key}\".")).into_response(); }
    let tx = match db.transaction() { Ok(tx) => tx, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() };
    if let Err(error) = tx.execute("INSERT INTO kv_store (id, key, value, owner_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)", params![id, key, value, user_id, now]) { return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(); }
    for (action, grantee_type, grantee_id) in permissions {
        if let Err(error) = tx.execute("INSERT INTO kv_store_permissions (kv_id, action, grantee_type, grantee_id, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![id, action, grantee_type, grantee_id, user_id, now]) { return app_error(StatusCode::BAD_REQUEST, error.to_string()).into_response(); }
    }
    if let Err(error) = tx.commit() { return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(); }
    match kv_entry_json(&db, &id) { Ok(entry) => (StatusCode::CREATED, Json(json!({ "data": entry }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
}

async fn kv_get(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    let user_id = token_user_id(&headers, &state).ok();
    let db = state.db.lock().unwrap();
    match kv_can_access(&db, &id, user_id.as_deref(), "read") {
        Ok(true) => match kv_entry_json(&db, &id) { Ok(entry) => (StatusCode::OK, Json(json!({ "data": entry }))).into_response(), Err(error) => kv_error(error) },
        Ok(false) => app_error(StatusCode::FORBIDDEN, "You do not have permission to read this entry.").into_response(),
        Err(error) => kv_error(error),
    }
}

async fn kv_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) { Ok(id) => id, Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response() };
    // Owner equality below would otherwise let a deactivated owner keep
    // managing an entry's sharing permissions.
    {
        let db = state.db.lock().unwrap();
        if !is_user_active(&db, &user_id) {
            return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
        }
    }
    let has_value = body.get("key").is_some() || body.get("value").is_some();
    let has_permissions = body.get("permissions").is_some();
    if !has_value && !has_permissions { return app_error(StatusCode::BAD_REQUEST, "No fields to update.").into_response(); }
    let key = body.get("key").and_then(Value::as_str);
    let value = body.get("value").and_then(Value::as_str);
    if body.get("key").is_some() && key.is_none() || key.is_some_and(|key| key.trim().is_empty() || key.len() > 500) || body.get("value").is_some() && value.is_none() {
        return app_error(StatusCode::BAD_REQUEST, "Key must be 1 to 500 characters and value must be a string.").into_response();
    }
    let permissions = match normalize_kv_permissions(body.get("permissions")) { Ok(value) => value, Err(error) => return app_error(StatusCode::BAD_REQUEST, error).into_response() };
    let db = state.db.lock().unwrap();
    let owner = db.query_row("SELECT owner_id FROM kv_store WHERE id = ?1", [&id], |row| row.get::<_, String>(0));
    let owner = match owner { Ok(owner) => owner, Err(error) => return kv_error(error) };
    if has_value && !kv_can_access(&db, &id, Some(&user_id), "write_value").unwrap_or(false) { return app_error(StatusCode::FORBIDDEN, "You do not have permission to write this entry.").into_response(); }
    if has_permissions && owner != user_id && !kv_can_access(&db, &id, Some(&user_id), "manage_permissions").unwrap_or(false) { return app_error(StatusCode::FORBIDDEN, "You do not have permission to manage this entry's permissions.").into_response(); }
    let now = chrono_like_now();
    if has_value {
        if let Err(error) = db.execute("UPDATE kv_store SET key = COALESCE(?1, key), value = COALESCE(?2, value), updated_at = ?3 WHERE id = ?4", params![key, value, now, id]) { return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(); }
    }
    if has_permissions {
        if let Err(error) = db.execute("DELETE FROM kv_store_permissions WHERE kv_id = ?1", [&id]) { return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(); }
        for (action, grantee_type, grantee_id) in permissions {
            if let Err(error) = db.execute("INSERT INTO kv_store_permissions (kv_id, action, grantee_type, grantee_id, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![id, action, grantee_type, grantee_id, user_id, now]) { return app_error(StatusCode::BAD_REQUEST, error.to_string()).into_response(); }
        }
    }
    match kv_entry_json(&db, &id) { Ok(entry) => (StatusCode::OK, Json(json!({ "data": entry }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
}

async fn kv_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) { Ok(id) => id, Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response() };
    // Owner equality inside `kv_can_access` would otherwise let a deactivated
    // owner keep deleting entries.
    {
        let db = state.db.lock().unwrap();
        if !is_user_active(&db, &user_id) {
            return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
        }
    }
    let db = state.db.lock().unwrap();
    match kv_can_access(&db, &id, Some(&user_id), "delete") {
        Ok(false) => app_error(StatusCode::FORBIDDEN, "You do not have permission to delete this entry.").into_response(),
        Err(error) => kv_error(error),
        Ok(true) => match db.execute("DELETE FROM kv_store WHERE id = ?1", [&id]) { Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() },
    }
}

async fn query_logs_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "query_logs.view") { return app_error(status, error).into_response(); }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT q.id, q.connection_id, c.name, q.user_id, u.name, q.query, q.duration, q.executed_at FROM query_logs q JOIN connections c ON c.id = q.connection_id JOIN users u ON u.id = q.user_id ORDER BY q.id DESC LIMIT 500") { Ok(statement) => statement, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() };
    let rows = statement.query_map([], |row| Ok(json!({ "id": row.get::<_, i64>(0)?, "connectionId": row.get::<_, String>(1)?, "connectionName": row.get::<_, String>(2)?, "userId": row.get::<_, String>(3)?, "userName": row.get::<_, String>(4)?, "query": row.get::<_, String>(5)?, "duration": row.get::<_, i64>(6)?, "executedAt": row.get::<_, String>(7)? })));
    match rows { Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() { Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }, Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
}

async fn audit_logs_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "audit_logs.view") { return app_error(status, error).into_response(); }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT id, ts, method, url, status, req_headers, res_body, duration, user_id FROM audit_logs ORDER BY ts DESC LIMIT 1000") { Ok(statement) => statement, Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() };
    let rows = statement.query_map([], |row| Ok(json!({ "id": row.get::<_, i64>(0)?, "ts": row.get::<_, i64>(1)?, "method": row.get::<_, String>(2)?, "url": row.get::<_, String>(3)?, "status": row.get::<_, i64>(4)?, "reqHeaders": row.get::<_, Option<String>>(5)?, "resBody": row.get::<_, Option<String>>(6)?, "duration": row.get::<_, Option<i64>>(7)?, "userId": row.get::<_, Option<String>>(8)? })));
    match rows { Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() { Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(), Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }, Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response() }
}

async fn teams_list(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.read") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT t.id, t.name, t.description, t.created_by, t.created_at, t.updated_at, (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) FROM teams t ORDER BY t.name") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "name": row.get::<_, String>(1)?, "description": row.get::<_, String>(2)?,
        "createdBy": row.get::<_, String>(3)?, "createdAt": row.get::<_, String>(4)?, "updatedAt": row.get::<_, String>(5)?, "memberCount": row.get::<_, i64>(6)?,
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_create(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "teams.create") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim();
    let description = body.get("description").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() || name.len() > 200 || description.len() > 500 {
        return app_error(StatusCode::BAD_REQUEST, "Team name and description are invalid.").into_response();
    }
    let now = chrono_like_now();
    let db = state.db.lock().unwrap();
    let inserted = db.query_row(
        "INSERT INTO teams (name, description, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id",
        params![name, description, user_id, now], |row| row.get::<_, i64>(0),
    );
    match inserted {
        Ok(team_id) => {
            if let Err(error) = db.execute("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?1, ?2, 'admin', ?3)", params![team_id, user_id, now]) {
                return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
            }
            (StatusCode::CREATED, Json(json!({ "data": { "id": team_id, "name": name, "description": description, "createdBy": user_id, "createdAt": now, "updatedAt": now } }))).into_response()
        }
        Err(error) if error.to_string().contains("UNIQUE") => app_error(StatusCode::CONFLICT, "Team already exists").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_get(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.read") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    match db.query_row("SELECT id, name, description, created_by, created_at, updated_at FROM teams WHERE id = ?1", [id], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "name": row.get::<_, String>(1)?, "description": row.get::<_, String>(2)?,
        "createdBy": row.get::<_, String>(3)?, "createdAt": row.get::<_, String>(4)?, "updatedAt": row.get::<_, String>(5)?,
    }))) {
        Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
        Err(rusqlite::Error::QueryReturnedNoRows) => app_error(StatusCode::NOT_FOUND, "Team not found").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.update") {
        return app_error(status, error).into_response();
    }
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim();
    let description = body.get("description").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() || name.len() > 200 || description.len() > 500 { return app_error(StatusCode::BAD_REQUEST, "Team name and description are invalid.").into_response(); }
    let db = state.db.lock().unwrap();
    match db.execute("UPDATE teams SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4", params![name, description, chrono_like_now(), id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Team not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::CONFLICT, error.to_string()).into_response(),
    }
}

async fn team_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.delete") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    match db.execute("DELETE FROM teams WHERE id = ?1", [id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Team not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_members_list(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.read") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT tm.team_id, tm.user_id, tm.role, tm.joined_at, u.email, u.name, u.avatar_url, r.id, r.name FROM team_members tm JOIN users u ON u.id = tm.user_id JOIN roles r ON r.id = u.role_id WHERE tm.team_id = ?1 ORDER BY u.name") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([team_id], |row| Ok(json!({
        "teamId": row.get::<_, i64>(0)?, "userId": row.get::<_, String>(1)?, "role": row.get::<_, String>(2)?, "joinedAt": row.get::<_, String>(3)?,
        "user": { "id": row.get::<_, String>(1)?, "email": row.get::<_, String>(4)?, "name": row.get::<_, String>(5)?, "avatarUrl": row.get::<_, Option<String>>(6)?, "role": { "id": row.get::<_, i64>(7)?, "name": row.get::<_, String>(8)? } },
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_member_add(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    let caller = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    let user_id = body.get("userId").and_then(Value::as_str).unwrap_or("");
    let role = body.get("role").and_then(Value::as_str).filter(|role| *role == "admin").unwrap_or("member");
    let now = chrono_like_now();
    let (caller_active, is_team_admin) = {
        let db = state.db.lock().unwrap();
        (
            is_user_active(&db, &caller),
            db.query_row("SELECT EXISTS(SELECT 1 FROM team_members WHERE team_id = ?1 AND user_id = ?2 AND role = 'admin')", params![team_id, caller], |row| row.get::<_, bool>(0)).unwrap_or(false),
        )
    };
    // Team-admin membership bypasses the global permission check, so a
    // deactivated team admin must be rejected before that bypass applies.
    if !caller_active {
        return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
    }
    if !is_team_admin {
        if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_members") {
            return app_error(status, error).into_response();
        }
    }
    let db = state.db.lock().unwrap();
    let team_exists = db.query_row("SELECT EXISTS(SELECT 1 FROM teams WHERE id = ?1)", [team_id], |row| row.get::<_, bool>(0)).unwrap_or(false);
    let user_exists = db.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)", [user_id], |row| row.get::<_, bool>(0)).unwrap_or(false);
    if !team_exists || !user_exists { return app_error(StatusCode::NOT_FOUND, "Team or user not found.").into_response(); }
    match db.execute("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)", params![team_id, user_id, role, now]) {
        Ok(_) => (StatusCode::CREATED, Json(json!({ "data": { "teamId": team_id, "userId": user_id, "role": role, "joinedAt": now } }))).into_response(),
        Err(error) if error.to_string().contains("UNIQUE") => app_error(StatusCode::CONFLICT, "User is already a member of this team").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_member_remove(State(state): State<ApiState>, headers: HeaderMap, AxumPath((team_id, user_id)): AxumPath<(i64, String)>) -> impl IntoResponse {
    let caller = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    let (caller_active, is_team_admin) = {
        let db = state.db.lock().unwrap();
        (
            is_user_active(&db, &caller),
            db.query_row("SELECT EXISTS(SELECT 1 FROM team_members WHERE team_id = ?1 AND user_id = ?2 AND role = 'admin')", params![team_id, caller], |row| row.get::<_, bool>(0)).unwrap_or(false),
        )
    };
    // Team-admin membership bypasses the global permission check, so a
    // deactivated team admin must be rejected before that bypass applies.
    if !caller_active {
        return app_error(StatusCode::FORBIDDEN, "User is not active.").into_response();
    }
    if !is_team_admin {
        if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_members") {
            return app_error(status, error).into_response();
        }
    }
    let db = state.db.lock().unwrap();
    match db.execute("DELETE FROM team_members WHERE team_id = ?1 AND user_id = ?2", params![team_id, user_id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Team member not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_access_list(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_access") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT a.id, a.connection_id, a.access_type, a.query_pattern, a.allowed_query_ids, c.name FROM connection_access a JOIN connections c ON c.id = a.connection_id WHERE a.team_id = ?1") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([team_id], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "connectionId": row.get::<_, String>(1)?, "accessType": row.get::<_, String>(2)?,
        "queryPattern": row.get::<_, Option<String>>(3)?, "allowedQueryIds": row.get::<_, Option<String>>(4)?,
        "connection": { "id": row.get::<_, String>(1)?, "name": row.get::<_, String>(5)? },
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_access_set(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_access") {
        return app_error(status, error).into_response();
    }
    let connection_id = body.get("connectionId").and_then(Value::as_str).unwrap_or("");
    let access_type = body.get("accessType").and_then(Value::as_str).unwrap_or("");
    if connection_id.is_empty() || !["FULL_ACCESS", "READ_ONLY", "READ_AND_REQUEST", "CUSTOM"].contains(&access_type) {
        return app_error(StatusCode::BAD_REQUEST, "Connection and valid access type are required.").into_response();
    }
    let allowed_query_ids = body.get("allowedQueryIds").map(Value::to_string);
    let query_pattern = body.get("queryPattern").and_then(Value::as_str);
    let db = state.db.lock().unwrap();
    let existing_id = db.query_row("SELECT id FROM connection_access WHERE connection_id = ?1 AND team_id = ?2 LIMIT 1", params![connection_id, team_id], |row| row.get::<_, i64>(0)).optional();
    let result = match existing_id {
        Ok(Some(id)) => db.execute("UPDATE connection_access SET access_type = ?1, query_pattern = ?2, allowed_query_ids = ?3 WHERE id = ?4", params![access_type, query_pattern, allowed_query_ids, id]),
        Ok(None) => db.execute("INSERT INTO connection_access (connection_id, role_id, team_id, access_type, query_pattern, allowed_query_ids) VALUES (?1, NULL, ?2, ?3, ?4, ?5)", params![connection_id, team_id, access_type, query_pattern, allowed_query_ids]),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    match result {
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "connectionId": connection_id, "teamId": team_id, "accessType": access_type, "queryPattern": query_pattern, "allowedQueryIds": body.get("allowedQueryIds") } }))).into_response(),
        Err(error) if error.to_string().contains("FOREIGN KEY") => app_error(StatusCode::NOT_FOUND, "Team or connection not found").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_permissions_list(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_access") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT team_id, permission_code, granted_by, granted_at FROM team_permissions WHERE team_id = ?1") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([team_id], |row| Ok(json!({
        "teamId": row.get::<_, i64>(0)?, "permissionCode": row.get::<_, String>(1)?,
        "grantedBy": row.get::<_, String>(2)?, "grantedAt": row.get::<_, String>(3)?,
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn team_permission_add(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "teams.manage_access") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    let code = body.get("permissionCode").and_then(Value::as_str).unwrap_or("");
    if code.is_empty() { return app_error(StatusCode::BAD_REQUEST, "Permission code is required.").into_response(); }
    let db = state.db.lock().unwrap();
    match db.execute("INSERT INTO team_permissions (team_id, permission_code, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4)", params![team_id, code, user_id, chrono_like_now()]) {
        Ok(_) => (StatusCode::CREATED, Json(json!({ "data": { "teamId": team_id, "permissionCode": code, "grantedBy": user_id } }))).into_response(),
        Err(error) if error.to_string().contains("UNIQUE") => app_error(StatusCode::CONFLICT, "Team permission already exists").into_response(),
        Err(error) => app_error(StatusCode::NOT_FOUND, error.to_string()).into_response(),
    }
}

async fn team_permission_remove(State(state): State<ApiState>, headers: HeaderMap, AxumPath(team_id): AxumPath<i64>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "teams.manage_access") {
        return app_error(status, error).into_response();
    }
    let code = body.get("permissionCode").and_then(Value::as_str).unwrap_or("");
    let db = state.db.lock().unwrap();
    match db.execute("DELETE FROM team_permissions WHERE team_id = ?1 AND permission_code = ?2", params![team_id, code]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Team permission not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "success": true } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 { return Err("Invalid encrypted workspace setting".into()); }
    (0..value.len()).step_by(2).map(|index| {
        u8::from_str_radix(&value[index..index + 2], 16).map_err(|_| "Invalid encrypted workspace setting".to_string())
    }).collect()
}

fn encrypt_password(state: &ApiState, password: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(&state.encryption_key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce_bytes), password.as_bytes())
        .map_err(|_| "Could not encrypt connection password".to_string())?;
    let mut combined = nonce_bytes.to_vec();
    combined.extend(encrypted);
    Ok(hex_encode(&combined))
}

fn decrypt_password(state: &ApiState, value: &str) -> Result<String, String> {
    let combined = hex_decode(value)?;
    if combined.len() < 13 { return Err("Invalid encrypted connection password".into()); }
    let cipher = Aes256Gcm::new_from_slice(&state.encryption_key).map_err(|e| e.to_string())?;
    let decrypted = cipher.decrypt(Nonce::from_slice(&combined[..12]), &combined[12..])
        .map_err(|_| "Could not decrypt connection password".to_string())?;
    String::from_utf8(decrypted).map_err(|e| e.to_string())
}

async fn connection_create(State(state): State<ApiState>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "connections.create") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim();
    let db_type = body.get("type").and_then(Value::as_str).unwrap_or("");
    let host = body.get("host").and_then(Value::as_str).unwrap_or("").trim();
    let port = body.get("port").and_then(Value::as_i64).unwrap_or_default();
    let database = body.get("database").and_then(Value::as_str).unwrap_or("").trim();
    let username = body.get("username").and_then(Value::as_str).unwrap_or("").trim();
    let password = body.get("password").and_then(Value::as_str).unwrap_or("");
    let valid_type = ["postgres", "mysql", "mariadb", "mssql", "cockroachdb", "yugabyte", "redshift"].contains(&db_type);
    if name.is_empty() || name.len() > 200 || !valid_type || host.is_empty() || !(1..=65535).contains(&port) || database.is_empty() || username.is_empty() {
        return app_error(StatusCode::BAD_REQUEST, "Connection name, type, host, port, database, and username are required.").into_response();
    }
    let encrypted = match encrypt_password(&state, password) {
        Ok(value) => value,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    };
    let id = uuid_like();
    let now = chrono_like_now();
    let mut db = state.db.lock().unwrap();
    // Grant the creator (and only the creator) full access to the new
    // connection. Querying requires `connections.manage_access` or an explicit
    // grant, so without this a creator without that permission could create a
    // connection but never query it. The grant is scoped to the creator's user
    // id rather than their role so teammates don't inherit access.
    let created = (|| -> rusqlite::Result<()> {
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO connections (id, name, type, host, port, database, username, encrypted_password, ssl, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![id, name, db_type, host, port, database, username, encrypted, body.get("ssl").and_then(Value::as_bool).unwrap_or(false), user_id, now],
        )?;
        tx.execute(
            "INSERT INTO connection_access (connection_id, role_id, team_id, user_id, access_type, query_pattern, allowed_query_ids) VALUES (?1, NULL, NULL, ?2, 'FULL_ACCESS', NULL, NULL)",
            params![id, user_id],
        )?;
        tx.commit()
    })();
    match created {
        Ok(_) => (StatusCode::CREATED, Json(json!({ "data": { "id": id, "name": name, "type": db_type, "createdBy": user_id, "createdAt": now, "updatedAt": now } }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_get(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    let user_id = match require_permission(&headers, &state, "connections.read") {
        Ok(id) => id,
        Err((status, error)) => return app_error(status, error).into_response(),
    };
    if !user_can_access_connection(&state, &user_id, &id) {
        return app_error(StatusCode::NOT_FOUND, "Connection not found").into_response();
    }
    let db = state.db.lock().unwrap();
    match db.query_row(
        "SELECT id, name, type, created_by, created_at, updated_at FROM connections WHERE id = ?1",
        [&id], connection_json,
    ) {
        Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
        Err(rusqlite::Error::QueryReturnedNoRows) => app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

fn user_can_access_connection(state: &ApiState, user_id: &str, connection_id: &str) -> bool {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT EXISTS (SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ?1 AND p.code = 'connections.manage_access') OR EXISTS (SELECT 1 FROM users u JOIN connection_access a ON a.role_id = u.role_id WHERE u.id = ?1 AND a.connection_id = ?2) OR EXISTS (SELECT 1 FROM team_members tm JOIN connection_access a ON a.team_id = tm.team_id WHERE tm.user_id = ?1 AND a.connection_id = ?2) OR EXISTS (SELECT 1 FROM connection_access a WHERE a.connection_id = ?2 AND a.user_id = ?1)",
        params![user_id, connection_id], |row| row.get::<_, bool>(0),
    ).unwrap_or(false)
}

async fn connection_credentials(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "connections.manage_access") {
        return app_error(status, error).into_response();
    }
    let row = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT host, port, database, username, encrypted_password, ssl FROM connections WHERE id = ?1",
            [&id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, bool>(5)?)),
        )
    };
    match row {
        Ok((host, port, database, username, encrypted, ssl)) => match decrypt_password(&state, &encrypted) {
            Ok(password) => (StatusCode::OK, Json(json!({ "data": { "host": host, "port": port, "database": database, "username": username, "password": password, "ssl": ssl } }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
        },
        Err(rusqlite::Error::QueryReturnedNoRows) => app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_access_list(State(state): State<ApiState>, headers: HeaderMap, AxumPath(connection_id): AxumPath<String>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "connections.manage_access") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    let mut statement = match db.prepare("SELECT a.id, a.role_id, a.team_id, a.user_id, a.access_type, a.query_pattern, a.allowed_query_ids, r.name, r.description FROM connection_access a LEFT JOIN roles r ON r.id = a.role_id WHERE a.connection_id = ?1") {
        Ok(statement) => statement,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    let rows = statement.query_map([connection_id], |row| Ok(json!({
        "id": row.get::<_, i64>(0)?, "roleId": row.get::<_, Option<i64>>(1)?, "teamId": row.get::<_, Option<i64>>(2)?,
        "userId": row.get::<_, Option<String>>(3)?,
        "accessType": row.get::<_, String>(4)?, "queryPattern": row.get::<_, Option<String>>(5)?, "allowedQueryIds": row.get::<_, Option<String>>(6)?,
        "role": row.get::<_, Option<String>>(7)?.map(|name| json!({ "id": row.get::<_, Option<i64>>(1).unwrap_or(None), "name": name, "description": row.get::<_, Option<String>>(8).unwrap_or(None) })),
    })));
    match rows {
        Ok(rows) => match rows.collect::<Result<Vec<_>, _>>() {
            Ok(data) => (StatusCode::OK, Json(json!({ "data": data }))).into_response(),
            Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        },
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_access_set(State(state): State<ApiState>, headers: HeaderMap, AxumPath(connection_id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "connections.manage_access") {
        return app_error(status, error).into_response();
    }
    let role_id = body.get("roleId").and_then(Value::as_i64).unwrap_or_default();
    let access_type = body.get("accessType").and_then(Value::as_str).unwrap_or("");
    if role_id <= 0 || !["FULL_ACCESS", "READ_ONLY", "READ_AND_REQUEST", "CUSTOM"].contains(&access_type) {
        return app_error(StatusCode::BAD_REQUEST, "Role and valid access type are required.").into_response();
    }
    let query_pattern = body.get("queryPattern").and_then(Value::as_str);
    let allowed_query_ids = body.get("allowedQueryIds").map(Value::to_string);
    let db = state.db.lock().unwrap();
    let existing = db.query_row("SELECT id FROM connection_access WHERE connection_id = ?1 AND role_id = ?2 LIMIT 1", params![connection_id, role_id], |row| row.get::<_, i64>(0)).optional();
    let result = match existing {
        Ok(Some(id)) => db.execute("UPDATE connection_access SET access_type = ?1, query_pattern = ?2, allowed_query_ids = ?3 WHERE id = ?4", params![access_type, query_pattern, allowed_query_ids, id]),
        Ok(None) => db.execute("INSERT INTO connection_access (connection_id, role_id, team_id, access_type, query_pattern, allowed_query_ids) VALUES (?1, ?2, NULL, ?3, ?4, ?5)", params![connection_id, role_id, access_type, query_pattern, allowed_query_ids]),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    match result {
        Ok(_) => (StatusCode::OK, Json(json!({ "data": { "connectionId": connection_id, "roleId": role_id, "accessType": access_type, "queryPattern": query_pattern, "allowedQueryIds": body.get("allowedQueryIds") } }))).into_response(),
        Err(error) if error.to_string().contains("FOREIGN KEY") => app_error(StatusCode::NOT_FOUND, "Role or connection not found").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_update(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "connections.update") {
        return app_error(status, error).into_response();
    }
    let name = body.get("name").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty());
    if name.is_some_and(|value| value.len() > 200) { return app_error(StatusCode::BAD_REQUEST, "Connection name must be at most 200 characters.").into_response(); }
    let db_type = body.get("type").and_then(Value::as_str);
    if db_type.is_some_and(|value| !["postgres", "mysql", "mariadb", "mssql", "cockroachdb", "yugabyte", "redshift"].contains(&value)) {
        return app_error(StatusCode::BAD_REQUEST, "Unsupported database type.").into_response();
    }
    let host = body.get("host").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty());
    let port = body.get("port").and_then(Value::as_i64);
    if port.is_some_and(|value| !(1..=65535).contains(&value)) { return app_error(StatusCode::BAD_REQUEST, "Port must be between 1 and 65535.").into_response(); }
    let database = body.get("database").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty());
    let username = body.get("username").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty());
    let encrypted_password = match body.get("password").and_then(Value::as_str) {
        Some(password) if !password.is_empty() => match encrypt_password(&state, password) {
            Ok(value) => Some(value),
            Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
        },
        _ => None,
    };
    let ssl = body.get("ssl").and_then(Value::as_bool);
    let now = chrono_like_now();
    let db = state.db.lock().unwrap();
    match db.execute(
        "UPDATE connections SET name = COALESCE(?1, name), type = COALESCE(?2, type), host = COALESCE(?3, host), port = COALESCE(?4, port), database = COALESCE(?5, database), username = COALESCE(?6, username), ssl = COALESCE(?7, ssl), encrypted_password = COALESCE(?8, encrypted_password), updated_at = ?9 WHERE id = ?10",
        params![name, db_type, host, port, database, username, ssl, encrypted_password, now, id],
    ) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_delete(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    if let Err((status, error)) = require_permission(&headers, &state, "connections.delete") {
        return app_error(status, error).into_response();
    }
    let db = state.db.lock().unwrap();
    match db.execute("DELETE FROM connections WHERE id = ?1", [&id]) {
        Ok(0) => app_error(StatusCode::NOT_FOUND, "Connection not found").into_response(),
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))).into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn connection_query(State(state): State<ApiState>, headers: HeaderMap, AxumPath(id): AxumPath<String>, Json(body): Json<Value>) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    let sql = body.get("query").or_else(|| body.get("sql")).and_then(Value::as_str).unwrap_or("").trim();
    if sql.is_empty() { return app_error(StatusCode::BAD_REQUEST, "Query is required.").into_response(); }

    let allowed_to_execute = require_permission(&headers, &state, "queries.execute").is_ok();
    let allowed_readonly = require_permission(&headers, &state, "queries.readonly").is_ok();
    if !allowed_to_execute && !allowed_readonly {
        return app_error(StatusCode::FORBIDDEN, "Missing required permission: queries.execute").into_response();
    }
    let is_read = is_read_query(sql);
    if !allowed_to_execute && !is_read {
        return app_error(StatusCode::FORBIDDEN, "This role can only run read-only queries.").into_response();
    }

    let connection = {
        let db = state.db.lock().unwrap();
        let details = db.query_row(
            "SELECT c.type, c.host, c.port, c.database, c.username, c.encrypted_password, c.ssl, u.role_id FROM connections c, users u WHERE c.id = ?1 AND u.id = ?2 AND u.is_active = 1",
            params![id, user_id],
            |row| Ok((
                row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?,
                row.get::<_, bool>(6)?, row.get::<_, i64>(7)?,
            )),
        );
        details
    };
    let (db_type, host, port, database, username, password, ssl, role_id) = match connection {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return app_error(StatusCode::NOT_FOUND, "Connection not found.").into_response(),
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };

    let access = {
        let db = state.db.lock().unwrap();
        let full_access = db.query_row(
            "SELECT EXISTS (SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ?1 AND p.code = 'connections.manage_access')",
            [&user_id], |row| row.get::<_, bool>(0),
        ).unwrap_or(false);
        if full_access { Some("FULL_ACCESS".to_string()) }
        else {
            db.query_row("SELECT access_type FROM connection_access WHERE connection_id = ?1 AND role_id = ?2 LIMIT 1", params![id, role_id], |row| row.get::<_, String>(0))
                .optional().unwrap_or(None).or_else(|| {
                    db.query_row("SELECT a.access_type FROM connection_access a JOIN team_members tm ON tm.team_id = a.team_id WHERE a.connection_id = ?1 AND tm.user_id = ?2 LIMIT 1", params![id, user_id], |row| row.get::<_, String>(0))
                        .optional().unwrap_or(None)
                }).or_else(|| {
                    db.query_row("SELECT access_type FROM connection_access WHERE connection_id = ?1 AND user_id = ?2 LIMIT 1", params![id, user_id], |row| row.get::<_, String>(0))
                        .optional().unwrap_or(None)
                })
        }
    };
    let access = match access {
        Some(access) => access,
        None => return app_error(StatusCode::FORBIDDEN, "You do not have access to this connection.").into_response(),
    };
    if access == "READ_ONLY" && !is_read {
        return app_error(StatusCode::FORBIDDEN, "This connection is read-only for your role.").into_response();
    }
    if access == "READ_AND_REQUEST" && !is_read {
        return app_error(StatusCode::FORBIDDEN, "Write queries require approval for this connection.").into_response();
    }
    if access == "CUSTOM" {
        return app_error(StatusCode::FORBIDDEN, "Custom connection access is not supported by the embedded server yet.").into_response();
    }

    let password = match decrypt_password(&state, &password) {
        Ok(password) => password,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error).into_response(),
    };
    let scheme = match db_type.as_str() {
        "postgres" | "cockroachdb" | "yugabyte" | "redshift" => "postgresql",
        "mysql" | "mariadb" => "mysql",
        "mssql" => "mssql",
        _ => return app_error(StatusCode::BAD_REQUEST, "Unsupported database type.").into_response(),
    };
    let mut url = match url::Url::parse(&format!("{scheme}://localhost")) {
        Ok(url) => url,
        Err(error) => return app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    };
    if url.set_username(&username).is_err() || url.set_password(Some(&password)).is_err() || url.set_host(Some(&host)).is_err() || url.set_port(Some(port as u16)).is_err() {
        return app_error(StatusCode::BAD_REQUEST, "Invalid database connection details.").into_response();
    }
    url.set_path(&format!("/{database}"));
    if ssl && matches!(scheme, "postgresql") { url.query_pairs_mut().append_pair("sslmode", "require"); }

    let started = std::time::Instant::now();
    let upstream = reqwest::Client::new().post(format!("{}/api/sql/run", state.sidecar_api))
        .json(&json!({
            "connectionString": url.as_str(), "query": sql,
            "params": body.get("params").cloned().unwrap_or_else(|| json!([])),
            "connectionType": db_type,
        }))
        .send().await;
    let upstream = match upstream {
        Ok(response) => response,
        Err(error) => return app_error(StatusCode::BAD_GATEWAY, format!("Could not reach RexaDB query engine: {error}")).into_response(),
    };
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut result = match upstream.json::<Value>().await {
        Ok(result) => result,
        Err(error) => return app_error(StatusCode::BAD_GATEWAY, format!("RexaDB query engine returned invalid JSON: {error}")).into_response(),
    };
    // The sidecar query route wraps results in `data`, while Studio's database
    // proxy reads `rows` and `duration` at the top level.
    if let Some(data) = result.get("data").and_then(Value::as_object).cloned() {
        if let Some(result) = result.as_object_mut() {
            for key in ["rows", "fields", "rowCount", "executionTime", "duration"] {
                if let Some(value) = data.get(key) { result.insert(key.to_string(), value.clone()); }
            }
            if !result.contains_key("duration") {
                if let Some(value) = data.get("executionTime") { result.insert("duration".to_string(), value.clone()); }
            }
        }
    }
    let duration = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "INSERT INTO query_logs (connection_id, user_id, query, duration, executed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, user_id, sql, duration, chrono_like_now()],
    );
    (status, Json(result)).into_response()
}

/// Length of a PostgreSQL dollar-quote opening delimiter (`$$` or `$tag$`)
/// starting at `bytes[index] == b'$'`, or `None` when this `$` does not open
/// one (e.g. a `$1` placeholder or a bare `$`).
fn dollar_quote_open_len(bytes: &[u8], index: usize) -> Option<usize> {
    let first = *bytes.get(index + 1)?;
    if first == b'$' {
        return Some(2); // `$$`
    }
    // Tags follow identifier rules (and cannot contain `$`); a leading digit
    // means this is a placeholder like `$1`, not a quote.
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return None;
    }
    let mut end = index + 2;
    while let Some(&byte) = bytes.get(end) {
        if byte == b'$' {
            return Some(end - index + 1);
        }
        if !(byte.is_ascii_alphanumeric() || byte == b'_') {
            return None;
        }
        end += 1;
    }
    None
}

/// Byte index just past the closing delimiter matching the opening delimiter
/// `bytes[open..open + open_len]`, or `None` when unterminated.
fn dollar_quote_end(bytes: &[u8], open: usize, open_len: usize) -> Option<usize> {
    let delimiter = bytes.get(open..open + open_len)?;
    let mut index = open + open_len;
    while index + delimiter.len() <= bytes.len() {
        if &bytes[index..index + delimiter.len()] == delimiter {
            return Some(index + delimiter.len());
        }
        index += 1;
    }
    None
}

/// Returns true when `sql` contains a statement terminator (`;`) followed by
/// more SQL. String literals (`'...'`, `"..."`, `` `...` `` with `''` escape),
/// PostgreSQL dollar-quoted strings (`$$...$$`, `$tag$...$tag$`),
/// line comments (`-- ...`) and block comments (`/* ... */`) are skipped so a
/// semicolon inside them does not count. A trailing semicolon with nothing
/// after it is a single statement.
fn has_multiple_statements(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let mut quote: Option<u8> = None;
    let mut line_comment = false;
    let mut block_comment = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if line_comment {
            if byte == b'\n' { line_comment = false; }
        } else if block_comment {
            if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                block_comment = false;
                index += 1;
            }
        } else if let Some(quote_byte) = quote {
            if byte == quote_byte {
                if bytes.get(index + 1) == Some(&quote_byte) {
                    index += 1; // escaped quote ('')
                } else {
                    quote = None;
                }
            }
        } else if byte == b'\'' || byte == b'"' || byte == b'`' {
            quote = Some(byte);
        } else if byte == b'$' {
            if let Some(open_len) = dollar_quote_open_len(bytes, index) {
                match dollar_quote_end(bytes, index, open_len) {
                    Some(end) => { index = end; continue; }
                    // Unterminated quote: the rest is string content.
                    None => break,
                }
            }
        } else if byte == b'-' && bytes.get(index + 1) == Some(&b'-') {
            line_comment = true;
            index += 1;
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            block_comment = true;
            index += 1;
        } else if byte == b';' {
            return remainder_has_sql(bytes, index + 1);
        }
        index += 1;
    }
    false
}

fn remainder_has_sql(bytes: &[u8], mut index: usize) -> bool {
    let mut line_comment = false;
    let mut block_comment = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if line_comment {
            if byte == b'\n' { line_comment = false; }
        } else if block_comment {
            if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                block_comment = false;
                index += 1;
            }
        } else if byte == b'\'' || byte == b'"' || byte == b'`' {
            // A string literal after `;` is still SQL content.
            return true;
        } else if byte == b'$' {
            if let Some(open_len) = dollar_quote_open_len(bytes, index) {
                match dollar_quote_end(bytes, index, open_len) {
                    // A dollar-quoted string after `;` is still SQL content.
                    Some(_) => return true,
                    // Unterminated: the rest is string content.
                    None => return true,
                }
            } else if !byte.is_ascii_whitespace() {
                return true;
            }
        } else if byte == b'-' && bytes.get(index + 1) == Some(&b'-') {
            line_comment = true;
            index += 1;
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            block_comment = true;
            index += 1;
        } else if !byte.is_ascii_whitespace() && byte != b';' {
            return true;
        }
        index += 1;
    }
    false
}

fn is_read_query(sql: &str) -> bool {
    // Stacked statements (e.g. `SELECT 1; DELETE FROM t`) must never count as
    // read-only: the permission check sees the first statement while the query
    // engine would receive the whole string.
    if has_multiple_statements(sql) {
        return false;
    }
    let stripped = sql.lines().map(|line| line.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>().join(" ").to_ascii_uppercase();
    let first = stripped.trim_start().split(|character: char| !character.is_ascii_alphanumeric()).next().unwrap_or("");
    if first == "WITH" {
        return !["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "ALTER", "DROP", "CREATE", "GRANT", "REVOKE", "REPLACE", "LOAD", "IMPORT", "COPY"]
            .iter().any(|keyword| stripped.contains(keyword));
    }
    ["SELECT", "EXPLAIN", "DESCRIBE", "SHOW"].contains(&first)
}

async fn auth_me(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let user_id = match token_user_id(&headers, &state) {
        Ok(id) => id,
        Err(status) => return app_error(status, "Invalid or expired workspace token.").into_response(),
    };
    let db = state.db.lock().unwrap();
    let user = (|| -> rusqlite::Result<Value> {
        let user = db.query_row(
            "SELECT u.id, u.email, u.name, r.id, r.name, r.description, u.avatar_url FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?1 AND u.is_active = 1",
            [&user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?)),
        )?;
        let mut statement = db.prepare("SELECT p.id, p.code, p.name, p.description FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?1 ORDER BY p.id")?;
        let permissions = statement.query_map([user.3], |row| Ok(json!({
            "id": row.get::<_, i64>(0)?, "code": row.get::<_, String>(1)?,
            "name": row.get::<_, String>(2)?, "description": row.get::<_, String>(3)?,
        })))?.collect::<Result<Vec<_>, _>>()?;
        Ok(json!({
            "id": user.0, "email": user.1, "name": user.2,
            "role": { "id": user.3, "name": user.4, "description": user.5 },
            "avatarUrl": user.6, "permissions": permissions,
        }))
    })();
    match user {
        Ok(value) => (StatusCode::OK, Json(json!({ "data": value }))).into_response(),
        Err(rusqlite::Error::QueryReturnedNoRows) => app_error(StatusCode::UNAUTHORIZED, "User is not active.").into_response(),
        Err(error) => app_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn studio_info(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(status) = token_user_id(&headers, &state) {
        return app_error(status, "Invalid or expired workspace token.").into_response();
    }
    (StatusCode::OK, Json(json!({ "data": { "name": "Local RexaDB Studio", "userCount": 1 } }))).into_response()
}

fn chrono_like_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn random_hex(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex_encode(&bytes)
}

fn base32_decode(value: &str) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0u8;
    for character in value.chars().filter(|character| *character != '=') {
        let digit = match character.to_ascii_uppercase() {
            'A'..='Z' => character.to_ascii_uppercase() as u8 - b'A',
            '2'..='7' => character as u8 - b'2' + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | digit as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    Some(output)
}

fn verify_totp(secret: &str, supplied: &str) -> bool {
    if supplied.len() != 6 || !supplied.bytes().all(|byte| byte.is_ascii_digit()) { return false; }
    let Some(secret) = base32_decode(secret) else { return false; };
    let counter = (unix_time() as i64) / 30;
    (-1..=1).any(|offset| {
        let step = counter + offset;
        if step < 0 { return false; }
        let Ok(mut mac) = <Hmac<Sha1> as Mac>::new_from_slice(&secret) else { return false; };
        mac.update(&(step as u64).to_be_bytes());
        let digest = mac.finalize().into_bytes();
        let offset = (digest[digest.len() - 1] & 0x0f) as usize;
        let number = (u32::from(digest[offset] & 0x7f) << 24)
            | (u32::from(digest[offset + 1]) << 16)
            | (u32::from(digest[offset + 2]) << 8)
            | u32::from(digest[offset + 3]);
        format!("{:06}", number % 1_000_000) == supplied
    })
}

fn uuid_like() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

pub fn new_server_id() -> String { uuid_like() }

pub async fn setup_from_app(url: &str, input: SetupInput) -> Result<Value, String> {
    let response = reqwest::Client::new().post(format!("{url}/api/local/setup")).json(&input)
        .send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.json::<Value>().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body.get("error").and_then(Value::as_str).unwrap_or("Local workspace setup failed.").to_string());
    }
    Ok(body)
}

#[cfg(test)]
mod statement_tests {
    use super::*;

    #[test]
    fn single_statements_are_not_multiple() {
        assert!(!has_multiple_statements("SELECT 1"));
        assert!(!has_multiple_statements("SELECT 1;"));
        assert!(!has_multiple_statements("SELECT 1;;"));
        assert!(!has_multiple_statements("SELECT 1;  \n -- done"));
        assert!(!has_multiple_statements("SELECT ';'"));
        assert!(!has_multiple_statements("SELECT $$a; b$$"));
        assert!(!has_multiple_statements("SELECT $body$a; b$body$"));
        assert!(!has_multiple_statements("SELECT $1, $2"));
        assert!(!has_multiple_statements("WITH x AS (SELECT 1) SELECT * FROM x"));
    }

    #[test]
    fn stacked_statements_are_multiple() {
        assert!(has_multiple_statements("SELECT 1; DELETE FROM t"));
        assert!(has_multiple_statements("SELECT 1;SELECT 2"));
        assert!(has_multiple_statements("SELECT $$a$$; DELETE FROM t"));
        assert!(has_multiple_statements("SELECT 1; SELECT $$unterminated"));
        assert!(has_multiple_statements("SELECT $tag$x$tag$; DROP TABLE t"));
    }

    #[test]
    fn read_query_classification() {
        assert!(is_read_query("SELECT 1"));
        assert!(is_read_query("SELECT $$a; b$$"));
        assert!(is_read_query("select $1"));
        assert!(!is_read_query("SELECT 1; DELETE FROM t"));
        assert!(!is_read_query("DELETE FROM t"));
    }
}
