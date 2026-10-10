"use client";

import * as React from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type Item = { id: string; label: string; content: React.ReactNode };

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

export function ToolbarLayout({ items, connectionString, leadingContent }: { items: Item[]; connectionString?: string; leadingContent?: React.ReactNode }) {
  const key = React.useMemo(() => storageKey(connectionString), [connectionString]);
  const [hidden, setHidden] = React.useState<string[]>([]);
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
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex min-w-0 max-w-full grow flex-wrap items-center gap-2"
        >
          {leadingContent}

          {items.filter((item) => !hidden.includes(item.id)).map((item) => <React.Fragment key={item.id}>{item.content}</React.Fragment>)}
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
