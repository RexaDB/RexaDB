import "server-only";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);
let createClient: any;
try {
  createClient = _require("@clickhouse/client").createClient;
} catch {}

import { inferFieldsFromRows } from "./field-utils";
import type { QueryResult } from "./client-types";
import { isSelectLikeQuery, quoteClickhouseIdentifier } from "./quote-identifier";
type ClickhouseResult = QueryResult<Record<string, unknown>>;

const DEFAULT_TIMEOUT_MS = 15_000;

// Cache ClickHouse clients per connection string to avoid re-creating them per query
const clickhouseClientCache = new Map<string, {
  client: any;
  lastUsed: number;
}>();

// Cleanup idle ClickHouse clients every 10 minutes
const CLICKHOUSE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CLICKHOUSE_MAX_IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clickhouseClientCache.entries()) {
    if (now - entry.lastUsed > CLICKHOUSE_MAX_IDLE_MS) {
      try { entry.client.close().catch(() => {}); } catch {}
      clickhouseClientCache.delete(key);
    }
  }
}, CLICKHOUSE_CLEANUP_INTERVAL_MS).unref();

function normalizeClickhouseConnectionString(connectionString: string) {
  const input = String(connectionString || "").trim();
  if (/^clickhouse\+https:\/\//i.test(input)) return input.replace(/^clickhouse\+https:/i, "https:");
  if (/^clickhouse\+http:\/\//i.test(input)) return input.replace(/^clickhouse\+http:/i, "http:");
  if (/^clickhouses:\/\//i.test(input)) return input.replace(/^clickhouses:/i, "https:");
  if (/^clickhouse:\/\//i.test(input)) return input.replace(/^clickhouse:/i, "http:");
  return input;
}

function parseClickhouseConnectionString(connectionString: string) {
  const normalized = normalizeClickhouseConnectionString(connectionString);
  const url = new URL(normalized);
  const databaseFromPath = decodeURIComponent(String(url.pathname || "").replace(/^\/+/, ""));
  const databaseFromQuery = url.searchParams.get("database") || url.searchParams.get("db") || "";
  const username = url.username
    || url.searchParams.get("user")
    || url.searchParams.get("username")
    || "default";
  const password = url.password || url.searchParams.get("password") || "";

  const host = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  const passthroughParams = new URLSearchParams(url.searchParams);
  ["user", "username", "password", "database", "db"].forEach((key) => passthroughParams.delete(key));

  return {
    host,
    database: databaseFromPath || databaseFromQuery || "default",
    username,
    password,
    params: passthroughParams,
  };
}

function formatClickhouseValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatClickhouseValue(v)).join(", ")}]`;
  }
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return `'${raw.replace(/'/g, "''")}'`;
}

function applyParams(query: string, params: any[]) {
  if (!params.length) return query;
  let output = query;
  if (/\$\d+/.test(output)) {
    output = output.replace(/\$(\d+)/g, (match, index) => {
      const idx = Number(index) - 1;
      if (idx < 0 || idx >= params.length) return match;
      return formatClickhouseValue(params[idx]);
    });
  }
  if (output.includes("?")) {
    let paramIndex = 0;
    output = output.replace(/\?/g, () => {
      if (paramIndex >= params.length) return "?";
      const rendered = formatClickhouseValue(params[paramIndex]);
      paramIndex += 1;
      return rendered;
    });
  }
  return output;
}

// isSelectLikeQuery imported from quote-identifier.ts

function hasFormatClause(query: string) {
  return /\bformat\b/i.test(query);
}

function isRecordRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildFields(rows: Array<Record<string, unknown>>, meta?: Array<{ name?: string; type?: string }>) {
  if (Array.isArray(meta) && meta.length > 0) {
    return meta.map((col) => ({
      name: String(col.name || ""),
      dataTypeID: 0,
      dataTypeName: String(col.type || "unknown"),
    }));
  }
  return inferFieldsFromRows(rows);
}

function buildClient(connectionString: string) {
  const cacheKey = connectionString;
  const cached = clickhouseClientCache.get(cacheKey);
  if (cached) {
    cached.lastUsed = Date.now();
    return { client: cached.client, parsed: parseClickhouseConnectionString(connectionString) };
  }
  
  const parsed = parseClickhouseConnectionString(connectionString);
  const client = createClient({
    host: parsed.host,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database || undefined,
    request_timeout: DEFAULT_TIMEOUT_MS,
    clickhouse_settings: Object.fromEntries(parsed.params.entries()),
  });
  
  clickhouseClientCache.set(cacheKey, { client, lastUsed: Date.now() });
  return { client, parsed };
}

async function executeClickhouseQueryInternal(
  connectionString: string,
  query: string,
  params: any[] = [],
) {
  // Use native ClickHouse parameter binding when possible
  // The ClickHouse client supports {name:type} placeholders with query_params
  let finalQuery: string;
  let queryParams: Record<string, unknown> | undefined;

  if (params.length > 0) {
    // Convert $1, $2, ? placeholders to {p1:Type} style for native binding
    // For types, we infer from the JS value
    const inferredParams: Record<string, unknown> = {};
    let paramIdx = 0;
    let dollarCount = 0;
    
    // Count $1, $2 style placeholders
    const dollarMatches = query.match(/\$\d+/g);
    if (dollarMatches) {
      dollarCount = Math.max(...dollarMatches.map(m => parseInt(m.slice(1))));
    }
    
    if (dollarCount > 0) {
      // Use $1, $2 style — map to ClickHouse named params
      finalQuery = query.replace(/\$(\d+)/g, (_match, num) => {
        const idx = parseInt(num) - 1;
        if (idx >= 0 && idx < params.length) {
          const name = `p${num}`;
          inferredParams[name] = params[idx];
          return `{${name}:${inferClickhouseType(params[idx])}}`;
        }
        return _match;
      });
    } else if (query.includes('?')) {
      // Use ? style
      finalQuery = query.replace(/\?/g, () => {
        paramIdx += 1;
        const name = `p${paramIdx}`;
        const val = params[paramIdx - 1];
        inferredParams[name] = val;
        return `{${name}:${inferClickhouseType(val)}}`;
      });
    } else {
      finalQuery = query;
    }
    
    queryParams = Object.keys(inferredParams).length > 0 ? inferredParams : undefined;
  } else {
    finalQuery = query;
    queryParams = undefined;
  }

  const expectsJson = isSelectLikeQuery(finalQuery) || hasFormatClause(finalQuery);

  const { client } = buildClient(connectionString);

  try {
    if (!expectsJson) {
      const execOpts: Record<string, unknown> = { query: finalQuery };
      if (queryParams) execOpts.query_params = queryParams;
      await client.exec(execOpts);
      return { rows: [], fields: [], rowCount: 0 };
    }

    const queryOpts: Record<string, unknown> = {
      query: finalQuery,
      format: hasFormatClause(finalQuery) ? undefined : "JSONEachRow",
    };
    if (queryParams) queryOpts.query_params = queryParams;
    
    const result = await client.query(queryOpts);
    const rows: unknown = await result.json().catch(() => []);
    const normalizedRows: Record<string, unknown>[] = Array.isArray(rows)
      ? rows.filter(isRecordRow)
      : [];
    const fields = normalizedRows.length > 0 ? buildFields(normalizedRows) : [];
    return {
      rows: normalizedRows,
      fields,
      rowCount: normalizedRows.length,
    };
  } finally {
    // Client is cached — do NOT close it here.
    // The idle cleanup interval will close clients that haven't been used recently.
  }
}

function inferClickhouseType(value: unknown): string {
  if (value === null || value === undefined) return 'Nullable(String)';
  if (typeof value === 'boolean') return 'UInt8';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Int64' : 'Float64';
  }
  if (typeof value === 'bigint') return 'Int64';
  if (value instanceof Date) return 'DateTime';
  if (Array.isArray(value)) return 'Array(String)';
  return 'String';
}

export async function executeClickhouseQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
): Promise<ClickhouseResult> {
  return await executeClickhouseQueryInternal(connectionString, query, params);
}

function escapeLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string) {
  return quoteClickhouseIdentifier(value);
}

export async function getClickhouseDatabases(connectionString: string) {
  const result = await executeClickhouseQuery(
    connectionString,
    "SELECT name FROM system.databases ORDER BY name",
  );
  return result.rows.map((row) => String(row.name ?? "").trim()).filter(Boolean);
}

export async function getClickhouseTables(connectionString: string, database: string) {
  const db = database || "default";
  const result = await executeClickhouseQuery(
    connectionString,
    `SELECT name FROM system.tables WHERE database = ${escapeLiteral(db)} AND engine NOT LIKE '%View%' ORDER BY name`,
  );
  return result.rows.map((row) => String(row.name ?? "").trim()).filter(Boolean);
}

export async function getClickhouseViews(connectionString: string, database: string) {
  const db = database || "default";
  const result = await executeClickhouseQuery(
    connectionString,
    `SELECT name FROM system.tables WHERE database = ${escapeLiteral(db)} AND engine LIKE '%View%' ORDER BY name`,
  );
  return result.rows.map((row) => String(row.name ?? "").trim()).filter(Boolean);
}

export async function getClickhouseTableStructure(connectionString: string, database: string, table: string) {
  const db = database || "default";
  const query = `DESCRIBE TABLE ${quoteIdentifier(db)}.${quoteIdentifier(table)}`;
  const result = await executeClickhouseQuery(connectionString, query);
  return result.rows.map((row) => {
    const rawType = String((row as any).type ?? "");
    const isNullable = rawType.includes("Nullable(");
    const defaultExpression = (row as any).default_expression ?? (row as any).default_type ?? null;
    return {
      column_name: String((row as any).name ?? ""),
      data_type: rawType,
      is_nullable: isNullable ? "YES" : "NO",
      column_default: defaultExpression ? String(defaultExpression) : null,
      is_primary_key: false,
      is_foreign_key: false,
    };
  });
}

export async function getClickhouseAllTablesWithColumns(connectionString: string, schema?: string) {
  const schemaFilter = schema ? String(schema) : "";
  const whereClause = schemaFilter
    ? `WHERE database = ${escapeLiteral(schemaFilter)}`
    : `WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')`;
  const result = await executeClickhouseQuery(connectionString, `
    SELECT
      database AS table_schema,
      table AS table_name,
      name AS column_name,
      type AS data_type,
      default_expression AS column_default
    FROM system.columns
    ${whereClause}
    ORDER BY database, table, position
  `);
  return result.rows.map((row) => {
    const rawType = String((row as any).data_type ?? "");
    const isNullable = rawType.includes("Nullable(");
    return {
      table_schema: String((row as any).table_schema ?? ""),
      table_name: String((row as any).table_name ?? ""),
      column_name: String((row as any).column_name ?? ""),
      data_type: rawType,
      is_nullable: isNullable ? "YES" : "NO",
      column_default: (row as any).column_default ?? null,
      is_primary: false,
      referenced_table_schema: null,
      referenced_table_name: null,
      referenced_column_name: null,
    };
  });
}
