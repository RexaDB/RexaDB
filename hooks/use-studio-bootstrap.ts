import { useEffect, useRef, useState } from "react";

// services
import { getStudioBootstrap } from "@/lib/api/actions-client";

// types
import type { Connection } from "@/lib/db/schema";
import type { StudioInitialUiState } from "@/lib/studio/types";

const emptyUiState: StudioInitialUiState = { openTabs: [], activeTabId: null, schemas: [], selectedSchema: null, tables: [] };

export function useStudioBootstrap(connectionId: number | null, requestedSchema: string | null) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [initialUiState, setInitialUiState] = useState<StudioInitialUiState>(emptyUiState);
  const prevConnectionIdRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!connectionId) {
      prevConnectionIdRef.current = null;
      setConnection(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Full-page loading only when the connection itself changes (not schema query param).
    if (prevConnectionIdRef.current !== connectionId) {
      prevConnectionIdRef.current = connectionId;
      setLoading(true);
    }

    setError(null);

    void (async () => {
      try {
        const bootstrapResult = await getStudioBootstrap(connectionId, requestedSchema || undefined);
        if (!mounted) return;
        setError(bootstrapResult.success ? null : bootstrapResult.error || "Could not open this connection.");
        const bootstrap = bootstrapResult?.success ? bootstrapResult.data : null;
        const openTabs = Array.isArray(bootstrap?.tabs)
          ? bootstrap.tabs.map((tab) => ({
              id: String(tab.id),
              type: tab.type as StudioInitialUiState["openTabs"][number]["type"],
              name: String(tab.name),
              schema: tab.schema || undefined,
              query: tab.query || undefined,
            }))
          : [];
        const activeTabId = bootstrap?.settings?.activeTabId ? String(bootstrap.settings.activeTabId) : null;
        setInitialUiState({
          openTabs,
          activeTabId,
          schemas: bootstrap?.schemas || [],
          selectedSchema: bootstrap?.selectedSchema || null,
          tables: bootstrap?.tables || [],
        });
        setConnection(bootstrap?.connection ?? null);
      } catch (failure) {
        if (mounted) {
          setConnection(null);
          setError(failure instanceof Error ? failure.message : "Could not open this connection.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [connectionId, requestedSchema]);

  return { loading, error, connection, initialUiState };
}
