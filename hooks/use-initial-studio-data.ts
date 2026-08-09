import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getWorkspaceSnippets, getWorkspaceHistory } from "@/lib/supabase/workspace";
import {
  getStudioFolders, getStudioSnippets, getStudioHistory, getStudioTags, getStudioTableTags, getStudioTabs, getStudioSettings
} from "@/lib/api/actions-client";
import { Connection } from "@/lib/db/schema";
import { getDefaultKeybindings, normalizeKeybindingsForPlatform, withMissingDefaultKeybindings } from "@/lib/studio/keybindings";
import { createDefaultSplitLayout } from "@/lib/studio/split-layout";
import { QueryHistory, Snippet, Folder, type SqlEditorEngine, type StudioSplitViewState } from "@/lib/studio/types";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";
import { mergeById } from "@/lib/studio/general-utils";
import { normalizeCloudFolders, normalizeCloudSnippets, mapStudioSnippet } from "@/lib/studio/cloud-sync-utils";

interface UseInitialStudioDataProps {
  connection: Connection;
  storageMode?: "local" | "cloud";
  workspaceId?: string | null;
  accessToken?: string | null;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setSnippets: Dispatch<SetStateAction<Snippet[]>>;
  setQueryHistory: (history: QueryHistory[]) => void;
  setTags: (tags: Array<{ name: string; color: string }>) => void;
  setTableTags: (tableTags: Record<string, string[]>) => void;
  setOpenTabs: Dispatch<SetStateAction<Array<{ id: string; type: any; name: string; schema?: string; query?: string }>>>;
  setActiveTabId: Dispatch<SetStateAction<string | null>>;
  setSidebarSortMode: (mode: 'alphabetical' | 'tags') => void;
  setSidebarView: Dispatch<SetStateAction<any>>;
  setIsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  setSidebarBehavior: (behavior: SidebarBehavior) => void;
  setKeybindings: (keybindings: Record<string, any>) => void;
  setSearchSettings: (settings: any) => void;
  setSplitView: (view: StudioSplitViewState) => void;
  setIsDataLoaded: (isLoaded: boolean) => void;
  setIsHistoryLoaded: (loaded: boolean) => void;
  setIsSharedSnippetsLoaded?: (loaded: boolean) => void;
  delayedUiRestoreBlockedRef: React.MutableRefObject<boolean>;
}

export function useInitialStudioData({
  connection,
  storageMode = "local",
  workspaceId,
  accessToken,
  setFolders,
  setSnippets,
  setQueryHistory,
  setTags,
  setTableTags,
  setOpenTabs,
  setActiveTabId,
  setSidebarSortMode,
  setSidebarView,
  setIsSidebarVisible,
  setSidebarBehavior,
  setKeybindings,
  setSearchSettings,
  setSplitView,
  setIsDataLoaded,
  setIsHistoryLoaded,
  setIsSharedSnippetsLoaded,
  delayedUiRestoreBlockedRef,
}: UseInitialStudioDataProps) {
  // Reset history synchronously the moment connection changes — before any async load
  useEffect(() => {
    // Only reset if it's a completely different connection, 
    // but don't clear tabs/settings immediately to avoid "tab flash" or closing tabs
    // during initial sync if the connection was already partially loaded.
    setIsHistoryLoaded(false);
    setIsDataLoaded(false);
  }, [connection.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setIsDataLoaded(false);
      setIsHistoryLoaded(false);

      const useCloudHistory = storageMode === "cloud" && workspaceId && accessToken;
      const canLoadCloudSnippets = storageMode === "cloud" && Boolean(workspaceId && accessToken);

      const [tagsRes, tableTagsRes, tabsRes, settingsRes] = await Promise.all([
        getStudioTags(connection.id),
        getStudioTableTags(connection.id),
        getStudioTabs(connection.id),
        getStudioSettings(connection.id),
      ]);

      let foldersRes: any = null;
      let snippetsRes: any = null;
      let historyRes: any = null;

      [foldersRes, snippetsRes] = await Promise.all([
        getStudioFolders(connection.id),
        getStudioSnippets(connection.id),
      ]);
      setIsSharedSnippetsLoaded?.(false);

      console.log("[rexadb] useInitialStudioData: loaded local snippets", {
        connectionId: connection.id,
        folderCount: foldersRes?.data?.length ?? 0,
        snippetCount: snippetsRes?.data?.length ?? 0,
        snippetIds: (snippetsRes?.data ?? []).map((s: any) => s.id),
        snippetNames: (snippetsRes?.data ?? []).map((s: any) => s.name),
        storageMode,
        canLoadCloudSnippets,
      });

      if (foldersRes?.success && foldersRes.data) {
        setFolders(foldersRes.data.map((f: any) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null, createdAt: f.createdAt })));
      }
      if (snippetsRes?.success && snippetsRes.data) {
        setSnippets(snippetsRes.data.map(mapStudioSnippet));
      }

      if (useCloudHistory) {
        const { history: cloudHistoryData, error: historyErr } = await getWorkspaceHistory();
        historyRes = {
          success: !historyErr,
          data: { history: cloudHistoryData },
        };
      } else {
        historyRes = await getStudioHistory(connection.id);
      }

      if (useCloudHistory) {
        const cloudHistory = Array.isArray(historyRes?.data?.history) ? historyRes.data.history : [];

        const loadedCloudHistory = cloudHistory.map((h: any) => ({
          id: String(h.id),
          query: h.query,
          executedAt: h.executed_at ? new Date(h.executed_at).getTime() : Date.now(),
          duration: h.duration_ms ?? h.duration ?? 0,
          status: h.status as 'success' | 'error',
          error: h.error || undefined,
          rowsCount: h.rows_count ?? undefined,
          caller: h.caller as 'user' | 'system',
          executedBy: h.executed_by || undefined,
          executedByName: h.executed_by_name || undefined,
          connectionName: h.connection_name || undefined,
        }));
        
        console.log("[rexadb] useInitialStudioData: loading cloud history", {
          connectionId: connection.id,
          historyCount: loadedCloudHistory.length,
          firstEntry: loadedCloudHistory[0]?.id,
          lastEntry: loadedCloudHistory[loadedCloudHistory.length - 1]?.id,
        });
        
        if (cancelled) return;
        setQueryHistory(loadedCloudHistory);
        setIsHistoryLoaded(true);
      } else {
        if (historyRes?.success && historyRes.data) {
          const loadedHistory = historyRes.data.map((h: any) => ({
            id: h.id,
            query: h.query,
            executedAt: h.executedAt,
            duration: h.duration,
            status: h.status as 'success' | 'error',
            error: h.error || undefined,
            rowsCount: h.rowsCount || undefined,
            caller: h.caller as 'user' | 'system',
            executedBy: h.executedBy || undefined,
            executedByName: h.executedByName || undefined,
            connectionName: h.connectionName || undefined,
          }));
          
          console.log("[rexadb] useInitialStudioData: loading history", {
            connectionId: connection.id,
            historyCount: loadedHistory.length,
            firstEntry: loadedHistory[0]?.id,
            lastEntry: loadedHistory[loadedHistory.length - 1]?.id,
          });
          
          if (cancelled) return;
          setQueryHistory(loadedHistory);
        } else {
          console.log("[rexadb] useInitialStudioData: no history found", {
            connectionId: connection.id,
            success: historyRes?.success,
          });
          if (cancelled) return;
          setQueryHistory([]);
        }
        setIsHistoryLoaded(true);
      }

      if (canLoadCloudSnippets && workspaceId) {
        console.log("[rexadb] useInitialStudioData: loading cloud snippets", { workspaceId });
        const { folders: cloudFoldersData, snippets: cloudSnippetsData, error: snippetsErr } = await getWorkspaceSnippets();
        console.log("[rexadb] useInitialStudioData: cloud snippets response", {
          error: snippetsErr,
          folderCount: cloudFoldersData?.length ?? 0,
          snippetCount: cloudSnippetsData?.length ?? 0,
          snippetIds: (cloudSnippetsData ?? []).map((s: any) => s.id),
          snippetNames: (cloudSnippetsData ?? []).map((s: any) => s.name),
        });
        const cloudSnippetsRes = {
          success: !snippetsErr,
          data: { folders: cloudFoldersData, snippets: cloudSnippetsData },
        };
        if (cloudSnippetsRes.success) {
          console.log("[rexadb] useInitialStudioData: merging cloud snippets into local state");
          const cloudFolders = Array.isArray(cloudSnippetsRes?.data?.folders) ? cloudSnippetsRes.data.folders : [];
          const cloudSnippets = Array.isArray(cloudSnippetsRes?.data?.snippets) ? cloudSnippetsRes.data.snippets : [];

          const normalizedFolders = normalizeCloudFolders(cloudFolders);

          setFolders((prev) => mergeById(prev, normalizedFolders, (existing, incoming) => ({
            ...existing, ...incoming, createdAt: existing.createdAt ?? incoming.createdAt,
          })));

          const folderIdSet = new Set(normalizedFolders.map((f) => f.id));
          const normalizedSnippets = normalizeCloudSnippets(cloudSnippets, folderIdSet);
          setSnippets((prev) => mergeById(prev, normalizedSnippets, (existing, incoming) => ({
            ...existing, ...incoming, isShared: true,
          })));

          setIsSharedSnippetsLoaded?.(true);
        } else {
          console.log("[rexadb] useInitialStudioData: cloud snippets fetch failed", { error: snippetsErr });
          setIsSharedSnippetsLoaded?.(false);
        }
      } else {
        console.log("[rexadb] useInitialStudioData: skipping cloud snippets", { storageMode, workspaceId: !!workspaceId, accessToken: !!accessToken });
      }
      if (tagsRes.success && tagsRes.data) {
        setTags(tagsRes.data.map((t: { name: string; color: string }) => ({ name: t.name, color: t.color })));
      }
      if (tableTagsRes.success && tableTagsRes.data) {
        setTableTags(tableTagsRes.data);
      }
      if (tabsRes.success && tabsRes.data && tabsRes.data.length > 0) {
        // Only apply tabs from DB if we haven't already hydrated from localStorage
        // and the user hasn't started interacting yet.
        setOpenTabs((currentTabs: any[]) => {
          if (delayedUiRestoreBlockedRef.current) {
            return currentTabs;
          }
          if (currentTabs.length > 1 || (currentTabs.length === 1 && currentTabs[0].id !== "global-sql-context")) {
            return currentTabs;
          }
          return tabsRes.data.map((t: any) => ({
            id: t.id,
            type: t.type as any,
            name: t.name,
            schema: t.schema || undefined,
            query: t.query || undefined
          }));
        });
      }
      if (settingsRes.success && settingsRes.data) {
        const settings = settingsRes.data;
        if (settings.activeTabId) {
          // Only apply activeTabId if we haven't hydrated one from localStorage
          setActiveTabId((currentActiveId: string | null) => {
            if (delayedUiRestoreBlockedRef.current) {
              return currentActiveId;
            }
            if (currentActiveId && currentActiveId !== "global-sql-context") {
              return currentActiveId;
            }
            const tabExists = tabsRes.data?.some((t: any) => t.id === settings.activeTabId);
            return tabExists ? settings.activeTabId : currentActiveId;
          });
        }
        if (
          !delayedUiRestoreBlockedRef.current &&
          (settings.sidebarSortMode === "alphabetical" || settings.sidebarSortMode === "tags")
        ) {
          setSidebarSortMode(settings.sidebarSortMode);
        }
        if (
          !delayedUiRestoreBlockedRef.current &&
          (settings.sidebarView === "dashboard" || settings.sidebarView === "tables" || settings.sidebarView === "sql" || settings.sidebarView === "database" || settings.sidebarView === "import-export" || settings.sidebarView === "auth" || settings.sidebarView === "themes")
        ) {
          setSidebarView(settings.sidebarView);
        }
        if (settings.sidebarVisible !== undefined && settings.sidebarVisible !== null) {
          setIsSidebarVisible((currentVisible: boolean) => {
            if (delayedUiRestoreBlockedRef.current) return currentVisible;
            const hasLocalStorageValue = typeof window !== "undefined" && window.localStorage.getItem(`rexa-db-sidebar-visible-${connection.id}`) !== null;
            if (hasLocalStorageValue) return currentVisible;
            return !!settings.sidebarVisible;
          });
        }
        if (
          !delayedUiRestoreBlockedRef.current &&
          (settings.sidebarBehavior === "open" || settings.sidebarBehavior === "closed" || settings.sidebarBehavior === "expandable")
        ) {
          setSidebarBehavior(settings.sidebarBehavior);
        }
        if (settings.keybindings) {
          try {
            const parsedKeybindings = JSON.parse(settings.keybindings);
            const hasBindings =
              parsedKeybindings &&
              typeof parsedKeybindings === "object" &&
              !Array.isArray(parsedKeybindings) &&
              Object.keys(parsedKeybindings).length > 0;
            const baseBindings = hasBindings
              ? withMissingDefaultKeybindings(parsedKeybindings)
              : getDefaultKeybindings();
            setKeybindings(normalizeKeybindingsForPlatform(baseBindings));
          } catch (e) {
            console.error("Failed to parse keybindings", e);
            setKeybindings(normalizeKeybindingsForPlatform(getDefaultKeybindings()));
          }
        } else {
          setKeybindings(normalizeKeybindingsForPlatform(getDefaultKeybindings()));
        }
        if (settings.searchSettings) {
          try {
            setSearchSettings(JSON.parse(settings.searchSettings));
          } catch (e) {
            console.error("Failed to parse search settings", e);
          }
        }
        if (!delayedUiRestoreBlockedRef.current && settings.splitView) {
          try {
            const parsed = JSON.parse(settings.splitView);
            if (parsed && typeof parsed === "object") {
              const nextView = createDefaultSplitLayout(null);
              if (typeof parsed.activePaneId === "string") {
                nextView.activePaneId = parsed.activePaneId;
              }
              if (typeof parsed.tabPaneMap === "object" && parsed.tabPaneMap) {
                nextView.tabPaneMap = parsed.tabPaneMap;
              }
              setSplitView(nextView);
            }
          } catch (e) {
            console.error("Failed to parse split view settings", e);
          }
        }
      } else {
        setKeybindings(getDefaultKeybindings());
      }
      if (cancelled) return;
      setIsDataLoaded(true);
    }
    loadInitialData();
    return () => { cancelled = true; };
  }, [connection.id, storageMode, workspaceId, accessToken]);
}
