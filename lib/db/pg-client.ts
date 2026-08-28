import type { Pool as PoolType, PoolClient } from "pg";

let Client: any;
let Pool: typeof PoolType;
try {
  const pg = (globalThis as any).__pg || require("pg");
  Client = pg.Client;
  Pool = pg.Pool;
} catch (e: any) {
  throw new Error(
    `Failed to load the "pg" module. Is the "pg" npm package installed? ${e?.message || ""}`
  );
}
import type { QueryExecutionContext } from "@/lib/studio/table-permissions";
import { startSshTunnelIfNeeded, type TunnelHandle } from "./ssh-tunnel";
import { normalizePgConnectionString, validateSslMode, recoverPgCredentials } from "./pg-connection";
import { quotePgIdentifier } from "./quote-identifier";
import { resolveEffectiveConnectionString } from "./neon-cli-client";
type ExecuteQueryOptions = {
  queryId?: string;
  executionContext?: QueryExecutionContext | null;
};

const runningPgQueries = new Map<string, {
  pid: number;
  effectiveConnectionString: string;
}>();

const pgPoolEntries = new Map<string, {
  entry: Promise<{
    pool: PoolType;
    effectiveConnectionString: string;
    tunnel: TunnelHandle;
  }>;
  lastUsed: number;
}>();

// Periodically evict idle pools (every 5 minutes)
const POOL_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const POOL_MAX_IDLE_MS = 30 * 60 * 1000;

let poolCleanupTimer: ReturnType<typeof setInterval> | null = null;
function startPoolCleanup() {
  if (poolCleanupTimer) return;
  poolCleanupTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, value] of pgPoolEntries.entries()) {
      if (now - value.lastUsed > POOL_MAX_IDLE_MS) {
        try {
          const resolved = await value.entry;
          await resolved.pool.end().catch(() => {});
          await resolved.tunnel.close().catch(() => {});
        } catch {}
        pgPoolEntries.delete(key);
      }
    }
  }, POOL_CLEANUP_INTERVAL_MS);
  // Allow the timer to not block process exit
  if (typeof poolCleanupTimer === 'object' && poolCleanupTimer?.unref) {
    poolCleanupTimer.unref();
  }
}

startPoolCleanup();



function parsePgConfig(connectionString: string) {
  const fallback = {
    host: "localhost",
    port: 5432,
    database: "",
    username: "",
    password: "",
    sslMode: "prefer",
  };
  try {
    const parsed = new URL(normalizePgConnectionString(connectionString));
    let host = parsed.hostname || "localhost";
    let port = Number(parsed.port || "5432");
    if (!Number.isFinite(port) || port <= 0) port = 5432;
    
    // Check search params first for dbname, then fallback to pathname
    let database = decodePgCredential(
      parsed.searchParams.get("dbname") || 
      parsed.searchParams.get("database") || 
      String(parsed.pathname || "").replace(/^\/+/, "")
    );
    
    let username = decodePgCredential(parsed.username || "");
    let password = decodePgCredential(parsed.password || "");
    const rawSslMode = String(parsed.searchParams.get("sslmode") || "prefer").toLowerCase();
    const sslMode = validateSslMode(rawSslMode);

    const recovered = recoverPgCredentials({ password, database, username, host, port });
    username = recovered.username;
    password = recovered.password;
    host = recovered.host;
    port = recovered.port;
    database = recovered.database;

    const searchDbName = parsed.searchParams.get("dbname") || parsed.searchParams.get("database");
    if (searchDbName) {
      database = decodePgCredential(searchDbName);
    }

    return { host, port, database, username, password, sslMode };
  } catch {
    return fallback;
  }
}

function decodePgCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getPgPassword(connectionString: string): string {
  return parsePgConfig(connectionString).password;
}

function getPgUsername(connectionString: string): string {
  return parsePgConfig(connectionString).username;
}

function getPgDatabase(connectionString: string): string {
  return parsePgConfig(connectionString).database;
}

function getPgHost(connectionString: string): string {
  return parsePgConfig(connectionString).host;
}

function getPgPort(connectionString: string): number {
  return parsePgConfig(connectionString).port;
}

function getPgSslConfig(connectionString: string) {
  const sslMode = parsePgConfig(connectionString).sslMode;
  return sslMode === "disable" ? false : { rejectUnauthorized: false };
}



async function getPgPoolEntry(rawConnectionString: string) {
  const connectionString = await resolveEffectiveConnectionString(rawConnectionString);
  const config = parsePgConfig(connectionString);
  const cacheKey = `${config.host}:${config.port}:${config.database}:${config.username}:${config.password}`;

  const cached = pgPoolEntries.get(cacheKey);
  if (cached) {
    cached.lastUsed = Date.now();
    return await cached.entry;
  }

  const pending = (async () => {
    const tunnel = await startSshTunnelIfNeeded(connectionString, 5432, normalizePgConnectionString);
    const effectiveConnectionString = tunnel.connectionString;
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      max: 6,
      ssl: getPgSslConfig(effectiveConnectionString),
    });

    pool.on("error", (error: Error) => {
      console.error("PostgreSQL pool error:", error.message);
    });

    return {
      pool,
      effectiveConnectionString,
      tunnel,
    };
  })();

  pgPoolEntries.set(cacheKey, {
    entry: pending,
    lastUsed: Date.now(),
  });

  try {
    return await pending;
  } catch (error) {
    pgPoolEntries.delete(cacheKey);
    throw error;
  }
}

// quotePgIdentifier imported from quote-identifier.ts

async function applyExecutionContext(client: PoolClient, context: QueryExecutionContext) {
  if (context.kind === "role") {
    await client.query(`SET LOCAL ROLE ${quotePgIdentifier(context.role)}`);
    return;
  }

  await client.query(`SET LOCAL ROLE ${quotePgIdentifier(context.role)}`);
  await client.query(
    "SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
    [context.userId],
  );
  await client.query(
    "SELECT pg_catalog.set_config('request.jwt.claim.role', $1, true)",
    [context.role],
  );
  await client.query(
    "SELECT pg_catalog.set_config('request.jwt.claims', $1, true)",
    [JSON.stringify(context.claims)],
  );

  if (context.email) {
    await client.query(
      "SELECT pg_catalog.set_config('request.jwt.claim.email', $1, true)",
      [context.email],
    );
  }

  if (context.phone) {
    await client.query(
      "SELECT pg_catalog.set_config('request.jwt.claim.phone', $1, true)",
      [context.phone],
    );
  }
}

export async function executeQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
  options: ExecuteQueryOptions = {}
) {
  const { pool, effectiveConnectionString } = await getPgPoolEntry(connectionString);
  const queryId = options.queryId?.trim();
  const executionContext = options.executionContext ?? null;
  let client: PoolClient | null = null;
  let scopedTransactionStarted = false;

  try {
    client = await pool.connect();
    const backendPid = Number((client as any).processID);
    if (queryId && Number.isFinite(backendPid) && backendPid > 0) {
      runningPgQueries.set(queryId, {
        pid: backendPid,
        effectiveConnectionString,
      });
    }
    if (executionContext) {
      await client.query("BEGIN");
      scopedTransactionStarted = true;
      await applyExecutionContext(client, executionContext);
    }
    const rawRes: any = await client.query(query, params);
    // In simple-query mode, pg may return an array for multi-statement SQL.
    const res = Array.isArray(rawRes)
      ? (rawRes[rawRes.length - 1] ?? { rows: [], fields: [], rowCount: 0 })
      : rawRes;
    
    // Fetch type names for the fields if they exist
    let fields: Array<{ name: string; dataTypeID: number; dataTypeName: string }> = [];
    if (Array.isArray(res.fields) && res.fields.length > 0) {
      type PgField = { name: string; dataTypeID: number };
      const typeOids = Array.from(
        new Set((res.fields as PgField[]).map((f) => f.dataTypeID))
      );
      const typeRes = await client.query(
        'SELECT oid, typname FROM pg_type WHERE oid = ANY($1)',
        [typeOids]
      );
      const typeMap = Object.fromEntries(typeRes.rows.map(r => [r.oid, r.typname]));
      
      fields = (res.fields as PgField[]).map((f) => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
        dataTypeName: typeMap[f.dataTypeID] || 'unknown'
      }));
    }

    // Serialize rows to handle non-plain objects (BigInt, Interval, Buffer, etc.)
    const serializedRows = Array.isArray(res.rows)
      ? res.rows.map((row: any) => serializeRow(row))
      : [];

    if (scopedTransactionStarted) {
      await client.query("COMMIT");
      scopedTransactionStarted = false;
    }

    return {
      rows: serializedRows,
      fields,
      rowCount: res.rowCount ?? serializedRows.length,
    };
  } catch (error: any) {
    if (client && scopedTransactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Failed to rollback PostgreSQL permission context:", rollbackError);
      }
    }
    console.error(`PostgreSQL Error [${error.code}]:`, error.message);
    throw error;
  } finally {
    if (queryId) {
      runningPgQueries.delete(queryId);
    }
    client?.release();
  }
}

export async function cancelQueryById(queryId: string): Promise<boolean> {
  const normalizedQueryId = String(queryId || "").trim();
  if (!normalizedQueryId) return false;

  const running = runningPgQueries.get(normalizedQueryId);
  if (!running) return false;

  const cancelClient = new Client({
    host: getPgHost(running.effectiveConnectionString),
    port: getPgPort(running.effectiveConnectionString),
    database: getPgDatabase(running.effectiveConnectionString),
    user: getPgUsername(running.effectiveConnectionString),
    password: getPgPassword(running.effectiveConnectionString),
    connectionTimeoutMillis: 8000,
    ssl: getPgSslConfig(running.effectiveConnectionString),
  });

  try {
    await cancelClient.connect();
    const res = await cancelClient.query(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [running.pid]
    );
    return Boolean(res.rows?.[0]?.cancelled);
  } catch (error: any) {
    console.error("Failed to cancel PostgreSQL query:", error?.message || error);
    return false;
  } finally {
    try {
      await cancelClient.end();
    } catch {}
  }
}

export async function getTables(connectionString: string, schema: string) {
  const query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = $1
    ORDER BY table_name;
  `;
  const result = await executeQuery(connectionString, query, [schema]);
  return result.rows.map((r: any) => r.table_name);
}

export async function getViews(connectionString: string, schema: string) {
  const query = `
    SELECT table_name AS name
    FROM information_schema.views
    WHERE table_schema = $1
    UNION
    SELECT matviewname AS name
    FROM pg_matviews
    WHERE schemaname = $1
    ORDER BY name;
  `;
  const result = await executeQuery(connectionString, query, [schema]);
  return result.rows.map((r: any) => r.name);
}

export async function getSchemas(connectionString: string) {
  const query = `
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
    AND schema_name NOT LIKE 'pg_toast%'
    ORDER BY schema_name;
  `;
  const result = await executeQuery(connectionString, query);
  return result.rows.map((r: any) => r.schema_name);
}

export async function getDatabases(connectionString: string) {
  const query = `
    SELECT datname as name
    FROM pg_database
    WHERE datistemplate = false
    ORDER BY datname;
  `;
  const result = await executeQuery(connectionString, query);
  return result.rows.map((r: any) => r.name);
}

export async function getTableStructure(connectionString: string, schema: string, table: string) {
  const query = `
    SELECT 
      c.column_name, 
      c.data_type, 
      c.udt_schema,
      c.udt_name,
      c.is_nullable, 
      c.column_default,
      c.character_maximum_length,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = c.table_schema 
          AND tc.table_name = c.table_name 
          AND kcu.column_name = c.column_name
          AND tc.constraint_type = 'PRIMARY KEY'
      ) as is_primary_key,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = c.table_schema 
          AND tc.table_name = c.table_name 
          AND kcu.column_name = c.column_name
          AND tc.constraint_type = 'FOREIGN KEY'
      ) as is_foreign_key
    FROM information_schema.columns c
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position;
  `;
  const result = await executeQuery(connectionString, query, [schema, table]);
  return result.rows;
}

export async function getTablePrimaryKey(connectionString: string, schema: string, table: string) {
  const query = `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2;
  `;
  const result = await executeQuery(connectionString, query, [schema, table]);
  return result.rows[0]?.column_name || null;
}

async function getTablePrimaryKeys(connectionString: string, schema: string, table: string) {
  const query = `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2;
  `;
  const result = await executeQuery(connectionString, query, [schema, table]);
  return result.rows.map((r: any) => r.column_name);
}

export async function getTableForeignKeys(connectionString: string, schema: string, table: string) {
  const query = `
    SELECT
      src_att.attname AS column_name,
      tgt_ns.nspname AS foreign_table_schema,
      tgt_tbl.relname AS foreign_table_name,
      tgt_att.attname AS foreign_column_name
    FROM pg_constraint con
    JOIN pg_class src_tbl
      ON src_tbl.oid = con.conrelid
    JOIN pg_namespace src_ns
      ON src_ns.oid = src_tbl.relnamespace
    JOIN pg_class tgt_tbl
      ON tgt_tbl.oid = con.confrelid
    JOIN pg_namespace tgt_ns
      ON tgt_ns.oid = tgt_tbl.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_col(attnum, ord)
      ON true
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS tgt_col(attnum, ord)
      ON tgt_col.ord = src_col.ord
    JOIN pg_attribute src_att
      ON src_att.attrelid = src_tbl.oid
      AND src_att.attnum = src_col.attnum
    JOIN pg_attribute tgt_att
      ON tgt_att.attrelid = tgt_tbl.oid
      AND tgt_att.attnum = tgt_col.attnum
    WHERE con.contype = 'f'
      AND src_ns.nspname = $1
      AND src_tbl.relname = $2
    ORDER BY con.conname, src_col.ord;
  `;
  try {
    const result = await executeQuery(connectionString, query, [schema, table]);
    return result.rows;
  } catch (err) {
    console.error("Error fetching foreign keys:", err);
    return [];
  }
}

export async function deleteRows(connectionString: string, schema: string, table: string, pkColumn: string, pkValues: any[]) {
  const placeholders = pkValues.map((_, i) => `$${i + 1}`).join(', ');
  const query = `DELETE FROM ${quotePgIdentifier(schema)}.${quotePgIdentifier(table)} WHERE ${quotePgIdentifier(pkColumn)} IN (${placeholders})`;
  return await executeQuery(connectionString, query, pkValues);
}

export async function updateRows(
  rawConnectionString: string,
  schema: string,
  table: string,
  updates: Array<{ where: Record<string, any>, set: Record<string, any> }>
) {
  const connectionString = await resolveEffectiveConnectionString(rawConnectionString);
  const tunnel = await startSshTunnelIfNeeded(connectionString, 5432, normalizePgConnectionString);
  const effectiveConnectionString = tunnel.connectionString;
  
  const client = new Client({
    host: getPgHost(effectiveConnectionString),
    port: getPgPort(effectiveConnectionString),
    database: getPgDatabase(effectiveConnectionString),
    user: getPgUsername(effectiveConnectionString),
    password: getPgPassword(effectiveConnectionString),
    ssl: getPgSslConfig(effectiveConnectionString),
  });

  try {
    await client.connect();
    await client.query('BEGIN');

    for (const update of updates) {
      const setClauses = [];
      const setValues = [];
      let paramIndex = 1;

      for (const [col, val] of Object.entries(update.set)) {
        setClauses.push(`${quotePgIdentifier(col)} = $${paramIndex++}`);
        setValues.push(val);
      }

      const whereClauses = [];
      for (const [col, val] of Object.entries(update.where)) {
        whereClauses.push(`${quotePgIdentifier(col)} = $${paramIndex++}`);
        setValues.push(val);
      }

      const query = `UPDATE "${schema}"."${table}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
      await client.query(query, setValues);
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    try {
      await client.end();
    } catch (e) {}
    try {
      await tunnel.close();
    } catch {}
  }
}

function serializeRow(row: any): any {
  if (!row) return row;
  const serialized: any = {};
  for (const [key, value] of Object.entries(row)) {
    serialized[key] = serializeValue(value);
  }
  return serialized;
}

function serializeValue(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle BigInt
  if (typeof value === "bigint") {
    return value.toString();
  }

  // Handle Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle Buffer (BYTEA)
  if (Buffer.isBuffer(value)) {
    return value.toString("hex");
  }

  // Handle Arrays
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  // Handle Objects (Interval, JSONB, etc.)
  if (typeof value === "object") {
    // If it's a plain object, we still want to recursively serialize its values
    // If it's a class instance (like PostgresInterval), this will convert it to a plain object
    const serializedObj: any = {};
    for (const [key, val] of Object.entries(value)) {
      serializedObj[key] = serializeValue(val);
    }
    return serializedObj;
  }

  return value;
}
