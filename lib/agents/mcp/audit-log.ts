/**
 * Server-side audit log for the external (user-facing) MCP server.
 *
 * Records every mutating tool call (writes) plus query cost for `run_sql`
 * (duration, row count, query hash + truncated preview). Never stores
 * connection strings, secret values, or edge function source code.
 *
 * Best-effort by design: logging must never fail the tool call itself.
 * Persisted in local SQLite `mcp_audit_log` (created by ensureCoreTables).
 */
import { createHash, randomUUID } from "node:crypto";

export const MCP_AUDIT_QUERY_PREVIEW_CHARS = 2000;
export const MCP_AUDIT_RETENTION_ROWS = 5000;

export type McpAuditDraft = {
  /** Tool name, e.g. "run_sql" or "deploy_edge_function_code". */
  tool: string;
  /** "stdio" | "http" | undefined when unknown (tests, internal). */
  transport?: string;
  modeId?: string;
  connectionId?: number | null;
  connectionName?: string | null;
  /** True for mutating calls (SQL writes + edge deploys/secret changes). */
  isWrite: boolean;
  success: boolean;
  error?: string | null;
  /** Wall-clock cost of the tool execution. */
  durationMs?: number | null;
  /** Rows returned/affected when known (query cost signal). */
  rowCount?: number | null;
  /** Full query text — hashed + truncated before storage, never raw. */
  query?: string | null;
  /** Edge function slug when the tool targets one. */
  slug?: string | null;
  /** Count of secrets touched (never names/values). */
  secretCount?: number | null;
};

export type McpAuditRow = {
  id: string;
  createdAt: number;
  transport: string | null;
  modeId: string | null;
  connectionId: number | null;
  connectionName: string | null;
  tool: string;
  isWrite: boolean;
  success: boolean;
  error: string | null;
  durationMs: number | null;
  rowCount: number | null;
  queryHash: string | null;
  queryPreview: string | null;
  slug: string | null;
  secretCount: number | null;
};

export function hashQueryForAudit(query: string): string {
  return createHash("sha256").update(String(query || ""), "utf8").digest("hex").slice(0, 32);
}

export function previewQueryForAudit(query: string): string {
  return String(query || "").slice(0, MCP_AUDIT_QUERY_PREVIEW_CHARS);
}

function toStoredRow(draft: McpAuditDraft): McpAuditRow {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    transport: draft.transport ?? null,
    modeId: draft.modeId ?? null,
    connectionId: typeof draft.connectionId === "number" ? draft.connectionId : null,
    connectionName: draft.connectionName ?? null,
    tool: String(draft.tool || "unknown").slice(0, 80),
    isWrite: draft.isWrite === true,
    success: draft.success === true,
    error: typeof draft.error === "string" ? draft.error.slice(0, 500) : null,
    durationMs: typeof draft.durationMs === "number" ? Math.round(draft.durationMs) : null,
    rowCount: typeof draft.rowCount === "number" ? draft.rowCount : null,
    queryHash: typeof draft.query === "string" && draft.query ? hashQueryForAudit(draft.query) : null,
    queryPreview:
      typeof draft.query === "string" && draft.query ? previewQueryForAudit(draft.query) : null,
    slug: typeof draft.slug === "string" && draft.slug ? draft.slug.slice(0, 200) : null,
    secretCount: typeof draft.secretCount === "number" ? draft.secretCount : null,
  };
}

/** Best-effort insert. Never throws — callers must not fail tools on log errors. */
export async function appendMcpAudit(draft: McpAuditDraft): Promise<void> {
  try {
    const { ensureCoreTables } = await import("@/lib/db/ensure-core-tables");
    await ensureCoreTables();
    const { db } = await import("@/lib/db/index");
    const { mcpAuditLog } = await import("@/lib/db/schema");
    const row = toStoredRow(draft);
    await db.insert(mcpAuditLog).values({
      id: row.id,
      createdAt: row.createdAt,
      transport: row.transport,
      modeId: row.modeId,
      connectionId: row.connectionId,
      connectionName: row.connectionName,
      tool: row.tool,
      isWrite: row.isWrite,
      success: row.success,
      error: row.error,
      durationMs: row.durationMs,
      rowCount: row.rowCount,
      queryHash: row.queryHash,
      queryPreview: row.queryPreview,
      slug: row.slug,
      secretCount: row.secretCount,
    });
    // Fire-and-forget retention trim (keep the table bounded).
    void trimMcpAuditLog().catch(() => {});
  } catch (e) {
    console.warn("[rexadb-mcp] audit log write failed:", e instanceof Error ? e.message : e);
  }
}

async function trimMcpAuditLog(): Promise<void> {
  const { db } = await import("@/lib/db/index");
  const { mcpAuditLog } = await import("@/lib/db/schema");
  const { sql } = await import("drizzle-orm");
  await db.run(
    sql.raw(
      `DELETE FROM "mcp_audit_log" WHERE "id" NOT IN (SELECT "id" FROM "mcp_audit_log" ORDER BY "created_at" DESC LIMIT ${MCP_AUDIT_RETENTION_ROWS})`,
    ),
  );
}

export type McpAuditFilter = {
  limit?: number;
  writesOnly?: boolean;
  tool?: string;
  connectionId?: number;
};

export async function listMcpAuditLog(filter: McpAuditFilter = {}): Promise<McpAuditRow[]> {
  const { ensureCoreTables } = await import("@/lib/db/ensure-core-tables");
  await ensureCoreTables();
  const { db } = await import("@/lib/db/index");
  const { mcpAuditLog } = await import("@/lib/db/schema");
  const { desc, eq, and } = await import("drizzle-orm");
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const conditions: any[] = [];
  if (filter.writesOnly) conditions.push(eq(mcpAuditLog.isWrite, true));
  if (filter.tool) conditions.push(eq(mcpAuditLog.tool, filter.tool));
  if (typeof filter.connectionId === "number") {
    conditions.push(eq(mcpAuditLog.connectionId, filter.connectionId));
  }
  const rows = await db
    .select()
    .from(mcpAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mcpAuditLog.createdAt))
    .limit(limit);
  return rows.map((r: any) => ({
    id: String(r.id),
    createdAt: Number(r.createdAt),
    transport: r.transport ?? null,
    modeId: r.modeId ?? null,
    connectionId: r.connectionId ?? null,
    connectionName: r.connectionName ?? null,
    tool: String(r.tool),
    isWrite: r.isWrite === true || Number(r.isWrite) === 1,
    success: r.success === true || Number(r.success) === 1,
    error: r.error ?? null,
    durationMs: r.durationMs ?? null,
    rowCount: r.rowCount ?? null,
    queryHash: r.queryHash ?? null,
    queryPreview: r.queryPreview ?? null,
    slug: r.slug ?? null,
    secretCount: r.secretCount ?? null,
  }));
}

/** Detect mutating SQL for audit classification (conservative — unknown → write). */
export function isWriteSqlForAudit(query: string): boolean {
  const q = String(query || "").trim();
  if (!q) return true;
  if (/^(select|with|explain)\b/i.test(q)) return false;
  return true;
}

/** Extract a row-count cost signal from executeDbTool result data shapes. */
export function extractRowCountForAudit(data: unknown): number | null {
  try {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    if (typeof d.rowCount === "number") return d.rowCount;
    if (typeof d.rowsCount === "number") return d.rowsCount;
    if (Array.isArray(d.rows)) return d.rows.length;
    if (Array.isArray(d.matches)) return d.matches.length;
    if (Array.isArray(d.tables)) return (d.tables as unknown[]).length;
    if (Array.isArray(d.namespaces)) return (d.namespaces as unknown[]).length;
  } catch {
    // ignore
  }
  return null;
}
