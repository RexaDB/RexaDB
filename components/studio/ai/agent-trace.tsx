"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ElapsedTime, SHIMMER_KEYFRAMES, ShimmerLabel } from "@/components/studio/ai/shimmer-label";
import { useElapsed } from "@/components/studio/ai/use-elapsed";

/* ─────────────────────────────────────────────────────────
 * AGENT TRACE — live step trace shown while the model is
 * generating, so the user can see what tools/steps are
 * actually running instead of a bare "Generating" spinner.
 *
 * Adapted from a provided ThinkingState reference (Steps
 * variant) to RexaDB tokens and wired to real data:
 *   --ink / --ink-3 → --foreground / --muted-foreground
 *   bg-hover(-2)    → hover:bg-muted
 *   border-line     → border-border
 * Rows come from the live `steps` list (SSE "step" events),
 * not a canned timeline.
 * ───────────────────────────────────────────────────────── */

export default function AgentTrace({
  steps,
  active,
  label = "Thinking",
}: {
  steps: string[];
  active: boolean;
  label?: string;
}) {
  const elapsed = useElapsed(active, { preserveOnInactive: true });
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const hasRows = steps.length > 0;
  const autoExpanded = hasRows;
  const expanded = manualExpanded ?? autoExpanded;

  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [steps.length, expanded]);

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        disabled={!hasRows}
        onClick={() => setManualExpanded((current) => !(current ?? autoExpanded))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 enabled:hover:bg-muted disabled:cursor-default"
      >
        <ShimmerLabel
          label={label}
          tone="foreground"
          className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
        />
        <ElapsedTime value={elapsed} className="font-mono text-[11.5px] text-muted-foreground tabular-nums" />
        {hasRows && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-300"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-border"
              style={{ top: -8, height: lineHeight ? lineHeight - 2 : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1;
                const isDoneRow = !active || !isLast;
                return (
                  <div
                    key={`${i}-${step}`}
                    className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
                    style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 6) * 60}ms both` }}
                  >
                    {isDoneRow ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <span className="size-3 shrink-0 rounded-full border-[1.5px] border-border border-t-foreground" style={{ animation: "spin 700ms linear infinite" }} />
                    )}
                    <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{step}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fade-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } } ${SHIMMER_KEYFRAMES} @media (prefers-reduced-motion: reduce) { span[style*="shimmer-text"] { animation: none !important; } }`}</style>
    </div>
  );
}
