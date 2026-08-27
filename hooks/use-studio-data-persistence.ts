import { useEffect, useRef } from "react";
import { type Snippet, type Folder, type DashboardWidgetType, type DashboardConditionOperator, type DashboardConditionActionType, type DashboardFolder, type Dashboard, type AgentGeneratedWidgetType, type AgentGeneratedWidgetPlan, type AgentDashboardPlan, type AgentChatMessage, type AgentChatHistoryMessage, type SchemaContextTable, type QueryValidationShapeResult, type SqlEditorEngine, type StudioSplitViewState } from "@/lib/studio/types";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";
import { saveKeybindingsFile } from "@/lib/api/actions-client";

interface UseStudioDataPersistenceProps {
  connectionId: number;
  connectionName: string;
  isDataLoaded: boolean;
  isSharedSnippetsLoaded?: boolean;
  queueStudioSave: (key: string, data: any, description: string) => void;
  queueSharedSave?: (key: string, data: any, description: string) => void;
  snippets: Snippet[];
  folders: Folder[];
  openTabs: Array<{ id: string; type: 'table' | 'key' | 'sql' | 'create-table' | 'create-key' | 'create-enum' | 'create-index' | 'create-trigger' | 'create-schema' | 'create-database' | 'dashboard' | 'import-export' | 'history' | 'analytics' | 'advisor' | 'workflow' | 'database-schema' | 'database-tables' | 'database-functions' | 'database-extensions' | 'database-triggers' | 'database-enums' | 'database-indexes' | 'database-rls-policies' | 'database-sessions' | 'database-locks' | 'database-explain-plan' | 'database-backup-restore' | 'database-spacetimedb-reducers' | 'database-spacetimedb-logs' | 'database-spacetimedb-schema' | 'rls-policy-edit' | 'auth-users' | 'auth-sessions' | 'auth-providers' | 'settings' | 'agent-settings' | 'profile-settings' | 'keybindings' | 'connect-studio' | 'manage-workspaces' | 'snapshots' | 'snapshot-table' | 'diff-table'; name: string; schema?: string; query?: string }>;
  activeTabId: string | null;
  sidebarSortMode: 'alphabetical' | 'tags';
  sidebarView: 'dashboard' | 'tables' | 'sql' | 'database' | 'import-export' | 'auth' | 'themes' | 'workflows' | 'agents';
  sidebarBehavior: SidebarBehavior;
  keybindings: Record<string, any>;
  searchSettings: any;
  splitView: StudioSplitViewState;
  tags: Array<{ name: string; color: string }>;
  tableTags: Record<string, string[]>;
  queryHistory: Array<{
    id: string;
    query: string;
    executedAt: number;
    duration: number;
    status: "success" | "error";
    error?: string;
    rowsCount?: number;
    caller: "user" | "system";
    executedBy?: string;
    executedByName?: string;
    connectionName?: string;
  }>;
  isHistoryLoaded: boolean;
}

export function useStudioDataPersistence({
  connectionId,
  connectionName,
  isDataLoaded,
  isSharedSnippetsLoaded = false,
  queueStudioSave,
  queueSharedSave,
  snippets,
  folders,
  openTabs,
  activeTabId,
  sidebarSortMode,
  sidebarView,
  sidebarBehavior,
  keybindings,
  searchSettings,
  splitView,
    tags,
    tableTags,
    queryHistory,
    isHistoryLoaded,
}: UseStudioDataPersistenceProps) {
  const snippetsDidMountRef = useRef(false);
  const dedupeById = <T extends { id: string }>(items: T[]) =>
    Array.from(new Map(items.map((item) => [item.id, item])).values());

  useEffect(() => {
    if (!isDataLoaded) return;
    if (!isSharedSnippetsLoaded) return;
    if (!queueSharedSave) return;
    const sharedSnippets = snippets.filter((snippet) => snippet.isShared);
    const sharedFolderIds = new Set(
      sharedSnippets.map((snippet) => snippet.folderId).filter((id): id is string => Boolean(id))
    );
    const dedupedSnippets = dedupeById(
      sharedSnippets.map(s => ({
        id: s.id,
        name: s.name,
        query: s.query,
        folderId: s.folderId,
        createdAt: s.createdAt
      }))
    );
    const dedupedFolders = dedupeById(
      folders
        .filter((folder) => sharedFolderIds.has(folder.id))
        .map(f => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          createdAt: f.createdAt
        }))
    );
    queueSharedSave("snippets", {
      snippets: dedupedSnippets,
      folders: dedupedFolders,
      allowEmpty: dedupedSnippets.length === 0 && dedupedFolders.length === 0
    }, "snippets");
  }, [snippets, folders, queueSharedSave, isDataLoaded, isSharedSnippetsLoaded]);

  const foldersDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (foldersDidMountRef.current) {
      const dedupedFolders = dedupeById(
        folders.map(f => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          createdAt: f.createdAt
        }))
      );
      queueStudioSave("folders", dedupedFolders, "folders");
    } else {
      foldersDidMountRef.current = true;
    }
  }, [folders, queueStudioSave, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    if (snippetsDidMountRef.current) {
      const dedupedSnippets = dedupeById(
        snippets.map(s => ({
          id: s.id,
          name: s.name,
          query: s.query,
          folderId: s.folderId,
          createdAt: s.createdAt,
          isShared: Boolean(s.isShared)
        }))
      );
      queueStudioSave("snippets", dedupedSnippets, "snippets");
    } else {
      snippetsDidMountRef.current = true;
    }
  }, [snippets, queueStudioSave, isDataLoaded]);

  const tabsDidMountRef = useRef(false);
  const tabsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tabsDidMountRef.current) {
      if (tabsSaveTimeoutRef.current) clearTimeout(tabsSaveTimeoutRef.current);
      tabsSaveTimeoutRef.current = setTimeout(() => {
        queueStudioSave("tabs", openTabs.map((t, index) => ({
          id: t.id,
          type: t.type,
          name: t.name,
          schema: t.schema,
          query: t.query,
          order: index
        })), "tabs");
      }, 1000);
    } else {
      tabsDidMountRef.current = true;
    }
    return () => {
      if (tabsSaveTimeoutRef.current) clearTimeout(tabsSaveTimeoutRef.current);
    };
  }, [openTabs, queueStudioSave, isDataLoaded]);

  const settingsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (settingsDidMountRef.current) {
      queueStudioSave("settings", {
        activeTabId,
        sidebarSortMode,
        sidebarView,
        sidebarBehavior,
        searchSettings: JSON.stringify(searchSettings),
        splitView: JSON.stringify(splitView),
      }, "settings");
    } else {
      settingsDidMountRef.current = true;
    }
  }, [activeTabId, sidebarSortMode, sidebarView, sidebarBehavior, searchSettings, splitView, queueStudioSave, isDataLoaded]);

  // Keybindings are a global preference, saved to keybindings.json rather
  // than per-connection SQLite settings — see lib/db/keybindings-store.ts.
  const keybindingsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (keybindingsDidMountRef.current) {
      void saveKeybindingsFile(keybindings);
    } else {
      keybindingsDidMountRef.current = true;
    }
  }, [keybindings, isDataLoaded]);

  const tagsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tagsDidMountRef.current) {
      queueStudioSave("tags", tags.map(t => ({
        name: t.name,
        color: t.color
      })), "tags");
    } else {
      tagsDidMountRef.current = true;
    }
  }, [tags, queueStudioSave, isDataLoaded]);

  const tableTagsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tableTagsDidMountRef.current) {
      queueStudioSave("table-tags", tableTags, "table tags");
    } else {
      tableTagsDidMountRef.current = true;
    }
  }, [tableTags, queueStudioSave, isDataLoaded]);

  const sharedHistoryDidMountRef = useRef(false);
  const lastSharedHistorySyncAtRef = useRef<number>(0);
  useEffect(() => {
    if (!queueSharedSave) return;
    if (!isDataLoaded) return;
    if (!isHistoryLoaded) return;
    if (sharedHistoryDidMountRef.current) {
      const newEntries = queryHistory.filter(
        (h) => h.executedAt > lastSharedHistorySyncAtRef.current
      );

      if (newEntries.length > 0) {
        const maxExecutedAt = Math.max(
          lastSharedHistorySyncAtRef.current,
          ...newEntries.map((h) => h.executedAt)
        );

        queueSharedSave?.(
          "history",
          {
            defaultConnectionName: connectionName,
            history: newEntries.map((h) => ({
              id: h.id,
              query: h.query,
              executedAt: h.executedAt,
              duration: h.duration,
              status: h.status,
              error: h.error,
              rowsCount: h.rowsCount,
              caller: h.caller,
              executedBy: h.executedBy,
              executedByName: h.executedByName,
              connectionName: h.connectionName || connectionName,
            })),
          },
          "history"
        );

        lastSharedHistorySyncAtRef.current = maxExecutedAt;
      }
    } else {
      sharedHistoryDidMountRef.current = true;
      const initialMax = queryHistory.reduce((max, h) => Math.max(max, h.executedAt), 0);
      lastSharedHistorySyncAtRef.current = initialMax;
    }
  }, [queryHistory, queueSharedSave, isDataLoaded, isHistoryLoaded]);
}
