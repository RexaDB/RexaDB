import { useCallback, useState } from "react";

import { apiFetch } from "@/lib/api-base";
import { readSseStream } from "@/lib/ai/read-sse-stream";
import type { AgentChatRequest } from "@/lib/ai/types";
import {
  buildLightSchemaContext,
  buildSqlAiEditorPrompt,
  extractExplanationText,
  extractFirstCodeBlock,
  formatAiSnippetForEditor,
} from "@/lib/studio/sql-ai-mode";

type SchemaEntry = {
  schema?: string;
  name?: string;
  columns?: Array<{ name?: string; type?: string }>;
};

function randomChatId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

export function useSqlAiGeneration(input: {
  connectionId: number;
  connectionString: string;
  dbType: string;
  provider: AgentChatRequest["provider"];
  model: string;
  selectedNamespace?: string;
  userId?: string | null;
  schemaData: Record<string, SchemaEntry>;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateCommentedSnippet = useCallback(async (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error("Type an AI prompt after /.");
    }

    setIsGenerating(true);
    try {
      const response = await apiFetch("/api/agent/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: `sql-editor-${randomChatId()}`,
          provider: input.provider,
          model: input.model,
          prompt: buildSqlAiEditorPrompt({ dbType: input.dbType, prompt: trimmedPrompt }),
          connectionId: input.connectionId,
          connectionString: input.connectionString,
          dbType: input.dbType,
          selectedNamespace: input.selectedNamespace,
          userId: input.userId,
          lightSchemaContext: buildLightSchemaContext(input.schemaData, input.selectedNamespace),
          lightDashboardContext: [],
        } satisfies AgentChatRequest),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start AI generation.");
      }

      const reader = response.body.getReader();
      let finalMessage = "";

      for await (const payload of readSseStream(reader)) {
        if (payload.type === "assistant_delta") {
          finalMessage += payload.message;
          continue;
        }
        if (payload.type === "assistant_done") {
          finalMessage = payload.message;
          continue;
        }
        if (payload.type === "error") {
          throw new Error(payload.message);
        }
      }

      const snippet = extractFirstCodeBlock(finalMessage);
      if (!snippet) {
        throw new Error("The assistant returned an empty snippet.");
      }

      return formatAiSnippetForEditor({
        dbType: input.dbType,
        snippet,
        explanation: extractExplanationText(finalMessage),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    input.connectionId,
    input.connectionString,
    input.dbType,
    input.model,
    input.provider,
    input.schemaData,
    input.selectedNamespace,
    input.userId,
  ]);

  return {
    generateCommentedSnippet,
    isGenerating,
  };
}
