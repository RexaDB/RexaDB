import { useEffect, useRef, useState } from "react";
import { getStudioBootstrap } from "@/lib/api/actions-client";
import type { Connection } from "@/lib/db/schema";
import type { StudioInitialUiState } from "@/lib/studio/types";

const emptyUiState: StudioInitialUiState = { openTabs: [], activeTabId: null, schemas: [], selectedSchema: null, tables: [] };

export function useStudioBootstrap(connectionId: number | null, requestedSchema: string | null) {
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [initialUiState, setInitialUiState] = useState<StudioInitialUiState>(emptyUiState);
  const prevConnectionIdRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!connectionId) {
      prevConnectionIdRef.current = null;
      setConnection(null);
      setLoading(false);
      return;
    }

    // Full-page loading only when the connection itself changes (not schema query param).
    if (prevConnectionIdRef.current !== connectionId) {
      prevConnectionIdRef.current = connectionId;
      setLoading(true);
    }

    void (async () => {
      try {
        console.log("[useStudioBootstrap] calling getStudioBootstrap for connectionId:", connectionId);
        const bootstrapResult = await getStudioBootstrap(connectionId, requestedSchema || undefined);
        if (!mounted) return;
        console.log("[useStudioBootstrap] bootstrapResult success:", bootstrapResult?.success, "hasConnection:", !!bootstrapResult?.data?.connection);
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
      } catch {
        if (mounted) setConnection(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [connectionId, requestedSchema]);

  return { loading, connection, initialUiState };
}
