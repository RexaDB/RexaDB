import { Effect } from "effect";
import type { AgentModel, AgentProvider, AgentProviderId } from "../lib/agents/provider-types";
import type { AgentMode } from "../lib/agents/provider-types";
import type { ProvidersCachePayload } from "../lib/agents/provider-cache";
import { detectProviders } from "../lib/agents/detect-providers";
import { listProviderModels } from "../lib/agents/list-provider-models";
import { listProviderModes } from "../lib/agents/list-provider-modes";
import { readServerProviderCache, writeServerProviderCache } from "../lib/agents/provider-cache-server";
import { mergeCachedProviders } from "../lib/agents/provider-cache";

type AgentDiscoveryDependencies = {
  readCache: () => ProvidersCachePayload | null;
  writeCache: (providers: AgentProvider[]) => void;
  detect: () => Promise<AgentProvider[]>;
  models: (providerId: AgentProviderId, binaryPath?: string) => Promise<AgentModel[]>;
  modes: (providerId: AgentProviderId, binaryPath?: string) => Promise<AgentMode[]>;
  merge: (live: AgentProvider[], cached: AgentProvider[] | null) => AgentProvider[];
  now: () => number;
  log: (message: string) => void;
};

const defaultDependencies: AgentDiscoveryDependencies = {
  readCache: readServerProviderCache,
  writeCache: writeServerProviderCache,
  detect: detectProviders,
  models: listProviderModels,
  modes: listProviderModes,
  merge: mergeCachedProviders,
  now: Date.now,
  log: (message) => console.error(message),
};

function createProviderDiscoveryEffects(deps: AgentDiscoveryDependencies) {
  let refreshPromise: Promise<AgentProvider[] | null> | null = null;

  const probeProviders = async () => {
    const providers = await deps.detect();
    return Promise.all(providers.map(async (provider) => {
      const [models, modes] = await Promise.all([
        deps.models(provider.id, provider.binaryPath),
        deps.modes(provider.id, provider.binaryPath),
      ]);
      return { ...provider, models, modes };
    }));
  };

  const refreshProvidersCache = () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const previous = deps.readCache();
        const live = await probeProviders();
        const merged = deps.merge(live, previous?.providers ?? null);
        deps.writeCache(merged);
        return merged;
      } catch (cause) {
        deps.log(`[agents/detect] background refresh error: ${cause instanceof Error ? cause.message : String(cause)}`);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const refreshProvidersCacheEffect = () => Effect.tryPromise({
    try: refreshProvidersCache,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

  const detectEffect = Effect.tryPromise({
    try: async () => {
      const cached = deps.readCache();
      const now = deps.now();
      const freshMs = 30_000;
      const staleMs = 5 * 60_000;
      const isFresh = cached && now - cached.cachedAt < freshMs;
      const isStaleUsable = cached && now - cached.cachedAt < staleMs;

      if (isFresh && cached) return { providers: cached.providers, cached: true };
      if (isStaleUsable && cached) {
        void Effect.runPromise(refreshProvidersCacheEffect());
        return { providers: cached.providers, cached: true, stale: true };
      }
      if (cached && cached.providers.length > 0) {
        void Effect.runPromise(refreshProvidersCacheEffect());
        return { providers: cached.providers, cached: true, stale: true };
      }

      const refreshed = await refreshProvidersCache();
      if (refreshed && refreshed.length > 0) return { providers: refreshed };

      const providers = await probeProviders();
      try { deps.writeCache(providers); } catch {}
      return { providers };
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.catch((cause) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    deps.log(`[agents/detect] error: ${message}`);
    try {
      const cached = deps.readCache();
      if (cached) return Effect.succeed({ providers: cached.providers, cached: true, stale: true, error: message });
    } catch {}
    return Effect.succeed({ providers: [] as AgentProvider[], error: message });
  }));

  const modelsEffect = (providerId: AgentProviderId) => Effect.tryPromise({
    try: async () => {
      const cached = deps.readCache();
      const hit = cached?.providers.find((provider) => provider.id === providerId);
      if (hit?.models && hit.models.length > 0) return { models: hit.models, cached: true };
      const providers = await deps.detect();
      const provider = providers.find((candidate) => candidate.id === providerId);
      return { models: await deps.models(providerId, provider?.binaryPath) };
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.catch((cause) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    deps.log(`[agents/models] error: ${message}`);
    return Effect.succeed({ models: [] as AgentModel[], error: message });
  }));

  return { detectEffect, modelsEffect, refreshEffect: refreshProvidersCacheEffect() };
}

const effects = createProviderDiscoveryEffects(defaultDependencies);

export const detectAgentProvidersEffect = effects.detectEffect;
export const refreshAgentProvidersEffect = effects.refreshEffect.pipe(Effect.map((providers) =>
  providers ? { providers } : { providers: [], error: "Could not refresh local CLI providers." },
));
export const listAgentProviderModelsEffect = (providerId: AgentProviderId | string) =>
  effects.modelsEffect(providerId as AgentProviderId);

/** Factory is exported for deterministic tests without invoking local CLIs. */
export { createProviderDiscoveryEffects };
