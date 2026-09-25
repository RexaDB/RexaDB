/**
 * Server-only Supabase project API helpers for transfers.
 *
 * SQL cannot reach object bytes (Storage backend) or edge-function sources,
 * so content migration goes through the project's HTTP APIs using the
 * service_role key (fetched via the Management API, same pattern as
 * security-actions' GoTrue admin access). Imported ONLY by the Supabase
 * transfer adapter — never client-reachable.
 */

import { parseSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";

export interface SupabaseApiCreds {
  projectRef: string;
  projectUrl: string;
  serviceRole: string;
  /** Management API token (project-scoped metadata: functions, keys). */
  mgmtToken: string;
}

/** Max single-file download/upload and total budget per transfer. */
export const MAX_STORAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_STORAGE_TOTAL_BYTES = 200 * 1024 * 1024;
/** Max functions and max bundled source per function. */
export const MAX_FUNCTIONS = 50;
export const MAX_FUNCTION_BODY_BYTES = 500 * 1024;

/**
 * Resolve service_role creds. Only supabase-mgmt:// connections carry a
 * management token; direct Postgres connections return null creds with an
 * explanatory warning (metadata-only transfer).
 */
export async function resolveSupabaseApiCreds(
  connectionString: string,
): Promise<{ creds: SupabaseApiCreds | null; warning?: string }> {
  const parsed = parseSupabaseMgmtConnectionString(connectionString);
  if (!parsed) {
    // Try to extract a ref from a direct db.<ref>.supabase.co host for a
    // more helpful message, but there is no token to call APIs with.
    const m = connectionString.match(/db\.([a-z0-9]{20,})\.supabase\.co/i);
    void m;
    return {
      creds: null,
      warning:
        "No Supabase management token on this connection (direct Postgres): file contents and function sources cannot migrate — metadata only. Use a supabase-mgmt connection for content migration.",
    };
  }
  const { token, projectRef } = parsed;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { creds: null, warning: `Could not list API keys for ${projectRef} (HTTP ${res.status}): content migration disabled.` };
    }
    const payload = (await res.json().catch(() => null)) as any;
    const list: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.api_keys)
          ? payload.api_keys
          : [];
    const serviceRole =
      list.find((k) => String(k?.name ?? k?.type ?? "").toLowerCase().includes("service_role"))?.api_key ??
      list.find((k) => typeof k?.api_key === "string" && k.api_key.startsWith("eyJ"))?.api_key ??
      null;
    if (typeof serviceRole !== "string" || !serviceRole) {
      return { creds: null, warning: `No service_role key found for ${projectRef}: content migration disabled.` };
    }
    return {
      creds: { projectRef, projectUrl: `https://${projectRef}.supabase.co`, serviceRole, mgmtToken: token },
    };
  } catch (error) {
    return {
      creds: null,
      warning: `Failed to resolve Supabase API credentials: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function storageHeaders(creds: SupabaseApiCreds, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: creds.serviceRole,
    Authorization: `Bearer ${creds.serviceRole}`,
    ...extra,
  };
}

export async function downloadStorageObject(
  creds: SupabaseApiCreds,
  bucket: string,
  path: string,
): Promise<{ bytes: Buffer } | { error: string }> {
  try {
    const url = `${creds.projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url, { headers: storageHeaders(creds) });
    if (res.status === 404) return { error: "not found" };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_STORAGE_FILE_BYTES) {
      return { error: `exceeds per-file cap (${buf.length} bytes)` };
    }
    return { bytes: buf };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uploadStorageObject(
  creds: SupabaseApiCreds,
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    if (bytes.length > MAX_STORAGE_FILE_BYTES) {
      return { error: `exceeds per-file cap (${bytes.length} bytes)` };
    }
    const url = `${creds.projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: storageHeaders(creds, {
        "Content-Type": contentType || "application/octet-stream",
        "x-upsert": "true",
      }),
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface SupabaseFunctionInfo {
  slug: string;
  verifyJwt?: boolean;
}

function asFunctionList(payload: unknown): SupabaseFunctionInfo[] {
  const arr: any[] = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.data) ? (payload as any).data : [];
  return arr
    .map((f) => ({
      slug: String(f?.slug ?? f?.name ?? f?.id ?? ""),
      verifyJwt: typeof f?.verify_jwt === "boolean" ? f.verify_jwt : undefined,
    }))
    .filter((f) => f.slug)
    .slice(0, MAX_FUNCTIONS);
}

export async function listSupabaseFunctions(
  creds: SupabaseApiCreds,
): Promise<{ functions: SupabaseFunctionInfo[] } | { error: string }> {
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${creds.projectRef}/functions`, {
      headers: { Authorization: `Bearer ${creds.mgmtToken}` },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const payload = await res.json().catch(() => null);
    return { functions: asFunctionList(payload) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSupabaseFunctionBody(
  creds: SupabaseApiCreds,
  slug: string,
): Promise<{ body: string } | { error: string }> {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${creds.projectRef}/functions/${encodeURIComponent(slug)}/body`,
      { headers: { Authorization: `Bearer ${creds.mgmtToken}` } },
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text) return { error: "empty body" };
    // Some shapes return JSON { body: "..." }; most return raw source.
    try {
      const parsed = JSON.parse(text) as { body?: unknown };
      if (typeof parsed?.body === "string" && parsed.body) {
        if (parsed.body.length > MAX_FUNCTION_BODY_BYTES) return { error: "exceeds size cap" };
        return { body: parsed.body };
      }
    } catch {
      // not JSON — raw source below
    }
    if (text.length > MAX_FUNCTION_BODY_BYTES) {
      return { error: `exceeds size cap (${text.length} bytes)` };
    }
    return { body: text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deploySupabaseFunction(
  creds: SupabaseApiCreds,
  slug: string,
  body: string,
  verifyJwt?: boolean,
): Promise<{ ok: true } | { error: string }> {
  const payload: Record<string, unknown> = { slug, name: slug, body };
  if (typeof verifyJwt === "boolean") payload.verify_jwt = verifyJwt;
  const headers = {
    Authorization: `Bearer ${creds.mgmtToken}`,
    "Content-Type": "application/json",
  };
  try {
    // Try create, fall back to update when it already exists.
    let res = await fetch(`https://api.supabase.com/v1/projects/${creds.projectRef}/functions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const alreadyExists = /exist|conflict|duplicate/i.test(text) || res.status === 409;
      if (!alreadyExists) return { error: `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` };
      res = await fetch(
        `https://api.supabase.com/v1/projects/${creds.projectRef}/functions/${encodeURIComponent(slug)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ body, ...(typeof verifyJwt === "boolean" ? { verify_jwt: verifyJwt } : {}) }),
        },
      );
      if (!res.ok) {
        const text2 = await res.text().catch(() => "");
        return { error: `HTTP ${res.status}${text2 ? `: ${text2.slice(0, 200)}` : ""}` };
      }
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
