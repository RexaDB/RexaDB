import type { FieldPacket, OkPacket, RowDataPacket } from "mysql2/promise";
import { inferFieldsFromRows } from "./field-utils";
import { startSshTunnelIfNeeded, type TunnelHandle } from "./ssh-tunnel";
import { quoteMysqlIdentifier, buildDeleteByIdsQuery } from "./quote-identifier";

let MYSQL_TYPE_NAMES: Record<number, string>;
try {
  const Types = require("mysql2").Types;
  MYSQL_TYPE_NAMES = Object.fromEntries(
    Object.entries(Types)
      .filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      )
      .map(([key, value]) => [value, key.toLowerCase()]),
  );
} catch {
  MYSQL_TYPE_NAMES = {};
}

import type { QueryResult } from "./client-types";
import { serializeValue } from "./serialize-value";
type MysqlResult = QueryResult<Record<string, unknown>>;

function normalizeMysqlConnectionString(connectionString: string): string {
  const input = String(connectionString || "").trim();
  if (/^(mysql|mariadb):\/(?!\/)/i.test(input)) {
    return input.replace(/^((?:mysql|mariadb):)\/(?!\/)/i, "$1//");
  }
  if (
    !/^(mysql|mariadb):\/\//i.test(input) &&
    !input.includes("://") &&
    input.length > 0
  ) {
    return `mysql://${input}`;
  }
  return input;
}

function decodeMysqlCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseMysqlConfig(connectionString: string) {
  const fallback = {
    host: "localhost",
    port: 3306,
    database: "",
    username: "",
    password: "",
    sslMode: "disable",
  };

  try {
    const parsed = new URL(normalizeMysqlConnectionString(connectionString));
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (!protocol.startsWith("mysql") && !protocol.startsWith("mariadb")) {
      return fallback;
    }
    const host = parsed.hostname || "localhost";
    let port = Number(parsed.port || "3306");
    if (!Number.isFinite(port) || port <= 0) port = 3306;
    const database = decodeMysqlCredential(
      String(parsed.pathname || "").replace(/^\/+/, ""),
    );
    const username = decodeMysqlCredential(parsed.username || "");
    const password = decodeMysqlCredential(parsed.password || "");
    const rawSslMode = String(
      parsed.searchParams.get("sslmode") ||
        parsed.searchParams.get("ssl") ||
        "",
    ).toLowerCase();
    const sslMode =
      rawSslMode && !["disable", "false", "0", "off"].includes(rawSslMode)
        ? "require"
        : "disable";

    return { host, port, database, username, password, sslMode };
  } catch {
    return fallback;
  }
}

function getMysqlHost(connectionString: string): string {
  return parseMysqlConfig(connectionString).host;
}

function getMysqlPort(connectionString: string): number {
  return parseMysqlConfig(connectionString).port;
}

function getMysqlDatabase(connectionString: string): string {
  return parseMysqlConfig(connectionString).database;
}

function getMysqlUsername(connectionString: string): string {
  return parseMysqlConfig(connectionString).username;
}

function getMysqlPassword(connectionString: string): string {
  return parseMysqlConfig(connectionString).password;
}

function getMysqlSslConfig(connectionString: string) {
  const sslMode = parseMysqlConfig(connectionString).sslMode;
  return sslMode === "disable" ? undefined : { rejectUnauthorized: true };
}

function quoteIdentifier(value: string) {
  return quoteMysqlIdentifier(value);
}

function serializeRows(rows: RowDataPacket[] = []) {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
    return out;
  });
}

function buildFields(fields: FieldPacket[] = []) {
  return fields
    .filter(Boolean)
    .map((field) => {
      const typeId = (field as any)?.columnType ?? (field as any)?.type ?? 0;
      return {
        name: (field as any)?.name ?? "",
        dataTypeID: Number(typeId) || 0,
        dataTypeName: MYSQL_TYPE_NAMES[Number(typeId)] || "unknown",
      };
    })
    .filter((field) => field.name);
}

function isOkPacket(value: unknown): value is OkPacket {
  return Boolean(value && typeof value === "object" && "affectedRows" in value);
}



function normalizeMysqlResult(rows: any, fields: any): MysqlResult {
  if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) {
    const lastIndex = rows.length - 1;
    const lastRows = Array.isArray(rows[lastIndex]) ? rows[lastIndex] : [];
    const lastFields = Array.isArray(fields?.[lastIndex])
      ? fields[lastIndex]
      : [];
    const rowCount = isOkPacket(lastRows)
      ? Number(lastRows.affectedRows || 0)
      : Array.isArray(lastRows)
        ? lastRows.length
        : 0;
    const normalizedRows = Array.isArray(lastRows)
      ? serializeRows(lastRows)
      : [];

    let normalizedFields = buildFields(lastFields);
    if (normalizedFields.length === 0 && normalizedRows.length > 0) {
      normalizedFields = inferFieldsFromRows(normalizedRows);
    }
    return {
      rows: normalizedRows,
      fields: normalizedFields,
      rowCount,
    };
  }

  if (isOkPacket(rows)) {
    return {
      rows: [],
      fields: [],
      rowCount: Number(rows.affectedRows || 0),
    };
  }

  const normalizedRows = Array.isArray(rows) ? serializeRows(rows) : [];
  let normalizedFields = buildFields(Array.isArray(fields) ? fields : []);
  if (normalizedFields.length === 0 && normalizedRows.length > 0) {
    normalizedFields = inferFieldsFromRows(normalizedRows);
  }
  return {
    rows: normalizedRows,
    fields: normalizedFields,
    rowCount: Array.isArray(rows) ? rows.length : 0,
  };
}

async function createMysqlConnection(
  connectionString: string,
  options?: { multipleStatements?: boolean },
) {
  const tunnel = await startSshTunnelIfNeeded(
    connectionString,
    3306,
    normalizeMysqlConnectionString,
  );
  const effectiveConnectionString = tunnel.connectionString;
  const { createConnection } = await import("mysql2/promise");
  const connection = await createConnection({
    host: getMysqlHost(effectiveConnectionString),
    port: getMysqlPort(effectiveConnectionString),
    database: getMysqlDatabase(effectiveConnectionString),
    user: getMysqlUsername(effectiveConnectionString),
    password: getMysqlPassword(effectiveConnectionString),
    connectTimeout: 15000,
    ssl: getMysqlSslConfig(effectiveConnectionString),
    multipleStatements: options?.multipleStatements ?? true,
  });
  return { connection, effectiveConnectionString, tunnel };
}

export async function executeMysqlQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
): Promise<MysqlResult> {
  const { connection, tunnel } = await createMysqlConnection(connectionString);

  try {
    const [rows, fields] = await connection.query({
      sql: query,
      values: params,
    });
    return normalizeMysqlResult(rows, fields);
  } finally {
    try {
      await connection.end();
    } catch {}
    try {
      await tunnel.close();
    } catch {}
  }
}

export async function getTables(connectionString: string, schema: string) {
  const sql = `
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const result = await executeMysqlQuery(connectionString, sql, [schema]);
  return result.rows.map((r) =>
    String(
      (r as any).name || (r as any).table_name || (r as any).TABLE_NAME || "",
    ),
  );
}

export async function getViews(connectionString: string, schema: string) {
  const sql = `
    SELECT table_name AS name
    FROM information_schema.views
    WHERE table_schema = ?
    ORDER BY table_name;
  `;
  const result = await executeMysqlQuery(connectionString, sql, [schema]);
  return result.rows.map((r) => String((r as any).name || ""));
}

export async function getSchemas(connectionString: string) {
  try {
    const showResult = await executeMysqlQuery(
      connectionString,
      "SHOW DATABASES;",
    );
    const rows = showResult.rows || [];
    const names = rows.map((r) =>
      String((r as any).Database || (r as any).database || ""),
    );
    const cleaned = names
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (cleaned.length > 0) return cleaned;
  } catch {
    // Fall back to information_schema.schemata below.
  }

  const sql = `
    SELECT schema_name
    FROM information_schema.schemata
    ORDER BY schema_name;
  `;
  const result = await executeMysqlQuery(connectionString, sql);
  return result.rows.map((r) => String((r as any).schema_name || ""));
}

export async function getDatabases(connectionString: string) {
  return await getSchemas(connectionString);
}

export async function getTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sql = `
    SELECT
      c.column_name,
      c.data_type,
      c.column_type,
      c.is_nullable,
      c.column_default,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.extra,
      CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
      CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END AS is_foreign_key
    FROM information_schema.columns c
    LEFT JOIN information_schema.key_column_usage pk
      ON c.table_schema = pk.table_schema
      AND c.table_name = pk.table_name
      AND c.column_name = pk.column_name
      AND pk.constraint_name = 'PRIMARY'
    LEFT JOIN information_schema.key_column_usage fk
      ON c.table_schema = fk.table_schema
      AND c.table_name = fk.table_name
      AND c.column_name = fk.column_name
      AND fk.referenced_table_name IS NOT NULL
    WHERE c.table_schema = ? AND c.table_name = ?
    ORDER BY c.ordinal_position;
  `;
  const result = await executeMysqlQuery(connectionString, sql, [
    schema,
    table,
  ]);
  return result.rows.map((row: any) => {
    const columnName =
      row.column_name ?? row.COLUMN_NAME ?? row.columnName ?? "";
    const dataType = row.data_type ?? row.DATA_TYPE ?? row.dataType ?? "";
    const columnType =
      row.column_type ?? row.COLUMN_TYPE ?? row.columnType ?? "";
    const isNullable =
      row.is_nullable ?? row.IS_NULLABLE ?? row.isNullable ?? "";
    const columnDefault =
      row.column_default ?? row.COLUMN_DEFAULT ?? row.columnDefault ?? null;
    const charMax =
      row.character_maximum_length ??
      row.CHARACTER_MAXIMUM_LENGTH ??
      row.characterMaximumLength ??
      null;
    const numericPrecision =
      row.numeric_precision ??
      row.NUMERIC_PRECISION ??
      row.numericPrecision ??
      null;
    const numericScale =
      row.numeric_scale ?? row.NUMERIC_SCALE ?? row.numericScale ?? null;
    const extra =
      row.extra ?? row.EXTRA ?? row.extra_info ?? row.extraInfo ?? "";
    const primaryRaw =
      row.is_primary_key ?? row.IS_PRIMARY_KEY ?? row.isPrimaryKey ?? false;
    const foreignRaw =
      row.is_foreign_key ?? row.IS_FOREIGN_KEY ?? row.isForeignKey ?? false;

    const isPrimary =
      typeof primaryRaw === "boolean"
        ? primaryRaw
        : Boolean(Number(primaryRaw)) ||
          String(primaryRaw).toLowerCase() === "true";
    const isForeign =
      typeof foreignRaw === "boolean"
        ? foreignRaw
        : Boolean(Number(foreignRaw)) ||
          String(foreignRaw).toLowerCase() === "true";

    return {
      column_name: String(columnName || ""),
      data_type: String(dataType || ""),
      column_type: String(columnType || ""),
      is_nullable: String(isNullable || ""),
      column_default: columnDefault,
      character_maximum_length: charMax,
      numeric_precision: numericPrecision,
      numeric_scale: numericScale,
      extra,
      is_primary_key: isPrimary,
      is_foreign_key: isForeign,
    };
  });
}

export async function getTablePrimaryKey(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sql = `
    SELECT column_name AS name
    FROM information_schema.key_column_usage
    WHERE table_schema = ?
      AND table_name = ?
      AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position;
  `;
  const result = await executeMysqlQuery(connectionString, sql, [
    schema,
    table,
  ]);
  const first = result.rows[0] as any;
  return first?.name ?? first?.column_name ?? first?.COLUMN_NAME ?? null;
}

async function getTablePrimaryKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sql = `
    SELECT column_name AS name
    FROM information_schema.key_column_usage
    WHERE table_schema = ?
      AND table_name = ?
      AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position;
  `;
  const result = await executeMysqlQuery(connectionString, sql, [
    schema,
    table,
  ]);
  return result.rows
    .map((r: any) => r.name ?? r.column_name ?? r.COLUMN_NAME)
    .filter(Boolean);
}

export async function getTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const sql = `
    SELECT
      kcu.column_name AS column_name,
      kcu.referenced_table_schema AS foreign_table_schema,
      kcu.referenced_table_name AS foreign_table_name,
      kcu.referenced_column_name AS foreign_column_name
    FROM information_schema.key_column_usage kcu
    WHERE kcu.table_schema = ?
      AND kcu.table_name = ?
      AND kcu.referenced_table_name IS NOT NULL
    ORDER BY kcu.constraint_name, kcu.ordinal_position;
  `;

  const result = await executeMysqlQuery(connectionString, sql, [
    schema,
    table,
  ]);
  return result.rows;
}

export async function deleteRows(
  connectionString: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValues: any[],
) {
  const q = buildDeleteByIdsQuery(quoteMysqlIdentifier, () => "?", schema, table, pkColumn, pkValues);
  if (!q) return { rows: [], fields: [], rowCount: 0 };
  return await executeMysqlQuery(connectionString, q.sql, q.params);
}

export async function updateRows(
  connectionString: string,
  schema: string,
  table: string,
  updates: Array<{ where: Record<string, any>; set: Record<string, any> }>,
) {
  const { connection, tunnel } = await createMysqlConnection(connectionString, {
    multipleStatements: false,
  });

  try {
    await connection.beginTransaction();

    for (const update of updates) {
      const setClauses: string[] = [];
      const values: any[] = [];

      for (const [col, val] of Object.entries(update.set)) {
        setClauses.push(`${quoteIdentifier(col)} = ?`);
        values.push(val);
      }

      const whereClauses: string[] = [];
      for (const [col, val] of Object.entries(update.where)) {
        whereClauses.push(`${quoteIdentifier(col)} = ?`);
        values.push(val);
      }

      const sql = `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
      await connection.execute(sql, values);
    }

    await connection.commit();
    return { success: true };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    try {
      await connection.end();
    } catch {}
    try {
      await tunnel.close();
    } catch {}
  }
}

export async function getAllTablesWithColumns(
  connectionString: string,
  schema?: string,
) {
  const schemaFilter = schema ? String(schema) : "";
  const sql = `
    SELECT
      cols.table_schema AS table_schema,
      cols.table_name AS table_name,
      cols.column_name AS column_name,
      cols.data_type AS data_type,
      cols.is_nullable AS is_nullable,
      cols.column_default AS column_default,
      (cols.column_key = 'PRI') AS is_primary,
      kcu.referenced_table_schema AS referenced_table_schema,
      kcu.referenced_table_name AS referenced_table_name,
      kcu.referenced_column_name AS referenced_column_name
    FROM information_schema.columns cols
    LEFT JOIN information_schema.key_column_usage kcu
      ON cols.table_schema = kcu.table_schema
      AND cols.table_name = kcu.table_name
      AND cols.column_name = kcu.column_name
      AND kcu.referenced_table_name IS NOT NULL
    WHERE cols.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
    ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position;
  `;

  const res = schemaFilter
    ? await executeMysqlQuery(
        connectionString,
        `${sql.replace("WHERE cols.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')", "WHERE cols.table_schema = ?")}`,
        [schemaFilter],
      )
    : await executeMysqlQuery(connectionString, sql);
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  return rows
    .map((row: any) => {
      const tableSchema =
        row.table_schema ?? row.TABLE_SCHEMA ?? row.tableSchema ?? "";
      const tableName = row.table_name ?? row.TABLE_NAME ?? row.tableName ?? "";
      const columnName =
        row.column_name ?? row.COLUMN_NAME ?? row.columnName ?? "";
      const dataType = row.data_type ?? row.DATA_TYPE ?? row.dataType ?? "";
      const isNullable =
        row.is_nullable ?? row.IS_NULLABLE ?? row.isNullable ?? "";
      const columnDefault =
        row.column_default ?? row.COLUMN_DEFAULT ?? row.columnDefault ?? null;
      const isPrimaryRaw =
        row.is_primary ?? row.IS_PRIMARY ?? row.isPrimary ?? false;
      const refSchema =
        row.referenced_table_schema ??
        row.REFERENCED_TABLE_SCHEMA ??
        row.referencedTableSchema ??
        null;
      const refTable =
        row.referenced_table_name ??
        row.REFERENCED_TABLE_NAME ??
        row.referencedTableName ??
        null;
      const refColumn =
        row.referenced_column_name ??
        row.REFERENCED_COLUMN_NAME ??
        row.referencedColumnName ??
        null;

      const isPrimary =
        typeof isPrimaryRaw === "boolean"
          ? isPrimaryRaw
          : Boolean(Number(isPrimaryRaw)) ||
            String(isPrimaryRaw).toLowerCase() === "true";

      return {
        table_schema: String(tableSchema || ""),
        table_name: String(tableName || ""),
        column_name: String(columnName || ""),
        data_type: String(dataType || ""),
        is_nullable: String(isNullable || ""),
        column_default: columnDefault,
        is_primary: isPrimary,
        referenced_table_schema: refSchema,
        referenced_table_name: refTable,
        referenced_column_name: refColumn,
      };
    })
    .filter((row) => row.table_schema && row.table_name && row.column_name);
}

function isMysqlConnectionString(connectionString: string) {
  const raw = String(connectionString || "")
    .trim()
    .toLowerCase();
  return (
    raw.startsWith("mysql://") ||
    raw.startsWith("mariadb://") ||
    raw.startsWith("mysql:/") ||
    raw.startsWith("mariadb:/")
  );
}
