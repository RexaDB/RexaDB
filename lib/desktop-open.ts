import { detectConnectionDbType } from "./db/connection-type";
import { hasConnectionSecret, stripConnectionSecrets } from "./credentials/connection-secret-utils";

/**
 * `rexadb open <database-url-or-file-path>` support (desktop only).
 *
 * The Rust side (`src-tauri`) parses the CLI args, normalizes file paths and
 * hands the target to the frontend via the `get_pending_open_url` command
 * (fresh launch) or the `open-database` event (app already running, delivered
 * through the single-instance plugin). Everything here runs only when
 * `isDesktopRuntime()` is true; the pure helpers below have no side effects
 * and are unit-tested in `tests/lib/desktop-open.test.ts`.
 */

export type OpenDatabaseResult = {
  success: boolean;
  id?: number;
  name?: string;
  error?: string;
};

/** Map a detected db type to the provider id stored on connections. */
export function dbTypeToProvider(dbType: string): string {
  if (dbType === "postgres") return "postgresql";
  return dbType;
}

/** Human-friendly connection name derived from a URL or file path. */
export function deriveOpenConnectionName(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "Database";
  if (trimmed === ":memory:") return "In-memory database";
  const lower = trimmed.toLowerCase();
  const isFileLike =
    !trimmed.includes("://") ||
    lower.startsWith("file:") ||
    lower.startsWith("sqlite:");
  if (isFileLike) {
    const withoutScheme = trimmed.replace(/^(file|sqlite):/i, "");
    const base = (withoutScheme.split(/[\\/]/).pop() ?? "").split("?")[0];
    const stem = base.replace(/\.(db|sqlite3?|duckdb|ddb)$/i, "");
    return stem || "Local database";
  }
  try {
    const url = new URL(trimmed);
    const host = url.host;
    const db = decodeURIComponent(
      url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "",
    );
    if (db && host) return `${db} @ ${host}`;
    if (host) return host;
  } catch {
    // Not parseable as URL — fall through to basename below.
  }
  const base = (trimmed.split(/[\\/]/).pop() ?? "").split("?")[0];
  return base || "Database";
}

async function waitForSidecarReady(
  timeoutMs: number,
  invoke: (command: string) => Promise<unknown>,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      if (await invoke("is_sidecar_ready")) return true;
    } catch {
      // Sidecar/tauri bridge not up yet — keep polling.
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Open a database target instantly: reuse the saved connection with the same
 * (secret-stripped) connection string, or create one, then return its id so
 * the caller can route to `/studio/[id]`.
 */
export async function openDatabaseTarget(
  target: string,
): Promise<OpenDatabaseResult> {
  const trimmed = target.trim();
  if (!trimmed) return { success: false, error: "Empty target." };
  try {
    const apiBase = await import("./api-base");
    await apiBase.initApiBase().catch(() => undefined);
    const { invoke } = await import("@tauri-apps/api/core");
    const ready = await waitForSidecarReady(20000, invoke as (command: string) => Promise<unknown>);
    if (!ready) return { success: false, error: "Sidecar unavailable." };
    await apiBase.refreshApiBase().catch(() => undefined);

    const dbType = detectConnectionDbType(trimmed);
    const provider = dbTypeToProvider(dbType);
    const name = deriveOpenConnectionName(trimmed);

    const { getConnections } = await import("./api/actions-client");
    const existing = await getConnections().catch((): unknown[] => []);
    const strippedTarget = stripConnectionSecrets(trimmed);
    const match = (Array.isArray(existing) ? existing : []).find((conn: any) => {
      const cs = conn?.connectionString;
      return (
        typeof cs === "string" &&
        (cs === trimmed || stripConnectionSecrets(cs) === strippedTarget)
      );
    });
    if (match?.id != null) {
      // Exact same string — reuse immediately.
      if ((match as any).connectionString === trimmed) {
        return { success: true, id: Number((match as any).id), name: (match as any).name || name };
      }
      // Same secret-stripped URL but different raw strings. Only persist when
      // the caller actually supplies new secrets (e.g. rotated password) —
      // a passwordless open of a saved plaintext connection must reuse it
      // unchanged, otherwise the PUT would delete the saved password.
      if (!hasConnectionSecret({ connectionString: trimmed })) {
        return { success: true, id: Number((match as any).id), name: (match as any).name || name };
      }
      try {
        const { protectConnectionPayload } = await import(
          "./credentials/connection-credentials"
        );
        const protectedUpdate = await protectConnectionPayload({
          name: (match as any).name || name,
          connectionString: trimmed,
          connectionType: provider,
        });
        const putRes = await fetch(`${apiBase.API_BASE}/api/connections/${(match as any).id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(protectedUpdate),
        });
        const putJson = (await putRes.json().catch(() => null)) as any;
        if (putRes.ok || putJson?.success) {
          return { success: true, id: Number((match as any).id), name: (match as any).name || name };
        }
      } catch {
        // Fall through — reuse the old id rather than failing the open.
      }
      return { success: true, id: Number((match as any).id), name: (match as any).name || name };
    }

    const { protectConnectionPayload } = await import(
      "./credentials/connection-credentials"
    );
    const protectedPayload = await protectConnectionPayload({
      name,
      connectionString: trimmed,
      connectionType: provider,
    });
    const res = await fetch(`${apiBase.API_BASE}/api/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(protectedPayload),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (json?.success && json?.id != null) {
      return { success: true, id: Number(json.id), name };
    }
    return { success: false, error: json?.error || "Failed to create connection." };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
