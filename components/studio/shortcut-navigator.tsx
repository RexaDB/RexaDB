"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Command,
  Keyboard,
  Search,
  Settings2,
} from "@/lib/icon-theme/lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  KEYBINDING_ACTIONS,
  describeBinding,
  formatShortcutForPlatform,
} from "@/lib/studio/keybindings";

interface ShortcutNavigatorProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  keybindings: Record<string, ShortcutBinding>;
  onRunBinding: (binding: ShortcutBinding) => void;
  onOpenKeybindings: () => void;
  onOpenCommandMenu: () => void;
}

interface ShortcutBinding {
  type: string;
  [key: string]: unknown;
}

interface ShortcutItem {
  id: string;
  label: string;
  description: string;
  combo?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  action: () => void;
}

export function ShortcutNavigator({
  isOpen,
  onOpenChange,
  keybindings,
  onRunBinding,
  onOpenKeybindings,
  onOpenCommandMenu,
}: ShortcutNavigatorProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo<ShortcutItem[]>(() => {
    const actionMap = new Map(
      KEYBINDING_ACTIONS.map((action) => [action.id, action.name]),
    );

    const dynamicItems = Object.entries(keybindings ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([combo, binding]) => {
        const formattedCombo = formatShortcutForPlatform(combo);
        return {
          id: `binding-${combo}`,
          label: actionMap.get(binding.type) || binding.type,
          description: describeBinding(binding, "Run shortcut action"),
          combo: formattedCombo,
          icon: Keyboard,
          keywords: [
            formattedCombo,
            binding.type,
            describeBinding(binding, "Run shortcut action"),
          ],
          action: () => onRunBinding(binding),
        };
      });

    const staticItems: ShortcutItem[] = [
      {
        id: "open-keybindings",
        label: "Open Keybindings",
        description: "Manage and edit shortcut configuration",
        icon: Settings2,
        keywords: ["settings", "keybindings", "shortcuts"],
        action: onOpenKeybindings,
      },
      {
        id: "open-command-menu",
        label: "Open Command Menu",
        description: "Switch to the full command palette",
        combo: formatShortcutForPlatform("Cmd+K"),
        icon: Command,
        keywords: ["command", "palette", "menu"],
        action: onOpenCommandMenu,
      },
    ];

    return [...dynamicItems, ...staticItems];
  }, [keybindings, onOpenCommandMenu, onOpenKeybindings, onRunBinding]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;

    return items.filter((item) => {
      if (item.label.toLowerCase().includes(normalized)) return true;
      if (item.description.toLowerCase().includes(normalized)) return true;
      return item.keywords.some((keyword) =>
        keyword.toLowerCase().includes(normalized),
      );
    });
  }, [items, query]);

  const clampedSelectedIndex =
    filteredItems.length === 0
      ? 0
      : Math.min(selectedIndex, filteredItems.length - 1);

  useEffect(() => {
    if (!isOpen) return;
    const el = document.querySelector<HTMLElement>(
      `[data-shortcut-index=\"${clampedSelectedIndex}\"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedSelectedIndex, isOpen, filteredItems]);

  const execute = (item: ShortcutItem) => {
    item.action();
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
    }
    onOpenChange(open);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredItems.length === 0) return;
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredItems.length === 0) return;
      setSelectedIndex(
        (prev) => (prev - 1 + filteredItems.length) % filteredItems.length,
      );
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const item = filteredItems[clampedSelectedIndex];
      if (!item) return;
      execute(item);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="max-w-xl gap-0 overflow-hidden p-0 border-studio-border bg-studio-bg data-[state=open]:animate-cmd-enter data-[state=closed]:animate-cmd-exit"
      >
        <DialogTitle className="sr-only">Shortcut Navigator</DialogTitle>
        <DialogDescription className="sr-only">
          Search and run keyboard shortcuts and related commands.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-studio-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search shortcuts, actions, and key combos..."
            className="h-8 border-none bg-transparent p-0 pl-1 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[56vh] overflow-y-auto px-2 py-2">
          {filteredItems.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No matching shortcuts.
            </div>
          ) : (
            <div className="space-y-1">
              {filteredItems.map((item, index) => {
                const Icon = item.icon;
                const isSelected = index === clampedSelectedIndex;

                return (
                  <button
                    key={item.id}
                    data-shortcut-index={index}
                    onClick={() => execute(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors animate-cmd-item-enter ${
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/60"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-studio-border bg-background/60">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {item.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </span>

                    <span className="flex items-center gap-2 pl-3">
                      {item.combo ? (
                        <Kbd className="text-xs">{item.combo}</Kbd>
                      ) : null}
                      {isSelected ? (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-studio-border px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Kbd className="text-xs">↑</Kbd>
            <Kbd className="text-xs">↓</Kbd>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd className="text-xs">Enter</Kbd>
            <span>Run</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
