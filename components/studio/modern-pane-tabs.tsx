"use client";

import type { MouseEvent } from "react";
import { Plus, X, Columns2 } from "@/lib/icon-theme/lucide-react";
import { STUDIO_TAB_ICONS } from "@/lib/studio/tab-registry";
import { cn } from "@/lib/utils";
import { StudioTooltip } from "./studio-tooltip";

/**
 * Modern pill-style per-pane tab bar used by the "Modern UI" layout when
 * split-view is enabled. Mirrors the AppHeader pill styling but is scoped to
 * a single pane's tabs (VS Code split-editor look).
 */
export type ModernPaneTabsProps = {
  tabs: any[];
  activeTabId: string | null;
  switchTab: (id: string) => void;
  closeTab: (e: MouseEvent, id: string) => void;
  openSqlEditor: () => void;
  isPaneActive?: boolean;
  onActivatePane?: () => void;
  onSplitPane?: () => void;
  onClosePane?: () => void;
  paneId?: string;
};

export function ModernPaneTabs({
  tabs,
  activeTabId,
  switchTab,
  closeTab,
  openSqlEditor,
  isPaneActive,
  onActivatePane,
  onSplitPane,
  onClosePane,
}: ModernPaneTabsProps) {
  const showSplitPaneButton = Boolean(onSplitPane && isPaneActive);
  const showClosePaneButton = Boolean(onClosePane && isPaneActive);

  return (
    <div
      // h-9 + p-1 matches tab height (h-7) so left/right inset equals top/bottom.
      className="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-border p-1"
      onMouseDown={onActivatePane}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const Icon = STUDIO_TAB_ICONS[tab.type] ?? STUDIO_TAB_ICONS["table"];
          return (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={cn(
                "group flex h-7 min-w-24 max-w-52 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors shrink-0 select-none",
                active
                  ? "bg-studio-tab-active text-foreground"
                  : "bg-black/5 dark:bg-white/[0.07] text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/[0.12]",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {tab.dirty && (
                <span className="size-1.5 shrink-0 rounded-full bg-foreground/70" />
              )}
              <span className="flex-1 truncate">{tab.name}</span>
              {!tab.pinned && (
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(e, tab.id);
                  }}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-white/10",
                    active
                      ? "opacity-70 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New tab"
          onClick={() => openSqlEditor()}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {(showSplitPaneButton || showClosePaneButton) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {showSplitPaneButton && (
            <StudioTooltip label="Split Pane">
              <button
                type="button"
                onClick={() => onSplitPane?.()}
                className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <Columns2 className="size-3.5" />
              </button>
            </StudioTooltip>
          )}
          {showClosePaneButton && (
            <StudioTooltip label="Close Pane">
              <button
                type="button"
                onClick={() => onClosePane?.()}
                className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </StudioTooltip>
          )}
        </div>
      )}
    </div>
  );
}
