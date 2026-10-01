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

function escapeMgmtParam(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") {
    return Number.isFinite(Number(value)) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

// The Management API's /database/query endpoint accepts raw SQL only — no
// bind parameters. Inline $n placeholders here (single pass, so inserted
// values are never re-scanned) instead of letting $1 reach the API (42P02).
export function inlineMgmtParams(query: string, params: unknown[] = []): string {
  if (!params || params.length === 0) return query;
  const escaped = params.map(escapeMgmtParam);
  return query.replace(/\$(\d+)\b/g, (match, n) => {
    const idx = Number(n) - 1;
    return idx >= 0 && idx < escaped.length ? escaped[idx] : match;
  });
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
