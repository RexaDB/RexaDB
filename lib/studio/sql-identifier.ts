import { quoteIdentifier, type SqlDialect } from "@/lib/db/quote-identifier";

/**
 * Helpers for inserting table/column names into the SQL editor so they work
 * as typed: names that the dialect would case-fold, reserved words, and names
 * with special characters are quoted; plain names are left alone.
 */

// Words that cannot be used as bare identifiers in the common dialects.
const RESERVED_WORDS = new Set([
  "all", "alter", "and", "any", "as", "asc", "between", "by", "case", "check",
  "column", "constraint", "create", "cross", "current_date", "current_time",
  "current_timestamp", "current_user", "default", "delete", "desc", "distinct",
  "drop", "else", "end", "except", "exists", "false", "fetch", "for", "foreign",
  "from", "full", "grant", "group", "having", "in", "index", "inner", "insert",
  "intersect", "into", "is", "join", "key", "left", "like", "limit", "natural",
  "not", "null", "offset", "on", "or", "order", "outer", "primary", "references",
  "right", "select", "session_user", "set", "table", "then", "to", "true",
  "union", "unique", "update", "user", "using", "values", "when", "where", "with",
]);

type CaseFolding = "lower" | "upper" | "none";

function getQuoteDialect(dbType: string): SqlDialect {
  switch (dbType) {
    case "mysql":
    case "clickhouse":
    case "mssql":
    case "sqlite":
    case "duckdb":
    case "oracle":
      return dbType;
    default:
      return "postgres";
  }
}

function getCaseFolding(dbType: string): CaseFolding {
  switch (dbType) {
    case "postgres":
    case "trino":
    case "federated":
    case "spacetimedb":
      return "lower";
    case "oracle":
      return "upper";
    default:
      return "none";
  }
}

export function sqlIdentifierNeedsQuotes(name: string, dbType: string): boolean {
  if (!name) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return true;
  if (RESERVED_WORDS.has(name.toLowerCase())) return true;
  const folding = getCaseFolding(dbType);
  if (folding === "lower") return name !== name.toLowerCase();
  if (folding === "upper") return name !== name.toUpperCase();
  return false;
}

/** Quote `name` for `dbType` only when it would not work unquoted. */
export function formatSqlIdentifier(name: string, dbType: string): string {
  if (!sqlIdentifierNeedsQuotes(name, dbType)) return name;
  return quoteIdentifier(name, getQuoteDialect(dbType));
}

/** Format a `schema.table` reference, quoting each part independently. */
export function formatQualifiedSqlIdentifier(
  parts: Array<string | null | undefined>,
  dbType: string,
): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => formatSqlIdentifier(part, dbType))
    .join(".");
}

/** The opening/closing characters used to quote identifiers in `dbType`. */
export function getSqlIdentifierQuoteChars(dbType: string): [string, string] {
  switch (getQuoteDialect(dbType)) {
    case "mysql":
    case "clickhouse":
      return ["`", "`"];
    case "mssql":
      return ["[", "]"];
    default:
      return ['"', '"'];
  }
}

/** Strip identifier quotes (`"x"`, `` `x` ``, `[x]`) and un-double escaped quotes. */
export function unquoteSqlIdentifier(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') return value.slice(1, -1).replace(/""/g, '"');
    if (first === "`" && last === "`") return value.slice(1, -1).replace(/``/g, "`");
    if (first === "[" && last === "]") return value.slice(1, -1).replace(/]]/g, "]");
  }
  return value;
}

/** Quote `name` for `dbType` unconditionally (used when the user opened a quote). */
export function quoteSqlIdentifierAlways(name: string, dbType: string): string {
  return quoteIdentifier(name, getQuoteDialect(dbType));
}
