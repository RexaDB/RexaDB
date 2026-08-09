"use client";

import { useCallback, useEffect, useState } from "react";

import { ENTITLEMENT_CHANGED_EVENT } from "@/lib/billing/entitlement-constants";
import {
  buildDefaultResolvedEntitlement,
  clearEntitlementRefreshPending,
  resolveUserEntitlement,
  shouldForceRefreshOnFocus,
} from "@/lib/billing/entitlement-resolver";
import type { ResolvedUserEntitlement } from "@/lib/billing/entitlement-types";

type UseEntitlementStateOptions = {
  userId: string | null;
  accessToken: string | null;
  isSessionActive: boolean;
};

export function useEntitlementState({
  userId,
  accessToken,
  isSessionActive,
}: UseEntitlementStateOptions) {
  const [entitlement, setEntitlement] = useState<ResolvedUserEntitlement>(() =>
    buildDefaultResolvedEntitlement(userId),
  );
  const [loading, setLoading] = useState(Boolean(isSessionActive && userId));

  const loadEntitlement = useCallback(
    async (options?: { forceRefresh?: boolean; reason?: string }) => {
      if (!isSessionActive || !userId || !accessToken) {
        const fallback = buildDefaultResolvedEntitlement(userId);
        setEntitlement(fallback);
        setLoading(false);
        return fallback;
      }

      const next = await resolveUserEntitlement({
        userId,
        accessToken,
        forceRefresh: options?.forceRefresh,
        reason: options?.reason,
      });

      setEntitlement(next);
      setLoading(false);
      return next;
    },
    [accessToken, isSessionActive, userId],
  );

  const refreshEntitlement = useCallback(
    (reason = "manual-refresh") => {
      setLoading(true);
      return loadEntitlement({ forceRefresh: true, reason });
    },
    [loadEntitlement],
  );

  const refreshIfStale = useCallback(
    (reason = "stale-check") => loadEntitlement({ forceRefresh: entitlement.refreshDue, reason }),
    [entitlement.refreshDue, loadEntitlement],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(Boolean(isSessionActive && userId));

    void loadEntitlement({ reason: "mount" }).then((next) => {
      if (cancelled) return;
      setEntitlement(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isSessionActive, loadEntitlement, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      void loadEntitlement({ reason: "broadcast" });
    };

    window.addEventListener(ENTITLEMENT_CHANGED_EVENT, handleChanged as EventListener);
    return () => {
      window.removeEventListener(ENTITLEMENT_CHANGED_EVENT, handleChanged as EventListener);
    };
  }, [loadEntitlement, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFocus = () => {
      const forceRefresh = shouldForceRefreshOnFocus();
      void loadEntitlement({
        forceRefresh,
        reason: forceRefresh ? "checkout-return" : "window-focus",
      }).finally(() => {
        if (forceRefresh) clearEntitlementRefreshPending();
      });
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadEntitlement]);

  return {
    entitlement,
    loading,
    refreshEntitlement,
    refreshIfStale,
  };
}
