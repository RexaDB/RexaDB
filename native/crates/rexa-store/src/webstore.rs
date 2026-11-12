//! Read-only access to the old app's WebKit `localStorage` (Tauri WKWebView),
//! which holds UI state the sidecar never saw: provider accounts, the user
//! avatar, open tabs, layout prefs. Values are stored as UTF-16LE blobs.

use anyhow::Result;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;

pub struct WebStore {
    db: Connection,
}

impl WebStore {
    pub fn open() -> Option<Self> {
        let path = Self::find()?;
        let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        Some(Self { db })
    }

    fn find() -> Option<PathBuf> {
        let root = dirs::home_dir()?.join("Library/WebKit/com.rexadb/WebsiteData/Default");
        // Layout: Default/<origin hash>/<origin hash>/LocalStorage/localstorage.sqlite3
        for a in std::fs::read_dir(&root).ok()?.flatten() {
            let Ok(inner) = std::fs::read_dir(a.path()) else { continue }; // skip files like `salt`
            for b in inner.flatten() {
                let candidate = b.path().join("LocalStorage/localstorage.sqlite3");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
        None
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.db.prepare("SELECT value FROM ItemTable WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        let Some(row) = rows.next()? else { return Ok(None) };
        let bytes: Vec<u8> = row.get(0)?;
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Ok(Some(String::from_utf16_lossy(&units)))
    }

    pub fn get_json(&self, key: &str) -> Option<serde_json::Value> {
        serde_json::from_str(&self.get(key).ok()??).ok()
    }
}
