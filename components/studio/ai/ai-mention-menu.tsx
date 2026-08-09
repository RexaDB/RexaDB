"use client";

import { useEffect, useRef } from "react";

export function AiMentionMenu({
  items,
  activeIndex,
  onSelect,
}: {
  items: Array<{ value: string; label: string; kind: "table" | "dashboard" }>;
  activeIndex: number;
  onSelect: (item: {
    value: string;
    label: string;
    kind: "table" | "dashboard";
  }) => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <div className="mb-1 px-2 text-xstracking-wide text-muted-foreground">
        Reference table or dashboard
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {items.map((item, index) => (
          <button
            key={item.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-xs transition-colors ${
              index === activeIndex
                ? "bg-muted text-foreground"
                : "text-foreground hover:bg-muted"
            }`}
            onClick={() => onSelect(item)}
            type="button"
          >
            <div className="min-w-0">
              <div className="truncate">{item.label}</div>
              <div className="truncate text-xs text-muted-foreground">
                @{item.value}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
