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

  test("serves stale cache immediately and returns fallback when probing fails", async () => {
    const stale = { providers: [provider], cachedAt: 0 };
    let cache: ProvidersCachePayload | null = stale;
    const api = createProviderDiscoveryEffects({
      readCache: () => cache,
      writeCache: (providers) => { cache = { providers, cachedAt: 0 }; },
      detect: async () => { throw new Error("CLI unavailable"); },
      models: async () => [],
      modes: async () => [],
      merge: (live) => live,
      now: () => 1_000_000,
      log: () => undefined,
    });
    const result = await Effect.runPromise(api.detectEffect);
    expect(result).toEqual({ providers: [provider], cached: true, stale: true });

    cache = null;
    const modelResult = await Effect.runPromise(api.modelsEffect("rexadb"));
    expect(modelResult).toEqual({ models: [], error: "CLI unavailable" });
  });
});
