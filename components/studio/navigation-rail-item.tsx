"use client";

import type { ReactNode, DragEvent } from "react";

import { cn } from "@/lib/utils";

import { StudioTooltip } from "./studio-tooltip";

export function NavigationRailItem({
  label,
  icon,
  onClick,
  active = false,
  expanded = false,
  draggable = false,
  onDragStart,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  expanded?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
}) {
  return (
    <StudioTooltip label={label} side="right">
      <button
        onClick={onClick}
        draggable={draggable}
        onDragStart={onDragStart}
        className={cn(
          "relative h-9 w-full overflow-visible text-muted-foreground transition-colors duration-200",
          active ? "text-neutral-300" : "hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-lg border transition-[background-color,border-color,color] duration-200",
            active
              ? "border-neutral-500/20 bg-neutral-500/10 text-neutral-300"
              : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/20 hover:text-foreground",
          )}
        >
          <span className="flex h-5 w-5 items-center justify-center">
            {icon}
          </span>
        </span>
        <span
          className={cn(
            "absolute left-11 top-1/2 min-w-max -translate-y-1/2 text-left text-xs font-medium whitespace-nowrap transition-opacity duration-150",
            expanded ? "opacity-100" : "opacity-0",
          )}
        >
          {label}
        </span>
      </button>
    </StudioTooltip>
  );
}
