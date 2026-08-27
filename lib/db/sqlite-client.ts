import path from "path";
import fs from "fs";
import os from "os";
import { quoteSqliteIdentifier, buildKeyConditions } from "./quote-identifier";

type SqliteField = { name: string; dataTypeID: number; dataTypeName: string };

interface SqliteTableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
}

type SqlitePrimitive = string | number | bigint | boolean | null | Uint8Array;

interface SqliteDriver {
  all: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>;
  get: (
    sql: string,
    args?: unknown[],
  ) => Promise<Record<string, unknown> | null>;
  run: (sql: string, args?: unknown[]) => Promise<{ changes: number }>;
  close: () => Promise<void>;
}

interface SqliteTarget {
  mode: "local" | "remote";
  localPath?: string;
  remoteUrl?: string;
  authToken?: string;
}

function toPlainValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map((item) => toPlainValue(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = toPlainValue(nested);
    }
    return out;
  }
  return value;
}

function toPlainRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = toPlainValue(value);
  }
  return out;
}

function toPlainRows(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => toPlainRow(row));
}

function quoteIdentifier(value: string) {
  return quoteSqliteIdentifier(value);
}

function effectiveSchema(schema: string): string {
  const s = String(schema || "").trim();
  return s ? s : "main";
}

function normalizeFsPath(decodedPath: string) {
  if (/^\/[a-zA-Z]:\//.test(decodedPath)) {
    return decodedPath.slice(1);
  }
  return decodedPath;
}

function parseFileUriPath(input: string) {
  const parsed = new URL(input);
  if (parsed.protocol !== "file:") {
    throw new Error("Only file: URIs are supported for SQLite.");
  }
  return normalizeFsPath(decodeURIComponent(parsed.pathname || ""));
}

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace(/^~/, os.homedir());
  }
  return filePath;
}

function getWritableDir(): string {
  const envDir = process.env.REXADB_USER_DATA_DIR;
  if (envDir) return envDir;
  const home = os.homedir();
  if (home) {
    const appDir = path.join(home, ".rexadb");
    try {
      fs.mkdirSync(appDir, { recursive: true });
      return appDir;
    } catch {}
  }
  return process.cwd();
}

function resolveRelative(raw: string): string {
  const base = getWritableDir();
  return path.resolve(base, raw);
}

function resolveSqlitePath(connectionString: string) {
  let raw = String(connectionString || "").trim();
  if (!raw) {
    throw new Error("SQLite connection string is required.");
  }

  if (raw === ":memory:") {
    return raw;
  }

  if (raw.startsWith("sqlite://")) {
    raw = decodeURIComponent(raw.slice("sqlite://".length));
    if (!raw) throw new Error("SQLite file path is missing.");
    raw = expandHome(raw);
    if (path.isAbsolute(raw)) return raw;
    return resolveRelative(raw);
  }

  if (raw.startsWith("sqlite:")) {
    raw = decodeURIComponent(raw.slice("sqlite:".length));
    if (!raw) throw new Error("SQLite file path is missing.");
    raw = expandHome(raw);
    if (raw.startsWith("//")) {
      const fromUri = parseFileUriPath(`file:${raw}`);
      if (path.isAbsolute(fromUri)) return fromUri;
      return resolveRelative(fromUri);
    }
    if (path.isAbsolute(raw)) return raw;
    return resolveRelative(raw);
  }

  if (raw.startsWith("file:")) {
    const fromUri = parseFileUriPath(raw);
    if (path.isAbsolute(fromUri)) return fromUri;
    return resolveRelative(fromUri);
  }

  if (raw.includes("://")) {
    throw new Error("Unsupported SQLite connection string.");
  }

  raw = expandHome(raw);
  if (path.isAbsolute(raw)) return raw;
  return resolveRelative(raw);
}

function resolveSqliteTarget(connectionString: string): SqliteTarget {
  const raw = String(connectionString || "").trim();
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("libsql://") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://")
  ) {
    try {
      const parsed = new URL(raw);
      const authToken =
        parsed.searchParams.get("authToken") ||
        parsed.searchParams.get("auth_token") ||
        undefined;
      if (authToken) {
        parsed.searchParams.delete("authToken");
        parsed.searchParams.delete("auth_token");
      }
      return {
        mode: "remote",
        remoteUrl: parsed.toString(),
        authToken,
      };
    } catch {
      return {
        mode: "remote",
        remoteUrl: raw,
      };
    }
  }

  return {
    mode: "local",
    localPath: resolveSqlitePath(connectionString),
  };
}

function getDatabaseLabel(connectionString: string) {
  const target = resolveSqliteTarget(connectionString);
  if (target.mode === "remote") {
    try {
      const parsed = new URL(target.remoteUrl || "");
      return parsed.hostname || target.remoteUrl || "turso";
    } catch {
      return target.remoteUrl || "turso";
    }
  }
  const sqlitePath = target.localPath || resolveSqlitePath(connectionString);
  if (sqlitePath === ":memory:") return ":memory:";
  return path.basename(sqlitePath);
}

function normalizeSqliteArg(value: unknown): SqlitePrimitive {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function normalizeSqliteArgs(args?: unknown[]) {
  return Array.isArray(args) ? args.map(normalizeSqliteArg) : [];
}

function buildSqliteDriver(
  db: any,
  enablePragma: (db: any) => void,
): SqliteDriver {
  enablePragma(db);
  return {
    all: async (sql, args) => {
      const normalized = normalizeSqliteArgs(args);
      const stmt = db.prepare(sql);
      const rows = (normalized.length ? stmt.all(...normalized) : stmt.all()) as unknown[];
      return toPlainRows(rows);
    },
    get: async (sql, args) => {
      const normalized = normalizeSqliteArgs(args);
      const stmt = db.prepare(sql);
      const row = normalized.length ? stmt.get(...normalized) : stmt.get();
      return row ? toPlainRow(row as Record<string, unknown>) : null;
    },
    run: async (sql, args) => {
      const normalized = normalizeSqliteArgs(args);
      if (normalized.length > 0) {
        const info = db.prepare(sql).run(...normalized);
        return { changes: Number(info.changes || 0) };
      }
      // Use prepared statement; throw on failure instead of silently
      // falling back to db.exec() which loses parameterization.
      const info = db.prepare(sql).run();
      return { changes: Number(info.changes || 0) };
    },
    close: async () => {
      db.close();
    },
  };
}

async function createBunSqliteDriver(
  sqlitePath: string,
): Promise<SqliteDriver> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(sqlitePath);
  return buildSqliteDriver(db, (d) => d.run("PRAGMA foreign_keys = ON"));
}

function isBetterSqliteNativeLoadError(error: unknown) {
  const message = String((error as Error)?.message || error || "");
  return (
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("compiled against a different Node.js version") ||
    message.includes("better_sqlite3.node")
  );
}

async function createBetterSqliteDriver(
  sqlitePath: string,
): Promise<SqliteDriver> {
  const mod = await import("better-sqlite3");
  const BetterSqlite3 = ((mod as unknown as { default?: unknown }).default ??
    mod) as unknown as typeof import("better-sqlite3");

  const db = new BetterSqlite3(sqlitePath);
  return buildSqliteDriver(db, (d) => d.pragma("foreign_keys = ON"));
}

async function createLibsqlDriver(target: SqliteTarget): Promise<SqliteDriver> {
  const { createClient } = await import("@libsql/client/node");
  const url =
    target.mode === "remote"
      ? String(target.remoteUrl || "")
      : target.localPath === ":memory:"
        ? "file::memory:"
        : `file:${target.localPath}`;
  const client = createClient({
    url,
    authToken: target.authToken,
  });
  await client.execute("PRAGMA foreign_keys = ON");

  return {
    all: async (sql, args) => {
      const res = await client.execute({
        sql,
        args: normalizeSqliteArgs(args),
      });
      return toPlainRows(res.rows as unknown[]);
    },
    get: async (sql, args) => {
      const res = await client.execute({
        sql,
        args: normalizeSqliteArgs(args),
      });
      const rows = toPlainRows(res.rows as unknown[]);
      return rows[0] ?? null;
    },
    run: async (sql, args) => {
      const res = await client.execute({
        sql,
        args: normalizeSqliteArgs(args),
      });
      return { changes: Number(res.rowsAffected || 0) };
    },
    close: async () => {
      try {
        const maybeClose = (
          client as unknown as { close?: () => void | Promise<void> }
        ).close;
        await maybeClose?.();
      } catch {}
    },
  };
}

export async function createSqliteDriver(
  connectionString: string,
): Promise<SqliteDriver> {
  const target = resolveSqliteTarget(connectionString);
  if (target.mode === "remote") {
    return await createLibsqlDriver(target);
  }

  const sqlitePath = target.localPath || resolveSqlitePath(connectionString);
  if (sqlitePath !== ":memory:") {
    try {
      const dir = path.dirname(sqlitePath);
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw new Error(
        `Cannot create directory for SQLite DB at "${sqlitePath}": ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  try {
    return await createBunSqliteDriver(sqlitePath);
  } catch {
    // bun:sqlite unavailable (not running on Bun), fall back to better-sqlite3
  }
  try {
    return await createBetterSqliteDriver(sqlitePath);
  } catch (error) {
    if (!isBetterSqliteNativeLoadError(error)) throw error;
    console.warn(
      "SQLite native driver unavailable, falling back to libsql client.",
    );
    return await createLibsqlDriver(target);
  }
}

async function withDb<T>(
  connectionString: string,
  fn: (db: SqliteDriver) => Promise<T>,
): Promise<T> {
  const db = await createSqliteDriver(connectionString);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

function buildFieldList(rows: Record<string, unknown>[]): SqliteField[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "unknown",
  }));
}

function getOperation(query: string) {
  return (
    String(query || "")
      .trim()
      .match(/^\s*([a-z]+)/i)?.[1] || ""
  ).toUpperCase();
}

function assertSupportedSqliteStatement(query: string) {
  const trimmed = String(query || "").trim();
  if (/^CREATE\s+SCHEMA\b/i.test(trimmed)) {
    throw new Error(
      'SQLite does not support CREATE SCHEMA. Use ATTACH DATABASE to add another database, or create tables in "main".',
    );
  }
}

export async function executeSqliteQuery(
  connectionString: string,
  query: string,
  params: unknown[] = [],
) {
  return await withDb(connectionString, async (db) => {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return {
        rows: [] as Record<string, unknown>[],
        fields: [] as SqliteField[],
        rowCount: 0,
      };
    }
    assertSupportedSqliteStatement(trimmed);

    const operation = getOperation(trimmed);
    const isRowReturning = ["SELECT", "PRAGMA", "WITH", "EXPLAIN"].includes(
      operation,
    );

    if (isRowReturning) {
      const rows = await db.all(query, params);
      const fields = buildFieldList(rows);
      return {
        rows,
        fields,
        rowCount: rows.length,
      };
    }

    const info = await db.run(query, params);
    return {
      rows: [] as Record<string, unknown>[],
      fields: [] as SqliteField[],
      rowCount: Number(info.changes || 0),
    };
  });
}

export async function getSqliteTables(connectionString: string, schema: string) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const rows = await db.all(
      `SELECT name FROM ${quoteIdentifier(s)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return rows.map((row) => String(row.name));
  });
}

export async function getSqliteViews(connectionString: string, schema: string) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const rows = await db.all(
      `SELECT name FROM ${quoteIdentifier(s)}.sqlite_master WHERE type = 'view' ORDER BY name`,
    );
    return rows.map((row) => String(row.name));
  });
}

export async function getSqliteSchemas(connectionString: string) {
  return await withDb(connectionString, async (db) => {
    const rows = await db.all("PRAGMA database_list;");
    return rows.map((row) => String(row.name)).filter(Boolean);
  });
}

export async function getSqliteDatabases(connectionString: string) {
  return [getDatabaseLabel(connectionString)];
}

export async function getSqliteTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const tableInfo = (await db.all(
      `PRAGMA ${quoteIdentifier(s)}.table_info(${quoteIdentifier(table)});`,
    )) as unknown as SqliteTableInfoRow[];
    const foreignKeys = (await db.all(
      `PRAGMA ${quoteIdentifier(s)}.foreign_key_list(${quoteIdentifier(table)});`,
    )) as unknown as SqliteForeignKeyRow[];
    const fkColumns = new Set(foreignKeys.map((fk) => fk.from));

    return tableInfo.map((column) => ({
      column_name: column.name,
      data_type: column.type || "TEXT",
      is_nullable: column.notnull ? "NO" : "YES",
      column_default: column.dflt_value,
      is_primary_key: Number(column.pk || 0) > 0,
      is_foreign_key: fkColumns.has(column.name),
    }));
  });
}

export async function getSqlitePrimaryKey(
  connectionString: string,
  schema: string,
  table: string,
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const tableInfo = (await db.all(
      `PRAGMA ${quoteIdentifier(s)}.table_info(${quoteIdentifier(table)});`,
    )) as unknown as SqliteTableInfoRow[];
    const orderedPkColumns = tableInfo
      .filter((column) => Number(column.pk || 0) > 0)
      .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0));
    return orderedPkColumns[0]?.name || null;
  });
}

export async function getSqliteForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const foreignKeys = (await db.all(
      `PRAGMA ${quoteIdentifier(s)}.foreign_key_list(${quoteIdentifier(table)});`,
    )) as unknown as SqliteForeignKeyRow[];
    return foreignKeys.map((fk) => ({
      column_name: fk.from,
      foreign_table_schema: schema,
      foreign_table_name: fk.table,
      foreign_column_name: fk.to,
    }));
  });
}

export async function deleteSqliteRows(
  connectionString: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValues: unknown[],
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const tableRef = `${quoteIdentifier(s)}.${quoteIdentifier(table)}`;
    const placeholders = pkValues.map(() => "?").join(", ");
    const info = await db.run(
      `DELETE FROM ${tableRef} WHERE ${quoteIdentifier(pkColumn)} IN (${placeholders})`,
      pkValues,
    );
    return { rowCount: Number(info.changes || 0) };
  });
}

export async function updateSqliteRows(
  connectionString: string,
  schema: string,
  table: string,
  updates: Array<{
    where: Record<string, unknown>;
    set: Record<string, unknown>;
  }>,
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const tableRef = `${quoteIdentifier(s)}.${quoteIdentifier(table)}`;
    await db.run("BEGIN");
    try {
      for (const update of updates) {
        const setEntries = Object.entries(update.set);
        const whereEntries = Object.entries(update.where);
        if (setEntries.length === 0 || whereEntries.length === 0) continue;

        const setClause = setEntries
          .map(([name]) => `${quoteIdentifier(name)} = ?`)
          .join(", ");
        const whereClause = whereEntries
          .map(([name]) => `${quoteIdentifier(name)} = ?`)
          .join(" AND ");
        const values = [
          ...setEntries.map(([, value]) => value),
          ...whereEntries.map(([, value]) => value),
        ];
        await db.run(
          `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`,
          values,
        );
      }
      await db.run("COMMIT");
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
    return { success: true };
  });
}

export async function getSqliteReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
) {
  return await withDb(connectionString, async (db) => {
    const s = effectiveSchema(schema);
    const tableRef = `${quoteIdentifier(s)}.${quoteIdentifier(table)}`;

    const result = buildKeyConditions(quoteIdentifier, keyValues);
    if (!result) return { row: null, fields: [] };
    const row = await db.get(
      `SELECT * FROM ${tableRef} WHERE ${result.conditions.join(" AND ")} LIMIT 1`,
      result.values,
    );
    const fields = row
      ? Object.keys(row).map((name) => ({
          name,
          dataTypeID: 0,
          dataTypeName: "unknown",
        }))
      : [];
    return { row, fields };
  });
}

export async function getSqliteAllTablesWithColumns(
  connectionString: string,
  schema?: string,
) {
  return await withDb(connectionString, async (db) => {
    const schemas = await db.all("PRAGMA database_list;");
    const rows: Array<Record<string, unknown>> = [];

    const schemaFilter = schema ? String(schema) : "";

    for (const schemaRow of schemas) {
      const schemaName = String(schemaRow.name || "main");
      if (schemaFilter && schemaName !== schemaFilter) continue;
      const tables = await db.all(
        `SELECT name FROM ${quoteIdentifier(schemaName)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );

      for (const tableRow of tables) {
        const tableName = String(tableRow.name);
        const tableInfo = (await db.all(
          `PRAGMA ${quoteIdentifier(schemaName)}.table_info(${quoteIdentifier(tableName)});`,
        )) as unknown as SqliteTableInfoRow[];
        const foreignKeys = (await db.all(
          `PRAGMA ${quoteIdentifier(schemaName)}.foreign_key_list(${quoteIdentifier(tableName)});`,
        )) as unknown as SqliteForeignKeyRow[];
        const fkMap = new Map<string, SqliteForeignKeyRow>();
        for (const fk of foreignKeys) {
          if (!fkMap.has(fk.from)) fkMap.set(fk.from, fk);
        }

        for (const column of tableInfo) {
          const fk = fkMap.get(column.name);
          rows.push({
            table_schema: schemaName,
            table_name: tableName,
            column_name: column.name,
            data_type: column.type || "TEXT",
            is_nullable: column.notnull ? "NO" : "YES",
            column_default: column.dflt_value,
            is_primary: Number(column.pk || 0) > 0,
            referenced_table_schema: fk ? schemaName : null,
            referenced_table_name: fk?.table ?? null,
            referenced_column_name: fk?.to ?? null,
          });
        }
      }
    }

    return rows;
  });
}
