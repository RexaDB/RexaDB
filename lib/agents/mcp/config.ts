import { join } from "node:path";
import type { RexaAgentAppMode } from "../app-modes";

export type RexaMcpLaunchEnv = {
  REXADB_CONNECTION_STRING: string;
  REXADB_DB_TYPE: string;
  REXADB_CONNECTION_NAME: string;
  REXADB_ALLOW_SQL_READ: string;
  REXADB_ALLOW_SQL_WRITE: string;
  REXADB_MODE: string;
  REXADB_STUDIO_ARTIFACT_FILE?: string;
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
  studioArtifactFile?: string;
}): RexaMcpLaunchEnv {
  return {
    REXADB_CONNECTION_STRING: input.connectionString,
    REXADB_DB_TYPE: input.dbType || "unknown",
    REXADB_CONNECTION_NAME: input.connectionName || "",
    REXADB_ALLOW_SQL_READ: input.appMode.allowSqlRead ? "1" : "0",
    REXADB_ALLOW_SQL_WRITE: input.appMode.allowSqlWrite ? "1" : "0",
    REXADB_MODE: input.appMode.id,
    ...(input.studioArtifactFile ? { REXADB_STUDIO_ARTIFACT_FILE: input.studioArtifactFile } : {}),
  };
}

/**
 * ACP / Claude-compatible MCP server descriptor for a single agent turn.
 * Uses `bun` to run the TypeScript entry directly.
 */
function isCompiledSidecar(): boolean {
  return /rexadb-server(?:-|\.|$)/i.test(process.execPath.split(/[\\/]/).pop() || "");
}

/** Shell command for CLIs without MCP; callers append a tool name and pipe its JSON arguments. */
export function buildStudioToolCommand(cwd = process.cwd()): string {
  const parts = isCompiledSidecar()
    ? [process.execPath, "--agent-studio-tool"]
    : [process.execPath.includes("bun") ? process.execPath : "bun", "run", join(cwd, "lib/agents/mcp/studio-tool-cli.ts")];
  return parts.map((part) => JSON.stringify(part)).join(" ");
}

export function buildRexaMcpServerConfig(input: {
  connectionString: string;
  dbType: string;
  connectionName?: string;
  appMode: RexaAgentAppMode;
  cwd?: string;
  /** Enables chat-only studio tools; they append results to this JSONL file. */
  studioArtifactFile?: string;
}): RexaMcpServerConfig {
  // Compiled desktop sidecars include the MCP entry; no external Bun or .ts
  // sources are available in an installed app.
  const compiled = isCompiledSidecar();
  const entry = getRexaMcpEntryPath(input.cwd);
  return {
    name: "rexadb",
    command: compiled ? process.execPath : process.execPath.includes("bun") ? process.execPath : "bun",
    args: compiled ? ["--agent-mcp"] : ["run", entry],
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

// ─── External (user-facing) server client configs ───────────────────────────
// The external server needs no per-connection env — it reads the allow-list +
// mode from the sidecar DB/file. `cwd` should be the app root (repo checkout,
// or the packaged resources dir) so the relative entry resolves.

export function getExternalMcpEntryPath(cwd = process.cwd()): string {
  return join(cwd, "lib/agents/mcp/external-stdio.ts");
}

export function buildExternalStdioDescriptor(cwd = process.cwd()): {
  command: string;
  args: string[];
} {
  return {
    command: process.execPath.includes("bun") ? process.execPath : "bun",
    args: ["run", getExternalMcpEntryPath(cwd)],
  };
}

/** Claude Desktop / Claude Code `mcpServers` JSON for the external server. */
export function buildExternalClaudeConfigJson(cwd = process.cwd()): string {
  const { command, args } = buildExternalStdioDescriptor(cwd);
  return JSON.stringify(
    { mcpServers: { rexadb: { command, args } } },
    null,
    2,
  );
}

/** Cursor / generic MCP JSON (stdio entry). */
export function buildExternalCursorConfigJson(cwd = process.cwd()): string {
  const { command, args } = buildExternalStdioDescriptor(cwd);
  return JSON.stringify(
    { mcpServers: { rexadb: { command, args } } },
    null,
    2,
  );
}

/** Streamable-HTTP URL for the external server — it lives on the sidecar itself. */
export function externalMcpHttpUrl(apiBase: string): string {
  return `${String(apiBase || "http://127.0.0.1:3867").replace(/\/+$/, "")}/mcp`;
}
