"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 * Adapted from provided snippet to RexaDB tokens:
 *   --ink / --ink-3  →  --foreground / --muted-foreground
 *   --tooltip-bg     →  --popover
 *   shadow-overlay   →  shadow-lg
 * Variants: Drive (square) / Dots (round) / Orbit / Surfer
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

function LoaderGrid({
  delays,
  dur,
  round,
}: {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`size-[4px] bg-foreground ${round ? "rounded-full" : "rounded-[1px]"}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

function useElapsed(active: boolean) {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    if (!active) {
      setDs(0);
      return;
    }
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, [active]);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

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
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;

  const labelEl = (
    <span
      className="bg-clip-text text-[13px] font-medium text-transparent"
      style={{
        backgroundImage: "linear-gradient(90deg, var(--muted-foreground) 35%, var(--primary) 50%, var(--muted-foreground) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >
      {resolvedLabel}
    </span>
  );
  const elapsedEl = <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{elapsed}</span>;

  if (surfer) {
    return (
      <div role="status" className="flex w-fit flex-col items-start">
        <div className="flex items-center gap-2.5">
          <LoaderGrid {...PATTERNS.Drive} />
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
                <LoaderGrid {...PATTERNS.Drive} />
                <span className="px-3 text-center font-mono text-[10px] text-muted-foreground">Video unavailable</span>
              </div>
            )}
          </div>
        </div>
        <style>{`@keyframes pixel-on { 0%,100% { opacity: 0.15; } 50% { opacity: 1; } } @keyframes shimmer-text { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } } @media (prefers-reduced-motion: reduce) { span[style*="pixel-on"] { animation: none !important; opacity: 0.15 !important; } span[style*="shimmer-text"] { animation: none !important; } }`}</style>
      </div>
    );
  }

  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <LoaderGrid delays={delays} dur={dur} round={round} />
      {labelEl}
      {elapsedEl}
      <style>{`@keyframes pixel-on { 0%,100% { opacity: 0.15; } 50% { opacity: 1; } } @keyframes shimmer-text { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } } @media (prefers-reduced-motion: reduce) { span[style*="pixel-on"] { animation: none !important; opacity: 0.15 !important; } span[style*="shimmer-text"] { animation: none !important; } }`}</style>
    </div>
  );
}
