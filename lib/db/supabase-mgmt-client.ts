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

export async function executeSupabaseMgmtQuery(
  connectionString: string,
  query: string,
): Promise<{ rows: any[]; fields: any[]; rowCount: number }> {
  const parsed = parseSupabaseMgmtConnectionString(connectionString);
  if (!parsed) {
    throw new Error("Invalid Supabase Management API connection string");
  }

  const result = await runMgmtQuery(parsed.token, parsed.projectRef, query);
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
