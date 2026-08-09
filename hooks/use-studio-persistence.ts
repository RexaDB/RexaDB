import { useCallback, useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api-base";
import { saveWorkspaceSnippets, saveWorkspaceDashboards, saveWorkspaceHistory } from "@/lib/supabase/workspace";

interface UseStudioPersistenceProps {
  connectionId: number;
  workspaceId?: string | null;
  accessToken?: string | null;
}

export function useStudioPersistence({ connectionId, workspaceId, accessToken }: UseStudioPersistenceProps) {
  const studioSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sharedSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastStudioSaveSignatureRef = useRef(new Map<string, string>());
  const lastSharedSaveSignatureRef = useRef(new Map<string, string>());
  const pendingSavesRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: BeforeUnloadEvent) => {
      if (pendingSavesRef.current > 0) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const getSignature = useCallback((payload: unknown) => {
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }, []);

  const queueStudioSave = useCallback((endpoint: string, payload: unknown, label: string, overrideConnectionId?: number) => {
    const capturedConnectionId = overrideConnectionId ?? connectionId;
    const signatureKey = `${capturedConnectionId}:${endpoint}`;
    const nextSignature = getSignature(payload);

    if (lastStudioSaveSignatureRef.current.get(signatureKey) === nextSignature) {
      return;
    }

    lastStudioSaveSignatureRef.current.set(signatureKey, nextSignature);
    pendingSavesRef.current++;

    studioSaveQueueRef.current = studioSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(`${API_BASE}/studio/${capturedConnectionId}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
          console.error(`[rexadb] Failed to save ${label} for connection ${capturedConnectionId}:`, body?.error);
        }
      })
      .catch((error) => {
        console.error(`[rexadb] Unexpected error saving studio ${label}:`, error);
      })
      .finally(() => {
        pendingSavesRef.current--;
      });
  }, [connectionId, getSignature]);

  const queueSharedSave = useCallback((endpoint: string, payload: unknown, label: string) => {
    if (!workspaceId) return;
    const nextSignature = getSignature(payload);

    if (lastSharedSaveSignatureRef.current.get(endpoint) === nextSignature) {
      return;
    }

    lastSharedSaveSignatureRef.current.set(endpoint, nextSignature);
    pendingSavesRef.current++;

    const call = async () => {
      const p = payload as any;
      switch (endpoint) {
        case "snippets":
          await saveWorkspaceSnippets(p.folders || [], p.snippets || [], p.allowEmpty);
          break;
        case "history":
          await saveWorkspaceHistory(p.history || []);
          break;
        case "dashboards":
          await saveWorkspaceDashboards(p.dashboards || [], p.folders || []);
          break;
      }
    };

    sharedSaveQueueRef.current = sharedSaveQueueRef.current
      .catch(() => undefined)
      .then(call)
      .catch((error) => {
        console.error(`Failed to save shared ${label}:`, error);
      })
      .finally(() => {
        pendingSavesRef.current--;
      });
  }, [workspaceId, getSignature]);

  return { queueStudioSave, queueSharedSave };
}
