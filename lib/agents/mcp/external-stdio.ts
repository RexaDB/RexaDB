/**
 * RexaDB user-facing MCP server (stdio).
 *
 * Exposes the user's allow-listed connections with the globally-selected
 * permission mode (read-only / autopilot / custom from Settings → MCP Server).
 *
 * Run: bun run lib/agents/mcp/external-stdio.ts
 * Config: SQLite `mcp_server_config` row (written by the Settings UI), with
 * JSON-file fallback at $REXADB_MCP_CONFIG_PATH or <user-data>/rexadb-mcp.json.
 * Env overrides: REXADB_MCP_CONFIG_PATH, REXADB_MCP_MODE, REXADB_MCP_EXPOSED_IDS.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadMcpExternalConfig, resolveMcpMode } from "./external-config";
import { listAllConnectionDeps } from "./registry";
import { registerExternalTools } from "./handlers";

async function main() {
  const server = new McpServer({ name: "rexadb", version: "2.0.0" });
  registerExternalTools(server);

  // Log to stderr only — stdout is the MCP JSON-RPC channel.
  try {
    const config = await loadMcpExternalConfig();
    const mode = resolveMcpMode(config);
    const exposed = await listAllConnectionDeps()
      .then((all) => all.filter((c) => config.exposedConnectionIds.includes(c.id)).length)
      .catch(() => 0);
    console.error(
      `[rexadb-mcp] external stdio starting enabled=${config.enabled} mode=${mode.id} read=${mode.allowSqlRead} write=${mode.allowSqlWrite} exposed=${exposed}`,
    );
    if (!config.enabled) {
      console.error("[rexadb-mcp] server is disabled — tools will refuse until enabled in Settings → MCP Server.");
    }
  } catch (e) {
    console.error("[rexadb-mcp] config load failed:", e);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[rexadb-mcp] fatal:", error);
  process.exit(1);
});
