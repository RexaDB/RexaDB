import type { AgentProvider, GlobalAiSettings } from "@/lib/ai/types";

function resolveAiProviderConfig(
  settings: GlobalAiSettings,
  provider: AgentProvider,
  modelId: string,
) {
  const config = settings.providers[provider];
  if (!config) {
    throw new Error(`AI provider "${provider}" is not configured.`);
  }
  const needsApiKey = provider !== "ollama";
  if (needsApiKey && !config.apiKey.trim()) {
    throw new Error(`AI provider "${provider}" is not configured.`);
  }

  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) {
    throw new Error(`No model specified for "${provider}".`);
  }

  return {
    provider,
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl?.trim(),
    modelId: trimmedModelId,
  };
}

export function resolveLanguageModel(
  settings: GlobalAiSettings,
  provider: AgentProvider,
  modelId: string,
): { provider: AgentProvider; modelId: string; model: { id: string; apiKey: string; url?: string } } {
  const resolved = resolveAiProviderConfig(settings, provider, modelId);

  if (resolved.provider === "openai") {
    return {
      provider: resolved.provider,
      modelId: resolved.modelId,
      model: { id: `openai/${resolved.modelId}` as `${string}/${string}`, apiKey: resolved.apiKey, url: resolved.baseUrl },
    };
  }

  if (resolved.provider === "google") {
    return {
      provider: resolved.provider,
      modelId: resolved.modelId,
      model: { id: `google/${resolved.modelId}` as `${string}/${string}`, apiKey: resolved.apiKey, url: resolved.baseUrl },
    };
  }

  if (resolved.provider === "anthropic") {
    return {
      provider: resolved.provider,
      modelId: resolved.modelId,
      model: { id: `anthropic/${resolved.modelId}` as `${string}/${string}`, apiKey: resolved.apiKey, url: resolved.baseUrl },
    };
  }

  if (resolved.provider === "ollama") {
    return {
      provider: resolved.provider,
      modelId: resolved.modelId,
      model: {
        id: `openai/${resolved.modelId}` as `${string}/${string}`,
        apiKey: resolved.apiKey || "ollama",
        url: resolved.baseUrl || "http://localhost:11434/v1",
      },
    };
  }

  // Any other provider — openrouter/kilo/external, or any provider from the
  // Pi SDK's full catalog (lib/ai/pi-provider-catalog.ts) the user has added
  // in settings. If they gave a custom base URL, use it as an OpenAI-compatible
  // gateway; otherwise pass the provider id through so pi-agent.ts can resolve
  // the SDK's own native endpoint/API format for it.
  return {
    provider: resolved.provider,
    modelId: resolved.modelId,
    model: {
      id: `${resolved.provider}/${resolved.modelId}` as `${string}/${string}`,
      apiKey: resolved.apiKey,
      url: resolved.baseUrl,
    },
  };
}
