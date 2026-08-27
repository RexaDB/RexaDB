export type AgentProviderId =
  | "rexadb"
  | "claude-code"
  | "opencode"
  | "codex"
  | "grok-build"
  | "cursor"
  | "fx"
  | "pi";

export interface AgentProvider {
  id: AgentProviderId;
  name: string;
  icon: string;
  available: boolean;
  status: "installed" | "not-installed" | "auth-required" | "error";
  description: string;
  binaryPath?: string;
  /** Live model list fetched from the provider's CLI (or static fallback) */
  models?: AgentModel[];
  /** Modes the provider actually offers (plan/build, permission, custom agents). */
  modes?: AgentMode[];
}

/**
 * A selectable agent mode — plan/build, permission/sandbox policy, or a
 * user-defined custom agent. `id` is the value passed to the CLI.
 */
export interface AgentMode {
  id: string;
  label: string;
  description?: string;
  /** CLI flag used to apply this mode (e.g. --agent, --permission-mode). */
  flag?: "agent" | "permission-mode" | "sandbox" | "fx" | "grok-permission";
  kind?: "primary" | "subagent" | "permission" | "sandbox";
  isDefault?: boolean;
  isCustom?: boolean;
}

export function defaultModeId(modes: AgentMode[] | undefined): string {
  if (!modes || modes.length === 0) return "";
  return modes.find((m) => m.isDefault)?.id ?? modes[0].id;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  provider: AgentProviderId;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentStreamEvent {
  type: "text_delta" | "assistant_delta" | "tool_start" | "tool_output" | "error" | "done" | "assistant_done";
  content?: string;
  message?: string;
  tool?: string;
  output?: string;
  /** Correlates a tool_output with its tool_start (t3code's stable tool-call identity). */
  toolCallId?: string;
  /** Parsed tool input arguments (object when the harness provided structured JSON). */
  input?: unknown;
  /** Prebuilt display label from the harness (e.g. ACP tool titles); overrides derived labels. */
  label?: string;
  /** tool_output: whether the tool result reports a failure. */
  isError?: boolean;
}

/** One agent activity entry — ported from t3code's WorkLogEntry, trimmed to what we consume. */
export type AgentWorkLogStatus = "inProgress" | "completed" | "failed";

export interface AgentWorkLogEntry {
  id: string;
  /** id of the assistant message (turn placeholder) this activity belongs to */
  turnId: string;
  toolCallId?: string;
  tool: string;
  /** Bold primary label (t3code's toolTitle, e.g. "Read", "Bash", "Glob") */
  title?: string;
  label: string;
  /** Muted secondary label (path / command / pattern) */
  detail?: string;
  command?: string;
  /** Raw tool payload (JSON of the input args) — expansion body fallback */
  raw?: string;
  status: AgentWorkLogStatus;
  createdAt: number;
}

export interface AgentChatRequest {
  provider: AgentProviderId;
  messages: Array<{ role: string; content: string }>;
  connectionId?: number;
  connectionString?: string;
  dbType?: string;
  schemaContext?: Array<{
    schema: string;
    table: string;
    columns: Array<{ name: string; type: string }>;
  }>;
}

/**
 * AgentModel — mirrors t3code's ServerProviderModel shape.
 * - isLegacy: true for older models still listed but no longer "current"
 * - isDefault: true for the provider's default model
 * - isCustom: true for user-added custom models
 * - shortName: abbreviated display name
 * - subProvider: origin provider for multi-provider agents
 */
export interface AgentModel {
  id: string;
  label: string;
  description?: string;
  isLegacy?: boolean;
  isDefault?: boolean;
  isCustom?: boolean;
  shortName?: string;
  subProvider?: string;
}

// ─── t3code's CURRENT_CLAUDE_MODELS ──────────────────────────────────────────
// Models NOT in this set are marked isLegacy.
const CURRENT_CLAUDE_MODELS = new Set([
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
]);

function isLegacyClaudeModel(slug: string): boolean {
  return !CURRENT_CLAUDE_MODELS.has(slug);
}

// ─── t3code's CURRENT_CODEX_MODELS ───────────────────────────────────────────
// Models NOT in this set are marked isLegacy.
const CURRENT_CODEX_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

function isLegacyCodexModel(slug: string): boolean {
  return !CURRENT_CODEX_MODELS.has(slug);
}

// ─── t3code's BUILT_IN_MODELS for Claude Code ────────────────────────────────
// Copied verbatim from t3code's server/dist/bin.mjs
const CLAUDE_BUILT_IN_MODELS: AgentModel[] = [
  { id: "claude-fable-5", label: "Claude Fable 5", isLegacy: false },
  { id: "claude-opus-5", label: "Claude Opus 5", isLegacy: false },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", isLegacy: true },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", isLegacy: true },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", isLegacy: true },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", isLegacy: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", isLegacy: false },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", isLegacy: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", isLegacy: true },
].map((m) => ({
  ...m,
  isLegacy: isLegacyClaudeModel(m.id) ? true : m.isLegacy,
}));

// ─── t3code's GROK_BUILT_IN_MODELS ───────────────────────────────────────────
const GROK_BUILT_IN_MODELS: AgentModel[] = [
  { id: "grok-build", label: "Grok Build", isCustom: false },
];

export const AGENT_PROVIDER_META: Record<
  AgentProviderId,
  {
    name: string;
    icon: string;
    description: string;
    binaries: string[];
    models: AgentModel[];
  }
> = {
  rexadb: {
    name: "RexaDB Agent",
    icon: "Bot",
    description: "Built-in AI agent with database tools",
    binaries: [],
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
  },
  "claude-code": {
    name: "Claude Code",
    icon: "Sparkles",
    description: "Anthropic's Claude Code CLI",
    binaries: ["claude"],
    models: CLAUDE_BUILT_IN_MODELS,
  },
  opencode: {
    name: "OpenCode",
    icon: "Terminal",
    description: "OpenCode CLI agent",
    binaries: ["opencode"],
    models: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "default", label: "Default", description: "Use OpenCode config" },
    ],
  },
  codex: {
    name: "Codex",
    icon: "Code",
    description: "OpenAI Codex CLI",
    binaries: ["codex"],
    // Static fallback — live list comes from app-server model/list.
    // Models marked isLegacy per t3code's CURRENT_CODEX_MODELS.
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", isDefault: true, isLegacy: false, description: "Balanced agentic coding model for everyday work" },
      { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", isLegacy: false, description: "Fast and affordable agentic coding model" },
      { id: "gpt-5.5", label: "GPT-5.5", isLegacy: true, description: "Frontier model for complex coding, research, and real-world work" },
      { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", isLegacy: true, description: "Small, fast, and cost-efficient model for simpler coding tasks" },
    ],
  },
  "grok-build": {
    name: "Grok Build",
    icon: "Zap",
    description: "xAI Grok Build CLI",
    binaries: ["grok"],
    models: GROK_BUILT_IN_MODELS,
  },
  cursor: {
    name: "Cursor",
    icon: "Box",
    description: "Cursor Agent CLI",
    binaries: ["cursor"],
    models: [
      { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "default", label: "Default", description: "Let Cursor decide" },
    ],
  },
  fx: {
    name: "fx",
    icon: "Zap",
    description: "fx CLI agent",
    binaries: ["fx"],
    models: [
      { id: "default", label: "Default", description: "Use fx config" },
    ],
  },
  pi: {
    name: "pi",
    icon: "Brain",
    description: "pi coding agent",
    binaries: ["pi"],
    models: [
      { id: "default", label: "Default", description: "Use pi config" },
    ],
  },
};
