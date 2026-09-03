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
};

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
  try {
    const namespace = typeof args.namespace === "string" ? args.namespace : undefined;
    const { ctx } = await buildCallContext(deps, args.connection, namespace);
    // `connection` is router-level; strip before dispatch.
    const { connection: _connection, ...toolArgs } = args;
    void _connection;
    return toolText(await executeDbTool(name, ctx, toolArgs));
  } catch (e) {
    return errText(e);
  }
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

  return server;
}

export function createExternalMcpServer(deps: ExternalToolDeps = {}): McpServer {
  const server = new McpServer({ name: "rexadb", version: "2.0.0" });
  return registerExternalTools(server, deps);
}
