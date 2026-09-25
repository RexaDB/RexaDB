import { useEffect, useMemo, useState } from "react";

import { getGlobalAiSettings, type GlobalAiSettings } from "@/lib/api/actions-client";
import { subscribeGlobalAiSettingsUpdated } from "@/lib/ai/ai-settings-events";

function hasAnyConfiguredModels(settings: GlobalAiSettings | null): boolean {
  if (!settings || !settings.providers || typeof settings.providers !== "object") return false;
  return Object.entries(settings.providers).some(([p, c]) => {
    if (!c || typeof c !== "object") return false;
    const models = Array.isArray(c.models) ? c.models : [];
    const apiKey = typeof c.apiKey === "string" ? c.apiKey : "";
    return models.length > 0 && (p === "ollama" || apiKey.trim().length > 0);
  });
}

export function useSqlAiSettings() {
  const [settings, setSettings] = useState<GlobalAiSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      const result = await getGlobalAiSettings();
      if (!cancelled) {
        setSettings(result.success && result.data ? result.data : null);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeGlobalAiSettingsUpdated(() => {
      void (async () => {
        setIsLoading(true);
        const result = await getGlobalAiSettings();
        setSettings(result.success && result.data ? result.data : null);
        setIsLoading(false);
      })();
    });
    return unsubscribe;
  }, []);

  return {
    settings,
    isLoading,
    hasAnyModels: useMemo(() => hasAnyConfiguredModels(settings), [settings]),
  };
}
