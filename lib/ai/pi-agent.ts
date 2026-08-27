import { join } from "node:path";

import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { getAgentSandboxCwd } from "@/lib/agents/sandbox-cwd";
import { getPiProviderMeta } from "@/lib/ai/pi-provider-catalog";
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
  | { type: "tool_start"; tool: string; command: string; toolCallId?: string }
  | { type: "tool_output"; output: string; isError?: boolean; toolCallId?: string }
  | { type: "tool_end"; exitCode: number; toolCallId?: string };

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
  /** Sandbox working directory surfaced to the model (prevents stale cwd claims). */
  workingDirectory?: string;
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
        baseUrl: hasCustomUrl ? url! : "https://api.anthropic.com",
        reasoning: false,
      };
    case "google":
      return {
        piProvider: "google",
        modelId,
        api: "google-generative-ai",
        baseUrl: hasCustomUrl ? url! : "https://generativelanguage.googleapis.com",
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
    default: {
      // A user-configured custom endpoint (openrouter/kilo/ollama/external,
      // or any Pi-SDK provider the user pointed at a self-hosted/regional
      // gateway) — treat it as an OpenAI-compatible passthrough.
      if (hasCustomUrl) {
        // ModelRuntime only keeps a runtime API key attached to a provider it
        // actually knows about (its builtin catalog, or a configured/extension
        // provider) — for anything else it deletes the provider entry outright
        // on the next recompose, so the key silently stops resolving ("No API
        // key found for <id>"). "kilo"/"ollama"/any unlisted custom gateway
        // aren't in the SDK's catalog, so key them under "openai" (always a
        // real builtin) and let the custom base URL do the actual routing.
        const isKnownPiProvider = !!getPiProviderMeta(prefix);
        return {
          piProvider: isKnownPiProvider ? prefix : "openai",
          modelId,
          api: "openai-completions",
          baseUrl: url!,
          reasoning: false,
        };
      }
      // Any other provider from the Pi SDK's full catalog (groq, mistral,
      // cerebras, xai, bedrock, vertex, ...) — resolve its native API format
      // and default base URL straight from the SDK instead of guessing.
      const meta = getPiProviderMeta(prefix);
      if (meta) {
        return {
          piProvider: prefix,
          modelId,
          api: meta.api || "openai-completions",
          baseUrl: meta.baseUrl || "https://api.openai.com/v1",
          reasoning: false,
        };
      }
      return {
        piProvider: "openai",
        modelId,
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        reasoning: false,
      };
    }
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

function buildPiSystemPrompt(input: Pick<PiAgentInput, "dbType" | "selectedNamespace" | "schemaContext" | "permissionMode" | "workflowContext"> & { workingDirectory?: string }, tools: ReturnType<typeof createPiDbTools>) {
  const instructions = buildAgentInstructions({
    dbType: input.dbType,
    selectedNamespace: input.selectedNamespace,
    schemaContext: input.schemaContext,
    permissionMode: input.permissionMode,
    workflowContext: input.workflowContext,
  });
  const toolsList = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  const lines: string[] = [instructions, ""];
  if (input.workingDirectory) {
    lines.push(
      `Working directory (authoritative — when asked where you are running, always report this path regardless of conversation history): ${input.workingDirectory}`,
      "",
    );
  }
  lines.push(
    "Available tools:",
    toolsList,
    "",
    "Use these tools to inspect schemas, run queries, and retrieve data from the connected database.",
    "All listed DB tools are pre-approved — call them directly, never ask the user for permission, and never report 'user rejected permission'. If a tool fails, report its exact error.",
    "For SQLite, the only namespace is 'main' — use it or leave namespace empty. Never try to read the .db file with read/bash; use list_tables / get_table_schema / sample_rows / run_readonly_query instead.",
    "Never fabricate tool results. If a tool fails, report the error message to the user.",
  );
  return lines.join("\n");
}

export async function createRexaDbPiSession(input: PiAgentInput): Promise<{ session: AgentSession; dispose: () => void }> {
  const resolved = resolveLanguageModel(input.settings, input.provider as any, input.model);
  const spec = parsePiModelSpec(resolved.model.id, resolved.model.url);
  const sandboxCwd = input.workingDirectory || getAgentSandboxCwd();

  const modelRuntime = await ModelRuntime.create({
    authPath: join(sandboxCwd, "auth.json"),
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

  const systemPrompt = buildPiSystemPrompt(
    { ...input, workingDirectory: sandboxCwd },
    tools,
  );

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

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  // Sandbox is ephemeral and has no .pi trust file — mark it trusted so
  // read/bash don't get blocked with "user rejected permission".
  try { (settingsManager as any).setProjectTrusted?.(true); } catch {}

  // When `tools` allowlist is provided, pi only enables those names.
  // Include both the read-only filesystem tools and our custom DB tools,
  // otherwise `list_tables` etc are filtered out and the model gets
  // "Tool list_tables not found" (which surfaces as empty/permission errors).
  const dbToolNames = tools.map((t) => t.name);
  const { session } = await createAgentSession({
    cwd: sandboxCwd,
    model,
    modelRuntime,
    customTools: tools,
    // Keep basic read-only filesystem tools so the agent can inspect the sandbox
    // (SCHEMA.md, working directory) without being rejected as "permission denied".
    // Write/edit remain disabled — DB writes go through our custom tools.
    tools: ["read", "bash", "ls", "grep", "find", ...dbToolNames],
    thinkingLevel: input.thinkingLevel ?? "low",
    sessionManager: SessionManager.inMemory(),
    settingsManager,
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
        params.emit({ type: "tool_start", tool: event.toolName, command: JSON.stringify(event.args ?? {}), toolCallId: (event as any).toolCallId });
        break;
      }
      case "tool_execution_end": {
        const output = Array.isArray(event.result?.content)
          ? event.result.content
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join("\n")
          : "";
        params.emit({ type: "tool_output", output, isError: event.isError, toolCallId: (event as any).toolCallId });
        params.emit({ type: "tool_end", exitCode: event.isError ? 1 : 0, toolCallId: (event as any).toolCallId });
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