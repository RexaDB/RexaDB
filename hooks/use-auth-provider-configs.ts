import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { fetchAuthProviderConfigs } from "@/lib/studio/auth/fetch";
import { saveAuthProviderConfig } from "@/lib/studio/auth/save";

export function useAuthProviderConfigs(
  connectionString: string,
  enabled: boolean,
) {
  // fallow-ignore-next-line code-duplication
  const [configs, setConfigs] = useState<AuthProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!connectionString) {
      setError("Missing connection string.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuthProviderConfigs(connectionString);
      setConfigs(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load providers.");
      setConfigs([]);
    }
    setLoading(false);
  }, [connectionString, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const configsByIdentifier = useMemo(
    () => new Map(configs.map((config) => [config.identifier, config])),
    [configs],
  );

  const saveConfig = useCallback(
    async (payload: AuthProviderConfig) => {
      if (!connectionString) throw new Error("Missing connection string.");
      const existingConfig = configs.find((config) => config.id === payload.id);
      const existing = Boolean(existingConfig);
      const normalized =
        existingConfig && payload.client_secret === "placeholder"
          ? { ...payload, client_secret: existingConfig.client_secret }
          : payload;
      const saved = await saveAuthProviderConfig(
        connectionString,
        normalized,
        existing,
      );
      setConfigs((prev) =>
        existing
          ? prev.map((item) => (item.id === saved.id ? saved : item))
          : [...prev, saved],
      );
      return saved;
    },
    [configs, connectionString],
  );

  return { configs, configsByIdentifier, loading, error, refresh, saveConfig };
}
