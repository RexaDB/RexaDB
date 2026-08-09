"use client";

import { buildPaddedDays } from "@/lib/studio/date-utils";

const levels = [0, 1, 3, 8, 16];
const weekCount = 52;

export function ContributionHeatmap({
  queriesByDay,
}: {
  queriesByDay?: Array<{ date: string; count: number }> | null;
}) {
  if (!queriesByDay || queriesByDay.length === 0) return null;

  const paddedDays = buildPaddedDays(queriesByDay, weekCount);

  return (
    <div className="space-y-1">
      <div className="flex gap-[1px] w-full">
        {Array.from({ length: weekCount }).map((_, w) => (
          <div key={w} className="flex-1 flex flex-col gap-[1px]">
            {paddedDays.slice(w * 7, w * 7 + 7).map((d) => {
              let level = 0;
              for (let l = levels.length - 1; l >= 0; l--) {
                if (d.count >= levels[l]) {
                  level = l;
                  break;
                }
              }
              return (
                <div
                  key={d.date}
                  className="w-full h-[14px] rounded-[1.5px]"
                  style={{
                    backgroundColor:
                      level === 0
                        ? "var(--muted)"
                        : `color-mix(in srgb, var(--primary) ${level * 25}%, var(--muted))`,
                    opacity: level === 0 ? 0.3 : 0.85,
                  }}
                  title={`${d.date}: ${d.count} queries`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1 pt-1">
        <span className="text-xs text-muted-foreground/60">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div
            key={l}
            className="w-[8px] h-[8px] rounded-lg"
            style={{
              backgroundColor:
                l === 0
                  ? "var(--muted)"
                  : `color-mix(in srgb, var(--primary) ${l * 25}%, var(--muted))`,
              opacity: l === 0 ? 0.3 : 0.85,
            }}
          />
        ))}
        <span className="text-xs text-muted-foreground/60">More</span>
      </div>
    </div>
  );
}
