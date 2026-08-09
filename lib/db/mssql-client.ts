let sql: any;
try {
  sql = require("mssql");
} catch {}

import type { QueryResult } from "./client-types";
import { quoteMssqlIdentifier, buildDeleteByIdsQuery } from "./quote-identifier";
type MssqlResult = QueryResult<Record<string, unknown>>;

type MssqlConfig = {
  server: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  options: {
    appName: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
    instanceName?: string;
  };
  connectionTimeout: number;
  requestTimeout: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function toBool(raw: string | null | undefined, fallback = false): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeMssqlConnectionString(connectionString: string): string {
  const input = String(connectionString || "").trim();
  if (!input) return input;
  if (/^sqlserver:\/\//i.test(input)) {
    return input.replace(/^sqlserver:/i, "mssql:");
  }
  return input;
}

function parseSemicolonConnectionString(connectionString: string) {
  const raw = String(connectionString || "").trim();
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const map: Record<string, string> = {};
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key) map[key] = value;
  }
  if (!Object.keys(map).length) return null;

  const serverRaw =
    map["server"] ||
    map["data source"] ||
    map["address"] ||
    map["addr"] ||
    map["network address"] ||
    "";
  let server = serverRaw.replace(/^tcp:/i, "").trim() || "localhost";
  let port: number | undefined;
  let instanceName: string | undefined;

  if (server.includes("\\")) {
    const [host, instance] = server.split("\\");
    server = host || server;
    instanceName = instance || undefined;
  }

  if (server.includes(",")) {
    const [host, portRaw] = server.split(",");
    server = host || server;
    const parsedPort = Number(portRaw || "");
    if (Number.isFinite(parsedPort) && parsedPort > 0) {
      port = parsedPort;
    }
  }

  const database = map["database"] || map["initial catalog"] || "";
  const user = map["user id"] || map["uid"] || map["user"] || "";
  const password = map["password"] || map["pwd"] || "";
  const encrypt = toBool(map["encrypt"], false);
  const trustServerCertificate = toBool(map["trustservercertificate"], false);

  return {
    server,
    port,
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      instanceName,
    },
  };
}

function parseMssqlConfig(connectionString: string): MssqlConfig {
  const trimmed = normalizeMssqlConnectionString(connectionString);
  const semicolonParsed = trimmed.includes(";")
    ? parseSemicolonConnectionString(trimmed)
    : null;
  if (semicolonParsed) {
    return {
      server: semicolonParsed.server,
      port: semicolonParsed.port,
      database: semicolonParsed.database || undefined,
      user: semicolonParsed.user || undefined,
      password: semicolonParsed.password || undefined,
      options: {
        appName: "RexaDB",
        encrypt: semicolonParsed.options.encrypt,
        trustServerCertificate: semicolonParsed.options.trustServerCertificate,
        instanceName: semicolonParsed.options.instanceName,
      },
      connectionTimeout: DEFAULT_TIMEOUT_MS,
      requestTimeout: DEFAULT_TIMEOUT_MS,
    } satisfies MssqlConfig;
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (!protocol.startsWith("mssql") && !protocol.startsWith("sqlserver")) {
      throw new Error("Unsupported protocol");
    }
    const encrypt = toBool(
      parsed.searchParams.get("encrypt") || parsed.searchParams.get("ssl"),
      false,
    );
    const trustServerCertificate = toBool(
      parsed.searchParams.get("trustServerCertificate") ||
        parsed.searchParams.get("trustServerCert"),
      false,
    );
    const instanceName = parsed.searchParams.get("instance") || undefined;
    const port = Number(parsed.port || "1433");
    return {
      server: parsed.hostname || "localhost",
      port: Number.isFinite(port) && port > 0 ? port : 1433,
      database:
        decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || undefined,
      user: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      options: {
        appName: "RexaDB",
        encrypt,
        trustServerCertificate,
        instanceName: instanceName || undefined,
      },
      connectionTimeout: DEFAULT_TIMEOUT_MS,
      requestTimeout: DEFAULT_TIMEOUT_MS,
    } satisfies MssqlConfig;
  } catch {
    return {
      server: "localhost",
      port: 1433,
      options: {
        appName: "RexaDB",
        encrypt: false,
        trustServerCertificate: true,
      },
      connectionTimeout: DEFAULT_TIMEOUT_MS,
      requestTimeout: DEFAULT_TIMEOUT_MS,
    } satisfies MssqlConfig;
  }
}

function replaceQuestionParams(query: string, params: any[]) {
  if (!params.length) return { query, paramNames: [] as string[] };

  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let output = "";

  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i];
    const next = query[i + 1];

    if (!inDoubleQuote && ch === "'") {
      if (inSingleQuote && next === "'") {
        output += "''";
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      output += ch;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      output += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && ch === "?") {
      index += 1;
      output += `@p${index}`;
      continue;
    }

    output += ch;
  }

  const paramNames = Array.from({ length: index }, (_, i) => `p${i + 1}`);
  return { query: output, paramNames };
}

function mapFields(
  recordset: any[],
): Array<{ name: string; dataTypeID: number; dataTypeName: string }> {
  const columns = (recordset as any)?.columns;
  if (columns && typeof columns === "object") {
    return Object.values(columns).map((col: any) => ({
      name: String(col?.name ?? ""),
      dataTypeID: Number(col?.type?.id ?? 0) || 0,
      dataTypeName: String(
        col?.type?.name ?? col?.type?.declaration ?? "unknown",
      ),
    }));
  }
  const sample = recordset?.[0];
  if (sample && typeof sample === "object") {
    return Object.keys(sample).map((name) => ({
      name,
      dataTypeID: 0,
      dataTypeName: "unknown",
    }));
  }
  return [];
}

type MssqlRequest = {
  input: (name: string, value: unknown) => void;
  query: (queryText: string) => Promise<{
    recordset?: Record<string, unknown>[];
    rowsAffected?: unknown[];
  }>;
};

type MssqlPool = {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  request: () => MssqlRequest;
};

async function withMssqlPool<T>(
  connectionString: string,
  fn: (pool: MssqlPool) => Promise<T>,
) {
  const config = parseMssqlConfig(connectionString);
  const pool = new sql.ConnectionPool(config) as MssqlPool;
  await pool.connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => {});
  }
}

function quoteIdentifier(name: string) {
  return quoteMssqlIdentifier(name);
}

export async function executeMssqlQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
): Promise<MssqlResult> {
  return await withMssqlPool(connectionString, async (pool) => {
    const { query: sqlQuery, paramNames } = replaceQuestionParams(
      query,
      params,
    );
    const request = pool.request();
    const effectiveParams = paramNames.length
      ? paramNames
      : params.map((_, i) => `p${i + 1}`);
    effectiveParams.forEach((name, index) => {
      request.input(name, params[index]);
    });
    const result = await request.query(sqlQuery);
    const rows = Array.isArray(result.recordset) ? result.recordset : [];
    const rowCount = Array.isArray(result.rowsAffected)
      ? result.rowsAffected.reduce(
          (acc: number, v: unknown) => acc + (Number(v) || 0),
          0,
        )
      : rows.length;
    return {
      rows,
      fields: mapFields(result.recordset ?? []),
      rowCount: Number(rowCount),
    };
  });
}

export async function getSchemas(connectionString: string) {
  const sqlQuery = `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;`;
  const result = await executeMssqlQuery(connectionString, sqlQuery);
  return result.rows
    .map((r: any) => r.schema_name ?? r.SCHEMA_NAME ?? r.name ?? r.NAME)
    .filter(Boolean);
}

export async function getDatabases(connectionString: string) {
  const sqlQuery = `SELECT name FROM sys.databases ORDER BY name;`;
  const result = await executeMssqlQuery(connectionString, sqlQuery);
  return result.rows.map((r: any) => r.name ?? r.NAME).filter(Boolean);
}

export async function getTables(connectionString: string, schema: string) {
  const sqlQuery = `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME;
  `;
  const result = await executeMssqlQuery(connectionString, sqlQuery, [schema]);
  return result.rows
    .map((r: any) => r.TABLE_NAME ?? r.table_name ?? r.name)
    .filter(Boolean);
}

export async function getViews(connectionString: string, schema: string) {
  const sqlQuery = `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.VIEWS
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME;
  `;
  const result = await executeMssqlQuery(connectionString, sqlQuery, [schema]);
  return result.rows
    .map((r: any) => r.TABLE_NAME ?? r.table_name ?? r.name)
    .filter(Boolean);
}

export async function getTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sqlQuery = `
    SELECT
      c.COLUMN_NAME AS column_name,
      c.DATA_TYPE AS data_type,
      c.IS_NULLABLE AS is_nullable,
      c.COLUMN_DEFAULT AS column_default,
      CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
      CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_foreign_key
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN (
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_SCHEMA = ?
        AND tc.TABLE_NAME = ?
    ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
    LEFT JOIN (
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
    ) fk ON c.COLUMN_NAME = fk.COLUMN_NAME
    WHERE c.TABLE_SCHEMA = ?
      AND c.TABLE_NAME = ?
    ORDER BY c.ORDINAL_POSITION;
  `;
  const result = await executeMssqlQuery(connectionString, sqlQuery, [
    schema,
    table,
    schema,
    table,
    schema,
    table,
  ]);
  return result.rows.map((row: any) => ({
    column_name: String(row.column_name ?? row.COLUMN_NAME ?? ""),
    data_type: String(row.data_type ?? row.DATA_TYPE ?? ""),
    is_nullable: String(row.is_nullable ?? row.IS_NULLABLE ?? ""),
    column_default: row.column_default ?? row.COLUMN_DEFAULT ?? null,
    is_primary_key: Boolean(row.is_primary_key ?? row.IS_PRIMARY_KEY ?? false),
    is_foreign_key: Boolean(row.is_foreign_key ?? row.IS_FOREIGN_KEY ?? false),
  }));
}

async function getTablePrimaryKey(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sqlQuery = `
    SELECT kcu.COLUMN_NAME AS column_name
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
     AND tc.TABLE_NAME = kcu.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      AND tc.TABLE_SCHEMA = ?
      AND tc.TABLE_NAME = ?
    ORDER BY kcu.ORDINAL_POSITION;
  `;
  const result = await executeMssqlQuery(connectionString, sqlQuery, [
    schema,
    table,
  ]);
  const first = result.rows[0];
  return first?.column_name ?? first?.COLUMN_NAME ?? null;
}

async function getTablePrimaryKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sqlQuery = `
    SELECT kcu.COLUMN_NAME AS column_name
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
     AND tc.TABLE_NAME = kcu.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      AND tc.TABLE_SCHEMA = ?
      AND tc.TABLE_NAME = ?
    ORDER BY kcu.ORDINAL_POSITION;
  `;
  const result = await executeMssqlQuery(connectionString, sqlQuery, [
    schema,
    table,
  ]);
  return result.rows
    .map((r: any) => r.column_name ?? r.COLUMN_NAME)
    .filter(Boolean);
}

export async function getTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sqlQuery = `
    SELECT
      kcu.COLUMN_NAME AS column_name,
      ccu.TABLE_SCHEMA AS foreign_table_schema,
      ccu.TABLE_NAME AS foreign_table_name,
      ccu.COLUMN_NAME AS foreign_column_name
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
      ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
    WHERE kcu.TABLE_SCHEMA = ?
      AND kcu.TABLE_NAME = ?
    ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;
  `;

  const result = await executeMssqlQuery(connectionString, sqlQuery, [
    schema,
    table,
  ]);
  return result.rows;
}

async function deleteRows(
  connectionString: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValues: any[],
) {
  const q = buildDeleteByIdsQuery(quoteMssqlIdentifier, (i) => `@p${i + 1}`, schema, table, pkColumn, pkValues);
  if (!q) return { rows: [], fields: [], rowCount: 0 };
  return await executeMssqlQuery(connectionString, q.sql, q.params);
}

async function updateRows(
  connectionString: string,
  schema: string,
  table: string,
  updates: Array<{ where: Record<string, any>; set: Record<string, any> }>,
) {
  return await withMssqlPool(connectionString, async (pool) => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const update of updates) {
        const setClauses: string[] = [];
        const values: any[] = [];

        for (const [col, val] of Object.entries(update.set)) {
          const paramIndex = values.length + 1;
          setClauses.push(`${quoteIdentifier(col)} = @p${paramIndex}`);
          values.push(val);
        }

        const whereClauses: string[] = [];
        for (const [col, val] of Object.entries(update.where)) {
          const paramIndex = values.length + 1;
          whereClauses.push(`${quoteIdentifier(col)} = @p${paramIndex}`);
          values.push(val);
        }

        const sqlQuery = `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
        const request = new sql.Request(transaction);
        values.forEach((value, idx) => {
          request.input(`p${idx + 1}`, value);
        });
        await request.query(sqlQuery);
      }
      await transaction.commit();
      return { success: true };
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    }
  });
}

export async function getAllTablesWithColumns(
  connectionString: string,
  schema?: string,
) {
  const schemaFilter = schema ? String(schema) : "";
  const sqlQuery = `
    SELECT
      c.TABLE_SCHEMA AS table_schema,
      c.TABLE_NAME AS table_name,
      c.COLUMN_NAME AS column_name,
      c.DATA_TYPE AS data_type,
      c.IS_NULLABLE AS is_nullable,
      c.COLUMN_DEFAULT AS column_default,
      CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary,
      fk.referenced_table_schema AS referenced_table_schema,
      fk.referenced_table_name AS referenced_table_name,
      fk.referenced_column_name AS referenced_column_name
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN (
      SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    ) pk
      ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
     AND c.TABLE_NAME = pk.TABLE_NAME
     AND c.COLUMN_NAME = pk.COLUMN_NAME
    LEFT JOIN (
      SELECT
        kcu.TABLE_SCHEMA,
        kcu.TABLE_NAME,
        kcu.COLUMN_NAME,
        ccu.TABLE_SCHEMA AS referenced_table_schema,
        ccu.TABLE_NAME AS referenced_table_name,
        ccu.COLUMN_NAME AS referenced_column_name
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
        ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
    ) fk
      ON c.TABLE_SCHEMA = fk.TABLE_SCHEMA
     AND c.TABLE_NAME = fk.TABLE_NAME
     AND c.COLUMN_NAME = fk.COLUMN_NAME
    WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
  `;
  const result = schemaFilter
    ? await executeMssqlQuery(
        connectionString,
        sqlQuery.replace(
          "WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')",
          "WHERE c.TABLE_SCHEMA = ?",
        ),
        [schemaFilter],
      )
    : await executeMssqlQuery(connectionString, sqlQuery);

  return result.rows
    .map((row: any) => ({
      table_schema: String(row.table_schema ?? row.TABLE_SCHEMA ?? ""),
      table_name: String(row.table_name ?? row.TABLE_NAME ?? ""),
      column_name: String(row.column_name ?? row.COLUMN_NAME ?? ""),
      data_type: String(row.data_type ?? row.DATA_TYPE ?? ""),
      is_nullable: String(row.is_nullable ?? row.IS_NULLABLE ?? ""),
      column_default: row.column_default ?? row.COLUMN_DEFAULT ?? null,
      is_primary: Boolean(row.is_primary ?? row.IS_PRIMARY ?? false),
      referenced_table_schema:
        row.referenced_table_schema ?? row.REFERENCED_TABLE_SCHEMA ?? null,
      referenced_table_name:
        row.referenced_table_name ?? row.REFERENCED_TABLE_NAME ?? null,
      referenced_column_name:
        row.referenced_column_name ?? row.REFERENCED_COLUMN_NAME ?? null,
    }))
    .filter((row) => row.table_schema && row.table_name && row.column_name);
}
