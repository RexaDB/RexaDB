export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: string[];
  items?: JsonSchema;
  default?: JsonValue;
};

export type ToolArgs = Record<string, JsonValue | undefined>;

export interface AgentToolContext {
  connectionString: string;
  defaultSchema?: string;
  defaultMaxRows?: number;
}

export interface AgentToolResult {
  ok: boolean;
  data?: JsonValue;
  error?: string;
}

export interface AgentTool {
  provider: string;
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: ToolArgs, context: AgentToolContext) => Promise<AgentToolResult>;
}

export interface OpenAIFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict: boolean;
}

export interface OpenAIFunctionToolCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface GeminiToolWrapper {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, JsonValue>;
}
