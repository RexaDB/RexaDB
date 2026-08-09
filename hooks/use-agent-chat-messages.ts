import { useState, useEffect, useCallback } from "react";
import { AgentChatMessage } from "@/lib/studio/types";

interface UseAgentChatMessagesProps {
  connectionId: number;
}

export function useAgentChatMessages({ connectionId }: UseAgentChatMessagesProps) {
  const [agentChatMessages, setAgentChatMessages] = useState<AgentChatMessage[]>([]);

  useEffect(() => {
    const storageKey = `rexa-db-agent-chat-${connectionId}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setAgentChatMessages([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setAgentChatMessages([]);
        return;
      }
      const normalized = parsed
        .filter((item: any) => typeof item?.id === "string" && typeof item?.role === "string")
        .map((item: any) => ({
          id: item.id,
          role: item.role === "assistant" || item.role === "system" ? item.role : "user",
          content: String(item.content || ""),
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        })) as AgentChatMessage[];
      setAgentChatMessages(normalized);
    } catch {
      setAgentChatMessages([]);
    }
  }, [connectionId]);

  useEffect(() => {
    const storageKey = `rexa-db-agent-chat-${connectionId}`;
    localStorage.setItem(storageKey, JSON.stringify(agentChatMessages));
  }, [agentChatMessages, connectionId]);

  const appendAgentChatMessage = useCallback((message: { role: "user" | "assistant" | "system"; content: string }) => {
    const id = Math.random().toString(36).slice(2, 10);
    const nextMessage: AgentChatMessage = {
      id,
      role: message.role,
      content: message.content,
      createdAt: Date.now(),
    };
    setAgentChatMessages((prev) => [...prev, nextMessage]);
    return id;
  }, []);

  const updateAgentChatMessage = useCallback((id: string, updater: (prevContent: string) => string) => {
    setAgentChatMessages((prev) =>
      prev.map((message) =>
        message.id === id
          ? { ...message, content: updater(message.content) }
          : message
      )
    );
  }, []);

  const clearAgentChatMessages = useCallback(() => {
    setAgentChatMessages([]);
  }, []);

  return {
    agentChatMessages,
    setAgentChatMessages,
    appendAgentChatMessage,
    updateAgentChatMessage,
    clearAgentChatMessages,
  };
}
