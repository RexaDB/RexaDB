"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useStudioBootstrap } from "@/hooks/use-studio-bootstrap";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useTranslucentShell } from "@/hooks/use-translucent-shell";
import { useAgentHarness } from "@/hooks/use-agent-harness";
import { AgentsChatMessages } from "@/components/studio/agents/agents-chat-messages";
import { AgentsChatInput } from "@/components/studio/agents/agents-chat-input";
import { AgentsCommandMenu } from "@/components/studio/agents/agents-command-menu";
import { ModernVscodeHeader } from "@/components/app-shell/modern-vscode-header";
import { ModernStatusBar } from "@/components/app-shell/modern-status-bar";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InitialLoadingScreen } from "@/components/studio/initial-loading-screen";
import {
  FileText,
  Pencil,
  Plus,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DotmCircular12 } from "@/components/ui/dotm-circular-12";
import { ProviderLogo } from "@/components/shared/provider-logo";
import {
  RexaDBIcon,
  ClaudeIcon,
  OpenCodeIcon,
  OpenAIIcon,
  GrokIcon,
  CursorIcon,
  FxIcon,
  PiIcon,
} from "@/components/studio/agents/provider-icons";
import { fetchAllTablesWithColumns } from "@/lib/api/actions-client";
import type { LightSchemaContextTable } from "@/lib/ai/types";
import { groupSchemaRows } from "@/lib/ai/schema-grouping";
import { listAppModes } from "@/lib/agents/app-modes";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import type { Connection } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format-relative";

function normalizeSchemaRows(rows: any[]): LightSchemaContextTable[] {
  return groupSchemaRows(rows);
}

/* -------------------------------------------------------------------------- */
/*  Thread helpers — lightweight stored-agent-chat storage                     */
/* -------------------------------------------------------------------------- */

interface AgentThread {
  id: string;
  title: string;
  updatedAt: number;
  providerId?: string;
}

function threadKey(connectionId: number) {
  return `rexa-agent-threads-${connectionId}`;
}

function loadThreads(connectionId: number): AgentThread[] {
  try {
    const raw = localStorage.getItem(threadKey(connectionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveThreads(connectionId: number, threads: AgentThread[]) {
  localStorage.setItem(threadKey(connectionId), JSON.stringify(threads));
}

/* -------------------------------------------------------------------------- */
/*  Agents Window                                                              */
/* -------------------------------------------------------------------------- */

export default function AgentsClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawId = params?.id || searchParams?.get("id") || "";
  const numericId = Number(rawId);

  const { loading, connection } = useStudioBootstrap(
    Number.isInteger(numericId) && numericId > 0 ? numericId : null,
    null,
  );

  useGlobalAppTheme(false);
  useTranslucentShell(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-20250514");
  const [schemaContext, setSchemaContext] = useState<LightSchemaContextTable[]>([]);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  // Load threads on mount & when connection changes; restore most recent
  useEffect(() => {
    if (!connection?.id) return;
    const stored = loadThreads(connection.id);
    // Backfill providerId for old threads that predate the field
    const migrated = stored.map((t) => (t.providerId ? t : { ...t, providerId: "rexadb" }));
    if (migrated.length !== stored.length || migrated.some((t, i) => t.providerId !== stored[i]?.providerId)) {
      saveThreads(connection.id, migrated);
    }
    setThreads(migrated);
    if (migrated.length > 0) {
      const mostRecent = [...migrated].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setActiveThread(mostRecent.id);
    } else {
      setActiveThread(null);
    }
  }, [connection?.id]);

  // Cmd/Ctrl+K opens the command palette. The studio window gets this for
  // free from use-studio.ts's own keydown handler, but this window doesn't
  // use that hook, so it needs its own listener.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandMenuOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Restore provider when switching threads — so the sidebar shows which provider was used
  useEffect(() => {
    if (!activeThread) return;
    const thread = threads.find((t) => t.id === activeThread);
    if (thread?.providerId && thread.providerId !== harness.activeProvider) {
      harness.setActiveProvider(thread.providerId as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  // Fetch tables + columns + types for the agent system prompt
  useEffect(() => {
    const connectionString = connection?.connectionString || "";
    const dbType =
      connection?.connectionType ||
      (connectionString ? detectConnectionDbType(connectionString) : "");
    if (!connectionString || dbType === "redis") {
      setSchemaContext([]);
      setSchemaStatus("ready");
      return;
    }
    let cancelled = false;
    setSchemaContext([]);
    setSchemaStatus("loading");
    void (async () => {
      try {
        const result = await fetchAllTablesWithColumns(connectionString);
        if (cancelled) return;
        if (result.success && Array.isArray(result.data)) {
          setSchemaContext(normalizeSchemaRows(result.data));
          setSchemaStatus("ready");
        } else {
          setSchemaContext([]);
          setSchemaStatus("error");
        }
      } catch {
        if (!cancelled) {
          setSchemaContext([]);
          setSchemaStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection?.id, connection?.connectionString, connection?.connectionType]);

  const resolvedDbType =
    connection?.connectionType ||
    (connection?.connectionString
      ? detectConnectionDbType(connection.connectionString)
      : "postgresql");

  const harnessInput = connection
    ? {
        connectionId: connection.id,
        connectionString: connection.connectionString || "",
        connectionName: connection.name,
        dbType: resolvedDbType || "postgresql",
        schemaContext,
        threadId: activeThread,
      }
    : null;

  const harness = useAgentHarness(
    harnessInput ?? { connectionId: 0, connectionString: "", dbType: "" },
  );

  // `selectedModel` starts on a hardcoded placeholder that matches no real
  // model id (see its useState above). Once the active provider's real model
  // list loads (or the provider changes), replace it with that provider's
  // default/first model unless the current value is already a real model in
  // that list — otherwise the picker's trigger button just prints the raw
  // placeholder string verbatim, since it never matches any known model.
  useEffect(() => {
    const models = harness.providers.find((p) => p.id === harness.activeProvider)?.models;
    if (!models || models.length === 0) return;
    if (models.some((m) => m.id === selectedModel)) return;
    const fallback = models.find((m) => m.isDefault) ?? models[0];
    setSelectedModel(fallback.id);
  }, [harness.providers, harness.activeProvider, selectedModel]);

  /** Switch DB for this agents window only — does not navigate the main studio. */
  const handleSelectConnection = useCallback(
    async (conn: Connection) => {
      if (conn.id === connection?.id) return;
      harness.clearMessages();
      setActiveThread(null);
      router.replace(`/studio/${conn.id}/agents`);
    },
    [connection?.id, harness.clearMessages, router],
  );

  // Load the conversation whenever the selected thread changes.
  useEffect(() => {
    if (!connection?.id || !activeThread) return;
    if (harness.isStreaming) return;
    harness.loadThread(activeThread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id, activeThread, harness.isStreaming]);

  // Thread management — title comes from provider/session, fallback to "New session"
  const createThread = useCallback(() => {
    if (!connection?.id) return;
    const id = `thread-${Date.now()}`;
    const thread: AgentThread = {
      id,
      title: "New session",
      updatedAt: Date.now(),
      providerId: harness.activeProvider || "rexadb",
    };
    const next = [thread, ...threads];
    setThreads(next);
    saveThreads(connection.id, next);
    setActiveThread(id);
    // Avoid clobbering an in-flight reply: defer the empty load until the stream settles.
    if (!harness.isStreaming) {
      harness.loadThread(id);
    }
  }, [connection?.id, threads, harness]);

  const deleteThread = useCallback(
    (threadId: string) => {
      if (!connection?.id) return;
      const next = threads.filter((t) => t.id !== threadId);
      setThreads(next);
      saveThreads(connection.id, next);
      try {
        localStorage.removeItem(`rexa-agent-chat-${connection.id}:${threadId}`);
      } catch {}
      if (activeThread === threadId) {
        setActiveThread(null);
        harness.clearMessages();
      }
    },
    [connection?.id, threads, activeThread, harness],
  );

  const renameThread = useCallback(
    (threadId: string, title: string) => {
      if (!connection?.id) return;
      const next = threads.map((t) =>
        t.id === threadId ? { ...t, title: title.trim().slice(0, 80) || t.title, updatedAt: Date.now() } : t,
      );
      setThreads(next);
      saveThreads(connection.id, next);
    },
    [connection?.id, threads],
  );

  // Update thread title from first user message — t3-style keeps "New session - ..." until first real prompt
  const sendMessage = useCallback(
    async (content: string) => {
      if (!connection?.id) return;

      // Persist which provider was used for this session so the sidebar can show it on reload
      const currentProviderId = harness.activeProvider || "rexadb";

      // Auto-title thread from first message
      if (harness.messages.length === 0) {
        const threadId = activeThread || `thread-${Date.now()}`;
        if (!activeThread) {
          setActiveThread(threadId);
          const thread: AgentThread = {
            id: threadId,
            title: content.slice(0, 60),
            updatedAt: Date.now(),
            providerId: currentProviderId,
          };
          const next = [thread, ...threads];
          setThreads(next);
          saveThreads(connection.id, next);
          // Claim ownership of the new thread's storage before streaming so
          // the conversation is persisted under the right key (load would
          // otherwise be deferred while streaming and the save would be skipped).
          harness.loadThread(threadId);
        } else {
          const next = threads.map((t) =>
            t.id === activeThread
              ? { ...t, title: t.title.startsWith("New session") || t.title === "New Chat" ? content.slice(0, 60) : t.title, updatedAt: Date.now(), providerId: currentProviderId }
              : t,
          );
          setThreads(next);
          saveThreads(connection.id, next);
        }
      } else {
        // Even for existing threads, remember the last provider used
        const next = threads.map((t) =>
          t.id === activeThread ? { ...t, providerId: currentProviderId, updatedAt: Date.now() } : t,
        );
        // Only update if provider actually changed to avoid extra writes
        if (next !== threads && activeThread) {
          const changed = threads.find((t) => t.id === activeThread)?.providerId !== currentProviderId;
          if (changed) {
            setThreads(next);
            saveThreads(connection.id, next);
          }
        }
      }

      await harness.sendMessage(content);
    },
    [connection?.id, activeThread, threads, harness],
  );

  if (loading) return <InitialLoadingScreen />;
  if (!connection)
    return (
      <main className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Connection not found.
      </main>
    );

  return (
    <TooltipProvider>
      <div className="relative flex h-svh min-w-0 flex-col bg-sidebar">
        {/* ── Title Bar ───────────────────────────────────────────── */}
        <ModernVscodeHeader
          height={36}
          macTrafficLightInset={72}
          activityBarOpen={false}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onOpenSearch={() => setIsCommandMenuOpen(true)}
          canBack={false}
          canForward={false}
          connection={connection}
          onSelectConnection={handleSelectConnection}
        />

        {/* ── Main Row: Rail (hidden) + Sidebar + Content ─────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 bg-sidebar">
          <div className="relative h-full min-w-0 flex-1 overflow-visible">
            <SidebarProvider
              className="relative h-full !min-h-0 w-full min-w-0 overflow-visible [transform:translateZ(0)] [&_[data-slot=sidebar-gap]]:transition-none"
              style={
                {
                  "--sidebar-width": `${sidebarWidth}px`,
                  "--shell-sash-gap": "6px",
                } as React.CSSProperties
              }
              open={sidebarOpen}
              onOpenChange={setSidebarOpen}
            >
              {/* ── Sidebar: Threads ─────────────────────────────── */}
              <AppSidebar
                className="z-20 top-0 bottom-0 h-auto max-h-none overflow-visible pt-9 pb-0 pl-1.5 pr-[var(--shell-sash-gap,6px)] [&_[data-slot=sidebar-container]]:pr-[var(--shell-sash-gap,6px)] [&_[data-slot=sidebar-inner]]:relative [&_[data-slot=sidebar-inner]]:h-full [&_[data-slot=sidebar-inner]]:overflow-visible [&_[data-slot=sidebar-inner]]:bg-[var(--shell-content-bg)] [&_[data-slot=sidebar-inner]]:rounded-lg [&_[data-slot=sidebar-inner]]:border [&_[data-slot=sidebar-inner]]:border-border [&_[data-slot=sidebar-inner]]:p-1"
                style={{
                  transition: "none",
                  top: 0,
                  bottom: 0,
                  height: "auto",
                  maxHeight: "none",
                }}
                sidebarWidth={sidebarWidth}
                onSidebarWidthChange={setSidebarWidth}
                hideHeaderControls
                content={
                  <ThreadsSidebar
                    threads={threads}
                    activeThread={activeThread}
                    onSelectThread={setActiveThread}
                    onNewThread={createThread}
                    onDeleteThread={deleteThread}
                    onClearChat={harness.clearMessages}
                    connectionName={connection?.name}
                    connectionId={connection?.id}
                    dbType={resolvedDbType}
                    onRenameThread={renameThread}
                    isStreaming={harness.isStreaming}
                    streamingStartedAt={harness.streamingStartedAt}
                    activeProvider={harness.activeProvider}
                  />
                }
              />

              <SidebarInset className="relative z-0 h-full min-h-0 w-auto min-w-0 overflow-hidden bg-transparent md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-1 md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mb-0 md:peer-data-[variant=inset]:shadow-none">
                <div className="flex min-h-0 flex-1">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* ── Content Card ────────────────────────────── */}
                    <div
                      className="mt-9 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border"
                      style={
                        {
                          "--background": "var(--shell-content-bg)",
                          "--studio-bg": "var(--shell-content-bg)",
                          backgroundColor: "var(--shell-content-bg)",
                        } as React.CSSProperties
                      }
                    >
                      {/* Messages */}
                      <AgentsChatMessages
                        messages={harness.messages}
                        workLog={harness.workLog}
                        isStreaming={harness.isStreaming}
                        streamingStartedAt={harness.streamingStartedAt}
                        onRevert={harness.revertToMessage}
                        appMode={harness.appMode}
                      />

                      {/* Input */}
                      <AgentsChatInput
                        onSend={sendMessage}
                        isStreaming={harness.isStreaming}
                        onStop={harness.stopStreaming}
                        activeProvider={harness.activeProvider}
                        providers={harness.providers}
                        onSelectProvider={harness.setActiveProvider}
                        selectedModel={selectedModel}
                        onSelectModel={setSelectedModel}
                        selectedMode={harness.selectedMode}
                        onSelectMode={harness.setSelectedMode}
                        appModes={
                          connection ? listAppModes(connection.id) : []
                        }
                        selectedAppModeId={harness.appModeId}
                        onSelectAppMode={harness.setAppModeId}
                        appMode={harness.appMode}
                        isDetecting={harness.isDetecting}
                      />
                    </div>
                  </div>
                </div>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </div>

        {/* ── Status Bar ─────────────────────────────────────────── */}
        <ModernStatusBar studio={{ connection, currentDatabase: connection.name }} />
      </div>

      <AgentsCommandMenu
        isOpen={isCommandMenuOpen}
        onOpenChange={setIsCommandMenuOpen}
        threads={threads}
        activeThread={activeThread}
        onSelectThread={setActiveThread}
        onNewThread={createThread}
      />
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Threads Sidebar Content                                                    */
/* -------------------------------------------------------------------------- */

/* t3code-style helpers: compact relative time like Sidebar.tsx:204 */
function formatRelativeTimeLabelForThread(updatedAt: number): string {
  return formatRelativeTime(updatedAt, { dateStyle: "short" });
}

function formatWorkingDuration(startedAt: number | null): string {
  if (!startedAt) return "Working";
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (secs < 60) return `Working ${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `Working ${mins}m ${rem}s`;
}

function WorkingTimer({ startedAt }: { startedAt: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => tick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return <span>{formatWorkingDuration(startedAt)}</span>;
}

function ProviderIcon({ providerId, className }: { providerId?: string | null; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className);
  switch (providerId) {
    case "rexadb": return <RexaDBIcon className={cls} />;
    case "claude-code": return <ClaudeIcon className={cls} />;
    case "opencode": return <OpenCodeIcon className={cls} />;
    case "codex": return <OpenAIIcon className={cls} />;
    case "grok-build": return <GrokIcon className={cls} />;
    case "cursor": return <CursorIcon className={cls} />;
    case "fx": return <FxIcon className={cls} />;
    case "pi": return <PiIcon className={cls} />;
    default: return <RexaDBIcon className={cls} />;
  }
}

function getThreadPreview(connectionId: number, threadId: string): string | null {
  try {
    const raw = localStorage.getItem(`rexa-agent-chat-${connectionId}:${threadId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as { messages?: Array<{ role: string; content: string }> };
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    // Prefer last user message, else last message truncated
    for (let i = msgs.length - 1; i >= 0; i--) {
      const c = String(msgs[i]?.content || "").trim().replace(/\s+/g, " ");
      if (c) return c.length > 80 ? c.slice(0, 80) + "…" : c;
    }
    return null;
  } catch {
    return null;
  }
}

function ThreadsSidebar({
  threads,
  activeThread,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onClearChat,
  connectionName,
  connectionId,
  dbType,
  onRenameThread,
  isStreaming,
  streamingStartedAt,
  activeProvider,
}: {
  threads: AgentThread[];
  activeThread: string | null;
  onSelectThread: (id: string | null) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onClearChat: () => void;
  connectionName?: string;
  connectionId?: number;
  dbType?: string;
  onRenameThread?: (id: string, title: string) => void;
  isStreaming?: boolean;
  streamingStartedAt?: number | null;
  activeProvider?: string | null;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const startRename = (thread: AgentThread) => {
    setRenamingId(thread.id);
    setRenamingTitle(thread.title);
  };
  const commitRename = () => {
    if (!renamingId) return;
    const t = renamingTitle.trim();
    if (t && onRenameThread) onRenameThread(renamingId, t);
    setRenamingId(null);
  };
  const cancelRename = () => setRenamingId(null);

  const pendingDeleteThread = threads.find((t) => t.id === pendingDeleteId) || null;
  const confirmDelete = () => {
    if (pendingDeleteId) onDeleteThread(pendingDeleteId);
    setPendingDeleteId(null);
  };

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header — matches t3code SidebarChrome header density */}
      <div className="flex items-center justify-between px-2 py-2 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground px-1">Threads</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewThread}
            className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/5 transition-colors"
            title="New thread"
            aria-label="New thread"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Thread List — t3code card density: py-0.5 per item, content-visibility auto */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1">
        {threads.length === 0 && (
          <div className="px-2 py-12 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.06]">
              <FileText className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">No threads yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/50">
              Start a new thread to chat with the agent about this database.
            </p>
          </div>
        )}
        <ul className="space-y-0">
          {[...threads]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((thread) => {
            const isActive = activeThread === thread.id;
            const isRenaming = renamingId === thread.id;
            const timeLabel = formatRelativeTimeLabelForThread(thread.updatedAt);
            const preview =
              connectionId ? getThreadPreview(connectionId, thread.id) : null;

            // t3code: SidebarThreadRow rowSurface — group/sidebar-row + rounded-md + select-none
            // Active: bg-sidebar-row-active (maps to bg-white/8 in RexaDB chrome)
            // Hover: bg-sidebar-row-hover (bg-white/5), receded opacity when not active
            const rowSurface = cn(
              "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none border border-transparent",
              isActive
                ? "bg-white/[0.08] text-foreground border-white/[0.06]"
                : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground hover:border-white/[0.04]",
            );

            return (
              <li
                key={thread.id}
                data-thread-item
                className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_56px]"
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={isActive ? "sidebar-row-card-active" : "sidebar-row-card"}
                  className={rowSurface}
                  onClick={() => {
                    if (isRenaming) return;
                    onSelectThread(thread.id);
                  }}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a, input")) return;
                    startRename(thread);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectThread(thread.id);
                    }
                  }}
                >
                  <div className="relative z-10 px-2.5 py-2">
                    {/* Top row — favicon + project + time/status (t3code: h-5 flex) */}
                    <div className="flex h-5 min-w-0 items-center gap-1.5">
                      <ProviderLogo type={dbType} className="size-3 rounded-[2px] shadow-sm" />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          isActive ? "font-medium text-foreground/80" : "font-normal text-muted-foreground/70",
                        )}
                        title={connectionName}
                      >
                        {connectionName || "Database"}
                      </span>

                      {/* Status slot — t3code SidebarThreadRow status/actions cross-fade — t3 shows Working + spinner top-right when streaming */}
                      <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                        {isActive && isStreaming ? (
                          <span className="flex items-center gap-1.5 text-sky-500 dark:text-sky-400">
                            <DotmCircular12 size={14} dotSize={2} speed={1.7} className="text-sky-500" />
                            <WorkingTimer startedAt={streamingStartedAt ?? null} />
                          </span>
                        ) : (
                          <>
                            <span
                              className={cn(
                                "flex items-center tabular-nums transition-opacity group-hover/sidebar-row:opacity-0",
                                isActive ? "text-muted-foreground" : "text-muted-foreground/60",
                              )}
                            >
                              {timeLabel}
                            </span>
                            <span
                              className={cn(
                                "pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity",
                                "group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100",
                              )}
                            >
                              <button
                                type="button"
                                aria-label="Rename thread"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  startRename(thread);
                                }}
                                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-white/10 hover:text-foreground transition-colors"
                                title="Rename"
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete thread"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setPendingDeleteId(thread.id);
                                }}
                                className="-mr-1.5 inline-flex size-6 items-center justify-center rounded-md text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Single row — preview with same style as former title (session title removed) */}
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renamingTitle}
                          aria-label="Thread title"
                          onChange={(e) => setRenamingTitle(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="min-w-0 flex-1 rounded-sm border border-white/10 bg-black/20 px-1 py-0 text-sm font-medium text-foreground outline-none focus:border-white/20"
                          placeholder="Thread title"
                        />
                      ) : (
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm transition-colors",
                            isActive
                              ? "font-medium text-foreground"
                              : "font-normal text-foreground/90 group-hover/sidebar-row:text-foreground",
                          )}
                          title={preview || thread.title}
                        >
                          {preview || "master"}
                        </span>
                      )}
                      <ProviderIcon providerId={thread.providerId || (isActive ? activeProvider : undefined) || "rexadb"} className="size-3.5 shrink-0" />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer: New Chat — subtle, like t3code settle/snooze shelf */}
      <div className="shrink-0 px-2 py-2 border-t border-white/[0.06]">
        <button
          onClick={() => {
            onSelectThread(null);
            onClearChat();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-muted-foreground hover:bg-white/[0.05] hover:text-foreground transition-colors border border-dashed border-white/10 hover:border-white/15"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete thread?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteThread
                ? `"${pendingDeleteThread.title}" and its conversation will be permanently removed. This cannot be undone.`
                : "This thread and its conversation will be permanently removed. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="none"
              className="bg-destructive/90 hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
