//! Settings-area writes the settings crate needs beyond `setting`/`set_setting`:
//! deleting keys, the global AI settings row, the MCP server config row, and the
//! per-connection workspace wipe used by Settings → Danger Zone → Reset Everything
//! (danger-zone-setting.tsx: saveStudioTabs/Folders/Snippets/History/Tags(id, []),
//! saveStudioDashboards(id, {dashboards: [], folders: []}), saveStudioNotes(id, {notes: []})).

use crate::{now_millis, Store};
use anyhow::Result;
use rusqlite::OptionalExtension;

impl Store {
    /// `DELETE FROM app_settings WHERE key = ?`.
    pub fn delete_setting(&self, key: &str) -> Result<()> {
        if self.has_table("app_settings")? {
            self.db.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
        }
        Ok(())
    }

    /// All `app_settings` keys (Reset Everything clears migrated `rexa-db-*` localStorage keys).
    pub fn setting_keys(&self) -> Result<Vec<String>> {
        if !self.has_table("app_settings")? {
            return Ok(Vec::new());
        }
        let mut stmt = self.db.prepare("SELECT key FROM app_settings")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// `user_ai_settings.settings_json` for `user_id = 'global'` (getGlobalAiSettings).
    pub fn global_ai_settings_json(&self) -> Result<Option<String>> {
        if !self.has_table("user_ai_settings")? {
            return Ok(None);
        }
        Ok(self
            .db
            .query_row("SELECT settings_json FROM user_ai_settings WHERE user_id = 'global'", [], |r| r.get(0))
            .optional()?)
    }

    /// saveGlobalAiSettings: upsert the `global` row (caller passes the normalized JSON).
    pub fn save_global_ai_settings_json(&self, json: &str) -> Result<()> {
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS user_ai_settings (user_id TEXT PRIMARY KEY NOT NULL, settings_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
            [],
        )?;
        self.db.execute(
            "INSERT INTO user_ai_settings(user_id, settings_json, updated_at) VALUES ('global', ?1, ?2)
             ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
            (json, now_millis()),
        )?;
        Ok(())
    }

    /// `mcp_server_config.config_json` (id = 1).
    pub fn mcp_config_json(&self) -> Result<Option<String>> {
        if !self.has_table("mcp_server_config")? {
            return Ok(None);
        }
        Ok(self.db.query_row("SELECT config_json FROM mcp_server_config WHERE id = 1", [], |r| r.get(0)).optional()?)
    }

    pub fn save_mcp_config_json(&self, json: &str) -> Result<()> {
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS mcp_server_config (id INTEGER PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
            [],
        )?;
        self.db.execute(
            "INSERT INTO mcp_server_config(id, config_json, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
            (json, now_millis()),
        )?;
        Ok(())
    }

    /// Reset Everything, step 2, for one connection. Each table is optional
    /// (older databases may lack some); returns the labels of failed steps.
    pub fn clear_connection_workspace(&self, connection_id: i64) -> Vec<(String, String)> {
        let mut failures = Vec::new();
        let mut run = |label: &str, table: &str, sql: &str, with_time: bool| {
            if !self.has_table(table).unwrap_or(false) {
                return;
            }
            let res = if with_time {
                self.db.execute(sql, (connection_id, now_millis()))
            } else {
                self.db.execute(sql, [connection_id])
            };
            if let Err(e) = res {
                failures.push((label.to_string(), e.to_string()));
            }
        };
        run("Tabs", "open_tabs", "DELETE FROM open_tabs WHERE connection_id = ?1", false);
        run("Snippets", "snippets", "DELETE FROM snippets WHERE connection_id = ?1", false);
        run("Folders", "folders", "DELETE FROM folders WHERE connection_id = ?1", false);
        run("Query history", "query_history", "DELETE FROM query_history WHERE connection_id = ?1", false);
        run("Tags", "tags", "DELETE FROM tags WHERE connection_id = ?1", false);
        run(
            "Dashboards",
            "dashboard_state",
            "INSERT INTO dashboard_state(connection_id, dashboards_json, folders_json, updated_at) VALUES (?1, '[]', '[]', ?2)
             ON CONFLICT(connection_id) DO UPDATE SET dashboards_json = '[]', folders_json = '[]', updated_at = excluded.updated_at",
            true,
        );
        run(
            "Notes",
            "note_state",
            "INSERT INTO note_state(connection_id, notes_json, updated_at) VALUES (?1, '[]', ?2)
             ON CONFLICT(connection_id) DO UPDATE SET notes_json = '[]', updated_at = excluded.updated_at",
            true,
        );
        failures
    }
}
