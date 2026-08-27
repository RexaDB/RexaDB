"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "@/lib/icon-theme/lucide-react";
import { WorkEntryIconSvg, type WorkEntryIconName } from "./work-entries";

/** Ported from t3code's LiveActivityRow: base copy + counter-animated masked highlight sweep. */
export function LiveActivityRow({
  label,
  iconName,
  failed = false,
}: {
  label: string;
  iconName?: WorkEntryIconName;
  failed?: boolean;
}) {
  return (
    <div className="relative min-h-6 w-fit max-w-full min-w-0 overflow-hidden rounded-md text-sm leading-relaxed">
      <LiveActivityContent
        label={label}
        iconName={iconName}
        failed={failed}
      />
      <div
        aria-hidden
        className="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
      >
        <div className="live-activity-focus-counter">
          <div className="live-activity-focus-aligned">
            <LiveActivityContent label={label} iconName={iconName} failed={failed} highlighted />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Animated "Thinking" row (t3code's ThinkingActivityRow). */
export function ThinkingRow() {
  return <LiveActivityRow label="Thinking" />;
}

function LiveActivityContent({
  label,
  iconName,
  failed = false,
  highlighted = false,
}: {
  label: string;
  iconName?: WorkEntryIconName;
  failed?: boolean;
  highlighted?: boolean;
}) {
  const resolvedIconName = failed ? ("x" as const) : iconName;

  return (
    <div
      className={cn(
        "flex min-h-6 min-w-0 items-center gap-1.5 py-0.5",
        resolvedIconName ? "px-0.5" : "px-1",
        highlighted ? "text-foreground" : "text-secondary-label",
      )}
    >
      {resolvedIconName ? (
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            failed ? "text-destructive" : highlighted ? "text-foreground" : "text-icon-muted",
          )}
          role={failed ? "img" : undefined}
          aria-label={failed ? "Tool call failed" : undefined}
        >
          <WorkEntryIconSvg
            name={resolvedIconName}
            className={cn("block size-4 shrink-0 stroke-[1.8]", !highlighted && "opacity-70")}
          />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}

/** Verbatim port of t3code's TurnFoldTimelineRow — "Worked for 12s ▸". */
export function TurnFoldTimelineRow({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-border/60 pb-2 pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span>{label}</span>
        <Icon className="size-3.5" />
      </button>
    </div>
  );
}

/** "Working for Xs" label with a self-ticking timer (t3code's WorkingTimer style). */
export function WorkingRow({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      if (ref.current) {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        ref.current.textContent =
          elapsed < 60
            ? `${elapsed}s`
            : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="border-b border-border/60 pb-2 pt-1">
      <div className="px-1 text-sm leading-relaxed tabular-nums text-muted-foreground">
        Working for <span ref={ref} className="tabular-nums">0s</span>
      </div>
    </div>
  );
}
