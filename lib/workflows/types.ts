// ─── Shared workflow types ────────────────────────────────────────────

export type WorkflowNode = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

export type WorkflowNodeOutput = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  output: unknown;
  logs: string[];
  error?: string;
  durationMs: number;
  skipped?: boolean;
};

export type WorkflowRunContext = {
  vars: Record<string, unknown>;
  logs: string[];
  nodeOutputs: Record<string, unknown>;
  conditionResult?: boolean;
};

export type WorkflowProgressEvent =
  | { type: "node-start"; nodeId: string }
  | { type: "node-done"; nodeId: string; output: unknown; error?: string; durationMs: number; skipped?: boolean };
