/**
 * Multi-connection registry for the external MCP server.
 *
 * Resolves the user's allow-list (`exposedConnectionIds`) to live connection
 * rows, and resolves a per-tool `connection` reference (id or name) to a
 * single-connection `DbToolsContext` that the existing `executeDbTool`
 * handlers already understand (including read/write gating).
 */
import { detectConnectionDbType } from "@/lib/db/connection-type";
import type { DbToolsContext } from "../db-tools-core";
import type { RexaAgentAppMode } from "../app-modes";
import { maskConnectionString } from "./external-config";

export type ExposedConnectionMeta = {
  id: number;
  name: string;
  dbType: string;
};

export type ConnectionDep = {
  id: number;
  name: string;
  connectionString: string;
  connectionType?: string | null;
};

export function toExposedMeta(row: ConnectionDep): ExposedConnectionMeta {
  let dbType = "unknown";
  try {
    dbType = row.connectionType || detectConnectionDbType(row.connectionString);
  } catch {
    // keep unknown
  }
  return { id: row.id, name: row.name || `Connection ${row.id}`, dbType };
}

export function parseConnectionRef(ref: unknown): number | string | undefined {
  if (ref === undefined || ref === null || ref === "") return undefined;
  if (typeof ref === "number" && Number.isInteger(ref)) return ref;
  const s = String(ref).trim();
  if (!s) return undefined;
  const asNum = Number(s);
  if (Number.isInteger(asNum) && asNum > 0 && String(asNum) === s) return asNum;
  return s;
}

export async function listAllConnectionDeps(): Promise<ConnectionDep[]> {
  const { getConnections } = await import("@/lib/db/actions-core");
  const rows = await getConnections();
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || `Connection ${r.id}`),
    connectionString: String(r.connectionString || ""),
    connectionType: r.connectionType ?? null,
  }));
}

/** Connections the user exposed, in allow-list order, as secret-free metadata. */
export async function listExposedConnectionMetas(
  exposedIds: number[],
  all?: ConnectionDep[],
): Promise<ExposedConnectionMeta[]> {
  const rows = all ?? (await listAllConnectionDeps());
  const byId = new Map(rows.map((r) => [r.id, r]));
  const metas: ExposedConnectionMeta[] = [];
  for (const id of exposedIds) {
    const row = byId.get(Number(id));
    if (!row || !row.connectionString) continue;
    // Skip virtual workspace pointers — they need a browser session.
    if (String(row.connectionString).startsWith("workspace:")) continue;
    metas.push(toExposedMeta(row));
  }
  return metas;
}

/**
 * Resolve a tool-call connection reference to a live single-connection
 * context. Throws when the server is disabled, nothing is exposed, or the
 * reference is unknown / not exposed (fail closed — never fall back to an
 * unexposed connection).
 */
export async function resolveToolConnection(
  ref: unknown,
  opts: {
    enabled: boolean;
    exposedIds: number[];
    mode: RexaAgentAppMode;
    all?: ConnectionDep[];
  },
): Promise<{ ctx: DbToolsContext; meta: ExposedConnectionMeta }> {
  if (!opts.enabled) {
    throw new Error("The RexaDB MCP server is disabled. Enable it in Settings → MCP Server.");
  }
  const rows = opts.all ?? (await listAllConnectionDeps());
  const usable = rows.filter(
    (r) => r.connectionString && !String(r.connectionString).startsWith("workspace:"),
  );
  const exposedSet = new Set((opts.exposedIds || []).map(Number));
  const exposed = usable.filter((r) => exposedSet.has(r.id));
  if (exposed.length === 0) {
    throw new Error("No connections are exposed over MCP. Select connections in Settings → MCP Server.");
  }
  const parsed = parseConnectionRef(ref);
  let row: ConnectionDep | undefined;
  if (parsed === undefined) {
    row = exposed[0];
  } else if (typeof parsed === "number") {
    row = exposed.find((r) => r.id === parsed);
    if (!row) throw new Error(`Connection id ${parsed} is not exposed over MCP.`);
  } else {
    const needle = parsed.toLowerCase();
    row =
      exposed.find((r) => r.name.toLowerCase() === needle) ||
      exposed.find((r) => r.name.toLowerCase().includes(needle));
    if (!row) throw new Error(`Connection "${parsed}" is not exposed over MCP.`);
  }
  if (!row) throw new Error("No exposed connection matched.");
  const meta = toExposedMeta(row);
  const ctx: DbToolsContext = {
    connectionString: row.connectionString,
    dbType: meta.dbType,
    connectionName: row.name,
    permissions: {
      allowSqlRead: opts.mode.allowSqlRead,
      allowSqlWrite: opts.mode.allowSqlWrite,
    },
  };
  return { ctx, meta };
}

/** Shape returned by list_exposed_connections — includes masked DSN hint only. */
export function toPublicConnectionList(
  all: ConnectionDep[],
  exposedIds: number[],
): Array<ExposedConnectionMeta & { exposed: boolean; dsnHint: string }> {
  const exposedSet = new Set(exposedIds.map(Number));
  return all
    .filter((r) => r.connectionString && !String(r.connectionString).startsWith("workspace:"))
    .map((r) => ({
      ...toExposedMeta(r),
      exposed: exposedSet.has(r.id),
      dsnHint: maskConnectionString(r.connectionString),
    }));
}
