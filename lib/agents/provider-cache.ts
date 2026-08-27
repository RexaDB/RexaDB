// Shared provider cache helpers — mirrored from t3code's providerStatusCache pattern:
// - server persists to disk (per-instance hydration) so the first request after restart is instant
// - client hydrates from localStorage so the picker shows instantly while the server re-probes
import type { AgentProvider } from "./provider-types";

const CACHE_KEY = "rexa-providers-cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min fresh, serve stale while revalidate after
const STALE_WHILE_REVALIDATE_MS = 30 * 60 * 1000; // 30 min stale usable

export interface ProvidersCachePayload {
  providers: AgentProvider[];
  cachedAt: number;
}

export function isCacheFresh(payload: ProvidersCachePayload | null, ttl = CACHE_TTL_MS): boolean {
  if (!payload) return false;
  return Date.now() - payload.cachedAt < ttl;
}

export function isCacheStaleUsable(payload: ProvidersCachePayload | null): boolean {
  if (!payload) return false;
  return Date.now() - payload.cachedAt < STALE_WHILE_REVALIDATE_MS;
}

// ─── Client (localStorage) ───────────────────────────────────────────────────
export function readProvidersCache(): ProvidersCachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ProvidersCachePayload;
    if (!Array.isArray(data.providers) || typeof data.cachedAt !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

export function writeProvidersCache(providers: AgentProvider[]): void {
  try {
    const payload: ProvidersCachePayload = { providers, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

// ─── Server helpers (also usable in client for merging) ────────────────────
// Merge live providers with cached ones — keep cached models when live probe
// failed (empty models) or status is error, mirroring t3's mergeProviderModels
export function mergeCachedProviders(
  live: AgentProvider[],
  cached: AgentProvider[] | null,
): AgentProvider[] {
  if (!cached || cached.length === 0) return live;
  const cachedById = new Map(cached.map((p) => [p.id, p] as const));
  return live.map((provider) => {
    const c = cachedById.get(provider.id);
    if (!c) return provider;
    // If live models empty and cached has models, keep cached (probe failed)
    const liveModels = provider.models ?? [];
    const cachedModels = c.models ?? [];
    if (liveModels.length === 0 && cachedModels.length > 0) {
      return { ...provider, models: cachedModels, modes: provider.modes?.length ? provider.modes : c.modes };
    }
    // If live has models but cached has more (e.g. custom models), merge missing
    if (cachedModels.length > liveModels.length) {
      const liveIds = new Set(liveModels.map((m) => m.id));
      const missing = cachedModels.filter((m) => !liveIds.has(m.id));
      if (missing.length > 0) {
        return { ...provider, models: [...liveModels, ...missing] };
      }
    }
    return provider;
  });
}
