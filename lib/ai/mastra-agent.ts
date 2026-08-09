import { Agent } from "@mastra/core/agent";

import { createRexaDbTools } from "@/lib/ai/tools";
import { buildAgentInstructions } from "@/lib/ai/system-prompt";
import { resolveLanguageModel } from "@/lib/ai/providers";
import type { AgentChatHistoryMessage, AgentProvider, AgentWorkflowContext, GlobalAiSettings, LightDashboardContext, LightSchemaContextTable } from "@/lib/ai/types";

export function createRexaDbAgent(input: {
  settings: GlobalAiSettings;
  provider: AgentProvider;
  model: string;
  permissionMode?: "schema_only" | "schema_with_data";
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  schemaContext?: LightSchemaContextTable[];
  dashboardContext?: LightDashboardContext[];
  workflowContext?: AgentWorkflowContext;
  emitStep: (message: string) => void;
}) {
  const resolvedModel = resolveLanguageModel(input.settings, input.provider, input.model);
  const tools = createRexaDbTools({
    connectionString: input.connectionString,
    defaultNamespace: input.selectedNamespace,
    dashboardContext: input.dashboardContext,
    permissionMode: input.permissionMode,
    emitStep: input.emitStep,
  });

  return new Agent({
    id: "rexadb-readonly-agent",
    name: "RexaDB Read-only Agent",
    description: "Database agent: inspect schemas, run queries, retrieve data from the connected database",
    instructions: buildAgentInstructions({
      dbType: input.dbType,
      permissionMode: input.permissionMode,
      selectedNamespace: input.selectedNamespace,
      schemaContext: input.schemaContext,
      workflowContext: input.workflowContext,
    }),
    model: resolvedModel.model as any,
    tools,
  });
}

export function toMastraMessages(history: AgentChatHistoryMessage[], prompt: string) {
  return [
    ...history.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
    `USER: ${prompt}`,
  ];
}
