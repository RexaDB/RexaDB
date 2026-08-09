import { useEffect, useRef } from "react";

interface UseTimerCleanupProps {
  timerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  sqlTabTimerRef: React.MutableRefObject<Record<string, NodeJS.Timeout | null>>;
}

export function useTimerCleanup({ timerRef, sqlTabTimerRef }: UseTimerCleanupProps) {
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      Object.values(sqlTabTimerRef.current).forEach((timer) => {
        if (timer) clearInterval(timer);
      });
      sqlTabTimerRef.current = {};
    };
  }, [timerRef, sqlTabTimerRef]);
}
