import { spawnSync } from "child_process";
import type { AgentMode, AgentProviderId } from "./provider-types";
import { getAgentSandboxCwd } from "./sandbox-cwd";

function labelize(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function runCli(
  binaryPath: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
): string | null {
  try {
    const result = spawnSync(binaryPath, args, {
      encoding: "utf-8",
      timeout: opts?.timeout ?? 8000,
      cwd: opts?.cwd,
      env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", TERM: "dumb" },
    });
    const stdout = (result.stdout || "").trim();
    return stdout.length > 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

const OPENCODE_HIDDEN = new Set(["compaction", "summary", "title"]);
const OPENCODE_BUILTIN = new Set(["build", "plan"]);

function parseOpenCodeAgents(output: string): AgentMode[] {
  const modes: AgentMode[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\S+)\s+\((primary|subagent)\)\s*$/);
    if (!match) continue;
    const id = match[1];
    const kind = match[2] as "primary" | "subagent";
    if (kind !== "primary" || OPENCODE_HIDDEN.has(id) || seen.has(id)) continue;
    seen.add(id);
    modes.push({
      id,
      label: labelize(id),
      flag: "agent",
      kind: "primary",
      isDefault: id === "build",
      isCustom: !OPENCODE_BUILTIN.has(id),
    });
  }
  return modes;
}

const CLAUDE_MODES: AgentMode[] = [
  {
    id: "plan",
    label: "Plan",
    description: "Read-only; propose a plan before making changes",
    flag: "permission-mode",
    kind: "permission",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "Apply file edits without asking",
    flag: "permission-mode",
    kind: "permission",
    isDefault: true,
  },
  {
    id: "auto",
    label: "Auto",
    description: "Automatically approve allowed tool use",
    flag: "permission-mode",
    kind: "permission",
  },
  {
    id: "manual",
    label: "Manual",
    description: "Ask before each tool use",
    flag: "permission-mode",
    kind: "permission",
  },
  {
    id: "dontAsk",
    label: "Don't ask",
    description: "Skip permission prompts",
    flag: "permission-mode",
    kind: "permission",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    description: "Skip all permission checks",
    flag: "permission-mode",
    kind: "permission",
  },
];

const CODEX_MODES: AgentMode[] = [
  {
    id: "workspace-write",
    label: "Workspace write",
    description: "Write inside the workspace sandbox",
    flag: "sandbox",
    kind: "sandbox",
    isDefault: true,
  },
  {
    id: "read-only",
    label: "Read only",
    description: "Inspect only — no writes or shell side effects",
    flag: "sandbox",
    kind: "sandbox",
  },
  {
    id: "danger-full-access",
    label: "Full access",
    description: "No sandbox (dangerous)",
    flag: "sandbox",
    kind: "sandbox",
  },
];

const GROK_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Default",
    description: "Grok's default permission mode",
    flag: "grok-permission",
    kind: "permission",
    isDefault: true,
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only; propose a plan first",
    flag: "grok-permission",
    kind: "permission",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    flag: "grok-permission",
    kind: "permission",
  },
  {
    id: "auto",
    label: "Auto",
    flag: "grok-permission",
    kind: "permission",
  },
  {
    id: "dontAsk",
    label: "Don't ask",
    flag: "grok-permission",
    kind: "permission",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    flag: "grok-permission",
    kind: "permission",
  },
];

const FX_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Default",
    description: "Prompt for permissions when needed",
    flag: "fx",
    kind: "permission",
    isDefault: true,
  },
  {
    id: "auto",
    label: "Auto",
    description: "Automatically review unresolved permission requests",
    flag: "fx",
    kind: "permission",
  },
  {
    id: "yolo",
    label: "Yolo",
    description: "Disable permission checks and command sandboxing",
    flag: "fx",
    kind: "permission",
  },
];

const OPENCODE_FALLBACK: AgentMode[] = [
  {
    id: "build",
    label: "Build",
    description: "Full access — edit, run, and implement",
    flag: "agent",
    kind: "primary",
    isDefault: true,
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only analysis and planning",
    flag: "agent",
    kind: "primary",
  },
];

const FALLBACKS: Partial<Record<AgentProviderId, AgentMode[]>> = {
  opencode: OPENCODE_FALLBACK,
  "claude-code": CLAUDE_MODES,
  codex: CODEX_MODES,
  "grok-build": GROK_MODES,
  fx: FX_MODES,
};

/**
 * Modes the given provider actually offers. OpenCode is listed live
 * (built-in plan/build plus the user's custom primary agents). Other
 * CLIs use their documented mode flags.
 */
export async function listProviderModes(
  providerId: AgentProviderId,
  binaryPath?: string,
): Promise<AgentMode[]> {
  if (providerId === "opencode" && binaryPath) {
    const output = runCli(binaryPath, ["agent", "list"], {
      cwd: getAgentSandboxCwd(),
    });
    const live = output ? parseOpenCodeAgents(output) : [];
    if (live.length > 0) return live;
  }

  return FALLBACKS[providerId] ?? [];
}
