// fallow-ignore-file code-duplication
/**
 * Dialect-specific identifier quoting utilities.
 *
 * Each SQL dialect quotes identifiers differently:
 * - PostgreSQL / SQLite   → "double quotes" with doubled inside
 * - MySQL / ClickHouse    → `backticks` with doubled inside
 * - MSSQL                → [brackets] with doubled inside
 */

export type SqlDialect = "postgres" | "sqlite" | "mysql" | "clickhouse" | "mssql" | "duckdb";

/**
 * Quote an identifier (table name, column name, etc.) for the given dialect.
 * Throws if `value` contains a NUL byte or is empty.
 */
export function quoteIdentifier(value: string, dialect: SqlDialect): string {
  const raw = String(value ?? "");
  if (raw.length === 0) {
    throw new Error("Cannot quote an empty identifier");
  }
  if (raw.includes("\0")) {
    throw new Error("Identifier contains NUL byte");
  }

  switch (dialect) {
    case "postgres":
    case "sqlite":
    case "duckdb":
      return `"${raw.replace(/"/g, '""')}"`;

    case "mysql":
    case "clickhouse":
      return `\`${raw.replace(/`/g, "``")}\``;

    case "mssql":
      return `[${raw.replace(/]/g, "]]")}]`;

    default:
      throw new Error(`Unknown SQL dialect: ${dialect}`);
  }
}

/**
 * Convenience aliases so call sites read naturally.
 */
export const quotePgIdentifier = (v: string) => quoteIdentifier(v, "postgres");
export const quoteSqliteIdentifier = (v: string) => quoteIdentifier(v, "sqlite");
export const quoteMysqlIdentifier = (v: string) => quoteIdentifier(v, "mysql");
export const quoteClickhouseIdentifier = (v: string) => quoteIdentifier(v, "clickhouse");
export const quoteMssqlIdentifier = (v: string) => quoteIdentifier(v, "mssql");
export const quoteDuckdbIdentifier = (v: string) => quoteIdentifier(v, "duckdb");

// ─── Query pattern helpers ──────────────────────────────────────────────

/**
 * Build WHERE conditions and parameter values from a key→value map.
 * Returns `null` when `keyValues` is empty (caller should short-circuit).
 */
// fallow-ignore-next-line code-duplication
export function buildKeyConditions(
  quoteFn: (s: string) => string,
  keyValues: Record<string, unknown>,
): { conditions: string[]; values: unknown[] } | null {
  const entries = Object.entries(keyValues || {}).filter(([key]) => key);
  if (entries.length === 0) return null;
  const conditions: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of entries) {
    if (val === null) {
      conditions.push(`${quoteFn(key)} IS NULL`);
    } else {
      conditions.push(`${quoteFn(key)} = ?`);
      values.push(val);
    }
  }
  return { conditions, values };
}

/**
 * Build a DELETE … IN query with the given placeholder maker.
 * Returns `null` when `pkValues` is empty (caller should short-circuit).
 */
export function buildDeleteByIdsQuery(
  quoteFn: (s: string) => string,
  makePlaceholder: (index: number) => string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValues: unknown[],
): { sql: string; params: unknown[] } | null {
  if (!pkValues.length) return null;
  const placeholders = pkValues.map((_, i) => makePlaceholder(i)).join(", ");
  const sql = `DELETE FROM ${quoteFn(schema)}.${quoteFn(table)} WHERE ${quoteFn(pkColumn)} IN (${placeholders})`;
  return { sql, params: pkValues };
}

/**
 * Check whether a SQL string is a SELECT-like query (returns rows).
 */
export function isSelectLikeQuery(query: string): boolean {
  return /^\s*(select|with|show|describe|desc|explain|pragma)\b/i.test(query);
}
