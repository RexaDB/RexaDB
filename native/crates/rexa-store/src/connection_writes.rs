//! Write path for saved connections, folders and tags — a port of
//! lib/db/actions-core.ts (`addConnection`, `updateConnection`,
//! `deleteConnection`, `reorderConnections`, connection groups / tags) plus
//! the credential protection from lib/credentials/connection-credentials.ts
//! (`protectConnectionPayload`) and connection-secret-utils.ts.
//!
//! Secrets never reach the row: like the old app, a secret-bearing payload is
//! stored as a JSON bundle `{connectionString, password, authToken}` in the
//! system keychain (service `com.rexa-db.connection`, account = a random UUID
//! reference) and the row keeps the redacted connection string plus
//! `credential_ref`. `REXADB_KEYCHAIN_SERVICE` overrides the service name
//! (development only, so tests never touch the real entries).

use crate::{SavedConnection, Store, Vault};
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

pub const KEYCHAIN_SERVICE: &str = "com.rexa-db.connection";

fn keychain_service() -> String {
    std::env::var("REXADB_KEYCHAIN_SERVICE").unwrap_or_else(|_| KEYCHAIN_SERVICE.to_string())
}

/// A saved connection plus the data that lives outside `SavedConnection`.
#[derive(Debug, Clone)]
pub struct ConnectionRow {
    pub conn: SavedConnection,
    /// Folder names (connection_group_members), in group order.
    pub groups: Vec<String>,
    pub sort_order: Option<i64>,
    /// Seconds since the epoch (drizzle `timestamp` mode).
    pub created_at: Option<i64>,
    pub ssl_mode: Option<String>,
}

/// Fields to write. `None` leaves a column untouched on update (the TS
/// `undefined`); `Some(None)` on the doubly-optional fields clears it (`null`).
#[derive(Debug, Clone, Default)]
pub struct ConnectionDraft {
    pub name: Option<String>,
    pub connection_string: Option<String>,
    pub connection_type: Option<String>,
    pub tags: Option<Vec<String>>,
    pub icon: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub groups: Option<Vec<String>>,
    pub is_favorite: Option<bool>,
    /// Seconds since the epoch.
    pub last_active: Option<i64>,
    pub host: Option<String>,
    pub port: Option<String>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<Option<String>>,
    pub ssl_mode: Option<String>,
    pub auth_token: Option<Option<String>>,
    pub credential_ref: Option<Option<String>>,
    /// Encrypted envelope for a `vault:` reference; never populated for keychain rows.
    pub credential_secret: Option<Option<String>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CredentialStorageMode {
    Keychain,
    Vault,
    Plaintext,
}

impl CredentialStorageMode {
    /// `getCredentialStorageMode`: the `rexadb:credential-storage-mode` key
    /// (app_settings first, then the old app's localStorage), keychain by default on desktop.
    pub fn current(store: &Store) -> Self {
        let raw = store
            .setting("rexadb:credential-storage-mode")
            .ok()
            .flatten()
            .or_else(|| crate::WebStore::open()?.get("rexadb:credential-storage-mode").ok().flatten());
        match raw.as_deref().map(|s| s.trim_matches('"')) {
            Some("vault") => Self::Vault,
            Some("plaintext") => Self::Plaintext,
            _ => Self::Keychain,
        }
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

const LEGACY_ENVIRONMENT_TAG_COLORS: &[(&str, &str)] =
    &[("production", "#ef4444"), ("staging", "#f59e0b"), ("local", "#0ea5e9")];
const MAX_CONNECTION_ICON_LENGTH: usize = 200_000;

fn normalize_icon(icon: Option<&str>) -> Result<Option<String>> {
    match icon {
        None | Some("") => Ok(None),
        Some(i) if i.len() > MAX_CONNECTION_ICON_LENGTH => bail!("The connection icon image is too large."),
        Some(i) if i.starts_with("emoji:") || i.starts_with("image:data:image/") => Ok(Some(i.to_string())),
        Some(_) => bail!("Unsupported connection icon."),
    }
}

fn serialize_tags(tags: &[String]) -> Option<String> {
    let mut unique: Vec<String> = Vec::new();
    for t in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !unique.iter().any(|u| u == t) {
            unique.push(t.to_string());
        }
    }
    (!unique.is_empty()).then(|| serde_json::to_string(&unique).unwrap())
}

impl Store {
    fn ensure_connection_tables(&self) -> Result<()> {
        self.db.execute_batch(
            r#"CREATE TABLE IF NOT EXISTS connections (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, connection_string TEXT NOT NULL,
                 connection_type TEXT, created_at INTEGER NOT NULL, sort_order INTEGER, environment TEXT,
                 color TEXT, "group" TEXT, is_favorite INTEGER DEFAULT 0, last_active INTEGER, host TEXT,
                 port TEXT, database TEXT, username TEXT, password TEXT, ssl_mode TEXT, auth_token TEXT,
                 credential_ref TEXT, credential_secret TEXT, tags TEXT, icon TEXT);
               CREATE TABLE IF NOT EXISTS connection_groups (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
               CREATE TABLE IF NOT EXISTS connection_group_members (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                 group_id INTEGER NOT NULL REFERENCES connection_groups(id) ON DELETE CASCADE);
               CREATE UNIQUE INDEX IF NOT EXISTS idx_cgm_conn_group ON connection_group_members(connection_id, group_id);
               CREATE TABLE IF NOT EXISTS connection_tags (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL,
                 created_at INTEGER NOT NULL);"#,
        )?;
        Ok(())
    }

    /// `getConnections`: every row with its folders, `sort_order DESC, created_at DESC`.
    pub fn connection_rows(&self) -> Result<Vec<ConnectionRow>> {
        self.ensure_connection_tables()?;
        let mut members: HashMap<i64, Vec<String>> = HashMap::new();
        {
            let mut stmt = self.db.prepare(
                "SELECT m.connection_id, g.name FROM connection_group_members m
                 JOIN connection_groups g ON g.id = m.group_id ORDER BY m.id",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (id, name) = row?;
                members.entry(id).or_default().push(name);
            }
        }
        let mut stmt = self.db.prepare(
            r#"SELECT id, name, connection_string, COALESCE(connection_type, ''), environment, color,
                      "group", COALESCE(is_favorite, 0), host, port, database, username, password,
                      auth_token, credential_ref, credential_secret, tags, icon, last_active,
                      sort_order, created_at, ssl_mode
               FROM connections ORDER BY sort_order DESC, created_at DESC"#,
        )?;
        let rows = stmt.query_map([], |r| {
            let id: i64 = r.get(0)?;
            Ok(ConnectionRow {
                conn: SavedConnection {
                    id,
                    name: r.get(1)?,
                    connection_string: r.get(2)?,
                    kind: r.get(3)?,
                    environment: r.get(4)?,
                    color: r.get(5)?,
                    group: r.get(6)?,
                    is_favorite: r.get::<_, i64>(7)? != 0,
                    host: r.get(8)?,
                    port: r.get(9)?,
                    database: r.get(10)?,
                    username: r.get(11)?,
                    password: r.get(12)?,
                    auth_token: r.get(13)?,
                    credential_ref: r.get(14)?,
                    credential_secret: r.get(15)?,
                    tags: r
                        .get::<_, Option<String>>(16)?
                        .and_then(|t| serde_json::from_str(&t).ok())
                        .unwrap_or_default(),
                    icon: r.get(17)?,
                    last_active: r.get(18)?,
                },
                groups: Vec::new(),
                sort_order: r.get(19)?,
                created_at: r.get(20)?,
                ssl_mode: r.get(21)?,
            })
        })?;
        let mut out: Vec<ConnectionRow> = rows.collect::<rusqlite::Result<_>>()?;
        for row in &mut out {
            row.groups = members.remove(&row.conn.id).unwrap_or_default();
        }
        Ok(out)
    }

    /// `resolveConnectionTags`: library spelling wins; unknown names join the library.
    fn resolve_tags(&self, tags: &[String]) -> Result<Option<String>> {
        let Some(serialized) = serialize_tags(tags) else { return Ok(None) };
        let names: Vec<String> = serde_json::from_str(&serialized)?;
        let mut library: HashMap<String, String> = self
            .connection_tag_library()?
            .into_iter()
            .map(|t| (t.name.to_lowercase(), t.name))
            .collect();
        let mut resolved = Vec::new();
        for name in names {
            if let Some(known) = library.get(&name.to_lowercase()) {
                resolved.push(known.clone());
                continue;
            }
            let tag_name: String = name.chars().take(32).collect();
            let color = LEGACY_ENVIRONMENT_TAG_COLORS
                .iter()
                .find(|(n, _)| *n == tag_name.to_lowercase())
                .map_or("#71717a", |(_, c)| c);
            self.db.execute(
                "INSERT OR IGNORE INTO connection_tags(name, color, created_at) VALUES (?1, ?2, ?3)",
                params![tag_name, color, now_secs()],
            )?;
            library.insert(tag_name.to_lowercase(), tag_name.clone());
            resolved.push(tag_name);
        }
        Ok(serialize_tags(&resolved))
    }

    fn sync_group_members(&self, id: i64, groups: &[String]) -> Result<()> {
        self.db.execute("DELETE FROM connection_group_members WHERE connection_id = ?1", [id])?;
        for name in groups {
            let gid: Option<i64> = self
                .db
                .query_row("SELECT id FROM connection_groups WHERE name = ?1", [name], |r| r.get(0))
                .optional()?;
            if let Some(gid) = gid {
                self.db.execute(
                    "INSERT OR IGNORE INTO connection_group_members(connection_id, group_id) VALUES (?1, ?2)",
                    params![id, gid],
                )?;
            }
        }
        Ok(())
    }

    /// `createConnection` (protectConnectionPayload + POST /api/connections). Returns the new id.
    pub fn create_connection(&self, draft: ConnectionDraft) -> Result<i64> {
        self.create_connection_with_vault(draft, None)
    }

    /// Create a connection with an unlocked vault when vault storage is selected.
    pub fn create_connection_with_vault(&self, draft: ConnectionDraft, vault: Option<&Vault>) -> Result<i64> {
        self.ensure_connection_tables()?;
        let mode = CredentialStorageMode::current(self);
        let protected = protect_payload(draft, &mode, None, vault)?;
        let result = self.insert_connection(&protected);
        if result.is_err() {
            if let Some(Some(reference)) = &protected.credential_ref {
                delete_credential(reference).ok();
            }
        }
        result
    }

    fn insert_connection(&self, d: &ConnectionDraft) -> Result<i64> {
        let name = d.name.clone().unwrap_or_default();
        let cs = d.connection_string.clone().unwrap_or_default();
        // Date.now() ids, unique even for back-to-back imports.
        let mut id = now_millis();
        while self
            .db
            .query_row("SELECT 1 FROM connections WHERE id = ?1", [id], |_| Ok(()))
            .optional()?
            .is_some()
        {
            id += 1;
        }
        let tags = match &d.tags {
            Some(t) => self.resolve_tags(t)?,
            None => None,
        };
        let icon = normalize_icon(d.icon.clone().flatten().as_deref())?;
        let groups = d.groups.clone().unwrap_or_default();
        self.db.execute(
            r#"INSERT INTO connections (id, name, connection_string, connection_type, host, port, database,
                 username, password, ssl_mode, auth_token, credential_ref, credential_secret, color, tags,
                 icon, "group", is_favorite, created_at, sort_order, last_active)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)"#,
            params![
                id,
                name,
                cs,
                d.connection_type,
                d.host,
                d.port,
                d.database,
                d.username,
                d.password.clone().flatten(),
                d.ssl_mode,
                d.auth_token.clone().flatten(),
                d.credential_ref.clone().flatten(),
                d.credential_secret.clone().flatten(),
                d.color.clone().flatten(),
                tags,
                icon,
                groups.first(),
                d.is_favorite.unwrap_or(false) as i64,
                now_secs(),
                id,
                d.last_active,
            ],
        )?;
        if !groups.is_empty() {
            self.sync_group_members(id, &groups)?;
        }
        Ok(id)
    }

    /// `updateConnection` (protectConnectionPayload + PUT /api/connections/:id).
    /// `stored_bundle` is the unlocked credential bundle when the caller has it
    /// (used to detect that the target changed and the old reference is stale).
    pub fn update_connection(&self, id: i64, draft: ConnectionDraft) -> Result<()> {
        self.update_connection_with_vault(id, draft, None)
    }

    /// Update a connection with an unlocked vault when vault storage is selected.
    pub fn update_connection_with_vault(&self, id: i64, draft: ConnectionDraft, vault: Option<&Vault>) -> Result<()> {
        self.ensure_connection_tables()?;
        let existing = self.connection_rows()?.into_iter().find(|r| r.conn.id == id);
        let old_ref = draft.credential_ref.clone().flatten();
        let mode = CredentialStorageMode::current(self);
        let stored = old_ref.as_deref().filter(|r| !r.starts_with("vault:")).and_then(|r| read_bundle(r).ok());
        let protected = protect_payload(draft, &mode, stored.as_ref(), vault)?;
        let new_ref = protected.credential_ref.clone().flatten();
        let result = self.write_update(id, &protected, existing.as_ref());
        match &result {
            Err(_) => {
                if let Some(r) = new_ref.as_deref().filter(|r| Some(*r) != old_ref.as_deref()) {
                    delete_credential(r).ok();
                }
            }
            Ok(()) => {
                if let Some(old) = old_ref.as_deref() {
                    if new_ref.as_deref() != Some(old) && protected.credential_ref.is_some() {
                        delete_credential(old).ok();
                    }
                }
            }
        }
        result
    }

    fn write_update(&self, id: i64, d: &ConnectionDraft, existing: Option<&ConnectionRow>) -> Result<()> {
        let mut sets: Vec<String> = Vec::new();
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        let mut set = |col: &str, v: rusqlite::types::Value| {
            values.push(v);
            sets.push(format!("{col} = ?{}", values.len()));
        };
        use rusqlite::types::Value as V;
        let text = |s: &Option<String>| s.clone().map_or(V::Null, V::Text);
        if let Some(v) = &d.name {
            set("name", V::Text(v.clone()));
        }
        if let Some(v) = &d.connection_string {
            if let Some(e) = existing {
                if &e.conn.connection_string != v {
                    self.clear_connection_string_caches(&e.conn.connection_string).ok();
                }
            }
            set("connection_string", V::Text(v.clone()));
        }
        if let Some(v) = &d.connection_type {
            set("connection_type", V::Text(v.clone()));
        }
        for (col, v) in [
            ("host", &d.host),
            ("port", &d.port),
            ("database", &d.database),
            ("username", &d.username),
            ("ssl_mode", &d.ssl_mode),
        ] {
            if let Some(v) = v {
                set(col, V::Text(v.clone()));
            }
        }
        if let Some(v) = &d.password {
            set("password", text(v));
        }
        if let Some(v) = &d.auth_token {
            set("auth_token", text(v));
        }
        if let Some(v) = &d.credential_ref {
            set("credential_ref", text(v));
        }
        if let Some(v) = &d.credential_secret {
            set("credential_secret", text(v));
        }
        if let Some(v) = &d.color {
            set("color", text(v));
        }
        if let Some(t) = &d.tags {
            set("tags", text(&self.resolve_tags(t)?));
        }
        if let Some(i) = &d.icon {
            set("icon", text(&normalize_icon(i.as_deref())?));
        }
        // `group: Array.isArray(groups) ? groups[0] || null : (data.group || null)` — always written.
        set("\"group\"", text(&d.groups.as_ref().and_then(|g| g.first().cloned())));
        if let Some(f) = d.is_favorite {
            set("is_favorite", V::Integer(f as i64));
        }
        if let Some(t) = d.last_active {
            set("last_active", V::Integer(t));
        }
        values.push(V::Integer(id));
        let sql = format!("UPDATE connections SET {} WHERE id = ?{}", sets.join(", "), values.len());
        self.db.execute(&sql, rusqlite::params_from_iter(values))?;
        if let Some(g) = &d.groups {
            self.sync_group_members(id, g)?;
        }
        Ok(())
    }

    fn clear_connection_string_caches(&self, connection_string: &str) -> Result<()> {
        for table in [
            "schema_cache_meta",
            "schema_cache_schemas",
            "schema_cache_tables",
            "schema_cache_columns",
            "search_index_entries",
            "search_index_meta",
        ] {
            if self.has_table(table)? {
                self.db.execute(&format!("DELETE FROM \"{table}\" WHERE connection_string = ?1"), [connection_string])?;
            }
        }
        Ok(())
    }

    /// `removeConnection`: delete the row (and its keychain bundle).
    pub fn delete_connection(&self, id: i64) -> Result<()> {
        self.ensure_connection_tables()?;
        let existing: Option<(String, Option<String>)> = self
            .db
            .query_row("SELECT connection_string, credential_ref FROM connections WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        if let Some((cs, _)) = &existing {
            self.clear_connection_string_caches(cs).ok();
        }
        self.db.execute("DELETE FROM connection_group_members WHERE connection_id = ?1", [id])?;
        self.db.execute("DELETE FROM connections WHERE id = ?1", [id])?;
        if let Some((_, Some(reference))) = existing {
            delete_credential(&reference).context("Connection removed, but its keychain entry could not be deleted.")?;
        }
        Ok(())
    }

    /// `reorderConnections`: first id gets the highest sort_order.
    pub fn reorder_connections(&self, ordered_ids: &[i64]) -> Result<()> {
        let n = ordered_ids.len() as i64;
        for (i, id) in ordered_ids.iter().enumerate() {
            self.db.execute("UPDATE connections SET sort_order = ?1 WHERE id = ?2", params![n - i as i64, id])?;
        }
        Ok(())
    }

    /// `listConnectionGroups` (ordered by name).
    pub fn connection_groups(&self) -> Result<Vec<String>> {
        self.ensure_connection_tables()?;
        let mut stmt = self.db.prepare("SELECT name FROM connection_groups ORDER BY name ASC")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn add_connection_group(&self, name: &str) -> Result<()> {
        self.ensure_connection_tables()?;
        self.db
            .execute("INSERT INTO connection_groups(name, created_at) VALUES (?1, ?2)", params![name, now_secs()])
            .map_err(|e| anyhow!("{e}"))?;
        Ok(())
    }

    pub fn rename_connection_group(&self, old: &str, new: &str) -> Result<()> {
        self.db.execute("UPDATE connection_groups SET name = ?1 WHERE name = ?2", params![new, old])?;
        self.db.execute("UPDATE connections SET \"group\" = ?1 WHERE \"group\" = ?2", params![new, old])?;
        Ok(())
    }

    pub fn delete_connection_group(&self, name: &str) -> Result<()> {
        let gid: Option<i64> = self
            .db
            .query_row("SELECT id FROM connection_groups WHERE name = ?1", [name], |r| r.get(0))
            .optional()?;
        if let Some(gid) = gid {
            self.db.execute("DELETE FROM connection_group_members WHERE group_id = ?1", [gid])?;
        }
        self.db.execute("DELETE FROM connection_groups WHERE name = ?1", [name])?;
        Ok(())
    }

    /// `listConnectionTags` (ordered by name).
    pub fn connection_tag_library(&self) -> Result<Vec<crate::TagDef>> {
        self.ensure_connection_tables()?;
        let mut stmt = self.db.prepare("SELECT name, color FROM connection_tags ORDER BY name ASC")?;
        let rows = stmt.query_map([], |r| Ok(crate::TagDef { name: r.get(0)?, color: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn rewrite_connection_tags(&self, rename: impl Fn(&str) -> Option<String>) -> Result<()> {
        let rows: Vec<(i64, Option<String>)> = {
            let mut stmt = self.db.prepare("SELECT id, tags FROM connections")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, tags) in rows {
            let current: Vec<String> = tags.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
            if current.is_empty() {
                continue;
            }
            let next: Vec<String> = current.iter().filter_map(|t| rename(t)).collect();
            if next == current {
                continue;
            }
            self.db.execute("UPDATE connections SET tags = ?1 WHERE id = ?2", params![serialize_tags(&next), id])?;
        }
        Ok(())
    }

    /// `saveConnectionTag`: create, or rename/recolor `previous_name` (and rewrite connections).
    pub fn save_connection_tag(&self, name: &str, color: &str, previous_name: Option<&str>) -> Result<()> {
        self.ensure_connection_tables()?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 32 {
            bail!("Tag names must contain 1–32 characters.");
        }
        let color = color.trim();
        if !(color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())) {
            bail!("Tag colors must be 6-digit hex values.");
        }
        let previous = previous_name.map(str::trim).filter(|p| !p.is_empty());
        let tx = self.db.unchecked_transaction()?;
        let all = self.connection_tag_library()?;
        if let Some(clash) = all.iter().find(|t| t.name.to_lowercase() == name.to_lowercase() && Some(t.name.as_str()) != previous) {
            bail!("A tag named \"{}\" already exists.", clash.name);
        }
        match previous.filter(|p| all.iter().any(|t| t.name == *p)) {
            Some(prev) => {
                self.db.execute("UPDATE connection_tags SET name = ?1, color = ?2 WHERE name = ?3", params![name, color, prev])?;
                if prev != name {
                    let (prev, name) = (prev.to_string(), name.to_string());
                    self.rewrite_connection_tags(|t| Some(if t == prev { name.clone() } else { t.to_string() }))?;
                }
            }
            None => {
                self.db.execute(
                    "INSERT INTO connection_tags(name, color, created_at) VALUES (?1, ?2, ?3)",
                    params![name, color, now_secs()],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_connection_tag(&self, name: &str) -> Result<()> {
        let tx = self.db.unchecked_transaction()?;
        self.db.execute("DELETE FROM connection_tags WHERE name = ?1", [name])?;
        self.rewrite_connection_tags(|t| (t != name).then(|| t.to_string()))?;
        tx.commit()?;
        Ok(())
    }

    /// `getStoredUserProfile()`: the newest `users` row (name, email).
    pub fn stored_user_profile(&self) -> Result<Option<(Option<String>, Option<String>)>> {
        if !self.has_table("users")? {
            return Ok(None);
        }
        Ok(self
            .db
            .query_row("SELECT name, email FROM users ORDER BY created_at DESC LIMIT 1", [], |r| {
                Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .optional()?)
    }
}

// ---- credentials ----------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CredentialBundle {
    pub connection_string: Option<String>,
    pub password: Option<String>,
    pub auth_token: Option<String>,
}

impl CredentialBundle {
    fn to_json(&self) -> String {
        serde_json::json!({
            "connectionString": self.connection_string,
            "password": self.password,
            "authToken": self.auth_token,
        })
        .to_string()
    }
}

fn entry(reference: &str) -> Result<keyring::Entry> {
    if reference.is_empty() || reference.len() > 80 || !reference.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        bail!("Invalid credential reference");
    }
    keyring::Entry::new(&keychain_service(), reference).map_err(|e| anyhow!("Could not access the operating-system keychain: {e}"))
}

/// `storeKeychainBundle`: write then verify.
fn store_keychain_bundle(reference: &str, value: &str, remove_on_failure: bool) -> Result<()> {
    let attempt = (|| -> Result<()> {
        let e = entry(reference)?;
        e.set_password(value)?;
        if e.get_password()? != value {
            bail!("Keychain verification failed.");
        }
        Ok(())
    })();
    if attempt.is_err() {
        if remove_on_failure {
            delete_credential(reference).ok();
        }
        bail!("Could not save and verify credentials in the system keychain. Your connection has not been saved. Unlock the keychain or choose Encrypted vault in Settings → Security and retry.");
    }
    Ok(())
}

pub fn read_bundle(reference: &str) -> Result<CredentialBundle> {
    let raw = entry(reference)?.get_password()?;
    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| anyhow!("Could not unlock saved credentials: the stored credential bundle is invalid."))?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Ok(CredentialBundle { connection_string: s("connectionString"), password: s("password"), auth_token: s("authToken") })
}

/// Store a provider account token in the system keychain and return its opaque reference.
pub fn store_account_token(token: &str) -> Result<String> {
    let reference = uuid::Uuid::new_v4().simple().to_string();
    let bundle = CredentialBundle { connection_string: None, password: None, auth_token: Some(token.to_string()) };
    store_keychain_bundle(&reference, &bundle.to_json(), true)?;
    Ok(reference)
}

/// Resolve an opaque account-token reference from the system keychain.
pub fn read_account_token(reference: &str) -> Result<String> {
    read_bundle(reference)?.auth_token.ok_or_else(|| anyhow!("The saved provider token is missing from the system keychain."))
}

/// `deleteConnectionCredential` (vault refs live in the row, nothing to delete).
pub fn delete_credential(reference: &str) -> Result<()> {
    if reference.starts_with("vault:") {
        return Ok(());
    }
    match entry(reference)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!("Could not remove credentials from the operating-system keychain: {e}")),
    }
}

/// `protectConnectionPayload`.
pub fn protect_payload(
    mut d: ConnectionDraft,
    mode: &CredentialStorageMode,
    stored: Option<&CredentialBundle>,
    vault: Option<&Vault>,
) -> Result<ConnectionDraft> {
    let cs = d.connection_string.clone().unwrap_or_default();
    let password = d.password.clone().flatten().filter(|p| !p.is_empty());
    let token = d.auth_token.clone().flatten().filter(|p| !p.is_empty());
    if !has_connection_secret(&cs, password.as_deref(), token.as_deref()) {
        if matches!(d.credential_ref, Some(None)) {
            d.password = Some(None);
            d.auth_token = Some(None);
            return Ok(d);
        }
        // A new passwordless target alongside the old reference: the stored bundle is stale.
        if let (Some(Some(_)), Some(new_cs), Some(stored_cs)) =
            (&d.credential_ref, &d.connection_string, stored.and_then(|b| b.connection_string.as_ref()))
        {
            if redacted_target_for_comparison(stored_cs) != redacted_target_for_comparison(new_cs) {
                d.credential_ref = Some(None);
                d.password = Some(None);
                d.auth_token = Some(None);
            }
        }
        // Empty field values must not overwrite secrets held by the reference.
        if d.password.as_ref().is_some_and(|p| p.as_deref().unwrap_or("").is_empty()) {
            d.password = None;
        }
        if d.auth_token.as_ref().is_some_and(|p| p.as_deref().unwrap_or("").is_empty()) {
            d.auth_token = None;
        }
        return Ok(d);
    }
    match mode {
        CredentialStorageMode::Plaintext => {
            d.credential_ref = Some(None);
            d.credential_secret = Some(None);
            Ok(d)
        }
        CredentialStorageMode::Vault => {
            let vault = vault.ok_or_else(|| anyhow!("Unlock the encrypted credential vault before saving this connection."))?;
            let bundle = CredentialBundle { connection_string: d.connection_string.clone(), password, auth_token: token };
            let reference = format!("vault:{}", uuid::Uuid::new_v4());
            let envelope = vault.encrypt(&reference, &bundle.to_json())?;
            if !valid_vault_envelope(&envelope) { bail!("Could not validate encrypted vault entry."); }
            d.connection_string = d.connection_string.map(|s| strip_connection_secrets(&s));
            d.password = Some(None);
            d.auth_token = Some(None);
            d.credential_ref = Some(Some(reference));
            d.credential_secret = Some(Some(envelope));
            Ok(d)
        }
        CredentialStorageMode::Keychain => {
            let bundle = CredentialBundle { connection_string: d.connection_string.clone(), password: password.clone(), auth_token: token.clone() };
            let reference = uuid::Uuid::new_v4().to_string();
            store_keychain_bundle(&reference, &bundle.to_json(), true)?;
            d.connection_string = d.connection_string.map(|s| strip_connection_secrets(&s));
            d.password = Some(None);
            d.auth_token = Some(None);
            d.credential_ref = Some(Some(reference));
            d.credential_secret = Some(None);
            Ok(d)
        }
    }
}

fn valid_vault_envelope(envelope: &str) -> bool {
    let mut parts = envelope.split('.');
    matches!((parts.next(), parts.next(), parts.next(), parts.next()), (Some("v1"), Some(n), Some(c), None)
        if base64::Engine::decode(&base64::engine::general_purpose::STANDARD, n).is_ok_and(|b| b.len() == 12)
        && base64::Engine::decode(&base64::engine::general_purpose::STANDARD, c).is_ok_and(|b| b.len() >= 16))
}

const SECRET_KEYS: &[&str] = &[
    "password", "passwd", "pwd", "pass", "token", "authtoken", "auth_token", "auth-token", "accesstoken",
    "access_token", "access-token", "refreshtoken", "refresh_token", "refresh-token", "apikey", "api_key",
    "api-key", "apitoken", "api_token", "api-token", "secret", "clientsecret", "client_secret",
    "client-secret", "privatekey", "private_key", "private-key", "bearer", "credential",
];

fn is_secret_key(key: &str) -> bool {
    let k = percent_decode(key).to_ascii_lowercase();
    SECRET_KEYS.contains(&k.as_str())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Split `scheme://userinfo@rest` → (prefix up to `//`, userinfo, rest).
fn split_authority(value: &str) -> Option<(&str, Option<&str>, &str)> {
    let sep = value.find("://")?;
    let after = &value[sep + 3..];
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let authority = &after[..end];
    match authority.rfind('@') {
        Some(at) => Some((&value[..sep + 3], Some(&authority[..at]), &value[sep + 3 + at + 1..])),
        None => Some((&value[..sep + 3], None, after)),
    }
}

/// `hasConnectionSecret`.
pub fn has_connection_secret(cs: &str, password: Option<&str>, auth_token: Option<&str>) -> bool {
    if password.is_some_and(|p| !p.is_empty()) || auth_token.is_some_and(|t| !t.is_empty()) {
        return true;
    }
    if let Some((_, Some(userinfo), _)) = split_authority(cs) {
        if userinfo.split_once(':').is_some_and(|(_, p)| !p.is_empty()) {
            return true;
        }
    }
    if cs.to_ascii_lowercase().starts_with("jdbc:oracle:thin:") && cs.contains('/') && cs.contains('@') {
        let rest = &cs[17..];
        if let (Some(slash), Some(at)) = (rest.find('/'), rest.find('@')) {
            if slash < at {
                return true;
            }
        }
    }
    if cs.split(';').skip(1).any(|part| is_secret_key(part.split('=').next().unwrap_or(""))) {
        return true;
    }
    query_pairs(cs).iter().any(|(k, _)| is_secret_key(k))
}

fn query_pairs(cs: &str) -> Vec<(String, String)> {
    let before_hash = cs.split('#').next().unwrap_or("");
    let Some((_, q)) = before_hash.split_once('?') else { return Vec::new() };
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (k.to_string(), v.to_string()),
            None => (p.to_string(), String::new()),
        })
        .collect()
}

/// `stripConnectionSecrets`: drop the URL password and secret-named query/`;` parameters.
pub fn strip_connection_secrets(value: &str) -> String {
    let mut out = value.to_string();
    if let Some((prefix, Some(userinfo), rest)) = split_authority(value) {
        if let Some((user, _)) = userinfo.split_once(':') {
            out = format!("{prefix}{user}@{rest}");
        }
    }
    // query parameters
    let (before_hash, hash) = match out.find('#') {
        Some(i) => (out[..i].to_string(), out[i..].to_string()),
        None => (out.clone(), String::new()),
    };
    let (base, query) = match before_hash.split_once('?') {
        Some((b, q)) => (b.to_string(), Some(q.to_string())),
        None => (before_hash.clone(), None),
    };
    let base: String = {
        // `;key=value` segments (SQL Server / JDBC styles)
        let mut parts = base.split(';');
        let head = parts.next().unwrap_or("").to_string();
        let kept: Vec<&str> = parts.filter(|p| !is_secret_key(p.split('=').next().unwrap_or(""))).collect();
        if kept.is_empty() { head } else { format!("{head};{}", kept.join(";")) }
    };
    let query = query.map(|q| {
        q.split('&')
            .filter(|p| !p.is_empty() && !is_secret_key(p.split('=').next().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("&")
    });
    let mut result = match query.filter(|q| !q.is_empty()) {
        Some(q) => format!("{base}?{q}{hash}"),
        None => format!("{base}{hash}"),
    };
    // jdbc:oracle:thin:user/password@host → jdbc:oracle:thin:user@host
    if result.to_ascii_lowercase().starts_with("jdbc:oracle:thin:") {
        let rest = result[17..].to_string();
        if let (Some(slash), Some(at)) = (rest.find('/'), rest.find('@')) {
            if slash < at {
                result = format!("{}{}{}", &result[..17], &rest[..slash], &rest[at..]);
            }
        }
    }
    result
}

/// `redactedTargetForComparison`: secrets and client-only params stripped, params sorted, default ports dropped.
pub fn redacted_target_for_comparison(value: &str) -> String {
    let stripped = strip_connection_secrets(value);
    let (base, query) = match stripped.split_once('?') {
        Some((b, q)) => (b.to_string(), Some(q.to_string())),
        None => (stripped.clone(), None),
    };
    let scheme = base.split("://").next().unwrap_or("").to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "postgresql" | "postgres" => Some("5432"),
        "mysql" | "mariadb" => Some("3306"),
        "mongodb" => Some("27017"),
        "redis" | "rediss" => Some("6379"),
        "sqlserver" | "mssql" => Some("1433"),
        _ => None,
    };
    let base = match default_port {
        Some(p) => {
            let needle = format!(":{p}");
            match split_authority(&base) {
                Some((prefix, userinfo, rest)) => {
                    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
                    let host = rest[..end].strip_suffix(needle.as_str()).unwrap_or(&rest[..end]);
                    format!("{prefix}{}{host}{}", userinfo.map(|u| format!("{u}@")).unwrap_or_default(), &rest[end..])
                }
                None => base,
            }
        }
        None => base,
    };
    let mut params: Vec<&str> = query
        .as_deref()
        .map(|q| q.split('&').filter(|p| {
            let k = p.split('=').next().unwrap_or("").to_ascii_lowercase();
            !p.is_empty() && k != "jarpaths" && k != "driverclass"
        }).collect())
        .unwrap_or_default();
    params.sort();
    if params.is_empty() { base } else { format!("{base}?{}", params.join("&")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_and_detects_secrets() {
        assert!(has_connection_secret("postgresql://u:p@h:5432/db", None, None));
        assert!(!has_connection_secret("postgresql://u@h:5432/db?sslmode=require", None, None));
        assert!(has_connection_secret("libsql://x.turso.io?authToken=abc", None, None));
        assert!(has_connection_secret("x", Some("pw"), None));
        assert_eq!(strip_connection_secrets("postgresql://u:p%40@h:5432/db?sslmode=require&password=x"), "postgresql://u@h:5432/db?sslmode=require");
        assert_eq!(strip_connection_secrets("libsql://x.turso.io?authToken=abc"), "libsql://x.turso.io");
        assert_eq!(
            redacted_target_for_comparison("postgresql://u:p@h:5432/db?b=1&a=2"),
            redacted_target_for_comparison("postgresql://u@h/db?a=2&b=1"),
        );
        assert_ne!(redacted_target_for_comparison("postgresql://u@h/db"), redacted_target_for_comparison("postgresql://u@h/other"));
    }

    #[test]
    fn crud_round_trip_in_a_scratch_database() {
        let dir = std::env::temp_dir().join(format!("rexa-store-test-{}", now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = rusqlite::Connection::open(dir.join("sqlite.db")).unwrap();
        let store = Store { db };
        // Plaintext path never touches the keychain.
        store.set_setting_raw("rexadb:credential-storage-mode", "plaintext");
        store.add_connection_group("Work").unwrap();
        let id = store
            .create_connection(ConnectionDraft {
                name: Some("Local".into()),
                connection_string: Some("postgresql://me@localhost:5432/app".into()),
                connection_type: Some("postgresql".into()),
                tags: Some(vec!["staging".into()]),
                groups: Some(vec!["Work".into()]),
                ..Default::default()
            })
            .unwrap();
        let rows = store.connection_rows().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].groups, vec!["Work".to_string()]);
        assert_eq!(rows[0].conn.tags, vec!["staging".to_string()]);
        assert_eq!(store.connection_tag_library().unwrap()[0].color, "#f59e0b");
        store.update_connection(id, ConnectionDraft { is_favorite: Some(true), name: Some("Renamed".into()), ..Default::default() }).unwrap();
        let row = &store.connection_rows().unwrap()[0];
        assert!(row.conn.is_favorite);
        assert_eq!(row.conn.name, "Renamed");
        assert_eq!(row.groups, vec!["Work".to_string()], "members are untouched without `groups`");
        store.save_connection_tag("prod", "#ef4444", Some("staging")).unwrap();
        assert_eq!(store.connection_rows().unwrap()[0].conn.tags, vec!["prod".to_string()]);
        store.delete_connection_tag("prod").unwrap();
        assert!(store.connection_rows().unwrap()[0].conn.tags.is_empty());
        store.delete_connection(id).unwrap();
        assert!(store.connection_rows().unwrap().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    impl Store {
        fn set_setting_raw(&self, key: &str, value: &str) {
            self.db
                .execute_batch("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)")
                .unwrap();
            self.set_setting(key, value).unwrap();
        }
    }
}
