"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PanelLeft, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModernUISearchBar } from "@/components/app-shell/modern-ui-search";

/**
 * VS Code-style title bar for the Modern UI. Floats transparently over the top
 * of the window (no background, no layout space): search bar centered,
 * sidebar/panel toggles on the right.
 */
export function ModernUIHeader({
  height,
  onOpenSearch,
  sidebarOpen,
  onToggleSidebar,
  panelOpen,
  onTogglePanel,
}: {
  /** Height of the strip between the window top and the content container. */
  height?: number;
  onOpenSearch?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
}) {
  return (
    <header
      className="absolute inset-x-0 top-0 z-40 flex shrink-0 items-center justify-between gap-2 px-2"
      data-tauri-drag-region="deep"
      style={height !== undefined ? { height } : undefined}
    >
      <div className="w-4" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <ModernUISearchBar onOpen={onOpenSearch} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Toggle sidebar"
                className={cn(
                  "size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground",
                  sidebarOpen && "bg-[var(--shell-content-bg)] text-foreground",
                )}
                size="icon-sm"
                variant="ghost"
                onClick={onToggleSidebar}
              >
                <PanelLeft className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
          </Tooltip>
        )}
        {onTogglePanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Toggle panel"
                className={cn(
                  "size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground",
                  panelOpen && "bg-[var(--shell-content-bg)] text-foreground",
                )}
                size="icon-sm"
                variant="ghost"
                onClick={onTogglePanel}
              >
                <SquareTerminal className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle Panel</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
