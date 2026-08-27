/**
 * RexaDB Agents MCP server (stdio).
 *
 * Spawned per harness turn with env:
 *   REXADB_CONNECTION_STRING
 *   REXADB_DB_TYPE
 *   REXADB_CONNECTION_NAME
 *   REXADB_ALLOW_SQL_READ=1|0
 *   REXADB_ALLOW_SQL_WRITE=1|0
 *   REXADB_MODE=rexadb-plan|rexadb-build|…
 *
 * Run: bun run lib/agents/mcp/stdio.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  executeDbTool,
  type DbToolsContext,
  type DbToolName,
} from "../db-tools-core";

/**
 * The MCP SDK's `AnySchema` type is `z3.ZodTypeAny | z4.$ZodType`, but zod v4's
 * classic API types (ZodString, ZodOptional, …) don't structurally match either
 * branch. Runtime is fully compatible, so we cast the input shape to bypass the
 * type-only mismatch.
 */
const toolShape = (shape: Record<string, z.ZodType>) => shape as any;

function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true" || v === "yes";
}

function buildContext(): DbToolsContext {
  const connectionString = process.env.REXADB_CONNECTION_STRING || "";
  if (!connectionString) {
    throw new Error("REXADB_CONNECTION_STRING is required for the RexaDB MCP server");
  }
  return {
    connectionString,
    dbType: process.env.REXADB_DB_TYPE || undefined,
    connectionName: process.env.REXADB_CONNECTION_NAME || undefined,
    permissions: {
      allowSqlRead: envFlag("REXADB_ALLOW_SQL_READ", true),
      allowSqlWrite: envFlag("REXADB_ALLOW_SQL_WRITE", false),
    },
  };
}

function toolText(result: Awaited<ReturnType<typeof executeDbTool>>) {
  if (!result.ok) {
    return {
      content: [{ type: "text" as const, text: `Error: ${result.error}` }],
      isError: true as const,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result.data ?? null, null, 2),
      },
    ],
  };
}

async function main() {
  const ctx = buildContext();
  const mode = process.env.REXADB_MODE || "rexadb-plan";

  const server = new McpServer({
    name: "rexadb",
    version: "1.0.0",
  });

  const run = (name: DbToolName, args: Record<string, unknown> = {}) =>
    executeDbTool(name, ctx, args).then(toolText);

  server.registerTool(
    "describe_connection",
    {
      description:
        "Describe the live RexaDB database connection, capabilities, and current agent SQL permissions.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => run("describe_connection"),
  );

  server.registerTool(
    "list_namespaces",
    {
      description: "List databases or schemas on the current RexaDB connection.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => run("list_namespaces"),
  );

  server.registerTool(
    "list_tables",
    {
      description: "List tables or collections for a namespace/schema.",
      inputSchema: toolShape({
        namespace: z
          .string()
          .optional()
          .describe("Database or schema name"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("list_tables", args),
  );

  server.registerTool(
    "get_table_schema",
    {
      description: "Get columns and field details for a table or collection.",
      inputSchema: toolShape({
        table: z.string().describe("Table or collection name"),
        namespace: z.string().optional().describe("Database or schema name"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("get_table_schema", args),
  );

  server.registerTool(
    "get_related_tables",
    {
      description: "Get foreign-key style relationships for a table when supported.",
      inputSchema: toolShape({
        table: z.string().describe("Table name"),
        namespace: z.string().optional().describe("Schema name"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("get_related_tables", args),
  );

  server.registerTool(
    "sample_rows",
    {
      description: "Fetch a small sample of rows from a table (requires read permission).",
      inputSchema: toolShape({
        table: z.string().describe("Table or collection name"),
        namespace: z.string().optional().describe("Schema name"),
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
        "Run SQL (or Mongo/Redis query) against the live RexaDB connection. Writes are blocked in plan/read-only modes.",
      inputSchema: toolShape({
        query: z.string().describe("SQL / Mongo JSON / Redis command"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>) => run("run_sql", args),
  );

  server.registerTool(
    "search_schema",
    {
      description: "Fuzzy-search tables and columns by keyword.",
      inputSchema: toolShape({
        query: z.string().describe("Search keyword"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => run("search_schema", args),
  );

  // Log to stderr only — stdout is the MCP JSON-RPC channel.
  console.error(
    `[rexadb-mcp] starting mode=${mode} read=${ctx.permissions.allowSqlRead} write=${ctx.permissions.allowSqlWrite} dbType=${ctx.dbType || "auto"}`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[rexadb-mcp] fatal:", error);
  process.exit(1);
});
