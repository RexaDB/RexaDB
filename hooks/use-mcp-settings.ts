"use client";

import { useCallback, useEffect, useState } from "react";
import type { RexaAgentAppMode } from "@/lib/agents/app-modes";
import type { McpExternalConfig, McpTransportSelection } from "@/lib/agents/mcp/external-config";
import type { ExposedConnectionMeta } from "@/lib/agents/mcp/registry";
import { API_BASE } from "@/lib/api-base";

export type McpConnectionOption = ExposedConnectionMeta & {
  exposed: boolean;
  dsnHint: string;
};

export type McpStdioDescriptor = {
  command: string;
  args: string[];
  env: Record<string, string>;
  available: boolean;
};

export type McpSettingsData = {
  config: Omit<McpExternalConfig, "authToken"> & { hasAuthToken: boolean };
  modes: RexaAgentAppMode[];
  connections: McpConnectionOption[];
  /** Path of the MCP HTTP endpoint on the sidecar (same origin). */
  httpPath: string;
  /** Full HTTP URL derived from the discovered sidecar base. */
  httpUrl: string;
  /** Verbatim stdio spawn descriptor (absolute paths + data-dir env). */
  stdio: McpStdioDescriptor | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!body || body.success === false) {
    throw new Error(body?.error || "Request failed.");
  }
  return body.data as T;
}

export function useMcpSettings() {
  const [data, setData] = useState<McpSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await api<Omit<McpSettingsData, "httpUrl">>("/api/mcp/config");
      setData({ ...fresh, httpUrl: `${API_BASE}${fresh.httpPath || "/mcp"}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load MCP settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveConfig = useCallback(
    async (patch: Partial<McpExternalConfig>) => {
      if (!data) return;
      setSaving(true);
      setError(null);
      try {
        const next = { ...data.config, ...patch };
        const saved = await api<{ config: McpSettingsData["config"]; modes: RexaAgentAppMode[]; mintedToken?: string }>(
          "/api/mcp/config",
          { method: "PUT", body: JSON.stringify(next) },
        );
        setData((d) => (d ? { ...d, config: saved.config, modes: saved.modes } : d));
        // A fresh token minted on enable is only returned once — surface it.
        if (saved.mintedToken) setLastToken(saved.mintedToken);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save MCP settings.");
      } finally {
        setSaving(false);
      }
    },
    [data],
  );

  const toggleConnection = useCallback(
    async (id: number) => {
      if (!data) return;
      const has = data.config.exposedConnectionIds.includes(id);
      const exposedConnectionIds = has
        ? data.config.exposedConnectionIds.filter((c) => c !== id)
        : [...data.config.exposedConnectionIds, id];
      // Optimistic update of both the id list and the checklist rows.
      setData((d) =>
        d
          ? {
              ...d,
              config: { ...d.config, exposedConnectionIds },
              connections: d.connections.map((c) => (c.id === id ? { ...c, exposed: !has } : c)),
            }
          : d,
      );
      await saveConfig({ exposedConnectionIds });
    },
    [data, saveConfig],
  );

  const setAllExposed = useCallback(
    async (exposeAll: boolean) => {
      if (!data) return;
      const exposedConnectionIds = exposeAll ? data.connections.map((c) => c.id) : [];
      setData((d) =>
        d
          ? {
              ...d,
              config: { ...d.config, exposedConnectionIds },
              connections: d.connections.map((c) => ({ ...c, exposed: exposeAll })),
            }
          : d,
      );
      await saveConfig({ exposedConnectionIds });
    },
    [data, saveConfig],
  );

  const regenerateToken = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ authToken: string }>("/api/mcp/config/regenerate-token", { method: "POST" });
      setLastToken(result.authToken);
      setData((d) => (d ? { ...d, config: { ...d.config, hasAuthToken: true } } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate token.");
    } finally {
      setSaving(false);
    }
  }, []);

  const revealToken = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ authToken: string }>("/api/mcp/config/token");
      setLastToken(result.authToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load token.");
    } finally {
      setSaving(false);
    }
  }, []);

  const createMode = useCallback(
    async (input: { label: string; description?: string; allowSqlRead: boolean; allowSqlWrite: boolean; promptRules?: string }) => {
      setSaving(true);
      setError(null);
      try {
        const result = await api<{ mode: RexaAgentAppMode; modes: RexaAgentAppMode[] }>("/api/mcp/modes", {
          method: "POST",
          body: JSON.stringify(input),
        });
        setData((d) => (d ? { ...d, modes: result.modes } : d));
        return result.mode;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create mode.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const updateMode = useCallback(async (id: string, patch: Partial<RexaAgentAppMode>) => {
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ modes: RexaAgentAppMode[] }>(`/api/mcp/modes/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setData((d) => (d ? { ...d, modes: result.modes } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update mode.");
    } finally {
      setSaving(false);
    }
  }, []);

  const deleteMode = useCallback(async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ modes: RexaAgentAppMode[]; modeId: string }>(
        `/api/mcp/modes/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setData((d) => (d ? { ...d, modes: result.modes, config: { ...d.config, modeId: result.modeId } } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete mode.");
    } finally {
      setSaving(false);
    }
  }, []);

  const setTransports = useCallback(
    (transports: McpTransportSelection) => saveConfig({ transports }),
    [saveConfig],
  );

  return {
    data,
    loading,
    saving,
    error,
    lastToken,
    clearLastToken: () => setLastToken(null),
    refresh,
    saveConfig,
    toggleConnection,
    setAllExposed,
    regenerateToken,
    revealToken,
    createMode,
    updateMode,
    deleteMode,
    setTransports,
  };
}
