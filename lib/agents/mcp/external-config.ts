/**
 * External (user-facing) MCP server config.
 *
 * Unlike the internal per-turn harness MCP (`stdio.ts`, driven entirely by
 * env vars), the external server is configured by the user in
 * Settings → MCP Server: enabled flag, transports, permission mode
 * (read-only / autopilot / custom), and the checklist of exposed connections.
 *
 * Persisted server-side (SQLite `mcp_server_config` single row, id=1) so both
 * the sidecar HTTP transport and headless stdio spawns can read it without a
 * browser. A JSON file fallback (`rexadb-mcp.json` under the user-data dir)
 * covers environments where the DB isn't reachable yet.
 */
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RexaAgentAppMode } from "../app-modes";
import { BUILTIN_APP_MODES, REXADB_PLAN_MODE } from "../app-modes";

export type McpTransportSelection = "stdio" | "http" | "both";

export type McpExternalConfig = {
  enabled: boolean;
  transports: McpTransportSelection;
  /** Bearer token for HTTP transport. Empty = auto-generated on first enable. */
  authToken: string;
  /** Selected permission mode id: rexadb-plan | rexadb-build | custom:* */
  modeId: string;
  /** Saved connection ids exposed over MCP (opt-in allow-list). */
  exposedConnectionIds: number[];
  /** User-defined permission modes (same shape as agent app modes). */
  customModes: RexaAgentAppMode[];
};

export const MCP_CONFIG_FILE_NAME = "rexadb-mcp.json";

export function defaultMcpExternalConfig(): McpExternalConfig {
  return {
    enabled: false,
    transports: "both",
    authToken: "",
    modeId: REXADB_PLAN_MODE.id,
    exposedConnectionIds: [],
    customModes: [],
  };
}

export function listMcpModes(customModes: RexaAgentAppMode[]): RexaAgentAppMode[] {
  return [...BUILTIN_APP_MODES, ...(Array.isArray(customModes) ? customModes : [])];
}

export function resolveMcpMode(
  config: Pick<McpExternalConfig, "modeId" | "customModes">,
): RexaAgentAppMode {
  const all = listMcpModes(config.customModes);
  return all.find((m) => m.id === config.modeId) || REXADB_PLAN_MODE;
}

export function generateMcpAuthToken(): string {
  return `rexadb-mcp_${randomBytes(24).toString("hex")}`;
}

function sanitizeMode(raw: any): RexaAgentAppMode | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const kind = raw.kind === "build" ? "build" : raw.kind === "plan" ? "plan" : "custom";
  return {
    id: String(raw.id).slice(0, 80),
    label: String(raw.label).slice(0, 80),
    kind,
    description: typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined,
    allowSqlRead: raw.allowSqlRead !== false,
    allowSqlWrite: raw.allowSqlWrite === true,
    promptRules: typeof raw.promptRules === "string" ? raw.promptRules.slice(0, 8000) : "",
  };
}

/** Validate + normalize untrusted input (API body, file, DB row). */
export function sanitizeMcpExternalConfig(raw: any): McpExternalConfig {
  const base = defaultMcpExternalConfig();
  if (!raw || typeof raw !== "object") return base;
  const transports: McpTransportSelection =
    raw.transports === "stdio" || raw.transports === "http" || raw.transports === "both"
      ? raw.transports
      : base.transports;
  const exposedConnectionIds: number[] = Array.isArray(raw.exposedConnectionIds)
    ? [...new Set<number>(raw.exposedConnectionIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 500)
    : [];
  const customModes: RexaAgentAppMode[] = Array.isArray(raw.customModes)
    ? raw.customModes.map(sanitizeMode).filter((m: RexaAgentAppMode | null): m is RexaAgentAppMode => m !== null).slice(0, 50)
    : [];
  const modeId = typeof raw.modeId === "string" && raw.modeId.length > 0 && raw.modeId.length <= 80
    ? raw.modeId
    : base.modeId;
  return {
    enabled: raw.enabled === true,
    transports,
    authToken: typeof raw.authToken === "string" ? raw.authToken.slice(0, 200) : "",
    modeId,
    exposedConnectionIds,
    customModes,
  };
}

/** Public shape for the Settings UI — token presence only, never the secret itself. */
export function toMcpConfigSummary(config: McpExternalConfig): Omit<McpExternalConfig, "authToken"> & { hasAuthToken: boolean } {
  const { authToken, ...rest } = config;
  return { ...rest, hasAuthToken: authToken.length > 0 };
}

/** Mask a connection string for display (never leak passwords/tokens). */
export function maskConnectionString(connectionString: string): string {
  const raw = String(connectionString || "");
  if (!raw) return "";
  // workspace:/dev:/memory pointers carry no secret
  if (/^(workspace|dev|memory|sqlite):/i.test(raw) || raw === ":memory:") return raw.slice(0, 80);
  try {
    if (raw.includes("://")) {
      const url = new URL(raw.includes("://") ? raw : `db://${raw}`);
      if (url.password) url.password = "***";
      // redis/mysql query params may carry tokens
      for (const key of ["token", "auth_token", "password", "key"]) {
        if (url.searchParams.has(key)) url.searchParams.set(key, "***");
      }
      return url.toString().slice(0, 120);
    }
  } catch {
    // fall through to generic redaction
  }
  return raw.replace(/(password|passwd|pwd|token|secret|key)=([^;&\s]+)/gi, "$1=***").slice(0, 120);
}

export function getMcpConfigFilePath(userDataDir?: string): string {
  const dir =
    userDataDir ||
    process.env.REXADB_USER_DATA_DIR ||
    process.cwd();
  return join(dir, MCP_CONFIG_FILE_NAME);
}

async function readConfigFromDb(): Promise<any | null> {
  try {
    const { db } = await import("@/lib/db/index");
    const { mcpServerConfig } = await import("@/lib/db/schema");
    const { ensureCoreTables } = await import("@/lib/db/ensure-core-tables");
    await ensureCoreTables();
    const rows = await db.select().from(mcpServerConfig).limit(1);
    if (!rows[0]?.configJson) return null;
    return JSON.parse(rows[0].configJson);
  } catch {
    return null;
  }
}

async function readConfigFromFile(): Promise<any | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const path = process.env.REXADB_MCP_CONFIG_PATH || getMcpConfigFilePath();
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function loadMcpExternalConfig(): Promise<McpExternalConfig> {
  // Env overrides win for headless/CI use.
  const fromDb = await readConfigFromDb();
  const fromFile = fromDb ?? (await readConfigFromFile());
  const config = sanitizeMcpExternalConfig(fromFile);
  if (process.env.REXADB_MCP_MODE) config.modeId = process.env.REXADB_MCP_MODE;
  if (process.env.REXADB_MCP_EXPOSED_IDS) {
    const ids = String(process.env.REXADB_MCP_EXPOSED_IDS)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    config.exposedConnectionIds = [...new Set(ids)];
  }
  if (process.env.REXADB_MCP_DISABLED === "1") config.enabled = false;
  return config;
}

export async function saveMcpExternalConfig(config: McpExternalConfig): Promise<McpExternalConfig> {
  const clean = sanitizeMcpExternalConfig(config);
  // Auto-mint a token on first enable so HTTP has auth from the start.
  if (clean.enabled && !clean.authToken) clean.authToken = generateMcpAuthToken();
  const payload = JSON.stringify(clean);
  try {
    const { db } = await import("@/lib/db/index");
    const { mcpServerConfig } = await import("@/lib/db/schema");
    const { ensureCoreTables } = await import("@/lib/db/ensure-core-tables");
    await ensureCoreTables();
    await db
      .insert(mcpServerConfig)
      .values({ id: 1, configJson: payload, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: mcpServerConfig.id, set: { configJson: payload, updatedAt: Date.now() } });
  } catch (error) {
    // DB unavailable (e.g. browser bundle) — fall back to file.
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      const path = process.env.REXADB_MCP_CONFIG_PATH || getMcpConfigFilePath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, payload, "utf8");
    } catch {
      throw error;
    }
  }
  // Best-effort mirror to file so headless stdio spawns always find it.
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = process.env.REXADB_MCP_CONFIG_PATH || getMcpConfigFilePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, payload, "utf8");
  } catch {
    // non-fatal
  }
  return clean;
}
