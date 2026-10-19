import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentProvider } from "../../lib/agents/provider-types";
import type { ProvidersCachePayload } from "../../lib/agents/provider-cache";
import { createProviderDiscoveryEffects } from "../../server/agents-api";

const provider: AgentProvider = {
  id: "rexadb",
  name: "RexaDB",
  icon: "rexadb",
  available: true,
  status: "installed",
  description: "Built-in agent",
};

function fixture(initialCache: ProvidersCachePayload | null = null) {
  let cache = initialCache;
  let detected = 0;
  const effects = createProviderDiscoveryEffects({
    readCache: () => cache,
    writeCache: (providers) => { cache = { providers, cachedAt: 10_000 }; },
    detect: async () => { detected++; return [provider]; },
    models: async () => [{ id: "model-1", label: "Model 1" }],
    modes: async () => [{ id: "build", label: "Build", isDefault: true }],
    merge: (live) => live,
    now: () => 10_000,
    log: () => undefined,
  });
  return { ...effects, detected: () => detected, cache: () => cache };
}

describe("agent provider discovery Effects", () => {
  test("serves a fresh cached provider list without probing local CLIs", async () => {
    const cached = { ...provider, models: [{ id: "cached", label: "Cached" }] };
    const api = fixture({ providers: [cached], cachedAt: 9_999 });
    const result = await Effect.runPromise(api.detectEffect);
    expect(result).toEqual({ providers: [cached], cached: true });
    expect(api.detected()).toBe(0);
  });

  test("cold refresh discovers providers and persists models and modes", async () => {
    const api = fixture();
    const result = await Effect.runPromise(api.detectEffect);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].models?.[0].id).toBe("model-1");
    expect(result.providers[0].modes?.[0].id).toBe("build");
    expect(api.detected()).toBe(1);
    expect(api.cache()?.providers[0].models?.[0].id).toBe("model-1");
  });

  test("serves overlapping stale requests before one pending refresh updates cache", async () => {
    const stale = { providers: [provider], cachedAt: 0 };
    let cache: ProvidersCachePayload | null = stale;
    let probeCount = 0;
    let releaseProbe!: (providers: AgentProvider[]) => void;
    let markProbeStarted!: () => void;
    let markCacheUpdated!: () => void;
    const probeStarted = new Promise<void>((resolve) => { markProbeStarted = resolve; });
    const cacheUpdated = new Promise<void>((resolve) => { markCacheUpdated = resolve; });
    const probeGate = new Promise<AgentProvider[]>((resolve) => { releaseProbe = resolve; });
    const api = createProviderDiscoveryEffects({
      readCache: () => cache,
      writeCache: (providers) => {
        cache = { providers, cachedAt: 1_000_000 };
        markCacheUpdated();
      },
      detect: async () => {
        probeCount++;
        markProbeStarted();
        return probeGate;
      },
      models: async () => [{ id: "refreshed-model", label: "Refreshed" }],
      modes: async () => [{ id: "build", label: "Build" }],
      merge: (live) => live,
      now: () => 1_000_000,
      log: () => undefined,
    });

    try {
      const firstRequest = Effect.runPromise(api.detectEffect);
      const secondRequest = Effect.runPromise(api.detectEffect);
      await probeStarted;

      // A blocked discovery must not block either stale response. The timeout
      // keeps the regression test bounded; the probe is always released below.
      const responses = await Promise.race([
        Promise.all([firstRequest, secondRequest]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stale responses waited for discovery")), 250)),
      ]);
      expect(responses).toEqual([
        { providers: [provider], cached: true, stale: true },
        { providers: [provider], cached: true, stale: true },
      ]);
      expect(probeCount).toBe(1);

      releaseProbe([{ ...provider, name: "Refreshed provider" }]);
      await cacheUpdated;
      expect(cache?.providers[0]).toMatchObject({
        name: "Refreshed provider",
        models: [{ id: "refreshed-model" }],
        modes: [{ id: "build" }],
      });
    } finally {
      releaseProbe([provider]);
    }
  }, 2_000);

  test("returns the legacy model fallback when provider detection fails", async () => {
    const api = createProviderDiscoveryEffects({
      readCache: () => null,
      writeCache: () => undefined,
      detect: async () => { throw new Error("CLI unavailable"); },
      models: async () => [],
      modes: async () => [],
      merge: (live) => live,
      now: () => 1_000_000,
      log: () => undefined,
    });
    const modelResult = await Effect.runPromise(api.modelsEffect("rexadb"));
    expect(modelResult).toEqual({ models: [], error: "CLI unavailable" });
  });
});
