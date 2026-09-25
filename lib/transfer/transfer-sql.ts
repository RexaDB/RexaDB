/**
 * Shared SQL helpers for transfer adapters.
 *
 * Centralizes the two things Greptile flagged in PR #5:
 * - source values interpolated into destination SQL (identifiers AND literals)
 * - naive `dataSql.split(";")` which breaks on semicolons inside string literals
 */

export type QueryFnResult = {
  success: boolean;
  data?: { rows?: Array<Record<string, unknown>> };
  error?: unknown;
};

export type QueryFn = (
  connectionString: string,
  sql: string,
) => Promise<QueryFnResult>;

/** Quote a Postgres identifier (schema / table / column name from source data). */
export function escapeIdent(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Quote a string as a SQL literal. */
export function escapeLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Render a JS value as a SQL literal for INSERT statements. */
export function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "string") return escapeLiteral(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") {
    return Number.isFinite(val) ? String(val) : "NULL";
  }
  if (typeof val === "bigint") return String(val);
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? "NULL" : escapeLiteral(val.toISOString());
  }
  if (
    typeof Buffer !== "undefined" &&
    typeof (Buffer as unknown as { isBuffer?: (v: unknown) => boolean }).isBuffer === "function" &&
    (Buffer as unknown as { isBuffer: (v: unknown) => boolean }).isBuffer(val)
  ) {
    return escapeLiteral(`\\x${(val as unknown as { toString: (enc: string) => string }).toString("hex")}`);
  }
  // JSON / arrays / objects / unknown driver types
  try {
    return escapeLiteral(JSON.stringify(val));
  } catch {
    return escapeLiteral(String(val));
  }
}

export function qualifiedTable(schema: string, table: string): string {
  return `${escapeIdent(schema)}.${escapeIdent(table)}`;
}

/**
 * Split SQL text into individual statements, respecting single-quoted
 * literals (with '' escapes), double-quoted identifiers, dollar-quoted
 * function bodies, and -- line comments. A naive split(";") corrupts any
 * statement containing a semicolon inside a string.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let dollarTag: string | null = null;

  const startsDollarQuote = (s: string, pos: number): string | null => {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/.exec(s.slice(pos));
    return m ? m[0] : null;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    // -- line comment: consume to end of line
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // single-quoted literal
    if (ch === "'") {
      if (next === "'") {
        current += "''";
        i += 2;
      } else {
        // find closing quote honoring '' escapes
        current += ch;
        i++;
        while (i < sql.length) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            current += "''";
            i += 2;
            continue;
          }
          current += sql[i];
          if (sql[i] === "'") {
            i++;
            break;
          }
          i++;
        }
      }
      continue;
    }

    // double-quoted identifier
    if (ch === '"') {
      current += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          current += '""';
          i += 2;
          continue;
        }
        current += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    const tag = ch === "$" ? startsDollarQuote(sql, i) : null;
    if (tag) {
      dollarTag = tag;
      current += tag;
      i += tag.length;
      continue;
    }

    if (ch === ";") {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  // Drop trailing comment-only tails (e.g. "-- Data for x" with no statement)
  if (tail && !/^--[^\n]*$/.test(tail)) statements.push(tail);
  return statements;
}

/** Tables larger than this are skipped for row-data export (schema still migrates). */
export const MAX_DATA_EXPORT_ROWS = 10_000;

export async function exportTableDataSql(
  query: QueryFn,
  connectionString: string,
  schema: string,
  table: string,
  rowCount: number,
): Promise<{ sql: string; exportedRows: number }> {
  if (rowCount <= 0 || rowCount >= MAX_DATA_EXPORT_ROWS) {
    if (rowCount >= MAX_DATA_EXPORT_ROWS) {
      console.warn(
        `Skipping data export for ${schema}.${table} (${rowCount} rows exceeds limit of ${MAX_DATA_EXPORT_ROWS})`,
      );
    }
    return { sql: "", exportedRows: 0 };
  }
  try {
    const dataResult = await query(
      connectionString,
      `SELECT * FROM ${qualifiedTable(schema, table)}`,
    );
    const rows = dataResult.success ? (dataResult.data?.rows ?? []) : [];
    if (!dataResult.success || rows.length === 0) {
      if (!dataResult.success) {
        console.warn(`Failed to export data for ${schema}.${table}:`, dataResult.error);
      }
      return { sql: "", exportedRows: 0 };
    }
    const columns = Object.keys(rows[0]);
    const target = qualifiedTable(schema, table);
    const colList = columns.map(escapeIdent).join(", ");
    const lines = rows.map(
      (row) =>
        `INSERT INTO ${target} (${colList}) VALUES (${columns.map((c) => formatSqlValue(row[c])).join(", ")});`,
    );
    return {
      sql: `-- Data for ${schema}.${table} (${rows.length} rows)\n${lines.join("\n")}\n`,
      exportedRows: rows.length,
    };
  } catch (error) {
    console.warn(`Failed to export data for ${schema}.${table}:`, error);
    return { sql: "", exportedRows: 0 };
  }
}

/**
 * Apply a dataSql bundle statement-by-statement. Returns the count of failed
 * statements so callers can surface it instead of silently succeeding.
 */
export async function applyDataSql(
  query: QueryFn,
  connectionString: string,
  dataSql: string,
): Promise<{ applied: number; failed: number; errors: string[] }> {
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const statement of splitSqlStatements(dataSql)) {
    // Skip pure comment lines that survived splitting
    if (/^--/.test(statement)) continue;
    try {
      const result = await query(connectionString, statement);
      if (result.success) {
        applied++;
      } else {
        failed++;
        const msg = String(result.error ?? "unknown error");
        errors.push(msg);
        console.warn("Failed to import data statement:", msg);
      }
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(msg);
      console.warn("Failed to import data statement:", msg);
    }
  }
  return { applied, failed, errors };
}
