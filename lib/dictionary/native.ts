// Native database comments (Postgres `COMMENT ON`, MySQL
// `information_schema` comments), read and written through the existing
// query-execution path (`runQuery` -> /api/sql/run). No sidecar changes:
// these are ordinary SQL statements, not new endpoints.
//
// The local dictionary overlay always wins over native comments when both
// exist; native comments are the shared-with-the-team layer.

import { runQuery } from "@/lib/api/actions-client";
import type { NativeCommentMaps } from "./types";

function escapeLiteral(value: string): string {
  return String(value || "").replace(/'/g, "''");
}

function escapeIdentifier(value: string): string {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function escapeMysqlIdentifier(value: string): string {
  return `\`${String(value || "").replace(/`/g, "``")}\``;
}

type QueryRows = Array<Record<string, unknown>>;

async function runRead(
  connectionString: string,
  query: string,
  connectionType?: string,
): Promise<QueryRows> {
  const res = await runQuery(connectionString, query, [], undefined, connectionType);
  if (!res?.success) {
    throw new Error(String(res?.error || "Native comment query failed."));
  }
  const data = res.data as unknown;
  if (Array.isArray(data)) return data as QueryRows;
  if (data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: QueryRows }).rows;
  }
  return [];
}

function cell(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value !== null && value !== undefined && String(value) !== "") {
      return String(value);
    }
  }
  return "";
}

export async function fetchNativeComments(
  connectionString: string,
  dbType: string,
  schema: string,
): Promise<NativeCommentMaps> {
  const normalized = String(dbType || "").toLowerCase();
  const empty: NativeCommentMaps = { tables: {}, columns: {} };
  if (!schema) return empty;

  try {
    if (normalized === "postgres" || normalized === "postgresql" || normalized === "supabase-mgmt") {
      const schemaLit = escapeLiteral(schema);
      const tableRows = await runRead(
        connectionString,
        `SELECT n.nspname AS "schema", c.relname AS "table", obj_description(c.oid) AS "comment" ` +
          `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ` +
          `WHERE c.relkind IN ('r', 'v', 'm', 'f') AND n.nspname = '${schemaLit}' ` +
          `AND obj_description(c.oid) IS NOT NULL`,
        "postgres",
      );
      const columnRows = await runRead(
        connectionString,
        `SELECT n.nspname AS "schema", c.relname AS "table", a.attname AS "column", ` +
          `col_description(c.oid, a.attnum) AS "comment" ` +
          `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ` +
          `JOIN pg_attribute a ON a.attrelid = c.oid ` +
          `WHERE c.relkind IN ('r', 'v', 'm', 'f') AND n.nspname = '${schemaLit}' ` +
          `AND a.attnum > 0 AND NOT a.attisdropped ` +
          `AND col_description(c.oid, a.attnum) IS NOT NULL`,
        "postgres",
      );
      const maps: NativeCommentMaps = { tables: {}, columns: {} };
      for (const row of tableRows) {
        const comment = cell(row, "comment");
        if (comment) maps.tables[`${cell(row, "schema")}.${cell(row, "table")}`] = comment;
      }
      for (const row of columnRows) {
        const comment = cell(row, "comment");
        if (comment) {
          maps.columns[`${cell(row, "schema")}.${cell(row, "table")}.${cell(row, "column")}`] = comment;
        }
      }
      return maps;
    }

    if (normalized === "mysql" || normalized === "mariadb") {
      const schemaLit = escapeLiteral(schema);
      const tableRows = await runRead(
        connectionString,
        `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, TABLE_COMMENT AS \`comment\` ` +
          `FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${schemaLit}' ` +
          `AND TABLE_COMMENT IS NOT NULL AND TABLE_COMMENT != ''`,
        "mysql",
      );
      const columnRows = await runRead(
        connectionString,
        `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`, ` +
          `COLUMN_COMMENT AS \`comment\` FROM information_schema.COLUMNS ` +
          `WHERE TABLE_SCHEMA = '${schemaLit}' ` +
          `AND COLUMN_COMMENT IS NOT NULL AND COLUMN_COMMENT != ''`,
        "mysql",
      );
      const maps: NativeCommentMaps = { tables: {}, columns: {} };
      for (const row of tableRows) {
        const comment = cell(row, "comment");
        if (comment) maps.tables[`${cell(row, "schema")}.${cell(row, "table")}`] = comment;
      }
      for (const row of columnRows) {
        const comment = cell(row, "comment");
        if (comment) {
          maps.columns[`${cell(row, "schema")}.${cell(row, "table")}.${cell(row, "column")}`] = comment;
        }
      }
      return maps;
    }
  } catch {
    // Native comments are best-effort (permissions, older servers).
    return empty;
  }
  return empty;
}

/** Write a Postgres COMMENT. Empty comment drops it (`IS NULL`). MySQL
 *  column comments require a full column redefinition, so native write is
 *  Postgres-only; MySQL stays local-overlay. */
export async function setPostgresComment(args: {
  connectionString: string;
  kind: "table" | "column";
  schema: string;
  table: string;
  column?: string;
  comment: string;
}): Promise<{ success: boolean; error?: string }> {
  const target =
    args.kind === "table"
      ? `TABLE ${escapeIdentifier(args.schema)}.${escapeIdentifier(args.table)}`
      : `COLUMN ${escapeIdentifier(args.schema)}.${escapeIdentifier(args.table)}.${escapeIdentifier(args.column || "")}`;
  const commentSql = args.comment.trim()
    ? `'${escapeLiteral(args.comment.trim())}'`
    : "NULL";
  const res = await runQuery(
    args.connectionString,
    `COMMENT ON ${target} IS ${commentSql}`,
    [],
    undefined,
    "postgres",
  );
  if (!res?.success) {
    return { success: false, error: String(res?.error || "COMMENT ON failed.") };
  }
  return { success: true };
}

export { escapeMysqlIdentifier };
