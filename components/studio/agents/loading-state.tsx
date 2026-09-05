"use client";

import { LOADER_PATTERNS, LoaderGrid } from "@/components/studio/ai/loader-grid";
import { ElapsedTime, ShimmerLabel } from "@/components/studio/ai/shimmer-label";
import { useElapsed } from "@/components/studio/ai/use-elapsed";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 * (agents fork — shares loader-grid / shimmer / elapsed with ai)
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 * ───────────────────────────────────────────────────────── */

export default function LoadingState({
  label,
  variant = "Drive",
}: {
  label?: string;
  variant?: string;
}) {
  const elapsed = useElapsed(true);
  const resolvedLabel = label ?? "Churning";
  const { delays, dur, round } = LOADER_PATTERNS[variant] ?? LOADER_PATTERNS.Drive;

  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <LoaderGrid delays={delays} dur={dur} round={round} />
      <ShimmerLabel label={resolvedLabel} tone="foreground" />
      <ElapsedTime value={elapsed} />
    </div>
  );
}
