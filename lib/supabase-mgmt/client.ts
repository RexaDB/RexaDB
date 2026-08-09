import type { Project, Organization } from "supabase-client-sdk";
import { API_BASE } from "@/lib/api-base";

// Route through the sidecar proxy: the Management API does not send
// `Access-Control-Allow-Origin`, so direct browser/webview fetches are
// blocked by CORS. The sidecar forwards with a supabase-cli User-Agent.
function mgmtBase(): string {
  return `${API_BASE}/api/supabase-mgmt/proxy/v1`;
}

async function mgmt<T>(
  token: string,
  path: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await fetch(`${mgmtBase()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Supabase API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function dbQuery(
  token: string,
  ref: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  return mgmt<Record<string, unknown>[]>(
    token,
    `/projects/${ref}/database/query`,
    {
      method: "POST",
      body: JSON.stringify({ query }),
    },
  );
}

export async function listProjects(token: string): Promise<Project[]> {
  return mgmt<Project[]>(token, "/projects");
}

export async function getProject(
  token: string,
  ref: string,
): Promise<Project> {
  return mgmt<Project>(token, `/projects/${ref}`);
}

export async function listOrganizations(
  token: string,
): Promise<Organization[]> {
  return mgmt<Organization[]>(token, "/organizations");
}

export interface SupabaseMgmtUser {
  gotrue_id?: string;
  primary_email?: string | null;
  username?: string | null;
}

export async function getMgmtUser(token: string): Promise<SupabaseMgmtUser> {
  return mgmt<SupabaseMgmtUser>(token, "/profile");
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${mgmtBase()}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runMgmtQuery(
  token: string,
  ref: string,
  query: string,
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  try {
    const rows = await dbQuery(token, ref, query);
    return { rows };
  } catch (e) {
    return { rows: [], error: String(e) };
  }
}

export async function listSchemas(
  token: string,
  ref: string,
): Promise<{ schema_name: string }[]> {
  const result = await runMgmtQuery(
    token,
    ref,
    `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`,
  );
  return (result.rows ?? []) as { schema_name: string }[];
}

export async function listTables(
  token: string,
  ref: string,
  schema = "public",
): Promise<{ table_name: string; table_type: string; table_schema: string }[]> {
  const result = await runMgmtQuery(
    token,
    ref,
    `SELECT table_name, table_type, table_schema FROM information_schema.tables WHERE table_schema = '${schema.replace(/'/g, "''")}' ORDER BY table_name`,
  );
  return (result.rows ?? []) as {
    table_name: string;
    table_type: string;
    table_schema: string;
  }[];
}

export async function listColumns(
  token: string,
  ref: string,
  table: string,
): Promise<
  {
    column_name: string;
    data_type: string;
    is_nullable: string;
    ordinal_position: number;
  }[]
> {
  const [schema, tableName] = table.includes(".")
    ? table.split(".")
    : ["public", table];
  const result = await runMgmtQuery(
    token,
    ref,
    `SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`,
  );
  return (result.rows ?? []) as {
    column_name: string;
    data_type: string;
    is_nullable: string;
    ordinal_position: number;
  }[];
}
