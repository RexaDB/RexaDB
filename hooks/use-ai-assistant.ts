import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "@/lib/api-base";
import {
  getGlobalAiSettings,
  saveGlobalAiSettings,
  type GlobalAiSettings,
} from "@/lib/api/actions-client";
import {
  listStudioChats,
  getStudioChatMessages,
  saveStudioChatMessages,
  deleteStudioChat,
} from "@/lib/api/studio-chat-storage";
import { subscribeGlobalAiSettingsUpdated } from "@/lib/ai/ai-settings-events";
import { readSseStream } from "@/lib/ai/read-sse-stream";
import type {
  AgentProvider,
  AgentChatRequest,
  AgentWorkflowContext,
  LightDashboardContext,
  StoredAiChat,
  StoredAiChatMessage,
} from "@/lib/ai/types";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function useAiAssistant(input: {
  connectionId: number;
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  schemaContext: AgentChatRequest["lightSchemaContext"];
  dashboardContext?: LightDashboardContext[];
  workflowContext?: AgentWorkflowContext;
  userId?: string | null;
}) {
  const [settings, setSettings] = useState<GlobalAiSettings | null>(null);
  const [chats, setChats] = useState<StoredAiChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredAiChatMessage[]>([]);
  const messagesRef = useRef<StoredAiChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [steps, setSteps] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [runningCommand, setRunningCommand] = useState<{ command: string; output: string; exitCode: number | null } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ id: string; questions: { q: string; type: "radio" | "check"; options: string[] }[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadChats = useCallback(async () => {
    const result = await listStudioChats(input.connectionId);
    if (!result.success || !result.data) return;
    setChats(result.data);
    setActiveChatId((current) => current || result.data![0]?.id || null);
  }, [input.connectionId]);

  const loadSettings = useCallback(async () => {
    const result = await getGlobalAiSettings();
    if (result.success && result.data) {
      setSettings(result.data);
    }
  }, []);

  const loadMessages = useCallback(async (chatId: string | null) => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const result = await getStudioChatMessages(chatId, input.connectionId);
    setMessages(result.success && result.data ? result.data : []);
  }, [input.connectionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      await Promise.all([loadSettings(), loadChats()]);
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChats, loadSettings]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadChats();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadChats]);

  useEffect(() => {
    const unsubscribe = subscribeGlobalAiSettingsUpdated(() => {
      void loadSettings();
    });
    return unsubscribe;
  }, [loadSettings]);

  useEffect(() => {
    void loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  const saveSettings = useCallback(async (next: GlobalAiSettings) => {
    setSettings(next);
    await saveGlobalAiSettings(next);
  }, []);

  const startNewChat = useCallback(() => {
    setActiveChatId(randomId());
    setMessages([]);
    setSteps([]);
  }, []);

  const removeChat = useCallback(async (chatId: string) => {
    const result = await deleteStudioChat(chatId, input.connectionId);
    if (!result.success) {
      throw new Error(result.error || "Failed to delete chat.");
    }

    const remainingChats = chats.filter((chat) => chat.id !== chatId);
    setChats(remainingChats);

    if (activeChatId === chatId) {
      const nextChatId = remainingChats[0]?.id || randomId();
      setActiveChatId(nextChatId);
      setMessages([]);
      setSteps([]);
    }
  }, [activeChatId, chats, input.connectionId]);

  const sendMessage = useCallback(async (prompt: string, provider: string, model: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) return;

    if (!settings) throw new Error("AI settings not loaded.");

    const config = settings.providers[provider as keyof typeof settings.providers];
    if (!config) throw new Error(`AI provider "${provider}" is not configured.`);

    const isExternal = provider === "external";
    const isOllama = provider === "ollama";
    if (!isExternal && !isOllama) {
      if (!config.apiKey.trim() || !model.trim()) {
        throw new Error("Configure an AI provider with an API key and model first.");
      }
    }
    if (isOllama) {
      if (!model.trim()) {
        throw new Error("Configure Ollama with a model first.");
      }
    }
    if (isExternal && !model.trim()) {
      throw new Error("Select an ACP agent first.");
    }

    const chatId = activeChatId || randomId();
    const history = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));

    const userMessage: StoredAiChatMessage = {
      id: randomId(),
      chatId,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const assistantId = randomId();

    setActiveChatId(chatId);
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, chatId, role: "assistant", content: "", timestamp: Date.now() },
    ]);
    setSteps([]);
    setIsSending(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const streamUrl = isExternal ? "/api/agent/acp/stream" : "/api/agent/chat/stream";
      const response = await apiFetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          provider: provider as AgentProvider,
          model,
          permissionMode: settings.permissionMode,
          prompt: trimmed,
          connectionId: input.connectionId,
          connectionString: input.connectionString,
          dbType: input.dbType,
          selectedNamespace: input.selectedNamespace,
          userId: input.userId,
          history,
          lightSchemaContext: input.schemaContext,
          lightDashboardContext: input.dashboardContext || [],
          lightWorkflowContext: input.workflowContext || { existing: [], current: null },
        } satisfies AgentChatRequest),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        let errorMessage = `Server error (${response.status})`;
        const rawBody = await response.text().catch(() => "");
        console.error("[ai-chat] fetch error", { status: response.status, body: rawBody.slice(0, 2000) });
        try {
          const payload = JSON.parse(rawBody);
          if (payload && typeof payload === "object" && typeof payload.error === "string" && payload.error.trim()) {
            errorMessage = payload.error.trim();
          }
        } catch {
          const preMatch = rawBody.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
          if (preMatch) {
            const firstLine = preMatch[1].split("\n").map(l => l.trim()).filter(Boolean)[0];
            if (firstLine) errorMessage = firstLine;
          } else if (rawBody.length < 500 && rawBody.trim()) {
            errorMessage = rawBody.trim();
          }
        }
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("Failed to start AI chat stream.");
      }

      const reader = response.body.getReader();
      let finalMessage = "";

      for await (const payload of readSseStream(reader)) {
        if (payload.type === "step") {
          setSteps((prev) => [...prev, payload.message]);
          continue;
        }
        if (payload.type === "assistant_delta") {
          finalMessage += payload.message;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: `${message.content}${payload.message}` } : message,
            ),
          );
          continue;
        }
        if (payload.type === "assistant_done" || payload.type === "error") {
          if (payload.type === "error") console.error("[ai-chat] sse error event", payload.message);
          finalMessage = payload.message;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: payload.message } : message,
            ),
          );
          await saveStudioChatMessages(chatId, input.connectionId, messagesRef.current.find(m => m.role === "user")?.content.slice(0, 80) || "Chat", [...messagesRef.current]);
          if (payload.type === "error") break;
          continue;
        }
        if (payload.type === "tool_start") {
          // Handle approval/task tools specially — show the card instead of just runningCommand
          const toolName = String((payload as any).tool || (payload as any).name || "").trim();
          let toolInput: any = (payload as any).input ?? (payload as any).args;
          // Pi SDK sends args as JSON string in `command`
          if (!toolInput && typeof (payload as any).command === "string") {
            const cmd = String((payload as any).command).trim();
            if (cmd.startsWith("{") || cmd.startsWith("[")) {
              try { toolInput = JSON.parse(cmd); } catch { toolInput = cmd; }
            } else {
              // Fallback: command might be the tool name, not args – try to parse as JSON if possible
              try { toolInput = JSON.parse(cmd); } catch {}
            }
          }
          if (toolName === "ask_questions" || toolName === "ask_approval") {
            try {
              const input = typeof toolInput === "string" ? JSON.parse(toolInput) : toolInput;
              const qs = input?.questions || (input?.question ? [{ q: input.question, type: input.type || "radio", options: input.options }] : null);
              const toolCallId = String((payload as any).toolCallId || (payload as any).id || `approval-${Date.now()}`);
              if (Array.isArray(qs) && qs.length > 0) {
                setPendingApproval({ id: toolCallId, questions: qs.map((q: any) => ({ q: String(q.q || q.question || ""), type: (q.type === "check" ? "check" : "radio") as "radio" | "check", options: (q.options || []).map((o: any) => String(o)) })) });
              } else if (Array.isArray(input) && input.length > 0) {
                // Some Pi payloads send the array directly
                setPendingApproval({ id: toolCallId, questions: input.map((q: any) => ({ q: String(q.q || q.question || ""), type: (q.type === "check" ? "check" : "radio") as "radio" | "check", options: (q.options || []).map((o: any) => String(o)) })) });
              }
            } catch {}
          } else if (toolName === "create_tasks" || toolName === "create_task") {
            try {
              const input = typeof toolInput === "string" ? JSON.parse(toolInput) : toolInput;
              const tasks = input?.tasks || (Array.isArray(input) ? input : null);
              if (Array.isArray(tasks) && tasks.length > 0) {
                // For now, just emit as step — the markdown block will also be rendered if the AI outputs it.
                // If we want to store tasks, we could add a pendingTasks state here.
              }
            } catch {}
          }
          setRunningCommand({ command: payload.command, output: "", exitCode: null });
          continue;
        }
        if (payload.type === "tool_output") {
          setRunningCommand((prev) => prev ? { ...prev, output: prev.output + payload.output + "\n" } : null);
          // Also check if tool output contains approval data (fallback)
          try {
            const out = payload.output ? JSON.parse(payload.output) : null;
            if (out && Array.isArray(out.questions)) {
              setPendingApproval({ questions: out.questions });
            }
          } catch {}
          continue;
        }
        if (payload.type === "tool_end") {
          setRunningCommand((prev) => prev ? { ...prev, exitCode: payload.exitCode } : null);
          continue;
        }
      }

      if (!finalMessage.trim()) {
        throw new Error("The assistant returned an empty response.");
      }

      await loadChats();
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: message.content || "Stopped." } : message,
          ),
        );
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      console.error("[ai-chat] sendMessage error", errorMessage);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, content: errorMessage } : message,
        ),
      );
      await saveStudioChatMessages(chatId, input.connectionId, messagesRef.current.find(m => m.role === "user")?.content.slice(0, 80) || "Chat", [...messagesRef.current]);
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }, [
    activeChatId,
    input.connectionId,
    input.connectionString,
    input.dashboardContext,
    input.dbType,
    input.schemaContext,
    input.selectedNamespace,
    input.workflowContext,
    input.userId,
    isSending,
    loadChats,
    messages,
    settings,
  ]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsSending(false);
    // Also resolve any pending approval as cancelled
    if (pendingApproval) {
      apiFetch("/api/agent/approval/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId: pendingApproval.id, answers: [] }),
      }).catch(() => {});
      setPendingApproval(null);
    }
  }, [pendingApproval]);

  return {
    settings,
    chats,
    messages,
    steps,
    isSending,
    isLoading,
    activeChatId,
    setActiveChatId,
    saveSettings,
    sendMessage,
    startNewChat,
    removeChat,
    loadChats,
    runningCommand,
    pendingApproval,
    setPendingApproval,
    stopGeneration,
  };
}
