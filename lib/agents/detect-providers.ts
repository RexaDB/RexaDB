import { execFileSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { AgentProvider, AgentProviderId } from "./provider-types";
import { AGENT_PROVIDER_META } from "./provider-types";
import { localCliPath } from "./cli-path";

function whichBinary(name: string): string | null {
  try {
    const result = execFileSync(process.platform === "win32" ? "where.exe" : "which", [name], {
      env: { ...process.env, PATH: localCliPath() },
      encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0];
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function checkClaudeAuth(binaryPath: string): "installed" | "auth-required" {
  try {
    const result = execFileSync(binaryPath, ["auth", "status"], {
      env: { ...process.env, PATH: localCliPath() },
      encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    if (JSON.parse(result).loggedIn === true) return "installed";
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

function checkCodexAuth(binaryPath: string): "installed" | "auth-required" {
  try {
    // Codex writes login status to stderr, so capture both without a shell.
    const { stdout, stderr, status } = spawnSync(binaryPath, ["login", "status"], {
      env: { ...process.env, PATH: localCliPath() },
      encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    if (status === 0 && /logged in/i.test(`${stdout}\n${stderr}`)) return "installed";
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

function checkOpenCodeAuth(binaryPath: string): "installed" | "auth-required" {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // OpenCode stores auth in ~/.local/share/opencode/auth.json
    const authPath = join(homeDir, ".local", "share", "opencode", "auth.json");
    if (existsSync(authPath)) {
      return "installed";
    }
    // Fallback: check config directory
    const configPath = join(homeDir, ".config", "opencode", "config.json");
    if (existsSync(configPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

function checkGrokAuth(binaryPath: string): "installed" | "auth-required" {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // Grok stores auth in ~/.grok/auth.json
    const authPath = join(homeDir, ".grok", "auth.json");
    if (existsSync(authPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

function checkCursorAuth(): "installed" | "auth-required" {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // Check multiple possible Cursor locations
    const cursorDir = join(homeDir, ".cursor");
    if (existsSync(cursorDir)) {
      return "installed";
    }
    // macOS app support
    const macPath = join(homeDir, "Library", "Application Support", "Cursor");
    if (existsSync(macPath)) {
      return "installed";
    }
    return "auth-required";
  } catch {
    return "auth-required";
  }
}

function checkPiAuth(binaryPath: string): "installed" | "auth-required" {
  try {
    const output = execFileSync(binaryPath, ["--list-models"], {
      env: { ...process.env, PATH: localCliPath() },
      encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    return /no models available/i.test(output) ? "auth-required" : "installed";
  } catch {
    return "auth-required";
  }
}

const AUTH_CHECKERS: Partial<
  Record<AgentProviderId, (binaryPath: string) => "installed" | "auth-required">
> = {
  "claude-code": checkClaudeAuth,
  codex: checkCodexAuth,
  opencode: checkOpenCodeAuth,
  "grok-build": checkGrokAuth,
  cursor: () => checkCursorAuth(),
  pi: checkPiAuth,
};

export async function detectProviders(): Promise<AgentProvider[]> {
  const providers: AgentProvider[] = [];

  // Always available
  providers.push({
    id: "rexadb",
    name: AGENT_PROVIDER_META.rexadb.name,
    icon: AGENT_PROVIDER_META.rexadb.icon,
    available: true,
    status: "installed",
    description: AGENT_PROVIDER_META.rexadb.description,
  });

  const externalProviders: AgentProviderId[] = [
    "claude-code",
    "opencode",
    "codex",
    "grok-build",
    "cursor",
    "fx",
    "pi",
  ];

  for (const providerId of externalProviders) {
    const meta = AGENT_PROVIDER_META[providerId];
    let found = false;
    let binaryPath: string | undefined;
    let status: AgentProvider["status"] = "not-installed";

    for (const binary of meta.binaries) {
      const path = whichBinary(binary);
      if (path) {
        found = true;
        binaryPath = path;
        break;
      }
    }

    if (found && binaryPath) {
      const authChecker = AUTH_CHECKERS[providerId];
      status = authChecker ? authChecker(binaryPath) : "installed";
    }

    providers.push({
      id: providerId,
      name: meta.name,
      icon: meta.icon,
      available: found,
      status,
      description: meta.description,
      binaryPath,
    });
  }

  return providers;
}
