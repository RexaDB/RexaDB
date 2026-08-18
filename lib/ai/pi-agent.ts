import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { createPiDbTools, type PiToolContext } from "@/lib/ai/pi-tools";
import { buildAgentInstructions } from "@/lib/ai/system-prompt";
import { resolveLanguageModel } from "@/lib/ai/providers";
import type {
  AgentChatHistoryMessage,
  AgentWorkflowContext,
  GlobalAiSettings,
  LightDashboardContext,
  LightSchemaContextTable,
} from "@/lib/ai/types";

export type PiSseEvent =
  | { type: "step"; message: string }
  | { type: "assistant_delta"; message: string }
  | { type: "tool_start"; tool: string; command: string }
  | { type: "tool_output"; output: string }
  | { type: "tool_end"; exitCode: number };

export type PiThinkingLevel = "minimal" | "low" | "medium" | "high";

export type PiAgentInput = {
  settings: GlobalAiSettings;
  provider: string;
  model: string;
  permissionMode?: "schema_only" | "schema_with_data";
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  schemaContext?: LightSchemaContextTable[];
  dashboardContext?: LightDashboardContext[];
  workflowContext?: AgentWorkflowContext;
  emitStep: (message: string) => void;
  thinkingLevel?: PiThinkingLevel;
};

type PiModelSpec = {
  piProvider: string;
  modelId: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function parsePiModelSpec(modelIdWithPrefix: string, url?: string): PiModelSpec {
  const [prefix, ...rest] = String(modelIdWithPrefix || "").split("/");
  const modelId = rest.join("/");
  const hasCustomUrl = !!url;

  switch (prefix) {
    case "anthropic":
      return {
        piProvider: "anthropic",
        modelId,
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        reasoning: false,
      };
    case "google":
      return {
        piProvider: "google",
        modelId,
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.googleapis.com",
        reasoning: false,
      };
    case "openai":
      return hasCustomUrl
        ? {
            piProvider: "openai",
            modelId,
            api: "openai-completions",
            baseUrl: url!,
            reasoning: false,
          }
        : {
            piProvider: "openai",
            modelId,
            api: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            reasoning: false,
          };
    default:
      return hasCustomUrl
        ? {
            piProvider: "openai",
            modelId,
            api: "openai-completions",
            baseUrl: url!,
            reasoning: false,
          }
        : {
            piProvider: "openai",
            modelId,
            api: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            reasoning: false,
          };
  }
}

function buildFallbackModel(spec: PiModelSpec): Model<any> {
  return {
    id: spec.modelId,
    name: spec.modelId,
    api: spec.api as any,
    provider: spec.piProvider as any,
    baseUrl: spec.baseUrl,
    reasoning: spec.reasoning,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function buildPiSystemPrompt(input: Pick<PiAgentInput, "dbType" | "selectedNamespace" | "schemaContext" | "permissionMode" | "workflowContext">, tools: ReturnType<typeof createPiDbTools>) {
  const instructions = buildAgentInstructions({
    dbType: input.dbType,
    selectedNamespace: input.selectedNamespace,
    schemaContext: input.schemaContext,
    permissionMode: input.permissionMode,
    workflowContext: input.workflowContext,
  });
  const toolsList = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  return [
    instructions,
    "",
    "Available tools:",
    toolsList,
    "",
    "Use these tools to inspect schemas, run queries, and retrieve data from the connected database.",
    "Never fabricate tool results. If a tool fails, report the error message to the user.",
  ].join("\n");
}

export async function createRexaDbPiSession(input: PiAgentInput): Promise<{ session: AgentSession; dispose: () => void }> {
  const resolved = resolveLanguageModel(input.settings, input.provider as any, input.model);
  const spec = parsePiModelSpec(resolved.model.id, resolved.model.url);

  const modelRuntime = await ModelRuntime.create({
    authPath: join(tmpdir(), "rexadb-pi-agent", "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  await modelRuntime.setRuntimeApiKey(spec.piProvider, resolved.model.apiKey);

  let model = modelRuntime.getModel(spec.piProvider, spec.modelId) ?? buildFallbackModel(spec);
  if (spec.baseUrl !== model.baseUrl) {
    model = { ...model, baseUrl: spec.baseUrl };
  }

  const toolContext: PiToolContext = {
    connectionString: input.connectionString,
    defaultNamespace: input.selectedNamespace,
    permissionMode: input.permissionMode,
    dashboardContext: input.dashboardContext,
    emitStep: input.emitStep,
  };
  const tools = createPiDbTools(toolContext);

  const systemPrompt = buildPiSystemPrompt(input, tools);

  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };

  const { session } = await createAgentSession({
    cwd: join(tmpdir(), "rexadb-pi-agent"),
    model,
    modelRuntime,
    customTools: tools,
    noTools: "builtin",
    thinkingLevel: input.thinkingLevel ?? "low",
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    resourceLoader,
  });

  return {
    session,
    dispose: () => session.dispose(),
  };
}

export async function streamPiResponse(params: {
  session: AgentSession;
  history: AgentChatHistoryMessage[];
  prompt: string;
  emit: (event: PiSseEvent) => void;
  isAborted?: () => boolean;
}): Promise<string> {
  if (params.history.length > 0) {
    params.session.state.messages = params.history.map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.content }],
    })) as any;
  }

  let fullText = "";
  let lastAssistantError: string | undefined;

  params.session.subscribe((event) => {
    if (params.isAborted?.()) return;
    switch (event.type) {
      case "message_update": {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent.type === "text_delta") {
          fullText += assistantEvent.delta;
          params.emit({ type: "assistant_delta", message: assistantEvent.delta });
        }
        break;
      }
      case "message_end": {
        const message: any = (event as any).message;
        if (message?.role === "assistant") {
          if (message.stopReason === "error" || message.errorMessage) {
            lastAssistantError = message.errorMessage || `Model returned stopReason "${message.stopReason}".`;
          } else {
            lastAssistantError = undefined;
          }
        }
        break;
      }
      case "tool_execution_start": {
        params.emit({ type: "step", message: event.toolName });
        params.emit({ type: "tool_start", tool: event.toolName, command: JSON.stringify(event.args ?? {}) });
        break;
      }
      case "tool_execution_end": {
        const output = Array.isArray(event.result?.content)
          ? event.result.content
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join("\n")
          : "";
        params.emit({ type: "tool_output", output });
        params.emit({ type: "tool_end", exitCode: event.isError ? 1 : 0 });
        break;
      }
      default:
        break;
    }
  });

  await params.session.prompt(params.prompt);
  params.session.dispose();

  if (!params.isAborted?.()) {
    if (lastAssistantError) {
      const modelId = params.session.model?.id ?? "unknown";
      throw new Error(`AI request failed: ${lastAssistantError} (model: ${modelId})`);
    }
    if (!fullText.trim()) {
      const lastAssistant = [...params.session.state.messages]
        .reverse()
        .find((message: any) => message.role === "assistant");
      const stopReason = (lastAssistant as any)?.stopReason;
      const modelId = params.session.model?.id ?? "unknown";
      throw new Error(
        `The assistant returned an empty response (model: ${modelId}${stopReason ? `, stopReason: ${stopReason}` : ""}).`,
      );
    }
  }

  return fullText;
}