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

function pickField(row: any, ...names: string[]) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null) return row[n];
  }
  return undefined;
}

export type MssqlRoutine = {
  schema: string;
  name: string;
  arguments: string;
  type: "PROCEDURE" | "FUNCTION";
  return_type: string;
  definition: string | null;
  language: string;
};

function formatMssqlParamType(
  typeName: string,
  maxLength: number | null,
  precision: number | null,
  scale: number | null,
): string {
  const t = String(typeName || "").toLowerCase();
  if (t === "nvarchar" || t === "nchar") {
    if (maxLength === -1) return `${typeName}(MAX)`;
    if (typeof maxLength === "number" && maxLength > 0)
      return `${typeName}(${Math.floor(maxLength / 2)})`;
    return String(typeName);
  }
  if (
    t === "varchar" ||
    t === "char" ||
    t === "varbinary" ||
    t === "binary"
  ) {
    if (maxLength === -1) return `${typeName}(MAX)`;
    if (typeof maxLength === "number" && maxLength > 0)
      return `${typeName}(${maxLength})`;
    return String(typeName);
  }
  if (t === "decimal" || t === "numeric") {
    if (typeof precision === "number" && typeof scale === "number")
      return `${typeName}(${precision},${scale})`;
    return String(typeName);
  }
  if ((t === "datetime2" || t === "datetimeoffset" || t === "time") && typeof scale === "number")
    return `${typeName}(${scale})`;
  return String(typeName);
}

export async function getRoutines(
  connectionString: string,
  schema: string,
): Promise<MssqlRoutine[]> {
  const objectsQuery = `
    SELECT
      s.name AS [schema], o.name AS name, o.type_desc AS type_desc,
      CASE WHEN o.type IN ('P','PC','X') THEN 'PROCEDURE' ELSE 'FUNCTION' END AS [type],
      m.definition AS definition
    FROM sys.objects o
    JOIN sys.schemas s ON o.schema_id = s.schema_id
    LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
    WHERE s.name = ?
      AND o.type IN ('P','PC','FN','IF','TF')
    ORDER BY o.name;
  `;
  let objects: any[] = [];
  try {
    const result = await executeMssqlQuery(connectionString, objectsQuery, [
      schema,
    ]);
    objects = result.rows;
  } catch {
    return [];
  }
  if (!objects.length) return [];

  // Per-object params (args). VIEW DEFINITION denial yields empty params, not a failure.
  let paramRows: any[] = [];
  try {
    const paramsQuery = `
      SELECT
        OBJECT_SCHEMA_NAME(p.object_id) AS [schema],
        OBJECT_NAME(p.object_id) AS name,
        p.name AS param_name,
        TYPE_NAME(p.user_type_id) AS type_name,
        p.max_length AS max_length,
        p.precision AS precision,
        p.scale AS scale,
        p.is_output AS is_output,
        p.parameter_id AS parameter_id
      FROM sys.parameters p
      JOIN sys.objects o ON p.object_id = o.object_id
      JOIN sys.schemas s ON o.schema_id = s.schema_id
      WHERE s.name = ?
        AND o.type IN ('P','PC','FN','IF','TF')
      ORDER BY OBJECT_NAME(p.object_id), p.parameter_id;
    `;
    const pres = await executeMssqlQuery(connectionString, paramsQuery, [
      schema,
    ]);
    paramRows = pres.rows;
  } catch {
    paramRows = [];
  }

  // Return types via INFORMATION_SCHEMA.ROUTINES (DATA_TYPE + length).
  const returnTypeByName = new Map<string, string>();
  try {
    const routinesQuery = `
      SELECT SPECIFIC_NAME AS name, ROUTINE_TYPE AS routine_type,
        DATA_TYPE AS data_type,
        CHARACTER_MAXIMUM_LENGTH AS char_len,
        NUMERIC_PRECISION AS num_precision,
        NUMERIC_SCALE AS num_scale,
        DATETIME_PRECISION AS dt_precision
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = ?;
    `;
    const rres = await executeMssqlQuery(connectionString, routinesQuery, [
      schema,
    ]);
    for (const r of rres.rows) {
      const name = String(
        pickField(r, "name", "NAME", "SPECIFIC_NAME", "specific_name") ?? "",
      );
      if (!name) continue;
      const dataType = pickField(r, "data_type", "DATA_TYPE");
      if (dataType === undefined || dataType === null) continue;
      const dt = String(dataType);
      const charLen = pickField(r, "char_len", "CHAR_LEN", "CHARACTER_MAXIMUM_LENGTH", "character_maximum_length");
      const numP = pickField(r, "num_precision", "NUM_PRECISION", "NUMERIC_PRECISION", "numeric_precision");
      const numS = pickField(r, "num_scale", "NUM_SCALE", "NUMERIC_SCALE", "numeric_scale");
      let formatted = dt;
      const dtLower = dt.toLowerCase();
      if (
        ["nvarchar", "nchar", "varchar", "char", "varbinary", "binary"].includes(dtLower)
      ) {
        const n = Number(charLen);
        formatted = Number.isFinite(n)
          ? n === -1
            ? `${dt}(MAX)`
            : `${dt}(${n})`
          : dt;
      } else if (["decimal", "numeric"].includes(dtLower)) {
        const p = Number(numP);
        const s = Number(numS);
        if (Number.isFinite(p) && Number.isFinite(s))
          formatted = `${dt}(${p},${s})`;
      }
      returnTypeByName.set(name, formatted);
    }
  } catch {
    // non-fatal; return types fall back to ""
  }

  const paramsByObject = new Map<string, string[]>();
  for (const p of paramRows) {
    const objName = String(pickField(p, "name", "NAME") ?? "");
    if (!objName) continue;
    // parameter_id = 0 is the RETURN_VALUE placeholder for functions — skip it.
    const pid = Number(pickField(p, "parameter_id", "PARAMETER_ID") ?? -1);
    if (pid === 0) continue;
    const paramName = String(
      pickField(p, "param_name", "PARAM_NAME") ?? "",
    );
    const typeName = String(
      pickField(p, "type_name", "TYPE_NAME") ?? "",
    );
    if (!paramName || !typeName) continue;
    const maxLength = (() => {
      const v = pickField(p, "max_length", "MAX_LENGTH");
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();
    const precision = (() => {
      const v = pickField(p, "precision", "PRECISION");
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();
    const scale = (() => {
      const v = pickField(p, "scale", "SCALE");
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();
    const isOutput = Boolean(pickField(p, "is_output", "IS_OUTPUT"));
    const formatted = `${paramName} ${formatMssqlParamType(typeName, maxLength, precision, scale)}${isOutput ? " OUTPUT" : ""}`;
    const arr = paramsByObject.get(objName) ?? [];
    arr.push(formatted);
    paramsByObject.set(objName, arr);
  }

  return objects.map((o: any) => {
    const objSchema = String(pickField(o, "schema", "SCHEMA") ?? schema);
    const name = String(pickField(o, "name", "NAME") ?? "");
    const kind = String(pickField(o, "type", "TYPE") ?? "FUNCTION");
    const type: "PROCEDURE" | "FUNCTION" =
      kind === "PROCEDURE" ? "PROCEDURE" : "FUNCTION";
    return {
      schema: objSchema,
      name,
      arguments: (paramsByObject.get(name) ?? []).join(", "),
      type,
      return_type: type === "PROCEDURE" ? "" : (returnTypeByName.get(name) ?? ""),
      definition: (pickField(o, "definition", "DEFINITION") as string | null) ?? null,
      language: "Transact-SQL",
    };
  });
}

export async function getRoutineDefinition(
  connectionString: string,
  schema: string,
  name: string,
): Promise<string | null> {
  const sqlQuery = `
    SELECT m.definition AS definition
    FROM sys.sql_modules m
    JOIN sys.objects o ON m.object_id = o.object_id
    JOIN sys.schemas s ON o.schema_id = s.schema_id
    WHERE s.name = ? AND o.name = ?;
  `;
  try {
    const result = await executeMssqlQuery(connectionString, sqlQuery, [
      schema,
      name,
    ]);
    const first = result.rows[0] as any;
    if (!first) return null;
    return (pickField(first, "definition", "DEFINITION") as string | null) ?? null;
  } catch {
    return null;
  }
}

export type MssqlTrigger = {
  schema: string;
  name: string;
  table_schema: string | null;
  table_name: string | null;
  timing: string;
  event: string;
  events: string[];
  definition: string | null;
};

export async function getTriggers(
  connectionString: string,
  schema: string,
): Promise<MssqlTrigger[]> {
  const sqlQuery = `
    SELECT s.name AS [schema], t.name AS name,
      OBJECT_SCHEMA_NAME(t.parent_id) AS table_schema,
      OBJECT_NAME(t.parent_id) AS table_name,
      CASE WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
      te.type_desc AS event, m.definition AS definition
    FROM sys.triggers t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    LEFT JOIN sys.sql_modules m ON t.object_id = m.object_id
    LEFT JOIN sys.trigger_events te ON t.object_id = te.object_id
    WHERE s.name = ? OR OBJECT_SCHEMA_NAME(t.parent_id) = ?
    ORDER BY t.name;
  `;
  let rows: any[] = [];
  try {
    const result = await executeMssqlQuery(connectionString, sqlQuery, [
      schema,
      schema,
    ]);
    rows = result.rows;
  } catch {
    return [];
  }
  // One row per (trigger, event) — group events client-side.
  const grouped = new Map<string, MssqlTrigger>();
  for (const r of rows) {
    const tSchema = String(pickField(r, "schema", "SCHEMA") ?? schema);
    const name = String(pickField(r, "name", "NAME") ?? "");
    if (!name) continue;
    const key = `${tSchema}.${name}`;
    const existing = grouped.get(key);
    const event = pickField(r, "event", "EVENT");
    const eventStr = event === undefined || event === null ? "" : String(event);
    if (existing) {
      if (eventStr && !existing.events.includes(eventStr)) {
        existing.events.push(eventStr);
        existing.event = existing.events.join(", ");
      }
      if (!existing.definition) {
        existing.definition =
          (pickField(r, "definition", "DEFINITION") as string | null) ?? null;
      }
      continue;
    }
    grouped.set(key, {
      schema: tSchema,
      name,
      table_schema:
        (pickField(r, "table_schema", "TABLE_SCHEMA") as string | null) ?? null,
      table_name:
        (pickField(r, "table_name", "TABLE_NAME") as string | null) ?? null,
      timing: String(pickField(r, "timing", "TIMING") ?? "AFTER"),
      event: eventStr,
      events: eventStr ? [eventStr] : [],
      definition:
        (pickField(r, "definition", "DEFINITION") as string | null) ?? null,
    });
  }
  return [...grouped.values()];
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
