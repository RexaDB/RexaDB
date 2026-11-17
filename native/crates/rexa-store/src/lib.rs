//! Access to the RexaDB app database (`sqlite.db`) shared with the existing
//! desktop app, plus credential resolution (system keychain / encrypted vault).

mod connection_writes;
mod credentials;
mod paths;
mod webstore;

pub use connection_writes::{
    delete_credential, has_connection_secret, now_secs, protect_payload, read_bundle,
    redacted_target_for_comparison, strip_connection_secrets, ConnectionDraft, ConnectionRow,
    CredentialBundle, CredentialStorageMode,
};
pub use credentials::{resolve_credentials, ResolvedCredentials, Vault};
pub use paths::app_data_dir;
pub use webstore::WebStore;

use anyhow::{Context, Result};
use rusqlite::{Connection as Sqlite, OpenFlags};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct SavedConnection {
    pub id: i64,
    pub name: String,
    /// Connection string with secrets stripped (secrets live behind `credential_ref`).
    pub connection_string: String,
    pub kind: String,
    pub environment: Option<String>,
    pub color: Option<String>,
    pub group: Option<String>,
    pub is_favorite: bool,
    pub host: Option<String>,
    pub port: Option<String>,
    pub database: Option<String>,
    pub username: Option<String>,
    /// Legacy plaintext password column (pre-keychain rows).
    pub password: Option<String>,
    pub auth_token: Option<String>,
    pub credential_ref: Option<String>,
    pub credential_secret: Option<String>,
    pub tags: Vec<String>,
    /// `emoji:<char>` or `image:<data url>`.
    pub icon: Option<String>,
    pub last_active: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct TagDef {
    pub name: String,
    pub color: String,
}

pub struct Store {
    db: Sqlite,
}

impl Store {
    pub fn database_path() -> PathBuf {
        app_data_dir().join("sqlite.db")
    }

    pub fn open() -> Result<Self> {
        let path = Self::database_path();
        let db = Sqlite::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .with_context(|| format!("opening {}", path.display()))?;
        // The Bun sidecar may hold the same file open; WAL + a busy timeout lets both coexist.
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { db })
    }

    pub fn connections(&self) -> Result<Vec<SavedConnection>> {
        if !self.has_table("connections")? {
            return Ok(Vec::new());
        }
        let mut stmt = self.db.prepare(
            r#"SELECT id, name, connection_string, COALESCE(connection_type, ''), environment, color,
                      "group", COALESCE(is_favorite, 0), host, port, database, username, password,
                      auth_token, credential_ref, credential_secret, tags, icon, last_active
               FROM connections
               ORDER BY COALESCE(sort_order, id), id"#,
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SavedConnection {
                id: r.get(0)?,
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
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn touch_connection(&self, id: i64) -> Result<()> {
        self.db
            .execute("UPDATE connections SET last_active = ?1 WHERE id = ?2", (now_millis(), id))?;
        Ok(())
    }

    /// The connection tag library (name → color).
    pub fn tag_library(&self) -> Result<Vec<TagDef>> {
        if !self.has_table("connection_tags")? {
            return Ok(Vec::new());
        }
        let mut stmt = self.db.prepare("SELECT name, color FROM connection_tags ORDER BY id")?;
        let rows = stmt.query_map([], |r| Ok(TagDef { name: r.get(0)?, color: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        if !self.has_table("app_settings")? {
            return Ok(None);
        }
        let mut stmt = self.db.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        Ok(match rows.next()? {
            Some(r) => r.get(0)?,
            None => None,
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, now_millis()),
        )?;
        Ok(())
    }

    /// Salt + verifier for the passphrase vault, if the user ever set one up.
    pub fn vault_config(&self) -> Result<Option<(String, String)>> {
        if !self.has_table("credential_vault")? {
            return Ok(None);
        }
        let mut stmt = self
            .db
            .prepare("SELECT salt, verifier FROM credential_vault WHERE id = 1")?;
        let mut rows = stmt.query([])?;
        Ok(match rows.next()? {
            Some(r) => Some((r.get(0)?, r.get(1)?)),
            None => None,
        })
    }

    fn has_table(&self, name: &str) -> Result<bool> {
        Ok(self.db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )? > 0)
    }
}

/// Read-only handle, for opening the store without the risk of writes (tests, tooling).
pub fn open_read_only() -> Result<Store> {
    let db = Sqlite::open_with_flags(Store::database_path(), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(Store { db })
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}
