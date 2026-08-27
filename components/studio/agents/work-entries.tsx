"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Globe,
  Hammer,
  Search,
  SquarePen,
  Terminal,
  Wrench,
  X,
} from "@/lib/icon-theme/lucide-react";
import type { AgentWorkLogEntry } from "@/lib/agents/provider-types";
import { workEntryIconName, type WorkEntryIconName } from "@/lib/agents/work-log";
import { LiveActivityRow } from "./thinking-row";

export type { WorkEntryIconName };

/** Ported from t3code's WorkEntryIconSvg. */
export function WorkEntryIconSvg({ name, className }: { name: WorkEntryIconName; className: string }) {
  switch (name) {
    case "bot":
      return <Bot className={className} aria-hidden />;
    case "eye":
      return <Eye className={className} aria-hidden />;
    case "globe":
      return <Globe className={className} aria-hidden />;
    case "hammer":
      return <Hammer className={className} aria-hidden />;
    case "search":
      return <Search className={className} aria-hidden />;
    case "square-pen":
      return <SquarePen className={className} aria-hidden />;
    case "terminal":
      return <Terminal className={className} aria-hidden />;
    case "wrench":
      return <Wrench className={className} aria-hidden />;
    case "x":
      return <X className={className} aria-hidden />;
  }
  return null;
}

/**
 * Settled tool-call row — matches t3code's rendered DOM exactly:
 * size-5 icon box / size-3.5 icon (opacity-80), bold foreground tool title +
 * muted secondary detail at text-[12px] leading-5, right cluster of
 * expand-chevron + lifecycle status icon, gap-px, text-icon-muted.
 */
const PlainWorkEntryRow = memo(function PlainWorkEntryRow({ entry }: { entry: AgentWorkLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const failed = entry.status === "failed";
  const iconName = workEntryIconName(entry);
  const title = entry.title || entry.tool;
  const detailText =
    entry.detail?.trim() || entry.command?.trim() || "";
  // Every tool row is expandable — fall back to the raw payload
  const expandedBody = detailText || entry.raw?.trim() || null;
  const canExpand = expandedBody !== null;

  return (
    <div
      className={cn(
        "flex flex-col rounded-md px-0.5 py-0.5 transition-colors",
        canExpand &&
          "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
      )}
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-label={detailText ? `${title} - ${detailText}` : title}
      onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
      onKeyDown={
        canExpand
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
    >
      <div className="flex select-none items-center gap-1.5 transition-[opacity,translate] duration-200">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center",
            failed ? "text-destructive" : "text-icon-muted",
          )}
          role={failed ? "img" : undefined}
          aria-label={failed ? "Tool call failed" : undefined}
        >
          <WorkEntryIconSvg
            name={iconName}
            className="block size-3.5 shrink-0 stroke-[1.8] opacity-80"
          />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="flex min-w-0 w-full items-baseline gap-1.5 text-[12px] leading-5">
              <span className="min-w-0 shrink truncate font-medium text-foreground">{title}</span>
              {detailText ? (
                <span className="min-w-0 flex-1 truncate text-secondary-label">{detailText}</span>
              ) : null}
            </p>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-px",
              failed ? "text-destructive" : "text-icon-muted",
            )}
          >
            {canExpand ? (
              <span className="flex size-4 shrink-0 items-center justify-center">
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 opacity-70 transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            <span className="flex size-4 shrink-0 items-center justify-center">
              {entry.status !== "inProgress" ? (
                failed ? (
                  <X className="block size-3 shrink-0 stroke-current" aria-hidden />
                ) : (
                  <Check className="block size-3 shrink-0 stroke-current" aria-hidden />
                )
              ) : null}
            </span>
          </div>
        </div>
      </div>
      {canExpand && expanded ? (
        <div
          className="mt-1 ms-7 cursor-default border-s border-border/45 ps-3 pt-0.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <pre className="max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text">
            {expandedBody}
          </pre>
        </div>
      ) : null}
    </div>
  );
});

/** In-progress tool-call row — ported from t3code's LiveWorkEntryTimelineRow. */
export const LiveWorkEntryRow = memo(function LiveWorkEntryRow({ entry }: { entry: AgentWorkLogEntry }) {
  const failed = entry.status === "failed";
  const iconName = workEntryIconName(entry);
  return (
    <button
      type="button"
      className="group/live-work flex min-h-6 w-full max-w-full cursor-pointer items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      aria-label={failed ? `${entry.label}, tool call failed` : undefined}
    >
      <LiveActivityRow label={entry.label} iconName={iconName} failed={failed} />
    </button>
  );
});

/**
 * Turn work log — expanded-fold rendering: every tool row with its icon,
 * ending in the "⌃ Show fewer tool calls" control that collapses the whole
 * turn fold (matches t3code's current build).
 */
export const WorkGroupSection = memo(function WorkGroupSection({
  entries,
  onCollapse,
}: {
  entries: AgentWorkLogEntry[];
  onCollapse?: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <section
      className="-mx-1 space-y-0.5 px-1 py-0.5"
      aria-label={`${entries.length} tool call${entries.length === 1 ? "" : "s"}`}
    >
      <div className="space-y-px">
        {entries.map((entry) => (
          <PlainWorkEntryRow key={entry.id} entry={entry} />
        ))}
      </div>
      <button
        type="button"
        className="flex min-h-5 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] leading-5 transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        aria-expanded={true}
        onClick={() => onCollapse?.()}
      >
        <ChevronUp className="size-3.5 shrink-0 text-icon-muted opacity-70 transition-transform duration-200" />
        <span className="truncate font-medium text-foreground">Show fewer tool calls</span>
      </button>
    </section>
  );
});
