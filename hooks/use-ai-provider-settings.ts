"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getGlobalAiSettings,
  saveGlobalAiSettings,
  listAiProviderCatalog,
  type GlobalAiSettings,
  type AiProviderCatalogEntry,
} from "@/lib/api/actions-client";

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  kilo: "Kilo Code",
  ollama: "Ollama",
};

/** Providers pinned in the compact settings panel; the full catalog lives on the dedicated Providers page. */
export const PINNED_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "kilo", "ollama"];

/** Providers from the Pi SDK catalog with a bundled monochrome brand mark (fetched from Simple Icons, CC0). */
export const CATALOG_PROVIDER_LOGOS: Record<string, string> = {
  "amazon-bedrock": "/providers/amazonaws.svg",
  "azure-openai-responses": "/providers/microsoftazure.svg",
  "cloudflare-ai-gateway": "/providers/cloudflare.svg",
  "cloudflare-workers-ai": "/providers/cloudflare.svg",
  deepseek: "/providers/deepseek.svg",
  "github-copilot": "/providers/githubcopilot.svg",
  "google-vertex": "/providers/googlecloud.svg",
  huggingface: "/providers/huggingface.svg",
  "kimi-coding": "/providers/kimi.svg",
  minimax: "/providers/minimax.svg",
  "minimax-cn": "/providers/minimax.svg",
  mistral: "/providers/mistralai.svg",
  moonshotai: "/providers/moonshotai.svg",
  "moonshotai-cn": "/providers/moonshotai.svg",
  nvidia: "/providers/nvidia.svg",
  "openai-codex": "/providers/openai.svg",
  opencode: "/providers/opencode.svg",
  "opencode-go": "/providers/opencode.svg",
  "qwen-token-plan": "/providers/qwen.svg",
  "qwen-token-plan-cn": "/providers/qwen.svg",
  "qwen-token-plan-individual": "/providers/qwen.svg",
  "vercel-ai-gateway": "/providers/vercel.svg",
  xiaomi: "/providers/xiaomi.svg",
  "xiaomi-token-plan-ams": "/providers/xiaomi.svg",
  "xiaomi-token-plan-cn": "/providers/xiaomi.svg",
  "xiaomi-token-plan-sgp": "/providers/xiaomi.svg",
};

/** Providers with no Simple Icons mark — their real full-color mark, fetched as a favicon instead. */
export const CATALOG_PROVIDER_COLOR_LOGOS: Record<string, string> = {
  "ant-ling": "/providers/antling.png",
  baseten: "/providers/baseten.png",
  cerebras: "/providers/cerebras.png",
  fireworks: "/providers/fireworks.png",
  groq: "/providers/groq.png",
  together: "/providers/together.png",
  xai: "/providers/xai.png",
  zai: "/providers/zai.png",
  "zai-coding-cn": "/providers/zai.png",
};

const PINNED_LOGOS: Record<string, string> = {
  openai: "/providers/openai.svg",
  anthropic: "/providers/anthropic_black.svg",
  google: "/providers/google.svg",
  openrouter: "/providers/openrouter_light.svg",
  kilo: "/providers/kilo.svg",
  ollama: "/providers/ollama-logo-black-light-svg.svg",
};

export function logoFor(providerId: string): string | undefined {
  return PINNED_LOGOS[providerId] || CATALOG_PROVIDER_LOGOS[providerId] || CATALOG_PROVIDER_COLOR_LOGOS[providerId];
}

/** Google's mark and the fetched favicon marks are already full-color; everything else is a monochrome glyph. */
export function logoNeedsInvert(providerId: string): boolean {
  return providerId !== "google" && !CATALOG_PROVIDER_COLOR_LOGOS[providerId];
}

export function useAiProviderSettings() {
  const [settings, setSettings] = useState<GlobalAiSettings | null>(null);
  const [catalog, setCatalog] = useState<AiProviderCatalogEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const result = await getGlobalAiSettings();
      if (result.success && result.data) setSettings(result.data);
    })();
    void (async () => {
      const result = await listAiProviderCatalog();
      if (result.success && result.data) setCatalog(result.data);
    })();
  }, []);

  const updateSettings = useCallback((next: GlobalAiSettings) => {
    setSettings(next);
    void saveGlobalAiSettings(next);
  }, []);

  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const labelFor = useCallback(
    (id: string) => PROVIDER_LABELS[id] || catalog.find((c) => c.id === id)?.name || id,
    [catalog],
  );

  const addProvider = useCallback(
    (id: string) => {
      if (!settings) return;
      const entry = catalog.find((c) => c.id === id);
      if (settings.providers[id]) return;
      updateSettings({
        ...settings,
        providers: {
          ...settings.providers,
          [id]: { apiKey: "", models: [], baseUrl: entry?.baseUrl },
        },
      });
    },
    [settings, catalog, updateSettings],
  );

  const removeProvider = useCallback(
    (id: string) => {
      if (!settings) return;
      const next = { ...settings.providers };
      delete next[id];
      updateSettings({ ...settings, providers: next });
    },
    [settings, updateSettings],
  );

  const updateProvider = useCallback(
    (id: string, patch: Partial<GlobalAiSettings["providers"][string]>) => {
      if (!settings) return;
      const current = settings.providers[id] || { apiKey: "", models: [] };
      updateSettings({
        ...settings,
        providers: { ...settings.providers, [id]: { ...current, ...patch } },
      });
    },
    [settings, updateSettings],
  );

  return {
    settings,
    catalog,
    catalogById,
    updateSettings,
    labelFor,
    addProvider,
    removeProvider,
    updateProvider,
  };
}
