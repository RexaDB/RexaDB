import { resolvePaymentsConnection } from "@/lib/supabase-paykit/supabase-ref";
import { runQuery } from "@/lib/api/actions-client";

/** Storage is available on supabase-mgmt and direct Postgres-to-Supabase connections. */
export function shouldShowStorage(
  connectionType: string | undefined,
  connectionString: string | undefined,
  schemas?: string[] | null,
): boolean {
  if (schemas?.includes("storage")) return true;
  return resolvePaymentsConnection(connectionType, connectionString) !== null;
}

export type StorageBucket = {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type StorageObject = {
  id: string;
  name: string;
  bucket_id: string;
  owner: string | null;
  owner_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_accessed_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type StoragePolicy = {
  schema: string;
  table_name: string;
  name: string;
  permissive: string;
  roles: string[] | string | null;
  command: string;
  using_expression: string | null;
  with_check_expression: string | null;
};

export type StorageSettings = {
  fileSizeLimitMb: number;
  storageBackend: "file" | "s3";
  s3ProtocolAccessKeyId: string;
  s3ProtocolAccessKeySecret: string;
  s3ProtocolRegion: string;
  s3ConnectionEndpoint: string;
  s3ConnectionAccessKeyId: string;
  s3ConnectionAccessKeySecret: string;
  s3ConnectionRegion: string;
  s3ConnectionForcePathStyle: boolean;
  allowedMimeTypes: string[];
};

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  fileSizeLimitMb: 50,
  storageBackend: "file",
  s3ProtocolAccessKeyId: "",
  s3ProtocolAccessKeySecret: "",
  s3ProtocolRegion: "",
  s3ConnectionEndpoint: "",
  s3ConnectionAccessKeyId: "",
  s3ConnectionAccessKeySecret: "",
  s3ConnectionRegion: "",
  s3ConnectionForcePathStyle: true,
  allowedMimeTypes: ["image/png", "image/jpg"],
};

function settingsKey(connectionId: number | string) {
  return `rexadb-storage-settings:${connectionId}`;
}

export function loadStorageSettings(connectionId: number | string): StorageSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_STORAGE_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(settingsKey(connectionId));
    if (!raw) return { ...DEFAULT_STORAGE_SETTINGS };
    return { ...DEFAULT_STORAGE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STORAGE_SETTINGS };
  }
}

export function saveStorageSettings(
  connectionId: number | string,
  settings: StorageSettings,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(settingsKey(connectionId), JSON.stringify(settings));
  } catch {
    // private mode / quota — ignore
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function objectSize(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata) return null;
  const size = metadata.size ?? metadata.contentLength ?? metadata.content_length;
  return typeof size === "number" ? size : typeof size === "string" ? Number(size) || null : null;
}

export function objectMimeType(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return "—";
  const t = metadata.mimetype ?? metadata.contentType ?? metadata.content_type ?? metadata.type;
  return typeof t === "string" && t ? t : "—";
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? "" : trimmed.slice(0, idx);
}

export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

/** Marker object written to materialize otherwise-empty folders. Never shown. */
export const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

/** List immediate children of `prefix` (folder path without trailing slash). */
export function listFolderEntries(
  objects: StorageObject[],
  prefix: string,
): Array<{ kind: "folder" | "file"; name: string; object?: StorageObject }> {
  const prefixWithSlash = prefix ? `${prefix}/` : "";
  const folders = new Set<string>();
  const files: StorageObject[] = [];

  for (const obj of objects) {
    const name = obj.name ?? "";
    if (!name) continue;
    if (prefixWithSlash && !name.startsWith(prefixWithSlash)) continue;
    const rest = prefixWithSlash ? name.slice(prefixWithSlash.length) : name;
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      // Hide the marker objects we write to materialize empty folders —
      // but still derive parent folders from their prefixes below.
      if (rest === EMPTY_FOLDER_PLACEHOLDER) continue;
      files.push(obj);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }

  const entries: Array<{ kind: "folder" | "file"; name: string; object?: StorageObject }> = [
    ...Array.from(folders)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ kind: "folder" as const, name })),
    ...files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((object) => ({
        kind: "file" as const,
        name: object.name.split("/").pop() || object.name,
        object,
      })),
  ];
  return entries;
}

// ── resilient fetching ─────────────────────────────────────────────────
// The explicit column lists below can fail on older Supabase projects
// (missing `file_size_limit` / `allowed_mime_types` / `owner_id` columns) or
// on restricted roles, and some proxies choke on the bare `public`
// identifier. So every fetch tries the precise query first and falls back
// to `SELECT *`, normalizing whatever comes back. Callers always get the
// underlying error text so the UI can show it instead of a misleading
// "No buckets" empty state.

function normalizeBuckets(rows: unknown): StorageBucket[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      id: String(r?.id ?? r?.name ?? ""),
      name: String(r?.name ?? r?.id ?? ""),
      public: !!r?.public,
      file_size_limit:
        r?.file_size_limit != null ? Number(r.file_size_limit) : null,
      allowed_mime_types: Array.isArray(r?.allowed_mime_types)
        ? r.allowed_mime_types
        : r?.allowed_mime_types != null
          ? [String(r.allowed_mime_types)]
          : null,
      created_at: r?.created_at ?? null,
      updated_at: r?.updated_at ?? null,
    }))
    .filter((b) => b.name);
}

function normalizeObjects(rows: unknown): StorageObject[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      id: String(r?.id ?? r?.name ?? Math.random().toString(36).slice(2)),
      name: String(r?.name ?? ""),
      bucket_id: String(r?.bucket_id ?? ""),
      owner: r?.owner != null ? String(r.owner) : null,
      owner_id: r?.owner_id != null ? String(r.owner_id) : null,
      created_at: r?.created_at ?? null,
      updated_at: r?.updated_at ?? null,
      last_accessed_at: r?.last_accessed_at ?? null,
      metadata:
        r?.metadata != null && typeof r.metadata === "object"
          ? (r.metadata as Record<string, unknown>)
          : null,
    }))
    .filter((o) => o.name);
}

async function tryQueries(
  connectionString: string,
  queries: string[],
): Promise<{ rows: any[]; error?: string }> {
  let lastError: string | undefined;
  for (const sql of queries) {
    try {
      const res: any = await runQuery(connectionString, sql);
      // /api/sql/run returns { success, data: { rows, ... } } — rows live
      // under `data`, not at the top level.
      if (res?.success === false || res?.error) {
        lastError = String(res?.error ?? "Query failed.");
        continue;
      }
      const rows = res?.data?.rows ?? res?.rows;
      if (Array.isArray(rows)) return { rows };
      lastError = "Unexpected response shape from query.";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { rows: [], error: lastError };
}

const BUCKETS_COLUMNS =
  "id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at";

export async function fetchStorageBuckets(
  connectionString: string,
): Promise<{ buckets: StorageBucket[]; error?: string }> {
  if (!connectionString) return { buckets: [] };
  const { rows, error } = await tryQueries(connectionString, [
    `SELECT ${BUCKETS_COLUMNS} FROM storage.buckets ORDER BY name`,
    `SELECT * FROM storage.buckets ORDER BY name`,
  ]);
  if (error) return { buckets: [], error };
  return { buckets: normalizeBuckets(rows) };
}

export async function fetchStorageBucket(
  connectionString: string,
  bucketName: string,
): Promise<{ bucket: StorageBucket | null; error?: string }> {
  if (!connectionString || !bucketName) return { bucket: null };
  const safe = bucketName.replace(/'/g, "''");
  const where = `WHERE id = '${safe}' OR name = '${safe}' LIMIT 1`;
  const { rows, error } = await tryQueries(connectionString, [
    `SELECT ${BUCKETS_COLUMNS} FROM storage.buckets ${where}`,
    `SELECT * FROM storage.buckets ${where}`,
  ]);
  if (error) return { bucket: null, error };
  return { bucket: normalizeBuckets(rows)[0] ?? null };
}

export async function fetchStorageObjects(
  connectionString: string,
  bucketName: string,
): Promise<{ objects: StorageObject[]; error?: string }> {
  if (!connectionString || !bucketName) return { objects: [] };
  const safe = bucketName.replace(/'/g, "''");
  const where = `WHERE bucket_id = '${safe}' ORDER BY name`;
  const { rows, error } = await tryQueries(connectionString, [
    `SELECT id, name, bucket_id, owner, owner_id, created_at, updated_at, last_accessed_at, metadata FROM storage.objects ${where}`,
    `SELECT * FROM storage.objects ${where}`,
  ]);
  if (error) return { objects: [], error };
  return { objects: normalizeObjects(rows) };
}
