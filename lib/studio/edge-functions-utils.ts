"use client";

import { API_BASE } from "@/lib/api-base";
import { parseSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import { listProjects } from "@/lib/supabase-mgmt/client";
import {
  resolveMgmtTokenForRef,
  resolvePaymentsConnection,
} from "@/lib/supabase-paykit/supabase-ref";

/** Edge Functions live on the user's Supabase project (mgmt API), so the
 *  gating matches the other Supabase-project sections (Storage/Payments):
 *  supabase-mgmt connections plus direct Postgres connections to
 *  db.<ref>.supabase.co. */
export function shouldShowEdgeFunctions(
  connectionType: string | undefined,
  connectionString: string | undefined,
): boolean {
  return resolvePaymentsConnection(connectionType, connectionString) !== null;
}

export type EdgeFunction = {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number | null;
  verify_jwt: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EdgeSecret = {
  name: string;
  /** Real API never returns plaintext — this is a SHA-256 digest (or null). */
  value: string | null;
  updated_at: string | null;
};

export type EdgeAccess = {
  projectRef: string;
  token: string;
};

/** Resolve {projectRef, mgmt token} for the active studio connection.
 *  supabase-mgmt connections carry an embedded token; direct Postgres
 *  connections resolve a linked Management API token (cached). */
export async function resolveEdgeAccess(
  connectionType: string | undefined,
  connectionString: string | undefined,
): Promise<{ access: EdgeAccess | null; error?: string }> {
  const info = resolvePaymentsConnection(connectionType, connectionString);
  if (!info) return { access: null };
  if (info.kind === "mgmt") {
    const parsed = parseSupabaseMgmtConnectionString(connectionString ?? "");
    if (!parsed || !parsed.token)
      return { access: null, error: "Invalid Supabase management connection." };
    return {
      access: { projectRef: parsed.projectRef, token: parsed.token },
    };
  }
  const token = await resolveMgmtTokenForRef(info.projectRef, listProjects);
  if (!token) {
    return {
      access: null,
      error:
        "No linked Supabase account can access this project. Link your Supabase account to manage Edge Functions.",
    };
  }
  return { access: { projectRef: info.projectRef, token } };
}

function mgmtBase(): string {
  return `${API_BASE}/api/supabase-mgmt/proxy/v1`;
}

/** Tolerant Management API call: empty bodies (201 on secrets upsert) parse
 *  as null instead of throwing, and non-2xx surfaces the upstream message. */
async function mgmtRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${mgmtBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = text || res.statusText;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.message || parsed?.error || detail;
    } catch {
      // keep raw text
    }
    throw new Error(`Supabase API ${res.status}: ${detail}`);
  }
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return null;
}

function normalizeFunction(row: any): EdgeFunction {
  return {
    id: String(row?.id ?? row?.slug ?? ""),
    slug: String(row?.slug ?? row?.name ?? ""),
    name: String(row?.name ?? row?.slug ?? ""),
    status: String(row?.status ?? "UNKNOWN"),
    version: row?.version != null ? Number(row.version) : null,
    verify_jwt:
      typeof row?.verify_jwt === "boolean" ? row.verify_jwt : null,
    created_at: normalizeTimestamp(row?.created_at),
    updated_at: normalizeTimestamp(row?.updated_at),
  };
}

export async function listEdgeFunctions(
  access: EdgeAccess,
): Promise<{ functions: EdgeFunction[]; error?: string }> {
  try {
    const rows = await mgmtRequest<any[]>(
      access.token,
      `/projects/${access.projectRef}/functions`,
    );
    const list = Array.isArray(rows) ? rows : [];
    return {
      functions: list
        .map(normalizeFunction)
        .filter((f) => f.slug)
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    };
  } catch (e) {
    return {
      functions: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getEdgeFunction(
  access: EdgeAccess,
  slug: string,
): Promise<{ function: EdgeFunction | null; error?: string }> {
  try {
    const row = await mgmtRequest<any>(
      access.token,
      `/projects/${access.projectRef}/functions/${encodeURIComponent(slug)}`,
    );
    if (!row) return { function: null, error: "Function not found." };
    return { function: normalizeFunction(row) };
  } catch (e) {
    return {
      function: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function deleteEdgeFunction(  access: EdgeAccess,
  slug: string,
): Promise<{ error?: string }> {
  try {
    await mgmtRequest<unknown>(
      access.token,
      `/projects/${access.projectRef}/functions/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    );
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateEdgeFunction(
  access: EdgeAccess,
  slug: string,
  patch: { name?: string; verify_jwt?: boolean },
): Promise<{ function?: EdgeFunction; error?: string }> {
  try {
    const row = await mgmtRequest<any>(
      access.token,
      `/projects/${access.projectRef}/functions/${encodeURIComponent(slug)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    return { function: row ? normalizeFunction(row) : undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Deploy source files to a function (creates it if missing). One `file`
 *  part per source file plus a JSON `metadata` part — the shape the
 *  `supabase functions deploy` flow uses. */
export async function deployEdgeFunction(
  access: EdgeAccess,
  slug: string,
  opts: { entrypointPath: string; name?: string; verifyJwt?: boolean },
  files: Array<{ name: string; content: string }>,
): Promise<{ error?: string }> {
  try {
    if (files.length === 0) throw new Error("Nothing to deploy.");
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        entrypoint_path: opts.entrypointPath,
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.verifyJwt !== undefined ? { verify_jwt: opts.verifyJwt } : {}),
      }),
    );
    for (const f of files) {
      form.append(
        "file",
        new File([f.content], f.name, { type: "application/typescript" }),
      );
    }
    const res = await fetch(
      `${mgmtBase()}/projects/${access.projectRef}/functions/deploy?slug=${encodeURIComponent(slug)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access.token}` },
        body: form,
      },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let detail = text || res.statusText;
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.message || parsed?.error || detail;
      } catch {
        // keep raw text
      }
      throw new Error(`Supabase API ${res.status}: ${detail}`);
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export type CodeFile = { name: string; content: string };

/** The function body endpoint returns multipart source files. Parses them
 *  defensively; falls back to a single file with the raw response. */
export function parseMultipartBody(text: string): CodeFile[] {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").trim();
  const match = /^--(.+?)(--)?$/.exec(firstLine);
  if (!match) return [{ name: "index.ts", content: text }];
  const boundary = `--${match[1]}`;
  const chunks = text.split(boundary).slice(1);
  const files: CodeFile[] = [];
  for (const chunk of chunks) {
    if (/^\s*--\s*$/.test(chunk.split(/\r?\n/, 1)[0] ?? "")) continue;
    const nameMatch = /filename="([^"]+)"/.exec(chunk);
    const sep = chunk.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    const content = chunk
      .slice(sep)
      .replace(/^\r?\n\r?\n/, "")
      .replace(/\r?\n$/, "");
    files.push({
      name: nameMatch?.[1]?.split("/").pop() || `file-${files.length + 1}`,
      content,
    });
  }
  return files.length ? files : [{ name: "index.ts", content: text }];
}

export async function fetchFunctionBody(
  access: EdgeAccess,
  slug: string,
): Promise<{ files: CodeFile[]; error?: string }> {
  try {
    const res = await fetch(
      `${mgmtBase()}/projects/${access.projectRef}/functions/${encodeURIComponent(slug)}/body`,
      { headers: { Authorization: `Bearer ${access.token}` } },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Supabase API ${res.status}: ${text || res.statusText}`);
    }
    // Deployed bundles come back as binary ESZIP + bundled deps — extract
    // the original sources embedded in the runtime metadata instead.
    return { files: extractFunctionSources(text) ?? parseMultipartBody(text) };
  } catch (e) {
    return {
      files: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Balanced-bracket JSON string-array extractor for
 *  `"key": [...]` inside a larger blob. */
function extractJsonStringArray(text: string, key: string): string[] | null {
  const keyIdx = text.indexOf(`"${key}":`);
  if (keyIdx === -1) return null;
  const start = text.indexOf("[", keyIdx);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) &&
            parsed.every((s) => typeof s === "string")
            ? (parsed as string[])
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Pull the original source files out of an ESZIP bundle response
 *  (`"sources"` / `"sourcesContent"` in the runtime metadata). Returns null
 *  when the response isn't a bundle, so callers can fall back. */
export function extractFunctionSources(text: string): CodeFile[] | null {
  const names = extractJsonStringArray(text, "sources");
  const contents = extractJsonStringArray(text, "sourcesContent");
  if (!names || !contents || names.length === 0) return null;
  const files = names
    .map((name, i) => ({ name, content: contents[i] ?? "" }))
    .filter((f) => f.content);
  return files.length ? files : null;
}

export type FunctionEvent = {
  timestamp: string | null;
  message: string;
  method: string | null;
  status: number | null;
  requestId: string | null;
};

function escapeClickHouseLike(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export function buildFunctionEventsSql(
  slug: string,
  source: "function_edge_logs" | "function_logs",
  start: Date,
  end: Date,
  filterBySlug = true,
): string {
  const where = filterBySlug
    ? `WHERE source_name IN ('${source}') AND event_message LIKE '%${escapeClickHouseLike(slug)}%'`
    : `WHERE source_name IN ('${source}')`;
  return (
    `SELECT timestamp, event_message FROM logs ` +
    `${where} ORDER BY timestamp DESC LIMIT 100`
  );
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function parseAttributes(raw: unknown): Record<string, unknown> {  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON — ignore
    }
  }
  return {};
}

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/;
const STATUS_RE = /\b([1-5]\d\d)\b/;
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Find the row array in a logs response regardless of envelope:
 *  bare array, {result/data/results/rows/events/logs/items: [...]}, or one
 *  level deeper. */
function findLogRows(res: any, depth = 0): any[] | null {
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && depth < 3) {
    for (const key of [
      "result",
      "data",
      "results",
      "rows",
      "events",
      "logs",
      "items",
    ]) {
      const v = (res as any)[key];
      if (Array.isArray(v)) return v;
    }
    for (const v of Object.values(res)) {
      const found = findLogRows(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function describeResponse(res: any): string {
  if (res == null) return String(res);
  if (Array.isArray(res)) return `array[${res.length}]`;
  if (typeof res === "object") {
    const keys = Object.keys(res);
    return `object keys: ${keys.length ? keys.join(", ") : "(none)"}`;
  }
  return `${typeof res}: ${String(res).slice(0, 120)}`;
}

/** Recent events for one function via the ClickHouse-backed logs endpoint.
 *  Structured fields come from the log attributes map when present, with
 *  message-text fallbacks otherwise.
 *
 *  The logs endpoint is aggressively rate-limited, so results are cached
 *  briefly, concurrent duplicate calls share one request, and 429s are
 *  retried with backoff instead of surfacing immediately. */
const eventsCache = new Map<string, { at: number; data: { events: FunctionEvent[]; error?: string } }>();
const eventsInflight = new Map<string, Promise<{ events: FunctionEvent[]; error?: string }>>();
const EVENTS_CACHE_TTL = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchFunctionEvents(
  access: EdgeAccess,
  slug: string,
  source: "function_edge_logs" | "function_logs",
  range: { start: Date; end: Date },
): Promise<{ events: FunctionEvent[]; error?: string }> {
  const key = `${access.projectRef}:${slug}:${source}:${range.start.toISOString()}:${range.end.toISOString()}`;
  const cached = eventsCache.get(key);
  if (cached && Date.now() - cached.at < EVENTS_CACHE_TTL) return cached.data;
  const running = eventsInflight.get(key);
  if (running) return running;
  const task = (async () => {
    let last: { events: FunctionEvent[]; error?: string } = {
      events: [],
      error: "No logs returned.",
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      last = await fetchFunctionEventsOnce(access, slug, source, range);
      if (!last.error || !/429|too many requests/i.test(last.error)) break;
      await sleep(2000 * (attempt + 1));
    }
    // Only cache successes — errors should retry on next visit.
    if (!last.error) eventsCache.set(key, { at: Date.now(), data: last });
    return last;
  })();
  eventsInflight.set(key, task);
  try {
    return await task;
  } finally {
    eventsInflight.delete(key);
  }
}

async function fetchFunctionEventsOnce(
  access: EdgeAccess,
  slug: string,
  source: "function_edge_logs" | "function_logs",
  range: { start: Date; end: Date },
): Promise<{ events: FunctionEvent[]; error?: string }> {
  try {
    // Console output rarely mentions the function slug, so only request
    // logs filter server-side when the message is expected to carry it.
    const serverFilter = source === "function_edge_logs";
    const slugCond = serverFilter
      ? ` AND event_message LIKE '%${escapeClickHouseLike(slug)}%'`
      : "";
    const queries = [
      `SELECT timestamp, event_message, attributes FROM logs WHERE source_name IN ('${source}')${slugCond} ORDER BY timestamp DESC LIMIT 100`,
      `SELECT timestamp, event_message FROM logs WHERE source_name IN ('${source}')${slugCond} ORDER BY timestamp DESC LIMIT 100`,
      `SELECT timestamp, event_message FROM logs WHERE source IN ('${source}')${slugCond} ORDER BY timestamp DESC LIMIT 100`,
      // Last resort: unfiltered tail, narrowed client-side below.
      `SELECT timestamp, event_message FROM logs ORDER BY timestamp DESC LIMIT 100`,
    ];
    const params = (q: string) =>
      new URLSearchParams({
        sql: q,
        iso_timestamp_start: range.start.toISOString(),
        iso_timestamp_end: range.end.toISOString(),
      });
    let rows: any = null;
    let lastError: string | null = null;
    for (const q of queries) {
      try {
        const res = await mgmtRequest<any>(
          access.token,
          `/projects/${access.projectRef}/analytics/endpoints/logs?${params(q).toString()}`,
        );
        if (res && typeof res === "object" && !Array.isArray(res)) {
          const apiMessage =
            (res as any)?.message ?? (res as any)?.error ?? (res as any)?.msg;
          if (typeof apiMessage === "string" && apiMessage && !findLogRows(res)) {
            throw new Error(apiMessage);
          }
        }
        rows = findLogRows(res);
        if (rows) break;
        lastError = `Unexpected response shape from logs endpoint (${describeResponse(res)}).`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (!rows) return { events: [], error: lastError ?? "No logs returned." };
    const slugLower = slug.toLowerCase();
    const events: FunctionEvent[] = [];
    for (const r of rows) {
      const message = String(r?.event_message ?? r?.message ?? "");
      const attrs = parseAttributes(
        r?.attributes ?? r?.log_attributes ?? r?.metadata,
      );
      // Keep rows that belong to this function: the message itself or any
      // structured attribute mentioning the slug.
      const haystack =
        `${message} ${JSON.stringify(attrs)}`.toLowerCase();
      if (!haystack.includes(slugLower)) continue;
      const method =
        str(attrs["request.method"]) ??
        str(attrs["method"]) ??
        str(attrs["http.method"]) ??
        METHOD_RE.exec(message)?.[1] ??
        null;
      const statusRaw =
        attrs["response.status_code"] ??
        attrs["status_code"] ??
        attrs["status"] ??
        STATUS_RE.exec(message)?.[1] ??
        null;
      const status =
        typeof statusRaw === "number"
          ? statusRaw
          : typeof statusRaw === "string" && /^\d+$/.test(statusRaw)
            ? Number(statusRaw)
            : null;
      const requestId =
        str(attrs["request.id"]) ??
        str(attrs["request_id"]) ??
        str(attrs["id"]) ??
        UUID_RE.exec(message)?.[0] ??
        null;
      events.push({
        timestamp:
          normalizeTimestamp(r?.timestamp) ??
          (r?.timestamp != null ? String(r.timestamp) : null),
        message,
        method,
        status,
        requestId,
      });
    }
    events.sort((a, b) =>
      (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
    );
    return { events };
  } catch (e) {
    return {
      events: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function listEdgeSecrets(
  access: EdgeAccess,
): Promise<{ secrets: EdgeSecret[]; error?: string }> {
  try {
    const rows = await mgmtRequest<any[]>(
      access.token,
      `/projects/${access.projectRef}/secrets`,
    );
    const list = Array.isArray(rows) ? rows : [];
    return {
      secrets: list
        .map((r: any) => ({
          name: String(r?.name ?? ""),
          value: r?.value != null ? String(r.value) : null,
          updated_at: normalizeTimestamp(r?.updated_at),
        }))
        .filter((s) => s.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (e) {
    return {
      secrets: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function upsertEdgeSecrets(
  access: EdgeAccess,
  secrets: Array<{ name: string; value: string }>,
): Promise<{ error?: string }> {
  try {
    await mgmtRequest<unknown>(
      access.token,
      `/projects/${access.projectRef}/secrets`,
      { method: "POST", body: JSON.stringify(secrets) },
    );
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteEdgeSecrets(
  access: EdgeAccess,
  names: string[],
): Promise<{ error?: string }> {
  try {
    await mgmtRequest<unknown>(
      access.token,
      `/projects/${access.projectRef}/secrets`,
      { method: "DELETE", body: JSON.stringify(names) },
    );
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Legacy anon key for the invoke tester (best effort — null when the
 *  endpoint is unavailable on the project). */
export async function getProjectAnonKey(
  access: EdgeAccess,
): Promise<string | null> {
  try {
    const rows = await mgmtRequest<any[]>(
      access.token,
      `/projects/${access.projectRef}/api-keys`,
    );
    const anon = (Array.isArray(rows) ? rows : []).find(
      (k) => k?.name === "anon",
    );
    const key = anon?.api_key ?? anon?.apiKey ?? null;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}

export function edgeFunctionUrl(projectRef: string, slug: string): string {
  return `https://${projectRef}.supabase.co/functions/v1/${slug}`;
}

/** "5 months ago" style relative timestamps like the Supabase dashboard. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
