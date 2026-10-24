"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch, initApiBase } from "@/lib/api-base";
import type { AgentProvider } from "@/lib/agents/provider-types";

const initial = { providers: [] as AgentProvider[], loading: true, error: "" };
let snapshot = initial;
let refreshedAt = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(next: typeof initial) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function refreshLocalCliProviders(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() - refreshedAt < 30_000) return Promise.resolve();
  publish({ ...snapshot, loading: true, error: "" });
  pending = (async () => {
    try {
      await initApiBase();
      // Await fresh discovery: a stale disk cache can predate a terminal login.
      const response = await apiFetch("/api/agents/detect?refresh=1", { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`CLI discovery failed (${response.status}).`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data.providers)) throw new Error("Invalid CLI discovery response.");
      refreshedAt = Date.now();
      publish({ providers: data.providers, loading: false, error: "" });
    } catch (error) {
      publish({ ...snapshot, loading: false, error: error instanceof Error ? error.message : "Could not detect local CLIs." });
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function useLocalCliProviders() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  useEffect(() => {
    void refreshLocalCliProviders();
    const refresh = () => { if (document.visibilityState === "visible") void refreshLocalCliProviders(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return { ...state, refresh: () => refreshLocalCliProviders(true) };
}
