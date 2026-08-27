import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-base";
import {
  defaultModeId,
  type AgentProvider,
  type AgentProviderId,
  type AgentChatMessage,
  type AgentStreamEvent,
  type AgentWorkLogEntry,
} from "@/lib/agents/provider-types";
import {
  getAppMode,
  loadSelectedAppModeId,
  saveSelectedAppModeId,
  resolveProviderModeForAppMode,
  type RexaAgentAppMode,
} from "@/lib/agents/app-modes";
import { describeToolUse } from "@/lib/agents/work-log";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function useAgentHarness(input: {
  connectionId: number;
  connectionString: string;
  dbType: string;
  connectionName?: string;
  schemaContext?: Array<{
    schema: string;
    table: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  /** Active thread id — scopes workspace sandboxing and conversation persistence. */
  threadId?: string | null;
}) {
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  const [activeProvider, setActiveProviderRaw] = useState<AgentProviderId>(() => {
    try {
      const stored = localStorage.getItem(
        `rexa-agent-provider-${input.connectionId}`,
      );
      if (stored) return stored as AgentProviderId;
    } catch {}
    return "rexadb";
  });
  const setActiveProvider = useCallback(
    (provider: AgentProviderId) => {
      setActiveProviderRaw(provider);
      try {
        localStorage.setItem(
          `rexa-agent-provider-${input.connectionId}`,
          provider,
        );
      } catch {}
    },
    [input.connectionId],
  );
  const [selectedMode, setSelectedModeRaw] = useState("");
  const setSelectedMode = useCallback(
    (mode: string) => {
      setSelectedModeRaw(mode);
      try {
        localStorage.setItem(
          `rexa-agent-mode-${input.connectionId}-${activeProvider}`,
          mode,
        );
      } catch {}
    },
    [input.connectionId, activeProvider],
  );

  const [appModeId, setAppModeIdRaw] = useState(() =>
    loadSelectedAppModeId(input.connectionId),
  );
  const setAppModeId = useCallback(
    (id: string) => {
      setAppModeIdRaw(id);
      saveSelectedAppModeId(input.connectionId, id);
      const appMode = getAppMode(input.connectionId, id);
      const mapped = resolveProviderModeForAppMode(appMode, activeProvider);
      if (mapped) setSelectedMode(mapped);
    },
    [input.connectionId, activeProvider, setSelectedMode],
  );
  const appMode: RexaAgentAppMode = getAppMode(input.connectionId, appModeId);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [workLog, setWorkLog] = useState<AgentWorkLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);
  const [isDetecting, setIsDetecting] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AgentChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const workLogRef = useRef<AgentWorkLogEntry[]>([]);
  useEffect(() => {
    workLogRef.current = workLog;
  }, [workLog]);
  /** Storage key of the thread whose conversation is currently loaded in memory. */
  const loadedThreadKeyRef = useRef<string | null>(null);

  const threadStorageKey = input.threadId
    ? `rexa-agent-chat-${input.connectionId}:${input.threadId}`
    : null;

  const persistThread = useCallback(
    (
      key: string | null,
      payload?: { messages: AgentChatMessage[]; workLog: AgentWorkLogEntry[] },
    ) => {
      if (!key) return;
      const messagesToSave = payload?.messages ?? messagesRef.current;
      const workLogToSave = payload?.workLog ?? workLogRef.current;
      if (messagesToSave.length === 0 && workLogToSave.length === 0) return;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            messages: messagesToSave,
            workLog: workLogToSave,
            savedAt: Date.now(),
          }),
        );
      } catch {
        // Storage full / unavailable — non-fatal
      }
    },
    [],
  );

  // Claim the active thread key and keep storage in sync (including mid-stream).
  useEffect(() => {
    if (!threadStorageKey) return;
    if (!loadedThreadKeyRef.current) {
      loadedThreadKeyRef.current = threadStorageKey;
    }
    const ownerKey = loadedThreadKeyRef.current;
    if (ownerKey !== threadStorageKey) {
      persistThread(ownerKey);
      return;
    }
    persistThread(threadStorageKey, { messages, workLog });
  }, [threadStorageKey, messages, workLog, persistThread]);

  const readStoredThread = useCallback(
    (threadId: string): {
      messages: AgentChatMessage[];
      workLog: AgentWorkLogEntry[];
    } => {
      const keys = [
        `rexa-agent-chat-${input.connectionId}:${threadId}`,
        `rexa-agent-chat-0:${threadId}`,
      ];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k &&
            k.startsWith("rexa-agent-chat-") &&
            k.endsWith(`:${threadId}`) &&
            !keys.includes(k)
          ) {
            keys.push(k);
          }
        }
      } catch {}

      for (const key of keys) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const data = JSON.parse(raw) as {
            messages?: AgentChatMessage[];
            workLog?: AgentWorkLogEntry[];
          };
          const storedMessages = Array.isArray(data.messages) ? data.messages : [];
          if (storedMessages.length === 0) continue;
          return {
            messages: storedMessages,
            workLog: Array.isArray(data.workLog)
              ? data.workLog.map((e) =>
                  e.status === "inProgress"
                    ? { ...e, status: "completed" as const }
                    : e,
                )
              : [],
          };
        } catch {
          // try next key
        }
      }
      return { messages: [], workLog: [] };
    },
    [input.connectionId],
  );

  /** Load a stored conversation into the harness (sidebar resume). */
  const loadThread = useCallback(
    (threadId: string) => {
      const key = `rexa-agent-chat-${input.connectionId}:${threadId}`;
      const prevKey = loadedThreadKeyRef.current;

      if (prevKey && prevKey !== key) {
        persistThread(prevKey);
      }

      // Already showing this thread — don't replace live messages with empty storage.
      if (prevKey === key && messagesRef.current.length > 0) {
        persistThread(key);
        return;
      }

      const stored = readStoredThread(threadId);
      if (
        stored.messages.length === 0 &&
        messagesRef.current.length > 0 &&
        (prevKey === key || prevKey === null)
      ) {
        loadedThreadKeyRef.current = key;
        persistThread(key);
        return;
      }

      loadedThreadKeyRef.current = key;
      setMessages(stored.messages);
      setWorkLog(stored.workLog);
    },
    [input.connectionId, persistThread, readStoredThread],
  );

  const detectProviders = useCallback(async () => {
    // Hydrate from localStorage instantly — mirrors t3's hydrateCachedProvider / providerStatusCache
    try {
      const { readProvidersCache, isCacheFresh, isCacheStaleUsable, writeProvidersCache, mergeCachedProviders } =
        await import("@/lib/agents/provider-cache");
      const cached = readProvidersCache();
      if (cached && isCacheFresh(cached)) {
        setProviders(cached.providers);
        setIsDetecting(false);
        // Revalidate in background (stale-while-revalidate) without flicker
        void (async () => {
          try {
            const res = await apiFetch("/api/agents/detect");
            const text = await res.text();
            const data = JSON.parse(text);
            if (Array.isArray(data.providers) && data.providers.length > 0) {
              const merged = mergeCachedProviders(data.providers, cached.providers);
              setProviders(merged);
              writeProvidersCache(merged);
            }
          } catch {}
        })();
        return;
      }
      if (cached && isCacheStaleUsable(cached)) {
        setProviders(cached.providers);
        setIsDetecting(true);
        try {
          const res = await apiFetch("/api/agents/detect");
          const text = await res.text();
          const data = JSON.parse(text);
          if (Array.isArray(data.providers) && data.providers.length > 0) {
            const merged = mergeCachedProviders(data.providers, cached.providers);
            setProviders(merged);
            writeProvidersCache(merged);
          }
        } catch (err) {
          console.error("Failed to detect agents (stale cache kept):", err);
        } finally {
          setIsDetecting(false);
        }
        return;
      }
    } catch {}

    try {
      setIsDetecting(true);
      const res = await apiFetch("/api/agents/detect");
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data.providers) && data.providers.length > 0) {
          setProviders(data.providers);
          try {
            const { writeProvidersCache } = await import("@/lib/agents/provider-cache");
            writeProvidersCache(data.providers);
          } catch {}
        }
      } catch {
        console.warn("agents/detect returned non-JSON:", text.slice(0, 200));
      }
    } catch (err) {
      console.error("Failed to detect agents:", err);
    } finally {
      setIsDetecting(false);
    }
  }, []);

  useEffect(() => {
    detectProviders();
  }, [detectProviders]);

  useEffect(() => {
    setAppModeIdRaw(loadSelectedAppModeId(input.connectionId));
  }, [input.connectionId]);

  useEffect(() => {
    const modes = providers.find((p) => p.id === activeProvider)?.modes ?? [];
    const app = getAppMode(input.connectionId, appModeId);
    const mapped = resolveProviderModeForAppMode(app, activeProvider);
    if (mapped && modes.some((m) => m.id === mapped)) {
      setSelectedModeRaw(mapped);
      return;
    }
    if (modes.length === 0) {
      setSelectedModeRaw("");
      return;
    }
    let stored = "";
    try {
      stored =
        localStorage.getItem(
          `rexa-agent-mode-${input.connectionId}-${activeProvider}`,
        ) || "";
    } catch {}
    const next =
      (stored && modes.some((m) => m.id === stored) ? stored : "") ||
      defaultModeId(modes);
    setSelectedModeRaw(next);
  }, [activeProvider, providers, input.connectionId, appModeId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const userMessage: AgentChatMessage = {
        id: randomId(),
        role: "user",
        content: content.trim(),
        provider: activeProvider,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingStartedAt(Date.now());
      if (threadStorageKey && !loadedThreadKeyRef.current) {
        loadedThreadKeyRef.current = threadStorageKey;
      }

      const assistantMessage: AgentChatMessage = {
        id: randomId(),
        role: "assistant",
        content: "",
        provider: activeProvider,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      const turnId = assistantMessage.id;
      const turnStartedAt = Date.now();
      const settleTurn = (interrupted: boolean) => {
        const durationMs = Date.now() - turnStartedAt;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turnId
              ? { ...m, metadata: { ...m.metadata, durationMs, interrupted } }
              : m,
          ),
        );
      };

      try {
        abortRef.current = new AbortController();

        const history = messagesRef.current
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await apiFetch("/api/agents/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: activeProvider,
            prompt: content.trim(),
            history,
            mode: selectedMode || undefined,
            appMode: {
              id: appMode.id,
              label: appMode.label,
              kind: appMode.kind,
              allowSqlRead: appMode.allowSqlRead,
              allowSqlWrite: appMode.allowSqlWrite,
              promptRules: appMode.promptRules,
              mapsToProviderMode: appMode.mapsToProviderMode,
            },
            threadId: input.threadId || undefined,
            connectionId: input.connectionId,
            connectionString: input.connectionString,
            connectionName: input.connectionName,
            dbType: input.dbType,
            schemaContext: input.schemaContext,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;

          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            const line = event
              .split("\n")
              .find((part) => part.startsWith("data:"));
            if (!line) continue;

            try {
              const data: AgentStreamEvent = JSON.parse(line.slice(5).trim());

              if ((data.type === "text_delta" || data.type === "assistant_delta") && (data.content || data.message)) {
                const delta = data.content ?? data.message ?? "";
                fullContent += delta;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === turnId
                      ? { ...m, content: fullContent }
                      : m,
                  ),
                );
              } else if (data.type === "tool_start") {
                // Structured work-log entry — never flattened into message content
                const described = describeToolUse(data.tool || "tool", data.input);
                const label = data.label || described.label;
                setWorkLog((prev) => {
                  // Same toolCallId arriving again (ACP updates) refreshes in place
                  if (data.toolCallId) {
                    const idx = prev.findIndex(
                      (e) => e.toolCallId === data.toolCallId && e.status === "inProgress",
                    );
                    if (idx !== -1) {
                      const next = [...prev];
                      next[idx] = {
                        ...next[idx],
                        title: described.title,
                        label,
                        detail: described.detail,
                        command: described.command,
                        raw:
                          next[idx].raw ??
                          (data.input != null
                            ? JSON.stringify(data.input, null, 2)
                            : data.content),
                      };
                      return next;
                    }
                  }
                  const entry: AgentWorkLogEntry = {
                    id: randomId(),
                    turnId,
                    toolCallId: data.toolCallId,
                    tool: data.tool || "tool",
                    title: described.title,
                    label,
                    detail: described.detail,
                    command: described.command,
                    raw:
                      data.input != null
                        ? JSON.stringify(data.input, null, 2)
                        : data.content,
                    status: "inProgress",
                    createdAt: Date.now(),
                  };
                  return [...prev, entry];
                });
              } else if (data.type === "tool_output") {
                const status = data.isError ? ("failed" as const) : ("completed" as const);
                setWorkLog((prev) => {
                  const idx = data.toolCallId
                    ? prev.findLastIndex(
                        (e) => e.toolCallId === data.toolCallId && e.status === "inProgress",
                      )
                    : -1;
                  const fallbackIdx = prev.findLastIndex(
                    (e) => e.turnId === turnId && e.status === "inProgress",
                  );
                  const target = idx !== -1 ? idx : fallbackIdx;
                  if (target === -1) return prev;
                  return prev.map((e, i) => (i === target ? { ...e, status } : e));
                });
                if (data.isError && data.output) {
                  fullContent += `\n\n**Error:** ${data.output}`;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === turnId
                        ? { ...m, content: fullContent }
                        : m,
                    ),
                  );
                }
              } else if (data.type === "error") {
                const errMsg = data.content ?? data.message ?? "Unknown error";
                fullContent += `\n\n**Error:** ${errMsg}`;
                setWorkLog((prev) =>
                  prev.map((e) =>
                    e.turnId === turnId && e.status === "inProgress"
                      ? { ...e, status: "failed" }
                      : e,
                  ),
                );
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === turnId
                      ? { ...m, content: fullContent }
                      : m,
                  ),
                );
              } else if (data.type === "done" || data.type === "assistant_done") {
                // Pi sends done with content, harness sends bare done
                if (data.content || data.message) {
                  const doneContent = data.content ?? data.message ?? "";
                  if (doneContent && doneContent !== fullContent) {
                    fullContent = doneContent;
                    setMessages((prev) =>
                      prev.map((m) => (m.id === turnId ? { ...m, content: fullContent } : m)),
                    );
                  }
                }
                break;
              }
            } catch {
              // Skip malformed events
            }
          }
        }

        // Settle any entries still in progress when the stream ends cleanly
        setWorkLog((prev) =>
          prev.map((e) =>
            e.turnId === turnId && e.status === "inProgress"
              ? { ...e, status: "completed" }
              : e,
          ),
        );
        settleTurn(false);
      } catch (err: any) {
        if (err.name === "AbortError") {
          setWorkLog((prev) =>
            prev.map((e) =>
              e.turnId === turnId && e.status === "inProgress"
                ? { ...e, status: "failed" }
                : e,
            ),
          );
          settleTurn(true);
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turnId
              ? {
                  ...m,
                  content: m.content || `Error: ${err.message}`,
                }
              : m,
          ),
        );
        settleTurn(false);
      } finally {
        setIsStreaming(false);
        setStreamingStartedAt(null);
        abortRef.current = null;
      }
    },
    [activeProvider, selectedMode, appMode, input, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);
  const clearMessages = useCallback(() => {
    const prevKey = loadedThreadKeyRef.current;
    if (prevKey) {
      try {
        localStorage.setItem(
          prevKey,
          JSON.stringify({
            messages: messagesRef.current,
            workLog: workLogRef.current,
            savedAt: Date.now(),
          }),
        );
      } catch {}
    }
    loadedThreadKeyRef.current = null;
    setMessages([]);
    setWorkLog([]);
  }, []);

  const revertToMessage = useCallback((messageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      return prev.slice(0, idx + 1);
    });
    setWorkLog((prev) => {
      // Drop activity belonging to turns after the reverted message
      const cutoffIdx = messagesRef.current.findIndex((m) => m.id === messageId);
      if (cutoffIdx === -1) return prev;
      const keepTurnIds = new Set(
        messagesRef.current.slice(0, cutoffIdx + 1).map((m) => m.id),
      );
      return prev.filter((e) => keepTurnIds.has(e.turnId));
    });
  }, []);

  return {
    providers,
    activeProvider,
    setActiveProvider,
    selectedMode,
    setSelectedMode,
    appModeId,
    setAppModeId,
    appMode,
    messages,
    workLog,
    streamingStartedAt,
    isStreaming,
    isDetecting,
    sendMessage,
    stopStreaming,
    clearMessages,
    revertToMessage,
    loadThread,
    detectProviders,
  };
}
