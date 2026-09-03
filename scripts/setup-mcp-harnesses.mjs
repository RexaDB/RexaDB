/**
 * Configure ALL popular MCP harnesses for the RexaDB external MCP server.
 *
 * Usage:
 *   bun run scripts/setup-mcp-harnesses.mjs [--data-dir <dir>] [--dry-run] [--only <a,b,c>]
 *
 * Covers (stdio everywhere + HTTP where the harness supports it):
 *   claude (CLI), codex (CLI), opencode (~/.config/opencode/opencode.jsonc),
 *   gemini (~/.gemini/settings.json), cursor (~/.cursor/mcp.json),
 *   windsurf (~/.codeium/windsurf/mcp_config.json), zed (~/.config/zed/settings.json),
 *   vscode-user (Code/User/mcp.json, `servers` key), cline + roo (VS Code globalStorage).
 *
 * The stdio entries pin REXADB_USER_DATA_DIR so harness spawns open the SAME
 * database the sidecar uses no matter what cwd they launch from. The HTTP
 * entries target the sidecar's discovered port (port.json in the data dir).
 * Existing files are backed up once (<file>.rexadb-bak) and all other
 * settings/servers are preserved.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
const DRY_RUN = args.includes("--dry-run");
const ONLY = (flag("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DATA_DIR =
  flag("--data-dir") ||
  process.env.REXADB_USER_DATA_DIR ||
  join(HOME, "Library/Application Support/com.rexadb");

const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun";
const ENTRY = join(ROOT, "lib/agents/mcp/external-stdio.ts");
const SERVER_NAME = "rexadb";
const SERVER_HTTP_NAME = "rexadb-http";

const report = [];
function log(ok, label, detail = "") {
  report.push({ ok, label, detail });
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ─── discovery: token + sidecar port ─────────────────────────────────────────

function readPort() {
  try {
    const raw = readFileSync(join(DATA_DIR, "port.json"), "utf8");
    const port = Number(JSON.parse(raw)?.port);
    if (Number.isInteger(port) && port > 0) return port;
  } catch {}
  return null;
}

async function fetchToken(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp/config/token`);
    const body = await res.json().catch(() => null);
    if (body?.success && body.data?.authToken) return body.data.authToken;
  } catch {}
  return null;
}

async function readTokenFromSqlite() {
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(DATA_DIR, "sqlite.db"), { readonly: true });
    const row = db.query("SELECT config_json FROM mcp_server_config LIMIT 1").get();
    db.close();
    if (!row?.config_json) return null;
    return JSON.parse(row.config_json)?.authToken || null;
  } catch {
    return null;
  }
}

async function discover() {
  const ports = [readPort(), 3867, 3868, 3869].filter((p, i, a) => p && a.indexOf(p) === i);
  for (const port of ports) {
    const token = await fetchToken(port);
    if (token) return { port, token };
  }
  const token = await readTokenFromSqlite();
  if (token) {
    const port = readPort() || 3867;
    return { port, token };
  }
  throw new Error(
    `Could not discover the MCP token. Start the sidecar (tauri:dev) and enable Settings → MCP Server first. (data dir: ${DATA_DIR})`,
  );
}

// ─── json helpers (comment-preserving enough for jsonc) ──────────────────────

function stripJsonComments(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += next || "";
        i += 2;
        continue;
      }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return { data: fallback, isNew: true };
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return { data: fallback, isNew: false };
  try {
    return { data: JSON.parse(raw), isNew: false };
  } catch {
    // Lenient fallback for JSONC (comments, trailing commas).
    const cleaned = stripJsonComments(raw).replace(/,(\s*[}\]])/g, "$1");
    return { data: JSON.parse(cleaned), isNew: false };
  }
}

function backupOnce(path) {
  const bak = `${path}.rexadb-bak`;
  if (existsSync(path) && !existsSync(bak) && !DRY_RUN) copyFileSync(path, bak);
}

function writeJsonMerge(path, mutate, { topKeys = [] } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const { data, isNew } = readJson(path, {});
  const before = JSON.stringify(data);
  mutate(data);
  for (const k of topKeys) if (data[k] === undefined) data[k] = {};
  if (JSON.stringify(data) === before) {
    log(true, `${path}`, isNew ? "created (no changes needed?)" : "already up to date");
    return data;
  }
  backupOnce(path);
  if (!DRY_RUN) writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  log(true, `${path}`, isNew ? "created" : "updated (backup at .rexadb-bak)");
  return data;
}

// ─── descriptors ─────────────────────────────────────────────────────────────

function stdioEntry() {
  return {
    command: BUN_BIN,
    args: ["run", ENTRY],
    env: { REXADB_USER_DATA_DIR: DATA_DIR },
  };
}

// ─── harness writers ─────────────────────────────────────────────────────────

function runCmd(cmd, argv) {
  if (DRY_RUN) {
    console.log(`  [dry] ${cmd} ${argv.join(" ")}`);
    return "";
  }
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 300));
  return (r.stdout || "").trim();
}

const writers = {
  claude() {
    // Already handled via `claude mcp add`; refresh here for idempotency.
    try { runCmd("claude", ["mcp", "remove", SERVER_NAME]); } catch {}
    runCmd("claude", [
      "mcp", "add", "--transport", "stdio", SERVER_NAME,
      "--env", `REXADB_USER_DATA_DIR=${DATA_DIR}`,
      "--", BUN_BIN, "run", ENTRY,
    ]);
    log(true, "claude: rexadb (stdio)");
  },

  codex() {
    try { runCmd("codex", ["mcp", "remove", SERVER_NAME]); } catch {}
    runCmd("codex", [
      "mcp", "add", SERVER_NAME,
      "--env", `REXADB_USER_DATA_DIR=${DATA_DIR}`,
      "--", BUN_BIN, "run", ENTRY,
    ]);
    log(true, "codex: rexadb (stdio)");
  },

  opencode(httpUrl, token) {
    const path = join(HOME, ".config/opencode/opencode.jsonc");
    writeJsonMerge(path, (data) => {
      data.mcp = data.mcp || {};
      data.mcp[SERVER_NAME] = {
        type: "local",
        command: [BUN_BIN, "run", ENTRY],
        environment: { REXADB_USER_DATA_DIR: DATA_DIR },
        enabled: true,
      };
      data.mcp[SERVER_HTTP_NAME] = {
        type: "remote",
        url: httpUrl,
        headers: { Authorization: `Bearer ${token}` },
        enabled: true,
      };
    });
  },

  gemini(httpUrl, token) {
    const path = join(HOME, ".gemini/settings.json");
    writeJsonMerge(path, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[SERVER_NAME] = { ...stdioEntry(), timeout: 30000 };
      data.mcpServers[SERVER_HTTP_NAME] = {
        httpUrl,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      };
    });
  },

  cursor(httpUrl, token) {
    const path = join(HOME, ".cursor/mcp.json");
    writeJsonMerge(path, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[SERVER_NAME] = stdioEntry();
      data.mcpServers[SERVER_HTTP_NAME] = {
        url: httpUrl,
        headers: { Authorization: `Bearer ${token}` },
      };
    });
  },

  windsurf(httpUrl, token) {
    const path = join(HOME, ".codeium/windsurf/mcp_config.json");
    writeJsonMerge(path, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[SERVER_NAME] = stdioEntry();
      data.mcpServers[SERVER_HTTP_NAME] = {
        serverUrl: httpUrl,
        headers: { Authorization: `Bearer ${token}` },
      };
    });
  },

  zed(httpUrl, token) {
    const path = join(HOME, ".config/zed/settings.json");
    writeJsonMerge(path, (data) => {
      data.context_servers = data.context_servers || {};
      data.context_servers[SERVER_NAME] = stdioEntry();
      data.context_servers[SERVER_HTTP_NAME] = {
        url: httpUrl,
        headers: { Authorization: `Bearer ${token}` },
      };
    });
  },

  vscode(httpUrl, token) {
    // VS Code user config (Copilot + any MCP-capable setup). Top-level `servers`.
    const path = join(HOME, "Library/Application Support/Code/User/mcp.json");
    writeJsonMerge(path, (data) => {
      data.servers = data.servers || {};
      data.servers[SERVER_NAME] = { type: "stdio", ...stdioEntry() };
      data.servers[SERVER_HTTP_NAME] = {
        type: "http",
        url: httpUrl,
        headers: { Authorization: `Bearer ${token}` },
      };
    });
  },

  cline() {
    const path = join(
      HOME, "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    );
    writeJsonMerge(path, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[SERVER_NAME] = stdioEntry();
    });
  },

  roo() {
    const path = join(
      HOME, "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json",
    );
    writeJsonMerge(path, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers[SERVER_NAME] = stdioEntry();
    });
  },
};

const ORDER = ["claude", "codex", "opencode", "gemini", "cursor", "windsurf", "zed", "vscode", "cline", "roo"];

async function main() {
  if (!existsSync(ENTRY)) throw new Error(`MCP entry not found: ${ENTRY}`);
  const selected = ONLY.length ? ORDER.filter((k) => ONLY.includes(k)) : ORDER;
  console.log(`[mcp-harnesses] data dir: ${DATA_DIR}${DRY_RUN ? " (dry run)" : ""}`);
  const { port, token } = await discover();
  const httpUrl = `http://127.0.0.1:${port}/mcp`;
  console.log(`[mcp-harnesses] sidecar port ${port}, token ****${token.slice(-4)}`);
  for (const key of selected) {
    if (!writers[key]) {
      log(false, key, "unknown harness (skipped)");
      continue;
    }
    try {
      if (["claude", "codex"].includes(key)) writers[key]();
      else writers[key](httpUrl, token);
    } catch (e) {
      log(false, key, String(e?.message || e).slice(0, 200));
    }
  }
  const failed = report.filter((r) => !r.ok);
  console.log(`\n[mcp-harnesses] ${report.length - failed.length}/${report.length} ok.`);
  console.log("Restart GUI harnesses (Cursor/Windsurf/Zed/VS Code) to pick up new MCP servers.");
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`[mcp-harnesses] fatal: ${e?.message || e}`);
  process.exit(1);
});
