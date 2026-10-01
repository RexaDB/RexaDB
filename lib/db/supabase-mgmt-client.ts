import { runMgmtQuery } from "@/lib/supabase-mgmt/client";

export interface SupabaseMgmtConnectionString {
  projectRef: string;
  token: string;
}

export function parseSupabaseMgmtConnectionString(
  connectionString: string,
): SupabaseMgmtConnectionString | null {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "supabase-mgmt:") return null;
    const projectRef = url.hostname || url.pathname.replace(/^\/+/, "");
    const token = url.searchParams.get("token") || "";
    if (!projectRef || !token) return null;
    return { projectRef, token };
  } catch {
    return null;
  }
}

export function buildSupabaseMgmtConnectionString(
  projectRef: string,
  token: string,
): string {
  return `supabase-mgmt://${projectRef}?token=${encodeURIComponent(token)}`;
}

function escapeArrayElement(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") {
    return Number.isFinite(Number(value)) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Double-quoted array element inside a single-quoted literal: escape both,
  // and double any single quotes so the outer literal stays intact.
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "''")}"`;
}

// Arrays become PostgreSQL array literals ('{1,2}', '{"a","b"}') instead of
// JSON strings, so ANY($1) and IN-style comparisons keep working.
function escapeMgmtArray(value: unknown[]): string {
  return `'{${value.map(escapeArrayElement).join(",")}}'`;
}

function escapeMgmtParam(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") {
    return Number.isFinite(Number(value)) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) return escapeMgmtArray(value);
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Replace $n placeholders only in live SQL — never inside string literals,
// quoted identifiers, comments, or dollar-quoted blocks. Single pass, so
// inserted values are never re-scanned.
function inlinePlaceholders(query: string, escaped: string[]): string {
  let out = "";
  let i = 0;
  const len = query.length;
  while (i < len) {
    const c = query[i];
    // line comment
    if (c === "-" && query[i + 1] === "-") {
      const end = query.indexOf("\n", i + 2);
      const stop = end === -1 ? len : end;
      out += query.slice(i, stop);
      i = stop;
      continue;
    }
    // block comment
    if (c === "/" && query[i + 1] === "*") {
      const end = query.indexOf("*/", i + 2);
      const stop = end === -1 ? len : end + 2;
      out += query.slice(i, stop);
      i = stop;
      continue;
    }
    // quoted string or identifier ('...' with '' escape, "..." with "" escape).
    // Backslash escapes are only real in E'...' strings — with the default
    // standard_conforming_strings=on, the quote after a backslash in an
    // ordinary literal (e.g. 'x\') CLOSES the string.
    if (c === "'" || c === '"') {
      const isEscapeString =
        c === "'" &&
        i > 0 &&
        (query[i - 1] === "E" || query[i - 1] === "e") &&
        (i - 1 === 0 || !/[A-Za-z0-9_$]/.test(query[i - 2]));
      let j = i + 1;
      while (j < len) {
        if (query[j] === c) {
          if (query[j + 1] === c) { j += 2; continue; }
          j += 1;
          break;
        }
        if (isEscapeString && query[j] === "\\" && j + 1 < len) { j += 2; continue; }
        j += 1;
      }
      out += query.slice(i, j);
      i = j;
      continue;
    }
    if (c === "$") {
      // dollar-quoted block $tag$...$tag$
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(query.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = query.indexOf(tag, i + tag.length);
        const stop = end === -1 ? len : end + tag.length;
        out += query.slice(i, stop);
        i = stop;
        continue;
      }
      const ph = /^\$(\d+)\b/.exec(query.slice(i));
      if (ph) {
        const idx = Number(ph[1]) - 1;
        out += idx >= 0 && idx < escaped.length ? escaped[idx] : ph[0];
        i += ph[0].length;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// The Management API's /database/query endpoint accepts raw SQL only — no
// bind parameters. Inline $n placeholders here (single pass, so inserted
// values are never re-scanned) instead of letting $1 reach the API (42P02).
export function inlineMgmtParams(query: string, params: unknown[] = []): string {
  if (!params || params.length === 0) return query;
  return inlinePlaceholders(query, params.map(escapeMgmtParam));
}

export async function executeSupabaseMgmtQuery(
  connectionString: string,
  query: string,
  params: unknown[] = [],
): Promise<{ rows: any[]; fields: any[]; rowCount: number }> {
  const parsed = parseSupabaseMgmtConnectionString(connectionString);
  if (!parsed) {
    throw new Error("Invalid Supabase Management API connection string");
  }

  const result = await runMgmtQuery(parsed.token, parsed.projectRef, inlineMgmtParams(query, params));
  if (result.error) {
    throw new Error(result.error);
  }

  const rows = result.rows ?? [];
  const fields =
    rows.length > 0
      ? Object.keys(rows[0]).map((name) => ({
          name,
          dataTypeID: 0,
          dataTypeName: "text",
        }))
      : [];

  return {
    rows,
    fields,
    rowCount: rows.length,
  };
}
