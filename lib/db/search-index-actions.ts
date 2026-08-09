import { getSearchIndexDb } from "./search-index-db";
import type { SearchAllResult } from "./actions";

function buildFtsQuery(searchTerm: string): string {
  const tokens = searchTerm
    .replace(/[^\w\s@.\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

function initSearchIndexSchema(): void {
  const db = getSearchIndexDb();
  db.run(`CREATE TABLE IF NOT EXISTS search_index_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_string TEXT NOT NULL,
    table_schema TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    value TEXT NOT NULL,
    row_data TEXT,
    indexed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sie_conn ON search_index_entries(connection_string)`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
    value,
    content='search_index_entries',
    content_rowid='id',
    tokenize='unicode61'
  )`);

  db.run(`CREATE TRIGGER IF NOT EXISTS sie_ai AFTER INSERT ON search_index_entries BEGIN
    INSERT INTO search_index_fts(rowid, value) VALUES (new.id, new.value);
  END`);
  db.run(`CREATE TRIGGER IF NOT EXISTS sie_ad AFTER DELETE ON search_index_entries BEGIN
    INSERT INTO search_index_fts(search_index_fts, rowid, value) VALUES('delete', old.id, old.value);
  END`);
  db.run(`CREATE TRIGGER IF NOT EXISTS sie_au AFTER UPDATE ON search_index_entries BEGIN
    INSERT INTO search_index_fts(search_index_fts, rowid, value) VALUES('delete', old.id, old.value);
    INSERT INTO search_index_fts(rowid, value) VALUES (new.id, new.value);
  END`);

  db.run(`CREATE TABLE IF NOT EXISTS search_index_meta (
    connection_string TEXT NOT NULL PRIMARY KEY,
    last_indexed_at INTEGER NOT NULL,
    total_entries INTEGER NOT NULL DEFAULT 0
  )`);
}

export function saveSearchResultsToIndex(
  connectionString: string,
  results: SearchAllResult[]
): { success: boolean; error?: string } {
  try {
    const db = getSearchIndexDb();
    initSearchIndexSchema();
    if (results.length === 0) return { success: true };

    const insertStmt = db.prepare(`INSERT INTO search_index_entries
      (connection_string, table_schema, table_name, column_name, value, row_data)
      VALUES (?, ?, ?, ?, ?, ?)`);

    const updateMetaStmt = db.prepare(`INSERT OR REPLACE INTO search_index_meta (connection_string, last_indexed_at, total_entries)
      VALUES (?, ?, (SELECT COUNT(*) FROM search_index_entries WHERE connection_string = ?))`);

    const tx = (db as any).transaction(() => {
      for (const r of results) {
        insertStmt.run(
          connectionString,
          r.table_schema,
          r.table_name,
          r.column_name,
          r.value,
          JSON.stringify(r.row)
        );
      }
      updateMetaStmt.run(connectionString, Date.now(), connectionString);
    });
    tx();

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

interface IndexEntryRow {
  id: number;
  connection_string: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  value: string;
  row_data: string | null;
  indexed_at: number;
}

export function searchLocalIndex(
  connectionString: string,
  searchTerm: string
): { success: boolean; data?: SearchAllResult[]; error?: string } {
  try {
    const db = getSearchIndexDb();
    initSearchIndexSchema();

    const ftsQuery = buildFtsQuery(searchTerm);
    if (!ftsQuery) return { success: true, data: [] };

    const stmt = db.prepare(
      `SELECT e.* FROM search_index_fts f
       JOIN search_index_entries e ON f.rowid = e.id
       WHERE search_index_fts MATCH ?
       AND e.connection_string = ?
       ORDER BY e.indexed_at DESC
       LIMIT 100`
    );
    const rows = stmt.all(ftsQuery, connectionString) as IndexEntryRow[];

    const data: SearchAllResult[] = rows.map((r) => ({
      table_schema: r.table_schema,
      table_name: r.table_name,
      column_name: r.column_name,
      value: r.value,
      row: r.row_data ? JSON.parse(r.row_data) : {},
    }));

    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function clearSearchIndex(
  connectionString: string
): { success: boolean; error?: string } {
  try {
    const db = getSearchIndexDb();
    initSearchIndexSchema();
    db.run(`DELETE FROM search_index_entries WHERE connection_string = ?`, connectionString);
    db.run(`DELETE FROM search_index_meta WHERE connection_string = ?`, connectionString);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

interface MetaRow {
  last_indexed_at: number | null;
  total_entries: number;
}

export function getSearchIndexStatus(
  connectionString: string
): { success: boolean; data?: { lastIndexedAt: number | null; totalEntries: number } | null; error?: string } {
  try {
    const db = getSearchIndexDb();
    initSearchIndexSchema();
    const stmt = db.prepare(
      `SELECT last_indexed_at, total_entries FROM search_index_meta WHERE connection_string = ?`
    );
    const rows = stmt.all(connectionString) as MetaRow[];
    if (rows.length === 0) return { success: true, data: null };
    return {
      success: true,
      data: { lastIndexedAt: rows[0].last_indexed_at, totalEntries: rows[0].total_entries },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
