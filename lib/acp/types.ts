// fallow-ignore-file unused-type
export type AcpAgentPresetId =
  | "agoragentic" | "amp" | "auggie" | "autohand-code" | "autodev"
  | "blackbox" | "claude" | "cline" | "codebuddy" | "codex"
  | "copilot" | "corust" | "cortex-code" | "crow" | "cursor"
  | "deepagents" | "dimcode" | "dirac" | "droid" | "fast-agent"
  | "fount" | "gemini-cli" | "goose" | "hermes" | "junie"
  | "kimi" | "minion-code" | "mistral-vibe" | "openclaw"
  | "opencode" | "openhands" | "pi" | "pool" | "qoder"
  | "qwen-code" | "stakpak" | "stdio-bus" | "vtcode"
  | "custom-acp";

export type AcpAgentConfig = {
  selectedAgent: AcpAgentPresetId;
  autoApprove: boolean;
  maxTurns: number;
  cwd?: string;
  customCommand?: string;
  customArgs?: string[];
};

export type AcpPreset = {
  id: AcpAgentPresetId;
  name: string;
  command?: string;
  args?: string[];
  discoverCommand?: string;
  protocol?: "acp" | "exec";
  url?: string;
  isCustom?: boolean;
};

export type JsonRpcMessage = {
  jsonrpc: "2.0";
};

export type JsonRpcRequest = JsonRpcMessage & {
  id: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = JsonRpcMessage & {
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = JsonRpcMessage & {
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "tool_call"; toolCallId: string; title: string; kind?: ToolKind; status?: ToolCallStatus }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; status?: ToolCallStatus; content?: ToolCallContent[] }
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; modeId: string }
  | { sessionUpdate: "available_commands_update"; commands: AvailableCommand[] }
  | { sessionUpdate: "session_info_update"; info: SessionInfo }
  | { sessionUpdate: "error"; message: string };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string };

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string; newText: string }
  | { type: "terminal"; terminalId: string };

export type PermissionOption = {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
};

export type RequestPermissionOutcome =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

export type PlanEntry = {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "failed";
};

export type AvailableCommand = {
  name: string;
  description: string;
  input?: { hint: string };
};

export type SessionInfo = {
  sessionId: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export type ClientCapabilities = {
  fs: { readTextFile: boolean; writeTextFile: boolean };
  terminal: boolean;
};

export type AgentCapabilities = {
  loadSession?: boolean;
  promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  sessionCapabilities?: { resume?: Record<string, unknown>; close?: Record<string, unknown> };
};

export type TerminalExitStatus = {
  exitCode: number | null;
  signal: string | null;
};

export type InitializeParams = {
  protocolVersion: number;
  clientCapabilities: ClientCapabilities;
  clientInfo: { name: string; title: string; version: string };
};
