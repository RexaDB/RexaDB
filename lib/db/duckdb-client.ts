let DuckDBInstance: any;
let DuckDBConnection: any;

function loadDuckDb() {
  if (DuckDBInstance) return;
  try {
    // Dynamic require to prevent Bun/Turbopack from statically resolving
    // all platform-specific @duckdb/node-bindings-* dependencies at bundle time.
    const mod = new Function("pkg", "return require(pkg)")("@duckdb/node-api");
    DuckDBInstance = mod.DuckDBInstance;
    DuckDBConnection = mod.DuckDBConnection;
  } catch (e: any) {
    console.warn(
      `DuckDB native module not available. Is "@duckdb/node-api" installed? ${e?.message || ""}`
    );
  }
}

import type { QueryResult } from "./client-types";
import { isSelectLikeQuery } from "./quote-identifier";
type DuckdbField = { name: string; dataTypeID: number; dataTypeName: string };
type DuckdbResult = QueryResult<Record<string, unknown>>;

function normalizeConnectionString(connectionString: string) {
  const raw = String(connectionString || "").trim();
  if (raw === ":memory:") return ":memory:";
  if (raw.startsWith("duckdb://:memory:")) return ":memory:";
  if (raw.startsWith("duckdb://")) {
    const path = decodeURIComponent(raw.slice("duckdb://".length));
    return path || ":memory:";
  }
  return raw;
}

// Re-exported from shared utility for consistency
const isSelectLike = isSelectLikeQuery;

// Cache DuckDB instances per connection string to avoid re-creating them per query
const duckDbCache = new Map<string, {
  instance: any;
  connections: any[];
  lastUsed: number;
}>();

async function getOrCreateDuckDb(connectionString: string) {
  const dbPath = normalizeConnectionString(connectionString);
  const cached = duckDbCache.get(dbPath);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.instance;
  }
  const instance = await DuckDBInstance.create(dbPath);
  const entry = { instance, connections: [], lastUsed: Date.now() };
  duckDbCache.set(dbPath, entry);
  return instance;
}

function cleanupDuckDbCache() {
  const now = Date.now();
  const MAX_IDLE_MS = 5 * 60 * 1000; // 5 minutes
  for (const [key, entry] of duckDbCache.entries()) {
    if (now - entry.lastUsed > MAX_IDLE_MS) {
      for (const conn of entry.connections) {
        try { conn.close().catch(() => {}); } catch {}
      }
      try { entry.instance.close().catch(() => {}); } catch {}
      duckDbCache.delete(key);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupDuckDbCache, 10 * 60 * 1000).unref();

async function runDuckdbQuery(connectionString: string, query: string, params?: any[]) {
  loadDuckDb();
  if (!DuckDBInstance) {
    return { rows: [], fields: [], rowCount: 0 };
  }
  const instance = await getOrCreateDuckDb(connectionString);
  const conn = await instance.connect();
  
  // Track connection for cleanup
  const dbPath = normalizeConnectionString(connectionString);
  const entry = duckDbCache.get(dbPath);
  if (entry) entry.connections.push(conn);
  
  try {
    const result = params && params.length > 0
      ? await conn.run(query, ...params)
      : await conn.run(query);

    const fields: DuckdbField[] = result.columns
      ? result.columns.map((c: any) => ({ name: c.name, dataTypeID: 0, dataTypeName: c.type || "unknown" }))
      : [];
    const rows = result.getRows ? result.getRows() : result.toArray ? result.toArray() : [];

    return {
      rows: rows.map((r: any) => {
        const obj: Record<string, unknown> = {};
        for (const f of fields) {
          // Convert BigInt to string to avoid precision loss for values exceeding Number.MAX_SAFE_INTEGER
          obj[f.name] = typeof r[f.name] === "bigint" ? r[f.name].toString() : r[f.name];
        }
        return obj;
      }),
      fields,
      rowCount: rows.length,
    };
  } finally {
    // Close the connection but keep the instance cached
    await conn.close().catch(() => {});
    // Remove from tracked connections list
    if (entry) {
      const idx = entry.connections.indexOf(conn);
      if (idx >= 0) entry.connections.splice(idx, 1);
    }
  }
}

async function getDuckdbSchemaList(connectionString: string) {
  const res = await runDuckdbQuery(connectionString, "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name");
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows.map((r: any) => r.schema_name).filter(Boolean);
}

export async function getDuckdbDatabases(connectionString: string) {
  const res = await runDuckdbQuery(connectionString, "SELECT DISTINCT catalog_name FROM information_schema.schemata ORDER BY catalog_name");
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows.map((r: any) => r.catalog_name).filter(Boolean);
}

export async function getDuckdbSchemas(connectionString: string) {
  const res = await runDuckdbQuery(connectionString, "SELECT schema_name, catalog_name FROM information_schema.schemata ORDER BY schema_name");
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows.map((r: any) => ({
    schema_name: r.schema_name,
    database_name: r.catalog_name,
  }));
}

export async function getDuckdbTables(connectionString: string, schema: string) {
  const q = `SELECT table_name, table_type, table_schema
    FROM information_schema.tables
    WHERE table_schema = ?
    ORDER BY table_name`;
  const res = await runDuckdbQuery(connectionString, q, [schema]);
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows.map((r: any) => ({
    table_name: r.table_name,
    table_type: r.table_type === "VIEW" ? "VIEW" : "TABLE",
  }));
}

export async function getDuckdbViews(connectionString: string, schema: string) {
  return getDuckdbTables(connectionString, schema);
}

export async function getDuckdbTableStructure(connectionString: string, schema: string, table: string) {
  const q = `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = ? AND table_name = ?
    ORDER BY ordinal_position`;
  const res = await runDuckdbQuery(connectionString, q, [schema, table]);
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows.map((r: any) => ({
    column_name: r.column_name,
    data_type: r.data_type,
    is_nullable: r.is_nullable === "YES",
    column_default: r.column_default,
    character_maximum_length: r.character_maximum_length,
  }));
}

export async function getDuckdbAllTablesWithColumns(connectionString: string) {
  const q = `SELECT table_schema, table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    ORDER BY table_schema, table_name, ordinal_position`;
  const res = await runDuckdbQuery(connectionString, q);
  if (!res || !Array.isArray(res.rows)) return [];
  return res.rows;
}

export async function executeDuckdbQuery(connectionString: string, query: string, params?: any[]) {
  return runDuckdbQuery(connectionString, query, params);
}
