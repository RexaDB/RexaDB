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

/**
 * Environment-aware query runner for transfer code.
 *
 * Dual-use modules (`storage-utils`, `auth/fetch`) run in BOTH the browser
 * and the server process, so this function cannot reference server-only
 * modules directly — that would drag pg drivers into client bundles.
 * Instead the server implementation is injected via
 * `registerTransferQuery()` (see `transfer-server-query`, imported by the
 * server-only adapters). In the browser the HTTP client is used.
 */
let serverQueryImpl: QueryFn | null = null;

export function registerTransferQuery(fn: QueryFn): void {
  serverQueryImpl = fn;
}

export async function transferQuery(
  connectionString: string,
  sql: string,
): Promise<QueryFnResult> {
  if (typeof window !== "undefined") {
    const { runQuery } = await import("@/lib/api/actions-client");
    const res = (await runQuery(connectionString, sql)) as unknown as QueryFnResult;
    return {
      success: !!res?.success,
      data: res?.data,
      error: res?.error,
    };
  }
  if (!serverQueryImpl) {
    throw new Error(
      "transferQuery() used server-side before the server query implementation was registered " +
        "(import @/lib/transfer/transfer-server-query in server entry points).",
    );
  }
  return serverQueryImpl(connectionString, sql);
}

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
  return formatValueWithType(val, undefined);
}

function isBufferLike(val: unknown): { hex: string } | null {
  // Real Node Buffer
  if (
    typeof val === "object" &&
    val !== null &&
    typeof (val as { toString?: unknown }).toString === "function" &&
    (val as { constructor?: { name?: string } }).constructor?.name === "Buffer"
  ) {
    try {
      const hex = (val as unknown as { toString: (enc: string) => string }).toString("hex");
      if (/^[0-9a-fA-F]*$/.test(hex)) return { hex: hex.toLowerCase() };
    } catch {
      return null;
    }
  }
  // Buffer serialized through JSON: { type: "Buffer", data: [...] }
  if (typeof val === "object" && val !== null) {
    const obj = val as { type?: unknown; data?: unknown };
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      try {
        const bytes = Uint8Array.from(obj.data as ArrayLike<number>);
        let hex = "";
        for (const b of bytes) hex += (b & 0xff).toString(16).padStart(2, "0");
        return { hex };
      } catch {
        return null;
      }
    }
    if (val instanceof Uint8Array) {
      let hex = "";
      for (const b of val) hex += (b & 0xff).toString(16).padStart(2, "0");
      return { hex };
    }
  }
  return null;
}

/**
 * Render a value knowing its Postgres column type (udt_name, e.g. bytea,
 * _text, _int4). Arrays become ARRAY[...] with an explicit cast so they
 * coerce to the destination column type; bytea accepts Buffer values,
 * hex strings, or plain text (backslash-safe).
 */
export function formatValueWithType(val: unknown, udtName?: string): string {
  if (val === null || val === undefined) return "NULL";

  if (Array.isArray(val)) {
    const elemType = udtName && udtName.startsWith("_") ? udtName.slice(1) : null;
    const cast = elemType ? `::${elemType}[]` : "";
    if (val.length === 0) return elemType ? `ARRAY[]${cast}` : "'{}'";
    return `ARRAY[${val.map((v) => formatValueWithType(v)).join(",")}]${cast}`;
  }

  const buf = isBufferLike(val);
  if (buf) return `${escapeLiteral(`\\x${buf.hex}`)}::bytea`;

  if (typeof val === "string") {
    if (udtName === "bytea") {
      // Hex strings (how some drivers serialize bytea) restore exactly;
      // plain text is made backslash-safe for the bytea escape parser.
      if (/^\\x[0-9a-fA-F]*$/.test(val)) return `${escapeLiteral(val)}::bytea`;
      return escapeLiteral(val.replace(/\\/g, "\\\\"));
    }
    return escapeLiteral(val);
  }

  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") {
    return Number.isFinite(val) ? String(val) : "NULL";
  }
  if (typeof val === "bigint") return String(val);
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? "NULL" : escapeLiteral(val.toISOString());
  }
  // JSON / objects / unknown driver types
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

export type TableDataExport = {
  sql: string;
  exportedRows: number;
  status: "ok" | "empty" | "skipped" | "failed";
  message?: string;
};

async function fetchColumnTypes(
  query: QueryFn,
  connectionString: string,
  schema: string,
  table: string,
): Promise<Record<string, string>> {
  try {
    const res = await query(
      connectionString,
      `SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = ${escapeLiteral(schema)} AND table_name = ${escapeLiteral(table)}`,
    );
    const map: Record<string, string> = {};
    for (const row of res.success ? (res.data?.rows ?? []) : []) {
      if (typeof row.column_name === "string" && typeof row.udt_name === "string") {
        map[row.column_name] = row.udt_name;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function exportTableDataSql(
  query: QueryFn,
  connectionString: string,
  schema: string,
  table: string,
  rowCount: number,
): Promise<TableDataExport> {
  if (rowCount <= 0) return { sql: "", exportedRows: 0, status: "empty" };
  if (rowCount >= MAX_DATA_EXPORT_ROWS) {
    const message = `Skipping data export for ${schema}.${table} (${rowCount} rows exceeds limit of ${MAX_DATA_EXPORT_ROWS}); schema migrates, data does not.`;
    console.warn(message);
    return { sql: "", exportedRows: 0, status: "skipped", message };
  }
  try {
    const [dataResult, columnTypes] = await Promise.all([
      query(connectionString, `SELECT * FROM ${qualifiedTable(schema, table)}`),
      fetchColumnTypes(query, connectionString, schema, table),
    ]);
    const rows = dataResult.success ? (dataResult.data?.rows ?? []) : [];
    if (!dataResult.success || rows.length === 0) {
      if (!dataResult.success) {
        const message = `Failed to export data for ${schema}.${table}: ${String(dataResult.error ?? "unknown error")}`;
        console.warn(message);
        return { sql: "", exportedRows: 0, status: "failed", message };
      }
      return { sql: "", exportedRows: 0, status: "empty" };
    }
    const columns = Object.keys(rows[0]);
    const target = qualifiedTable(schema, table);
    const colList = columns.map(escapeIdent).join(", ");
    const lines = rows.map(
      (row) =>
        `INSERT INTO ${target} (${colList}) VALUES (${columns.map((c) => formatValueWithType(row[c], columnTypes[c])).join(", ")});`,
    );
    return {
      sql: `-- Data for ${schema}.${table} (${rows.length} rows)\n${lines.join("\n")}\n`,
      exportedRows: rows.length,
      status: "ok",
    };
  } catch (error) {
    const message = `Failed to export data for ${schema}.${table}: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(message);
    return { sql: "", exportedRows: 0, status: "failed", message };
  }
}

/**
 * A per-table slice of a dataSql bundle, parsed from `-- Data for
 * schema.table (N rows)` marker lines. Unmarked statements (legacy
 * bundles) form a single chunk with empty schema/table.
 */
export type DataChunk = { schema: string; table: string; sql: string };

const CHUNK_MARKER_RE = /^-- Data for\s+(.+?)(?:\s+\(\d+\s+rows\))?\s*$/;

function splitChunkName(name: string): { schema: string; table: string } {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return { schema: "", table: name };
  return { schema: name.slice(0, dot), table: name.slice(dot + 1) };
}

/** Remove full-line `--` comments; returns "" when nothing executable remains. */
export function stripCommentLines(sql: string): string {
  // Quote-aware: a line starting with `--` INSIDE a multiline string literal
  // is data, not a comment. Track quote state across lines so such lines
  // are preserved verbatim.
  const lines = sql.split("\n");
  let inSingle = false;
  let inDouble = false;
  let dollarTag: string | null = null;
  const kept: string[] = [];

  const startsDollarQuote = (s: string, pos: number): string | null => {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/.exec(s.slice(pos));
    return m ? m[0] : null;
  };

  for (const line of lines) {
    const isCommentLine = !inSingle && !inDouble && dollarTag === null && /^\s*--/.test(line);
    // Advance quote state through the whole line so multiline literals
    // spanning later lines are tracked correctly.
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      const next = line[i + 1];
      if (dollarTag !== null) {
        if (line.startsWith(dollarTag, i)) {
          i += dollarTag.length;
          dollarTag = null;
        } else {
          i++;
        }
        continue;
      }
      if (inSingle) {
        if (ch === "'" && next === "'") i += 2;
        else {
          if (ch === "'") inSingle = false;
          i++;
        }
        continue;
      }
      if (inDouble) {
        if (ch === '"' && next === '"') i += 2;
        else {
          if (ch === '"') inDouble = false;
          i++;
        }
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (ch === "$") {
        const tag = startsDollarQuote(line, i);
        if (tag) {
          dollarTag = tag;
          i += tag.length;
          continue;
        }
      }
      i++;
    }
    if (!isCommentLine) kept.push(line);
  }
  return kept.join("\n").trim();
}

export function parseDataChunks(dataSql: string): DataChunk[] {
  const chunks: DataChunk[] = [];
  let current: { schema: string; table: string; parts: string[] } | null = null;
  const flush = () => {
    if (current && current.parts.length > 0) {
      // Parts are individual statements WITHOUT trailing semicolons (the
      // splitter consumes them). Re-terminate each one: sending multiple
      // INSERTs as a single query without separators is a syntax error
      // that would roll back the whole import transaction.
      const terminated = current.parts.map((p) => (p.endsWith(";") ? p : `${p};`));
      chunks.push({ schema: current.schema, table: current.table, sql: terminated.join("\n") });
    }
    current = null;
  };
  for (const stmt of splitSqlStatements(dataSql)) {
    const lines = stmt.split("\n");
    const markerLine = lines.find((l) => CHUNK_MARKER_RE.test(l.trim()));
    const executable = stripCommentLines(stmt);
    if (markerLine) {
      const name = CHUNK_MARKER_RE.exec(markerLine.trim())?.[1] ?? "";
      flush();
      const { schema, table } = splitChunkName(name);
      current = { schema, table, parts: [] };
      if (executable) current.parts.push(executable);
    } else {
      if (!executable) continue;
      if (!current) current = { schema: "", table: "", parts: [] };
      current.parts.push(executable);
    }
  }
  flush();
  return chunks;
}

export type TableDependency = { schema: string; table: string; refSchema: string; refTable: string };

/**
 * Order chunks so referenced (parent) tables load first (Kahn's
 * algorithm). Chunks with unknown/no dependencies keep export order.
 * Self-references and cycles never block: involved chunks fall back to
 * export order rather than being dropped.
 */
export function orderChunksByDependency(
  chunks: DataChunk[],
  deps: TableDependency[],
): DataChunk[] {
  const key = (s: string, t: string) => `${s}.${t}`;
  const indexByKey = new Map<string, number>();
  chunks.forEach((c, i) => {
    const k = key(c.schema, c.table);
    if (!indexByKey.has(k)) indexByKey.set(k, i);
  });

  const incoming = new Map<number, Set<number>>();
  chunks.forEach((_, i) => incoming.set(i, new Set()));
  for (const d of deps) {
    const from = indexByKey.get(key(d.schema, d.table));
    const to = indexByKey.get(key(d.refSchema, d.refTable));
    if (from === undefined || to === undefined || from === to) continue;
    // `from` depends on `to`: `to` must come first.
    incoming.get(from)?.add(to);
  }

  const ordered: DataChunk[] = [];
  const remaining = new Set(chunks.map((_, i) => i));
  // Stable: among ready chunks prefer export order.
  while (remaining.size > 0) {
    const ready = [...remaining].filter((i) => {
      for (const dep of incoming.get(i) ?? []) {
        if (remaining.has(dep)) return false;
      }
      return true;
    });
    if (ready.length === 0) {
      // Cycle: emit the earliest remaining chunk to make progress.
      ready.push(Math.min(...remaining));
    }
    ready.sort((a, b) => a - b);
    const next = ready[0];
    remaining.delete(next);
    ordered.push(chunks[next]);
  }
  return ordered;
}

/**
 * Apply a dataSql bundle statement-by-statement. Comment-only lines are
 * stripped per statement (never discarded whole statements), so marker
 * headers cannot eat the first INSERT of a table. Returns failure counts
 * so callers surface them instead of silently succeeding.
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
    const executable = stripCommentLines(statement);
    if (!executable) continue;
    try {
      const result = await query(connectionString, executable);
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
