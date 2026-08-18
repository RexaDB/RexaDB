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
    isLoading,
    isSending,
    activeChatId,
    setActiveChatId,
    saveSettings,
    sendMessage,
    startNewChat,
    removeChat,
    loadChats,
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
  }, [isOpen, initialChatId, setActiveChatId]);

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
            />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3">
            <div className="pointer-events-auto relative" ref={composerRef}>
              <AiMentionMenu
                activeIndex={activeMentionIndex}
                items={mentionItems}
                onSelect={handleMentionSelect}
              />
              <div className="rounded-lg border border-border/80 bg-background px-2.5 py-2 shadow-lg">
                <AiPromptInput
                  disabled={isLoading || isSending}
                  onChange={(nextValue) => {
                    setMessage(nextValue);
                    setActiveMentionIndex(0);
                    setIsMentionMenuOpen(
                      /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.test(nextValue),
                    );
                  }}
                  onFocus={() => {
                    if (/(?:^|\s)@([a-zA-Z0-9_.-]*)$/.test(message)) {
                      setIsMentionMenuOpen(true);
                    }
                  }}
                  onBlur={(event) => {
                    if (
                      !composerRef.current?.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      setIsMentionMenuOpen(false);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (mentionItems.length > 0 && event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveMentionIndex(
                        (current) => (current + 1) % mentionItems.length,
                      );
                      return;
                    }
                    if (mentionItems.length > 0 && event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveMentionIndex(
                        (current) =>
                          (current - 1 + mentionItems.length) %
                          mentionItems.length,
                      );
                      return;
                    }
                    if (
                      mentionItems.length > 0 &&
                      (event.key === "Enter" || event.key === "Tab")
                    ) {
                      event.preventDefault();
                      handleMentionSelect(
                        mentionItems[activeMentionIndex] || mentionItems[0],
                      );
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder="Ask a question... (@ to mention)"
                  validMentions={validMentions}
                  value={message}
                />

                <div className="mt-2 flex items-center justify-between">
                  {settings ? (
                    <AiModelPicker
                      currentProvider={currentProvider}
                      currentModel={currentModel}
                      onAddModels={_onOpenSettings}
                      onSelectProvider={(provider, model) => {
                        setCurrentProvider(provider);
                        setCurrentModel(model);
                      }}
                      settings={settings}
                    />
                  ) : (
                    <div />
                  )}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="h-7 w-7 rounded-lg"
                        disabled={isLoading || isSending || !message.trim()}
                        onClick={() => void handleSendMessage()}
                        size="icon"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
                      hideArrow
                      side="top"
                      sideOffset={6}
                    >
                      Send
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
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
