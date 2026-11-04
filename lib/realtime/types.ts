// Browser-safe types shared by the sidecar table watcher and the grid.

export const REALTIME_ERROR = {
  /** Neon branch has Realtime off. */
  disabled: "REALTIME_DISABLED",
  /** Neon branch is still provisioning or rotating. */
  pending: "REALTIME_PENDING",
  /** Supabase table is missing from the supabase_realtime publication. */
  notPublished: "TABLE_NOT_PUBLISHED",
  noPrimaryKey: "NO_PRIMARY_KEY",
  unsupported: "UNSUPPORTED",
} as const;

export type RealtimeErrorCode = (typeof REALTIME_ERROR)[keyof typeof REALTIME_ERROR];

export interface TableWatchRequest {
  /** The connection's stored string: a neon-cli:// or supabase-mgmt:// pointer. */
  connectionString: string;
  schema: string;
  table: string;
  primaryKey: string[];
  /** The grid's window — Neon watches only these rows, so they must match
   *  the grid's own WHERE / ORDER BY / LIMIT / OFFSET. */
  filter?: string;
  sort?: { column: string; direction: "ASC" | "DESC" } | null;
  limit: number;
  offset: number;
}

export type TableWatchEvent =
  | { type: "status"; status: "connecting" | "live" | "stale" | "closed" }
  | { type: "change"; count: number }
  | { type: "error"; message: string; code?: RealtimeErrorCode };

export type RealtimeProvider = "neon" | "supabase";

export function realtimeProviderFor(connectionString?: string | null): RealtimeProvider | null {
  const raw = String(connectionString ?? "").trim().toLowerCase();
  if (raw.startsWith("neon-cli://")) return "neon";
  if (raw.startsWith("supabase-mgmt://")) return "supabase";
  return null;
}
