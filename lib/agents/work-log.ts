import type { AgentWorkLogEntry } from "./provider-types";

/** Verbatim port of t3code session-logic.ts formatDuration. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    // 9.95s+ rounds up to the next bucket — render "10s", not "10.0s".
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

// Ported from t3code MessagesTimeline.logic.ts (toolGroupAction / toolGroupActionLabel)
// and MessagesTimeline.tsx (workEntryIconName / liveWorkEntryLabel), adapted to
// provider-neutral tool names.

export type WorkEntryIconName =
  | "bot"
  | "eye"
  | "globe"
  | "hammer"
  | "search"
  | "square-pen"
  | "terminal"
  | "wrench"
  | "x";

export type ToolGroupAction = "read" | "edit" | "command" | "search" | "other";

const READ_TOOLS = new Set([
  "read",
  "readfile",
  "view",
  "cat",
  "get_cell",
  "notebookread",
]);
const EDIT_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "save_file",
  "create_file",
  "str_replace_editor",
  "apply_patch",
  "notebookedit",
]);
const COMMAND_TOOLS = new Set(["bash", "shell", "terminal", "exec", "run_command", "command"]);
// Web/search-specific tools get globe/search icons; generic lookups (glob,
// find, ls) are dynamic tools → hammer (matches t3code's current rendering).
const WEB_SEARCH_TOOLS = new Set(["webfetch", "websearch"]);
const CODE_SEARCH_TOOLS = new Set(["grep", "codesearch"]);

function normalizeToolName(tool: string): string {
  // mcp__server__tool → tool; namespace/prefix tolerant
  const parts = tool.split(/__|:|\./);
  return (parts[parts.length - 1] || tool).toLowerCase().replace(/[_-]/g, "");
}

/** t3code's toolGroupAction — classify a tool entry by what it does. */
export function toolGroupAction(entry: Pick<AgentWorkLogEntry, "tool" | "command">): ToolGroupAction {
  const name = normalizeToolName(entry.tool);
  if (READ_TOOLS.has(name)) return "read";
  if (EDIT_TOOLS.has(name)) return "edit";
  if (COMMAND_TOOLS.has(name) || entry.command) return "command";
  if (WEB_SEARCH_TOOLS.has(name) || CODE_SEARCH_TOOLS.has(name)) return "search";
  return "other";
}

export function toolGroupSummaryIconName(action: ToolGroupAction): WorkEntryIconName {
  switch (action) {
    case "read":
      return "eye";
    case "edit":
      return "square-pen";
    case "command":
      return "terminal";
    case "search":
      return "globe";
    case "other":
      return "wrench";
  }
}

export function toolGroupActionLabel(action: ToolGroupAction, count: number): string {
  switch (action) {
    case "read":
      return `Read ${count} ${count === 1 ? "file" : "files"}`;
    case "edit":
      return `Changed ${count} ${count === 1 ? "file" : "files"}`;
    case "command":
      return `Ran ${count} ${count === 1 ? "command" : "commands"}`;
    case "search":
      return `Searched ${count} ${count === 1 ? "time" : "times"}`;
    case "other":
      return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
  }
}

export function workEntryIconName(entry: Pick<AgentWorkLogEntry, "tool" | "command" | "status">): WorkEntryIconName {
  if (entry.status === "failed") return "x";
  // t3code renders provider tool calls (OpenCode et al.) as dynamic tool calls
  // → hammer, uniformly. Failed rows get the destructive X.
  return "hammer";
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Build the row title + label from a tool call — t3code-style:
 * bold "Read" + muted "src/foo.ts", bold "Bash" + muted command.
 */
export function describeToolUse(
  tool: string,
  input: unknown,
): { title: string; label: string; detail?: string; command?: string } {
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const name = normalizeToolName(tool);
  const action = toolGroupAction({ tool, command: undefined });
  const title = capitalize(tool);

  const filePath =
    firstString(args.file_path) ??
    firstString(args.path) ??
    firstString(args.notebook_path) ??
    firstString(args.file);
  const pattern = firstString(args.pattern) ?? firstString(args.query) ?? firstString(args.url);
  const command = firstString(args.command);
  const subject = firstString(args.subject) ?? firstString(args.agent);

  if (action === "command" && command) {
    return { title, label: `Running ${command.split(/\s+/)[0] || command}`, detail: command, command };
  }
  if (action === "read") {
    return { title, label: filePath ?? title, detail: filePath ?? undefined };
  }
  if (action === "edit") {
    return { title, label: filePath ?? title, detail: filePath ?? undefined };
  }
  if (action === "search") {
    if (name === "webfetch" || name === "websearch") {
      return { title, label: pattern ? `Search web ${truncate(pattern, 48)}` : "Search web", detail: pattern ?? undefined };
    }
    return { title, label: pattern ? truncate(pattern, 48) : title, detail: pattern ?? undefined };
  }
  if (subject) {
    return { title, label: subject, detail: subject };
  }
  const fallback =
    firstString(args.sql) ??
    firstString(args.prompt) ??
    firstString(args.description) ??
    firstString(args.content);
  if (fallback) {
    return { title, label: truncate(fallback, 48), detail: truncate(fallback, 200) };
  }
  return { title, label: title };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
