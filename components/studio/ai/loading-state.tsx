"use client";

import { useState } from "react";
import { LOADER_PATTERNS, LoaderGrid } from "@/components/studio/ai/loader-grid";
import { ElapsedTime, LoaderKeyframes, ShimmerLabel } from "@/components/studio/ai/shimmer-label";
import { useElapsed } from "@/components/studio/ai/use-elapsed";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 * Adapted from provided snippet to RexaDB tokens:
 *   --ink / --ink-3  →  --foreground / --muted-foreground
 *   --tooltip-bg     →  --popover
 *   shadow-overlay   →  shadow-lg
 * Variants: Drive (square) / Dots (round) / Orbit / Surfer
 * ───────────────────────────────────────────────────────── */

export default function LoadingState({
  label,
  variant = "Drive",
  videoSrc = "/subway-surfers.mp4",
  active = true,
}: {
  label?: string;
  variant?: string;
  videoSrc?: string;
  active?: boolean;
}) {
  const elapsed = useElapsed(active);
  const surfer = variant === "Surfer";
  const resolvedLabel = label ?? (surfer ? "Subway surfing" : "Churning");
  const [videoOk, setVideoOk] = useState(true);
  const { delays, dur, round } = LOADER_PATTERNS[variant] ?? LOADER_PATTERNS.Drive;

  const labelEl = <ShimmerLabel label={resolvedLabel} tone="primary" />;
  const elapsedEl = <ElapsedTime value={elapsed} />;

  if (surfer) {
    return (
      <div role="status" className="flex w-fit flex-col items-start">
        <div className="flex items-center gap-2.5">
          <LoaderGrid {...LOADER_PATTERNS.Drive} />
          {labelEl}
          {elapsedEl}
        </div>
        <div
          className="mt-2 w-56 overflow-hidden rounded-[10px] shadow-lg"
          style={{ animation: "pop-in 200ms cubic-bezier(0.16,1,0.3,1) both", transformOrigin: "top left" }}
        >
          <div className="relative aspect-video w-full bg-popover">
            {videoOk ? (
              <video
                src={videoSrc}
                autoPlay
                muted
                loop
                playsInline
                onError={() => setVideoOk(false)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-popover">
                <LoaderGrid {...LOADER_PATTERNS.Drive} />
                <span className="px-3 text-center font-mono text-[10px] text-muted-foreground">Video unavailable</span>
              </div>
            )}
          </div>
        </div>
        <LoaderKeyframes />
      </div>
    );
  }

  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <LoaderGrid delays={delays} dur={dur} round={round} />
      {labelEl}
      {elapsedEl}
      <LoaderKeyframes />
    </div>
  );
}
