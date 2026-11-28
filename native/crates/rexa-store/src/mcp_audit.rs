//! Port of lib/agents/mcp/audit-log.ts (`appendMcpAudit`): the MCP server's
//! `mcp_audit_log` table (secret-free: query hash + preview only).

use crate::Store;
use anyhow::Result;

/// One audit row (`McpAuditRow`).
#[derive(Debug, Clone, Default)]
pub struct McpAuditRow {
    pub transport: Option<String>,
    pub mode_id: Option<String>,
    pub connection_id: Option<i64>,
    pub connection_name: Option<String>,
    pub tool: String,
    pub is_write: bool,
    pub success: bool,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub query_hash: Option<String>,
    pub query_preview: Option<String>,
}

const RETENTION_ROWS: i64 = 5000;

impl Store {
    /// Insert one row and trim the table to the newest 5000 rows.
    pub fn append_mcp_audit(&self, row: &McpAuditRow) -> Result<()> {
        self.db.execute_batch(
            "CREATE TABLE IF NOT EXISTS mcp_audit_log (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, transport TEXT, mode_id TEXT, \
             connection_id INTEGER, connection_name TEXT, tool TEXT NOT NULL, is_write INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 1, \
             error TEXT, duration_ms INTEGER, row_count INTEGER, query_hash TEXT, query_preview TEXT, slug TEXT, secret_count INTEGER); \
             CREATE INDEX IF NOT EXISTS mcp_audit_log_created_idx ON mcp_audit_log(created_at DESC);",
        )?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
        let tool: String = row.tool.chars().take(80).collect();
        let error = row.error.as_ref().map(|e| e.chars().take(500).collect::<String>());
        self.db.execute(
            "INSERT INTO mcp_audit_log (id, created_at, transport, mode_id, connection_id, connection_name, tool, is_write, success, error, duration_ms, row_count, query_hash, query_preview) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                now,
                row.transport,
                row.mode_id,
                row.connection_id,
                row.connection_name,
                tool,
                row.is_write as i64,
                row.success as i64,
                error,
                row.duration_ms,
                row.row_count,
                row.query_hash,
                row.query_preview,
            ],
        )?;
        self.db.execute("DELETE FROM mcp_audit_log WHERE id NOT IN (SELECT id FROM mcp_audit_log ORDER BY created_at DESC LIMIT ?1)", [RETENTION_ROWS])?;
        Ok(())
    }
}
