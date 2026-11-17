//! Port of the query-history / snippet / folder persistence the SQL editor
//! uses: lib/db/studio-storage-crud.ts (`getStudioHistory`,
//! `insertHistoryEntry`, `clearStudioHistory`), lib/db/actions-core.ts
//! (`getStudioFolders`, `saveStudioFolders`, `getStudioSnippets`,
//! `saveStudioSnippets`, `createSnippetVersion`, `getSnippetVersions`,
//! `restoreSnippetVersion`) and the table definitions of
//! lib/db/ensure-core-tables.ts. Same `sqlite.db` tables and semantics, so
//! both apps share history and snippets.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Clone, Debug, PartialEq)]
pub struct HistoryEntry {
    pub id: String,
    pub connection_id: Option<i64>,
    pub query: String,
    pub executed_at: i64,
    pub duration: i64,
    /// "success" | "error"
    pub status: String,
    pub error: Option<String>,
    pub rows_count: Option<i64>,
    /// "user" | "system"
    pub caller: String,
    pub executed_by: Option<String>,
    pub executed_by_name: Option<String>,
    pub params: Option<String>,
    pub connection_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub query: String,
    pub folder_id: Option<String>,
    pub created_at: i64,
    pub is_shared: bool,
    pub shared_entry_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnippetVersion {
    pub id: String,
    pub snippet_id: String,
    pub name: String,
    pub query: String,
    pub version_number: i64,
    pub created_at: i64,
}

pub fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// `Math.random().toString(36).substring(2, 2 + len)`.
pub fn random_id(len: usize) -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| ALPHABET[rng.gen_range(0..36)] as char).collect()
}

/// use-studio's `uid()` (7 base-36 chars).
pub fn uid() -> String {
    random_id(7)
}

pub struct SqlStore {
    db: Connection,
}

impl SqlStore {
    pub fn open() -> Result<Self> {
        let path = rexa_store::Store::database_path();
        Self::open_path(&path).with_context(|| format!("opening {}", path.display()))
    }

    pub fn open_path(path: &std::path::Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        let store = SqlStore { db };
        store.ensure_tables()?;
        Ok(store)
    }

    /// The subset of `ensureCoreTables` these tables need (create when missing,
    /// add the columns later versions introduced).
    fn ensure_tables(&self) -> Result<()> {
        self.db.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
               id TEXT PRIMARY KEY NOT NULL,
               connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
               name TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               parent_id TEXT);
             CREATE TABLE IF NOT EXISTS snippets (
               id TEXT PRIMARY KEY NOT NULL,
               connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
               folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
               name TEXT NOT NULL,
               query TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               is_shared INTEGER NOT NULL DEFAULT 0,
               shared_entry_id TEXT);
             CREATE TABLE IF NOT EXISTS snippet_versions (
               id TEXT PRIMARY KEY NOT NULL,
               snippet_id TEXT NOT NULL,
               name TEXT NOT NULL,
               query TEXT NOT NULL,
               version_number INTEGER NOT NULL,
               created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS query_history (
               id TEXT PRIMARY KEY NOT NULL,
               connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
               query TEXT NOT NULL,
               executed_at INTEGER NOT NULL,
               duration INTEGER NOT NULL,
               status TEXT NOT NULL,
               error TEXT,
               rows_count INTEGER,
               caller TEXT NOT NULL,
               executed_by TEXT,
               executed_by_name TEXT,
               params TEXT);",
        )?;
        for (table, column, ddl) in [
            ("query_history", "executed_by", "ALTER TABLE query_history ADD COLUMN executed_by TEXT"),
            ("query_history", "executed_by_name", "ALTER TABLE query_history ADD COLUMN executed_by_name TEXT"),
            ("query_history", "params", "ALTER TABLE query_history ADD COLUMN params TEXT"),
            ("folders", "parent_id", "ALTER TABLE folders ADD COLUMN parent_id TEXT"),
            ("snippets", "folder_id", "ALTER TABLE snippets ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL"),
            ("snippets", "is_shared", "ALTER TABLE snippets ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0"),
            ("snippets", "shared_entry_id", "ALTER TABLE snippets ADD COLUMN shared_entry_id TEXT"),
        ] {
            let exists: i64 = self.db.query_row(
                &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
                [column],
                |r| r.get(0),
            )?;
            if exists == 0 {
                self.db.execute(ddl, [])?;
            }
        }
        Ok(())
    }

    // ---- history -------------------------------------------------------------

    /// `getStudioHistory`: oldest first (the view reverses it).
    pub fn history(&self, connection_id: i64) -> Result<Vec<HistoryEntry>> {
        let mut stmt = self.db.prepare(
            "SELECT h.id, h.connection_id, h.query, h.executed_at, h.duration, h.status, h.error, h.rows_count,
                    h.caller, h.executed_by, h.executed_by_name, h.params, c.name
             FROM query_history h LEFT JOIN connections c ON c.id = h.connection_id
             WHERE h.connection_id = ?1 ORDER BY h.executed_at ASC",
        )?;
        let rows = stmt.query_map([connection_id], |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                connection_id: r.get(1)?,
                query: r.get(2)?,
                executed_at: r.get(3)?,
                duration: r.get(4)?,
                status: r.get(5)?,
                error: r.get(6)?,
                rows_count: r.get(7)?,
                caller: r.get(8)?,
                executed_by: r.get(9)?,
                executed_by_name: r.get(10)?,
                params: r.get(11)?,
                connection_name: r.get(12)?,
            })
        });
        // A missing `connections` table (fresh test DBs) shouldn't break history.
        match rows {
            Ok(rows) => Ok(rows.collect::<rusqlite::Result<_>>()?),
            Err(e) => Err(e.into()),
        }
    }

    /// `insertHistoryEntry` (`skipDuplicates`).
    pub fn insert_history(&self, connection_id: i64, e: &HistoryEntry) -> Result<()> {
        self.db.execute(
            "INSERT OR IGNORE INTO query_history
               (id, connection_id, query, executed_at, duration, status, error, rows_count, caller,
                executed_by, executed_by_name, params)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                e.id,
                connection_id,
                e.query,
                e.executed_at,
                e.duration,
                e.status,
                e.error,
                e.rows_count,
                e.caller,
                e.executed_by,
                e.executed_by_name,
                e.params
            ],
        )?;
        Ok(())
    }

    /// `clearStudioHistory`
    pub fn clear_history(&self, connection_id: i64) -> Result<()> {
        self.db.execute("DELETE FROM query_history WHERE connection_id = ?1", [connection_id])?;
        Ok(())
    }

    // ---- folders -------------------------------------------------------------

    pub fn folders(&self, connection_id: i64) -> Result<Vec<Folder>> {
        let mut stmt =
            self.db.prepare("SELECT id, name, parent_id, created_at FROM folders WHERE connection_id = ?1 ORDER BY rowid")?;
        let rows = stmt.query_map([connection_id], |r| {
            Ok(Folder { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)?, created_at: r.get(3)? })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// `saveStudioFolders`: replace the connection's folders.
    pub fn save_folders(&mut self, connection_id: i64, folders: &[Folder]) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM folders WHERE connection_id = ?1", [connection_id])?;
        // Dedupe keeps the last occurrence (Map semantics) but insertion order of first.
        let mut last: std::collections::HashMap<&str, &Folder> = std::collections::HashMap::new();
        for f in folders.iter().filter(|f| !f.id.is_empty() && !f.name.is_empty()) {
            last.insert(&f.id, f);
        }
        let mut inserted = std::collections::HashSet::new();
        for f in folders.iter().filter(|f| !f.id.is_empty() && !f.name.is_empty()) {
            if !inserted.insert(f.id.as_str()) {
                continue;
            }
            let f = last[f.id.as_str()];
            tx.execute(
                "INSERT INTO folders (id, connection_id, parent_id, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![f.id, connection_id, f.parent_id, f.name, f.created_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- snippets ------------------------------------------------------------

    pub fn snippets(&self, connection_id: i64) -> Result<Vec<Snippet>> {
        let mut stmt = self.db.prepare(
            "SELECT id, name, query, folder_id, created_at, COALESCE(is_shared, 0), shared_entry_id
             FROM snippets WHERE connection_id = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([connection_id], |r| {
            Ok(Snippet {
                id: r.get(0)?,
                name: r.get(1)?,
                query: r.get(2)?,
                folder_id: r.get(3)?,
                created_at: r.get(4)?,
                is_shared: r.get::<_, i64>(5)? != 0,
                shared_entry_id: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// `saveStudioSnippets`: replace the connection's snippets (unknown folder
    /// ids become NULL; versions of removed snippets are pruned).
    pub fn save_snippets(&mut self, connection_id: i64, snippets: &[Snippet]) -> Result<()> {
        let folder_ids: std::collections::HashSet<String> =
            self.folders(connection_id)?.into_iter().map(|f| f.id).collect();
        let existing: Vec<String> = {
            let mut stmt = self.db.prepare("SELECT id FROM snippets WHERE connection_id = ?1")?;
            let rows = stmt.query_map([connection_id], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let valid: Vec<&Snippet> =
            snippets.iter().filter(|s| !s.id.is_empty() && !s.name.is_empty() && !s.query.is_empty()).collect();
        let mut last: std::collections::HashMap<&str, &Snippet> = std::collections::HashMap::new();
        for s in &valid {
            last.insert(&s.id, s);
        }
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM snippets WHERE connection_id = ?1", [connection_id])?;
        let mut inserted = std::collections::HashSet::new();
        for s in &valid {
            if !inserted.insert(s.id.as_str()) {
                continue;
            }
            let s = last[s.id.as_str()];
            let folder = s.folder_id.clone().filter(|f| folder_ids.contains(f));
            tx.execute(
                "INSERT INTO snippets (id, connection_id, name, query, folder_id, created_at, is_shared, shared_entry_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![s.id, connection_id, s.name, s.query, folder, s.created_at, s.is_shared as i64, s.shared_entry_id],
            )?;
        }
        for id in existing.iter().filter(|id| !inserted.contains(id.as_str())) {
            tx.execute("DELETE FROM snippet_versions WHERE snippet_id = ?1", [id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// `createSnippetVersion`
    pub fn create_snippet_version(&self, snippet_id: &str, name: &str, query: &str) -> Result<SnippetVersion> {
        let latest: Option<i64> = self
            .db
            .query_row("SELECT MAX(version_number) FROM snippet_versions WHERE snippet_id = ?1", [snippet_id], |r| r.get(0))
            .optional()?
            .flatten();
        let v = SnippetVersion {
            id: random_id(9),
            snippet_id: snippet_id.into(),
            name: name.into(),
            query: query.into(),
            version_number: latest.map_or(1, |n| n + 1),
            created_at: now_millis(),
        };
        self.db.execute(
            "INSERT INTO snippet_versions (id, snippet_id, name, query, version_number, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![v.id, v.snippet_id, v.name, v.query, v.version_number, v.created_at],
        )?;
        Ok(v)
    }

    /// `getSnippetVersions`: newest first.
    pub fn snippet_versions(&self, snippet_id: &str) -> Result<Vec<SnippetVersion>> {
        let mut stmt = self.db.prepare(
            "SELECT id, snippet_id, name, query, version_number, created_at FROM snippet_versions
             WHERE snippet_id = ?1 ORDER BY version_number DESC",
        )?;
        let rows = stmt.query_map([snippet_id], |r| {
            Ok(SnippetVersion {
                id: r.get(0)?,
                snippet_id: r.get(1)?,
                name: r.get(2)?,
                query: r.get(3)?,
                version_number: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// `restoreSnippetVersion`: prune newer versions, copy the version into the
    /// snippet. Returns the restored (name, query).
    pub fn restore_snippet_version(&self, snippet_id: &str, version_id: &str) -> Result<(String, String)> {
        let versions = self.snippet_versions(snippet_id)?;
        let version = versions.iter().find(|v| v.id == version_id).context("Version not found")?;
        self.db.execute(
            "DELETE FROM snippet_versions WHERE snippet_id = ?1 AND version_number > ?2",
            params![snippet_id, version.version_number],
        )?;
        let n = self.db.execute(
            "UPDATE snippets SET name = ?1, query = ?2 WHERE id = ?3",
            params![version.name, version.query, snippet_id],
        )?;
        anyhow::ensure!(n > 0, "Snippet not found");
        Ok((version.name.clone(), version.query.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> SqlStore {
        let dir = std::env::temp_dir().join(format!("rexa-sql-store-{}", random_id(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let s = SqlStore::open_path(&dir.join("sqlite.db")).unwrap();
        s.db.execute_batch("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO connections VALUES (1, 'local');")
            .unwrap();
        s
    }

    #[test]
    fn history_round_trip() {
        let s = temp_store();
        let e = HistoryEntry {
            id: uid(),
            connection_id: Some(1),
            query: "select 1".into(),
            executed_at: 5,
            duration: 3,
            status: "success".into(),
            error: None,
            rows_count: Some(1),
            caller: "user".into(),
            executed_by: Some("local".into()),
            executed_by_name: Some("Local".into()),
            params: None,
            connection_name: None,
        };
        s.insert_history(1, &e).unwrap();
        s.insert_history(1, &e).unwrap();
        let h = s.history(1).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].connection_name.as_deref(), Some("local"));
        s.clear_history(1).unwrap();
        assert!(s.history(1).unwrap().is_empty());
    }

    #[test]
    fn snippets_and_versions() {
        let mut s = temp_store();
        let f = Folder { id: "f1".into(), name: "F".into(), parent_id: None, created_at: 1 };
        s.save_folders(1, &[f]).unwrap();
        let sn = Snippet {
            id: "s1".into(),
            name: "A".into(),
            query: "select 1".into(),
            folder_id: Some("nope".into()),
            created_at: 1,
            is_shared: false,
            shared_entry_id: None,
        };
        s.save_snippets(1, &[sn.clone()]).unwrap();
        assert_eq!(s.snippets(1).unwrap()[0].folder_id, None);
        let v1 = s.create_snippet_version("s1", "A", "select 1").unwrap();
        let v2 = s.create_snippet_version("s1", "A", "select 2").unwrap();
        assert_eq!((v1.version_number, v2.version_number), (1, 2));
        assert_eq!(s.restore_snippet_version("s1", &v1.id).unwrap().1, "select 1");
        assert_eq!(s.snippet_versions("s1").unwrap().len(), 1);
        s.save_snippets(1, &[]).unwrap();
        assert!(s.snippet_versions("s1").unwrap().is_empty());
    }
}
