import { useCallback, useRef } from "react";

export function useTabPerformanceLogger() {
  const tabSwitchPerfRef = useRef<{
    fromTabId: string | null;
    toTabId: string;
    startedAt: number;
    ended: boolean;
  } | null>(null);

  const logTabPerf = useCallback(
    (stage: string, extra: Record<string, unknown> = {}) => {
      const perf = tabSwitchPerfRef.current;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsedMs = perf
        ? Math.round((now - perf.startedAt) * 100) / 100
        : null;
      const payload = {
        stage,
        elapsedMs,
        fromTabId: perf?.fromTabId ?? null,
        toTabId: perf?.toTabId ?? null,
        ...extra,
      };

      console.log("[TabPerf]", payload);
      if (typeof window !== "undefined") {
        const w = window as Window & {
          __TAB_PERF_LOGS__?: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(w.__TAB_PERF_LOGS__)) {
          w.__TAB_PERF_LOGS__ = [];
        }
        w.__TAB_PERF_LOGS__.push(payload);
      }
    },
    [],
  );

  return { tabSwitchPerfRef, logTabPerf };
}
