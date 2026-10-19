import { Effect } from "effect";
import {
  McpDisabledError,
  McpConfigError,
  McpRequestError,
} from "./mcp-errors";
import {
  loadMcpExternalConfig,
  saveMcpExternalConfig,
  sanitizeMcpExternalConfig,
  toMcpConfigSummary,
  listMcpModes,
  generateMcpAuthToken,
  type McpExternalConfig,
} from "../../lib/agents/mcp/external-config";
import { listAllConnectionDeps, toPublicConnectionList } from "../../lib/agents/mcp/registry";
import { listMcpAuditLog } from "../../lib/agents/mcp/audit-log";
import { ValidationError } from "./errors";

/** Load MCP config with Effect. */
export const loadMcpConfigEffect = Effect.tryPromise({
  try: () => loadMcpExternalConfig(),
  catch: (cause) =>
    new McpConfigError({
      message: cause instanceof Error ? cause.message : String(cause),
      status: 500,
    }),
});

/** Save MCP config with Effect. */
export const saveMcpConfigEffect = (config: McpExternalConfig) =>
  Effect.tryPromise({
    try: () => saveMcpExternalConfig(config),
    catch: (cause) =>
      new McpConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        status: 500,
      }),
  });

/** Load full MCP config summary (config + modes + connections + stdio info). */
export const getMcpConfigSummaryEffect = Effect.gen(function* () {
  const config = yield* loadMcpConfigEffect;
  const all = yield* Effect.tryPromise({
    try: () => listAllConnectionDeps(),
    catch: (cause) =>
      new McpConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        status: 500,
      }),
  });

  // Build stdio descriptor for harness spawning
  const stdio = yield* Effect.sync(() => {
    try {
      const path = require("node:path");
      const fs = require("node:fs");
      const entry = path.join(process.cwd(), "lib/agents/mcp/external-stdio.ts");
      const bunBin = process.execPath.includes("bun") ? process.execPath : "bun";
      return {
        command: bunBin,
        args: ["run", entry],
        env: { REXADB_USER_DATA_DIR: process.env.REXADB_USER_DATA_DIR || process.cwd() },
        available: fs.existsSync(entry),
      };
    } catch {
      return null;
    }
  });

  return {
    config: toMcpConfigSummary(config),
    modes: listMcpModes(config.customModes),
    connections: toPublicConnectionList(all, config.exposedConnectionIds),
    httpPath: "/mcp",
    stdio,
  };
});

/** Update MCP config (preserves token unless explicitly rotated). */
export const updateMcpConfigEffect = (updates: Partial<McpExternalConfig>) =>
  Effect.gen(function* () {
    const body = updates || {};
    const current = yield* loadMcpConfigEffect;
    const merged = sanitizeMcpExternalConfig({
      ...current,
      ...body,
      authToken: typeof body.authToken === "string" && body.authToken.length > 0
        ? body.authToken
        : current.authToken,
    });
    const saved = yield* saveMcpConfigEffect(merged);
    const hadToken = current.authToken.length > 0;
    const mintedToken = !hadToken && saved.authToken ? saved.authToken : undefined;
    return {
      config: toMcpConfigSummary(saved),
      modes: listMcpModes(saved.customModes),
      mintedToken,
    };
  });

/** Regenerate MCP auth token. */
export const regenerateMcpTokenEffect = Effect.gen(function* () {
  const current = yield* loadMcpConfigEffect;
  current.authToken = generateMcpAuthToken();
  const saved = yield* saveMcpConfigEffect(current);
  return { authToken: saved.authToken };
});

/** Get current MCP auth token (localhost only). */
export const getMcpTokenEffect = Effect.gen(function* () {
  const config = yield* loadMcpConfigEffect;
  if (!config.authToken) {
    return yield* Effect.fail(
      new ValidationError({
        message: "No token set yet. Enable the MCP server first.",
        status: 400,
      }),
    );
  }
  return { authToken: config.authToken };
});

/** List MCP audit log entries. */
export const listMcpAuditLogEffect = (params: {
  limit?: number;
  writesOnly?: boolean;
  tool?: string;
  connectionId?: number;
}) =>
  Effect.tryPromise({
    try: () => listMcpAuditLog(params),
    catch: (cause) =>
      new McpConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        status: 500,
      }),
  });

/** Create a custom MCP mode. */
export const createMcpModeEffect = (raw: any) =>
  Effect.gen(function* () {
    const config = yield* loadMcpConfigEffect;
    raw = raw || {};
    const body = raw || {};
    const id = `custom:${Date.now().toString(36)}`;
    const mode = {
      id,
      label: String(body.label || "Custom").slice(0, 80),
      kind: "custom" as const,
      description: typeof body.description === "string" ? body.description.slice(0, 500) : undefined,
      allowSqlRead: body.allowSqlRead !== false,
      allowSqlWrite: body.allowSqlWrite === true,
      promptRules: typeof body.promptRules === "string" ? body.promptRules.slice(0, 8000) : "",
    };
    config.customModes = [...(config.customModes || []), mode].slice(0, 50);
    const saved = yield* saveMcpConfigEffect(sanitizeMcpExternalConfig(config));
    return {
      mode,
      modes: listMcpModes(saved.customModes),
    };
  });

/** Update a custom MCP mode. */
export const updateMcpModeEffect = (id: string, updates: any) =>
  Effect.gen(function* () {
    const config = yield* loadMcpConfigEffect;
    updates = updates || {};
    const body = updates || {};
    config.customModes = (config.customModes || []).map((m: any) =>
      m.id === id
        ? {
            ...m,
            label: typeof body.label === "string" ? body.label.slice(0, 80) : m.label,
            description: typeof body.description === "string" ? body.description.slice(0, 500) : m.description,
            allowSqlRead: body.allowSqlRead !== undefined ? body.allowSqlRead !== false : m.allowSqlRead,
            allowSqlWrite: body.allowSqlWrite !== undefined ? body.allowSqlWrite === true : m.allowSqlWrite,
            promptRules: typeof body.promptRules === "string" ? body.promptRules.slice(0, 8000) : m.promptRules,
          }
        : m,
    );
    const saved = yield* saveMcpConfigEffect(sanitizeMcpExternalConfig(config));
    return { modes: listMcpModes(saved.customModes) };
  });

/** Delete a custom MCP mode. */
export const deleteMcpModeEffect = (id: string) =>
  Effect.gen(function* () {
    const { REXADB_PLAN_MODE } = yield* Effect.tryPromise({
      try: () => import("../../lib/agents/app-modes"),
      catch: (cause) =>
        new McpConfigError({
          message: cause instanceof Error ? cause.message : String(cause),
          status: 500,
        }),
    });
    const config = yield* loadMcpConfigEffect;
    config.customModes = (config.customModes || []).filter((m: any) => m.id !== id);
    if (config.modeId === id) config.modeId = REXADB_PLAN_MODE.id;
    const saved = yield* saveMcpConfigEffect(sanitizeMcpExternalConfig(config));
    return {
      modes: listMcpModes(saved.customModes),
      modeId: saved.modeId,
    };
  });
