export function readInitialAppearance(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const el = document.getElementById("rexadb-initial-appearance") as HTMLTemplateElement | null;
  const raw = el?.textContent || "{}";
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return parsed;
}

export function isJsonColumnType(columnType: string) {
  return String(columnType || "").toLowerCase().includes("json");
}

export function normalizeJsonInput(value: any, columnName: string) {
  if (value === null || value === undefined) {
    return { value: null as any, error: null as string | null };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      // Treat empty input as NULL for JSON columns.
      return { value: null as any, error: null as string | null };
    }
    try {
      return { value: JSON.parse(trimmed), error: null as string | null };
    } catch {
      return { value, error: `Invalid JSON in column "${columnName}"` };
    }
  }

  if (typeof value === "object") {
    return { value, error: null as string | null };
  }

  try {
    return { value: JSON.parse(String(value)), error: null as string | null };
  } catch {
    return { value, error: `Invalid JSON in column "${columnName}"` };
  }
}

export function stableStringify(value: unknown) {
  if (value === null || value === undefined) return String(value ?? "");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function inferMongoShape(value: any): any {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [inferMongoShape(value[0])];
  }
  if (value instanceof Date) return "date";
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = inferMongoShape(nested);
    }
    return out;
  }
  return typeof value;
}

export function inferMongoReferenceTarget(fieldName: string, collectionNames: string[]): string | null {
  const normalizedField = String(fieldName || "").trim().toLowerCase();
  if (!normalizedField || normalizedField === "_id") return null;
  if (!normalizedField.endsWith("_id")) return null;

  const base = normalizedField.slice(0, -3);
  if (!base) return null;

  const candidates = new Set<string>([
    base,
    `${base}s`,
    `${base}es`,
    base.endsWith("y") ? `${base.slice(0, -1)}ies` : "",
  ].filter(Boolean));

  const lowerCollections = new Map(collectionNames.map((name) => [name.toLowerCase(), name] as const));
  for (const candidate of candidates) {
    const match = lowerCollections.get(candidate);
    if (match) return match;
  }

  return null;
}

export function mergeById<T extends { id: string }>(
  prev: T[],
  items: T[],
  merge: (existing: T, incoming: T) => T = (e, i) => ({ ...e, ...i }),
): T[] {
  const next = [...prev];
  const indexById = new Map(next.map((item, idx) => [item.id, idx]));
  items.forEach((item) => {
    const idx = indexById.get(item.id);
    if (idx === undefined) {
      indexById.set(item.id, next.length);
      next.push(item);
    } else {
      next[idx] = merge(next[idx], item);
    }
  });
  return next;
}

/**
 * Render a JS value as a SQL literal for *display* purposes only
 * (query history, review sheet). Execution still uses parameterized
 * queries — this is never sent to the database.
 */
export function formatSqlDisplayLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "NULL"
      : `'${value.toISOString().replace(/'/g, "''")}'`;
  }
  if (typeof value === "object") {
    try {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    } catch {
      return `'${String(value).replace(/'/g, "''")}'`;
    }
  }
  const str = String(value);
  const trimmed = str.trim();
  // Bare keywords / numerics read better unquoted in previews.
  if (/^(null|true|false)$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Render a JS value as a SQL literal for *execution* (history replay).
 * Unlike the display formatter, strings are ALWAYS single-quoted — a value
 * like "null", "true", or "42" must round-trip as text, never as a keyword
 * or bare numeric.
 */
export function formatSqlExecutionLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "NULL"
      : `'${value.toISOString().replace(/'/g, "''")}'`;
  }
  if (typeof value === "object") {
    try {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    } catch {
      return `'${String(value).replace(/'/g, "''")}'`;
    }
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Interpolate `$1, $2…` (postgres) or `?` (mysql/mssql/clickhouse)
 * placeholders with execution-safe literals so a history entry can be
 * replayed exactly. Values round-trip: strings stay quoted text.
 *
 * Placeholder-aware: `$n` inside single-quoted strings, double-quoted
 * identifiers (a column literally named "$1"), comments, or dollar-quoted
 * function bodies is data, not a bind parameter, and is left alone. `?`
 * is likewise only replaced in code regions.
 */
export function interpolateSqlParamsForExecution(
  sql: string,
  params: unknown[] | undefined | null,
): string {
  if (!params || params.length === 0) return sql;
  return interpolatePlaceholders(sql, params, formatSqlExecutionLiteral);
}
export function interpolateSqlParamsForDisplay(
  sql: string,
  params: unknown[] | undefined | null,
): string {
  if (!params || params.length === 0) return sql;
  return interpolatePlaceholders(sql, params, formatSqlDisplayLiteral);
}

/**
 * Single-pass scanner replacing placeholders only in code regions.
 * Skips: single-quoted strings (''-escaped, E'' backslash-aware),
 * double-quoted identifiers (""-escaped), line/block comments, and
 * dollar-quoted bodies ($$…$$, $tag$…$tag$) whose $n are function
 * parameters, not bind markers.
 */
export function interpolatePlaceholders(
  sql: string,
  params: unknown[],
  format: (value: unknown) => string,
): string {
  const literals = params.map(format);
  const hasDollar = /\$\d+/.test(codeRegions(sql));
  let out = "";
  let i = 0;
  let qIndex = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const nx = sql[i + 1] ?? "";
    // Line comment -- to end of line.
    if (ch === "-" && nx === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Block comment /* … */.
    if (ch === "/" && nx === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Single-quoted string (''-escaped; E'…' backslash-aware).
    if (ch === "'") {
      const prev = i > 0 ? sql[i - 1] : "";
      const escaped = (prev === "e" || prev === "E") &&
        (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    // Double-quoted identifier (""-escaped).
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    // Dollar-quoted body or $n placeholder.
    if (ch === "$") {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 65));
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close !== -1) {
          out += sql.slice(i, close + tag.length);
          i = close + tag.length;
          continue;
        }
        // Unterminated — copy verbatim.
        out += sql.slice(i);
        break;
      }
      const numMatch = /^\$(\d+)/.exec(sql.slice(i, i + 12));
      if (numMatch && hasDollar) {
        const idx = Number(numMatch[1]) - 1;
        out += idx >= 0 && idx < literals.length ? literals[idx] : numMatch[0];
        i += numMatch[0].length;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    // Question-mark placeholder (code regions only).
    if (ch === "?" && !hasDollar) {
      out += qIndex < literals.length ? literals[qIndex++] : "?";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Code regions with strings/identifiers/comments/dollar-quotes blanked (positions preserved), for placeholder-mode detection. */
function codeRegions(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  const blank = (stop: number) => {
    out += " ".repeat(Math.max(0, stop - i));
    i = stop;
  };
  while (i < n) {
    const ch = sql[i];
    const nx = sql[i + 1] ?? "";
    if (ch === "-" && nx === "-") {
      const end = sql.indexOf("\n", i);
      blank(end === -1 ? n : end);
      continue;
    }
    if (ch === "/" && nx === "*") {
      const end = sql.indexOf("*/", i + 2);
      blank(end === -1 ? n : end + 2);
      continue;
    }
    if (ch === "'") {
      const prev = out.length > 0 ? sql[i - 1] : "";
      const escaped = (prev === "e" || prev === "E") &&
        (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      blank(j);
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      blank(j);
      continue;
    }
    if (ch === "$") {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 65));
      if (tagMatch) {
        const close = sql.indexOf(tagMatch[0], i + tagMatch[0].length);
        blank(close !== -1 ? close + tagMatch[0].length : n);
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
