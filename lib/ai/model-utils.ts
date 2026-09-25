import { useEffect, useState } from "react";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import type { AcpPreset } from "@/lib/acp/types";
import { apiFetch } from "@/lib/api-base";

export function useDiscoveredAgents() {
  const [discoveredAgents, setDiscoveredAgents] = useState<AcpPreset[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/agents");
        const data = await res.json();
        setDiscoveredAgents(data.agents || []);
      } catch {
        // silently fail
      }
    })();
  }, []);

  return discoveredAgents;
}

export function getConfiguredModels(settings: GlobalAiSettings | null, discoveredAgents: AcpPreset[]) {
  const agents = (discoveredAgents ?? []).map((a) => ({ model: a.name, provider: "external" as const, id: a.id }));
  const providers = settings?.providers && typeof settings.providers === "object" ? settings.providers : {};
  const llmModels = Object.entries(providers).flatMap(([provider, config]) => {
    if (provider === "external") return [];
    if (!config || typeof config !== "object") return [];
    const apiKey = typeof config.apiKey === "string" ? config.apiKey : "";
    const usable = provider === "ollama" ? true : apiKey.trim().length > 0;
    if (!usable) return [];
    const models = Array.isArray(config.models) ? config.models : [];
    return models
      .filter((m) => typeof m === "string" && m.trim())
      .map((model) => ({ model, provider: provider as string }));
  });
  return { agents, llmModels };
}
