"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import {
  formatShortcutForPlatform,
  getKeybindingCombo,
  type Keybinding,
} from "@/lib/studio/keybindings";
import { cn } from "@/lib/utils";
import {
  LayoutActivityBarIcon,
  LayoutCustomizeIcon,
  LayoutEyeIcon,
  LayoutPanelIcon,
  LayoutSidebarLeftIcon,
  LayoutSidebarRightIcon,
  LayoutStatusBarIcon,
} from "@/components/app-shell/vscode-layout-icons";

type KeybindingsMap = Record<string, Keybinding>;

interface LayoutRowProps {
  icon: ReactNode;
  label: string;
  shortcut?: string | null;
  open: boolean;
  onToggle: () => void;
  /** Row is informational only (its target element is not implemented yet). */
  disabled?: boolean;
}

function LayoutRow({
  icon,
  label,
  shortcut,
  open,
  onToggle,
  disabled,
}: LayoutRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--shell-content-bg)]",
        disabled && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate text-sm">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {shortcut ? (
          <Kbd>{formatShortcutForPlatform(shortcut)}</Kbd>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
            no shortcut
          </span>
        )}
        <button
          type="button"
          aria-pressed={open}
          aria-label={open ? `Hide ${label}` : `Show ${label}`}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors",
            open
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <LayoutEyeIcon className="size-4" closed={!open} />
        </button>
      </div>
    </div>
  );
}

/**
 * VS Code-style "Customize Layout" dropdown. Non-modal (modal={false}): it
 * opens below the header button with no backdrop, no blur, and the rest of
 * the app stays fully interactive — exactly like VS Code's layout menu.
 */
export function CustomizeLayoutPopover({
  keybindings,
  activityBarOpen,
  onToggleActivityBar,
  sidebarOpen,
  onToggleSidebar,
  secondarySidebarOpen,
  onToggleSecondarySidebar,
  panelOpen,
  onTogglePanel,
  statusBarOpen,
  onToggleStatusBar,
}: {
  keybindings?: KeybindingsMap;
  activityBarOpen?: boolean;
  onToggleActivityBar?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  secondarySidebarOpen?: boolean;
  onToggleSecondarySidebar?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  statusBarOpen?: boolean;
  onToggleStatusBar?: () => void;
}) {
  const combo = (type: string) =>
    keybindings ? getKeybindingCombo(keybindings, type) : null;

  return (
    <Popover modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label="Customize layout"
              className="size-6 rounded text-muted-foreground transition-colors hover:bg-[var(--shell-content-bg)] hover:text-foreground [&_svg]:size-3.5"
              size="icon-sm"
              variant="ghost"
            >
              <LayoutCustomizeIcon className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Customize Layout</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-80 p-1.5"
      >
        <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          Customize Layout
        </div>
        <div className="space-y-0.5">
          <LayoutRow
            icon={<LayoutActivityBarIcon className="size-4" />}
            label="Activity Bar"
            shortcut={combo("TOGGLE_ACTIVITY_BAR")}
            open={activityBarOpen ?? false}
            onToggle={onToggleActivityBar ?? (() => {})}
          />
          <LayoutRow
            icon={<LayoutSidebarLeftIcon className="size-4" active={sidebarOpen} />}
            label="Primary Side Bar"
            shortcut={combo("TOGGLE_SIDEBAR")}
            open={sidebarOpen ?? false}
            onToggle={onToggleSidebar ?? (() => {})}
          />
          <LayoutRow
            icon={
              <LayoutSidebarRightIcon className="size-4" active={secondarySidebarOpen} />
            }
            label="Secondary Side Bar"
            shortcut={combo("TOGGLE_AI_PANEL")}
            open={secondarySidebarOpen ?? false}
            onToggle={onToggleSecondarySidebar ?? (() => {})}
          />
          <LayoutRow
            icon={<LayoutPanelIcon className="size-4" active={panelOpen} />}
            label="Panel"
            shortcut={combo("TOGGLE_BOTTOM_PANEL")}
            open={panelOpen ?? false}
            onToggle={onTogglePanel ?? (() => {})}
          />
          <LayoutRow
            icon={<LayoutStatusBarIcon className="size-4" />}
            label="Status Bar"
            shortcut={combo("TOGGLE_STATUS_BAR")}
            open={statusBarOpen ?? false}
            onToggle={onToggleStatusBar ?? (() => {})}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
