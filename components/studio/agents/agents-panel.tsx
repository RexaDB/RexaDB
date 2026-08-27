"use client";

import { useCallback } from "react";
import { X, Trash2, RefreshCw } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { useAgentHarness } from "@/hooks/use-agent-harness";
import { listAppModes } from "@/lib/agents/app-modes";
import { AgentsProviderSelector } from "./agents-provider-selector";
import { AgentsChatMessages } from "./agents-chat-messages";
import { AgentsChatInput } from "./agents-chat-input";

interface AgentsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: number;
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  schemaContext?: Array<{
    schema: string;
    table: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  embedded?: boolean;
}

export function AgentsPanel({
  isOpen,
  onOpenChange,
  connectionId,
  connectionString,
  dbType,
  schemaContext,
  embedded,
}: AgentsPanelProps) {
  const {
    providers,
    activeProvider,
    setActiveProvider,
    selectedMode,
    setSelectedMode,
    appModeId,
    setAppModeId,
    appMode,
    messages,
    isStreaming,
    isDetecting,
    sendMessage,
    stopStreaming,
    clearMessages,
    detectProviders,
  } = useAgentHarness({
    connectionId,
    connectionString,
    dbType,
    schemaContext,
  });

  const handleProviderChange = useCallback(
    (providerId: typeof activeProvider) => {
      if (providerId !== activeProvider) {
        clearMessages();
        setActiveProvider(providerId);
      }
    },
    [activeProvider, clearMessages, setActiveProvider],
  );

  if (!isOpen) return null;

  const panel = (
    <div
      className={cn(
        "flex flex-col h-full bg-background",
        embedded ? "rounded-lg border border-border" : "",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground">Agents</h3>
          <button
            onClick={detectProviders}
            disabled={isDetecting}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Refresh providers"
          >
            <RefreshCw
              className={cn(
                "w-3 h-3",
                isDetecting && "animate-spin",
              )}
            />
          </button>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-muted-foreground/50 hover:text-muted-foreground p-1 transition-colors"
              title="Clear messages"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {!embedded && (
            <button
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground/50 hover:text-muted-foreground p-1 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Provider Selector */}
      <AgentsProviderSelector
        providers={providers}
        activeProvider={activeProvider}
        onSelect={handleProviderChange}
      />

      {/* Messages */}
      <AgentsChatMessages
        messages={messages}
        isStreaming={isStreaming}
        appMode={appMode}
      />

      {/* Input */}
      <AgentsChatInput
        onSend={sendMessage}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        activeProvider={activeProvider}
        providers={providers}
        onSelectProvider={setActiveProvider}
        selectedModel={"claude-sonnet-4-20250514"}
        onSelectModel={() => {}}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        appModes={listAppModes(connectionId)}
        selectedAppModeId={appModeId}
        onSelectAppMode={setAppModeId}
        appMode={appMode}
        isDetecting={isDetecting}
      />
    </div>
  );

  return panel;
}
