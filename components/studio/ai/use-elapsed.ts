"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared elapsed timer (100ms ticks, `Xm Y.Ys` format).
 * - Default: resets to 0 when `active` becomes false (loading-state semantics).
 * - `preserveOnInactive`: keeps last value while inactive, resets on false→true
 *   (agent-trace semantics).
 */
export function useElapsed(active = true, opts?: { preserveOnInactive?: boolean }): string {
  const [ds, setDs] = useState(0);
  const wasActive = useRef(false);
  const preserve = opts?.preserveOnInactive ?? false;

  useEffect(() => {
    if (!active) {
      if (!preserve) setDs(0);
      wasActive.current = false;
      return;
    }
    if (preserve && !wasActive.current) setDs(0);
    wasActive.current = true;
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, [active, preserve]);

  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function formatElapsed(ds: number): string {
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}
