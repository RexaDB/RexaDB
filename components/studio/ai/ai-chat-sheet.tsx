"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, X, Plus, Shield, Settings } from "@/lib/icon-theme/lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-base";

import { AiPermissionDialog } from "@/components/studio/ai/ai-permission-dialog";
import { AiPromptInput } from "@/components/studio/ai/ai-prompt-input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AiChatHistoryMenu } from "@/components/studio/ai/ai-chat-history-menu";
import { AiMentionMenu } from "@/components/studio/ai/ai-mention-menu";
import { AiMessageList } from "@/components/studio/ai/ai-message-list";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import { AiModelPicker } from "@/components/studio/ai/ai-model-picker";
import AgentSidebarPromptBar from "@/components/studio/ai/agent-sidebar-prompt-bar";
import LoadingState from "@/components/studio/ai/loading-state";
import AgentTrace from "@/components/studio/ai/agent-trace";
import ApprovalCard from "@/components/studio/ai/approval-card";
import { useDiscoveredAgents, getConfiguredModels } from "@/lib/ai/model-utils";
import { useAiAssistant } from "@/hooks/use-ai-assistant";
import { useAiMentionCatalog } from "@/hooks/use-ai-mention-catalog";
import { useAiUser } from "@/hooks/use-ai-user";

import { buildLightDashboardContext } from "@/lib/ai/dashboard-context";
import { applyAppThemeVariables } from "@/lib/studio/app-themes";
import {
  saveGlobalAppThemeSettings,
  saveGlobalEditorThemeSettings,
} from "@/lib/api/actions-client";
import type { ThemeBlockData } from "@/components/studio/ai/ai-theme-block";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";
import type { AgentWorkflowContext, AgentWorkflowPlan } from "@/lib/ai/types";

interface AiChatSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  dashboardApplyLabel?: string;
  initialPrompt?: string | null;
  /** Chat (thread) to select when the panel opens. */
  initialChatId?: string | null;
  startNewChatToken?: number;
  /** Incrementing token to force re-select even when initialChatId is unchanged. */
  initialChatSelectToken?: number;
  /** Called whenever the sheet's internal active chat changes (incl. "New Chat"). */
  onActiveChatChange?: (chatId: string | null) => void;
  dashboards?: any[];
  connectionId: number;
  connectionString: string;
  dbType: string;
  selectedNamespace?: string;
  schemaContext: Array<{
    schema: string;
    table: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  onSendToSql: (query: string) => void;
  onRunSql?: (query: string) => void;
  onApplyDashboard: (dashboard: any) => void;
  onApplyWorkflow?: (plan: AgentWorkflowPlan) => void;
  workflowApplyBusy?: boolean;
  workflowContext?: AgentWorkflowContext;
  onOpenSettings: () => void;
  sleek?: boolean;
  floating?: boolean;
  /** Render the chat body without any outer container (the host lays it out). */
  embedded?: boolean;
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  setAppThemeId: (value: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  setEditorThemeId: (value: string) => void;
}

export function AiChatSheet({
  isOpen,
  onOpenChange,
  dashboardApplyLabel,
  initialPrompt,
  initialChatId,
  startNewChatToken,
  initialChatSelectToken,
  onActiveChatChange,
  dashboards = [],
  connectionId,
  connectionString,
  dbType,
  selectedNamespace,
  schemaContext,
  onSendToSql,
  onRunSql,
  onApplyDashboard,
  onApplyWorkflow,
  workflowApplyBusy,
  workflowContext,
  onOpenSettings: _onOpenSettings,
  sleek,
  floating,
  embedded,
  customAppThemes,
  setCustomAppThemes,
  setAppThemeId,
  customEditorThemes,
  setCustomEditorThemes,
  setEditorThemeId,
}: AiChatSheetProps) {
  const { userId, userName } = useAiUser();
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState("");
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false);
  const [isPermissionDialogOpen, setIsPermissionDialogOpen] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<
    "schema_only" | "schema_with_data"
  >("schema_with_data");

  const [width, setWidth] = useState(400);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(700, Math.max(320, startWidth + ev.clientX - startX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleApplyTheme = useCallback(
    (block: ThemeBlockData) => {
      if (block.type === "app") {
        const colors = block.theme.colors ? { ...block.theme.colors } : {};
        const appTheme: CustomAppTheme = {
          id: block.theme.id,
          name: block.theme.name,
          base: block.theme.base,
          colors,
        };

        applyAppThemeVariables(document.documentElement, colors, []);
        document.documentElement.dataset.appTheme = appTheme.id;
        document.documentElement.style.colorScheme = appTheme.base;

        setCustomAppThemes((prev) => {
          const next = [appTheme, ...prev.filter((t) => t.id !== appTheme.id)];
          saveGlobalAppThemeSettings({
            appThemeId: appTheme.id,
            customAppThemes: JSON.stringify(next),
          });
          return next;
        });
        setAppThemeId(appTheme.id);
      } else if (block.type === "editor") {
        const themeJson = block.theme.themeJson || "{}";
        const editorTheme: CustomEditorTheme = {
          id: block.theme.id,
          name: block.theme.name,
          themeJson,
        };

        setCustomEditorThemes((prev) => {
          const next = [
            editorTheme,
            ...prev.filter((t) => t.id !== editorTheme.id),
          ];
          saveGlobalEditorThemeSettings({
            editorThemeId: editorTheme.id,
            customEditorThemes: JSON.stringify(next),
          });
          return next;
        });
        setEditorThemeId(editorTheme.id);
      }
    },
    [
      setAppThemeId,
      setCustomAppThemes,
      setEditorThemeId,
      setCustomEditorThemes,
    ],
  );

  const mentionCatalog = useAiMentionCatalog({
    connectionString,
    dbType,
    fallback: schemaContext,
    enabled: isOpen,
  });
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");

  const {
    settings,
    chats,
    messages,
    steps,
    isLoading,
    isSending,
    activeChatId,
    setActiveChatId,
    saveSettings,
    sendMessage,
    startNewChat,
    removeChat,
    loadChats,
    pendingApproval,
    setPendingApproval,
    stopGeneration,
  } = useAiAssistant({
    connectionId,
    connectionString,
    dashboardContext: buildLightDashboardContext(dashboards),
    dbType,
    selectedNamespace,
    schemaContext: mentionCatalog,
    workflowContext,
    userId,
  });

  const onActiveChatChangeRef = useRef(onActiveChatChange);
  useEffect(() => {
    onActiveChatChangeRef.current = onActiveChatChange;
  });
  useEffect(() => {
    onActiveChatChangeRef.current?.(activeChatId);
  }, [activeChatId]);

  const rankedMentionCatalog = useMemo(() => {
    return [...mentionCatalog].sort((a, b) => {
      const aSelected = a.schema === selectedNamespace ? 0 : 1;
      const bSelected = b.schema === selectedNamespace ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`);
    });
  }, [mentionCatalog, selectedNamespace]);
  const dashboardMentionItems = useMemo(() => {
    return buildLightDashboardContext(dashboards).map((dashboard) => ({
      kind: "dashboard" as const,
      label: dashboard.name,
      value: dashboard.ref,
    }));
  }, [dashboards]);

  const emptyIdeas = useMemo(() => {
    const tables = rankedMentionCatalog.slice(0, 3);
    return tables
      .flatMap((entry) => [
        `Show the schema for ${entry.table}`,
        `Give me a summary of ${entry.schema}.${entry.table}`,
      ])
      .slice(0, 4);
  }, [rankedMentionCatalog]);

  const mentionMatch = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(message);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() || "";
  const mentionItems = useMemo(() => {
    if (!mentionMatch || !isMentionMenuOpen) return [];
    const tableItems = rankedMentionCatalog.map((entry) => ({
      kind: "table" as const,
      label: `${entry.schema}.${entry.table}`,
      value: `${entry.schema}.${entry.table}`,
    }));
    return [...dashboardMentionItems, ...tableItems]
      .filter(
        (entry) =>
          entry.value.toLowerCase().includes(mentionQuery) ||
          entry.label.toLowerCase().includes(mentionQuery),
      )
      .slice(0, 50);
  }, [
    dashboardMentionItems,
    isMentionMenuOpen,
    mentionMatch,
    mentionQuery,
    rankedMentionCatalog,
  ]);
  const validMentions = useMemo(
    () =>
      new Set([
        ...rankedMentionCatalog.map((entry) =>
          `${entry.schema}.${entry.table}`.toLowerCase(),
        ),
        ...dashboardMentionItems.map((entry) => entry.value.toLowerCase()),
      ]),
    [dashboardMentionItems, rankedMentionCatalog],
  );

  // ── PromptBar sidebar wiring (replaces classic AiPromptInput + AiModelPicker) ──
  const discoveredAgents = useDiscoveredAgents();

  const sidebarModels = useMemo(() => {
    if (!settings) return null;
    const { agents, llmModels } = getConfiguredModels(settings, discoveredAgents);
    const models: Array<{ key: string; name: string; tag?: string; provider: string; model: string }> = [];
    for (const a of agents) {
      models.push({ key: `external:${a.id}`, name: a.model, tag: "Agent", provider: "external", model: a.id });
    }
    for (const m of llmModels) {
      models.push({ key: `${m.provider}:${m.model}`, name: m.model, tag: m.provider, provider: m.provider, model: m.model });
    }
    // Return actual configured models — may be empty if the user has not
    // configured any provider. The pill must point at *real* models, not the
    // demo defaults (sprinkles/vanilla).
    return models;
  }, [settings, discoveredAgents]);

  const sidebarSources = useMemo(() => {
    const sources: Array<{ key: string; name: string; desc: string; glyph?: string }> = [
      { key: "attach", name: "Add photos & files", desc: "Upload from your computer", glyph: "clip" },
    ];
    // tables first (up to 20 for menu brevity)
    for (const entry of rankedMentionCatalog.slice(0, 20)) {
      sources.push({
        key: `table:${entry.schema}.${entry.table}`,
        name: `${entry.schema}.${entry.table}`,
        desc: `${entry.columns.length} columns`,
        glyph: "table",
      });
    }
    // dashboards
    for (const d of dashboardMentionItems.slice(0, 10)) {
      sources.push({ key: `dash:${d.value}`, name: d.label, desc: `@${d.value}`, glyph: "layers" });
    }
    // generic helpers
    sources.push(
      { key: "web", name: "Web search", desc: "Real-time news and info", glyph: "globe" },
      { key: "cmd", name: "Commands", desc: "Type / to see commands", glyph: "command" },
    );
    return sources;
  }, [rankedMentionCatalog, dashboardMentionItems]);

  const sidebarCommands = useMemo(
    () => [
      { key: "explain", name: "/explain", desc: "Explain a query plan" },
      { key: "summarize", name: "/summarize", desc: "Summarize a table" },
      { key: "generate", name: "/generate", desc: "Generate SQL" },
      { key: "compare", name: "/compare", desc: "Compare schemas" },
    ],
    [],
  );

  const selectedModelKey = useMemo(() => {
    if (currentProvider && currentModel) {
      // external agents use "external:<id>" as key, llm models use "<provider>:<model>"
      const direct = `${currentProvider}:${currentModel}`;
      if (sidebarModels?.some((m) => m.key === direct)) return direct;
      // fallback for legacy stored values where currentModel already equals the key
      if (sidebarModels?.some((m) => m.key === currentModel)) return currentModel;
      return direct;
    }
    if (currentModel && sidebarModels?.some((m) => m.key === currentModel)) return currentModel;
    if (sidebarModels && sidebarModels[0]) return sidebarModels[0].key;
    return undefined;
  }, [currentProvider, currentModel, sidebarModels]);

  const handlePromptBarSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessage("");
      // If there's a pending tool-based approval, the typed text is the answer to that approval.
      // Submit it via the approval API and return — don't also send as a new user message,
      // otherwise the agent gets two turns and hangs waiting for the tool.
      if (pendingApproval) {
        try {
          const firstQ = pendingApproval.questions[0];
          if (firstQ) {
            const matched = firstQ.options.find((opt) => trimmed.toLowerCase().includes(opt.toLowerCase()));
            const answers = matched
              ? [{ question: firstQ.q, type: firstQ.type, selected: [matched] }]
              : [{ question: firstQ.q, type: firstQ.type as string, selected: [], custom: trimmed }];
            await apiFetch("/api/agent/approval/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ toolCallId: pendingApproval.id, answers }),
            });
            setPendingApproval(null);
            return;
          }
        } catch {}
      }
      const provider = currentProvider || Object.keys(settings?.providers || {})[0] || "openai";
      const model = currentModel || "";
      await sendMessage(trimmed, provider, model);
    },
    [currentProvider, currentModel, sendMessage, settings, pendingApproval, setPendingApproval],
  );

  const handleApprovalSubmit = useCallback(
    async (answers: { question: string; type: string; selected: string[]; custom?: string }[]) => {
      const answered = answers.filter((a) => a.selected.length > 0 || (a.custom && a.custom.trim()));
      // Tool-based approval: resolve the pending tool and return — do NOT send a new user message,
      // otherwise the agent hangs waiting for the tool while also getting a new turn.
      if (pendingApproval) {
        const toSubmit = answered.length ? answered : [];
        try {
          await apiFetch("/api/agent/approval/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toolCallId: pendingApproval.id, answers: toSubmit }),
          });
        } catch {}
        setPendingApproval(null);
        return;
      }
      if (answered.length === 0) return;
      const formatted = answered
        .map((a) => {
          const parts = [...a.selected];
          if (a.custom?.trim()) parts.push(a.custom.trim());
          return `Q: ${a.question}\nA: ${parts.join(", ")}`;
        })
        .join("\n\n");
      const prompt = `Approval answers:\n${formatted}`;
      const provider = currentProvider || Object.keys(settings?.providers || {})[0] || "openai";
      const model = currentModel || "";
      await sendMessage(prompt, provider, model);
    },
    [currentProvider, currentModel, sendMessage, settings, pendingApproval, setPendingApproval],
  );

  const handlePromptBarModelChange = useCallback(
    (m: { key: string; provider: string; model: string }) => {
      setCurrentProvider(m.provider);
      setCurrentModel(m.model);
    },
    [],
  );

  // Auto-select the first *actual* model once settings load — so the pill
  // reflects the user's real configuration instead of the demo defaults.
  useEffect(() => {
    if (!settings) return;
    if (currentProvider || currentModel) return;
    if (!sidebarModels || sidebarModels.length === 0) return;
    const first = sidebarModels[0];
    setCurrentProvider(first.provider);
    setCurrentModel(first.model);
  }, [settings, sidebarModels, currentProvider, currentModel]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setIsMentionMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (startNewChatToken === undefined) return;
    startNewChat();
  }, [isOpen, startNewChat, startNewChatToken]);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialPrompt?.trim()) return;
    setMessage(initialPrompt);
    setActiveMentionIndex(0);
    setIsMentionMenuOpen(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/.test(initialPrompt));
  }, [initialPrompt, isOpen, startNewChatToken]);

  useEffect(() => {
    if (isOpen) {
      void loadChats();
    }
  }, [isOpen, loadChats, connectionId]);

  useEffect(() => {
    if (!isOpen || !initialChatId) return;
    setActiveChatId(initialChatId);
  }, [isOpen, initialChatId, initialChatSelectToken, setActiveChatId]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    const nextMessage = message;
    setMessage("");
    const provider =
      currentProvider || Object.keys(settings?.providers || {})[0] || "openai";
    const model = currentModel || "";
    await sendMessage(nextMessage, provider, model);
  };

  const handleMentionSelect = (item: {
    value: string;
    label: string;
    kind: "table" | "dashboard";
  }) => {
    setMessage((current) =>
      current.replace(/@([a-zA-Z0-9_.-]*)$/, `@${item.value} `),
    );
    setActiveMentionIndex(0);
    setIsMentionMenuOpen(false);
  };

  const openPermissionDialog = () => {
    if (!settings) return;
    setPermissionDraft(settings.permissionMode);
    setIsPermissionDialogOpen(true);
  };

  const handleConfirmPermissions = async () => {
    if (!settings) return;
    await saveSettings({ ...settings, permissionMode: permissionDraft });
    setIsPermissionDialogOpen(false);
  };

  if (!isOpen) return null;

  const chatInner = (
    <>
      <TooltipProvider delayDuration={120}>
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden text-foreground",
            floating || embedded
              ? "bg-[var(--shell-content-bg)]"
              : "bg-background",
          )}
        >
          <div className="flex h-[44px] items-center justify-between border-b border-border px-4">
            <div className="flex items-center">
              <AiChatHistoryMenu
                activeChatId={activeChatId}
                chats={chats}
                onDelete={(chatId) => {
                  void (async () => {
                    try {
                      await removeChat(chatId);
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Failed to delete chat.",
                      );
                    }
                  })();
                }}
                onNewChat={startNewChat}
                onSelect={setActiveChatId}
              />
            </div>

            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={startNewChat}
                    size="icon"
                    variant="ghost"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
                  hideArrow
                  side="bottom"
                  sideOffset={6}
                >
                  New Chat
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => _onOpenSettings()}
                    size="icon"
                    variant="ghost"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
                  hideArrow
                  side="bottom"
                  sideOffset={6}
                >
                  AI Settings
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={openPermissionDialog}
                    size="icon"
                    variant="ghost"
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
                  hideArrow
                  side="bottom"
                  sideOffset={6}
                >
                  Permissions
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => onOpenChange(false)}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
                  hideArrow
                  side="bottom"
                  sideOffset={6}
                >
                  Close AI
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-44">
            <AiMessageList
              dashboardApplyLabel={dashboardApplyLabel}
              emptyIdeas={emptyIdeas}
              messages={messages}
              onApplyAppTheme={handleApplyTheme}
              onApplyEditorTheme={handleApplyTheme}
              onApplyDashboard={onApplyDashboard}
              onApplyWorkflow={onApplyWorkflow || (() => {})}
              onRunSql={onRunSql}
              onSelectIdea={(idea) => setMessage(idea)}
              onSendToSql={onSendToSql}
              userName={userName}
              workflowApplyBusy={workflowApplyBusy}
              onApprovalSubmit={handleApprovalSubmit}
            />
            {pendingApproval && (
              <div className="px-4 pt-2 pb-2">
                <div className="mx-auto max-w-2xl">
                  <ApprovalCard
                    questions={pendingApproval.questions}
                    onAnswersSubmit={(answers) => {
                      setPendingApproval(null);
                      void handleApprovalSubmit(answers);
                    }}
                  />
                </div>
              </div>
            )}
            {isSending && messages.length > 0 && (
              <div className="px-4 pt-2 pb-2">
                <div className="mx-auto max-w-2xl">
                  <AgentTrace steps={steps} active={isSending} />
                </div>
              </div>
            )}
            {isSending && messages.length === 0 && (
              <div className="px-4 pt-6">
                <div className="mx-auto max-w-2xl">
                  <AgentTrace steps={steps} active={isSending} />
                </div>
              </div>
            )}
            {!isSending && isLoading && messages.length === 0 && (
              <div className="px-4 pt-6">
                <div className="mx-auto max-w-2xl">
                  <LoadingState label="Generating" variant="Drive" active={isLoading} />
                </div>
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3">
            <div className="pointer-events-auto relative" ref={composerRef}>
              {/* Agent sidebar prompt bar — replaces legacy AiPromptInput + AiModelPicker.
                  Sidebar-shaped composer with @ sources, / commands, model picker, and sweep. */}
              <AgentSidebarPromptBar
                value={message}
                onChange={(v) => {
                  setMessage(v);
                  setActiveMentionIndex(0);
                  setIsMentionMenuOpen(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/.test(v));
                }}
                onSend={(text) => void handlePromptBarSend(text)}
                onStop={stopGeneration}
                isStreaming={isSending}
                placeholder="Write a message..."
                disabled={isLoading}
                sources={sidebarSources as any}
                commands={sidebarCommands}
                // Pill + actual models: always point at the user's real config,
                // not the demo "sprinkles/vanilla" fixtures.
                models={
                  sidebarModels
                    ? sidebarModels.map((m) => ({ key: m.key, name: m.name, tag: m.tag }))
                    : // settings still loading — show empty rather than demo defaults;
                      // the bar will update once sidebarModels resolves
                      []
                }
                selectedModelKey={selectedModelKey}
                onModelChange={(m) => {
                  const found = sidebarModels?.find((x) => x.key === m.key);
                  if (found) handlePromptBarModelChange(found);
                }}
                onAddModels={_onOpenSettings}
                validMentions={validMentions}
                variant="Pill"
                demo={false}
                tall={false}
              />
            </div>
          </div>
        </div>
      </TooltipProvider>

      <AiPermissionDialog
        isOpen={isPermissionDialogOpen}
        onClose={() => setIsPermissionDialogOpen(false)}
        onConfirm={() => void handleConfirmPermissions()}
        onSelect={setPermissionDraft}
        permissionMode={permissionDraft}
      />
    </>
  );

  if (embedded) {
    return <>{chatInner}</>;
  }

  if (floating) {
    return createPortal(
      <div
        className="fixed left-12 top-10 bottom-8 z-50 flex flex-col overflow-hidden rounded-lg border border-border text-foreground"
        style={{ width, background: "var(--shell-content-bg)" }}
      >
        <div
          className="group/resize absolute left-full top-0 bottom-0 z-[60] flex w-[6px] cursor-col-resize items-center justify-center bg-transparent touch-none select-none"
          onMouseDown={handleResizeStart}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-transparent transition-colors duration-100 group-hover/resize:bg-foreground/30 group-active/resize:bg-foreground/45"
          />
          <div
            className="pointer-events-none relative z-[1] flex flex-col items-center gap-[3px] opacity-45 transition-opacity duration-100 group-hover/resize:opacity-0"
            aria-hidden
          >
            <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
            <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
            <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
          </div>
        </div>
        {chatInner}
      </div>,
      document.body,
    );
  }

  return (
    <aside
      className={cn(
        "relative h-full shrink-0 border-l bg-background text-foreground shadow-xl transition-all",
        "border-border/60",
        sleek &&
          "rounded-lg border border-studio-border/80 overflow-hidden shadow-sm",
      )}
      style={{ width }}
    >
      {chatInner}
    </aside>
  );
}
