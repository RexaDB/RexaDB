/**
 * Shared tool router for the external (user-facing) MCP server.
 *
 * Both transports (stdio + Streamable HTTP) build their `McpServer` from
 * `registerExternalTools()`. Every DB tool accepts an optional `connection`
 * argument (id or name) resolved against the user's allow-list on each call,
 * so Settings changes apply without restarting the server. Permissions come
 * from the globally-selected mode (read-only / autopilot / custom) and are
 * enforced by the existing `executeDbTool` gating.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  executeDbTool,
  type DbToolName,
} from "../db-tools-core";
import {
  loadMcpExternalConfig,
  resolveMcpMode,
  type McpExternalConfig,
} from "./external-config";
import {
  listAllConnectionDeps,
  listExposedConnectionMetas,
  resolveToolConnection,
  toPublicConnectionList,
  type ConnectionDep,
} from "./registry";
import {
  resolveEdgeAccess,
  listEdgeFunctions,
  getEdgeFunction,
  deleteEdgeFunction,
  updateEdgeFunction,
  deployEdgeFunction,
  fetchFunctionBody,
  fetchFunctionEvents,
  listEdgeSecrets,
  upsertEdgeSecrets,
  deleteEdgeSecrets,
} from "../../studio/edge-functions-utils";
import {
  appendMcpAudit,
  extractRowCountForAudit,
  isWriteSqlForAudit,
  type McpAuditDraft,
} from "./audit-log";
import { detectConnectionDbType } from "@/lib/db/connection-type";

/** The MCP SDK's AnySchema type doesn't structurally match zod v4 classic
 * types; runtime is compatible so we cast (same as internal stdio.ts). */
const toolShape = (shape: Record<string, z.ZodType>) => shape as any;

const CONNECTION_DESC =
  "Exposed connection id or name. Omit to use the first exposed connection.";

const connectionField = z
  .union([z.string(), z.number()])
  .optional()
  .describe(CONNECTION_DESC);

const namespaceField = z.string().optional().describe("Database or schema name");
const tableField = z.string().describe("Table or collection name");

export type ExternalToolDeps = {
  loadConfig?: () => Promise<McpExternalConfig>;
  listConnections?: () => Promise<ConnectionDep[]>;
  /** Override the audit sink (tests). Defaults to SQLite appendMcpAudit. */
  audit?: (draft: McpAuditDraft) => void | Promise<void>;
  /** Transport label recorded in the audit log ("stdio" | "http"). */
  transport?: string;
};

/** Mode-denial messages (server-side least privilege, not prompt hints). */
const EDGE_WRITE_DENIED =
  "This MCP permission mode is read-only — Edge Function writes (deploy/update/delete/secrets) are blocked. Switch to a mode with write access to proceed.";
const EDGE_READ_DENIED =
  "This MCP permission mode does not allow reading data.";

function auditOf(deps: ExternalToolDeps) {
  return deps.audit || appendMcpAudit;
}

function logAudit(deps: ExternalToolDeps, draft: McpAuditDraft) {
  try {
    const sink = auditOf(deps);
    const result = sink({ ...draft, transport: draft.transport ?? deps.transport });
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // never fail the tool call on logging errors
  }
}

function toolText(result: Awaited<ReturnType<typeof executeDbTool>>) {
  if (!result.ok) {
    return {
      content: [{ type: "text" as const, text: `Error: ${result.error}` }],
      isError: true as const,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data ?? null, null, 2) }],
  };
}

function errText(error: unknown) {
  return {
    content: [
      { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error || "Unknown error")}` },
    ],
    isError: true as const,
  };
}

async function buildCallContext(
  deps: ExternalToolDeps,
  connectionRef: unknown,
  defaultNamespace?: unknown,
) {
  const loadConfig = deps.loadConfig || loadMcpExternalConfig;
  const listConnections = deps.listConnections || listAllConnectionDeps;
  const config = await loadConfig();
  const mode = resolveMcpMode(config);
  const all = await listConnections();
  const { ctx, meta } = await resolveToolConnection(connectionRef, {
    enabled: config.enabled,
    exposedIds: config.exposedConnectionIds,
    mode,
    all,
  });
  if (typeof defaultNamespace === "string" && defaultNamespace) {
    ctx.defaultNamespace = defaultNamespace;
  }
  return { ctx, meta, mode, config };
}

async function runDbTool(
  deps: ExternalToolDeps,
  name: DbToolName,
  args: Record<string, unknown>,
) {
  const startedAt = Date.now();
  try {
    const namespace = typeof args.namespace === "string" ? args.namespace : undefined;
    const { ctx, meta, mode } = await buildCallContext(deps, args.connection, namespace);
    // `connection` is router-level; strip before dispatch.
    const { connection: _connection, ...toolArgs } = args;
    void _connection;
    const result = await executeDbTool(name, ctx, toolArgs);
    // Audit every run_sql call (read + write) with query cost, plus any
    // mode-denied call so blocked writes leave a trail.
    const deniedByMode =
      !result.ok && /does not allow|read-only|blocked/i.test(result.error);
    if (name === "run_sql" || deniedByMode) {
      const query = typeof toolArgs.query === "string" ? toolArgs.query : undefined;
      logAudit(deps, {
        tool: name,
        modeId: mode.id,
        connectionId: meta.id,
        connectionName: meta.name,
        isWrite: name === "run_sql" ? isWriteSqlForAudit(query || "") : true,
        success: result.ok,
        error: result.ok ? null : result.error,
        durationMs: Date.now() - startedAt,
        rowCount: result.ok ? extractRowCountForAudit(result.data) : null,
        query: name === "run_sql" ? (query ?? null) : null,
      });
    }
    return toolText(result);
  } catch (e) {
    return errText(e);
  }
}

async function resolveEdgeAccessForMcp(
  deps: ExternalToolDeps,
  connectionRef: unknown,
) {
  const { ctx, meta, mode } = await buildCallContext(deps, connectionRef);
  const loadConnections = deps.listConnections || listAllConnectionDeps;
  const all = await loadConnections().catch(() => [] as ConnectionDep[]);
  const row = all.find((r) => Number(r.id) === Number(meta.id));
  const connectionString = row?.connectionString || ctx.connectionString;
  // Prefer the saved connectionType when available, otherwise fall back to
  // detection (supabase-mgmt:// -> supabase-mgmt, postgres URLs -> postgres
  // which resolvePaymentsConnection then maps via host inference).
  const connectionType =
    row?.connectionType || detectConnectionDbType(connectionString, ctx.dbType);
  const { access, error } = await resolveEdgeAccess(connectionType, connectionString);
  return { access, error, mode, meta };
}

/**
 * Server-side least-privilege gate for Edge read tools. Mirrors the
 * `allowSqlRead` enforcement in db-tools-core (sample_rows).
 * Exported for unit tests.
 */
export function denyEdgeReadIfNeeded(
  deps: ExternalToolDeps,
  tool: string,
  mode: { allowSqlRead: boolean; id: string },
  meta: { id: number; name: string },
) {
  if (mode.allowSqlRead) return null;
  logAudit(deps, {
    tool,
    modeId: mode.id,
    connectionId: meta.id,
    connectionName: meta.name,
    isWrite: false,
    success: false,
    error: EDGE_READ_DENIED,
    durationMs: 0,
  });
  return errText(new Error(EDGE_READ_DENIED));
}

/**
 * Server-side least-privilege gate for Edge write tools. Mutating Edge calls
 * require a mode with write access — same rule as mutating SQL.
 * Exported for unit tests.
 */
export function denyEdgeWriteIfNeeded(
  deps: ExternalToolDeps,
  tool: string,
  mode: { allowSqlWrite: boolean; id: string },
  meta: { id: number; name: string },
  extra?: { slug?: string | null; secretCount?: number | null },
) {
  if (mode.allowSqlWrite) return null;
  logAudit(deps, {
    tool,
    modeId: mode.id,
    connectionId: meta.id,
    connectionName: meta.name,
    isWrite: true,
    success: false,
    error: EDGE_WRITE_DENIED,
    durationMs: 0,
    slug: extra?.slug ?? null,
    secretCount: extra?.secretCount ?? null,
  });
  return errText(new Error(EDGE_WRITE_DENIED));
}

function auditEdgeWrite(
  deps: ExternalToolDeps,
  draft: Omit<McpAuditDraft, "transport" | "isWrite">,
) {
  logAudit(deps, { ...draft, isWrite: true });
}

/**
 * Register all external tools on a fresh McpServer. `serverInfo` lets the
 * HTTP transport report its own version string.
 */
export function registerExternalTools(
  server: McpServer,
  deps: ExternalToolDeps = {},
): McpServer {
  const run = (name: DbToolName, args: Record<string, unknown> = {}) =>
    runDbTool(deps, name, args);

  server.registerTool(
    "list_exposed_connections",
    {
      description:
        "List the RexaDB connections the user exposed over MCP (id, name, type). Pass one as `connection` to other tools. Connection strings are never revealed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const loadConfig = deps.loadConfig || loadMcpExternalConfig;
        const listConnections = deps.listConnections || listAllConnectionDeps;
        const config = await loadConfig();
        const mode = resolveMcpMode(config);
        if (!config.enabled) return errText(new Error("The RexaDB MCP server is disabled. Enable it in Settings → MCP Server."));
        const all = await listConnections();
        const exposed = await listExposedConnectionMetas(config.exposedConnectionIds, all);
        return toolText({
          ok: true,
          data: {
            mode: { id: mode.id, label: mode.label, allowSqlRead: mode.allowSqlRead, allowSqlWrite: mode.allowSqlWrite },
            connections: toPublicConnectionList(all, config.exposedConnectionIds).filter((c) => c.exposed),
            // Back-compat alias for clients expecting `tables`-style lists
            exposedCount: exposed.length,
          },
        });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "describe_connection",
    {
      description:
        "Describe the selected exposed RexaDB connection: type, capabilities, and the active MCP permission mode.",
      inputSchema: toolShape({ connection: connectionField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { ctx, meta, mode } = await buildCallContext(deps, args.connection);
        const result = await executeDbTool("describe_connection", ctx, {});
        if (!result.ok) return toolText(result);
        return toolText({
          ok: true,
          data: { ...(result.data as Record<string, unknown>), selectedConnection: meta, activeMode: { id: mode.id, label: mode.label } },
        });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "list_namespaces",
    {
      description: "List databases or schemas on the selected exposed connection.",
      inputSchema: toolShape({ connection: connectionField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("list_namespaces", args),
  );

  server.registerTool(
    "list_tables",
    {
      description: "List tables or collections for a namespace/schema on the selected exposed connection.",
      inputSchema: toolShape({ connection: connectionField, namespace: namespaceField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("list_tables", args),
  );

  server.registerTool(
    "get_table_schema",
    {
      description: "Get columns and field details for a table or collection on the selected exposed connection.",
      inputSchema: toolShape({ connection: connectionField, table: tableField, namespace: namespaceField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("get_table_schema", args),
  );

  server.registerTool(
    "get_related_tables",
    {
      description: "Get foreign-key style relationships for a table when supported.",
      inputSchema: toolShape({ connection: connectionField, table: tableField, namespace: namespaceField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("get_related_tables", args),
  );

  server.registerTool(
    "sample_rows",
    {
      description: "Fetch a small sample of rows from a table (requires read permission in the active MCP mode).",
      inputSchema: toolShape({
        connection: connectionField,
        table: tableField,
        namespace: namespaceField,
        limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 20)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("sample_rows", args),
  );

  server.registerTool(
    "run_sql",
    {
      description:
        "Run SQL (or Mongo/Redis query) against the selected exposed connection. Writes are blocked unless the active MCP mode allows them (autopilot).",
      inputSchema: toolShape({
        connection: connectionField,
        query: z.string().describe("SQL / Mongo JSON / Redis command"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>) => run("run_sql", args),
  );

  server.registerTool(
    "search_schema",
    {
      description: "Fuzzy-search tables and columns by keyword on the selected exposed connection.",
      inputSchema: toolShape({
        connection: connectionField,
        query: z.string().describe("Search keyword"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("search_schema", args),
  );

  // Edge Functions tools
  server.registerTool(
    "list_edge_functions",
    {
      description: "List all Edge Functions for the selected Supabase project connection.",
      inputSchema: toolShape({ connection: connectionField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "list_edge_functions", mode, meta);
        if (denied) return denied;
        
        const { functions, error } = await listEdgeFunctions(access);
        if (error) return errText(error);
        
        return toolText({ ok: true, data: functions });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_edge_function",
    {
      description: "Get details of a specific Edge Function by slug.",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug (identifier)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "get_edge_function", mode, meta);
        if (denied) return denied;
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const { function: fn, error } = await getEdgeFunction(access, slug);
        if (error) return errText(error);
        
        return toolText({ ok: true, data: fn });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "create_edge_function",
    {
      description: "Create a new Edge Function by deploying source code.",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug (identifier)"),
        name: z.string().optional().describe("Display name"),
        verifyJwt: z.boolean().optional().describe("Require JWT verification"),
        entrypointPath: z.string().optional().describe("Entry point file path (default: index.ts)"),
        files: z.array(z.object({
          name: z.string().describe("File name"),
          content: z.string().describe("File content"),
        })).describe("Source files to deploy"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const denied = denyEdgeWriteIfNeeded(deps, "create_edge_function", mode, meta, { slug });
        if (denied) return denied;
        const name = typeof args.name === "string" ? args.name : undefined;
        const verifyJwt = typeof args.verifyJwt === "boolean" ? args.verifyJwt : undefined;
        const entrypointPath = typeof args.entrypointPath === "string" ? args.entrypointPath : "index.ts";
        const files = Array.isArray(args.files) ? args.files as Array<{ name: string; content: string }> : [];
        
        const { error } = await deployEdgeFunction(access, slug, { entrypointPath, name, verifyJwt }, files);
        auditEdgeWrite(deps, {
          tool: "create_edge_function",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          slug,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: { message: "Edge function created successfully", slug } });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "update_edge_function",
    {
      description: "Update Edge Function metadata (name, JWT verification).",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
        name: z.string().optional().describe("New display name"),
        verifyJwt: z.boolean().optional().describe("JWT verification setting"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const denied = denyEdgeWriteIfNeeded(deps, "update_edge_function", mode, meta, { slug });
        if (denied) return denied;
        const name = typeof args.name === "string" ? args.name : undefined;
        const verifyJwt = typeof args.verifyJwt === "boolean" ? args.verifyJwt : undefined;
        
        const { function: fn, error } = await updateEdgeFunction(access, slug, { name, verify_jwt: verifyJwt });
        auditEdgeWrite(deps, {
          tool: "update_edge_function",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          slug,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: fn });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "delete_edge_function",
    {
      description: "Delete an Edge Function by slug.",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const denied = denyEdgeWriteIfNeeded(deps, "delete_edge_function", mode, meta, { slug });
        if (denied) return denied;
        const { error } = await deleteEdgeFunction(access, slug);
        auditEdgeWrite(deps, {
          tool: "delete_edge_function",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          slug,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: { message: "Edge function deleted successfully", slug } });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_edge_function_code",
    {
      description: "Get the source code of an Edge Function.",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "get_edge_function_code", mode, meta);
        if (denied) return denied;
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const { files, error } = await fetchFunctionBody(access, slug);
        if (error) return errText(error);
        
        return toolText({ ok: true, data: files });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "deploy_edge_function_code",
    {
      description: "Deploy updated source code to an Edge Function.",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
        entrypointPath: z.string().optional().describe("Entry point file path (default: index.ts)"),
        files: z.array(z.object({
          name: z.string().describe("File name"),
          content: z.string().describe("File content"),
        })).describe("Source files to deploy"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const denied = denyEdgeWriteIfNeeded(deps, "deploy_edge_function_code", mode, meta, { slug });
        if (denied) return denied;
        const entrypointPath = typeof args.entrypointPath === "string" ? args.entrypointPath : "index.ts";
        const files = Array.isArray(args.files) ? args.files as Array<{ name: string; content: string }> : [];
        
        const { error } = await deployEdgeFunction(access, slug, { entrypointPath }, files);
        auditEdgeWrite(deps, {
          tool: "deploy_edge_function_code",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          slug,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: { message: "Edge function code deployed successfully", slug } });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_edge_function_logs",
    {
      description: "Get logs for an Edge Function (invocations or console output).",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
        source: z.enum(["function_edge_logs", "function_logs"]).optional().describe("Log source: function_edge_logs (invocations) or function_logs (console output)"),
        hours: z.number().int().min(1).max(168).optional().describe("Time range in hours (default: 1)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "get_edge_function_logs", mode, meta);
        if (denied) return denied;
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const source = (args.source === "function_edge_logs" || args.source === "function_logs") ? args.source : "function_edge_logs";
        const hours = typeof args.hours === "number" ? args.hours : 1;
        
        const end = new Date();
        const start = new Date(end.getTime() - hours * 3600 * 1000);
        
        const { events, error } = await fetchFunctionEvents(access, slug, source, { start, end });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: events });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "get_edge_function_invocations",
    {
      description: "Get invocation events for an Edge Function (HTTP requests/responses).",
      inputSchema: toolShape({
        connection: connectionField,
        slug: z.string().describe("Function slug"),
        hours: z.number().int().min(1).max(168).optional().describe("Time range in hours (default: 1)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "get_edge_function_invocations", mode, meta);
        if (denied) return denied;
        
        const slug = typeof args.slug === "string" ? args.slug : "";
        const hours = typeof args.hours === "number" ? args.hours : 1;
        
        const end = new Date();
        const start = new Date(end.getTime() - hours * 3600 * 1000);
        
        const { events, error } = await fetchFunctionEvents(access, slug, "function_edge_logs", { start, end });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: events });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "list_edge_secrets",
    {
      description: "List all Edge Function secrets for the project.",
      inputSchema: toolShape({ connection: connectionField }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        const denied = denyEdgeReadIfNeeded(deps, "list_edge_secrets", mode, meta);
        if (denied) return denied;
        
        const { secrets, error } = await listEdgeSecrets(access);
        if (error) return errText(error);
        
        // Least privilege: AI clients get names only — never secret values.
        return toolText({
          ok: true,
          data: secrets.map((s) => ({ name: s.name, updated_at: s.updated_at ?? null })),
        });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "upsert_edge_secrets",
    {
      description: "Create or update Edge Function secrets.",
      inputSchema: toolShape({
        connection: connectionField,
        secrets: z.array(z.object({
          name: z.string().describe("Secret name"),
          value: z.string().describe("Secret value"),
        })).describe("Secrets to create or update"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const secrets = Array.isArray(args.secrets) ? args.secrets as Array<{ name: string; value: string }> : [];
        const denied = denyEdgeWriteIfNeeded(deps, "upsert_edge_secrets", mode, meta, { secretCount: secrets.length });
        if (denied) return denied;
        
        const { error } = await upsertEdgeSecrets(access, secrets);
        auditEdgeWrite(deps, {
          tool: "upsert_edge_secrets",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          // counts only — never secret names/values
          secretCount: secrets.length,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: { message: "Secrets updated successfully", count: secrets.length } });
      } catch (e) {
        return errText(e);
      }
    },
  );

  server.registerTool(
    "delete_edge_secrets",
    {
      description: "Delete Edge Function secrets by name.",
      inputSchema: toolShape({
        connection: connectionField,
        names: z.array(z.string()).describe("Secret names to delete"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const startedAt = Date.now();
        const { access, error: accessError, mode, meta } = await resolveEdgeAccessForMcp(deps, args.connection);
        if (!access) return errText(accessError || "Edge Functions are not available for this connection type.");
        
        const names = Array.isArray(args.names) ? args.names as string[] : [];
        const denied = denyEdgeWriteIfNeeded(deps, "delete_edge_secrets", mode, meta, { secretCount: names.length });
        if (denied) return denied;
        
        const { error } = await deleteEdgeSecrets(access, names);
        auditEdgeWrite(deps, {
          tool: "delete_edge_secrets",
          modeId: mode.id,
          connectionId: meta.id,
          connectionName: meta.name,
          success: !error,
          error: error ?? null,
          durationMs: Date.now() - startedAt,
          // counts only — never secret names
          secretCount: names.length,
        });
        if (error) return errText(error);
        
        return toolText({ ok: true, data: { message: "Secrets deleted successfully", count: names.length } });
      } catch (e) {
        return errText(e);
      }
    },
  );

  return server;
}

export function createExternalMcpServer(deps: ExternalToolDeps = {}): McpServer {
  const server = new McpServer({ name: "rexadb", version: "2.0.0" });
  return registerExternalTools(server, deps);
}
