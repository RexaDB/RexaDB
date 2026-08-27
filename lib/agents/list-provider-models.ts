import { spawn } from "child_process";
import { execSync } from "child_process";
import type { AgentModel, AgentProviderId } from "./provider-types";
import { AGENT_PROVIDER_META } from "./provider-types";

/**
 * Run a CLI command and return stdout, or null on failure.
 */
function runCli(binaryPath: string, args: string[], timeout = 8000): string | null {
  try {
    const result = execSync(`${binaryPath} ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", TERM: "dumb" },
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Turn a model slug like "claude-sonnet-5" or "gpt-5.6-terra" into a
 * human-readable label.
 */
function labelize(slug: string): string {
  const name = slug.includes("/") ? slug.split("/").pop()! : slug;
  return name
    .replace(/[-:]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── OpenCode ──────────────────────────────────────────────────────────────
// `opencode models` prints one model per line as "provider/model-slug".
function parseOpenCodeModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("}")) continue;
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex > 0) {
      models.push({
        id: trimmed,
        label: labelize(trimmed),
        subProvider: trimmed.slice(0, slashIndex),
      });
    }
  }
  return models;
}

// ─── Grok ──────────────────────────────────────────────────────────────────
// `grok models` prints lines like "* grok-4.6 (default)".
function parseGrokModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\*?\s*(\S+)(?:\s*\(default\))?/);
    if (
      match &&
      match[1] &&
      !match[1].startsWith("You") &&
      !match[1].startsWith("Default") &&
      !match[1].startsWith("Available")
    ) {
      models.push({ id: match[1], label: labelize(match[1]) });
    }
  }
  return models;
}

// ─── fx ─────────────────────────────────────────────────────────────────────
// `fx models` prints a "[models] N available" header then "- provider/model".
function parseFxModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      const slug = trimmed.slice(2).trim();
      const slashIndex = slug.indexOf("/");
      models.push({
        id: slug,
        label: labelize(slug),
        ...(slashIndex > 0 ? { subProvider: slug.slice(0, slashIndex) } : {}),
      });
    }
  }
  return models;
}

// ─── pi ──────────────────────────────────────────────────────────────────────
// `pi --list-models` prints a TSV table:
//   provider  model  context  max-out  thinking  images
// Duplicate slugs across providers are collapsed.
function parsePiModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("provider")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const slug = parts[1];
      models.push({ id: slug, label: labelize(slug), subProvider: parts[0] });
    }
  }
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// ─── Codex (app-server JSON-RPC) ────────────────────────────────────────────
// Copied from t3code's server: spawn `codex app-server`, send JSON-RPC
// `initialize` then `model/list` (with cursor pagination), mark legacy models.
interface CodexModelEntry {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
}

// t3code's CURRENT_CODEX_MODELS — models NOT in this set are isLegacy.
const CURRENT_CODEX_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

function isLegacyCodexModel(slug: string): boolean {
  return !CURRENT_CODEX_MODELS.has(slug);
}

// t3code's toDisplayName
function codexDisplayName(model: CodexModelEntry): string {
  return model.displayName
    .replace(/^gpt/i, "GPT")
    .replace(/-([a-z])/g, (_, c) => "-" + c.toUpperCase());
}

async function listCodexModels(binaryPath: string): Promise<AgentModel[] | null> {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    let requestId = 1;
    const allModels: AgentModel[] = [];

    const proc = spawn(binaryPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });

    const timeout = setTimeout(() => finish(null), 8000);

    function finish(result: AgentModel[] | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.kill("SIGTERM");
      resolve(result);
    }

    function requestModelList(cursor?: string) {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "model/list",
          params,
        }) + "\n",
      );
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: any;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        // After initialize, request first page of model/list
        if (msg.id === 1 && msg.result) {
          requestId = 2;
          requestModelList();
        }
        // model/list response — paginate like t3code's requestAllCodexModels
        if (msg.id >= 2 && msg.result?.data) {
          const entries = msg.result.data as CodexModelEntry[];
          for (const m of entries) {
            const model: AgentModel = {
              id: m.model || m.id,
              label: codexDisplayName(m),
              description: m.description || undefined,
              isCustom: false,
              ...(m.isDefault ? { isDefault: true } : {}),
              ...(isLegacyCodexModel(m.model || m.id) ? { isLegacy: true } : {}),
            };
            allModels.push(model);
          }
          // Check for pagination cursor (t3code's requestAllCodexModels loops)
          const nextCursor = msg.result.nextCursor;
          if (nextCursor) {
            requestId++;
            requestModelList(nextCursor);
          } else {
            // Filter out hidden models (codex-auto-review etc.)
            const visible: AgentModel[] = [];
            const seen = new Set<string>();
            for (const m of allModels) {
              const entry = entries.find((e) => (e.model || e.id) === m.id);
              if (entry?.hidden) continue;
              if (seen.has(m.id)) continue;
              seen.add(m.id);
              visible.push(m);
            }
            finish(visible.length > 0 ? visible : allModels);
          }
        }
      }
    });

    proc.on("error", () => finish(null));
    proc.on("close", () => finish(null));

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-01",
          capabilities: {},
          clientInfo: { name: "rexadb", version: "0.0.0" },
        },
      }) + "\n",
    );
  });
}

// ─── Provider dispatch ─────────────────────────────────────────────────────

const SYNC_LISTERS: Partial<
  Record<AgentProviderId, (binaryPath: string) => AgentModel[] | null>
> = {
  opencode: (binaryPath) => {
    const output = runCli(binaryPath, ["models"]);
    return output ? parseOpenCodeModels(output) : null;
  },
  "grok-build": (binaryPath) => {
    const output = runCli(binaryPath, ["models"]);
    return output ? parseGrokModels(output) : null;
  },
  fx: (binaryPath) => {
    const output = runCli(binaryPath, ["models"]);
    return output ? parseFxModels(output) : null;
  },
  pi: (binaryPath) => {
    const output = runCli(binaryPath, ["--list-models"]);
    return output ? parsePiModels(output) : null;
  },
};

/**
 * Fetch the live model list from a provider's CLI binary.
 * Returns the static fallback from AGENT_PROVIDER_META if the CLI
 * doesn't support listing models or the binary isn't available.
 */
export async function listProviderModels(
  providerId: AgentProviderId,
  binaryPath?: string,
): Promise<AgentModel[]> {
  // RexaDB has its own static model list (no CLI to query)
  if (providerId === "rexadb") {
    return AGENT_PROVIDER_META.rexadb.models;
  }

  // Claude Code has no non-interactive model listing command — use static list
  if (providerId === "claude-code") {
    return AGENT_PROVIDER_META["claude-code"].models;
  }

  // Codex: query app-server JSON-RPC for the real model list
  if (providerId === "codex" && binaryPath) {
    const models = await listCodexModels(binaryPath);
    if (models && models.length > 0) return models;
    return AGENT_PROVIDER_META.codex.models;
  }

  // Sync CLI listers (opencode, grok, fx, pi)
  if (binaryPath) {
    const lister = SYNC_LISTERS[providerId];
    if (lister) {
      const models = lister(binaryPath);
      if (models && models.length > 0) return models;
    }
  }

  return AGENT_PROVIDER_META[providerId].models;
}
