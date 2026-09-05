"use client";

export const CHEVRON_DELAYS: number[] = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];

export const ORBIT_DELAYS: (number | null)[] = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export interface LoaderPattern {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}

export const LOADER_PATTERNS: Record<string, LoaderPattern> = {
  Drive: { delays: CHEVRON_DELAYS, dur: 650, round: false },
  Dots: { delays: CHEVRON_DELAYS, dur: 650, round: true },
  Orbit: { delays: ORBIT_DELAYS, dur: 950, round: false },
};

export function LoaderGrid({
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
