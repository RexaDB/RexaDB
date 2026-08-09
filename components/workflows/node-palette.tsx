"use client";

import { useState, useMemo, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import {
  NODE_REGISTRY,
  NODE_CATEGORIES,
  getDefaultConfig,
  getNodeIcon,
  type NodeDef,
} from "@/lib/workflows/node-registry";
import { Search, X } from "lucide-react";
import { hexAlpha } from "@/lib/studio/themes/color-utils";

type Props = {
  onSelect: (type: string, name: string, config: Record<string, unknown>) => void;
  onClose: () => void;
};

const CATEGORY_ORDER = [
  "trigger",
  "database",
  "data",
  "code",
  "http",
  "file",
  "flow",
  "notify",
  "ai",
  "transform",
  "utility",
];

const IMPLEMENTED_NODES = NODE_REGISTRY.filter((n) => n.implemented);

function iconSurfaceStyle(color: string): CSSProperties {
  return {
    background: `linear-gradient(145deg, ${color} 0%, ${hexAlpha(color, 0.72)} 100%)`,
  };
}

export function NodePalette({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return IMPLEMENTED_NODES.filter(
      (n) =>
        !q ||
        n.name.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.type.includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, NodeDef[]>();
    for (const n of filtered) {
      if (!map.has(n.category)) map.set(n.category, []);
      map.get(n.category)!.push(n);
    }
    return map;
  }, [filtered]);

  function handleSelect(def: NodeDef) {
    onSelect(def.type, def.name, getDefaultConfig(def.type));
    onClose();
  }

  return (
    <div className="relative flex h-[480px] w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${IMPLEMENTED_NODES.length} node types...`}
            className="h-8 border-border bg-muted/30 pl-9 pr-3 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Node list — one per row */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {grouped.size === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No nodes match your search
          </div>
        ) : (
          CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
            const catDef = NODE_CATEGORIES.find((c) => c.id === cat);
            const nodes = grouped.get(cat) || [];
            return (
              <div key={cat} className="mb-3 last:mb-0">
                <div className="mb-1.5 flex items-center gap-1.5 px-1">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: catDef?.color }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {catDef?.label}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {nodes.map((def) => {
                    const Icon = getNodeIcon(def.icon);
                    return (
                      <button
                        key={def.type}
                        type="button"
                        onClick={() => handleSelect(def)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border/80 bg-card px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/40"
                      >
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-md border text-white shadow-sm"
                          style={{
                            ...iconSurfaceStyle(def.color),
                            borderColor: hexAlpha(def.color, 0.55),
                          }}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium leading-tight text-foreground">
                            {def.name}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {def.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        {IMPLEMENTED_NODES.length} node types
      </div>
    </div>
  );
}
