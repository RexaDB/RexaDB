"use client";

import { Search } from "@/lib/icon-theme/lucide-react";
import {
  formatShortcutForPlatform,
  getKeybindingCombo,
  type Keybinding,
} from "@/lib/studio/keybindings";

/**
 * VS Code-style search bar for the center of the Modern UI header. Looks like
 * an input; clicking it opens the universal search.
 */
export function ModernUISearchBar({
  onOpen,
  keybindings,
}: {
  onOpen?: () => void;
  /** User keybindings so the kbd chip shows the real search shortcut. */
  keybindings?: Record<string, Keybinding>;
}) {
  // Command palette (Cmd+K by default), not universal table search.
  const combo =
    (keybindings && getKeybindingCombo(keybindings, "TOGGLE_COMMAND_MENU")) ||
    "Cmd+K";
  const shortcut = formatShortcutForPlatform(combo);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-6 w-64 select-none items-center gap-1.5 rounded-sm border border-border/70 bg-sidebar px-2.5 text-[11px] leading-none text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <Search className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left select-none">Search</span>
      <kbd className="flex h-3.5 shrink-0 select-none items-center rounded border border-border bg-background/60 px-1 text-[10px] font-normal leading-none text-muted-foreground">
        {shortcut}
      </kbd>
    </button>
  );
}
