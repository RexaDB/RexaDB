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
  const agents = discoveredAgents.map((a) => ({ model: a.name, provider: "external" as const, id: a.id }));
  const llmModels = settings
    ? Object.entries(settings.providers).flatMap(([provider, config]) => {
        if (provider === "external") return [];
        const usable = provider === "ollama" ? true : config.apiKey.trim().length > 0;
        if (!usable) return [];
        return config.models
          .filter((m) => m.trim())
          .map((model) => ({ model, provider: provider as string }));
      })
    : [];
  return { agents, llmModels };
}
