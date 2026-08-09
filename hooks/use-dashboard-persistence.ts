import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Dashboard, DashboardFolder } from "@/lib/studio/types";
import { normalizeDashboards, normalizeDashboardFolders } from "@/lib/studio/dashboard-utils";
import { mergeById } from "@/lib/studio/general-utils";
import { getStudioDashboards, saveStudioDashboards } from "@/lib/api/actions-client";
import { getWorkspaceDashboards, saveWorkspaceDashboards } from "@/lib/supabase/workspace";
interface UseDashboardPersistenceProps {
  connectionId: number;
  setDashboards: Dispatch<SetStateAction<Dashboard[]>>;
  setDashboardFolders: Dispatch<SetStateAction<DashboardFolder[]>>;
  dashboards: Dashboard[];
  dashboardFolders: DashboardFolder[];
  workspaceId?: string | null;
  accessToken?: string | null;
}

function normalizeDashboardsAndFolders(
  rawDashboards: any[], rawFolders: any[],
  setDashboards: Dispatch<SetStateAction<Dashboard[]>>,
  setDashboardFolders: Dispatch<SetStateAction<DashboardFolder[]>>,
) {
  const normalized = normalizeDashboards(rawDashboards);
  const normalizedFolders = normalizeDashboardFolders(rawFolders);
  setDashboardFolders(normalizedFolders);
  setDashboards(normalized);
  return true;
}

export function useDashboardPersistence({
  connectionId,
  setDashboards,
  setDashboardFolders,
  dashboards,
  dashboardFolders,
  workspaceId,
  accessToken,
}: UseDashboardPersistenceProps) {
  const fetchInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastLocalChangeRef = useRef(0);
  const saveTimeoutRef = useRef<number | null>(null);
  const applyingCloudRef = useRef(false);
  const lastCloudSnapshotRef = useRef<string | null>(null);
  const hasLoadedCloudRef = useRef(false);
  const hasLoadedLocalRef = useRef(false);
  const [cloudReady, setCloudReady] = useState(false);
  const lastSqliteSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    setCloudReady(false);
  }, [workspaceId, accessToken]);

  const loadSharedDashboards = useCallback(async () => {
    if (!workspaceId || fetchInFlightRef.current) return;
    if (pendingSaveRef.current) return;
    const loadStartedAt = Date.now();
    fetchInFlightRef.current = true;
    try {
      const { dashboards: rawDashboards, folders: rawFolders, error } = await getWorkspaceDashboards();
      if (error) throw new Error(error);

      if (lastLocalChangeRef.current > loadStartedAt) {
        return;
      }

      const normalized = normalizeDashboards(rawDashboards, { idAsString: true, folderKey: "folder_id", isShared: true });
      const normalizedFolders = normalizeDashboardFolders(rawFolders);

      const normalizedPayload = normalized.map(({ isShared, ...rest }) => rest);
      const cloudSnapshot = JSON.stringify({ dashboards: normalizedPayload, folders: normalizedFolders });
      lastCloudSnapshotRef.current = cloudSnapshot;
      hasLoadedCloudRef.current = true;
      setCloudReady(true);

      applyingCloudRef.current = true;
      try {
        setDashboardFolders((prev) => mergeById(prev, normalizedFolders, (existing, incoming) => ({
          ...existing, name: incoming.name, createdAt: existing.createdAt ?? incoming.createdAt,
        })));

        setDashboards((prev) => mergeById(prev, normalized, (existing, incoming) => ({
          ...existing, ...incoming, isShared: true,
        })));
        return;
      } finally {
        applyingCloudRef.current = false;
      }
    } catch (error) {
      console.error("Failed to load shared dashboards:", error);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [setDashboards, setDashboardFolders, workspaceId]);

  const loadLocalDashboards = useCallback(async () => {
    hasLoadedLocalRef.current = false;
    try {
      const stored = await getStudioDashboards(connectionId).catch(() => null);
      const payload = stored?.success ? stored.data : null;
      const rawDashboards = Array.isArray(payload?.dashboards) ? payload.dashboards : [];
      const rawFolders = Array.isArray(payload?.folders) ? payload.folders : [];

      if (rawDashboards.length > 0 || rawFolders.length > 0) {
        const snapshot = JSON.stringify({ dashboards: rawDashboards, folders: rawFolders });
        if (snapshot === lastSqliteSnapshotRef.current) {
          return true;
        }
        lastSqliteSnapshotRef.current = snapshot;
        normalizeDashboardsAndFolders(rawDashboards, rawFolders, setDashboards, setDashboardFolders);
        return true;
      }

      const storageKey = `rexa-db-dashboards-${connectionId}`;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          const rawDashboards = Array.isArray(parsed) ? parsed : parsed?.dashboards;
          const rawFolders = Array.isArray(parsed?.folders) ? parsed.folders : [];

          if (Array.isArray(rawDashboards) && rawDashboards.length > 0) {
            normalizeDashboardsAndFolders(rawDashboards, rawFolders, setDashboards, setDashboardFolders);
            return true;
          }
        }
      } catch (error) {
        console.error("Failed to load dashboards from local storage:", error);
      }

      setDashboards([]);
      setDashboardFolders([]);
      return false;
    } finally {
      hasLoadedLocalRef.current = true;
    }
  }, [connectionId, setDashboards, setDashboardFolders]);

  // Load dashboards from local storage and SQLite
  useEffect(() => {
    hasLoadedCloudRef.current = false;
    void loadLocalDashboards();
    if (!workspaceId || !accessToken) return;
    void loadSharedDashboards();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadLocalDashboards();
        void loadSharedDashboards();
      }
    };

    const interval = window.setInterval(() => {
      void loadLocalDashboards();
      void loadSharedDashboards();
    }, 20000);

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, [accessToken, loadSharedDashboards, loadLocalDashboards, workspaceId]);

  // Save dashboards to local storage
  useEffect(() => {
    if (!hasLoadedLocalRef.current) return;
    if (applyingCloudRef.current) return;

    // Always save to local SQLite + localStorage
    const payload = { dashboards, folders: dashboardFolders };
    void saveStudioDashboards(connectionId, payload);
    lastSqliteSnapshotRef.current = JSON.stringify(payload);
    const storageKey = `rexa-db-dashboards-${connectionId}`;
    localStorage.setItem(storageKey, JSON.stringify(payload));

    // Also save shared dashboards to Supabase if in cloud mode
    if (workspaceId && accessToken) {
      if (!cloudReady) return;
      const sharedDashboards = dashboards.filter((dashboard) => dashboard.isShared);
      const sharedFolderIds = new Set(
        sharedDashboards.map((dashboard) => dashboard.folderId).filter((id): id is string => Boolean(id))
      );
      const sharedFolders = dashboardFolders.filter((folder) => sharedFolderIds.has(folder.id));
      const sharedDashboardsPayload = sharedDashboards.map(({ isShared, ...rest }) => rest);
      const sharedSnapshot = JSON.stringify({ dashboards: sharedDashboardsPayload, folders: sharedFolders });
      if (lastCloudSnapshotRef.current && sharedSnapshot === lastCloudSnapshotRef.current) {
        return;
      }
      lastLocalChangeRef.current = Date.now();
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        pendingSaveRef.current = true;
        void saveWorkspaceDashboards(sharedDashboardsPayload, sharedFolders)
          .catch((error: any) => {
            console.error("Failed to save shared dashboards:", error);
          }).finally(() => {
            pendingSaveRef.current = false;
          });
      }, 500);
    }
  }, [dashboards, dashboardFolders, connectionId, workspaceId, accessToken, cloudReady]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const refreshDashboards = useCallback(async () => {
    if (!workspaceId || !accessToken) return;
    await loadSharedDashboards();
  }, [loadSharedDashboards, workspaceId, accessToken]);

  return { refreshDashboards };
}
