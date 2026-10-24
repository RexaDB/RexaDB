import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { join } from "path";
import type { AgentProvider, AgentProviderId } from "./provider-types";
import { AGENT_PROVIDER_META } from "./provider-types";
import { localCliPath } from "./cli-path";

const execFileAsync = promisify(execFile);
type ProviderStatus = "installed" | "auth-required";

async function runProbe(binaryPath: string, args: string[], signal?: AbortSignal, timeout = 5000) {
  return execFileAsync(binaryPath, args, {
    env: { ...process.env, PATH: localCliPath() },
    encoding: "utf8", timeout, signal, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
  });
}

async function exists(path: string, mode = constants.F_OK): Promise<boolean> {
  try { await access(path, mode); return true; } catch { return false; }
}

async function whichBinary(name: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const { stdout } = await runProbe(process.platform === "win32" ? "where.exe" : "which", [name], signal, 3000);
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

async function checkClaudeAuth(binaryPath: string, signal?: AbortSignal): Promise<ProviderStatus> {
  const { stdout } = await runProbe(binaryPath, ["auth", "status"], signal);
  return JSON.parse(stdout).loggedIn === true ? "installed" : "auth-required";
}

async function checkCodexAuth(binaryPath: string, signal?: AbortSignal): Promise<ProviderStatus> {
  // Codex writes login status to stderr. A nonzero exit rejects the probe.
  const { stdout, stderr } = await runProbe(binaryPath, ["login", "status"], signal);
  return /logged in/i.test(`${stdout}\n${stderr}`) ? "installed" : "auth-required";
}

async function checkOpenCodeAuth(): Promise<ProviderStatus> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // OpenCode stores auth in ~/.local/share/opencode/auth.json
    const authPath = join(homeDir, ".local", "share", "opencode", "auth.json");
    if (await exists(authPath)) {
      return "installed";
    }
    // Fallback: check config directory
    const configPath = join(homeDir, ".config", "opencode", "config.json");
    if (await exists(configPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

async function checkGrokAuth(): Promise<ProviderStatus> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // Grok stores auth in ~/.grok/auth.json
    const authPath = join(homeDir, ".grok", "auth.json");
    if (await exists(authPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

async function checkCursorAuth(): Promise<ProviderStatus> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // Check multiple possible Cursor locations
    const cursorDir = join(homeDir, ".cursor");
    if (await exists(cursorDir)) {
      return "installed";
    }
    // macOS app support
    const macPath = join(homeDir, "Library", "Application Support", "Cursor");
    if (await exists(macPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

async function checkPiAuth(binaryPath: string, signal?: AbortSignal): Promise<ProviderStatus> {
  const { stdout } = await runProbe(binaryPath, ["--list-models"], signal);
  return /no models available/i.test(stdout) ? "auth-required" : "installed";
}

const AUTH_CHECKERS: Partial<
  Record<AgentProviderId, (binaryPath: string, signal?: AbortSignal) => Promise<ProviderStatus>>
> = {
  "claude-code": checkClaudeAuth,
  codex: checkCodexAuth,
  opencode: checkOpenCodeAuth,
  "grok-build": checkGrokAuth,
  cursor: checkCursorAuth,
  pi: checkPiAuth,
};

/** Reuse a discovered path, but recheck only this provider's current login.
 * Missing/stale cache entries fall back to an asynchronous lookup of this CLI.
 */
export async function detectProvider(
  providerId: AgentProviderId,
  options: { cached?: AgentProvider; signal?: AbortSignal } = {},
): Promise<AgentProvider> {
  const { signal, cached } = options;
  signal?.throwIfAborted();
  const meta = AGENT_PROVIDER_META[providerId];
  let binaryPath: string | undefined;
  let status: AgentProvider["status"] = providerId === "rexadb" ? "installed" : "not-installed";
  if (cached?.id === providerId && cached.binaryPath &&
      await exists(cached.binaryPath, process.platform === "win32" ? constants.F_OK : constants.X_OK)) {
    binaryPath = cached.binaryPath;
  }
  if (!binaryPath) {
    for (const binary of meta.binaries) {
      signal?.throwIfAborted();
      binaryPath = await whichBinary(binary, signal) || undefined;
      if (binaryPath) break;
    }
  }
  if (binaryPath) {
    try {
      const check = AUTH_CHECKERS[providerId];
      status = check ? await check(binaryPath, signal) : "installed";
    } catch {
      signal?.throwIfAborted();
      status = "auth-required";
    }
  }
  signal?.throwIfAborted();
  return {
    id: providerId, name: meta.name, icon: meta.icon, description: meta.description,
    available: providerId === "rexadb" || !!binaryPath, status, binaryPath,
  };
}

export async function detectProviders(): Promise<AgentProvider[]> {
  const ids: AgentProviderId[] = ["rexadb", "claude-code", "opencode", "codex", "grok-build", "cursor", "fx", "pi"];
  return Promise.all(ids.map((id) => detectProvider(id)));
}
