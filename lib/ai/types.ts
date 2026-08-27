import type { WorkflowEdge, WorkflowNode } from "@/lib/workflows/types";

/** Providers pinned in the settings UI and given special-cased resolution. */
export type KnownAgentProvider = "openai" | "google" | "anthropic" | "openrouter" | "kilo" | "ollama" | "external";

/**
 * Any provider id the Pi agent SDK supports (see `lib/ai/pi-provider-catalog.ts`)
 * can be configured too — `providers` is keyed dynamically, not just by the
 * pinned ids above.
 */
export type AgentProvider = KnownAgentProvider | (string & {});

export type GlobalAiProviderConfig = {
  apiKey: string;
  models: string[];
  baseUrl?: string;
};

export type AiPermissionMode = "schema_only" | "schema_with_data";

export type GlobalAiSettings = {
  permissionMode: AiPermissionMode;
  providers: Record<string, GlobalAiProviderConfig>;
};

export type AgentChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LightSchemaContextTable = {
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string }>;
};

/** Column change marker for ```schema-plan blocks (engine-neutral). */
export type SchemaPlanColumnChange =
  | "added"
  | "removed"
  | "unchanged"
  | "modified";

export type SchemaPlanColumn = {
  name: string;
  type: string;
  change: SchemaPlanColumnChange;
  /** Previous type when change === "modified" */
  previousType?: string;
  nullable?: boolean;
  note?: string;
};

export type SchemaPlanTable = {
  schema: string;
  table: string;
  action: "create" | "alter" | "drop";
  columns: SchemaPlanColumn[];
};

/**
 * Structured schema proposal for plan mode.
 * Emitted as a fenced ```schema-plan JSON block.
 */
export type SchemaPlan = {
  title?: string;
  summary?: string;
  mode?: "plan" | "build";
  tables: SchemaPlanTable[];
  notes?: string[];
  /** Optional DDL for later apply — not auto-executed in plan mode. */
  applySql?: string;
};

export type LightDashboardContext = {
  id: string;
  ref: string;
  name: string;
  widgets: Array<{
    id: string;
    widgetType: string;
    title: string;
    query?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }>;
};

export type LightWorkflowRef = {
  id: string;
  name: string;
  nodeCount: number;
  nodeTypes: string[];
};

export type AgentWorkflowContext = {
  existing: LightWorkflowRef[];
  current?: {
    id: string;
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  } | null;
};

export type AgentWorkflowPlan = {
  name?: string;
  workflowId?: string;
  nodes: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

export type AgentChatRequest = {
  chatId: string;
  provider: AgentProvider;
  model: string;
  prompt: string;
  connectionId: number;
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  userId?: string | null;
  permissionMode?: AiPermissionMode;
  history?: AgentChatHistoryMessage[];
  lightSchemaContext?: LightSchemaContextTable[];
  lightDashboardContext?: LightDashboardContext[];
  lightWorkflowContext?: AgentWorkflowContext;
};

export type AgentStreamEvent =
  | { type: "step"; message: string }
  | { type: "assistant_delta"; message: string }
  | { type: "assistant_done"; message: string }
  | { type: "error"; message: string }
  | { type: "tool_start"; tool: string; command: string }
  | { type: "tool_output"; output: string }
  | { type: "tool_end"; exitCode: number }
  | { type: "sub_agent_start"; agentName: string; prompt: string }
  | { type: "sub_agent_delta"; agentName: string; message: string }
  | { type: "sub_agent_done"; agentName: string; result: string }
  | { type: "sub_agent_tool_call"; agentName: string; toolName: string; args: unknown }
  | { type: "sub_agent_tool_output"; agentName: string; output: string };

export type StoredAiChat = {
  id: string;
  connectionId: number;
  userId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredAiChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metaJson?: string | null;
};
