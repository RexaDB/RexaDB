"use client";

import {
  Cloud,
  CloudOff,
  Loader2,
  Check,
  AlertCircle,
} from "@/lib/icon-theme/lucide-react";
import { DatabaseIcon } from "@/lib/icon-theme/solar-icons";
import { Clock, MessagesSquare, Sparkles, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsSyncStatus } from "@/hooks/use-settings-sync-status";

/**
 * VS Code-style status bar for the Modern UI — the real footer of the window.
 * Uses the outer shell background so the footer blends under the rail/sidebar
 * chrome. Left: connection, database, settings sync. Right: Ask AI / agents /
 * history, schema cache, and AI threads. Hidden by the "Status Bar" toggle in
 * Customize Layout.
 */
export function ModernStatusBar({
  studio,
  isAskAIOpen,
  onAskAI,
  onAgentsClick,
  onQueryHistory,
  threadsOpen,
  onToggleThreads,
}: {
  studio: any;
  isAskAIOpen?: boolean;
  onAskAI?: () => void;
  onAgentsClick?: () => void;
  onQueryHistory?: () => void;
  threadsOpen?: boolean;
  onToggleThreads?: () => void;
}) {
  const connectionName = studio.connection?.name || "No connection";
  const currentDatabase = studio.currentDatabase || "";
  const syncingSchema = Boolean(studio.fetchingSchemas);
  const {
    status: settingsSyncStatus,
    lastSyncedAt,
    error: settingsSyncError,
    enabled: settingsSyncEnabled,
    syncNow,
  } = useSettingsSyncStatus();

  const itemClass =
    "flex min-h-6 items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground";
  const buttonClass = cn(itemClass, "cursor-pointer");

  const settingsSyncLabel = !settingsSyncEnabled
    ? "Settings not synced"
    : settingsSyncStatus === "syncing"
      ? "Syncing settings…"
      : settingsSyncStatus === "error"
        ? "Settings sync failed"
        : settingsSyncStatus === "synced"
          ? "Settings synced"
          : "Settings sync ready";

  const settingsSyncTitle = !settingsSyncEnabled
    ? "Settings stay on this device. Upgrade or sign in on a paid plan to sync."
    : settingsSyncStatus === "error"
      ? settingsSyncError || "Settings sync failed. Click to retry."
      : lastSyncedAt
        ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}. Click to sync now.`
        : "Click to sync settings now.";

  const handleSettingsSyncClick = () => {
    if (settingsSyncEnabled) {
      syncNow();
      return;
    }
    if (typeof studio.openProfileSettingsTab === "function") {
      studio.openProfileSettingsTab();
      return;
    }
    studio.openSettingsTab?.("general");
  };

  return (
    <footer className="relative z-30 flex min-h-8 shrink-0 select-none items-center gap-1 bg-[var(--sidebar)] px-3 py-1">
      <button
        type="button"
        onClick={() => studio.openSettingsTab?.("general")}
        className={buttonClass}
        title={connectionName}
      >
        <span className="max-w-[150px] truncate">{connectionName}</span>
      </button>
      <span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
      <button
        type="button"
        onClick={() => studio.setSidebarView?.("database")}
        className={buttonClass}
        title={`Current database: ${currentDatabase}`}
      >
        <DatabaseIcon className="size-3 shrink-0" />
        <span className="max-w-[140px] truncate">
          {currentDatabase || "Database"}
        </span>
      </button>
      <span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
      <button
        type="button"
        onClick={handleSettingsSyncClick}
        className={cn(
          buttonClass,
          settingsSyncStatus === "error" && "text-destructive hover:text-destructive",
        )}
        title={settingsSyncTitle}
      >
        {!settingsSyncEnabled ? (
          <CloudOff className="size-3 shrink-0" />
        ) : settingsSyncStatus === "syncing" ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : settingsSyncStatus === "error" ? (
          <AlertCircle className="size-3 shrink-0" />
        ) : settingsSyncStatus === "synced" ? (
          <Cloud className="size-3 shrink-0" />
        ) : (
          <Cloud className="size-3 shrink-0 opacity-70" />
        )}
        <span className="truncate">{settingsSyncLabel}</span>
      </button>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {onAskAI && (
          <button
            type="button"
            onClick={onAskAI}
            className={cn(buttonClass, isAskAIOpen && "bg-white/8 text-foreground")}
            title="Ask AI"
          >
            <Sparkles className="size-3 shrink-0" />
            Ask AI
          </button>
        )}
        {onAgentsClick && (
          <button
            type="button"
            onClick={onAgentsClick}
            className={buttonClass}
            title="Agents"
          >
            <Bot className="size-3 shrink-0" />
            Agents
          </button>
        )}
        {onQueryHistory && (
          <button
            type="button"
            onClick={onQueryHistory}
            className={buttonClass}
            title="Query history"
          >
            <Clock className="size-3 shrink-0" />
          </button>
        )}
        <div className={itemClass} title="Schema cache">
          {syncingSchema ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <Check className="size-3 shrink-0" />
          )}
          <span className="truncate">
            {syncingSchema ? "Schema cache syncing…" : "Schema cache ready"}
          </span>
        </div>
        {onToggleThreads && (
          <button
            type="button"
            onClick={onToggleThreads}
            className={cn(buttonClass, threadsOpen && "bg-white/8 text-foreground")}
            title="AI threads"
          >
            <MessagesSquare className="size-3 shrink-0" />
            Threads
          </button>
        )}
      </div>
    </footer>
  );
}
