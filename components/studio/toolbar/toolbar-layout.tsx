"use client";

import * as React from "react";
import { ChevronLeft, MoreHorizontal, Search } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

type Item = { id: string; label: string; content: React.ReactNode };

/** The search field's flex basis (16rem): the room actions must leave it. */
const SEARCH_MIN_WIDTH = 256;
/** The "more" button plus its gap, reserved when not every item fits. */
const MORE_BUTTON_WIDTH = 44;
const GAP = 8;

function storageKey(connection?: string) {
  let hash = 2166136261;
  for (const char of connection || "default") hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `rexadb:toolbar-layout:${(hash >>> 0).toString(36)}`;
}

function readHidden(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return Array.isArray(value.hidden) ? value.hidden : [];
  } catch { return []; }
}

/** How many leading items fit in `available` px, given each item's width. */
export function countFittingItems(widths: number[], available: number): number {
  const total = widths.reduce((sum, width, i) => sum + width + (i > 0 ? GAP : 0), 0);
  if (total <= available) return widths.length;
  let used = MORE_BUTTON_WIDTH;
  let count = 0;
  for (const width of widths) {
    const next = used + width + (count > 0 ? GAP : 0);
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
}

/**
 * Toolbar actions beside the search field. Collapsed (the default), only the
 * items that fit next to search show, followed by a "more" button. Expanded,
 * search hides and every action shows, led by a button back to search.
 * Overflowing items stay mounted (just hidden), so open panels keep state.
 */
export function ToolbarLayout({
  items,
  connectionString,
  leadingContent,
  expanded,
  onExpandedChange,
}: {
  items: Item[];
  connectionString?: string;
  leadingContent?: React.ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const key = React.useMemo(() => storageKey(connectionString), [connectionString]);
  const [hidden, setHidden] = React.useState<string[]>([]);
  const [visibleCount, setVisibleCount] = React.useState(Number.POSITIVE_INFINITY);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const leadRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>());
  // Last known width per item; hidden items keep the width they had shown.
  const widths = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    setHidden(readHidden(key));
    const sync = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setHidden(readHidden(key));
    };
    window.addEventListener("rexadb-toolbar-layout-updated", sync);
    return () => window.removeEventListener("rexadb-toolbar-layout-updated", sync);
  }, [key]);

  const update = (id: string, visible: boolean) => {
    const next = visible ? hidden.filter((item) => item !== id) : [...hidden, id];
    setHidden(next);
    try { localStorage.setItem(key, JSON.stringify({ hidden: next })); } catch { /* Storage may be unavailable. */ }
    window.dispatchEvent(new CustomEvent("rexadb-toolbar-layout-updated", { detail: key }));
  };

  const visibleItems = items.filter((item) => !hidden.includes(item.id));
  const idsKey = visibleItems.map((item) => item.id).join("|");

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    // root → scope + actions group → search bar.
    const group = root?.parentElement;
    const bar = group?.parentElement;
    if (!root || !group || !bar) return;
    const ids = idsKey ? idsKey.split("|") : [];
    // The wrapper is display: contents; its child is the selection bar.
    const leadElement = () =>
      leadRef.current?.firstElementChild instanceof HTMLElement ? leadRef.current.firstElementChild : null;

    const measure = () => {
      for (const id of ids) {
        const element = itemRefs.current.get(id);
        if (element && element.offsetWidth > 0) widths.current.set(id, element.offsetWidth);
      }
      if (expanded) return;
      const scope = group.firstElementChild instanceof HTMLElement && group.firstElementChild !== root
        ? group.firstElementChild.offsetWidth + 4
        : 0;
      const leadWidth = leadElement()?.offsetWidth ?? 0;
      const lead = leadWidth ? leadWidth + GAP : 0;
      const available = bar.clientWidth - SEARCH_MIN_WIDTH - GAP - scope - lead;
      const next = countFittingItems(ids.map((id) => widths.current.get(id) ?? 0), available);
      setVisibleCount((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    const leadChild = leadElement();
    if (leadChild) observer.observe(leadChild);
    for (const element of itemRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [idsKey, expanded]);

  const overflowing = !expanded && visibleCount < visibleItems.length;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          className={cn(
            "flex min-w-0 max-w-full grow items-center gap-2",
            expanded ? "flex-wrap" : "flex-nowrap",
          )}
        >
          {expanded && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExpandedChange(false)}
              title="Back to search"
              aria-label="Back to search"
              className="shrink-0 gap-1 px-2 font-normal dark:border-white/15 dark:bg-white/[0.02]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <Search className="w-3.5 h-3.5" />
            </Button>
          )}

          <div ref={leadRef} className="contents">
            {leadingContent}
          </div>

          {visibleItems.map((item, index) => (
            <div
              key={item.id}
              ref={(element) => {
                if (element) itemRefs.current.set(item.id, element);
                else itemRefs.current.delete(item.id);
              }}
              className={cn(
                "flex shrink-0 items-center gap-2",
                !expanded && index >= visibleCount && "hidden",
              )}
            >
              {item.content}
            </div>
          ))}

          {overflowing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExpandedChange(true)}
              title="Show all actions"
              aria-label="Show all actions"
              className="shrink-0 px-2 font-normal dark:border-white/15 dark:bg-white/[0.02]"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item) => (
          <ContextMenuCheckboxItem key={item.id} checked={!hidden.includes(item.id)} onCheckedChange={(visible) => update(item.id, visible)}>
            {item.label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
