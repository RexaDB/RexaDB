import { join } from "node:path";
import type { RexaAgentAppMode } from "../app-modes";

export type RexaMcpLaunchEnv = {
  REXADB_CONNECTION_STRING: string;
  REXADB_DB_TYPE: string;
  REXADB_CONNECTION_NAME: string;
  REXADB_ALLOW_SQL_READ: string;
  REXADB_ALLOW_SQL_WRITE: string;
  REXADB_MODE: string;
};

export type RexaMcpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env: RexaMcpLaunchEnv;
};

/**
 * Absolute path to the MCP stdio entry, resolved from the repo/server cwd.
 */
export function getRexaMcpEntryPath(cwd = process.cwd()): string {
  return join(cwd, "lib/agents/mcp/stdio.ts");
}

export function buildRexaMcpEnv(input: {
  connectionString: string;
  dbType: string;
  connectionName?: string;
  appMode: RexaAgentAppMode;
}): RexaMcpLaunchEnv {
  return {
    REXADB_CONNECTION_STRING: input.connectionString,
    REXADB_DB_TYPE: input.dbType || "unknown",
    REXADB_CONNECTION_NAME: input.connectionName || "",
    REXADB_ALLOW_SQL_READ: input.appMode.allowSqlRead ? "1" : "0",
    REXADB_ALLOW_SQL_WRITE: input.appMode.allowSqlWrite ? "1" : "0",
    REXADB_MODE: input.appMode.id,
  };
}

/**
 * ACP / Claude-compatible MCP server descriptor for a single agent turn.
 * Uses `bun` to run the TypeScript entry directly.
 */
export function buildRexaMcpServerConfig(input: {
  connectionString: string;
  dbType: string;
  connectionName?: string;
  appMode: RexaAgentAppMode;
  cwd?: string;
}): RexaMcpServerConfig {
  const entry = getRexaMcpEntryPath(input.cwd);
  return {
    name: "rexadb",
    command: process.execPath.includes("bun") ? process.execPath : "bun",
    args: ["run", entry],
    env: buildRexaMcpEnv(input),
  };
}

/** Claude Code `--mcp-config` JSON shape (mcpServers map). */
export function buildClaudeMcpConfigJson(config: RexaMcpServerConfig): string {
  return JSON.stringify({
    mcpServers: {
      [config.name]: {
        command: config.command,
        args: config.args,
        env: config.env,
      },
    },
  });
}
