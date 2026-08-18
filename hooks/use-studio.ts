// fallow-ignore-file code-duplication
"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect, type SetStateAction } from "react";
import { useToggleRowSelection } from "@/hooks/use-selection-utils";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useGlobalEditorTheme } from "@/hooks/use-global-editor-theme";
import { useGlobalAppFontFamily } from "@/hooks/use-global-app-font-family";
import { getWorkspaceSnippets, saveWorkspaceSnippets, saveWorkspaceDashboards, saveWorkspaceHistory, shareSnippetEntry, shareDashboardEntry, unshareEntry, getReceivedSharedSnippets, getReceivedSharedDashboards, updateEntryPermissions } from "@/lib/supabase/workspace";
import { apiFetch, API_BASE } from "@/lib/api-base";
import { toast } from "sonner";
import { useConfirm } from "./use-confirm";
import { format as formatSql } from "sql-formatter";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { type QueryResult } from "@/lib/db/client-types";
import {
  runQuery as apiRunQuery, type SqlEditorRunQueryResult, fetchTables as apiFetchTables,
  fetchViews as apiFetchViews,
  fetchSchemas as apiFetchSchemas,
  fetchDatabases as apiFetchDatabases, fetchRedisKeys, fetchTableStructure, updateTableRows, deleteTableRows, fetchTableForeignKeys, fetchReferencedRecord, createSchema, createDatabase, fetchFunctions, fetchExtensions, toggleExtension, fetchTriggers, fetchEnums, createEnum, deleteEnum, fetchIndexes, deleteIndex, createIndex, createTrigger, getStudioSettings, getStudioTabs, getStudioFolders, getStudioSnippets, getStudioHistory, getStudioTags, getStudioTableTags, saveStudioFolders, saveStudioSnippets, saveStudioHistory, saveStudioTags, saveStudioTableTags, saveStudioTabs, saveStudioSettings, insertHistoryEntry,
  exportDatabaseBundle, importDatabaseBundle, fetchRlsPolicies, fetchPostgresRoles, fetchSupabaseAuthUsers, fetchTableSecurityInfo, getCachedSchemasSnapshot, getCachedTablesSnapshot, createSnippetVersion as apiCreateSnippetVersion, getSnippetVersions as apiGetSnippetVersions, restoreSnippetVersion as apiRestoreSnippetVersion, getTableColumnVisibility, saveTableColumnVisibility, getTablePagination, saveTablePagination
  } from "@/lib/api/actions-client";
import { Connection } from "@/lib/db/schema";
import { getDatabaseFromConnectionString, updateConnectionStringDatabase, getDefaultNewTableColumns } from "@/lib/studio/db-helpers";
import { detectConnectionDbType, getMongoDatabaseFromConnectionString } from "@/lib/db/connection-type";
import { usesDatabaseNamespaces } from "@/lib/db/namespace-display";
import { fetchNamespaceList } from "@/lib/db/namespace-list";
import type { RedisCreateKeyInput, RedisKeyInfo } from "@/types/redis";
import { getRedisKeyCommand, updateRedisConnectionStringDatabase } from "@/lib/db/redis-utils";
import { buildRedisCreateCommands } from "@/lib/db/redis-create-commands";
import { buildShortcutCombo, getDefaultKeybindings, withMissingDefaultKeybindings } from "@/lib/studio/keybindings";
import { generateActionId, executeSqlWithHistory } from "@/lib/studio/execute-with-review";
import type { SettingsSectionId } from "@/components/studio/settings/settings-sidebar";
import type { EditColumnPayload, AddColumnPayload } from "@/components/studio/grid/types";
import {
  Snippet, SnippetVersion, Folder, QueryHistory, UseStudioProps, SnippetExportData, DashboardExportData,
  DashboardWidgetType, DashboardConditionOperator, DashboardConditionActionType, DashboardFolder, Dashboard,
  AgentGeneratedWidgetType, AgentGeneratedWidgetPlan, AgentDashboardPlan, AgentChatMessage, AgentChatHistoryMessage,
  SchemaContextTable, QueryValidationShapeResult, SqlEditorEngine, StudioSplitViewState,
  GLOBAL_SQL_CONTEXT_ID, DASHBOARD_GRID_SIZE, DASHBOARD_MIN_SIZE, type StudioInitialTab, type KVPermission, type DashboardWidget
} from "@/lib/studio/types";
import { snapToDashboardGrid, snapDashboardPosition, snapDashboardSize, normalizeDashboards, normalizeDashboardFolders } from "@/lib/studio/dashboard-utils";
import { buildCreateSql as buildRlsCreateSql, supportsWithCheck, quoteRoles } from "@/lib/db/rls-utils";
import { splitSqlStatements } from "@/lib/studio/split-sql";
import { isJsonColumnType, normalizeJsonInput, stableStringify, inferMongoShape, inferMongoReferenceTarget, mergeById } from "@/lib/studio/general-utils";
import { normalizeCloudFolders, normalizeCloudSnippets, mapStudioSnippet } from "@/lib/studio/cloud-sync-utils";
import { normalizeJsonColumnValue } from "@/lib/studio/data-utils";
import { isDatabaseTabType, TAB_TYPE_TO_DATABASE_VIEW } from "@/lib/studio/tab-types";
import { getViewMode, getTabConfig } from "@/lib/studio/tab-registry";
import { useInitialStudioData } from "./use-initial-studio-data";
import { useSchemaDataLoader } from "./use-schema-data-loader";
import { useStudioPersistence } from "./use-studio-persistence";
import { useConnectionDataLoader } from "./use-connection-data-loader";
import { useDashboardPersistence } from "./use-dashboard-persistence";
import { useFunctionManagement } from "./use-function-management";
import { useAgentChatMessages } from "./use-agent-chat-messages";
import { useStudioDataPersistence } from "./use-studio-data-persistence";
import { useGlobalStudioSettings } from "./use-global-studio-settings";
import { useTableDataMutations } from "./use-table-data-mutations";
import { useTimerCleanup } from "./use-timer-cleanup";
import { useTabPerformanceLogger } from "./use-tab-performance-logger";
import { useWorkspaceContext } from "./use-workspace-context";
import { DEFAULT_SIDEBAR_BEHAVIOR, type SidebarBehavior } from "@/lib/studio/sidebar-behavior";
import { formatDelimitedValue, formatSqlLiteral } from "@/lib/studio/clipboard-utils";
import {
  copySqlToClipboard,
  createSnippetAndPersist,
  validateAgentPrerequisites,
  mergeTableTabSnapshot,
  filterDataForExport,
  closeResultTabsByDirection,
  refreshActiveTableStructure,
} from "@/lib/studio/helpers";
import {
  findPreservedInactiveTableTabId,
  getActiveTableLoadingTabId,
} from "@/lib/studio/table-loading";
import { logStudioDebug } from "@/lib/studio/studio-debug";
import { persistLocalState } from "@/lib/studio/persist-local-state";
import {
  activatePane,
  assignTabToPane,
  closePane,
  createDefaultSplitLayout,
  getFirstPaneId,
  getPaneIds,
  getTabsForPane,
  normalizeSplitLayout,
  resolvePaneForTab,
  splitPane,
  updateSplitRatio,
  getPaneIdAtPosition,
  getDropPosition,
} from "@/lib/studio/split-layout";
import { shouldCloneTabIntoPane } from "@/lib/studio/pane-tab-routing";
import { resolvePaneCloseState } from "@/lib/studio/pane-close";
import { tryAutoClosePane, tryAutoCloseEmptyPanes } from "@/lib/studio/auto-close-pane";
import { filterTabsAfterClose, resolveTabCloseState } from "@/lib/studio/tab-close";
import {
  areTablePermissionContextsEqual,
  buildQueryExecutionContext,
  type SupabaseAuthUserOption,
  type TablePermissionContext,
} from "@/lib/studio/table-permissions";

type ElectronIpcRenderer = {
  on: (ch: string, cb: () => void) => void;
  removeListener: (ch: string, cb: () => void) => void;
};

const PANE_TAB_DELIMITER = "::pane::";

type TableTabSnapshot = {
  results: any;
  tableStructure: any[];
  foreignKeys: any[];
  filterQuery: string;
  sortConfig: { column: string; direction: 'ASC' | 'DESC' } | null;
  page: number;
  pageSize: number;
  totalCount?: number | null;
  permissionContext?: TablePermissionContext;
};







async function readSseStream<T>(response: Response, onEvent: (payload: T) => void): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) {
      const dataLine = raw
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as T);
      } catch {
        // Ignore malformed chunks
      }
    }
  }
}

// ─── Shared helpers (outside hook for testability) ──────────────────────────

// fallow-ignore-next-line code-duplication
function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createEmptyDashboardWidget(opts: { index: number; x: number; y: number; width?: number; height?: number }) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    widgetType: "empty" as const,
    title: `Widget ${opts.index}`,
    query: "",
    tableName: undefined,
    schema: undefined,
    content: "",
    conditions: [],
    x: opts.x,
    y: opts.y,
    width: opts.width ?? 400,
    height: opts.height ?? 240,
  };
}

function cleanupClosedTabCaches(
  removedIds: string[],
  setTabDataCache: React.Dispatch<React.SetStateAction<Record<string, any>>>,
  setSqlTabStates: React.Dispatch<React.SetStateAction<Record<string, any>>>,
) {
// fallow-ignore-next-line code-duplication
  setTabDataCache((prev) => {
    if (!removedIds.some((id) => prev[id])) return prev;
    const next = { ...prev };
    removedIds.forEach((id) => delete next[id]);
    return next;
  });
// fallow-ignore-next-line code-duplication
  setSqlTabStates((prev) => {
    if (!removedIds.some((id) => prev[id])) return prev;
    const next = { ...prev };
    removedIds.forEach((id) => delete next[id]);
    return next;
  });
}

function applyDashboardUpdate(
  dashboardId: string,
  updates: Record<string, unknown>,
  setDashboards: React.Dispatch<React.SetStateAction<any[]>>,
  setOpenTabs: React.Dispatch<React.SetStateAction<any[]>>,
) {
  setDashboards((prev) =>
    prev.map((d) => (d.id !== dashboardId ? d : { ...d, ...updates }))
  );
  if (typeof updates.name === "string" && updates.name) {
    const tabId = `dashboard-${dashboardId}`;
    setOpenTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, name: updates.name as string } : tab)));
  }
}

export function useStudio({ connection: propConnection, initialUiState }: UseStudioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const confirm = useConfirm();
  
  const [connection, setConnection] = useState<Connection>(propConnection);
  const dbType = useMemo(
    () => detectConnectionDbType(connection.connectionString, (connection as any).connectionType),
    [connection.connectionString, (connection as any).connectionType]
  );

  const runQuery = useCallback(
    (
      connectionString: string,
      query: string,
      params: unknown[] = [],
      queryId?: string,
      executionContext?: ReturnType<typeof buildQueryExecutionContext>,
    ) => {
      return apiRunQuery(
        connectionString,
        query,
        params,
        queryId,
        (connection as any).connectionType || dbType,
        executionContext ?? null,
      );
    },
    [connection, dbType]
  );

  const withConnType = useCallback((opts?: any) => ({
    ...opts,
    connectionType: (connection as any).connectionType || dbType,
  }), [connection, dbType]);

  const fetchSchemas = useCallback(
    (connectionString: string, options?: any) => apiFetchSchemas(connectionString, withConnType(options)),
    [withConnType]
  );

  const fetchTables = useCallback(
    (connectionString: string, schema: string, options?: any) => apiFetchTables(connectionString, schema, withConnType(options)),
    [withConnType]
  );

  const fetchDatabases = useCallback(
    (connectionString: string, connectionType?: string) => apiFetchDatabases(connectionString, connectionType || withConnType().connectionType),
    [withConnType]
  );

  const fetchViews = useCallback(
    (connectionString: string, schema: string, options?: any) => apiFetchViews(connectionString, schema, withConnType(options)),
    [withConnType]
  );

  const isSpacetimedb = dbType === "spacetimedb";
  const isMysql = dbType === "mysql";
  const isClickhouse = dbType === "clickhouse";
  const isMssql = dbType === "mssql";
  const createSupport = useMemo(() => {
    const isPostgres = dbType === "postgres" || dbType === "supabase-mgmt";
    const isMongo = dbType === "mongodb";
    const isSqlite = dbType === "sqlite";
    const isRedis = dbType === "redis";
    return {
      table: !isRedis,
      database: !isSqlite && !isRedis,
      schema: (isPostgres || dbType === "mssql") && !isRedis,
      enum: isPostgres,
      index: isPostgres,
      trigger: isPostgres,
      mongo: isMongo,
    };
  }, [dbType]);
  const fallbackSchemaForDb = useMemo(() => {
    if (dbType === "postgres" || dbType === "supabase-mgmt") return "public";
    if (dbType === "mssql") return "dbo";
    if (dbType === "mysql") return getDatabaseFromConnectionString(connection.connectionString);
    if (dbType === "clickhouse") return getDatabaseFromConnectionString(connection.connectionString);
    if (dbType === "redis") return getDatabaseFromConnectionString(connection.connectionString);
    if (dbType === "sqlite") return "main";
    return "";
  }, [dbType, connection.connectionString]);
  // fallow-ignore-next-line code-duplication
  const quoteIdentifier = useCallback((value: string) => {
    const raw = String(value || "");
    if (dbType === "mysql" || dbType === "clickhouse") {
      return `\`${raw.replace(/`/g, "``")}\``;
    }
    if (dbType === "mssql") {
      return `[${raw.replace(/]/g, "]]")}]`;
    }
    return `"${raw.replace(/"/g, '""')}"`;
  }, [dbType]);
  const quoteTableRef = useCallback((schema: string, table: string) => {
    if (dbType === "trino") {
      const parts = String(schema || "").split(".").filter(Boolean);
      if (parts.length >= 2) {
        const [catalog, schemaName] = parts;
        return `${quoteIdentifier(catalog)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(table)}`;
      }
    }
    if (dbType === "spacetimedb") {
      return quoteIdentifier(table);
    }
    return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  }, [quoteIdentifier, dbType]);
  const normalizeNameList = useCallback((values: string[]) => {
    const cleaned = values
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0);
    return Array.from(new Set(cleaned));
  }, []);
  const buildPlaceholders = useCallback((count: number) => {
    if (dbType === "mysql" || dbType === "clickhouse" || dbType === "mssql") {
      return Array.from({ length: count }, () => "?").join(", ");
    }
    return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(", ");
  }, [dbType]);
  const workspaceContext = useWorkspaceContext({
    connectionId: connection.id,
    connectionName: connection.name || "Workspace",
  });
  const storageMode = workspaceContext.storageMode;
  const canUseCloudSnippets = workspaceContext.storageMode === "cloud" && Boolean(workspaceContext.workspaceId && workspaceContext.accessToken);
  const canUseCloudDashboards = workspaceContext.storageMode === "cloud" && Boolean(workspaceContext.workspaceId && workspaceContext.accessToken);
  const [query, _setQuery] = useState<string>(
    dbType === "mongodb"
      ? "db.collection.find({}).limit(100)"
      : dbType === "redis"
        ? "PING"
      : dbType === "clickhouse"
        ? "SELECT * FROM system.tables LIMIT 10;"
        : dbType === "mssql"
          ? "SELECT TOP 10 * FROM information_schema.tables;"
        : "SELECT * FROM information_schema.tables LIMIT 10;",
  );
  const queryRef = useRef(query);
  const autoSaveQueriesRef = useRef(false);
  const autoSaveCounterRef = useRef(0);

  const setQuery = useCallback((newQuery: string) => {
    _setQuery(newQuery);
    queryRef.current = newQuery;
    const id = activeTabIdRef.current;
    if (!id) return;
    setOpenTabs((prev) => {
      const tab = prev.find((t) => t.id === id);
      if (!tab || tab.type !== 'sql') return prev;
      const baseline = tab.query ?? '';
      return prev.map((t) =>
        t.id === id
          ? { ...t, query: newQuery, dirty: newQuery !== baseline, isPreview: false }
          : t
      );
    });
  }, []);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const [tables, setTables] = useState<string[]>(() => initialUiState?.tables ?? []);
  const [viewTables, setViewTables] = useState<string[]>([]);
  const [tableSecurity, setTableSecurity] = useState<Record<string, { rlsEnabled: boolean; policyCount: number }>>({});
  const [redisKeys, setRedisKeys] = useState<RedisKeyInfo[]>([]);
  const [fetchingRedisKeys, setFetchingRedisKeys] = useState(false);
  const [schemas, setSchemas] = useState<string[]>(() => initialUiState?.schemas ?? []);
  const [databases, setDatabases] = useState<string[]>([]);
  const [currentDatabase, setCurrentDatabase] = useState<string>(getDatabaseFromConnectionString(propConnection.connectionString));
  const [currentConnectionString, setCurrentConnectionString] = useState<string>(propConnection.connectionString);
  const [selectedSchema, setSelectedSchema] = useState<string>(() => searchParams.get("s") || initialUiState?.selectedSchema || "");
  const [selectedTable, setSelectedTable] = useState<string | null>(searchParams.get("t"));

  useEffect(() => {
    if (dbType !== "redis") {
      setRedisKeys([]);
      setFetchingRedisKeys(false);
    }
  }, [dbType]);
  const selectedSchemaRef = useRef(selectedSchema);
  const selectedTableRef = useRef(selectedTable);
  const tableRefreshRequestIdRef = useRef(0);
  const tabRefreshRequestIdsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    selectedSchemaRef.current = selectedSchema;
    selectedTableRef.current = selectedTable;
  }, [selectedSchema, selectedTable]);

  const handleSetSelectedSchema = useCallback((schema: string) => {
    if (schema !== selectedSchema) {
      setSelectedSchema(schema);
      setSelectedTable(null);
      setTables([]);
    }
  }, [selectedSchema]);

  const handleSetSelectedTable = useCallback((table: string | null) => {
    setSelectedTable(table);
    setPage(0);
    setTotalCount(null);
  }, []);
  const [tableStructure, setTableStructure] = useState<Array<{
    column_name: string;
    data_type: string;
    udt_name?: string;
    is_nullable: string;
    column_default: string | null;
    is_primary_key: boolean;
    is_foreign_key: boolean;
  }>>([]);
  const [results, setResults] = useState<any>(null);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [tableLoadingById, setTableLoadingById] = useState<Record<string, boolean>>({});
  const [executionTime, setExecutionTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const parseRowId = useCallback((rowId: string): Record<string, any> => {
    const where: Record<string, any> = {};
    rowId.split('|').forEach(part => {
      const firstColonIndex = part.indexOf(':');
      const col = part.substring(0, firstColonIndex);
      const val = part.substring(firstColonIndex + 1);
      where[col] = val;
    });
    return where;
  }, []);

  const loadData = useCallback(
    async <T>(
      setFetching: (v: boolean) => void,
      setData: (data: T) => void,
      fetchFn: () => Promise<{ success: boolean; data?: T; error?: string }>
    ) => {
      setFetching(true);
      try {
        const res = await fetchFn();
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.error || "Unknown error");
        }
      } finally {
        setFetching(false);
      }
    },
    [setError]
  );

  const updateTableStructureCache = useCallback((structRes: any, fkRes: any, tabId: string) => {
    if (structRes?.success && structRes.data) {
      setTableStructure(structRes.data);
      setTabDataCache(prev => ({ ...prev, [tabId]: { ...prev[tabId], tableStructure: structRes.data } }));
    }
    if (fkRes?.success && fkRes.data) {
      setForeignKeys(fkRes.data);
      setTabDataCache(prev => ({ ...prev, [tabId]: { ...prev[tabId], foreignKeys: fkRes.data } }));
    }
  }, []);

  const [fetchingTables, setFetchingTables] = useState(true);
  const [fetchingSchemas, setFetchingSchemas] = useState(true);
  const [fetchingInitialData, setFetchingInitialData] = useState(!!searchParams.get("t"));
  const [isInitialLoad, setIsInitialLoad] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isSharedSnippetsLoaded, setIsSharedSnippetsLoaded] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!fetchingTables && !fetchingSchemas && !fetchingInitialData && isDataLoaded) {
      setIsInitialLoad(false);
    }
  }, [fetchingTables, fetchingSchemas, fetchingInitialData, isDataLoaded]);
  const [fetchingStructure, setFetchingStructure] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; columnName: string } | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [hiddenColumnNames, setHiddenColumnNames] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnName: string; value: string } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, Record<string, { old: any; new: any }>>>({});
  const [tabDataCache, setTabDataCache] = useState<Record<string, TableTabSnapshot>>({});
  const tableTabSnapshotRef = useRef<Record<string, TableTabSnapshot>>({});
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<Array<{
    id: string;
    type: 'add_column' | 'delete_column' | 'rename_column' | 'edit_column' | 'create_table' | 'delete_table' | 'create_enum' | 'delete_enum' | 'create_index' | 'delete_index' | 'create_trigger' | 'delete_trigger' | 'create_schema' | 'delete_schema' | 'create_database' | 'delete_database' | 'delete_row' | 'insert_row' | 'duplicate_row' | 'duplicate_table' | 'empty_table' | 'delete_function' | 'update_function' | 'create_rls_policy' | 'update_rls_policy' | 'delete_rls_policy' | 'add_fk' | 'redis_command';
    description: string;
    sql: string;
    params?: any[];
    metadata: any;
  }>>([]);
  const [isReviewSheetOpen, setIsReviewSheetOpen] = useState(false);
  const [foreignKeys, setForeignKeys] = useState<Array<{
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>>([]);
  const [fkPreviewRecord, setFKPreviewRecord] = useState<{
    data: any;
    fields: any;
    schema: string;
    table: string;
    column: string;
    value: any;
    loading?: boolean;
  } | null>(null);
  const [isFKSelectionSheetOpen, setIsFKSelectionSheetOpen] = useState(false);
  const [fkSelectionTarget, setFKSelectionTarget] = useState<{
    rowIndex: number | null;
    columnName: string;
    fkInfo: any;
  } | null>(null);
  const [fkSelectionData, setFKSelectionData] = useState<any>(null);
  const [fkSelectionLoading, setFKSelectionLoading] = useState(false);
  const [fkSelectionSearch, setFKSelectionSearch] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingTrigger, setIsDeletingTrigger] = useState(false);
  const [isDeletingSchema, setIsDeletingSchema] = useState(false);
  const [isDeletingDatabase, setIsDeletingDatabase] = useState(false);
  const [openTabs, setOpenTabs] = useState<StudioInitialTab[]>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const restoreKey = `rexa-db-restore-state-${propConnection.id}`;
      const shouldRestore = window.localStorage.getItem(restoreKey) !== "0";
      if (!shouldRestore) {
        window.localStorage.removeItem(`rexa-db-tabs-${propConnection.id}`);
        window.localStorage.removeItem(`rexa-db-active-tab-${propConnection.id}`);
      } else {
        const storageKey = `rexa-db-tabs-${propConnection.id}`;
        try {
          const cached = window.localStorage.getItem(storageKey);
          if (cached) return JSON.parse(cached);
        } catch {}
      }
    }

    const tabs = initialUiState?.openTabs ?? [];
    if (tabs.length === 0) {
      const defaultQuery = dbType === "mongodb"
        ? "db.collection.find({}).limit(100)"
        : dbType === "redis"
          ? "PING"
        : dbType === "clickhouse"
          ? "SELECT * FROM system.tables LIMIT 10;"
          : dbType === "mssql"
            ? "SELECT TOP 10 * FROM information_schema.tables;"
          : "SELECT * FROM information_schema.tables LIMIT 10;";
      return [{ id: GLOBAL_SQL_CONTEXT_ID, type: "sql", name: "Query 1", query: defaultQuery }];
    }
    return tabs;
  });

  const markTabDirty = useCallback((tabId: string) => {
    setOpenTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, dirty: true } : t)));
  }, []);

  const markTabClean = useCallback((tabId: string) => {
    setOpenTabs((prev) => prev.map((t) =>
      t.id === tabId ? { ...t, dirty: false, query: t.type === 'sql' ? queryRef.current : t.query } : t
    ));
  }, []);

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    let restoredId: string | null = null;
    if (typeof window !== "undefined" && window.localStorage) {
      const restoreKey = `rexa-db-restore-state-${propConnection.id}`;
      const shouldRestore = window.localStorage.getItem(restoreKey) !== "0";
      if (shouldRestore) {
        const storageKey = `rexa-db-active-tab-${propConnection.id}`;
        try {
          const cached = window.localStorage.getItem(storageKey);
          if (cached) restoredId = cached;
        } catch {}
      }
    }

    const candidateId = restoredId || initialUiState?.activeTabId || (openTabs[0]?.id || null);

    if (candidateId && openTabs.length > 0) {
      const exists = openTabs.some(t => t.id === candidateId);
      if (exists) return candidateId;
      return openTabs[0].id;
    }

    return openTabs.length > 0 ? (candidateId || openTabs[0].id) : null;
  });
  const activeTabIdRef = useRef<string | null>(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTableTabId = useMemo(
    () => getActiveTableLoadingTabId(openTabs, activeTabId),
    [openTabs, activeTabId]
  );
  const tableLoading = activeTableTabId ? !!tableLoadingById[activeTableTabId] : false;

  const getTabBaseId = useCallback((tab: Pick<StudioInitialTab, "id" | "baseId">) => {
    if (tab.baseId) return tab.baseId;
    const tabId = String(tab.id || "");
    const paneSuffixIndex = tabId.indexOf(PANE_TAB_DELIMITER);
    return paneSuffixIndex >= 0 ? tabId.slice(0, paneSuffixIndex) : tabId;
  }, []);

  // Local persistence for immediate recovery on tab change
  useEffect(() => {
    persistLocalState(connection.id, {
      [`rexa-db-tabs-${connection.id}`]: openTabs ? JSON.stringify(openTabs) : null,
      [`rexa-db-active-tab-${connection.id}`]: activeTabId ?? null,
    });
  }, [openTabs, activeTabId, connection.id]);

  const [splitView, setSplitView] = useState<StudioSplitViewState>(() => createDefaultSplitLayout(activeTabId));
  const openTabsRef = useRef(openTabs);
  const splitViewRef = useRef(splitView);
  const [keybindings, setKeybindings] = useState<Record<string, any>>({});
  const [searchSettings, setSearchSettings] = useState<any>({
    placeholder: "Search or run commands...",
    showShortcut: true,
    localIndexEnabled: false,
  });
  const [pendingSearchValue, setPendingSearchValue] = useState<string | null>(null);

  useEffect(() => {
    setSplitView((prev) => normalizeSplitLayout(prev, openTabs.map((tab) => tab.id), activeTabId));
  }, [openTabs, activeTabId]);
  useLayoutEffect(() => {
    openTabsRef.current = openTabs;
    splitViewRef.current = splitView;
  }, [openTabs, splitView]);
  const activePaneIdRef = useRef(splitView.activePaneId);
  useEffect(() => {
    activePaneIdRef.current = splitView.activePaneId;
  }, [splitView.activePaneId]);

  const getCurrentPaneId = useCallback((overridePaneId?: string | null, state?: StudioSplitViewState) => {
    const layout = state ?? splitView;
    return overridePaneId || activePaneIdRef.current || layout.activePaneId || getFirstPaneId(layout.root);
  }, [splitView]);

  const [snippetSplitDrag, setSnippetSplitDrag] = useState<{
    snippet: Snippet;
    mouseX: number;
    mouseY: number;
    contentAreaRect: DOMRect | null;
  } | null>(null);
  const snippetSplitDragRef = useRef(snippetSplitDrag);
  useEffect(() => {
    snippetSplitDragRef.current = snippetSplitDrag;
  }, [snippetSplitDrag]);

  const startSnippetSplitDrag = useCallback((snippet: Snippet, mouseX: number, mouseY: number) => {
    setSnippetSplitDrag({ snippet, mouseX, mouseY, contentAreaRect: null });
  }, []);

  const updateSnippetSplitDrag = useCallback((mouseX: number, mouseY: number) => {
    setSnippetSplitDrag((prev) => prev ? { ...prev, mouseX, mouseY } : null);
  }, []);

  const openTabInPane = (tab: { id: string; type: string; name: string }, paneId: string) => {
    setOpenTabs((prev: any[]) => [...prev, tab]);
    setSplitView((prev: any) => {
      const next = assignTabToPane(prev, tab.id, paneId, true);
      return { ...next, activePaneId: paneId };
    });
    setActiveTabId(tab.id);
  };

  const endSnippetSplitDrag = useCallback(() => {
    const drag = snippetSplitDragRef.current;
    if (!drag) return;

    const currentSplit = splitViewRef.current;
    if (!getFirstPaneId(currentSplit.root)) {
      setSnippetSplitDrag(null);
      return;
    }

    const indicator = getSplitIndicator(drag);
    if (!indicator) {
      setSnippetSplitDrag(null);
      return;
    }
    const { paneId, position } = indicator;
    if (!position || position === "center") {
      const baseTabId = `sql-new-${uid()}`;
      const tabId = splitViewRef.current.enabled ? `${baseTabId}::pane::${currentSplit.activePaneId}` : baseTabId;
      const newTab = {
        id: tabId,
        type: 'sql' as const,
        name: drag.snippet.name,
        query: drag.snippet.query
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setQuery(drag.snippet.query);
      setSnippetSplitDrag(null);
      return;
    }

    const { newLayout, newPaneId } = computeSplitLayout(currentSplit, paneId, position);
    setSplitView(newLayout);

    setTimeout(() => {
      const tabId = `sql-${drag.snippet.id}-${uid()}`;
      openTabInPane({ id: tabId, type: 'sql', name: drag.snippet.name }, newPaneId);
      setQuery(drag.snippet.query);
    }, 0);

    setSnippetSplitDrag(null);
  }, [assignTabToPane]);

  const getSplitIndicator = useCallback((drag: { mouseX: number; mouseY: number } | null) => {
    if (!drag) return null;
    const currentSplit = splitViewRef.current;
    const contentArea = document.querySelector('[data-studio-content-area]') as HTMLElement;
    if (!contentArea) return null;
    const contentRect = contentArea.getBoundingClientRect();
    const x = drag.mouseX - contentRect.left;
    const y = drag.mouseY - contentRect.top;
    const paneId = getPaneIdAtPosition(currentSplit.root, x, y, contentRect.width, contentRect.height);
    if (!paneId) return null;
    const position = getDropPosition(x, y, contentRect.width, contentRect.height, paneId, currentSplit);
    if (!position) return null;
    return { position, paneId };
  }, []);

  const getSnippetSplitIndicator = useCallback(() => {
    const drag = snippetSplitDragRef.current;
    if (!drag) return null;
    const firstPaneId = getFirstPaneId(splitViewRef.current.root);
    if (!firstPaneId) return null;
    return getSplitIndicator(drag);
  }, []);

  const [dashboardSplitDrag, setDashboardSplitDrag] = useState<{
    dashboard: { id: string; name: string };
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const dashboardSplitDragRef = useRef(dashboardSplitDrag);
  useEffect(() => {
    dashboardSplitDragRef.current = dashboardSplitDrag;
  }, [dashboardSplitDrag]);

  const startDashboardSplitDrag = useCallback((dashboard: { id: string; name: string }, mouseX: number, mouseY: number) => {
    setDashboardSplitDrag({ dashboard, mouseX, mouseY });
  }, []);

  const endDashboardSplitDrag = useCallback(() => {
    const drag = dashboardSplitDragRef.current;
    if (!drag) return;

    const currentSplit = splitViewRef.current;
    const indicator = getSplitIndicator(drag);
    if (!indicator) {
      setDashboardSplitDrag(null);
      return;
    }
    const { paneId, position } = indicator;
    if (!position || position === "center") {
      const targetPaneId = activePaneIdRef.current || currentSplit.activePaneId || getFirstPaneId(currentSplit.root);
      const tabId = `dashboard_${drag.dashboard.id}`;
      const paneScopedTabId = currentSplit.enabled ? `${tabId}::pane::${targetPaneId}` : tabId;
      const newTab = { id: paneScopedTabId, type: "dashboard" as const, name: drag.dashboard.name };
      setOpenTabs((prev) => [...prev, newTab]);
      if (currentSplit.enabled) {
        setSplitView((prev) => {
          const next = assignTabToPane(prev, paneScopedTabId, targetPaneId, true);
          return { ...next, activePaneId: targetPaneId };
        });
      }
      setActiveTabId(paneScopedTabId);
      setDashboardSplitDrag(null);
      return;
    }

    const { newLayout, newPaneId } = computeSplitLayout(currentSplit, paneId, position);
    setSplitView(newLayout);

    setTimeout(() => {
      const tabId = `dashboard_${drag.dashboard.id}_${uid()}`;
      openTabInPane({ id: tabId, type: 'dashboard', name: drag.dashboard.name }, newPaneId);
    }, 0);

    setDashboardSplitDrag(null);
  }, [assignTabToPane]);

  const [tabSplitDrag, setTabSplitDrag] = useState<{
    tab: any;
    mouseX: number;
    mouseY: number;
    sourcePaneId: string;
  } | null>(null);
  const tabSplitDragRef = useRef(tabSplitDrag);
  useEffect(() => {
    tabSplitDragRef.current = tabSplitDrag;
  }, [tabSplitDrag]);

  const startTabSplitDrag = useCallback((tab: any, mouseX: number, mouseY: number, sourcePaneId: string) => {
    const next = { tab, mouseX, mouseY, sourcePaneId };
    tabSplitDragRef.current = next;
    setTabSplitDrag(next);
  }, []);

  const updateTabSplitDrag = useCallback((mouseX: number, mouseY: number) => {
    setTabSplitDrag((prev) => {
      if (!prev) return null;
      const next = { ...prev, mouseX, mouseY };
      tabSplitDragRef.current = next;
      return next;
    });
  }, []);

  const endTabSplitDrag = useCallback(() => {
    const drag = tabSplitDragRef.current;
    if (!drag) return;

    const currentSplit = splitViewRef.current;
    const indicator = getSplitIndicator(drag);
    if (!indicator) {
      setTabSplitDrag(null);
      return;
    }
    const { paneId, position } = indicator;

    if (position === "center") {
      if (paneId === drag.sourcePaneId) {
        setTabSplitDrag(null);
        return;
      }

      setSplitView((prev) => {
        const sourceTabs = getTabsForPane(openTabsRef.current.map((t: any) => t.id), prev, drag.sourcePaneId);
        const nextSourceActiveTab = sourceTabs.filter((id) => id !== drag.tab.id)[0] ?? null;
        return {
          ...prev,
          activePaneId: paneId,
          paneState: {
            ...prev.paneState,
            [drag.sourcePaneId]: { activeTabId: nextSourceActiveTab },
            [paneId]: { activeTabId: drag.tab.id },
          },
          tabPaneMap: {
            ...prev.tabPaneMap,
            [drag.tab.id]: paneId,
          },
        };
      });
      setActiveTabId(drag.tab.id);
    } else if (position) {
      const { newLayout, newPaneId } = computeSplitLayout(currentSplit, paneId, position);

      const sourceTabs = getTabsForPane(openTabsRef.current.map((t: any) => t.id), currentSplit, drag.sourcePaneId);
      const nextSourceActiveTab = sourceTabs.filter((id) => id !== drag.tab.id)[0] ?? null;

      setSplitView({
        ...newLayout,
        activePaneId: newPaneId,
        paneState: {
          ...newLayout.paneState,
          [drag.sourcePaneId]: { activeTabId: nextSourceActiveTab },
          [newPaneId]: { activeTabId: drag.tab.id },
        },
        tabPaneMap: {
          ...newLayout.tabPaneMap,
          [drag.tab.id]: newPaneId,
        },
      });
      setActiveTabId(drag.tab.id);
    }

    setTabSplitDrag(null);
  }, []);

  const cancelTabSplitDrag = useCallback(() => {
    tabSplitDragRef.current = null;
    setTabSplitDrag(null);
  }, []);

  const computeSplitLayout = useCallback((currentSplit: StudioSplitViewState, paneId: string, position: string) => {
    const direction = position === "left" || position === "right" ? "vertical" : "horizontal";
    const splitOnRightOrBottom = position === "left" || position === "top";
    const newLayout = splitPane(currentSplit, paneId, direction, splitOnRightOrBottom);
    const newPaneId = newLayout.activePaneId;
    return { newLayout, newPaneId };
  }, [splitPane]);

  const getTabSplitIndicator = useCallback(() => {
    const drag = tabSplitDragRef.current;
    if (!drag) return null;
    return getSplitIndicator(drag);
  }, []);

  const getPaneIdForTab = useCallback((tabId: string, state?: StudioSplitViewState) => {
    const layout = state ?? splitView;
    return resolvePaneForTab(layout, tabId);
  }, [splitView]);

  const buildPaneScopedTabId = useCallback((baseId: string, paneId: string, tabs: StudioInitialTab[]) => {
    let nextId = `${baseId}${PANE_TAB_DELIMITER}${paneId}`;
    let suffix = 1;
    while (tabs.some((tab) => tab.id === nextId)) {
      suffix += 1;
      nextId = `${baseId}${PANE_TAB_DELIMITER}${paneId}${PANE_TAB_DELIMITER}${suffix}`;
    }
    return nextId;
  }, []);

  const resolveActiveTableTabId = useCallback((schema: string | null | undefined, tableName: string | null | undefined, explicitTabId?: string | null) => {
    if (explicitTabId) return explicitTabId;
    const activeTab = activeTabIdRef.current
      ? openTabs.find((tab) => tab.id === activeTabIdRef.current)
      : null;
    if (activeTab?.type === "table" && activeTab.schema === schema && activeTab.name === tableName) {
      return activeTab.id;
    }
    if (schema && tableName) {
      const matchingTab = openTabs.find((tab) => tab.type === "table" && tab.schema === schema && tab.name === tableName && getPaneIdForTab(tab.id) === getCurrentPaneId());
      if (matchingTab) return matchingTab.id;
      return `table-${schema}-${tableName}`;
    }
    return null;
  }, [openTabs, getPaneIdForTab, getCurrentPaneId]);

  const [viewMode, setViewMode] = useState<"tables" | "sql" | "code" | "database" | "dashboard" | "create-table" | "create-key" | "create-enum" | "create-index" | "create-trigger" | "create-schema" | "create-database" | "import-export" | "settings" | "agent-settings" | "profile-settings" | "keybindings" | "history" | "auth" | "rls-policy-edit" | "analytics" | "advisor" | "connect-studio" | "manage-workspaces" | "snapshots" | "snapshot-table" | "diff-table" | "workflow">("tables");
  const [schemaHighlightedTable, setSchemaHighlightedTable] = useState<string | null>(null);



  const [databaseView, setDatabaseView] = useState<"schema" | "tables" | "functions" | "extensions" | "triggers" | "enums" | "indexes" | "rls-policies" | "sessions" | "locks" | "explain-plan" | "backup-restore">("schema");

  const [functions, setFunctions] = useState<any[]>([]);
  const [fetchingFunctions, setFetchingFunctions] = useState(false);
  const [extensions, setExtensions] = useState<any[]>([]);
  const [fetchingExtensions, setFetchingExtensions] = useState(false);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [fetchingTriggers, setFetchingTriggers] = useState(false);
  const triggersLoadedRef = useRef<{ conn: string; schema: string } | null>(null);
  const [enums, setEnums] = useState<any[]>([]);
  const [fetchingEnums, setFetchingEnums] = useState(false);
  const [indexes, setIndexes] = useState<any[]>([]);
  const [fetchingIndexes, setFetchingIndexes] = useState(false);
  const [allSchemaTables, setAllSchemaTables] = useState<Array<{ schema: string; name: string }>>([]);
  const [allSchemaViews, setAllSchemaViews] = useState<Array<{ schema: string; name: string }>>([]);
  const [fetchingAllSchema, setFetchingAllSchema] = useState(false);
  const [rlsPolicies, setRlsPolicies] = useState<any[]>([]);
  const [postgresRoles, setPostgresRoles] = useState<string[]>([]);
  const [supabaseAuthUsers, setSupabaseAuthUsers] = useState<SupabaseAuthUserOption[]>([]);
  const [fetchingTablePermissionOptions, setFetchingTablePermissionOptions] = useState(false);
  const [fetchingRlsPolicies, setFetchingRlsPolicies] = useState(false);
  const [rlsTableFilter, setRlsTableFilter] = useState("");
  const [rlsPolicyEditData, setRlsPolicyEditData] = useState<Record<string, { policy?: any; prefillSchema?: string; prefillTable?: string }>>({});
  const [rlsPolicyFilter, setRlsPolicyFilter] = useState("");
  const rlsPoliciesRequestIdRef = useRef(0);
  const tablePermissionOptionsRequestIdRef = useRef(0);
  const sqlTabRunRequestIdRef = useRef<Record<string, number>>({});
  const sqlTabTimerRef = useRef<Record<string, NodeJS.Timeout | null>>({});
  type ResultTabInfo = {
    id: string;
    label: string;
    query: string;
    results: (QueryResult & { executionTime: number }) | null;
    error: string | null;
    executionTime: number;
  };
  type SqlTabData = {
    loading: boolean;
    executionTime: number;
    error: string | null;
    results: (QueryResult & { executionTime: number }) | null;
    activeQueryId: string | null;
    activeQueryIds: string[];
    resultTabs: ResultTabInfo[];
    activeResultTabId: string | null;
  };
  const [sqlTabStates, setSqlTabStates] = useState<Record<string, SqlTabData>>({});





  // Table Tagging and Sidebar View State
  const [tags, setTags] = useState<Array<{ name: string; color: string }>>([]);

  const [tableTags, setTableTags] = useState<Record<string, string[]>>({});


  const [sidebarSortMode, setSidebarSortMode] = useState<'alphabetical' | 'tags'>('alphabetical');

// fallow-ignore-next-line code-duplication
  const [sidebarView, setSidebarViewState] = useState<"dashboard" | "tables" | "sql" | "database" | "import-export" | "auth" | "themes" | "workflows" | null>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const restoreKey = `rexa-db-restore-state-${propConnection.id}`;
      if (window.localStorage.getItem(restoreKey) !== "0") {
        const storageKey = `rexa-db-sidebar-view-${propConnection.id}`;
        const cached = window.localStorage.getItem(storageKey);
        if (cached) return cached as any;
      }
    }
    return "tables";
  });
  const setSidebarView = useCallback((nextView: SetStateAction<"dashboard" | "tables" | "sql" | "database" | "import-export" | "auth" | "themes" | "workflows" | null>) => {
    delayedUiRestoreBlockedRef.current = true;
    setSidebarViewState(nextView);
  }, []);
  const sidebarViewRef = useRef(sidebarView);
  const lastSidebarViewRef = useRef<
    "dashboard" | "tables" | "sql" | "database" | "import-export" | "auth" | "themes" | "workflows"
  >("tables");
  useEffect(() => {
    sidebarViewRef.current = sidebarView;
    if (sidebarView) lastSidebarViewRef.current = sidebarView;
  }, [sidebarView]);

  // Local persistence for immediate recovery on sidebar view change
  useEffect(() => {
    if (!sidebarView) return;
    persistLocalState(connection.id, {
      [`rexa-db-sidebar-view-${connection.id}`]: sidebarView,
    });
  }, [sidebarView, connection.id]);
  const [isImportExportLoading, setIsImportExportLoading] = useState(false);
  const [importExportProgress, setImportExportProgress] = useState<{
    title: string;
    steps: string[];
    currentStep: number;
  } | null>(null);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [dashboardFolders, setDashboardFolders] = useState<DashboardFolder[]>([]);

  const [snippets, setSnippets] = useState<Snippet[]>([]);

  const [receivedSharedSnippets, setReceivedSharedSnippets] = useState<any[]>([]);
  const [receivedSharedDashboards, setReceivedSharedDashboards] = useState<any[]>([]);
  const [sharingSnippetId, setSharingSnippetId] = useState<string | null>(null);
  const [sharingDashboardId, setSharingDashboardId] = useState<string | null>(null);

  const [folders, setFolders] = useState<Folder[]>([]);

  const [schemaData, setSchemaData] = useState<any>({});
  const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [isShortcutNavigatorOpen, setIsShortcutNavigatorOpen] = useState(false);
// fallow-ignore-next-line code-duplication
  const [isSidebarVisible, setIsSidebarVisibleState] = useState(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const restoreKey = `rexa-db-restore-state-${propConnection.id}`;
      if (window.localStorage.getItem(restoreKey) !== "0") {
        const storageKey = `rexa-db-sidebar-visible-${propConnection.id}`;
        const cached = window.localStorage.getItem(storageKey);
        if (cached !== null) return cached === "1";
      }
    }
    return true;
  });
  const setIsSidebarVisible = useCallback((nextVisible: SetStateAction<boolean>) => {
    delayedUiRestoreBlockedRef.current = true;
    setIsSidebarVisibleState(nextVisible);
  }, []);
  const isSidebarVisibleRef = useRef(isSidebarVisible);
  useEffect(() => {
    isSidebarVisibleRef.current = isSidebarVisible;
  }, [isSidebarVisible]);

  // Local persistence for immediate recovery on sidebar change
  useEffect(() => {
    persistLocalState(connection.id, {
      [`rexa-db-sidebar-visible-${connection.id}`]: isSidebarVisible ? "1" : "0",
    });
  }, [isSidebarVisible, connection.id]);
  const [sidebarBehaviorState, setSidebarBehaviorState] = useState<SidebarBehavior>(DEFAULT_SIDEBAR_BEHAVIOR);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const isNavigationRailExpanded = sidebarBehaviorState === "open" || (sidebarBehaviorState === "expandable" && isSidebarHovered);
  const applySidebarBehavior = useCallback((behavior: SidebarBehavior) => {
    setSidebarBehaviorState(behavior);
    if (behavior !== "expandable") {
      setIsSidebarHovered(false);
    }
  }, []);
  const setSidebarBehavior = useCallback((behavior: SidebarBehavior) => {
    delayedUiRestoreBlockedRef.current = true;
    applySidebarBehavior(behavior);
  }, [applySidebarBehavior]);
  const setSidebarHoverOpen = useCallback((hovered: boolean) => {
    setIsSidebarHovered(hovered);
  }, []);

  /** Toggle primary sidebar for classic + Modern UI (used by hotkeys & chrome). */
  const toggleSidebar = useCallback(() => {
    const isOpen =
      sidebarViewRef.current !== null || isSidebarVisibleRef.current;
    if (isOpen) {
      if (sidebarViewRef.current) {
        lastSidebarViewRef.current = sidebarViewRef.current;
      }
      setSidebarView(null);
      setIsSidebarVisible(false);
    } else {
      setIsSidebarVisible(true);
      setSidebarView(lastSidebarViewRef.current ?? "tables");
    }
  }, [setSidebarView, setIsSidebarVisible]);

  // New settings based on image
  const studioSettings = useGlobalStudioSettings(true);
  const {
    executionMode,
    tuiMode,
    tuiTheme,
    agentProvider,
    agentModel,
    agentApiKey,
    schemaExplorer,
    databaseExplorer,
    tableExpansion,
    autoClosePane,
    autoSaveQueries,
    resultTabsEnabled,
    previewTabs,
    sqlFormatTabWidth,
    sqlFormatUseTabs,
    sqlFormatKeywordCase,
    sqlFormatDataTypeCase,
    sqlFormatFunctionCase,
    sqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon,
  } = studioSettings;

  useEffect(() => {
    autoSaveQueriesRef.current = autoSaveQueries;
  }, [autoSaveQueries]);

  const {
    editorThemeId,
    setEditorThemeId,
    customEditorThemes,
    setCustomEditorThemes,
  } = useGlobalEditorTheme(true);

  const {
    appThemeId,
    setAppThemeId,
    customAppThemes,
    setCustomAppThemes,
    appEditorTheme,
  } = useGlobalAppTheme(true);

  const {
    customFontFamily,
    setCustomFontFamily,
  } = useGlobalAppFontFamily(true);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep latest user info in refs for use in callbacks (like addHistoryEntry)
  // to avoid stale closures and unnecessary recreation of functions
  const userIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string | null>(null);
  const userEmailRef = useRef<string | null>(null);

  useEffect(() => {
    userIdRef.current = workspaceContext.userId;
    userNameRef.current = workspaceContext.userName;
    userEmailRef.current = workspaceContext.userEmail;
  }, [workspaceContext.userId, workspaceContext.userName, workspaceContext.userEmail]);

  const { queueStudioSave, queueSharedSave } = useStudioPersistence({
    connectionId: connection.id,
    workspaceId: workspaceContext.workspaceId,
    accessToken: workspaceContext.accessToken,
  });

  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;

  const { loadInitialDataWithConn } = useConnectionDataLoader({
    setFetchingSchemas,
    setSchemas,
    setSelectedSchema,
    setTables,
    setViewTables,
    setTableSecurity,
    setFunctions,
    setExtensions,
    setTriggers,
    setEnums,
    setIndexes,
    setRlsPolicies,
    setPostgresRoles,
  });

  const addHistoryEntry = useCallback((entry: Omit<QueryHistory, 'id' | 'executedAt'>) => {
    const executedBy = entry.executedBy ?? userIdRef.current ?? "local";
    const executedByName = entry.executedByName ?? userNameRef.current ?? userEmailRef.current ?? "Local";
    const newEntry: QueryHistory = {
      ...entry,
      id: uid(),
      executedAt: Date.now(),
      executedBy,
      executedByName,
      connectionName: entry.connectionName ?? connection.name ?? undefined,
    };

    // Write directly to DB — no batch sync, no race conditions
    const capturedConnectionId = connection.id;
    insertHistoryEntry(capturedConnectionId, {
      id: newEntry.id,
      query: newEntry.query,
      executedAt: newEntry.executedAt,
      duration: newEntry.duration ?? 0,
      status: newEntry.status,
      error: newEntry.error ?? null,
      rowsCount: newEntry.rowsCount ?? null,
      caller: newEntry.caller ?? "user",
      executedBy: newEntry.executedBy,
      executedByName: newEntry.executedByName,
    }).then(res => {
      if (!res.success) console.error("[rexadb] insertHistoryEntry server error", res.error);
    }).catch((err: unknown) => console.error("[rexadb] insertHistoryEntry network error", err));

    setQueryHistory(prev => {
      // Only update if we're still on the same connection
      if (currentConnectionIdRef.current !== capturedConnectionId) return prev;
      return [newEntry, ...prev].slice(0, 100);
    });
  }, [connection.id, connection.name]);

  const addQueryHistoryEntry = useCallback((sql: string, res: { success: boolean; error?: string; data?: { executionTime?: number; rows?: unknown[] } }, startTime: number) => {
    addHistoryEntry({
      query: sql,
      duration: res.data?.executionTime || (Date.now() - startTime),
      status: res.success ? 'success' : 'error',
      error: res.error,
      rowsCount: res.data?.rows?.length || 0,
      caller: 'user',
    });
  }, [addHistoryEntry]);

  const loadFunctions = useCallback(async () => {
    if (!selectedSchema) return;
    setFetchingFunctions(true);
    try {
      const res = await fetchFunctions(currentConnectionString, selectedSchema);
      if (res.success && res.data) {
        setFunctions(res.data);
      }
    } finally {
      setFetchingFunctions(false);
    }
  }, [currentConnectionString, selectedSchema]);

  const { refreshDashboards } = useDashboardPersistence({
    connectionId: connection.id,
    setDashboards,
    setDashboardFolders,
    dashboards,
    dashboardFolders,
    workspaceId: workspaceContext.workspaceId,
    accessToken: workspaceContext.accessToken,
  });

  const {
    isAddFKSheetOpen,
    setIsAddFKSheetOpen,
    newFKData,
    setNewFKData,
    pkColumns,
    getRowId,
    hasChanges,
    getChangedValue,
    mutateOptimisticTableRows,
    applyOptimisticRowUpdates,
    applyOptimisticRowDeletes,
    applyOptimisticRowInsertions,
    applyOptimisticTableClear,
  } = useTableDataMutations({
    tableStructure,
    selectedTable,
    results,
    pendingChanges,
    selectedSchema,
    setResults,
    setTabDataCache,
    setTotalCount,
    setSelectedRows,
    setSelectedCell,
  });

  const { handleDeleteFunction, handleUpdateFunctionDefinition } = useFunctionManagement({
    currentConnectionString,
    executionMode,
    confirm,
    addHistoryEntry,
    setPendingActions,
    setIsReviewSheetOpen,
    loadFunctions,
  });

  const { agentChatMessages, setAgentChatMessages, appendAgentChatMessage, updateAgentChatMessage, clearAgentChatMessages } = useAgentChatMessages({ connectionId: connection.id });

  useStudioDataPersistence({
    connectionId: connection.id,
    connectionName: connection.name || "Connection",
    isDataLoaded,
    queueStudioSave,
    queueSharedSave,
    isSharedSnippetsLoaded,
    snippets,
    folders,
    openTabs,
    activeTabId,
    sidebarSortMode,
    sidebarView: sidebarView ?? "tables",
    sidebarBehavior: sidebarBehaviorState,
    keybindings,
    searchSettings,
    splitView,
    queryHistory,
    isHistoryLoaded,
    tags,
    tableTags,
  });

  const effectiveEditorThemeId =
    editorThemeId === "auto" && appEditorTheme ? appEditorTheme.id : editorThemeId;

  useTimerCleanup({ timerRef, sqlTabTimerRef });

  const { tabSwitchPerfRef, logTabPerf } = useTabPerformanceLogger();
  const restoredTabForConnectionRef = useRef<number | null>(null);
  const delayedUiRestoreBlockedRef = useRef(false);

  useEffect(() => {
    restoredTabForConnectionRef.current = null;
    delayedUiRestoreBlockedRef.current = false;
  }, [connection.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    if (tuiMode) {
      root.classList.add("tui-mode");
    } else {
      root.classList.remove("tui-mode");
      delete root.dataset.tuiTheme;
      return;
    }
    const resolveTheme = () => {
      if (tuiTheme === "auto") {
        return root.classList.contains("dark") ? "dark" : "light";
      }
      return tuiTheme;
    };
    root.dataset.tuiTheme = resolveTheme();
  // fallow-ignore-next-line code-duplication
    if (tuiTheme !== "auto") return;
    const observer = new MutationObserver(() => {
      root.dataset.tuiTheme = resolveTheme();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [tuiMode, tuiTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem("rexa-db-tui-mode", tuiMode ? "1" : "0");
      window.localStorage.setItem("rexa-db-tui-theme", tuiTheme || "auto");
    } catch {}
  }, [tuiMode, tuiTheme]);

  // Track current connection id in a ref so addHistoryEntry can guard against stale state
  const currentConnectionIdRef = useRef<number>(connection.id);
  useEffect(() => {
    currentConnectionIdRef.current = connection.id;
    setQueryHistory([]);
  }, [connection.id]);

  // Wrap setQueryHistory so useInitialStudioData sets in-memory state only (no DB write on load)
  const setQueryHistoryForConnection = useCallback((history: QueryHistory[]) => {
    setQueryHistory(prev => {
      // Only apply if we're still on the connection this load was for
      // (useInitialStudioData passes the loaded history, but connection may have changed)
      if (currentConnectionIdRef.current !== connection.id) return prev;
      return history;
    });
  }, [connection.id]);

  useInitialStudioData({
    connection,
    storageMode,
    workspaceId: workspaceContext.workspaceId,
    accessToken: workspaceContext.accessToken,
    setFolders,
    setSnippets,
    setQueryHistory: setQueryHistoryForConnection,
    setTags,
    setTableTags,
    setOpenTabs,
    setActiveTabId,
    setSidebarSortMode,
    setSidebarView: setSidebarViewState,
    setIsSidebarVisible: setIsSidebarVisibleState,
    setSidebarBehavior: applySidebarBehavior,
    setKeybindings,
    setSearchSettings,
    setSplitView,
    setIsDataLoaded,
    setIsSharedSnippetsLoaded,
    setIsHistoryLoaded,
    delayedUiRestoreBlockedRef,
  });

  const loadLocalSnippets = useCallback(async () => {
    const [foldersRes, snippetsRes] = await Promise.all([
      getStudioFolders(connection.id),
      getStudioSnippets(connection.id),
    ]);
    if (foldersRes?.success && foldersRes.data) {
      setFolders(foldersRes.data.map((f: any) => ({ id: f.id, name: f.name, createdAt: f.createdAt })));
    }
    if (snippetsRes?.success && snippetsRes.data) {
      setSnippets(snippetsRes.data.map(mapStudioSnippet));
    }
  }, [connection.id]);

  const loadCloudSnippets = useCallback(async () => {
    if (!workspaceContext.workspaceId) return;
    console.log("[rexadb] loadCloudSnippets: fetching from workspace", workspaceContext.workspaceId);
    const { folders: cloudFolders, snippets: cloudSnippets, error } = await getWorkspaceSnippets();
    if (error) {
      console.error("[rexadb] loadCloudSnippets: failed", error);
      return;
    }
    console.log("[rexadb] loadCloudSnippets: received", {
      folderCount: cloudFolders?.length ?? 0,
      snippetCount: cloudSnippets?.length ?? 0,
      snippetIds: (cloudSnippets ?? []).map((s: any) => s.id),
      snippetNames: (cloudSnippets ?? []).map((s: any) => s.name),
    });
    const normalizedFolders = normalizeCloudFolders(cloudFolders);
    const normalizedSnippets = normalizeCloudSnippets(cloudSnippets);
    setFolders((prev) => mergeById(prev, normalizedFolders, (existing, incoming) => ({
      ...existing, ...incoming, createdAt: existing.createdAt ?? incoming.createdAt,
    })));
    setSnippets((prev) => mergeById(prev, normalizedSnippets, (existing, incoming) => ({
      ...existing, ...incoming, isShared: true,
    })));
  }, [workspaceContext.workspaceId]);

  const loadReceivedSharedItems = useCallback(async () => {
    try {
      const [snippetsRes, dashboardsRes] = await Promise.all([
        getReceivedSharedSnippets(),
        getReceivedSharedDashboards(),
      ]);
      if (!snippetsRes.error) setReceivedSharedSnippets(snippetsRes.snippets);
      if (!dashboardsRes.error) setReceivedSharedDashboards(dashboardsRes.dashboards);
    } catch (err) {
      console.error("Failed to load shared items:", err);
    }
  }, []);

  useEffect(() => {
    void loadLocalSnippets();
  }, [loadLocalSnippets, isDataLoaded]);















  const { loadSchemaData, cancelSchemaLoad } = useSchemaDataLoader({
    dbType,
    selectedSchema,
    currentConnectionString,
    setSchemaData,
  });



  // Load schema data lazily when the schema view is active or when explicitly refreshed.

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentDatabase() {
      if (dbType !== "postgres") {
        if (!cancelled) {
          setCurrentDatabase(getDatabaseFromConnectionString(currentConnectionString));
        }
        return;
      }

      const res = await runQuery(currentConnectionString, "SELECT current_database() AS name;");
      if (cancelled) return;

      const rows =
        res.success && res.data && typeof res.data === "object" && "rows" in res.data
          ? (res.data as { rows?: Array<{ name?: unknown }> }).rows
          : undefined;
      const dbName = typeof rows?.[0]?.name === "string" ? rows[0].name.trim() : "";
      setCurrentDatabase(dbName || getDatabaseFromConnectionString(currentConnectionString));
    }

    void loadCurrentDatabase();
    return () => {
      cancelled = true;
    };
  }, [currentConnectionString, dbType, runQuery]);

  useEffect(() => {
    const shouldLoadSchema =
      (viewMode === "database" && databaseView === "schema")
      || viewMode === "tables"
      || sidebarView === "tables";

    if (shouldLoadSchema) {
      let cancelled = false;
      const run = () => {
        if (cancelled) return;
        loadSchemaData();
      };
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        const idleId = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
          .requestIdleCallback?.(run, { timeout: 2000 });
        return () => {
          cancelled = true;
          if (typeof idleId === "number" && "cancelIdleCallback" in window) {
            (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
          }
          cancelSchemaLoad();
        };
      }
      const timeoutId = globalThis.setTimeout(run, 0);
      return () => {
        cancelled = true;
        globalThis.clearTimeout(timeoutId);
        cancelSchemaLoad();
      };
    }
    cancelSchemaLoad();
    return undefined;
  }, [viewMode, databaseView, sidebarView, loadSchemaData, cancelSchemaLoad]);



  const addTag = useCallback((name: string, color: string) => {
    setTags(prev => prev.some(t => t.name === name) ? prev : [...prev, { name, color }]);
  }, []);

  const toggleTableTag = useCallback((schema: string, table: string, tagName: string) => {
    const key = `${schema}.${table}`;
    setTableTags(prev => {
      const currentTags = prev[key] || [];
      const nextTags = currentTags.includes(tagName)
        ? currentTags.filter(t => t !== tagName)
        : [...currentTags, tagName];
      return { ...prev, [key]: nextTags };
    });
  }, []);



  const [isInsertSheetOpen, setIsInsertSheetOpen] = useState(false);
  const [insertData, setInsertData] = useState<Record<string, string>>({});
  const [filterQuery, setFilterQuery] = useState(searchParams.get("f") || "");
  const [sortConfig, setSortConfig] = useState<{ column: string; direction: 'ASC' | 'DESC' } | null>(() => {
    const col = searchParams.get("sc");
    const dir = searchParams.get("sd");
    if (col && (dir === "ASC" || dir === "DESC")) {
      return { column: col, direction: dir as 'ASC' | 'DESC' };
    }
    return null;
  });
  const [tableSearch, setTableSearch] = useState("");
  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [newTableData, setNewTableData] = useState<{
    name: string;
    columns: any[];
  }>({
    name: '',
    columns: getDefaultNewTableColumns(dbType)
  });

  const [isCreatingEnum, setIsCreatingEnum] = useState(false);
  const [isCreatingIndex, setIsCreatingIndex] = useState(false);
  const [isCreatingTrigger, setIsCreatingTrigger] = useState(false);
  const [isCreatingSchema, setIsCreatingSchema] = useState(false);
  const [isCreatingDatabase, setIsCreatingDatabase] = useState(false);
  const [isEditingEnum, setIsEditingEnum] = useState(false);
  const [editingEnumName, setEditingEnumName] = useState<string | null>(null);
  const [newEnumData, setNewEnumData] = useState<{
    name: string;
    values: string[];
  }>({
    name: '',
    values: ['']
  });

  // Mark create-table tab dirty when form data deviates from initial defaults
  const createTableInitialRef = useRef(JSON.stringify({ name: '', columns: getDefaultNewTableColumns(dbType) }));
  useEffect(() => {
    const current = JSON.stringify(newTableData);
    if (current !== createTableInitialRef.current) {
      const tab = openTabs.find((t) => t.id === 'create-table');
      if (tab && !tab.dirty) markTabDirty('create-table');
    }
  }, [newTableData]);

  // Mark create-enum tab dirty when form data deviates from initial defaults
  const createEnumInitialRef = useRef(JSON.stringify({ name: '', values: [''] }));
  useEffect(() => {
    const current = JSON.stringify(newEnumData);
    if (current !== createEnumInitialRef.current) {
      const tab = openTabs.find((t) => t.id === 'create-enum');
      if (tab && !tab.dirty) markTabDirty('create-enum');
    }
  }, [newEnumData]);

  const [isAddColumnSheetOpen, setIsAddColumnSheetOpen] = useState(false);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);
  const [isEditColumnSheetOpen, setIsEditColumnSheetOpen] = useState(false);
  const [columnToEdit, setColumnToEdit] = useState<string | null>(null);
  const [isEditingColumn, setIsEditingColumn] = useState(false);
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const [tablePermissionContext, setTablePermissionContextState] = useState<TablePermissionContext>(null);
  const buildTableTabCacheSnapshot = useCallback(() => ({
    results,
    tableStructure,
    foreignKeys,
    filterQuery,
    sortConfig,
    page,
    pageSize,
    totalCount,
    permissionContext: tablePermissionContext,
  }), [results, tableStructure, foreignKeys, filterQuery, sortConfig, page, pageSize, totalCount, tablePermissionContext]);

  const snapshotTableTabState = useCallback((tabId: string | null) => {
    if (!tabId) return;
    const activeTab = openTabs.find((tab) => tab.id === tabId);
    if (!activeTab || activeTab.type !== "table") return;
    const snapshot = buildTableTabCacheSnapshot();
    const previous = tableTabSnapshotRef.current[tabId];
    tableTabSnapshotRef.current[tabId] = mergeTableTabSnapshot(previous, snapshot);
    setTabDataCache((prev) => {
      const nextEntry = {
        ...prev[tabId],
        ...snapshot,
      };
      const current = prev[tabId];
      const unchanged = current
        && current.results === nextEntry.results
        && current.tableStructure === nextEntry.tableStructure
        && current.foreignKeys === nextEntry.foreignKeys
        && current.filterQuery === nextEntry.filterQuery
        && JSON.stringify(current.sortConfig) === JSON.stringify(nextEntry.sortConfig)
        && current.page === nextEntry.page
        && current.pageSize === nextEntry.pageSize
        && current.totalCount === nextEntry.totalCount
        && areTablePermissionContextsEqual(current.permissionContext ?? null, nextEntry.permissionContext ?? null);
      if (unchanged) return prev;
      return {
        ...prev,
        [tabId]: nextEntry,
      };
    });
  }, [openTabs, buildTableTabCacheSnapshot]);

  useEffect(() => {
    if (!activeTableTabId) return;
    const snapshot = buildTableTabCacheSnapshot();
    const previous = tableTabSnapshotRef.current[activeTableTabId];
    tableTabSnapshotRef.current[activeTableTabId] = mergeTableTabSnapshot(previous, snapshot);
  }, [activeTableTabId, buildTableTabCacheSnapshot]);

  const getTableTabSnapshot = useCallback((tabId: string) => {
    return tableTabSnapshotRef.current[tabId] ?? tabDataCache[tabId];
  }, [tabDataCache]);

  const setTablePermissionContext = useCallback((nextContext: TablePermissionContext) => {
    setTablePermissionContextState((prev) => (
      areTablePermissionContextsEqual(prev, nextContext) ? prev : nextContext
    ));
    setPage(0);
    setEditingCell(null);
    setSelectedRows(new Set());
    setSelectedCell(null);
  }, []);

  const hiddenColumnNamesRef = useRef(hiddenColumnNames);
  hiddenColumnNamesRef.current = hiddenColumnNames;

  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const sortConfigRef = useRef(sortConfig);
  sortConfigRef.current = sortConfig;
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const tableStructureRef = useRef(tableStructure);
  tableStructureRef.current = tableStructure;















  // Removed redundant URL sync useEffect as switchTab handles it

  // Sync URL params with state
  useEffect(() => {
    const s = searchParams.get("s");
    const t = searchParams.get("t");
    const f = searchParams.get("f") || "";
    const sc = searchParams.get("sc");
    const sd = searchParams.get("sd");

    if (s && s !== selectedSchema) setSelectedSchema(s);
    if (t !== selectedTable) setSelectedTable(t);
    if (f !== filterQuery) setFilterQuery(f);

    if (sc && (sd === "ASC" || sd === "DESC")) {
      const newSort = { column: sc, direction: sd as 'ASC' | 'DESC' };
      if (JSON.stringify(newSort) !== JSON.stringify(sortConfig)) {
        setSortConfig(newSort);
      }
    } else if (sortConfig !== null) {
      setSortConfig(null);
    }
  }, [searchParams]);

  useEffect(() => {
    loadDatabases();
    // We only want to load schemas if the connection string changes AND it's not the initial load 
    // or if it's the first load. 
    // However, loadInitialDataWithConn is also called in handleDatabaseChange.
    // To avoid double loading, we can check if currentDatabase matches the one in connection string.
    loadSchemas(dbType === "mysql" || dbType === "clickhouse");
    if (dbType !== "postgres" && dbType !== "supabase-mgmt") {
      setExtensions([]);
      setTriggers([]);
      setEnums([]);
      setIndexes([]);
      setFunctions([]);
      setRlsPolicies([]);
    }
  }, [dbType, currentConnectionString]);

  const loadDatabases = useCallback(async () => {
    try {
      const res = await fetchDatabases(currentConnectionString);
      if (res.success && res.data) {
        const normalized = normalizeNameList(res.data);
        if (normalized.length) {
          setDatabases(normalized);
          return;
        }
      }
      if (dbType === "mysql" || dbType === "clickhouse") {
        const schemaRes = await fetchSchemas(currentConnectionString);
        if (schemaRes.success && schemaRes.data) {
          const normalizedSchemas = normalizeNameList(schemaRes.data);
          if (normalizedSchemas.length) {
            setDatabases(normalizedSchemas);
            return;
          }
        }
        if (currentDatabase) {
          setDatabases([currentDatabase]);
          return;
        }
      }
      setDatabases([]);
    } catch (err) {
      console.error("Error loading databases:", err);
    }
  }, [currentConnectionString, currentDatabase, normalizeNameList, dbType]);

  const handleDatabaseChange = useCallback(async (newDb: string) => {
    if (newDb === currentDatabase) return;

    try {
      const nextConnectionString = updateConnectionStringDatabase(currentConnectionString, newDb);
      
      // 1. Update connection string state
      setCurrentConnectionString(nextConnectionString);
      
      // 2. Update database name state
      setCurrentDatabase(newDb);
      
      // 3. Update the main connection object used by components
      setConnection(prev => {
        const updated = { ...prev, connectionString: nextConnectionString };
        return updated;
      });

      // Clear current state to avoid showing stale data from previous database
      setTables([]);
      setViewTables([]);
      setRedisKeys([]);
      setSchemas([]);
      setFunctions([]);
      setTriggers([]);
      setEnums([]);
      setIndexes([]);
      setExtensions([]);
      setSelectedTable(null);
      setSelectedSchema("");

      // Refresh data with new connection string
      // This is the critical part: we must fetch new schemas and tables for the new database
      // We pass forceRefresh: true to ensure the cache is bypassed when switching databases
      await loadInitialDataWithConn(nextConnectionString, true);

      toast.success(`Switched to database: ${newDb}`);
    } catch (err) {
      console.error("Error switching database:", err);
      toast.error(`Failed to switch to database: ${newDb}`);
    }
  }, [currentDatabase, currentConnectionString, loadInitialDataWithConn]);





  const loadIndexes = useCallback(async () => {
    if (!selectedSchema) return;
    await loadData(setFetchingIndexes, setIndexes, () => 
      fetchIndexes(currentConnectionString, selectedSchema));
  }, [currentConnectionString, selectedSchema]);

  const loadRlsPolicies = useCallback(async (schema?: string, table?: string) => {
    const schemaToUse = schema ?? selectedSchema;
    const tableToUse = table ?? undefined;
    const requestId = ++rlsPoliciesRequestIdRef.current;

    setFetchingRlsPolicies(true);
    try {
      const res = await fetchRlsPolicies(currentConnectionString, schemaToUse || null, tableToUse || null);
      if (requestId !== rlsPoliciesRequestIdRef.current) {
        return;
      }
      if (res.success && res.data) {
        setRlsPolicies(res.data);
      } else {
        setError(res.error || "Unknown error");
      }
    } finally {
      if (requestId === rlsPoliciesRequestIdRef.current) {
        setFetchingRlsPolicies(false);
      }
    }
  }, [currentConnectionString, selectedSchema]);

  const loadPostgresRoles = useCallback(async () => {
    const res = await fetchPostgresRoles(currentConnectionString);
    if (res.success && res.data) {
      setPostgresRoles(res.data);
    } else {
      setError(res.error || "Unknown error");
    }
  }, [currentConnectionString]);

  const loadSupabaseAuthUsers = useCallback(async () => {
    if ((dbType !== "postgres" && dbType !== "supabase-mgmt") || !schemas.includes("auth")) {
      setSupabaseAuthUsers([]);
      return;
    }

    const requestId = ++tablePermissionOptionsRequestIdRef.current;
    setFetchingTablePermissionOptions(true);
    try {
      const res = await fetchSupabaseAuthUsers(currentConnectionString);
      if (requestId !== tablePermissionOptionsRequestIdRef.current) {
        return;
      }
      if (res.success && res.data) {
        setSupabaseAuthUsers(res.data);
      } else {
        setError(res.error || "Unknown error");
      }
    } finally {
      if (requestId === tablePermissionOptionsRequestIdRef.current) {
        setFetchingTablePermissionOptions(false);
      }
    }
  }, [currentConnectionString, dbType, schemas]);

  useEffect(() => {
    if (dbType !== "postgres" && dbType !== "supabase-mgmt") {
      tablePermissionOptionsRequestIdRef.current += 1;
      setSupabaseAuthUsers([]);
      setFetchingTablePermissionOptions(false);
      setTablePermissionContextState(null);
      return;
    }
    if (!schemas.includes("auth")) {
      tablePermissionOptionsRequestIdRef.current += 1;
      setSupabaseAuthUsers([]);
      setFetchingTablePermissionOptions(false);
      return;
    }
    void loadSupabaseAuthUsers();
  }, [dbType, schemas, loadSupabaseAuthUsers]);

  const addReviewAction = useCallback((actionOrActions: {
    type: string;
    description: string;
    sql: string;
    metadata?: any;
    params?: any;
  } | Array<{
    type: string;
    description: string;
    sql: string;
    metadata?: any;
    params?: any;
  }>) => {
    if (executionMode !== 'review') return false;
    const actions = Array.isArray(actionOrActions) ? actionOrActions : [actionOrActions];
    setPendingActions(prev => [...prev, ...actions.map(a => ({
      id: uid(),
      ...a,
    }))] as any);
    setIsReviewSheetOpen(true);
    return true;
  }, [executionMode]);

  const uid = (): string => Math.random().toString(36).substring(2, 9);

  const logQueryResult = (sql: string, res: { success: boolean; error?: string; data?: { executionTime?: number } }, startTime: number) => {
    addHistoryEntry({
      query: sql,
      duration: res.data?.executionTime || (Date.now() - startTime),
      status: res.success ? 'success' : 'error',
      error: res.error,
      caller: 'user',
    });
  };

  const runQueryWithLogging = async (sql: string) => {
    const startTime = Date.now();
    const res = await runQuery(currentConnectionString, sql);
    logQueryResult(sql, res, startTime);
    return res;
  };

  const buildNewTabs = (newTab: Record<string, unknown>, querySource?: string, asPreview?: boolean): StudioInitialTab[] => {
    const q = querySource ?? queryRef.current;
    const currentTabsWithOldQuerySaved = openTabs.map((t) =>
      t.id === activeTabId && t.type === "sql" ? { ...t, query: q } : t
    );

    if (previewTabs && asPreview) {
      const newTabWithPreview = { ...newTab, isPreview: true } as unknown as StudioInitialTab;
      const previewIdx = currentTabsWithOldQuerySaved.findIndex(
        (t) => t.isPreview && !t.pinned && !t.dirty
      );
      if (previewIdx >= 0) {
        const next = [...currentTabsWithOldQuerySaved];
        next[previewIdx] = newTabWithPreview;
        return next;
      }
      return [...currentTabsWithOldQuerySaved, newTabWithPreview];
    }

    return [...currentTabsWithOldQuerySaved, newTab as unknown as StudioInitialTab];
  };

  const switchAwayFromTab = (tabId: string, targetTabId: string, fallback: 'schema' | 'tables' | 'functions' | 'extensions' | 'triggers' | 'enums' | 'indexes' | 'rls-policies') => {
    const nextTabs = openTabs.filter(t => t.id !== tabId);
    setOpenTabs(nextTabs);
    const targetTab = nextTabs.find(t => t.id === targetTabId);
    if (targetTab) {
      switchTab(targetTab.id, nextTabs);
    } else {
      openDatabaseTab(fallback);
    }
  };

  const closeCreateTab = (tabId: string) => {
    setOpenTabs(openTabs.filter(t => t.id !== tabId));
  };

  const handleDeleteIndex = useCallback(async (schema: string, name: string) => {
    const sql = `DROP INDEX IF EXISTS "${schema}"."${name}";`;

    if (addReviewAction({ type: 'delete_index', description: `Delete index "${schema}"."${name}"`, sql, metadata: { schema, name } })) return;

    const confirmed = await confirm({
      title: "Delete Index",
      description: `Are you sure you want to delete the index "${schema}"."${name}"?`,
      variant: "destructive",
      confirmText: "Delete"
    });

    if (!confirmed) return;

    const res = await deleteIndex(currentConnectionString, schema, name);
    if (res.success) {
      loadIndexes();
    } else {
      toast.error(res.error || "Failed to delete index");
    }
  }, [currentConnectionString, executionMode, confirm]);

  const handleViewIndexDefinition = useCallback((definition: string) => {
    openSqlEditor(definition);
  }, []);

  const loadSchemas = useCallback(async (forceRefresh = false) => {
    setFetchingSchemas(true);
    try {
      if (!forceRefresh && (dbType === "postgres" || dbType === "supabase-mgmt")) {
        const cachedSchemas = normalizeNameList(await getCachedSchemasSnapshot(currentConnectionString));
        if (cachedSchemas.length > 0) {
          setSchemas(cachedSchemas);
          const currentS = searchParams.get("s");
          const hasUrlSchema = Boolean(currentS && cachedSchemas.includes(currentS));
          const hasSelectedSchema = Boolean(selectedSchema && cachedSchemas.includes(selectedSchema));
          const fallbackSchema = cachedSchemas.includes("public") ? "public" : cachedSchemas[0];
          const nextSchema = hasUrlSchema
            ? (currentS as string)
            : (hasSelectedSchema ? (selectedSchema as string) : fallbackSchema);

          if (selectedSchema !== nextSchema) {
            setSelectedSchema(nextSchema);
          }
        }
      }

      const res = usesDatabaseNamespaces(dbType)
        ? await fetchNamespaceList(currentConnectionString)
        : await fetchSchemas(currentConnectionString);
      if (res.success && res.data) {
        const normalizedSchemas = normalizeNameList(res.data);
        if (normalizedSchemas.length === 0) {
          if (usesDatabaseNamespaces(dbType) && currentDatabase) {
            setSchemas([currentDatabase]);
            setSelectedSchema(currentDatabase);
          } else {
            setSchemas([]);
          }
          return;
        }
        setSchemas(normalizedSchemas);
        const currentS = searchParams.get("s");
        const hasUrlSchema = Boolean(currentS && normalizedSchemas.includes(currentS));
        const hasSelectedSchema = Boolean(selectedSchema && normalizedSchemas.includes(selectedSchema));
        let fallbackSchema = (dbType === "postgres" || dbType === "supabase-mgmt")
          ? (normalizedSchemas.includes("public") ? "public" : normalizedSchemas[0])
          : normalizedSchemas[0];
        if (dbType === "mssql" && normalizedSchemas.includes("dbo")) {
          fallbackSchema = "dbo";
        }
        if (usesDatabaseNamespaces(dbType)) {
          const dbName = getDatabaseFromConnectionString(currentConnectionString);
          if (dbName && normalizedSchemas.includes(dbName)) {
            fallbackSchema = dbName;
          }
        }
        if (dbType === "redis" && currentDatabase) {
          fallbackSchema = currentDatabase;
        }
        const nextSchema = hasUrlSchema
          ? (currentS as string)
          : (hasSelectedSchema ? (selectedSchema as string) : fallbackSchema);

        if (selectedSchema !== nextSchema) {
          setSelectedSchema(nextSchema);
        } else if (hasUrlSchema) {
          // If we already have a valid schema from URL, we need to manually trigger loadTables
          // because the useEffect might not trigger if selectedSchema state matches currentS
          loadTables(forceRefresh);
        }
      }
    } finally {
      setFetchingSchemas(false);
    }
  }, [currentConnectionString, searchParams, selectedSchema, dbType, normalizeNameList]);

  const loadTables = useCallback(async (forceRefresh = false) => {
    if (!selectedSchema) return;
    setFetchingTables(true);
    try {
      if (!forceRefresh && (dbType === "postgres" || dbType === "supabase-mgmt")) {
        const cachedTables = await getCachedTablesSnapshot(currentConnectionString, selectedSchema);
        if (cachedTables.length > 0) {
          setTables(cachedTables);
        }
      }

      if (dbType === "redis") {
        setFetchingRedisKeys(true);
        const redisRes = await fetchRedisKeys(currentConnectionString, { db: selectedSchema, limit: 500 });
        if (redisRes.success && redisRes.data) {
          setRedisKeys(redisRes.data as RedisKeyInfo[]);
          setTables((redisRes.data as RedisKeyInfo[]).map((entry) => entry.key));
        } else {
          setRedisKeys([]);
          setTables([]);
        }
        setViewTables([]);
        return;
      }
      const [tablesRes, viewsRes] = await Promise.all([
        fetchTables(currentConnectionString, selectedSchema, { forceRefresh }),
        fetchViews(currentConnectionString, selectedSchema),
      ]);
      if (tablesRes.success && tablesRes.data) {
        setTables(tablesRes.data);
      }
      if (viewsRes.success && viewsRes.data) {
        setViewTables(viewsRes.data);
      } else {
        setViewTables([]);
      }
      if (dbType === "postgres" || dbType === "supabase-mgmt") {
        const securityRes = await fetchTableSecurityInfo(currentConnectionString, selectedSchema);
        if (securityRes.success && securityRes.data) {
          const next: Record<string, { rlsEnabled: boolean; policyCount: number }> = {};
          for (const row of securityRes.data) {
            next[row.table_name] = {
              rlsEnabled: Boolean(row.rls_enabled),
              policyCount: Number(row.policy_count ?? 0),
            };
          }
          setTableSecurity(next);
        }
      }
    } finally {
      setFetchingTables(false);
      if (dbType === "redis") setFetchingRedisKeys(false);
    }
  }, [currentConnectionString, selectedSchema, dbType]);

  const refreshTablesSidebar = useCallback(async () => {
    await loadSchemas(true);
    if (selectedSchema) {
      await loadTables(true);
    }
  }, [loadSchemas, loadTables, selectedSchema]);



  useEffect(() => {
    if (selectedSchema) {
      void loadTables();
    } else {
      setFetchingTables(false);
    }
  }, [selectedSchema, loadTables]);


  const loadExtensions = useCallback(async () => {
    await loadData(setFetchingExtensions, setExtensions, () => 
      fetchExtensions(currentConnectionString));
  }, [currentConnectionString]);

  const loadTriggers = useCallback(async () => {
    if (!selectedSchema) return;
    await loadData(setFetchingTriggers, setTriggers, () => 
      fetchTriggers(currentConnectionString, selectedSchema));
  }, [currentConnectionString, selectedSchema]);

  const loadEnums = useCallback(async () => {
    await loadData(setFetchingEnums, setEnums, () => 
      fetchEnums(currentConnectionString));
  }, [currentConnectionString]);

  useEffect(() => {
    if (databaseExplorer) return;
    if (!schemaExplorer || (dbType !== "postgres" && dbType !== "supabase-mgmt") || !selectedSchema) {
      return;
    }
    void loadFunctions();
    void loadTriggers();
    void loadIndexes();
    void loadEnums();
  }, [schemaExplorer, databaseExplorer, selectedSchema, dbType]);

  const loadAllSchemaData = useCallback(async () => {
    if ((dbType !== "postgres" && dbType !== "supabase-mgmt") || schemas.length === 0) return;
    setFetchingAllSchema(true);
    try {
      const schemaList = schemas.filter((s) => s !== "pg_catalog" && s !== "information_schema");
      const results = await Promise.all(
        schemaList.map(async (schema) => {
          const [tablesRes, viewsRes] = await Promise.all([
            fetchTables(currentConnectionString, schema, { forceRefresh: false }),
            fetchViews(currentConnectionString, schema),
          ]);
          return {
            schema,
            tables: tablesRes.success && tablesRes.data ? tablesRes.data : [],
            views: viewsRes.success && viewsRes.data ? viewsRes.data : [],
          };
        }),
      );
      const allTables: Array<{ schema: string; name: string }> = [];
      const allViews: Array<{ schema: string; name: string }> = [];
      for (const r of results) {
        for (const t of r.tables) allTables.push({ schema: r.schema, name: t });
        for (const v of r.views) allViews.push({ schema: r.schema, name: v });
      }
      setAllSchemaTables(allTables);
      setAllSchemaViews(allViews);

      const funcResults = await Promise.all(
        schemaList.map(async (schema) => {
          const res = await fetchFunctions(currentConnectionString, schema);
          return res.success && res.data ? res.data : [];
        }),
      );
      setFunctions(funcResults.flat());

      const [triggersRes, indexesRes, enumsRes] = await Promise.all([
        fetchTriggers(currentConnectionString),
        fetchIndexes(currentConnectionString),
        fetchEnums(currentConnectionString),
      ]);
      if (triggersRes.success && triggersRes.data) setTriggers(triggersRes.data);
      if (indexesRes.success && indexesRes.data) setIndexes(indexesRes.data);
      if (enumsRes.success && enumsRes.data) setEnums(enumsRes.data);
    } finally {
      setFetchingAllSchema(false);
    }
  }, [currentConnectionString, dbType, schemas]);

  useEffect(() => {
    if (!databaseExplorer || (dbType !== "postgres" && dbType !== "supabase-mgmt")) return;
    void loadAllSchemaData();
  }, [databaseExplorer, dbType, loadAllSchemaData]);

  useEffect(() => {
    if (dbType !== "postgres" && dbType !== "supabase-mgmt") {
      setFunctions([]);
      setRlsPolicies([]);
      setPostgresRoles([]);
      return;
    }
    if (viewMode !== "database") {
      return;
    }
    if (databaseView === "functions" && selectedSchema) {
      void loadFunctions();
      return;
    }
    if (databaseView === "extensions") {
      void loadExtensions();
      return;
    }
    if (databaseView === "triggers") {
      if (
        !triggersLoadedRef.current ||
        triggersLoadedRef.current.conn !== currentConnectionString ||
        triggersLoadedRef.current.schema !== selectedSchema
      ) {
        triggersLoadedRef.current = { conn: currentConnectionString, schema: selectedSchema };
        void loadTriggers();
      }
      return;
    }
    if (databaseView === "enums") {
      void loadEnums();
      return;
    }
    if (databaseView === "indexes") {
      void loadIndexes();
      return;
    }
    if (databaseView === "rls-policies" && selectedSchema) {
      void loadRlsPolicies(selectedSchema);
      void loadPostgresRoles();
    }
  }, [
    dbType,
    viewMode,
    databaseView,
    selectedSchema,
    loadFunctions,
    loadExtensions,
    loadTriggers,
    loadEnums,
    loadIndexes,
    loadRlsPolicies,
    loadPostgresRoles,
  ]);


  // ─── RLS policy helpers imported from @/lib/db/rls-utils ────────────


  const handleSaveRlsPolicy = useCallback(async (
    original: any,
    updates: {
      name: string;
      command: string;
      permissive: "PERMISSIVE" | "RESTRICTIVE";
      roles: string[];
      usingExpression: string | null;
      withCheckExpression: string | null;
    }
  ) => {
    const rolesSql = quoteRoles(updates.roles);
    const originalCommand = String(original.command || "all").toLowerCase();
    const originalPermissive = String(original.permissive || "PERMISSIVE").toUpperCase();
    const immutableChanged = originalCommand !== updates.command || originalPermissive !== updates.permissive;

    let sqlStatements: string[] = [];

    if (immutableChanged) {
      sqlStatements = [
        `DROP POLICY IF EXISTS "${original.name}" ON "${original.schema}"."${original.table_name}";`,
        buildRlsCreateSql(original.schema, original.table_name, updates)
      ];
    } else {
      if (updates.name !== original.name) {
        sqlStatements.push(`ALTER POLICY "${original.name}" ON "${original.schema}"."${original.table_name}" RENAME TO "${updates.name}";`);
      }

      const usingClause = updates.usingExpression ? ` USING (${updates.usingExpression})` : " USING (true)";
      const withCheckClause = supportsWithCheck(updates.command)
        ? (updates.withCheckExpression ? ` WITH CHECK (${updates.withCheckExpression})` : " WITH CHECK (true)")
        : "";

      sqlStatements.push(`ALTER POLICY "${updates.name}" ON "${original.schema}"."${original.table_name}" TO ${rolesSql}${usingClause}${withCheckClause};`);
    }

    const fullSql = sqlStatements.join("\n");

    if (addReviewAction({ type: "update_rls_policy", description: `Update RLS policy "${original.schema}"."${original.table_name}"."${original.name}"`, sql: fullSql, metadata: { original, updates } })) return;

    const startTime = Date.now();
    for (const statement of sqlStatements) {
      const res = await runQuery(currentConnectionString, statement);
      logQueryResult(statement, res, startTime);

      if (!res.success) {
        throw new Error(res.error || "Failed to update policy");
      }
    }

    toast.success("RLS policy updated");
    await loadRlsPolicies(original.schema, original.table_name);
  }, [executionMode, currentConnectionString, runQuery, addHistoryEntry, loadRlsPolicies]);

  const handleDeleteRlsPolicy = useCallback(async (policy: any) => {
    const sql = `DROP POLICY IF EXISTS "${policy.name}" ON "${policy.schema}"."${policy.table_name}";`;

    if (addReviewAction({ type: "delete_rls_policy", description: `Delete RLS policy "${policy.schema}"."${policy.table_name}"."${policy.name}"`, sql, metadata: { policy } })) return;

    const isConfirmed = await confirm({
      title: "Delete RLS Policy",
      description: `Delete policy "${policy.name}" from "${policy.schema}"."${policy.table_name}"?`,
      variant: "destructive",
      confirmText: "Delete"
    });

    if (!isConfirmed) return;

    const startTime = Date.now();
    const res = await runQuery(currentConnectionString, sql);
    logQueryResult(sql, res, startTime);

    if (!res.success) {
      toast.error(res.error || "Failed to delete policy");
      return;
    }

    toast.success("RLS policy deleted");
    await loadRlsPolicies(policy.schema, policy.table_name);
  }, [executionMode, confirm, currentConnectionString, runQuery, addHistoryEntry, loadRlsPolicies]);

  const handleAddRlsPolicy = useCallback(async (values: {
    schema: string;
    tableName: string;
    name: string;
    command: string;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }) => {
    const sql = buildRlsCreateSql(values.schema, values.tableName, values);

    if (addReviewAction({ type: "create_rls_policy", description: `Create RLS policy "${values.schema}"."${values.tableName}"."${values.name}"`, sql, metadata: { values } })) return;

    const startTime = Date.now();
    const res = await runQuery(currentConnectionString, sql);
    logQueryResult(sql, res, startTime);

    if (!res.success) {
      throw new Error(res.error || "Failed to create policy");
    }

    toast.success("RLS policy created");
    await loadRlsPolicies(values.schema, values.tableName);
  }, [executionMode, currentConnectionString, runQuery, addHistoryEntry, loadRlsPolicies]);

  async function handleToggleExtension(name: string, install: boolean) {
    const sql = install ? `CREATE EXTENSION IF NOT EXISTS "${name}";` : `DROP EXTENSION IF EXISTS "${name}";`;

    if (addReviewAction({ type: (install ? 'create_extension' : 'delete_extension') as any, description: `${install ? 'Install' : 'Uninstall'} extension ${name}`, sql, metadata: { name, install } })) return;

    try {
      const { success, error } = await executeSqlWithHistory(runQuery, currentConnectionString, sql, addHistoryEntry);
      if (success) {
        toast.success(install ? "Extension installed" : "Extension uninstalled");
        loadExtensions();
      } else {
        toast.error(error || `Failed to ${install ? 'install' : 'uninstall'} extension`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${install ? 'install' : 'uninstall'} extension`);
    }
  }

  const getActiveSqlTabId = useCallback(() => {
    if (!activeTabId) return null;
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    return activeTab?.type === "sql" ? activeTabId : null;
  }, [activeTabId, openTabs]);

  const runSqlEditorQuery = useCallback(async (
    connectionString: string,
    sql: string,
    queryId: string,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    return apiRunQuery(connectionString, sql, [], queryId, undefined, null);
  }, []);

  const cancelSqlEditorQuery = useCallback(async (
    connectionString: string,
    queryId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const response = await fetch("/api/sql/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionString,
        queryId,
      }),
    });

    const payload = await response.json();
    return payload;
  }, []);

  function getResultTabLabel(_query: string, previousCount: number): string {
    return `Result ${previousCount + 1}`;
  }

  const runSqlContextQuery = useCallback(async (
    sqlTabId: string,
    queryToRun: string,
    caller: 'user' | 'system' = 'user',
    suppressTab: boolean = false,
  ) => {
    if (!queryToRun.trim()) return;
    const requestId = (sqlTabRunRequestIdRef.current[sqlTabId] || 0) + 1;
    sqlTabRunRequestIdRef.current[sqlTabId] = requestId;
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const connToUse = currentConnectionString;
    
    const normalizedForDetection = queryToRun
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--.*$/gm, " ")
      .trim();
    const mutatingSqlPattern = /^(alter|create|drop|truncate|insert|update|delete|merge|grant|revoke|comment|rename)\b/i;
    const ddlSqlPattern = /^(alter|create|drop|truncate|comment|rename)\b/i;
    setSqlTabStates((prev) => ({
      ...prev,
      [sqlTabId]: {
        ...prev[sqlTabId],
        loading: true,
        error: null,
        executionTime: 0,
        resultTabs: prev[sqlTabId]?.resultTabs || [],
        activeResultTabId: prev[sqlTabId]?.activeResultTabId ?? null,
        activeQueryId: queryId,
        activeQueryIds: Array.from(new Set([...(prev[sqlTabId]?.activeQueryIds || []), queryId])),
      },
    }));

    const startTime = Date.now();
    if (sqlTabTimerRef.current[sqlTabId]) {
      clearInterval(sqlTabTimerRef.current[sqlTabId]!);
    }
    sqlTabTimerRef.current[sqlTabId] = setInterval(() => {
      const latestRequestId = sqlTabRunRequestIdRef.current[sqlTabId];
      if (latestRequestId !== requestId) return;
      setSqlTabStates((prev) => {
        const current = prev[sqlTabId];
        if (!current?.loading) return prev;
        return {
          ...prev,
          [sqlTabId]: { ...current, executionTime: Date.now() - startTime },
        };
      });
    }, 10);

    const updateTabQueryState = (
      prev: Record<string, SqlTabData>,
      overrides: { error: string | null; results: (QueryResult & { executionTime: number }) | null; executionTime: number },
    ) => {
      const remainingQueryIds = (prev[sqlTabId]?.activeQueryIds || []).filter((id) => id !== queryId);
      const prevResultTabs = prev[sqlTabId]?.resultTabs || [];
      const isLatest = (sqlTabRunRequestIdRef.current[sqlTabId] || 0) === requestId;

      if (suppressTab) {
        if (isLatest) {
          return {
            ...prev[sqlTabId],
            loading: remainingQueryIds.length > 0,
            ...overrides,
            activeQueryId: remainingQueryIds.at(-1) ?? null,
            activeQueryIds: remainingQueryIds,
            resultTabs: [],
            activeResultTabId: null,
          };
        }
        return {
          ...prev[sqlTabId],
          loading: remainingQueryIds.length > 0,
          activeQueryId: remainingQueryIds.at(-1) ?? prev[sqlTabId]?.activeQueryId ?? null,
          activeQueryIds: remainingQueryIds,
          resultTabs: [],
        };
      }

      const newResultTab: ResultTabInfo = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: getResultTabLabel(queryToRun, prevResultTabs.length),
        query: queryToRun,
        ...overrides,
      };

      if (isLatest) {
        return {
          ...prev[sqlTabId],
          loading: remainingQueryIds.length > 0,
          ...overrides,
          activeQueryId: remainingQueryIds.at(-1) ?? null,
          activeQueryIds: remainingQueryIds,
          resultTabs: [...prevResultTabs, newResultTab],
          activeResultTabId: newResultTab.id,
        };
      }

      return {
        ...prev[sqlTabId],
        loading: remainingQueryIds.length > 0,
        activeQueryId: remainingQueryIds.at(-1) ?? prev[sqlTabId]?.activeQueryId ?? null,
        activeQueryIds: remainingQueryIds,
        resultTabs: [...prevResultTabs, newResultTab],
      };
    };

    try {
      const res: SqlEditorRunQueryResult = await runSqlEditorQuery(connToUse, queryToRun, queryId) as SqlEditorRunQueryResult;
      if (res.success && res.data) {
        const queryResultData: QueryResult & { executionTime: number } = res.data;
        const latestRequestId = sqlTabRunRequestIdRef.current[sqlTabId];
        if (latestRequestId === requestId) {
          setSqlTabStates((prev) => ({
            ...prev,
            [sqlTabId]: updateTabQueryState(prev, {
              error: null,
              results: queryResultData,
              executionTime: queryResultData.executionTime,
            }),
          }));
          if (activeTabId === sqlTabId) {
            setSelectedRows(new Set());
            setSelectedCell(null);
          }
        } else {
          setSqlTabStates((prev) => ({
            ...prev,
            [sqlTabId]: updateTabQueryState(prev, {
              error: null,
              results: queryResultData,
              executionTime: queryResultData.executionTime,
            }),
          }));
        }

        addHistoryEntry({
              query: queryToRun,
              duration: (res.data as QueryResult & { executionTime: number }).executionTime,
              status: 'success',
              rowsCount: (res.data as QueryResult & { executionTime: number }).rows?.length || 0,
              caller
            });

        let cleanTabId = sqlTabId;

        if (caller === 'user' && autoSaveQueriesRef.current) {
          const paneDelimiter = "::pane::";
          const baseTabId = sqlTabId.includes(paneDelimiter) ? sqlTabId.split(paneDelimiter)[0] : sqlTabId;
          const snippetId = baseTabId.startsWith("sql-") && !baseTabId.startsWith("sql-new-") ? baseTabId.slice(4) : null;
          const existingSnippet = snippetId ? snippetsRef.current.find((s) => s.id === snippetId) : null;

          if (existingSnippet) {
            try {
              await createSnippetVersion(existingSnippet.id, existingSnippet.name, queryToRun);
            } catch (err) {
              console.error("Failed to save snippet version for auto-save:", err);
            }
            updateSnippet(existingSnippet.id, { query: queryToRun });
          } else {
            autoSaveCounterRef.current += 1;
            const newName = `Query #${autoSaveCounterRef.current} - ${new Date().toLocaleString()}`;
            const newSnippet = createSnippetAndPersist(newName, queryToRun, null, connection.id, uid, setSnippets, saveStudioSnippets);

            const newTabId = `sql-${newSnippet.id}`;
            cleanTabId = newTabId;

            setOpenTabs((prev) => prev.map((t) =>
              t.id === sqlTabId ? { ...t, id: newTabId, name: newName } : t
            ));
            setActiveTabId(newTabId);
            setSqlTabStates((prev) => {
              const state = prev[sqlTabId];
              if (!state) return prev;
              const { [sqlTabId]: _, ...rest } = prev;
              return { ...rest, [newTabId]: state };
            });
            setSplitView((prev) => {
              if (!prev.tabPaneMap[sqlTabId]) return prev;
              const next = { ...prev.tabPaneMap, [newTabId]: prev.tabPaneMap[sqlTabId] };
              delete next[sqlTabId];
              return { ...prev, tabPaneMap: next };
            });
          }
        }

        markTabClean(cleanTabId);

        // Keep the active table tab in sync after mutating SQL run from the editor.
        if (
          (sqlTabRunRequestIdRef.current[sqlTabId] || 0) === requestId
          && caller === 'user'
          && selectedTable
          && selectedSchema
          && mutatingSqlPattern.test(normalizedForDetection)
        ) {
          // Priority path: refresh visible rows immediately.
          void refreshCurrentTab();

          // Then reconcile structure/FKs in the background.
          void (async () => {
            const tabId = resolveActiveTableTabId(selectedSchema, selectedTable) || `table-${selectedSchema}-${selectedTable}`;
            const [structRes, fkRes] = await Promise.all([
              fetchTableStructure(currentConnectionString, selectedSchema, selectedTable),
              fetchTableForeignKeys(currentConnectionString, selectedSchema, selectedTable),
            ]);

            updateTableStructureCache(structRes, fkRes, tabId);

            if (ddlSqlPattern.test(normalizedForDetection)) {
              // Retry once for backends that expose DDL metadata with slight lag.
              await new Promise(resolve => setTimeout(resolve, 350));
              const structRetry = await fetchTableStructure(currentConnectionString, selectedSchema, selectedTable);
              if (structRetry.success && structRetry.data) {
                setTableStructure(structRetry.data);
                setTabDataCache(prev => ({
                  ...prev,
                  [tabId]: { ...prev[tabId], tableStructure: structRetry.data }
                }));
              }
            }
          })();
        }
      } else {
        const duration = Date.now() - startTime;
        const overrides = { error: res.error || "An unknown error occurred", results: null as (QueryResult & { executionTime: number }) | null, executionTime: duration };
        setSqlTabStates((prev) => ({
          ...prev,
          [sqlTabId]: updateTabQueryState(prev, overrides),
        }));

        addHistoryEntry({
          query: queryToRun,
          duration,
          status: 'error',
          error: res.error || "Unknown error",
          caller
        });
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : "Query execution failed";
      const overrides = { error: errorMsg, results: null as (QueryResult & { executionTime: number }) | null, executionTime: duration };
      setSqlTabStates((prev) => ({
        ...prev,
        [sqlTabId]: updateTabQueryState(prev, overrides),
      }));

      addHistoryEntry({
        query: queryToRun,
        duration,
        status: 'error',
        error: errorMsg,
        caller
      });
    } finally {
      if ((sqlTabRunRequestIdRef.current[sqlTabId] || 0) === requestId) {
        if (sqlTabTimerRef.current[sqlTabId]) {
          clearInterval(sqlTabTimerRef.current[sqlTabId]!);
          sqlTabTimerRef.current[sqlTabId] = null;
        }
      }
    }
  }, [currentConnectionString, addHistoryEntry, selectedTable, selectedSchema, activeTabId, refreshCurrentTab, runSqlEditorQuery, dbType, sqlTabStates, markTabClean]);

  const handleRunQuery = useCallback(async (overrideQuery?: string, caller: 'user' | 'system' = 'user') => {
    const sqlTabId = getActiveSqlTabId() ?? GLOBAL_SQL_CONTEXT_ID;
    const queryToRun = overrideQuery || query;

    updateSqlTabState(sqlTabId, {
      resultTabs: [],
      activeResultTabId: null,
      results: null,
      error: null,
      executionTime: 0,
    });

    if (!resultTabsEnabled) {
      await runSqlContextQuery(sqlTabId, queryToRun, caller, true);
      return;
    }

    const statements = splitSqlStatements(queryToRun);
    if (statements.length <= 1) {
      await runSqlContextQuery(sqlTabId, queryToRun, caller);
    } else {
      for (const stmt of statements) {
        await runSqlContextQuery(sqlTabId, stmt, caller);
      }
    }
  }, [getActiveSqlTabId, query, runSqlContextQuery, resultTabsEnabled]);

  const stopSqlContextQuery = useCallback(async (sqlTabId: string | null) => {
    if (!sqlTabId) return;
    const runningQueryId = sqlTabStates[sqlTabId]?.activeQueryId || null;
    if (!runningQueryId) return;

    // Make any in-flight completion stale immediately.
    sqlTabRunRequestIdRef.current[sqlTabId] = (sqlTabRunRequestIdRef.current[sqlTabId] || 0) + 1;
    setSqlTabStates((prev) => ({
      ...prev,
      [sqlTabId]: (() => {
        const remainingQueryIds = (prev[sqlTabId]?.activeQueryIds || []).filter((id) => id !== runningQueryId);
        return {
          ...prev[sqlTabId],
          loading: remainingQueryIds.length > 0,
          executionTime: 0,
          error: "Query cancelled by user.",
          activeQueryId: remainingQueryIds.at(-1) ?? null,
          activeQueryIds: remainingQueryIds,
        };
      })(),
    }));
    if (sqlTabTimerRef.current[sqlTabId]) {
      clearInterval(sqlTabTimerRef.current[sqlTabId]!);
      sqlTabTimerRef.current[sqlTabId] = null;
    }

    if (dbType === "postgres" || dbType === "supabase-mgmt") {
      const cancelRes = await cancelSqlEditorQuery(currentConnectionString, runningQueryId);
      if (!cancelRes.success) {
        setSqlTabStates((prev) => ({
          ...prev,
          [sqlTabId]: {
            ...prev[sqlTabId],
            error: cancelRes.error || "Failed to cancel query.",
          },
        }));
      }
    }
  }, [currentConnectionString, dbType, sqlTabStates, cancelSqlEditorQuery]);

  const handleStopQuery = useCallback(async () => {
    const sqlTabId = getActiveSqlTabId()
      ?? (sqlTabStates[GLOBAL_SQL_CONTEXT_ID]?.loading ? GLOBAL_SQL_CONTEXT_ID : null);
    await stopSqlContextQuery(sqlTabId);
  }, [getActiveSqlTabId, sqlTabStates, stopSqlContextQuery]);

  const setActiveResultTab = useCallback((sqlTabId: string, resultTabId: string | null) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state) return prev;
      const activeTab = resultTabId ? state.resultTabs.find((t) => t.id === resultTabId) : null;
      return {
        ...prev,
        [sqlTabId]: {
          ...state,
          activeResultTabId: resultTabId,
          results: activeTab?.results ?? null,
          error: activeTab?.error ?? null,
          executionTime: activeTab?.executionTime ?? 0,
        },
      };
    });
  }, []);

  const rebuildResultState = (
    prev: Record<string, SqlTabData>,
    sqlTabId: string,
    state: SqlTabData,
    newTabs: ResultTabInfo[],
    newActiveId: string | null
  ) => {
    const activeTab = newActiveId ? newTabs.find((t) => t.id === newActiveId) : null;
    return {
      ...prev,
      [sqlTabId]: {
        ...state,
        resultTabs: newTabs,
        activeResultTabId: newActiveId,
        results: activeTab?.results ?? null,
        error: activeTab?.error ?? null,
        executionTime: activeTab?.executionTime ?? 0,
      },
    };
  };

  const closeResultTab = useCallback((sqlTabId: string, resultTabId: string) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state) return prev;
      const newTabs = state.resultTabs.filter((t) => t.id !== resultTabId);
      if (newTabs.length === state.resultTabs.length) return prev;
      const wasActive = state.activeResultTabId === resultTabId;
      let newActiveId = state.activeResultTabId;
      if (wasActive) {
        const closedIdx = state.resultTabs.findIndex((t) => t.id === resultTabId);
        if (newTabs.length === 0) {
          newActiveId = null;
        } else if (closedIdx >= newTabs.length) {
          newActiveId = newTabs[newTabs.length - 1].id;
        } else {
          newActiveId = newTabs[closedIdx].id;
        }
      }
      return rebuildResultState(prev, sqlTabId, state, newTabs, newActiveId);
    });
  }, []);

  const closeAllResultTabs = useCallback((sqlTabId: string) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state || state.resultTabs.length === 0) return prev;
      return {
        ...prev,
        [sqlTabId]: {
          ...state,
          resultTabs: [],
          activeResultTabId: null,
          results: null,
          error: null,
          executionTime: 0,
        },
      };
    });
  }, []);

  const closeOtherResultTabs = useCallback((sqlTabId: string, keepId: string) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state) return prev;
      const kept = state.resultTabs.filter((t) => t.id === keepId);
      if (kept.length === 0) return prev;
      return {
        ...prev,
        [sqlTabId]: {
          ...state,
          resultTabs: kept,
          activeResultTabId: keepId,
          results: kept[0].results ?? null,
          error: kept[0].error ?? null,
          executionTime: kept[0].executionTime ?? 0,
        },
      };
    });
  }, []);

  const closeResultTabsToRight = useCallback((sqlTabId: string, anchorId: string) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state) return prev;
      const result = closeResultTabsByDirection(state, anchorId, "right");
      if (!result) return prev;
      return rebuildResultState(prev, sqlTabId, state, result.newTabs, result.newActiveId);
    });
  }, []);

  const closeResultTabsToLeft = useCallback((sqlTabId: string, anchorId: string) => {
    setSqlTabStates((prev) => {
      const state = prev[sqlTabId];
      if (!state) return prev;
      const result = closeResultTabsByDirection(state, anchorId, "left");
      if (!result) return prev;
      return rebuildResultState(prev, sqlTabId, state, result.newTabs, result.newActiveId);
    });
  }, []);

  const clearTableData = useCallback(() => {
    setResults(null);
    setTableStructure([]);
  }, []);

  const resetTableResults = useCallback(() => {
    setResults(null);
    setTableStructure([]);
    setForeignKeys([]);
    setPage(0);
    setFilterQuery("");
    setSortConfig(null);
    setError(null);
  }, []);

  const updateSqlTabState = useCallback((tabId: string, updates: Partial<SqlTabData>) => {
    setSqlTabStates((prev) => {
      const state = prev[tabId];
      if (!state) return prev;
      return { ...prev, [tabId]: { ...state, ...updates } };
    });
  }, []);

  const isActiveSqlTabRunning = !!activeTabId && !!sqlTabStates[activeTabId]?.loading;

  const updateTabStructureCache = useCallback((tabId: string, requestId: number, updates: Record<string, unknown>) => {
    if (tabRefreshRequestIdsRef.current[tabId] !== requestId) return;
    setTabDataCache(prev => ({
      ...prev,
      [tabId]: {
        ...prev[tabId],
        ...updates,
      }
    }));
  }, []);

  const refreshTableData = useCallback(async (
    tableName: string,
    schema: string,
    filter?: string,
    sort?: { column: string; direction: 'ASC' | 'DESC' } | null,
    pSize?: number,
    pPage?: number,
    targetTabId?: string,
    debugReason?: string,
    permissionContextOverride?: TablePermissionContext,
  ) => {
    if (!tableName || !schema) return;
    const tabId = resolveActiveTableTabId(schema, tableName, targetTabId) || `table-${schema}-${tableName}`;
    const effectivePermissionContext = permissionContextOverride ?? tablePermissionContext;
    const queryExecutionContext = buildQueryExecutionContext(effectivePermissionContext);
    if (dbType === "redis") {
      setTableLoadingById((prev) => (prev[tabId] ? { ...prev, [tabId]: false } : prev));
      clearTableData();
      return;
    }
    const requestId = ++tableRefreshRequestIdRef.current;
    const tabRequestId = (tabRefreshRequestIdsRef.current[tabId] || 0) + 1;
    tabRefreshRequestIdsRef.current[tabId] = tabRequestId;

    const isCurrentTarget = () =>
      activeTabIdRef.current === tabId
      && selectedSchemaRef.current === schema
      && selectedTableRef.current === tableName;
    const shouldUpdateVisibleState = isCurrentTarget();
    const shouldLogDebug = splitView.enabled || !!targetTabId || !!debugReason;
    const debugPayload = {
      tabId,
      tableName,
      schema,
      reason: debugReason || "unspecified",
      targetTabId: targetTabId || null,
      activeTabId: activeTabIdRef.current,
      activePaneId: activePaneIdRef.current,
      selectedSchema: selectedSchemaRef.current,
      selectedTable: selectedTableRef.current,
      shouldUpdateVisibleState,
      page: pPage !== undefined ? pPage : page,
      pageSize: pSize !== undefined ? pSize : pageSize,
      permissionContext: effectivePermissionContext?.kind || "default",
    };
    if (shouldLogDebug) {
      logStudioDebug("refresh-table-start", debugPayload);
    }
    
    // Always mark this specific tab as loading
    setTableLoadingById((prev) => (prev[tabId] ? prev : { ...prev, [tabId]: true }));

    if (shouldUpdateVisibleState) {
      setError(null);
      setExecutionTime(0);
    }
    const startTime = Date.now();
    if (shouldUpdateVisibleState) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      timerRef.current = setInterval(() => {
        if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
          setExecutionTime(Date.now() - startTime);
        }
      }, 250);
    }

    const limit = pSize !== undefined ? pSize : pageSize;
    const offset = (pPage !== undefined ? pPage : page) * limit;
    let refreshSucceeded = false;
    let refreshError: string | null = null;

    try {
      if (dbType === "mongodb") {
        const countCommand = JSON.stringify({
          operation: "count",
          database: schema,
          collection: tableName,
          filter: {},
        });
        const countRes = await runQuery(currentConnectionString, countCommand);
        if (countRes.success && countRes.data?.rows?.[0]?.count !== undefined) {
          const nextTotalCount = Number(countRes.data.rows[0].count) || 0;
          
          updateTabStructureCache(tabId, tabRequestId, {
        totalCount: nextTotalCount,
        filterQuery: filter || "",
        sortConfig: sort || null,
        page: pPage !== undefined ? pPage : page,
        pageSize: limit,
        permissionContext: effectivePermissionContext,
      });

          if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
            setTotalCount(nextTotalCount);
          }
        }

        const queryCommand = JSON.stringify({
          operation: "find",
          database: schema,
          collection: tableName,
          filter: {},
          limit,
          skip: offset,
          sort: sort ? { [sort.column]: sort.direction === "ASC" ? 1 : -1 } : undefined,
        });
        const res = await runQuery(currentConnectionString, queryCommand);
        if (res.success && res.data) {
          refreshSucceeded = true;
          updateTabStructureCache(tabId, tabRequestId, {
            results: res.data,
            filterQuery: filter || "",
            sortConfig: sort || null,
            page: pPage !== undefined ? pPage : page,
            pageSize: limit,
            permissionContext: effectivePermissionContext,
          });

          if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
            setResults(res.data);
            setExecutionTime(res.data.executionTime);
            setSelectedRows(new Set());
            setSelectedCell(null);
          }
        } else {
          refreshError = res.error || "An unknown error occurred while fetching collection data.";
          if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
            setError(res.error || "An unknown error occurred while fetching collection data.");
            setResults(null);
          }
        }
        return;
      }

      // Fetch total count first if it's not set or if filter/table changed
      const countSql = `SELECT COUNT(*) as count FROM ${quoteTableRef(schema, tableName)}${filter ? ` WHERE ${filter}` : ""}`;
      const countRes = await runQuery(currentConnectionString, countSql, [], undefined, queryExecutionContext);
      
      addHistoryEntry({
        query: countSql,
        duration: countRes.data?.executionTime || 0,
        status: countRes.success ? 'success' : 'error',
        error: countRes.error,
        rowsCount: countRes.data?.rows?.length || 0,
        caller: 'system',
      });

      if (countRes.success && countRes.data?.rows && countRes.data.rows.length > 0) {
        updateTabStructureCache(tabId, tabRequestId, {
        totalCount: parseInt(countRes.data.rows[0].count),
        filterQuery: filter || "",
        sortConfig: sort || null,
        page: pPage !== undefined ? pPage : page,
        pageSize: limit,
        permissionContext: effectivePermissionContext,
      });

        if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
          setTotalCount(parseInt(countRes.data.rows[0].count));
        }
      }

      const currentStructure = tableStructureRef.current;
      const currentHidden = hiddenColumnNamesRef.current;
      let columnsClause = "*";
      if (currentStructure.length > 0 && currentHidden.length > 0) {
        const selected = currentStructure
          .map(c => c.column_name)
          .filter((name: string) => !currentHidden.includes(name));
        if (selected.length > 0 && selected.length < currentStructure.length) {
          columnsClause = selected.map(c => quoteIdentifier(c)).join(", ");
        }
      }
      let sql = `SELECT ${columnsClause} FROM ${quoteTableRef(schema, tableName)}`;
      if (filter) sql += ` WHERE ${filter}`;
      if (dbType === "mssql") {
        if (sort) {
          sql += ` ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction}`;
        } else {
          sql += " ORDER BY (SELECT 1)";
        }
        sql += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`;
      } else if (dbType === "trino") {
        if (sort) sql += ` ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction}`;
        sql += ` LIMIT ${limit};`;
      } else if (dbType === "spacetimedb") {
        if (sort) sql += ` ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction}`;
        sql += ` LIMIT ${limit};`;
      } else {
        if (sort) sql += ` ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction}`;
        sql += ` LIMIT ${limit} OFFSET ${offset};`;
      }
      const res = await runQuery(currentConnectionString, sql, [], undefined, queryExecutionContext);

      addHistoryEntry({
        query: sql,
        duration: res.data?.executionTime || 0,
        status: res.success ? 'success' : 'error',
        error: res.error,
        rowsCount: res.data?.rows?.length || 0,
        caller: 'system',
      });

      if (res.success && res.data) {
        refreshSucceeded = true;
        let normalizedData = res.data;
        const hasFields = Array.isArray(normalizedData.fields) && normalizedData.fields.length > 0;
        const hasRows = Array.isArray(normalizedData.rows) && normalizedData.rows.length > 0;

        // SQLite may return no field metadata for empty result sets.
        // Backfill from table structure so headers still render.
        if (!hasFields && !hasRows) {
          const structRes = await fetchTableStructure(currentConnectionString, schema, tableName);
          if (structRes.success && Array.isArray(structRes.data) && structRes.data.length > 0) {
            if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
              setTableStructure(structRes.data);
            }
            normalizedData = {
              ...normalizedData,
              fields: structRes.data.map((column: any) => ({
                name: String(column.column_name || ""),
                dataTypeID: 0,
                dataTypeName: String(column.data_type || "unknown").toLowerCase(),
              })),
            };
            
            // Update cache structure too
            updateTabStructureCache(tabId, tabRequestId, {
              tableStructure: structRes.data,
            });
          }
        }

        updateTabStructureCache(tabId, tabRequestId, {
          results: normalizedData,
          filterQuery: filter || "",
          sortConfig: sort || null,
          page: pPage !== undefined ? pPage : page,
          pageSize: limit,
          permissionContext: effectivePermissionContext,
        });

        if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
          setResults(normalizedData);
          setExecutionTime(normalizedData.executionTime);
          setSelectedRows(new Set());
          setSelectedCell(null);
        }
      } else {
        refreshError = res.error || "An unknown error occurred while fetching table data.";
        if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
          setError(res.error || "An unknown error occurred while fetching table data.");
          setResults(null);
        }
      }
    } catch (err) {
      refreshError = err instanceof Error ? err.message : "A fatal error occurred.";
      if (requestId === tableRefreshRequestIdRef.current && isCurrentTarget()) {
        setError(err instanceof Error ? err.message : "A fatal error occurred.");
        setResults(null);
      }
    } finally {
      // Clear loading state if this is still the latest request for this specific tab
      if (tabRefreshRequestIdsRef.current[tabId] === tabRequestId) {
        setTableLoadingById((prev) => (prev[tabId] ? { ...prev, [tabId]: false } : prev));
      }

      // Clear timer and visible loading state only if this is the current global request
      if (shouldUpdateVisibleState && requestId === tableRefreshRequestIdRef.current) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }

      if (shouldLogDebug) {
        logStudioDebug("refresh-table-finish", {
          ...debugPayload,
          refreshSucceeded,
          refreshError,
          tabRequestId,
        });
      }
    }
  }, [pageSize, page, currentConnectionString, addHistoryEntry, dbType, quoteTableRef, quoteIdentifier, resolveActiveTableTabId, splitView.enabled, tablePermissionContext, runQuery]);

  const toggleColumn = useCallback((columnName: string) => {
    setHiddenColumnNames(prev => {
      const next = prev.includes(columnName)
        ? prev.filter(c => c !== columnName)
        : [...prev, columnName];
      hiddenColumnNamesRef.current = next;
      return next;
    });
    if (selectedTableRef.current && selectedSchemaRef.current) {
      const tabId = resolveActiveTableTabId(selectedSchemaRef.current, selectedTableRef.current)
        || `table-${selectedSchemaRef.current}-${selectedTableRef.current}`;
      refreshTableData(
        selectedTableRef.current,
        selectedSchemaRef.current,
        filterQueryRef.current,
        sortConfigRef.current,
        pageSizeRef.current,
        pageRef.current,
        tabId,
        "column-toggle"
      );
    }
  }, [refreshTableData, resolveActiveTableTabId]);

  const showAllColumns = useCallback(() => {
    setHiddenColumnNames([]);
    hiddenColumnNamesRef.current = [];
    if (selectedTableRef.current && selectedSchemaRef.current) {
      const tabId = resolveActiveTableTabId(selectedSchemaRef.current, selectedTableRef.current)
        || `table-${selectedSchemaRef.current}-${selectedTableRef.current}`;
      refreshTableData(
        selectedTableRef.current,
        selectedSchemaRef.current,
        filterQueryRef.current,
        sortConfigRef.current,
        pageSizeRef.current,
        pageRef.current,
        tabId,
        "column-toggle"
      );
    }
  }, [refreshTableData, resolveActiveTableTabId]);

  const handleAddSchema = (name: string) => {
    if (!name || schemas.includes(name) || pendingActions.some(a => a.type === 'create_schema' && a.metadata.name === name)) return;
    addReviewAction({ type: 'create_schema' as const, description: `Create schema "${name}"`, sql: `CREATE SCHEMA "${name}";`, metadata: { name } });
  };

  const handleUpdateRow = useCallback(async (rowId: string, columnName: string, oldValue: any, newValue: any, columnType: string) => {
    const isJsonColumn = isJsonColumnType(columnType);
    const nv = normalizeJsonColumnValue(newValue, columnName, isJsonColumn);
    if (nv.error) { toast.error(nv.error); return; }
    const finalValue = nv.value;
    const normalizedOldValue = stableStringify(oldValue);
    const normalizedNewValue = stableStringify(finalValue);

    if (executionMode === 'review') {

      if (normalizedNewValue === normalizedOldValue) {
        setPendingChanges(prev => {
          const newChanges = { ...prev };
          if (newChanges[rowId]) {
            delete newChanges[rowId][columnName];
            if (Object.keys(newChanges[rowId]).length === 0) delete newChanges[rowId];
          }
          return newChanges;
        });
      } else {
        setPendingChanges(prev => ({
          ...prev,
          [rowId]: {
            ...(prev[rowId] || {}),
            [columnName]: { old: oldValue, new: finalValue }
          }
        }));
        if (activeTabId && openTabs.find((t) => t.id === activeTabId)?.type === 'table') {
          markTabDirty(activeTabId);
        }
      }
    } else {
      // Direct mode
      if (!selectedTable || !selectedSchema) return;

      const where = parseRowId(rowId);

      if (normalizedNewValue === normalizedOldValue) {
        return;
      }

      const updates = [{ where, set: { [columnName]: finalValue } }];
      const startTime = Date.now();
      const res = await updateTableRows(currentConnectionString, selectedSchema, selectedTable, updates);

      addHistoryEntry({
        query: `-- Direct Update Row in ${selectedSchema}.${selectedTable}\n1 row affected`,
        duration: Date.now() - startTime,
        status: res.success ? 'success' : 'error',
        error: res.error,
        caller: 'user',
      });

      if (res.success) {
        toast.success("Row updated successfully");
        applyOptimisticRowUpdates(selectedSchema, selectedTable, updates);
        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig);
      } else {
        toast.error(res.error || "Failed to update row");
      }
    }
  }, [executionMode, selectedTable, selectedSchema, currentConnectionString, filterQuery, sortConfig, refreshTableData, addHistoryEntry, applyOptimisticRowUpdates, activeTabId, openTabs, markTabDirty]);

  const handleCommitChanges = useCallback(async () => {
    if (!Object.keys(pendingChanges).length && !pendingActions.length || !selectedSchema) return;

    const rowOnlyActionTypes = new Set([
      "delete_row",
      "insert_row",
      "duplicate_row",
      "empty_table",
      "redis_command",
    ]);
    const hasMetadataChangingActions = pendingActions.some(
      (action) => !rowOnlyActionTypes.has(action.type)
    );
    const hasRedisActions = pendingActions.some(
      (action) => action.type === "redis_command"
    );
    const optimisticRowOps: Array<
      | { kind: "delete"; schema: string; table: string; whereClauses: Array<Record<string, unknown>> }
      | { kind: "insert"; schema: string; table: string; rows: Array<Record<string, unknown>> }
      | { kind: "clear"; schema: string; table: string }
    > = [];

    setIsDeleting(true);
    setError(null);

    try {
      // 1. Handle pending actions (new way for DDL and complex DML)
      if (pendingActions.length > 0) {
        for (const action of pendingActions) {
          const startTime = Date.now();
          const actionConnectionString = action.type === "redis_command" && action.metadata?.redisDb
            ? updateRedisConnectionStringDatabase(currentConnectionString, action.metadata.redisDb)
            : currentConnectionString;

          const res = await runQuery(actionConnectionString, action.sql, action.params);

          logQueryResult(action.sql, res, startTime);

          if (!res.success) {
            throw new Error(res.error || `Failed to execute action: ${action.description}`);
          }

          const targetSchema = String(action.metadata?.schema ?? action.metadata?.database ?? "");
          const targetTable = String(action.metadata?.table ?? action.metadata?.collection ?? "");
          if (!targetSchema || !targetTable) {
            continue;
          }

          if (action.type === "delete_row" && action.metadata?.where && typeof action.metadata.where === "object") {
            optimisticRowOps.push({
              kind: "delete",
              schema: targetSchema,
              table: targetTable,
              whereClauses: [action.metadata.where as Record<string, unknown>],
            });
            continue;
          }

          if (action.type === "empty_table") {
            optimisticRowOps.push({ kind: "clear", schema: targetSchema, table: targetTable });
            continue;
          }

          if (action.type === "insert_row" || action.type === "duplicate_row") {
            const insertedRows = Array.isArray(res.data?.rows)
              ? (res.data.rows as Array<Record<string, unknown>>)
              : [];
            const fallbackDocument =
              action.metadata?.document && typeof action.metadata.document === "object"
                ? [action.metadata.document as Record<string, unknown>]
                : [];
            const rows = insertedRows.length ? insertedRows : fallbackDocument;
            if (rows.length > 0) {
              optimisticRowOps.push({
                kind: "insert",
                schema: targetSchema,
                table: targetTable,
                rows,
              });
            }
          }
        }
      }

      for (const op of optimisticRowOps) {
        if (op.kind === "delete") {
          applyOptimisticRowDeletes(op.schema, op.table, op.whereClauses);
        } else if (op.kind === "insert") {
          applyOptimisticRowInsertions(op.schema, op.table, op.rows);
        } else {
          applyOptimisticTableClear(op.schema, op.table);
        }
      }

      // 2. Handle pending row changes (DML)
      if (Object.keys(pendingChanges).length > 0) {
        if (!selectedTable) return;
        const hasUnsaveable = Object.keys(pendingChanges).some(id => id.startsWith('idx:'));
        if (hasUnsaveable) {
          throw new Error("Cannot save changes: One or more rows do not have a primary key.");
        }

        const updates = Object.entries(pendingChanges).map(([rowId, changes]) => {
          const where = parseRowId(rowId);
          const setValues: Record<string, any> = {};
          Object.entries(changes).forEach(([col, val]) => {
            const struct = tableStructure.find((column) => column.column_name === col);
            const columnType = String(struct?.data_type || "");
            if (!isJsonColumnType(columnType)) {
              setValues[col] = val.new;
              return;
            }

            const normalized = normalizeJsonInput(val.new, col);
            if (normalized.error) {
              throw new Error(normalized.error);
            }
            setValues[col] = normalized.value;
          });
          return { where, set: setValues };
        });

        const startTime = Date.now();
        const res = await updateTableRows(currentConnectionString, selectedSchema, selectedTable, updates);

        addHistoryEntry({
          query: `-- Batch Update Rows in ${selectedSchema}.${selectedTable}\n${updates.length} rows affected`,
          duration: Date.now() - startTime,
          status: res.success ? 'success' : 'error',
          error: res.error,
          caller: 'user',
        });

        if (!res.success) {
          throw new Error(res.error || "Failed to commit row changes");
        }

        applyOptimisticRowUpdates(selectedSchema, selectedTable, updates);
      }

      // Success
      setPendingChanges({});
      setPendingActions([]);
      if (activeTabId) markTabClean(activeTabId);
      setIsReviewSheetOpen(false);
      toast.success("All changes committed successfully");

      // Refresh visible table data first; run broader metadata sync in background.
      if (selectedTable) {
        void refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page);
        void (async () => {
          await refreshActiveTableStructure(
            currentConnectionString, selectedSchema, selectedTable,
            fetchTableStructure, fetchTableForeignKeys,
            resolveActiveTableTabId, updateTableStructureCache,
          );
        })();
      }
      if (hasRedisActions) {
        void refreshTablesSidebar();
      }

      if (hasMetadataChangingActions) {
        void Promise.all([
          loadSchemas(),
          loadTables(),
          loadEnums(),
          loadIndexes(),
          loadTriggers(),
          loadFunctions(),
          loadExtensions(),
          loadRlsPolicies(selectedSchema),
          loadPostgresRoles(),
          loadDatabases(),
        ]).catch((syncError) => {
          console.warn("Background metadata sync failed after commit:", syncError);
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      console.error("Commit failed:", err);
      setError(msg || "Failed to commit changes");
      toast.error(msg || "Failed to commit changes");
    } finally {
      setIsDeleting(false);
    }
  }, [pendingChanges, pendingActions, selectedSchema, selectedTable, currentConnectionString, filterQuery, sortConfig, addHistoryEntry, loadSchemas, loadTables, loadEnums, loadIndexes, loadTriggers, loadFunctions, loadExtensions, loadRlsPolicies, loadPostgresRoles, loadDatabases, refreshTableData, refreshTablesSidebar, tableStructure, pageSize, page, applyOptimisticRowUpdates, applyOptimisticRowDeletes, applyOptimisticRowInsertions, applyOptimisticTableClear, activeTabId, markTabClean]);

  const runAddColumnAction = useCallback(async (opts: {
    reviewAction: { type: string; description: string; sql: string; metadata?: any };
    sql: string;
    fallbackError: string;
    successMessage: string;
    createMore?: boolean;
  }) => {
    if (addReviewAction(opts.reviewAction)) {
      if (!opts.createMore) setIsAddColumnSheetOpen(false);
      return;
    }
    setIsAddingColumn(true);
    try {
      const startTime = Date.now();
      const res = await runQuery(currentConnectionString, opts.sql);
      logQueryResult(opts.sql, res, startTime);
      if (res.success) {
        if (!opts.createMore) setIsAddColumnSheetOpen(false);
        refreshTableData(selectedTable!, selectedSchema!, filterQuery, sortConfig);
        toast.success(opts.successMessage);
      } else {
        setError(res.error || opts.fallbackError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : opts.fallbackError);
    } finally {
      setIsAddingColumn(false);
    }
  }, [addReviewAction, currentConnectionString, runQuery, addHistoryEntry, refreshTableData, selectedTable, selectedSchema, filterQuery, sortConfig, setError, setIsAddingColumn]);

  const handleAddColumn = useCallback(async (column: AddColumnPayload) => {
    if (!selectedTable || !selectedSchema) return;

    if (dbType === "mongodb") {
      const hasDefault = String(column.default || "").trim().length > 0;
      const defaultValue: any = hasDefault ? column.default : null;
      const mongoCommand = JSON.stringify({
        operation: "updateMany",
        database: selectedSchema,
        collection: selectedTable,
        filter: {},
        update: {
          $set: {
            [column.name]: defaultValue,
          },
        },
      }, null, 2);

      await runAddColumnAction({
        reviewAction: { type: 'add_column', description: `Add field "${column.name}" to ${selectedSchema}.${selectedTable}`, sql: mongoCommand, metadata: { database: selectedSchema, collection: selectedTable, column } },
        sql: mongoCommand,
        fallbackError: "Failed to add field",
        successMessage: `Field "${column.name}" added successfully`,
        createMore: column.createMore,
      });
      return;
    }

    const quotedColumnName = quoteIdentifier(String(column.name || ""));
    const tableRef = quoteTableRef(selectedSchema, selectedTable);
    const rawType = String(column.type || "TEXT").trim();
    const baseType = (dbType === "mysql" || dbType === "clickhouse" || dbType === "mssql" || !column.isArray || !rawType) ? rawType : `${rawType}[]`;
    const typeClause = dbType === "clickhouse" && column.isNullable && !/^Nullable\s*\(/i.test(baseType)
      ? `Nullable(${baseType})`
      : baseType;
    const nullable = dbType === "clickhouse" ? "" : (column.isPrimary || !column.isNullable) ? "NOT NULL" : "NULL";
    const defaultRaw = String(column.default || "").trim();
    const isAutoIncrement = dbType === "mysql" && /auto_increment/i.test(defaultRaw);
    const isIdentity = dbType === "mssql" && /^identity/i.test(defaultRaw);
    const defaultValue = (!isAutoIncrement && !isIdentity && defaultRaw) ? ` DEFAULT ${defaultRaw}` : "";
    const autoIncrementClause = isAutoIncrement ? " AUTO_INCREMENT" : "";
    const identityClause = isIdentity ? ` ${defaultRaw}` : "";
    const uniqueClause = column.isUnique ? " UNIQUE" : "";
    const primaryClause = column.isPrimary ? " PRIMARY KEY" : "";
    const checkClause = column.checkConstraint?.trim()
      ? ` CHECK (${column.checkConstraint.trim()})`
      : "";
    const foreignKeyClause = column.foreignKey
      ? (() => {
        const fkSchema = String(column.foreignKey?.schema || "");
        const fkTable = String(column.foreignKey?.table || "");
        const fkColumn = quoteIdentifier(String(column.foreignKey?.column || ""));
        const onUpdate = column.foreignKey?.onUpdate ? ` ON UPDATE ${column.foreignKey.onUpdate}` : "";
        const onDelete = column.foreignKey?.onDelete ? ` ON DELETE ${column.foreignKey.onDelete}` : "";
        return ` REFERENCES ${quoteTableRef(fkSchema, fkTable)} (${fkColumn})${onUpdate}${onDelete}`;
      })()
      : "";

    if (dbType === "sqlite" && (column.isPrimary || column.isUnique)) {
      const message = "SQLite does not support adding PRIMARY KEY or UNIQUE via ALTER TABLE ADD COLUMN.";
      setError(message);
      toast.error(message);
      return;
    }

    const addKeyword = dbType === "mssql" ? "ADD" : "ADD COLUMN";
    const sql = `ALTER TABLE ${tableRef} ${addKeyword} ${quotedColumnName} ${typeClause}${identityClause} ${nullable}${defaultValue}${primaryClause}${uniqueClause}${autoIncrementClause}${checkClause}${foreignKeyClause};`;

    await runAddColumnAction({
      reviewAction: { type: 'add_column', description: `Add column "${column.name}" (${typeClause}) to ${selectedSchema}.${selectedTable}`, sql, metadata: { schema: selectedSchema, table: selectedTable, column } },
      sql,
      fallbackError: "Failed to add column",
      successMessage: `Column "${column.name}" added successfully`,
      createMore: column.createMore,
    });
  }, [selectedTable, selectedSchema, executionMode, currentConnectionString, addHistoryEntry, filterQuery, sortConfig, refreshTableData, dbType, quoteIdentifier, quoteTableRef, runAddColumnAction]);

  const handleAddForeignKey = useCallback(async (data: {
    sourceSchema: string;
    sourceTable: string;
    sourceColumn: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
    constraintName: string;
    onUpdate: string;
    onDelete: string;
  }) => {
    if (dbType !== 'postgres' && dbType !== 'mysql') return;

    const sql = `ALTER TABLE ${quoteTableRef(data.sourceSchema, data.sourceTable)} ADD CONSTRAINT ${quoteIdentifier(data.constraintName)} FOREIGN KEY (${quoteIdentifier(data.sourceColumn)}) REFERENCES ${quoteTableRef(data.targetSchema, data.targetTable)} (${quoteIdentifier(data.targetColumn)}) ON UPDATE ${data.onUpdate} ON DELETE ${data.onDelete};`;

    if (addReviewAction({ type: 'add_fk' as const, description: `Add foreign key from ${data.sourceTable}.${data.sourceColumn} to ${data.targetTable}.${data.targetColumn}`, sql, metadata: data })) {
      setIsAddFKSheetOpen(false);
      return;
    }

    // Direct mode
    setMutationLoading(true);
    try {
      const startTime = Date.now();
      const res = await runQuery(currentConnectionString, sql);

      logQueryResult(sql, res, startTime);

      if (res.success) {
        toast.success("Foreign key added successfully");
        setIsAddFKSheetOpen(false);
        // Refresh everything
        loadSchemaData();
        if (selectedTable === data.sourceTable) {
          refreshCurrentTab();
        }
      } else {
        toast.error(res.error || "Failed to add foreign key");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add foreign key");
    } finally {
      setMutationLoading(false);
    }
  }, [dbType, executionMode, currentConnectionString, addHistoryEntry, loadSchemaData, selectedTable, refreshCurrentTab, quoteIdentifier, quoteTableRef]);

  const handleDeleteColumn = useCallback(async (columnName: string) => {
    if (!selectedTable || !selectedSchema) return;

    if (dbType === "mongodb") {
      const mongoCommand = JSON.stringify({
        operation: "updateMany",
        database: selectedSchema,
        collection: selectedTable,
        filter: {},
        update: {
          $unset: {
            [columnName]: "",
          },
        },
      }, null, 2);

      if (addReviewAction({ type: 'delete_column', description: `Delete field "${columnName}" from ${selectedSchema}.${selectedTable}`, sql: mongoCommand, metadata: { database: selectedSchema, collection: selectedTable, columnName } })) {
        setColumnToDelete(null);
        return;
      }

      try {
        const startTime = Date.now();
        const res = await runQuery(currentConnectionString, mongoCommand);

        logQueryResult(mongoCommand, res, startTime);

        if (res.success) {
          setColumnToDelete(null);
        refreshTableData(selectedTable!, selectedSchema!, filterQuery, sortConfig);
          toast.success(`Field "${columnName}" deleted successfully`);
        } else {
          setError(res.error || "Failed to delete field");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete field");
      }
      return;
    }

    const sql = `ALTER TABLE ${quoteTableRef(selectedSchema, selectedTable)} DROP COLUMN ${quoteIdentifier(columnName)};`;

    if (addReviewAction({ type: 'delete_column', description: `Delete column "${columnName}" from ${selectedSchema}.${selectedTable}`, sql, metadata: { schema: selectedSchema, table: selectedTable, columnName } })) {
      setColumnToDelete(null);
      return;
    }

    try {
      const { success, error } = await executeSqlWithHistory(runQuery, currentConnectionString, sql, addHistoryEntry);
      if (success) {
        setColumnToDelete(null);
        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig);
        toast.success(`Column "${columnName}" deleted successfully`);
      } else {
        setError(error || "Failed to delete column");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete column");
    }
  }, [selectedTable, selectedSchema, executionMode, currentConnectionString, addHistoryEntry, filterQuery, sortConfig, refreshTableData, dbType, quoteIdentifier, quoteTableRef]);

  const handleEditColumn = useCallback(async (payload: EditColumnPayload) => {
    if (!selectedTable || !selectedSchema) return;
    const trimmed = String(payload.newName || "").trim();
    const originalName = String(payload.columnName || "").trim();
    if (!trimmed) return;

    if (dbType === "mongodb") {
      if (trimmed === originalName) {
        setIsEditColumnSheetOpen(false);
        setColumnToEdit(null);
        return;
      }
      const mongoCommand = JSON.stringify({
        operation: "updateMany",
        database: selectedSchema,
        collection: selectedTable,
        filter: {},
        update: {
          $rename: {
            [originalName]: trimmed,
          },
        },
      }, null, 2);

      if (addReviewAction({ type: 'rename_column', description: `Rename field "${originalName}" to "${trimmed}" in ${selectedSchema}.${selectedTable}`, sql: mongoCommand, metadata: { database: selectedSchema, collection: selectedTable, columnName: originalName, newName: trimmed } })) {
        setIsEditColumnSheetOpen(false);
        setColumnToEdit(null);
        return;
      }

      setIsEditingColumn(true);
      try {
        const startTime = Date.now();
        const res = await runQuery(currentConnectionString, mongoCommand);

        logQueryResult(mongoCommand, res, startTime);

        if (res.success) {
          setIsEditColumnSheetOpen(false);
          setColumnToEdit(null);
          refreshCurrentTab();
          toast.success(`Field "${originalName}" renamed to "${trimmed}"`);
        } else {
          setError(res.error || "Failed to rename field");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename field");
      } finally {
        setIsEditingColumn(false);
      }
      return;
    }

    if (dbType !== "postgres" && dbType !== "supabase-mgmt") {
      toast.error("Editing column constraints is supported only for PostgreSQL.");
      return;
    }

    const escapeLiteral = (value: string) => value.replace(/'/g, "''");
    const tableRef = quoteTableRef(selectedSchema, selectedTable);
    const currentColumn = tableStructure.find((col: any) => (col?.name || col?.column_name) === originalName);
    const currentType = String(currentColumn?.data_type || currentColumn?.udt_name || "").trim();
    const currentNullable = String(currentColumn?.is_nullable || "").toUpperCase() !== "NO";
    const currentDefault = currentColumn?.column_default ? String(currentColumn.column_default).trim() : "";
    const currentPrimary = Boolean(currentColumn?.is_primary_key);
    const desiredType = String(payload.dataType || "").trim() || currentType;
    const desiredDefault = String(payload.defaultValue || "").trim();
    const desiredCheck = String(payload.checkConstraint || "").trim();

    const statements: Array<{ sql: string; description: string }> = [];
    let workingName = originalName;

    if (trimmed && trimmed !== originalName) {
      const renameSql = `ALTER TABLE ${tableRef} RENAME COLUMN ${quoteIdentifier(originalName)} TO ${quoteIdentifier(trimmed)};`;
      statements.push({
        sql: renameSql,
        description: `Rename column "${originalName}" to "${trimmed}" in ${selectedSchema}.${selectedTable}`,
      });
      workingName = trimmed;
    }

    if (desiredType && desiredType.toLowerCase() !== currentType.toLowerCase()) {
      statements.push({
        sql: `ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdentifier(workingName)} TYPE ${desiredType};`,
        description: `Change data type of "${workingName}" to ${desiredType}`,
      });
    }

    if (payload.isNullable !== currentNullable) {
      statements.push({
        sql: `ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdentifier(workingName)} ${payload.isNullable ? "DROP NOT NULL" : "SET NOT NULL"};`,
        description: `${payload.isNullable ? "Allow" : "Disallow"} NULLs for "${workingName}"`,
      });
    }

    if (desiredDefault !== currentDefault) {
      const defaultSql = desiredDefault
        ? `ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdentifier(workingName)} SET DEFAULT ${desiredDefault};`
        : `ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdentifier(workingName)} DROP DEFAULT;`;
      statements.push({
        sql: defaultSql,
        description: desiredDefault ? `Set default for "${workingName}"` : `Drop default for "${workingName}"`,
      });
    }

    const dropConstraintSql = (columnName: string, constraintType: "p" | "u" | "c") => {
      const schemaLiteral = escapeLiteral(selectedSchema);
      const tableLiteral = escapeLiteral(selectedTable);
      const columnLiteral = escapeLiteral(columnName);
      return `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = '${constraintType}'
      AND n.nspname = '${schemaLiteral}'
      AND t.relname = '${tableLiteral}'
      AND a.attname = '${columnLiteral}'
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', '${schemaLiteral}', '${tableLiteral}', r.conname);
  END LOOP;
END $$;`.trim();
    };

    if (payload.isPrimary && !currentPrimary) {
// fallow-ignore-next-line code-duplication
      const base = `pk_${selectedTable}_${workingName}`.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 40);
      const constraintName = `${base}_${Math.random().toString(36).slice(2, 6)}`;
      statements.push({
        sql: `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${quoteIdentifier(workingName)});`,
        description: `Add primary key on "${workingName}"`,
      });
    }
    if (!payload.isPrimary && currentPrimary) {
      statements.push({
        sql: dropConstraintSql(workingName, "p"),
        description: `Drop primary key on "${workingName}"`,
      });
    }

    if (payload.uniqueTouched && payload.isUnique) {
      const base = `uq_${selectedTable}_${workingName}`.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 40);
      const constraintName = `${base}_${Math.random().toString(36).slice(2, 6)}`;
      const schemaLiteral = escapeLiteral(selectedSchema);
      const tableLiteral = escapeLiteral(selectedTable);
      const columnLiteral = escapeLiteral(workingName);
      statements.push({
        sql: `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'u'
      AND n.nspname = '${schemaLiteral}'
      AND t.relname = '${tableLiteral}'
      AND a.attname = '${columnLiteral}'
      AND array_length(c.conkey, 1) = 1
  ) THEN
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (%I)', '${schemaLiteral}', '${tableLiteral}', '${constraintName}', '${columnLiteral}');
  END IF;
END $$;`.trim(),
        description: `Ensure unique constraint on "${workingName}"`,
      });
    } else if (payload.uniqueTouched && !payload.isUnique) {
      statements.push({
        sql: dropConstraintSql(workingName, "u"),
        description: `Drop unique constraint on "${workingName}"`,
      });
    }

    if (payload.checkTouched && desiredCheck) {
// fallow-ignore-next-line code-duplication
      const base = `chk_${selectedTable}_${workingName}`.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 40);
      const constraintName = `${base}_${Math.random().toString(36).slice(2, 6)}`;
      statements.push({
        sql: `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteIdentifier(constraintName)} CHECK (${desiredCheck});`,
        description: `Add check constraint on "${workingName}"`,
      });
    } else if (payload.checkTouched && !desiredCheck) {
      statements.push({
        sql: dropConstraintSql(workingName, "c"),
        description: `Drop check constraints on "${workingName}"`,
      });
    }

    const existingFk = foreignKeys.find((fk) => fk.column_name === originalName);
    const fkMatches = Boolean(
      payload.foreignKeyEnabled
      && payload.foreignKey
      && existingFk
      && existingFk.foreign_table_schema === payload.foreignKey.schema
      && existingFk.foreign_table_name === payload.foreignKey.table
      && existingFk.foreign_column_name === payload.foreignKey.column
    );

    const dropFkSql = (columnName: string) => {
      const schemaLiteral = escapeLiteral(selectedSchema);
      const tableLiteral = escapeLiteral(selectedTable);
      const columnLiteral = escapeLiteral(columnName);
      return `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND n.nspname = '${schemaLiteral}'
      AND t.relname = '${tableLiteral}'
      AND a.attname = '${columnLiteral}'
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', '${schemaLiteral}', '${tableLiteral}', r.conname);
  END LOOP;
END $$;`.trim();
    };

    if (payload.foreignKeyEnabled && payload.foreignKey && !fkMatches) {
      if (existingFk) {
        statements.push({
          sql: dropFkSql(workingName),
          description: `Drop existing foreign key on "${workingName}"`,
        });
      }
      const safeBase = `fk_${selectedTable}_${workingName}`.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 40);
      const suffix = Math.random().toString(36).slice(2, 6);
      const constraintName = `${safeBase}_${suffix}`;
      const onUpdate = payload.foreignKey.onUpdate ? ` ON UPDATE ${payload.foreignKey.onUpdate}` : "";
      const onDelete = payload.foreignKey.onDelete ? ` ON DELETE ${payload.foreignKey.onDelete}` : "";
      statements.push({
        sql: `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteIdentifier(constraintName)} FOREIGN KEY (${quoteIdentifier(workingName)}) REFERENCES ${quoteTableRef(payload.foreignKey.schema, payload.foreignKey.table)} (${quoteIdentifier(payload.foreignKey.column)})${onUpdate}${onDelete};`,
        description: `Add foreign key on "${workingName}"`,
      });
    }

    if (!payload.foreignKeyEnabled && existingFk) {
      statements.push({
        sql: dropFkSql(workingName),
        description: `Drop foreign key on "${workingName}"`,
      });
    }

    if (statements.length === 0) {
      setIsEditColumnSheetOpen(false);
      setColumnToEdit(null);
      return;
    }

    if (addReviewAction(statements.map((stmt) => ({ type: 'edit_column' as const, description: stmt.description, sql: stmt.sql, metadata: { schema: selectedSchema, table: selectedTable, columnName: originalName, newName: trimmed } })))) {
      setIsEditColumnSheetOpen(false);
      setColumnToEdit(null);
      return;
    }

    setIsEditingColumn(true);
    try {
      for (const stmt of statements) {
        const startTime = Date.now();
        const res = await runQuery(currentConnectionString, stmt.sql);

        logQueryResult(stmt.sql, res, startTime);

        if (!res.success) {
          setError(res.error || "Failed to edit column");
          toast.error(res.error || "Failed to edit column");
          return;
        }
      }
      setIsEditColumnSheetOpen(false);
      setColumnToEdit(null);
      refreshCurrentTab();
      toast.success(`Column "${originalName}" updated successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit column");
      toast.error(err instanceof Error ? err.message : "Failed to edit column");
    } finally {
      setIsEditingColumn(false);
    }
  }, [selectedTable, selectedSchema, executionMode, currentConnectionString, addHistoryEntry, refreshCurrentTab, dbType, quoteIdentifier, quoteTableRef, tableStructure, foreignKeys]);

  const handleFKPreview = useCallback(async (columnName: string, value: any) => {
    const fk = foreignKeys.find(f => f.column_name === columnName);
    if (!fk || value === null) return;
    setFKPreviewRecord({
      data: null,
      fields: [],
      schema: fk.foreign_table_schema,
      table: fk.foreign_table_name,
      column: fk.foreign_column_name,
      value: value,
      loading: true
    });
    try {
      const res = await fetchReferencedRecord(
        currentConnectionString,
        fk.foreign_table_schema,
        fk.foreign_table_name,
        { [fk.foreign_column_name]: value }
      );
      if (res.success) {
        setFKPreviewRecord({
          data: res.data,
          fields: res.fields || [],
          schema: fk.foreign_table_schema,
          table: fk.foreign_table_name,
          column: fk.foreign_column_name,
          value: value,
          loading: false
        });
      } else {
        setError(`Failed to fetch referenced record: ${res.error}`);
        setFKPreviewRecord(null);
      }
    } catch (err) {
      setError("An error occurred while fetching the referenced record.");
      setFKPreviewRecord(null);
    }
  }, [foreignKeys, currentConnectionString]);

  const openFKSelection = useCallback(async (columnName: string, rowIndex: number | null = null) => {
    let fk = foreignKeys.find(f => f.column_name === columnName);
    if (!fk && selectedTable && selectedSchema) {
      const fkRes = await fetchTableForeignKeys(currentConnectionString, selectedSchema, selectedTable);
      if (fkRes.success && fkRes.data) {
        const refreshedForeignKeys = fkRes.data as Array<{
          column_name: string;
          foreign_table_schema: string;
          foreign_table_name: string;
          foreign_column_name: string;
        }>;
        setForeignKeys(refreshedForeignKeys);
        fk = refreshedForeignKeys.find((f) => f.column_name === columnName);
      }
    }
    if (!fk) return false;
    setFKSelectionTarget({ rowIndex, columnName, fkInfo: fk });
    setIsFKSelectionSheetOpen(true);
    setFKSelectionLoading(true);
    setFKSelectionSearch("");
    try {
      const query = isMssql
        ? `SELECT TOP 100 * FROM ${quoteTableRef(fk.foreign_table_schema, fk.foreign_table_name)}`
        : `SELECT * FROM ${quoteTableRef(fk.foreign_table_schema, fk.foreign_table_name)} LIMIT 100`;
      const startTime = Date.now();
      const res = await runQuery(currentConnectionString, query);

      addHistoryEntry({
        query,
        duration: res.data?.executionTime || (Date.now() - startTime),
        status: res.success ? 'success' : 'error',
        error: res.error,
        rowsCount: res.data?.rows?.length || 0,
        caller: 'system'
      });

      if (res.success) {
        setFKSelectionData(res.data);
        return true;
      }
      setError(res.error || `Failed to load records from ${fk.foreign_table_schema}.${fk.foreign_table_name}`);
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while loading referenced records.");
      return false;
    } finally {
      setFKSelectionLoading(false);
    }
  }, [foreignKeys, currentConnectionString, selectedSchema, selectedTable, addHistoryEntry, isMssql]);

  const handleFKSelection = useCallback(async (rowIndex: number, columnName: string) => {
    return openFKSelection(columnName, rowIndex);
  }, [openFKSelection]);

  const handleInsertFKSelection = useCallback(async (columnName: string) => {
    return openFKSelection(columnName, null);
  }, [openFKSelection]);

  const selectFKRecord = useCallback((record: any) => {
    if (!fkSelectionTarget) return;
    const { rowIndex, columnName, fkInfo } = fkSelectionTarget;
    const newValue = record[fkInfo.foreign_column_name];
    if (rowIndex === null) {
      setInsertData(prev => ({
        ...prev,
        [columnName]: newValue === null || newValue === undefined ? "" : String(newValue)
      }));
      setIsFKSelectionSheetOpen(false);
      setFKSelectionTarget(null);
      return;
    }
    const row = results.rows[rowIndex];
    const rowId = getRowId(row, rowIndex);
    if (rowId) {
      const isModified = hasChanges(rowIndex, columnName);
      const oldValue = isModified ? pendingChanges[rowId][columnName].old : row[columnName];
      if (String(newValue ?? "") === String(oldValue ?? "")) {
        const newChanges = { ...pendingChanges };
        if (newChanges[rowId]) {
          delete newChanges[rowId][columnName];
          if (Object.keys(newChanges[rowId]).length === 0) delete newChanges[rowId];
        }
        setPendingChanges(newChanges);
      } else {
        setPendingChanges(prev => ({
          ...prev,
          [rowId]: {
            ...(prev[rowId] || {}),
            [columnName]: { old: oldValue, new: newValue }
          }
        }));
        if (activeTabId && openTabs.find((t) => t.id === activeTabId)?.type === 'table') {
          markTabDirty(activeTabId);
        }
      }
    }
    setIsFKSelectionSheetOpen(false);
    setFKSelectionTarget(null);
  }, [fkSelectionTarget, results, getRowId, hasChanges, pendingChanges, activeTabId, openTabs, markTabDirty]);

  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);

  // fallow-ignore-next-line code-duplication
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  // fallow-ignore-next-line code-duplication
  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(0);
    const connId = Number(connection.id);
    if (connId && selectedTable && selectedSchema) {
      saveTablePagination(connId, selectedSchema, selectedTable, newSize);
    }
  }, [connection.id, selectedTable, selectedSchema]);

  useEffect(() => {
    if (selectedTable && selectedSchema && viewMode === 'tables') {
      const tabId = resolveActiveTableTabId(selectedSchema, selectedTable) || `table-${selectedSchema}-${selectedTable}`;
      const cached = tabDataCache[tabId];
      const matchingActiveTable = activeTabId
        ? openTabs.find((tab) => tab.id === activeTabId && tab.type === "table" && tab.schema === selectedSchema && tab.name === selectedTable)
        : null;

      if (splitView.enabled && !matchingActiveTable) {
        logStudioDebug("selected-table-effect-skip", {
          reason: "split-mismatch",
          tabId,
          selectedSchema,
          selectedTable,
          activeTabId,
          activePaneId: splitView.activePaneId,
          preservedVisibleState: true,
        });
        return;
      }

      // If we have cached results and the filters match, use them
        const filtersMatch = cached &&
        cached.filterQuery === filterQuery &&
        JSON.stringify(cached.sortConfig) === JSON.stringify(sortConfig) &&
        cached.page === page &&
        cached.pageSize === pageSize &&
        areTablePermissionContextsEqual(cached.permissionContext ?? null, tablePermissionContext);

      if (filtersMatch) {
        setResults((prev: unknown) => (prev === cached.results ? prev : cached.results));
        const nextStructure = cached.tableStructure || [];
        const nextForeignKeys = cached.foreignKeys || [];
        const nextTotalCount = cached.totalCount ?? null;
        setTableStructure((prev) => (prev === nextStructure ? prev : nextStructure));
        setForeignKeys((prev) => (prev === nextForeignKeys ? prev : nextForeignKeys));
        setTotalCount((prev) => (prev === nextTotalCount ? prev : nextTotalCount));
        if (tabSwitchPerfRef.current && !tabSwitchPerfRef.current.ended && tabSwitchPerfRef.current.toTabId === tabId) {
          tabSwitchPerfRef.current.ended = true;
          logTabPerf("table-ready-cache", {
            filterQuery,
            sortConfig,
            page,
            pageSize,
            rows: cached?.results?.rows?.length ?? 0,
          });
        }
        if (!hasLoadedInitialData) setHasLoadedInitialData(true);
        if (dbType === "spacetimedb") {
          fetchTableStructure(currentConnectionString, selectedSchema, selectedTable).then(structRes => {
            if (structRes.success && structRes.data) {
              setTableStructure(structRes.data);
              setTabDataCache(prev => ({ ...prev, [tabId]: { ...prev[tabId], tableStructure: structRes.data } }));
            }
          });
        }
      } else {
        const isInitial = !hasLoadedInitialData;
        if (isInitial) setFetchingInitialData(true);
        logStudioDebug("selected-table-effect-refresh", {
          tabId,
          selectedSchema,
          selectedTable,
          activeTabId,
          activePaneId: splitView.activePaneId,
        });

        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page, tabId, "selected-table-effect")
          .finally(() => {
            if (tabSwitchPerfRef.current && !tabSwitchPerfRef.current.ended && tabSwitchPerfRef.current.toTabId === tabId) {
              tabSwitchPerfRef.current.ended = true;
              logTabPerf("table-ready-fetch", {
                filterQuery,
                sortConfig,
                page,
                pageSize,
              });
            }
            if (isInitial) {
              setFetchingInitialData(false);
              setHasLoadedInitialData(true);
            }
          });

        const hasStructureCache = !!cached && Array.isArray(cached.tableStructure);
        const hasForeignKeysCache = !!cached && Array.isArray(cached.foreignKeys);
        const shouldLoadStructure = !(hasStructureCache && hasForeignKeysCache) || dbType === "spacetimedb";
        const loadStructure = async () => {
          const structureStart = typeof performance !== "undefined" ? performance.now() : Date.now();
          setFetchingStructure(true);
          try {
            const [structRes, fkRes] = await Promise.all([
              fetchTableStructure(currentConnectionString, selectedSchema, selectedTable),
              fetchTableForeignKeys(currentConnectionString, selectedSchema, selectedTable)
            ]);
            if (structRes.success && structRes.data) {
              setTableStructure(structRes.data);
              setTabDataCache(prev => ({
                ...prev,
                [tabId]: {
                  ...prev[tabId],
                  tableStructure: structRes.data || [],
                  filterQuery: prev[tabId]?.filterQuery || filterQuery,
                  sortConfig: prev[tabId]?.sortConfig || sortConfig,
                  page: prev[tabId]?.page ?? page,
                  pageSize: prev[tabId]?.pageSize ?? pageSize
                }
              }));
            }
            if (fkRes.success && fkRes.data) {
              setForeignKeys(fkRes.data);
              setTabDataCache(prev => ({
                ...prev,
                [tabId]: {
                  ...prev[tabId],
                  foreignKeys: fkRes.data || [],
                  filterQuery: prev[tabId]?.filterQuery || filterQuery,
                  sortConfig: prev[tabId]?.sortConfig || sortConfig,
                  page: prev[tabId]?.page ?? page,
                  pageSize: prev[tabId]?.pageSize ?? pageSize
                }
              }));
            }
          } finally {
            setFetchingStructure(false);
            const structureEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
            logTabPerf("table-structure-loaded", {
              tableId: tabId,
              durationMs: Math.round((structureEnd - structureStart) * 100) / 100,
            });
          }
        };
        if (shouldLoadStructure) {
          logTabPerf("table-structure-fetch-start", { tableId: tabId });
          loadStructure();
        }
      }

      if (!splitView.enabled && !matchingActiveTable) {
        setOpenTabs(prev => {
          if (prev.find(t => t.id === tabId)) return prev;
          return [...prev, { id: tabId, baseId: getTabBaseId({ id: tabId }), type: 'table', name: selectedTable, schema: selectedSchema }];
        });
        setActiveTabId(tabId);
      }
    } else {
      clearTableData();
    }
  }, [selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page, viewMode, tabDataCache, activeTabId, openTabs, refreshTableData, resolveActiveTableTabId, getTabBaseId, splitView.enabled, tablePermissionContext]);

// fallow-ignore-next-line code-duplication
  const columnVisibilityLoadedRef = useRef<Record<string, boolean>>({});

  // Load persisted hidden columns from SQLite when table changes (first load only)
  useEffect(() => {
    if (!selectedTable || !selectedSchema || viewMode !== 'tables') return;
    const connectionId = Number(connection.id);
    if (!connectionId) return;
    const tableKey = `${connectionId}.${selectedSchema}.${selectedTable}`;
    const isFirstLoad = !columnVisibilityLoadedRef.current[tableKey];

    getTableColumnVisibility(connectionId, selectedSchema, selectedTable).then(res => {
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        const loadedColumnNames = res.data;
        hiddenColumnNamesRef.current = loadedColumnNames;
        setHiddenColumnNames(prev => {
          if (prev.length === loadedColumnNames.length && prev.every((v, i) => v === loadedColumnNames[i])) {
            return prev;
          }
          return loadedColumnNames;
        });
        if (isFirstLoad) {
          columnVisibilityLoadedRef.current = { ...columnVisibilityLoadedRef.current, [tableKey]: true };
          refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page, undefined, "column-visibility-load");
        }
      }
    });
  }, [selectedTable, selectedSchema, viewMode, connection.id, refreshTableData, filterQuery, sortConfig, pageSize, page]);

// fallow-ignore-next-line code-duplication
  const paginationLoadedRef = useRef<Record<string, boolean>>({});

  // Load persisted page size from SQLite when table changes (first load only)
  useEffect(() => {
    if (!selectedTable || !selectedSchema || viewMode !== 'tables') return;
    const connectionId = Number(connection.id);
    if (!connectionId) return;
    const tableKey = `${connectionId}.${selectedSchema}.${selectedTable}`;
    if (paginationLoadedRef.current[tableKey]) return;
    paginationLoadedRef.current = { ...paginationLoadedRef.current, [tableKey]: true };

    getTablePagination(connectionId, selectedSchema, selectedTable).then(res => {
      if (res.success && res.data?.pageSize && res.data.pageSize > 0 && res.data.pageSize !== pageSize) {
        setPageSize(res.data.pageSize);
        setPage(0);
      }
    });
  }, [selectedTable, selectedSchema, viewMode, connection.id, pageSize]);

  // Persist hidden columns to SQLite when they change (skip initial mount)
  const columnsDidMountRef = useRef(false);
  useEffect(() => {
    if (!selectedTable || !selectedSchema) return;
    if (!columnsDidMountRef.current) {
      columnsDidMountRef.current = true;
      return;
    }
    const connectionId = Number(connection.id);
    if (!connectionId) return;

    saveTableColumnVisibility(connectionId, selectedSchema, selectedTable, hiddenColumnNames);
  }, [hiddenColumnNames, selectedTable, selectedSchema, connection.id]);

  const cloneTabIntoPane = useCallback((sourceTab: StudioInitialTab, paneId: string, tabs: StudioInitialTab[]) => {
    const baseId = getTabBaseId(sourceTab);
    const existingInPane = tabs.find((tab) => getTabBaseId(tab) === baseId && getPaneIdForTab(tab.id) === paneId);
    if (existingInPane) {
      return { tabs, tab: existingInPane, cached: getTableTabSnapshot(existingInPane.id) };
    }

    const clonedTabId = buildPaneScopedTabId(baseId, paneId, tabs);
    const clonedTab: StudioInitialTab = {
      ...sourceTab,
      id: clonedTabId,
      baseId,
      query: sourceTab.type === "sql" && sourceTab.id === activeTabId ? queryRef.current : sourceTab.query,
    };
    const nextTabs = [...tabs, clonedTab];
    const sourceCache = getTableTabSnapshot(sourceTab.id)
      ?? (sourceTab.type === "table" && sourceTab.id === activeTabId ? buildTableTabCacheSnapshot() : undefined);

    if (sourceCache) {
      setTabDataCache((prev) => ({
        ...prev,
        [clonedTabId]: sourceCache,
      }));
    }

    logStudioDebug("clone-tab-into-pane", {
      sourceTabId: sourceTab.id,
      clonedTabId,
      paneId,
      sourcePaneId: getPaneIdForTab(sourceTab.id),
      hasCachedResults: !!sourceCache?.results,
    });

    return { tabs: nextTabs, tab: clonedTab, cached: sourceCache };
  }, [activeTabId, buildPaneScopedTabId, buildTableTabCacheSnapshot, getPaneIdForTab, getTabBaseId, getTableTabSnapshot]);

  const switchTab = useCallback((tabId: string, providedTabs?: typeof openTabs, paneIdOverride?: string) => {
    if (!providedTabs && activeTabId === tabId) return;
    delayedUiRestoreBlockedRef.current = true;
    let tabsToUse = providedTabs || openTabs;
    let tab = tabsToUse.find(t => t.id === tabId);
    if (!tab) return;
    const targetPaneId = getCurrentPaneId(paneIdOverride);
    let hydratedCache = getTableTabSnapshot(tab.id);
    if (splitView.enabled && getPaneIdForTab(tab.id) !== targetPaneId && shouldCloneTabIntoPane(tab.type)) {
      const cloned = cloneTabIntoPane(tab, targetPaneId, tabsToUse);
      tabsToUse = cloned.tabs;
      tab = cloned.tab;
      tabId = tab.id;
      hydratedCache = cloned.cached;
    }
    const unsupportedTabHandlers: Array<[string, boolean, string]> = [
      ["create-enum", createSupport.enum, "Create Enum is supported only for PostgreSQL connections."],
      ["create-index", createSupport.index, "Create Index is supported only for PostgreSQL connections."],
      ["create-trigger", createSupport.trigger, "Create Trigger is supported only for PostgreSQL connections."],
      ["create-schema", createSupport.schema, "Create Schema is supported only for PostgreSQL connections."],
      ["create-database", createSupport.database, "Create Database is not supported for this connection type."],
    ];
    for (const [type, supported, errorMsg] of unsupportedTabHandlers) {
      if (tab.type === type && !supported) {
        toast.error(errorMsg);
        setOpenTabs(prev => prev.filter(t => t.id !== tab.id));
        setViewMode("tables");
        return;
      }
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    tabSwitchPerfRef.current = {
      fromTabId: activeTabId,
      toTabId: tabId,
      startedAt: now,
      ended: false,
    };
    logTabPerf("switch-start", { toType: tab.type });

    const preservedInactiveTableTabId = findPreservedInactiveTableTabId({
      openTabs: tabsToUse,
      activeTabId,
      selectedSchema: selectedSchemaRef.current,
      selectedTable: selectedTableRef.current,
      targetPaneId,
      getPaneIdForTab,
    });
    if (preservedInactiveTableTabId && preservedInactiveTableTabId !== tabId) {
      snapshotTableTabState(preservedInactiveTableTabId);
    }

    if (activeTabId && activeTabId !== tabId) {
      snapshotTableTabState(activeTabId);
    }
    const nextTabs = activeTabId && activeTabId !== tabId
      ? tabsToUse.map(t =>
        t.id === activeTabId && t.type === 'sql' ? { ...t, query: queryRef.current } : t
      )
      : tabsToUse;
    if (nextTabs !== openTabs || providedTabs) {
      setOpenTabs(nextTabs);
    }

    activePaneIdRef.current = targetPaneId;
    logStudioDebug("switch-tab", {
      tabId,
      tabType: tab.type,
      targetPaneId,
      previousTabId: activeTabId,
      splitEnabled: splitView.enabled,
    });
    setSplitView((prev) => normalizeSplitLayout(
      activatePane(
        assignTabToPane(prev, tabId, targetPaneId, true),
        targetPaneId,
        tabId
      ),
      nextTabs.map((nextTab) => nextTab.id),
      tabId
    ));

    // 2. Set the active tab ID and metadata
    setActiveTabId(tabId);
    activeTabIdRef.current = tabId;
    setSelectedCell(null);

    // Determine viewMode based on tab type (via tab registry)
    // Note: We no longer change sidebarView here to keep sidebar independent from tabs
    const tabViewMode = getViewMode(tab.type);
    if (tabViewMode) {
      setViewMode(tabViewMode as Parameters<typeof setViewMode>[0]);
      if (isDatabaseTabType(tab.type)) {
        const dbView = TAB_TYPE_TO_DATABASE_VIEW[tab.type];
        if (dbView) setDatabaseView(dbView as any);
      }
    } else {
      setViewMode("tables");
    }

    // 3. Update the query state for the NEW tab
    // We use a small timeout to ensure the state updates don't conflict with Monaco's lifecycle
    if (tab.type === 'sql' && tab.query !== undefined) {
      setQuery(tab.query);
    }

    if (tab.type === 'table') {
      setSelectedSchema(tab.schema || "");
      setSelectedTable(tab.name);

      const cached = hydratedCache ?? getTableTabSnapshot(tabId);
      const nextPermissionContext = cached?.permissionContext ?? null;
      setTablePermissionContextState((prev) => (
        areTablePermissionContextsEqual(prev, nextPermissionContext) ? prev : nextPermissionContext
      ));
      
      // STALE TAB GUARD: If the tab is stuck loading or has no data, force a refresh on activation
      if (!cached?.results || tableLoadingById[tabId]) {
        logStudioDebug("switch-tab-stale-guard", {
          tabId,
          targetPaneId,
          tableName: tab.name,
          schema: tab.schema || "",
          hasCachedResults: !!cached?.results,
          isLoading: !!tableLoadingById[tabId],
        });
        refreshTableData(tab.name, tab.schema || "", undefined, undefined, undefined, undefined, tabId, "switch-tab-stale-guard", nextPermissionContext);
      }

      if (cached) {
        const nextFilter = cached.filterQuery || "";
        const nextSort = cached.sortConfig || null;
        const nextPage = cached.page ?? 0;
        const nextPageSize = cached.pageSize ?? 100;
        const nextStructure = cached.tableStructure || [];
        const nextForeignKeys = cached.foreignKeys || [];

        setFilterQuery((prev) => (prev === nextFilter ? prev : nextFilter));
        setSortConfig((prev) => (JSON.stringify(prev) === JSON.stringify(nextSort) ? prev : nextSort));
        setPage((prev) => (prev === nextPage ? prev : nextPage));
        setPageSize((prev) => (prev === nextPageSize ? prev : nextPageSize));
        setResults((prev: unknown) => (prev === cached.results ? prev : cached.results));
        setTableStructure((prev) => (prev === nextStructure ? prev : nextStructure));
        setForeignKeys((prev) => (prev === nextForeignKeys ? prev : nextForeignKeys));
        logTabPerf("switch-table-cache-restore", {
          hasResults: !!cached.results,
          rowCount: cached?.results?.rows?.length ?? 0,
        });
      } else {
        resetTableResults();
        logTabPerf("switch-table-no-cache");
      }
    } else if (tab.type === 'workflow') {
      setSelectedTable(null);
      tabSwitchPerfRef.current.ended = true;
      logTabPerf("switch-non-table-ready");
    } else {
      tabSwitchPerfRef.current.ended = true;
      logTabPerf("switch-non-table-ready");
    }

    // Update URL
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    if (tab.type === 'table') {
      params.set('s', tab.schema || "");
      params.set('t', tab.name);
    } else if (tab.type === 'create-table') {
      setViewMode('create-table');
    } else if (tab.type === 'create-key') {
      setViewMode('create-key');
      params.delete('t');
      if (tab.schema) params.set('s', tab.schema);
    } else if (tab.type === 'create-enum') {
      params.delete('t');
      if (tab.schema) params.set('s', tab.schema);
    } else if (tab.type === 'create-index' || tab.type === 'create-trigger' || tab.type === 'create-schema' || tab.type === 'create-database') {
      params.delete('t');
      if (tab.schema) params.set('s', tab.schema);
    } else if (tab.type === 'dashboard') {
      params.delete('t');
      params.delete('s');
      params.set('view', 'dashboard');
    } else if (tab.type === 'import-export') {
      params.delete('t');
      params.delete('s');
      params.set('view', 'import-export');
    } else if (isDatabaseTabType(tab.type)) {
      params.set('view', 'database');
      const dbView = TAB_TYPE_TO_DATABASE_VIEW[tab.type];
      if (dbView) params.set('db-view', dbView);
    } else if (tab.type === 'settings' || tab.type === 'agent-settings') {
      params.delete('s');
      params.delete('t');
    } else if (tab.type === 'profile-settings') {
      params.delete('s');
      params.delete('t');
    } else {
      params.delete('s');
      params.delete('t');
      params.delete('f');
      params.delete('sc');
      params.delete('sd');
    }
    const nextSearch = params.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch !== currentSearch) {
      window.requestAnimationFrame(() => {
        if (typeof window !== "undefined") {
          const nextUrl = `${pathname}?${nextSearch}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        } else {
          router.replace(`${pathname}?${nextSearch}`);
        }
      });
    }
  }, [activeTabId, openTabs, pathname, router, searchParams, dbType, logTabPerf, createSupport, setOpenTabs, setViewMode, splitView, cloneTabIntoPane, getCurrentPaneId, getPaneIdForTab, refreshTableData, snapshotTableTabState, getTableTabSnapshot]);

  /** Close all tabs whose base ID matches `baseId` and switch away if the active tab was closed. */
  const closeTabsByBaseId = useCallback((baseId: string) => {
    const tabs = openTabsRef.current;
    const idsToClose = tabs
      .filter((tab) => getTabBaseId(tab) === baseId)
      .map((tab) => tab.id);
    if (idsToClose.length === 0) return;

    const idSet = new Set(idsToClose);
    const nextTabs = tabs.filter((tab) => !idSet.has(tab.id));
    const wasActiveClosed = activeTabId != null && idSet.has(activeTabId);

    setOpenTabs(nextTabs);
    setSplitView((prev) => {
      const nextMap = { ...prev.tabPaneMap };
      idsToClose.forEach((tabId) => {
        delete nextMap[tabId];
      });
      return normalizeSplitLayout(
        { ...prev, tabPaneMap: nextMap },
        nextTabs.map((tab) => tab.id),
        wasActiveClosed ? null : activeTabId,
      );
    });

    if (wasActiveClosed) {
      if (nextTabs.length > 0) {
        const nextId = nextTabs[nextTabs.length - 1]?.id;
        if (nextId) switchTab(nextId, nextTabs);
      } else {
        setActiveTabId(null);
        setViewMode("tables");
      }
    }
  }, [activeTabId, getTabBaseId, switchTab]);

  const addTabAndSwitch = useCallback((newTab: StudioInitialTab, tabId: string, targetPaneId?: string) => {
    const currentTabsWithOldQuerySaved = openTabs.map(t =>
      t.id === activeTabId && t.type === 'sql' ? { ...t, query: queryRef.current } : t
    );
    const newTabs = [...currentTabsWithOldQuerySaved, newTab];
    setOpenTabs(newTabs);
    if (splitView.enabled && targetPaneId) {
      setSplitView((prev) => assignTabToPane(prev, tabId, targetPaneId, true));
    }
    switchTab(tabId, newTabs, targetPaneId);
  }, [openTabs, activeTabId, switchTab, splitView.enabled, assignTabToPane, setSplitView]);

  useEffect(() => {
    if (!isDataLoaded) return;
    if (restoredTabForConnectionRef.current === connection.id) return;
    if (!activeTabId || openTabs.length === 0) return;
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;
    switchTab(activeTabId, openTabs);
    restoredTabForConnectionRef.current = connection.id;
  }, [isDataLoaded, activeTabId, openTabs, connection.id, switchTab]);

  const addSnippet = useCallback((name: string, query: string, folderId: string | null = null) => {
    const newSnippet = createSnippetAndPersist(name, query, folderId, connection.id, uid, setSnippets, saveStudioSnippets);

    // Open in a new SQL tab using the same logic as openSnippet
    const tabId = `sql-${newSnippet.id}`;
    const newTab = {
      id: tabId,
      type: 'sql' as const,
      name: newSnippet.name,
      query: newSnippet.query
    };

    const newTabs = buildNewTabs(newTab, query);

    setOpenTabs(newTabs);
    switchTab(tabId, newTabs);

    return newSnippet;
  }, [connection.id, openTabs, activeTabId, query, switchTab]);

  const updateSnippet = useCallback((id: string, updates: Partial<Snippet>) => {
    let nextSnippets: Snippet[] = [];
    setSnippets(prev => {
      nextSnippets = prev.map(s => s.id === id ? { ...s, ...updates } : s);
      return nextSnippets;
    });
    saveStudioSnippets(connection.id, nextSnippets).catch(() => {});
    const tabId = `sql-${id}`;
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, name: updates.name || t.name, query: updates.query || t.query } : t
    ));
    if (updates.query && activeTabId === tabId) {
      setQuery(updates.query);
    }
  }, [activeTabId, connection.id]);

  const toggleSnippetShare = useCallback(async (id: string, share: boolean, granteeType?: "studio" | "public") => {
    const snippet = snippets.find((s) => s.id === id);
    if (!snippet) return;
    setSharingSnippetId(id);
    try {
      if (share) {
        const { entryId, error } = await shareSnippetEntry(
          { id: snippet.id, name: snippet.name, query: snippet.query, folderId: snippet.folderId, createdAt: snippet.createdAt },
          granteeType || "studio"
        );
        if (entryId) {
          updateSnippet(id, { isShared: true, sharedEntryId: entryId });
        } else {
          console.error("Failed to share snippet:", error);
        }
      } else if (snippet.sharedEntryId) {
        await unshareEntry(snippet.sharedEntryId);
        updateSnippet(id, { isShared: false, sharedEntryId: undefined });
      }
    } finally {
      setSharingSnippetId(null);
    }
  }, [snippets, updateSnippet]);

  const updateSnippetPermissions = useCallback(async (entryId: string, permissions: KVPermission[]) => {
    await updateEntryPermissions(entryId, permissions);
  }, []);

  const deleteSnippet = useCallback((id: string) => {
    let nextSnippets: Snippet[] = [];
    setSnippets(prev => {
      nextSnippets = prev.filter(f => f.id !== id);
      return nextSnippets;
    });
    saveStudioSnippets(connection.id, nextSnippets).catch(() => {});
    closeTabsByBaseId(`sql-${id}`);
  }, [connection.id, closeTabsByBaseId]);

  const createSnippetVersion = useCallback(async (snippetId: string, name: string, query: string) => {
    const result = await apiCreateSnippetVersion(connection.id, snippetId, name, query);
    return result;
  }, [connection.id]);

  const getSnippetVersions = useCallback(async (snippetId: string) => {
    const result = await apiGetSnippetVersions(connection.id, snippetId);
    return result;
  }, [connection.id]);

  const restoreSnippetVersion = useCallback(async (snippetId: string, versionId: string) => {
    const result = await apiRestoreSnippetVersion(connection.id, snippetId, versionId);
    if (result.success && result.data) {
      updateSnippet(snippetId, { name: result.data.name, query: result.data.query });
    }
    return result;
  }, [connection.id, updateSnippet]);

  const addFolder = useCallback((name: string, parentId?: string | null) => {
    const newFolder: Folder = {
      id: uid(),
      name,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    };
    let nextFolders: Folder[] = [];
    setFolders(prev => {
      nextFolders = [...prev, newFolder];
      return nextFolders;
    });
    saveStudioFolders(connection.id, nextFolders).catch(e => console.error("Failed to save folder:", e));
    return newFolder;
  }, [connection.id]);

  const updateFolder = useCallback((id: string, updates: Partial<Folder>) => {
    let nextFolders: Folder[] = [];
    setFolders(prev => {
      nextFolders = prev.map(f => f.id === id ? { ...f, ...updates } : f);
      return nextFolders;
    });
    saveStudioFolders(connection.id, nextFolders).catch(e => console.error("Failed to save folder update:", e));
  }, [connection.id]);

  const deleteFolder = useCallback((id: string) => {
    const parentId = folders.find(f => f.id === id)?.parentId ?? null;
    let nextFolders: Folder[] = [];
    let nextSnippets: Snippet[] = [];
    setFolders(prev => {
      nextFolders = prev.filter(f => f.id !== id).map(f => f.parentId === id ? { ...f, parentId } : f);
      return nextFolders;
    });
    setSnippets(prev => {
      nextSnippets = prev.map(s => s.folderId === id ? { ...s, folderId: parentId } : s);
      return nextSnippets;
    });
    saveStudioFolders(connection.id, nextFolders).catch(e => console.error("Failed to save folder deletion:", e));
    saveStudioSnippets(connection.id, nextSnippets).catch(e => console.error("Failed to save snippets after folder deletion:", e));
  }, [folders, connection.id]);

  const handleImportSnippets = useCallback((data: SnippetExportData) => {
    const nameToId: Record<string, string> = {};
// fallow-ignore-next-line code-duplication
    const existingFolderNames = new Set(folders.map(f => f.name));
    const foldersByName = new Map(folders.map(f => [f.name, f]));

    for (const f of data.folders) {
      if (!existingFolderNames.has(f.name)) {
        const parentId = f.parentName ? nameToId[f.parentName] ?? null : null;
        const folder = addFolder(f.name, parentId);
        // fallow-ignore-next-line code-duplication
        nameToId[f.name] = folder.id;
        existingFolderNames.add(f.name);
      } else {
        const existing = foldersByName.get(f.name);
        if (existing) nameToId[f.name] = existing.id;
      }
    }

    for (const s of data.snippets) {
      const folderId = s.folderName ? nameToId[s.folderName] ?? null : null;
      addSnippet(s.name, s.query, folderId);
    }
  }, [folders, addFolder, addSnippet]);

  const runQueryWithTracking = useCallback(async (actionQuery: string) => {
    const startTime = Date.now();
    const res = await runQuery(currentConnectionString, actionQuery);
    logQueryResult(actionQuery, res, startTime);
    return res;
  }, [currentConnectionString, runQuery, addHistoryEntry]);

  const handleCreateTable = async (tableName: string, schema: string, columns: any[]) => {
    if (isSpacetimedb) {
      return;
    }
    const actionQuery = dbType === "mongodb"
      ? JSON.stringify({
        operation: "createCollection",
        database: schema,
        collection: tableName,
      }, null, 2)
      : dbType === "sqlite"
        ? (() => {
          const toSqliteType = (rawType: string) => {
            const t = String(rawType || "").trim().toUpperCase();
            if (!t) return "TEXT";
            if (["SERIAL", "BIGSERIAL", "INTEGER", "BIGINT", "SMALLINT", "INT"].includes(t)) return "INTEGER";
            if (["TIMESTAMPTZ", "TIMESTAMP", "DATE", "DATETIME", "TIME", "VARCHAR", "TEXT", "UUID", "JSONB", "JSON"].includes(t)) return "TEXT";
            if (["BOOLEAN", "BOOL"].includes(t)) return "INTEGER";
            if (["REAL", "DOUBLE", "DOUBLE PRECISION", "FLOAT"].includes(t)) return "REAL";
            if (["NUMERIC", "DECIMAL"].includes(t)) return "NUMERIC";
            if (["BLOB", "BINARY"].includes(t)) return "BLOB";
            return t;
          };

          const normalizeDefault = (rawDefault: string, sqliteType: string) => {
            const d = String(rawDefault || "").trim();
            if (!d) return "";
            if (/^now\(\)$/i.test(d) || /^current_timestamp\(\)$/i.test(d)) return "CURRENT_TIMESTAMP";
            if (/^true$/i.test(d)) return "1";
            if (/^false$/i.test(d)) return "0";
            if (/^nextval\(/i.test(d)) return "";
            if (sqliteType === "TEXT" && /^[a-z_][a-z0-9_]*$/i.test(d) && d.toUpperCase() !== "CURRENT_TIMESTAMP") {
              return `'${d.replace(/'/g, "''")}'`;
            }
            return d;
          };

          const colDefs = columns.map((col) => {
            const sqliteType = toSqliteType(col.type);
            const normalizedDefault = normalizeDefault(col.defaultValue, sqliteType);
            const isIntegerPk = Boolean(col.primaryKey) && sqliteType === "INTEGER";

            let def = `"${col.name}" ${sqliteType}`;
            if (isIntegerPk) {
              def += " PRIMARY KEY AUTOINCREMENT";
            } else {
              if (col.notNull) def += " NOT NULL";
              if (col.primaryKey) def += " PRIMARY KEY";
            }
            if (col.unique) def += " UNIQUE";
            if (normalizedDefault) def += ` DEFAULT ${normalizedDefault}`;
            if (col.foreignKey) {
              def += ` REFERENCES "${col.foreignKey.table}"("${col.foreignKey.column}")`;
            }
            return def;
          }).join(", ");

          return `CREATE TABLE "${schema}"."${tableName}" (${colDefs});`;
        })()
        : dbType === "mysql"
          ? (() => {
// fallow-ignore-next-line code-duplication
            const colDefs = columns.map((col) => {
              const defaultValue = String(col.defaultValue || "").trim();
              const isAutoIncrement = /auto_increment/i.test(defaultValue);
              let def = `${quoteIdentifier(col.name)} ${col.type}`;
              if (col.notNull) def += " NOT NULL";
              if (col.primaryKey) def += " PRIMARY KEY";
              if (col.unique) def += " UNIQUE";
              if (isAutoIncrement) def += " AUTO_INCREMENT";
              else if (defaultValue) def += ` DEFAULT ${defaultValue}`;
              if (col.foreignKey) {
                def += ` REFERENCES ${quoteTableRef(col.foreignKey.schema, col.foreignKey.table)}(${quoteIdentifier(col.foreignKey.column)})`;
              }
              return def;
            }).join(", ");
            return `CREATE TABLE ${quoteTableRef(schema, tableName)} (${colDefs});`;
          })()
          : dbType === "mssql"
            ? (() => {
// fallow-ignore-next-line code-duplication
              const colDefs = columns.map((col) => {
                const defaultValue = String(col.defaultValue || "").trim();
                const isIdentity = /^identity/i.test(defaultValue);
                let def = `${quoteIdentifier(col.name)} ${col.type}`;
                if (isIdentity) def += ` ${defaultValue}`;
                if (col.notNull) def += " NOT NULL";
                if (col.primaryKey) def += " PRIMARY KEY";
                if (col.unique) def += " UNIQUE";
                if (!isIdentity && defaultValue) def += ` DEFAULT ${defaultValue}`;
                if (col.foreignKey) {
                  def += ` REFERENCES ${quoteTableRef(col.foreignKey.schema, col.foreignKey.table)}(${quoteIdentifier(col.foreignKey.column)})`;
                }
                return def;
              }).join(", ");
              return `CREATE TABLE ${quoteTableRef(schema, tableName)} (${colDefs});`;
            })()
          : dbType === "clickhouse"
            ? (() => {
              const colDefs = columns.map((col) => {
                let def = `${quoteIdentifier(col.name)} ${col.type}`;
                if (col.notNull) def += " NOT NULL";
                if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
                return def;
              }).join(", ");
              const pkCols = columns.filter((col) => col.primaryKey).map((col) => quoteIdentifier(col.name));
              const primaryClause = pkCols.length ? ` PRIMARY KEY (${pkCols.join(", ")})` : "";
              const orderBy = pkCols.length ? `ORDER BY (${pkCols.join(", ")})` : "ORDER BY tuple()";
              return `CREATE TABLE ${quoteTableRef(schema, tableName)} (${colDefs}) ENGINE = MergeTree${primaryClause} ${orderBy};`;
            })()
          : (() => {
            const colDefs = columns.map(col => {
              let def = `"${col.name}" ${col.type}`;
              if (col.notNull) def += " NOT NULL";
              if (col.primaryKey) def += " PRIMARY KEY";
              if (col.unique) def += " UNIQUE";
              if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
              if (col.foreignKey) {
                def += ` REFERENCES "${col.foreignKey.schema}"."${col.foreignKey.table}"("${col.foreignKey.column}")`;
              }
              return def;
            }).join(", ");
            return `CREATE TABLE "${schema}"."${tableName}" (${colDefs});`;
          })();

    if (addReviewAction({ type: 'create_table', description: dbType === "mongodb" ? `Create collection "${schema}"."${tableName}"` : `Create table "${schema}"."${tableName}"`, sql: actionQuery, metadata: (dbType === "mongodb" ? { database: schema, collection: tableName } : { schema, tableName, columns }) as Record<string, unknown> })) return;

    setIsCreatingTable(true);
    setError(null);
    try {
      const res = await runQueryWithTracking(actionQuery);

      if (res.success) {
        toast.success(
          dbType === "mongodb"
            ? `Collection "${tableName}" created successfully`
            : `Table "${tableName}" created successfully`
        );
        // Reset the create table data
        setNewTableData({
          name: '',
          columns: getDefaultNewTableColumns(dbType)
        });

        // Refresh tables (bypass cache)
        await loadTables(true);

        // Close the create-table tab and open the new table tab in one go
        const nextTabs = openTabs.filter(t => t.id !== 'create-table');
        const newTabId = `table-${selectedSchema}-${tableName}`;
        const newTab = {
          id: newTabId,
          type: 'table' as const,
          name: tableName,
          schema: schema || selectedSchema
        };
        const finalTabs = [...nextTabs, newTab];
        setOpenTabs(finalTabs);
        switchTab(newTabId, finalTabs);
      } else {
        setError(res.error || (dbType === "mongodb" ? "Failed to create collection" : "Failed to create table"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (dbType === "mongodb" ? "Failed to create collection" : "Failed to create table"));
    } finally {
      setIsCreatingTable(false);
    }
  };

  const runCreateAction = async (opts: {
    reviewAction: { type: string; description: string; sql: string; metadata?: any };
    sql: string;
    apiFn: () => Promise<{ success: boolean; error?: string }>;
    successMessage: string;
    fallbackError: string;
    setIsCreating: (v: boolean) => void;
    onSuccess?: () => void | Promise<void>;
  }) => {
    if (addReviewAction(opts.reviewAction)) return;
    opts.setIsCreating(true);
    setError(null);
    try {
      const startTime = Date.now();
      const res = await opts.apiFn();
      logQueryResult(opts.sql, res, startTime);
      if (res.success) {
        toast.success(opts.successMessage);
        await opts.onSuccess?.();
      } else {
        setError(res.error || opts.fallbackError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : opts.fallbackError);
    } finally {
      opts.setIsCreating(false);
    }
  };

  const handleCreateEnum = async (enumName: string, schema: string, values: string[]) => {
    const sql = `CREATE TYPE "${schema}"."${enumName}" AS ENUM (${values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')});`;
    await runCreateAction({
      reviewAction: { type: 'create_enum', description: `Create enum "${schema}"."${enumName}"`, sql, metadata: { schema, enumName, values } },
      sql,
      apiFn: () => createEnum(currentConnectionString, schema, enumName, values),
      successMessage: `Enum "${enumName}" created successfully`,
      fallbackError: "Failed to create enum",
      setIsCreating: setIsCreatingEnum,
      onSuccess: async () => {
        setNewEnumData({ name: '', values: [''] });
        await loadEnums();
        switchAwayFromTab('create-enum', 'database-enums', 'enums');
      },
    });
  };

  const handleUpdateEnum = async (enumName: string, schema: string, values: string[]) => {
    if (executionMode === 'review') {
      const sqls: string[] = [];
      if (editingEnumName && editingEnumName !== enumName) {
        sqls.push(`ALTER TYPE "${schema}"."${editingEnumName}" RENAME TO "${enumName}";`);
      }

// fallow-ignore-next-line code-duplication
      const originalValues = enums.find(e => e.schema === schema && (e.name === (editingEnumName || enumName) || e.name === enumName))?.values || [];
      const newValues = values.filter(v => !originalValues.includes(v));

      for (const val of newValues) {
        sqls.push(`ALTER TYPE "${schema}"."${enumName}" ADD VALUE '${val.replace(/'/g, "''")}';`);
      }

      addReviewAction(sqls.map(sql => ({ type: 'update_enum' as any, description: `Update enum ${schema}.${enumName}`, sql, metadata: { schema, enumName, values } })));
      setNewEnumData({ name: '', values: [''] });
      setIsEditingEnum(false);
      setEditingEnumName(null);
      const nextTabs = openTabs.filter(t => t.id !== 'create-enum');
      setOpenTabs(nextTabs);
      return;
    }

    setIsCreatingEnum(true);
    setError(null);
    try {
      const startTime = Date.now();
      let lastRes: any = { success: true };

      // 1. Rename if name changed
      if (editingEnumName && editingEnumName !== enumName) {
        const renameSql = `ALTER TYPE "${schema}"."${editingEnumName}" RENAME TO "${enumName}";`;
        lastRes = await runQuery(currentConnectionString, renameSql);

        logQueryResult(renameSql, lastRes, startTime);
      }

      if (lastRes.success) {
        // 2. Add new values
// fallow-ignore-next-line code-duplication
        const originalValues = enums.find(e => e.schema === schema && (e.name === (editingEnumName || enumName) || e.name === enumName))?.values || [];
        const newValues = values.filter(v => !originalValues.includes(v));

        for (const val of newValues) {
          const addValueSql = `ALTER TYPE "${schema}"."${enumName}" ADD VALUE '${val.replace(/'/g, "''")}';`;
          const addRes = await runQuery(currentConnectionString, addValueSql);

          logQueryResult(addValueSql, addRes, startTime);

          if (!addRes.success) {
            lastRes = addRes;
            break;
          }
        }
      }

      if (lastRes.success) {
        setNewEnumData({ name: '', values: [''] });
        setIsEditingEnum(false);
        setEditingEnumName(null);
        await loadEnums();

        switchAwayFromTab('create-enum', 'database-enums', 'enums');
      } else {
        setError(lastRes.error || "Failed to update enum");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update enum");
    } finally {
      setIsCreatingEnum(false);
    }
  };

  const handleCreateIndex = async (
    schema: string,
    table: string,
    name: string,
    columns: string[],
    unique: boolean,
    method: string
  ) => {
    const uniqueStr = unique ? 'UNIQUE ' : '';
    const sql = `CREATE ${uniqueStr}INDEX "${name}" ON "${schema}"."${table}" USING ${method} (${columns.join(', ')});`;
    await runCreateAction({
      reviewAction: { type: 'create_index', description: `Create index "${name}" on ${schema}.${table}`, sql, metadata: { schema, table, name, columns, unique, method } },
      sql,
      apiFn: () => createIndex(currentConnectionString, schema, table, name, columns, unique, method),
      successMessage: `Index "${name}" created successfully`,
      fallbackError: "Failed to create index",
      setIsCreating: setIsCreatingIndex,
      onSuccess: () => {
        loadIndexes();
        switchAwayFromTab('create-index', 'database-indexes', 'indexes');
      },
    });
  };

  const handleCreateTrigger = async (
    schema: string,
    table: string,
    name: string,
    events: string[],
    timing: string,
    orientation: string,
    functionName: string
  ) => {
    const sql = `CREATE TRIGGER "${name}" ${timing} ${events.join(' OR ')} ON "${schema}"."${table}" FOR EACH ${orientation} EXECUTE FUNCTION ${functionName}();`;
    await runCreateAction({
      reviewAction: { type: 'create_trigger', description: `Create trigger "${name}" on ${schema}.${table}`, sql, metadata: { schema, table, name, events, timing, orientation, functionName } },
      sql,
      apiFn: () => createTrigger(currentConnectionString, schema, table, name, events, timing, orientation, functionName),
      successMessage: `Trigger "${name}" created successfully`,
      fallbackError: "Failed to create trigger",
      setIsCreating: setIsCreatingTrigger,
      onSuccess: () => {
        loadTriggers();
        switchAwayFromTab('create-trigger', 'database-triggers', 'triggers');
      },
    });
  };

  const handleDeleteTrigger = useCallback(async (schema: string, name: string) => {
    // Note: To drop a trigger, we need the table name. triggers-list has it, but this handler currently only gets schema/name.
    // However, in PostgreSQL, triggers are often dropped using: DROP TRIGGER [IF EXISTS] name ON table_name [CASCADE | RESTRICT]
    // Since we don't have the table name here easily without changing the signature, let's look at how loadTriggers gets them.
    const trigger = triggers.find(t => t.schema === schema && t.name === name);
    const tableName = trigger?.table_name;

    if (!tableName) {
      toast.error("Could not find table name for trigger");
      return;
    }

    const sql = `DROP TRIGGER IF EXISTS "${name}" ON "${schema}"."${tableName}";`;

    if (addReviewAction({ type: 'delete_trigger', description: `Delete trigger "${schema}"."${name}" on "${tableName}"`, sql, metadata: { schema, name, tableName } })) return;

    const confirmed = await confirm({
      title: "Delete Trigger",
      description: `Are you sure you want to delete the trigger "${schema}"."${name}"?`,
      variant: "destructive",
      confirmText: "Delete"
    });

    if (!confirmed) return;

    setIsDeletingTrigger(true);
    try {
      const res = await runQueryWithLogging(sql);
      if (res.success) {
        toast.success("Trigger deleted successfully");
        loadTriggers();
      } else {
        toast.error(res.error || "Failed to delete trigger");
      }
    } finally {
      setIsDeletingTrigger(false);
    }
  }, [currentConnectionString, executionMode, confirm, loadTriggers, runQuery, triggers, addHistoryEntry]);

  const runDeleteWithConfirm = useCallback(async (opts: {
    reviewAction: { type: string; description: string; sql: string; metadata?: any };
    sql: string;
    confirmTitle: string;
    confirmDescription: string;
    confirmText: string;
    successMessage: string;
    fallbackError: string;
    setIsDeleting: (v: boolean) => void;
    onSuccess?: () => void | Promise<void>;
  }) => {
    if (addReviewAction(opts.reviewAction)) return;
    const confirmed = await confirm({
      title: opts.confirmTitle,
      description: opts.confirmDescription,
      variant: "destructive",
      confirmText: opts.confirmText,
    });
    if (!confirmed) return;
    opts.setIsDeleting(true);
    try {
      const res = await runQueryWithLogging(opts.sql);
      if (res.success) {
        toast.success(opts.successMessage);
        await opts.onSuccess?.();
      } else {
        toast.error(res.error || opts.fallbackError);
      }
    } finally {
      opts.setIsDeleting(false);
    }
  }, [addReviewAction, confirm, runQueryWithLogging, setError]);

  const handleDeleteSchema = useCallback(async (name: string) => {
    const sql = `DROP SCHEMA IF EXISTS "${name}" CASCADE;`;
    await runDeleteWithConfirm({
      reviewAction: { type: 'delete_schema', description: `Delete schema "${name}"`, sql, metadata: { name } },
      sql,
      confirmTitle: "Delete Schema",
      confirmDescription: `Are you sure you want to delete the schema "${name}" and all its contents? This action cannot be undone.`,
      confirmText: "Delete Schema",
      successMessage: "Schema deleted successfully",
      fallbackError: "Failed to delete schema",
      setIsDeleting: setIsDeletingSchema,
      onSuccess: () => loadSchemas(),
    });
  }, [runDeleteWithConfirm, setIsDeletingSchema, loadSchemas]);

  const handleDeleteDatabase = useCallback(async (name: string) => {
    const sql = `DROP DATABASE "${name}";`;
    await runDeleteWithConfirm({
      reviewAction: { type: 'delete_database', description: `Delete database "${name}"`, sql, metadata: { name } },
      sql,
      confirmTitle: "Delete Database",
      confirmDescription: `Are you sure you want to delete the database "${name}"? This action cannot be undone.`,
      confirmText: "Delete Database",
      successMessage: "Database deleted successfully",
      fallbackError: "Failed to delete database",
      setIsDeleting: setIsDeletingDatabase,
    });
  }, [runDeleteWithConfirm, setIsDeletingDatabase]);

  const handleDeleteTable = useCallback(async (schema: string, name: string) => {
    const sql = dbType === "sqlite"
      ? `DROP TABLE IF EXISTS "${schema}"."${name}";`
      : `DROP TABLE IF EXISTS "${schema}"."${name}" CASCADE;`;
    await runDeleteWithConfirm({
      reviewAction: { type: 'delete_table', description: `Delete table "${schema}"."${name}"`, sql, metadata: { schema, name } },
      sql,
      confirmTitle: "Delete Table",
      confirmDescription: `Are you sure you want to delete the table "${schema}"."${name}" and all its data? This action cannot be undone.`,
      confirmText: "Delete Table",
      successMessage: "Table deleted successfully",
      fallbackError: "Failed to delete table",
      setIsDeleting,
      onSuccess: () => loadTables(),
    });
  }, [dbType, runDeleteWithConfirm, setIsDeleting, loadTables]);

  const handleDeleteEnum = async (schema: string, enumName: string) => {
    const sql = `DROP TYPE IF EXISTS "${schema}"."${enumName}" CASCADE;`;

    if (addReviewAction({ type: 'delete_enum', description: `Delete enum "${schema}"."${enumName}"`, sql, metadata: { schema, enumName } })) return;

    const confirmed = await confirm({
      title: "Delete Enum Type",
      description: `Are you sure you want to delete the enum type "${schema}"."${enumName}"?`,
      variant: "destructive",
      confirmText: "Delete"
    });

    if (!confirmed) return;

    setIsDeleting(true);
    setError(null);
    try {
      const res = await runQueryWithLogging(sql);
      if (res.success) {
        toast.success(`Enum "${enumName}" deleted successfully`);
        await loadEnums();
      } else {
        setError(res.error || "Failed to delete enum");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete enum");
    } finally {
      setIsDeleting(false);
    }
  };
  const handleCreateSchema = async (name: string) => {
    const sql = `CREATE SCHEMA "${name}";`;
    await runCreateAction({
      reviewAction: { type: 'create_schema', description: `Create schema "${name}"`, sql, metadata: { name } },
      sql,
      apiFn: () => createSchema(currentConnectionString, name),
      successMessage: `Schema "${name}" created successfully`,
      fallbackError: "Failed to create schema",
      setIsCreating: setIsCreatingSchema,
      onSuccess: async () => {
        await loadSchemas();
        closeCreateTab('create-schema');
        openDatabaseTab('tables');
      },
    });
  };

  const handleCreateDatabase = async (name: string) => {
    const sql = `CREATE DATABASE "${name}";`;
    await runCreateAction({
      reviewAction: { type: 'create_database', description: `Create database "${name}"`, sql, metadata: { name } },
      sql,
      apiFn: () => createDatabase(currentConnectionString, name),
      successMessage: `Database "${name}" created successfully`,
      fallbackError: "Failed to create database",
      setIsCreating: setIsCreatingDatabase,
      onSuccess: () => {
        closeCreateTab('create-database');
        openDatabaseTab('tables');
      },
    });
  };

  const openTab = useCallback(
    (
      type: string,
      meta?: Record<string, unknown>,
      opts?: {
        preview?: boolean;
        querySource?: string;
        targetPaneId?: string;
        guard?: (() => boolean) | { condition: boolean; errorMsg: string };
        afterCreated?: () => void;
        afterExisting?: () => void;
      },
    ) => {
      const config = getTabConfig(type);
      if (!config) return;
      const guard = opts?.guard;
      if (guard) {
        const passed = typeof guard === "function" ? guard() : guard.condition;
        if (!passed) {
          if (typeof guard !== "function") toast.error(guard.errorMsg);
          return;
        }
      }

      const tabMeta = meta ?? {};
      const id = config.buildTabId(tabMeta as any);
      const existingTab = openTabs.find((t) => t.id === id);
      if (existingTab) {
        switchTab(id);
        opts?.afterExisting?.();
        return;
      }

      const tab = config.createTab(id, tabMeta as any);
      if (tabMeta.schema !== undefined && tab.schema === undefined) {
        tab.schema = tabMeta.schema as string;
      }
      const newTabs = buildNewTabs(tab as unknown as Record<string, unknown>, opts?.querySource, opts?.preview);
      setOpenTabs(newTabs);
      switchTab(id, newTabs, opts?.targetPaneId);
      opts?.afterCreated?.();
    },
    [openTabs, buildNewTabs, setOpenTabs, switchTab],
  );

  const openSimpleTab = useCallback((
    tabId: string,
    tabType: StudioInitialTab['type'],
    tabName: string,
    options?: {
      schema?: string;
      guard?: { condition: boolean; errorMsg: string };
      afterCreated?: () => void;
      afterExisting?: () => void;
    }
  ) => {
    openTab(tabType, options?.schema ? { schema: options.schema } : undefined, {
      guard: options?.guard,
      afterCreated: options?.afterCreated,
      afterExisting: options?.afterExisting,
    });
  }, [openTab]);

  const openCreateTableTab = useCallback(() => {
    openSimpleTab('create-table', 'create-table', 'New Table', {
      guard: { condition: !!createSupport.table, errorMsg: 'Create table is not supported for this connection type.' },
      schema: selectedSchema || fallbackSchemaForDb || 'public'
    });
  }, [openSimpleTab, createSupport.table, selectedSchema, fallbackSchemaForDb]);

  const openCreateKeyTab = useCallback(() => {
    openSimpleTab('create-key', 'create-key', 'New Key', {
      guard: { condition: dbType === 'redis', errorMsg: 'Create key is available only for Redis connections.' },
      schema: selectedSchema || 'db0'
    });
  }, [openSimpleTab, dbType, selectedSchema]);

  const openCreateIndexTab = useCallback(() => {
    openSimpleTab('create-index', 'create-index', 'New Index', {
      guard: { condition: !!createSupport.index, errorMsg: 'Create Index is supported only for PostgreSQL connections.' },
      schema: selectedSchema || 'public'
    });
  }, [openSimpleTab, createSupport.index, selectedSchema]);

  const openHistoryTab = useCallback(() => {
    openSimpleTab('history', 'history', 'Query History');
  }, [openSimpleTab]);

  const openAnalyticsTab = useCallback(() => {
    openSimpleTab('analytics', 'analytics', 'Analytics');
  }, [openSimpleTab]);

  const openAdvisorTab = useCallback(() => {
    openSimpleTab('advisor', 'advisor', 'Advisor');
  }, [openSimpleTab]);

  const openWorkflowsTab = useCallback((workflowId?: string, name?: string) => {
    const tabId = workflowId ? `workflow-${workflowId}` : 'workflow';
    const existingTab = openTabs.find(t => t.id === tabId);
    if (!existingTab) {
      const newTab: any = { id: tabId, type: 'workflow', name: name || 'Workflow' };
      if (workflowId) newTab.workflowId = workflowId;
      const newTabs = buildNewTabs(newTab);
      setOpenTabs(newTabs);
      switchTab(tabId, newTabs);
    } else {
      switchTab(tabId);
    }
  }, [openTabs, buildNewTabs, setOpenTabs, switchTab]);

  useEffect(() => {
    const handleWorkflowSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ workflowId?: string; name?: string }>).detail;
      if (!detail?.workflowId || !detail.name) return;
      const tabId = `workflow-${detail.workflowId}`;
      setOpenTabs(prev => prev.map(t => (t.id === tabId ? { ...t, name: detail.name! } : t)));
    };
    window.addEventListener("studio:workflow-saved", handleWorkflowSaved);
    return () => window.removeEventListener("studio:workflow-saved", handleWorkflowSaved);
  }, [setOpenTabs]);

  const openConnectStudioTab = useCallback(() => {
    openSimpleTab('connect-studio', 'connect-studio', 'Workspace Studio');
  }, [openSimpleTab]);

  const openManageWorkspacesTab = useCallback(() => {
    openSimpleTab('manage-workspaces', 'manage-workspaces', 'Workspaces');
  }, [openSimpleTab]);

  const openSnapshotsTab = useCallback(() => {
    openSimpleTab('snapshots', 'snapshots', 'Snapshots');
  }, [openSimpleTab]);

  const authTabOptions = {
    afterCreated: () => setSidebarView('auth'),
    afterExisting: () => setSidebarView('auth'),
  };

  const openAuthUsersTab = useCallback(() => {
    openSimpleTab('auth-users', 'auth-users', 'Users', authTabOptions);
  }, [openSimpleTab, setSidebarView]);

  const openAuthSessionsTab = useCallback(() => {
    openSimpleTab('auth-sessions', 'auth-sessions', 'Sessions', authTabOptions);
  }, [openSimpleTab, setSidebarView]);

  const openAuthProvidersTab = useCallback(() => {
    openSimpleTab('auth-providers', 'auth-providers', 'Providers', authTabOptions);
  }, [openSimpleTab, setSidebarView]);

  const openCreateTriggerTab = useCallback(() => {
    openSimpleTab('create-trigger', 'create-trigger', 'New Trigger', {
      guard: { condition: !!createSupport.trigger, errorMsg: 'Create Trigger is supported only for PostgreSQL connections.' },
      schema: selectedSchema || 'public'
    });
  }, [openSimpleTab, createSupport.trigger, selectedSchema]);

  const openCreateSchemaTab = useCallback(() => {
    openSimpleTab('create-schema', 'create-schema', 'New Schema', {
      guard: { condition: !!createSupport.schema, errorMsg: 'Create Schema is supported only for PostgreSQL connections.' },
    });
  }, [openSimpleTab, createSupport.schema]);

  const openCreateDatabaseTab = useCallback(() => {
    openSimpleTab('create-database', 'create-database', 'New Database', {
      guard: { condition: !!createSupport.database, errorMsg: 'Create Database is not supported for this connection type.' },
    });
  }, [openSimpleTab, createSupport.database]);

  const openImportExportTab = useCallback(() => {
    openSimpleTab('import-export', 'import-export', 'Export');
  }, [openSimpleTab]);

  const openDashboardTab = useCallback((dashboardId: string) => {
    const dashboard = dashboards.find((d) => d.id === dashboardId);
    if (!dashboard) return;

    const targetPaneId = getCurrentPaneId();
    const tabId = `dashboard-${dashboard.id}`;
    const paneScopedTabId = splitView.enabled ? `${tabId}::pane::${targetPaneId}` : tabId;
    
    const existing = openTabs.find((t) => t.id === paneScopedTabId);
    if (existing) {
      if (existing.isPreview) confirmPreviewTab(paneScopedTabId);
      switchTab(paneScopedTabId, undefined, targetPaneId);
      return;
    }

    const newTab = {
      id: paneScopedTabId,
      type: "dashboard" as const,
      name: dashboard.name,
    };

    const newTabs = buildNewTabs(newTab, undefined, true);
    setOpenTabs(newTabs);
    
    if (splitView.enabled) {
      setSplitView((prev) => {
        const next = assignTabToPane(prev, paneScopedTabId, targetPaneId, true);
        return { ...next, activePaneId: targetPaneId };
      });
    }
    
    switchTab(paneScopedTabId, newTabs, targetPaneId);
  }, [dashboards, openTabs, activeTabId, switchTab, splitView.enabled, splitView, getCurrentPaneId, assignTabToPane]);

  useEffect(() => {
    const handleOpenDashboardTab = (event: Event) => {
      const customEvent = event as CustomEvent<{ dashboardId?: string }>;
      const dashboardId = customEvent?.detail?.dashboardId;
      if (typeof dashboardId !== "string" || !dashboardId) return;
      openDashboardTab(dashboardId);
    };

    window.addEventListener("studio:open-dashboard-tab", handleOpenDashboardTab as EventListener);
    return () => {
      window.removeEventListener("studio:open-dashboard-tab", handleOpenDashboardTab as EventListener);
    };
  }, [openDashboardTab]);

  const createDashboard = useCallback((name: string, folderId: string | null = null) => {
    const dashboardName = name.trim();
    if (!dashboardName) return null;

    const nextFolderId = folderId && dashboardFolders.some((folder) => folder.id === folderId) ? folderId : null;
    const newDashboard: Dashboard = {
      id: Math.random().toString(36).slice(2, 10),
      name: dashboardName,
      folderId: nextFolderId,
      widgets: [],
    };

    const nextDashboards = [...dashboards, newDashboard];
    setDashboards(nextDashboards);
    setSidebarView("dashboard");

    const tabId = `dashboard-${newDashboard.id}`;
    const newTab = {
      id: tabId,
      type: "dashboard" as const,
      name: newDashboard.name,
    };
    addTabAndSwitch(newTab, tabId);
    return newDashboard.id;
  }, [dashboards, dashboardFolders, openTabs, activeTabId, switchTab, setSidebarView, addTabAndSwitch]);

  const updateDashboard = useCallback((dashboardId: string, updates: Partial<Pick<Dashboard, "name" | "folderId" | "isShared" | "isLocked" | "sharedEntryId">>) => {
    const nextName = typeof updates.name === "string" ? updates.name.trim() : undefined;
    const nextFolderId = updates.folderId === undefined
      ? undefined
      : updates.folderId === null
        ? null
        : dashboardFolders.some((folder) => folder.id === updates.folderId)
          ? updates.folderId
          : null;
    const nextIsShared = typeof updates.isShared === "boolean" ? updates.isShared : undefined;
    const nextIsLocked = typeof updates.isLocked === "boolean" ? updates.isLocked : undefined;
    const nextSharedEntryId: string | undefined = typeof updates.sharedEntryId === "string" ? updates.sharedEntryId : undefined;
    if (nextName !== undefined && !nextName) return;

    applyDashboardUpdate(dashboardId, {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextFolderId !== undefined ? { folderId: nextFolderId } : {}),
      ...(nextIsShared !== undefined ? { isShared: nextIsShared } : {}),
      ...(nextIsLocked !== undefined ? { isLocked: nextIsLocked } : {}),
      ...(nextSharedEntryId !== undefined ? { sharedEntryId: nextSharedEntryId } : {}),
    }, setDashboards, setOpenTabs);
  }, [dashboardFolders]);

  const toggleDashboardShare = useCallback(async (id: string, share: boolean, granteeType?: "studio" | "public") => {
    const dashboard = dashboards.find((d) => d.id === id);
    if (!dashboard) return;
    setSharingDashboardId(id);
    try {
      if (share) {
        const { entryId, error } = await shareDashboardEntry(
          { id: dashboard.id, name: dashboard.name, folderId: dashboard.folderId, widgets: dashboard.widgets },
          granteeType || "studio"
        );
        if (entryId) {
          updateDashboard(id, { isShared: true, sharedEntryId: entryId });
        } else {
          console.error("Failed to share dashboard:", error);
        }
      } else if (dashboard.sharedEntryId) {
        await unshareEntry(dashboard.sharedEntryId);
        updateDashboard(id, { isShared: false, sharedEntryId: undefined });
      }
    } finally {
      setSharingDashboardId(null);
    }
  }, [dashboards, updateDashboard]);

  const updateDashboardPermissions = useCallback(async (entryId: string, permissions: KVPermission[]) => {
    await updateEntryPermissions(entryId, permissions);
  }, []);

  const deleteDashboard = useCallback((dashboardId: string) => {
    setDashboards((prev) => prev.filter((dashboard) => dashboard.id !== dashboardId));
    closeTabsByBaseId(`dashboard-${dashboardId}`);
  }, [closeTabsByBaseId]);

  const addDashboardFolder = useCallback((name: string, parentId?: string | null) => {
    const folderName = name.trim();
    if (!folderName) return null;
    const newFolder: DashboardFolder = {
      id: Math.random().toString(36).slice(2, 10),
      name: folderName,
      parentId: parentId ?? null,
      createdAt: Date.now(),
    };
    setDashboardFolders((prev) => [...prev, newFolder]);
    return newFolder;
  }, []);

  const updateDashboardFolder = useCallback((folderId: string, updates: Partial<DashboardFolder>) => {
    const nextName = typeof updates.name === "string" ? updates.name.trim() : undefined;
    if (nextName !== undefined && !nextName) return;
    setDashboardFolders((prev) =>
      prev.map((folder) =>
        folder.id === folderId
          ? { ...folder, ...(nextName !== undefined ? { name: nextName } : {}), ...(updates.parentId !== undefined ? { parentId: updates.parentId } : {}) }
          : folder
      )
    );
  }, []);

  const deleteDashboardFolder = useCallback((folderId: string) => {
    const parentId = dashboardFolders.find(f => f.id === folderId)?.parentId ?? null;
    setDashboardFolders((prev) => prev.filter((folder) => folder.id !== folderId).map(f => f.parentId === folderId ? { ...f, parentId } : f));
    setDashboards((prev) =>
      prev.map((dashboard) => (dashboard.folderId === folderId ? { ...dashboard, folderId: parentId } : dashboard))
    );
  }, [dashboardFolders]);

  const handleExportDashboards = useCallback((dashboardIds: string[]) => {
    const selected = dashboards.filter(d => dashboardIds.includes(d.id));
    const folderMap = new Map(dashboardFolders.map(f => [f.id, f.name]));
    const folderParentMap = new Map(dashboardFolders.filter(f => f.parentId).map(f => [f.id, folderMap.get(f.parentId!) ?? null]));
    const data: DashboardExportData = {
      version: 2,
      type: "dashboards",
      folders: dashboardFolders.map(f => ({ name: f.name, parentName: f.parentId ? folderMap.get(f.parentId) ?? null : null, createdAt: f.createdAt })),
      dashboards: selected.map(d => ({
        name: d.name,
        folderName: d.folderId ? folderMap.get(d.folderId) ?? null : null,
        isShared: d.isShared,
        isLocked: d.isLocked,
        widgets: d.widgets,
      })),
    };
    const filename = dashboardIds.length === 1
      ? `dashboard-${selected[0]?.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`
      : `dashboards-export-${new Date().toISOString().slice(0, 10)}.json`;
    downloadFile(JSON.stringify(data, null, 2), filename);
  }, [dashboards, dashboardFolders]);

  const handleImportDashboards = useCallback((data: DashboardExportData) => {
    const nameToId: Record<string, string> = {};
// fallow-ignore-next-line code-duplication
    const existingFolderNames = new Set(dashboardFolders.map(f => f.name));
    const foldersByName = new Map(dashboardFolders.map(f => [f.name, f]));

    for (const f of data.folders) {
      if (!existingFolderNames.has(f.name)) {
        const parentId = f.parentName ? nameToId[f.parentName] ?? null : null;
        const folder = addDashboardFolder(f.name, parentId);
        // fallow-ignore-next-line code-duplication
        if (folder) nameToId[f.name] = folder.id;
        existingFolderNames.add(f.name);
      } else {
        const existing = foldersByName.get(f.name);
        if (existing) nameToId[f.name] = existing.id;
      }
    }

    const newDashboards: Dashboard[] = data.dashboards.map(d => ({
      id: Math.random().toString(36).slice(2, 10),
      name: d.name,
      folderId: d.folderName ? nameToId[d.folderName] ?? null : null,
      isShared: d.isShared,
      isLocked: d.isLocked,
      widgets: d.widgets,
    }));

    setDashboards(prev => [...prev, ...newDashboards]);
  }, [dashboardFolders, addDashboardFolder]);

  const openDashboardHome = useCallback(() => {
    setSidebarView("dashboard");
    if (dashboards.length === 0) {
      createDashboard("Default Dashboard");
      return;
    }
    openDashboardTab(dashboards[0].id);
  }, [dashboards, createDashboard, openDashboardTab, setSidebarView]);

  const addDashboardWidget = useCallback((dashboardId: string, _type: "query" | "metric" | "chart") => {
    setDashboards((prev) =>
      prev.map((dashboard) => {
        if (dashboard.id !== dashboardId) return dashboard;
        const layoutIndex = dashboard.widgets.length;
        return {
          ...dashboard,
          widgets: [
            ...dashboard.widgets,
            createEmptyDashboardWidget({
              index: layoutIndex + 1,
              x: 40 + (layoutIndex % 2) * 440,
              y: 40 + Math.floor(layoutIndex / 2) * 280,
            }),
          ],
        };
      })
    );
  }, []);

  const addDashboardWidgetFromBounds = useCallback((
    dashboardId: string,
    bounds: { x: number; y: number; width: number; height: number },
    _type: "query" | "metric" | "chart" = "query"
  ) => {
    setDashboards((prev) =>
      prev.map((dashboard) => {
        if (dashboard.id !== dashboardId) return dashboard;
        return {
          ...dashboard,
          widgets: [
            ...dashboard.widgets,
            createEmptyDashboardWidget({
              index: dashboard.widgets.length + 1,
              x: snapDashboardPosition(bounds.x),
              y: snapDashboardPosition(bounds.y),
              width: snapDashboardSize(bounds.width),
              height: snapDashboardSize(bounds.height),
            }),
          ],
        };
      })
    );
  }, []);

  const updateDashboardWidget = useCallback((
    dashboardId: string,
    widgetId: string,
    updates: Partial<{
      title: string;
      query?: string;
      tableName?: string;
      schema?: string;
      content?: string;
      conditions?: Array<{
        id: string;
        operator: DashboardConditionOperator;
        value?: string;
        actionType: DashboardConditionActionType;
        actionValue: string;
      }>;
      widgetType: DashboardWidgetType;
      x: number;
      y: number;
      width: number;
      height: number;
    }>
  ) => {
    setDashboards((prev) =>
      prev.map((dashboard) =>
        dashboard.id !== dashboardId
          ? dashboard
          : {
            ...dashboard,
            widgets: dashboard.widgets.map((widget) =>
              widget.id === widgetId ? { ...widget, ...updates } : widget
            ),
          }
      )
    );
  }, []);

  const removeDashboardWidget = useCallback((dashboardId: string, widgetId: string) => {
    setDashboards((prev) =>
      prev.map((dashboard) =>
        dashboard.id !== dashboardId
          ? dashboard
          : {
            ...dashboard,
            widgets: dashboard.widgets.filter((widget) => widget.id !== widgetId),
          }
      )
    );
  }, []);

  const applyDashboardWidgetLayout = useCallback((
    dashboardId: string,
    widgets: DashboardWidget[]
  ) => {
    setDashboards((prev) =>
      prev.map((dashboard) => (dashboard.id === dashboardId ? { ...dashboard, widgets } : dashboard))
    );
  }, []);

  const applyAgentPlanToDashboard = useCallback((dashboardId: string, plan: AgentDashboardPlan) => {
    const supportedWidgetTypes = new Set<DashboardWidgetType>([
      "area-chart",
      "bar-chart",
      "pie-chart",
      "table",
      "metric",
      "sparkline",
      "map",
      "progress",
      "text",
    ]);

    const plannedWidgets = Array.isArray(plan.widgets) ? plan.widgets : [];
    const widgets = plannedWidgets
      .slice(0, 12)
      .map((widget, index) => {
        const requestedType = String(widget.widgetType || "metric") as DashboardWidgetType;
        const widgetType = supportedWidgetTypes.has(requestedType) ? requestedType : "metric";
        const tableName = typeof widget.tableName === "string" && widget.tableName.trim() ? widget.tableName.trim() : undefined;
        const schemaName = typeof widget.schema === "string" && widget.schema.trim()
          ? widget.schema.trim()
          : (selectedSchema || fallbackSchemaForDb || "public");
        return {
          id: Math.random().toString(36).slice(2, 10),
          widgetType,
          title: (typeof widget.title === "string" && widget.title.trim()) || `Widget ${index + 1}`,
          query: typeof widget.query === "string" ? widget.query : "",
          tableName: widgetType === "table" ? tableName : undefined,
          schema: widgetType === "table" ? schemaName : undefined,
          content: typeof widget.content === "string" ? widget.content : "",
          conditions: [],
          x: snapDashboardPosition(40 + (index % 2) * 440),
          y: snapDashboardPosition(40 + Math.floor(index / 2) * 280),
          width: snapDashboardSize(400),
          height: snapDashboardSize(240),
        };
      });

    if (widgets.length === 0) {
      throw new Error("Agent did not return any widgets.");
    }

    const nextName = typeof plan.name === "string" ? plan.name.trim() : "";
    applyDashboardUpdate(dashboardId, { ...(nextName ? { name: nextName } : {}), widgets }, setDashboards, setOpenTabs);

    toast.success(`Generated ${widgets.length} widget${widgets.length === 1 ? "" : "s"} with agent.`);
  }, [selectedSchema, fallbackSchemaForDb]);

  const isLikelyNumericType = useCallback((rawType: string) => {
    const type = String(rawType || "").toLowerCase();
    return (
      type.includes("int")
      || type.includes("numeric")
      || type.includes("decimal")
      || type.includes("float")
      || type.includes("double")
      || type.includes("real")
      || type.includes("serial")
      || type.includes("money")
    );
  }, []);

  const pickFallbackTable = useCallback((tables: SchemaContextTable[]) => {
    if (!tables.length) return null;
    const preferred = tables.find((t) => t.schema === (selectedSchema || fallbackSchemaForDb || "public")) || tables[0];
    return preferred || null;
  }, [selectedSchema]);

  const buildFallbackQuery = useCallback((
    widgetType: DashboardWidgetType,
    tables: SchemaContextTable[],
    requestedTableName?: string,
    requestedSchemaName?: string,
  ) => {
    const target = tables.find((table) => {
      if (requestedTableName && table.table !== requestedTableName) return false;
      if (requestedSchemaName && table.schema !== requestedSchemaName) return false;
      return true;
    }) || pickFallbackTable(tables);

    if (!target) return "SELECT 1 AS value;";

    const tableRef = quoteTableRef(target.schema, target.table);
    const numericColumn = target.columns.find((column) => isLikelyNumericType(column.type));
    const labelColumn = target.columns.find((column) => !isLikelyNumericType(column.type) && column.name.toLowerCase() !== "id");
    const dateColumn = target.columns.find((column) => {
      const type = String(column.type || "").toLowerCase();
      return type.includes("date") || type.includes("time");
    });

    if (widgetType === "table") {
      return isMssql
        ? `SELECT TOP 100 * FROM ${tableRef};`
        : `SELECT * FROM ${tableRef} LIMIT 100;`;
    }

    if (widgetType === "metric" || widgetType === "progress") {
      return `SELECT COUNT(*) AS value FROM ${tableRef};`;
    }

// fallow-ignore-next-line code-duplication
    if (widgetType === "pie-chart") {
      if (labelColumn && numericColumn) {
        const label = quoteIdentifier(labelColumn.name);
        const value = quoteIdentifier(numericColumn.name);
        return isMssql
          ? `SELECT TOP 8 ${label} AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY ${label} ORDER BY value DESC;`
          : `SELECT ${label} AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY ${label} ORDER BY value DESC LIMIT 8;`;
      }
      return `SELECT 'Rows' AS label, COUNT(*) AS value FROM ${tableRef};`;
    }

    if (widgetType === "map") {
      if (target.columns.some((column) => /lat/i.test(column.name)) && target.columns.some((column) => /(lon|lng|long)/i.test(column.name))) {
        const latColumn = target.columns.find((column) => /lat/i.test(column.name));
        const lonColumn = target.columns.find((column) => /(lon|lng|long)/i.test(column.name));
        const label = labelColumn ? quoteIdentifier(labelColumn.name) : "'Point'";
        const lat = latColumn ? quoteIdentifier(latColumn.name) : "NULL";
        const lon = lonColumn ? quoteIdentifier(lonColumn.name) : "NULL";
        return isMssql
          ? `SELECT TOP 100 ${label} AS label, ${lat} AS lat, ${lon} AS lon FROM ${tableRef} WHERE ${lat} IS NOT NULL AND ${lon} IS NOT NULL;`
          : `SELECT ${label} AS label, ${lat} AS lat, ${lon} AS lon FROM ${tableRef} WHERE ${lat} IS NOT NULL AND ${lon} IS NOT NULL LIMIT 100;`;
      }
      return isMysql
        ? "SELECT 'Default' AS label, CAST(0.0 AS DOUBLE) AS lat, CAST(0.0 AS DOUBLE) AS lon;"
        : isClickhouse
          ? "SELECT 'Default' AS label, CAST(0.0 AS Float64) AS lat, CAST(0.0 AS Float64) AS lon;"
          : isMssql
            ? "SELECT 'Default' AS label, CAST(0.0 AS FLOAT) AS lat, CAST(0.0 AS FLOAT) AS lon;"
            : "SELECT 'Default' AS label, 0.0::double precision AS lat, 0.0::double precision AS lon;";
    }

    if (widgetType === "bar-chart" || widgetType === "area-chart" || widgetType === "sparkline") {
      if (dateColumn) {
        const date = quoteIdentifier(dateColumn.name);
        const dateExpr = isMssql ? `CAST(${date} AS date)` : `DATE(${date})`;
        if (numericColumn) {
          const value = quoteIdentifier(numericColumn.name);
          return isMssql
            ? `SELECT TOP 30 ${dateExpr} AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY ${dateExpr} ORDER BY ${dateExpr};`
            : `SELECT DATE(${date}) AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY DATE(${date}) ORDER BY DATE(${date}) LIMIT 30;`;
        }
        return isMssql
          ? `SELECT TOP 30 ${dateExpr} AS label, COUNT(*) AS value FROM ${tableRef} GROUP BY ${dateExpr} ORDER BY ${dateExpr};`
          : `SELECT DATE(${date}) AS label, COUNT(*) AS value FROM ${tableRef} GROUP BY DATE(${date}) ORDER BY DATE(${date}) LIMIT 30;`;
      }
// fallow-ignore-next-line code-duplication
      if (labelColumn && numericColumn) {
        const label = quoteIdentifier(labelColumn.name);
        const value = quoteIdentifier(numericColumn.name);
        return isMssql
          ? `SELECT TOP 12 ${label} AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY ${label} ORDER BY value DESC;`
          : `SELECT ${label} AS label, SUM(COALESCE(${value}, 0)) AS value FROM ${tableRef} GROUP BY ${label} ORDER BY value DESC LIMIT 12;`;
      }
      return `SELECT COUNT(*) AS value FROM ${tableRef};`;
    }

    if (widgetType === "text") {
      return `SELECT COUNT(*) AS total_rows FROM ${tableRef};`;
    }

    return `SELECT COUNT(*) AS value FROM ${tableRef};`;
  }, [isLikelyNumericType, pickFallbackTable, quoteIdentifier, quoteTableRef, isMysql, isClickhouse, isMssql]);

  const validateWidgetQueryShape = useCallback((
    widgetType: DashboardWidgetType,
    data: { rows?: Array<Record<string, unknown>>; fields?: Array<{ name: string }> } | null | undefined
  ): QueryValidationShapeResult => {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const fields = (data?.fields || []).map((field) => String(field?.name || "")).filter(Boolean);
    const hasAnyNumeric = fields.some((fieldName) => rows.some((row) => {
      const value = row?.[fieldName];
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string") {
        const parsed = Number(value.trim());
        return value.trim() !== "" && Number.isFinite(parsed);
      }
      return false;
    }));

    if (widgetType === "bar-chart" || widgetType === "area-chart" || widgetType === "sparkline") {
      if (!rows.length) return { ok: false, reason: "query returned no rows" };
      if (!hasAnyNumeric) return { ok: false, reason: "query returned no numeric column" };
      return { ok: true };
    }

    if (widgetType === "pie-chart") {
      if (!rows.length) return { ok: false, reason: "query returned no rows" };
      if (!hasAnyNumeric) return { ok: false, reason: "query returned no numeric column" };
      const hasPositive = fields.some((fieldName) => rows.some((row) => {
        const value = row?.[fieldName];
        const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
        return Number.isFinite(numeric) && numeric > 0;
      }));
      if (!hasPositive) return { ok: false, reason: "pie chart requires at least one positive numeric value" };
      return { ok: true };
    }

    if (widgetType === "progress") {
      if (!rows.length) return { ok: false, reason: "query returned no rows" };
      if (!hasAnyNumeric) return { ok: false, reason: "progress widget requires a numeric value" };
      return { ok: true };
    }

    if (widgetType === "map") {
      const lower = fields.map((field) => field.toLowerCase());
      const hasLat = lower.some((name) => name.includes("lat"));
      const hasLon = lower.some((name) => name.includes("lon") || name.includes("lng") || name.includes("long"));
      if (!hasLat || !hasLon) {
        return { ok: false, reason: "map widget requires latitude/longitude columns" };
      }
      return { ok: true };
    }

    return { ok: true };
  }, []);

  const validateAndRepairAgentPlan = useCallback(async (
    plan: AgentDashboardPlan,
    tables: SchemaContextTable[],
    onEvent?: (event: { type: "step" | "result" | "error"; message?: string }) => void
  ) => {
    const widgets = Array.isArray(plan.widgets) ? plan.widgets : [];
    if (!widgets.length) return plan;

    onEvent?.({ type: "step", message: "Validating generated widget queries..." });

    const repairedWidgets = await Promise.all(
      widgets.map(async (widget) => {
        const requestedType = String(widget.widgetType || "metric") as DashboardWidgetType;
        const type = requestedType;
        const requiresQuery = type !== "image" && type !== "gif";
        if (!requiresQuery) return widget;

        let query = typeof widget.query === "string" ? widget.query.trim() : "";
        if (!query) {
          query = buildFallbackQuery(type, tables, widget.tableName, widget.schema);
          return { ...widget, query };
        }

        const initialValidation = await runQuery(currentConnectionString, query);
        if (initialValidation.success) {
          const shapeValidation = validateWidgetQueryShape(type, initialValidation.data);
          if (shapeValidation.ok) {
            return widget;
          }

          const fallbackQuery = buildFallbackQuery(type, tables, widget.tableName, widget.schema);
          const fallbackValidation = await runQuery(currentConnectionString, fallbackQuery);
          if (fallbackValidation.success) {
            const fallbackShapeValidation = validateWidgetQueryShape(type, fallbackValidation.data);
            if (fallbackShapeValidation.ok) {
              onEvent?.({
                type: "step",
                message: `Repaired "${widget.title || "widget"}" query due to invalid data shape (${shapeValidation.reason || "not compatible with widget type"}).`,
              });
              return { ...widget, query: fallbackQuery };
            }
          }
          return widget;
        }

        const fallbackQuery = buildFallbackQuery(type, tables, widget.tableName, widget.schema);
        const fallbackValidation = await runQuery(currentConnectionString, fallbackQuery);
        if (fallbackValidation.success) {
          const fallbackShapeValidation = validateWidgetQueryShape(type, fallbackValidation.data);
          if (fallbackShapeValidation.ok) {
            onEvent?.({ type: "step", message: `Repaired "${widget.title || "widget"}" query due to execution error.` });
            return { ...widget, query: fallbackQuery };
          }
        }
        return widget;
      })
    );

    return {
      ...plan,
      widgets: repairedWidgets,
    } as AgentDashboardPlan;
  }, [buildFallbackQuery, currentConnectionString, validateWidgetQueryShape]);

  const buildAgentSchemaContext = useCallback((): SchemaContextTable[] => {
    return Object
      .values(schemaData || {})
      .map((entry: any) => ({
        schema: String(entry?.schema || selectedSchema || fallbackSchemaForDb || "public"),
        table: String(entry?.name || ""),
        columns: Array.isArray(entry?.columns)
          ? entry.columns.map((col: any) => ({
            name: String(col?.name || ""),
            type: String(col?.type || "text"),
          })).filter((col: { name: string }) => col.name.length > 0)
          : [],
      }))
      .filter((entry) => entry.table.length > 0);
  }, [schemaData, selectedSchema, fallbackSchemaForDb]);

  const runAgentChat = useCallback(async (
    prompt: string,
    history: AgentChatHistoryMessage[] = [],
    onEvent?: (event: { type: "step" | "error"; message?: string }) => void
  ) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error("Prompt is required.");
    }
    validateAgentPrerequisites(agentApiKey, agentModel);

    const schemaEntries = buildAgentSchemaContext();
    const sanitizedHistory = history
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({
        role: entry.role,
        content: String(entry.content || "").trim(),
      }))
      .filter((entry) => entry.content.length > 0)
      .slice(-20);

    const response = await apiFetch("/api/agent/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: agentProvider,
        model: agentModel,
        apiKey: agentApiKey.trim(),
        prompt: trimmedPrompt,
        dbType,
        schemaContext: schemaEntries,
        connectionString: currentConnectionString,
        defaultSchema: selectedSchema,
        history: sanitizedHistory,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error("Failed to start agent chat stream.");
    }

    let assistantReply = "";
    let streamError: string | null = null;

    await readSseStream<{ type: string; message?: string }>(response, (payload) => {
      if (payload.type === "assistant") {
        assistantReply = String(payload.message || "").trim();
      } else if (payload.type === "error") {
// fallow-ignore-next-line code-duplication
        streamError = payload.message || "Agent chat request failed.";
        onEvent?.({ type: "error", message: streamError });
      } else if (payload.type === "step") {
        onEvent?.({ type: "step", message: payload.message || "Working..." });
      }
    });

    if (streamError) throw new Error(streamError);
    if (!assistantReply) {
      throw new Error("No assistant reply returned by agent.");
    }

    return assistantReply;
  }, [agentApiKey, agentModel, agentProvider, buildAgentSchemaContext, dbType, currentConnectionString, selectedSchema]);

  const runAgentDashboardGeneration = useCallback(async (
    prompt: string,
    onEvent?: (event: { type: "step" | "result" | "error" | "assistant"; message?: string }) => void
  ) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error("Prompt is required.");
    }
    validateAgentPrerequisites(agentApiKey, agentModel);

    const schemaEntries = buildAgentSchemaContext();

    let targetDashboardId = activeTabId?.startsWith("dashboard-")
      ? activeTabId.replace("dashboard-", "")
      : null;

    if (!targetDashboardId || !dashboards.some((dashboard) => dashboard.id === targetDashboardId)) {
      const existing = dashboards[0];
      if (existing) {
        targetDashboardId = existing.id;
        openDashboardTab(existing.id);
      } else {
        const newDashboard: Dashboard = {
          id: Math.random().toString(36).slice(2, 10),
          name: "Agent Dashboard",
          folderId: null,
          widgets: [],
        };
        targetDashboardId = newDashboard.id;
        setDashboards((prev) => [...prev, newDashboard]);
        setSidebarView("dashboard");

        const tabId = `dashboard-${newDashboard.id}`;
        const newTab = {
          id: tabId,
          type: "dashboard" as const,
          name: newDashboard.name,
        };
        const nextTabs = buildNewTabs(newTab);
        setOpenTabs(nextTabs);
        switchTab(tabId, nextTabs);
      }
    }

    if (!targetDashboardId) {
      throw new Error("Failed to resolve dashboard target.");
    }

    const response = await apiFetch("/api/agent/generate-dashboard/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: agentProvider,
        model: agentModel,
        apiKey: agentApiKey.trim(),
        prompt: trimmedPrompt,
        dbType,
        schemaContext: schemaEntries,
        connectionString: currentConnectionString,
        defaultSchema: selectedSchema || undefined,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error("Failed to start agent stream.");
    }

    let resolvedPlan: AgentDashboardPlan | null = null;
    let streamError: string | null = null;

    await readSseStream<{ type: string; message?: string; data?: AgentDashboardPlan }>(response, (payload) => {
      if (payload.type === "result" && payload.data) {
        resolvedPlan = payload.data;
        onEvent?.({ type: "result", message: "Dashboard plan generated." });
      } else if (payload.type === "assistant") {
        onEvent?.({ type: "assistant", message: payload.message || "" });
      } else if (payload.type === "error") {
// fallow-ignore-next-line code-duplication
        streamError = payload.message || "Agent request failed.";
        onEvent?.({ type: "error", message: streamError });
      } else if (payload.type === "step") {
        onEvent?.({ type: "step", message: payload.message || "Working..." });
      }
    });

    if (streamError) throw new Error(streamError);
    if (!resolvedPlan) throw new Error("No dashboard result returned by agent.");


    const repairedPlan = await validateAndRepairAgentPlan(resolvedPlan, schemaEntries, onEvent);
    onEvent?.({ type: "step", message: "Applying dashboard widgets..." });
    applyAgentPlanToDashboard(targetDashboardId, repairedPlan);
  }, [
    activeTabId,
    agentApiKey,
    agentModel,
    agentProvider,
    buildAgentSchemaContext,
    dashboards,
    dbType,
    currentConnectionString,
    openDashboardTab,
    openTabs,
    selectedSchema,
    switchTab,
    applyAgentPlanToDashboard,
    validateAndRepairAgentPlan,
    setSidebarView,
  ]);

  const getActiveDashboard = useCallback(() => {
    if (!activeTabId || !activeTabId.startsWith("dashboard-")) return null;
    const dashboardId = activeTabId.replace("dashboard-", "").replace(/::pane::.*$/, "");
    return dashboards.find((d) => d.id === dashboardId) || null;
  }, [activeTabId, dashboards]);

  const openCreateEnumTab = useCallback(() => {
    if (!createSupport.enum) {
      toast.error("Create Enum is supported only for PostgreSQL connections.");
      return;
    }
    setIsEditingEnum(false);
    setEditingEnumName(null);
    setNewEnumData({ name: '', values: [''] });
    openSimpleTab('create-enum', 'create-enum', 'New Enum', {
      schema: selectedSchema || fallbackSchemaForDb || 'public'
    });
  }, [openSimpleTab, createSupport.enum, selectedSchema, fallbackSchemaForDb]);

  const openEditEnumTab = useCallback((schema: string, enumName: string, values: string[]) => {
    if (!createSupport.enum) {
      toast.error("Edit Enum is supported only for PostgreSQL connections.");
      return;
    }
    setIsEditingEnum(true);
    setEditingEnumName(enumName);
    setNewEnumData({ name: enumName, values: [...values] });
    setSelectedSchema(schema);

    const tabId = 'create-enum'; // We reuse the same tab for now, or we could make it unique
    const existingTab = openTabs.find(t => t.id === tabId);

    if (!existingTab) {
      const newTab = {
        id: tabId,
        type: 'create-enum' as const,
        name: `Edit ${enumName}`,
        schema: schema
      };

      addTabAndSwitch(newTab, tabId);
    } else {
      const nextTabs = openTabs.map(t => t.id === tabId ? { ...t, name: `Edit ${enumName}`, schema } : t);
      setOpenTabs(nextTabs);
      switchTab(tabId, nextTabs);
    }
  }, [openTabs, activeTabId, query, switchTab, createSupport.enum]);

  const handleTableClick = useCallback((tableName: string, schemaOverride?: string) => {
    const schema = schemaOverride ?? selectedSchema;
    const targetPaneId = getCurrentPaneId();
    const baseId = `table-${schema}-${tableName}`;
    logStudioDebug("table-click", {
      tableName,
      schema,
      targetPaneId,
      activePaneId: activePaneIdRef.current,
      activeTabId: activeTabIdRef.current,
    });
    const paneExistingTab = openTabs.find((tab) =>
      tab.type === "table"
      && getTabBaseId(tab) === baseId
      && getPaneIdForTab(tab.id) === targetPaneId
    );
    if (paneExistingTab) {
      logStudioDebug("table-click-existing-in-pane", {
        baseId,
        existingTabId: paneExistingTab.id,
        targetPaneId,
      });
      switchTab(paneExistingTab.id, undefined, targetPaneId);
      return;
    }

    const existingAnyPane = openTabs.find((tab) => tab.type === "table" && getTabBaseId(tab) === baseId);
    if (existingAnyPane) {
      logStudioDebug("table-click-clone-to-pane", {
        baseId,
        sourceTabId: existingAnyPane.id,
        sourcePaneId: getPaneIdForTab(existingAnyPane.id),
        targetPaneId,
      });
      switchTab(existingAnyPane.id, undefined, targetPaneId);
      return;
    }

    const tabId = splitView.enabled
      ? buildPaneScopedTabId(baseId, targetPaneId, openTabs)
      : baseId;
    const newTab = {
      id: tabId,
      baseId,
      type: 'table' as const,
      name: tableName,
      schema,
    };

    const newTabs = buildNewTabs(newTab, undefined, true);

    setOpenTabs(newTabs);
    switchTab(tabId, newTabs, targetPaneId);
  }, [selectedSchema, openTabs, activeTabId, switchTab, splitView.enabled, buildPaneScopedTabId, getCurrentPaneId, getPaneIdForTab, getTabBaseId]);

  const navigateTableSelection = useCallback((direction: "up" | "down") => {
    if (!tables.length) return;

    const currentIndex = selectedTable ? tables.indexOf(selectedTable) : -1;
    let nextIndex = currentIndex;

    if (currentIndex === -1) {
      nextIndex = direction === "down" ? 0 : tables.length - 1;
    } else if (direction === "down") {
      nextIndex = Math.min(tables.length - 1, currentIndex + 1);
    } else {
      nextIndex = Math.max(0, currentIndex - 1);
    }

    const nextTable = tables[nextIndex];
    if (!nextTable || nextTable === selectedTable) return;
    handleTableClick(nextTable);
  }, [handleTableClick, selectedTable, tables]);

  const clearTabUrlState = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.delete("t");
    params.delete("f");
    params.delete("sc");
    params.delete("sd");
    params.delete("view");
    params.delete("db-view");
    const nextSearch = params.toString();

    window.requestAnimationFrame(() => {
      if (typeof window !== "undefined") {
        const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
        window.history.replaceState(window.history.state, "", nextUrl);
        return;
      }

      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname);
    });
  }, [pathname, router, searchParams]);

  const closeTabById = useCallback((id: string) => {
    const closedTab = openTabs.find((tab) => tab.id === id);
    if (!closedTab) return;
    if (closedTab.pinned) return;
    let nextTabs = filterTabsAfterClose(openTabs, closedTab, getTabBaseId);
    const initialRemovedTabIds = openTabs
      .filter((tab) => !nextTabs.some((nextTab) => nextTab.id === tab.id))
      .map((tab) => tab.id);
    const {
      nextFocusedTab,
      nextFocusedTabId,
      nextSplitView,
    } = resolveTabCloseState({
      activeTabId,
      closedTabId: id,
      openTabs,
      splitView,
    });

    let finalSplitView = nextSplitView;
    let finalNextFocusedTabId: string | null = nextFocusedTabId;
    let finalNextFocusedTab = nextFocusedTab;
    let finalNextTabs = nextTabs;
    const finalRemovedTabIds = [...initialRemovedTabIds];

    if (autoClosePane) {
      const closedPaneId = resolvePaneForTab(splitView, id);
      const result = tryAutoClosePane(finalNextTabs, finalSplitView, closedPaneId);
      if (result.didClose) {
        finalSplitView = result.nextSplitView;
        finalNextTabs = result.remainingTabs;
        finalNextFocusedTabId = result.nextActiveTabId;
        finalNextFocusedTab = result.remainingTabs.find((t) => t.id === result.nextActiveTabId) ?? null;
        result.removedTabs.forEach((t) => {
          if (!finalRemovedTabIds.includes(t.id)) finalRemovedTabIds.push(t.id);
        });
      }
    }

    logStudioDebug("close-tab-start", {
      closedTabId: id,
      closedTabType: closedTab.type,
      removedTabIds: finalRemovedTabIds,
      nextFocusedTabId: finalNextFocusedTabId,
      activePaneId: splitView.activePaneId,
      tabPaneMap: Object.fromEntries(openTabs.map((tab) => [tab.id, getPaneIdForTab(tab.id, splitView)])),
    });

    setOpenTabs(finalNextTabs);
    cleanupClosedTabCaches(finalRemovedTabIds, setTabDataCache, setSqlTabStates);
    finalRemovedTabIds.forEach((removedId) => {
      delete sqlTabRunRequestIdRef.current[removedId];
      if (sqlTabTimerRef.current[removedId]) {
        clearInterval(sqlTabTimerRef.current[removedId]!);
        sqlTabTimerRef.current[removedId] = null;
      }
    });
    setSplitView(finalSplitView);

    if (activeTabId !== id) {
      return;
    }

    setSelectedCell(null);
    setSelectedRows(new Set());
    setEditingCell(null);

    if (finalNextFocusedTabId && finalNextFocusedTab) {
      switchTab(finalNextFocusedTabId, finalNextTabs, getPaneIdForTab(finalNextFocusedTabId, finalSplitView));
      return;
    }

    setActiveTabId(null);
    setViewMode("tables");
    setSelectedTable(null);
    if (closedTab.type === "table") {
      resetTableResults();
    }
    logStudioDebug("close-tab-finish", {
      closedTabId: id,
      nextFocusedTabId: null,
      remainingTabIds: finalNextTabs.map((tab) => tab.id),
    });
    clearTabUrlState();
  }, [activeTabId, autoClosePane, clearTabUrlState, getPaneIdForTab, getTabBaseId, openTabs, pathname, router, searchParams, splitView, switchTab]);

  const togglePinTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const next = prev.map((tab) =>
        tab.id === id ? { ...tab, pinned: !tab.pinned, isPreview: false } : tab
      );
      const pinned = next.filter((t) => t.pinned);
      const unpinned = next.filter((t) => !t.pinned);
      return [...pinned, ...unpinned];
    });
  }, []);

  const confirmPreviewTab = useCallback((id: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) => (tab.id === id && tab.isPreview ? { ...tab, isPreview: false } : tab))
    );
  }, []);

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTabById(id);
  };

  const closeTabsByIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const closingTabs = openTabs.filter((tab) => idSet.has(tab.id) && !tab.pinned);
    if (closingTabs.length === 0) return;

    const initialRemovedTabIds = closingTabs.map((tab) => tab.id);
    let nextTabs = openTabs.filter((tab) => !idSet.has(tab.id) || tab.pinned);
    const nextTabPaneMap = { ...splitView.tabPaneMap };
    initialRemovedTabIds.forEach((id) => delete nextTabPaneMap[id]);
    const wasActiveClosed = activeTabId ? idSet.has(activeTabId) : false;

    let nextSplitView = normalizeSplitLayout(
      { ...splitView, tabPaneMap: nextTabPaneMap },
      nextTabs.map((tab) => tab.id),
      wasActiveClosed ? null : activeTabId,
    );

    const finalRemovedTabIds = [...initialRemovedTabIds];

    if (autoClosePane) {
      const result = tryAutoCloseEmptyPanes(nextTabs, nextSplitView);
      if (result.didClose) {
        nextSplitView = result.nextSplitView;
        nextTabs = result.remainingTabs;
        result.removedTabs.forEach((t) => {
          if (!finalRemovedTabIds.includes(t.id)) finalRemovedTabIds.push(t.id);
        });
      }
    }

    setOpenTabs(nextTabs);
    cleanupClosedTabCaches(finalRemovedTabIds, setTabDataCache, setSqlTabStates);
    finalRemovedTabIds.forEach((id) => {
      delete sqlTabRunRequestIdRef.current[id];
      if (sqlTabTimerRef.current[id]) {
        clearInterval(sqlTabTimerRef.current[id]!);
        sqlTabTimerRef.current[id] = null;
      }
    });
    setSplitView(nextSplitView);

    if (!wasActiveClosed) return;

    const nextActivePaneId = nextSplitView.activePaneId;
    const nextFocusedTabId = nextSplitView.paneState[nextActivePaneId]?.activeTabId ?? null;

    setSelectedCell(null);
    setSelectedRows(new Set());
    setEditingCell(null);

    if (nextFocusedTabId) {
      const nextTab = nextTabs.find((tab) => tab.id === nextFocusedTabId);
      if (nextTab) {
        switchTab(nextFocusedTabId, nextTabs, getPaneIdForTab(nextFocusedTabId, nextSplitView));
        return;
      }
    }

    const closedTab = closingTabs[0];
    setActiveTabId(null);
    setViewMode("tables");
    setSelectedTable(null);
    if (closedTab?.type === "table") {
      resetTableResults();
    }
    clearTabUrlState();
  }, [activeTabId, autoClosePane, clearTabUrlState, getPaneIdForTab, openTabs, splitView, switchTab]);

  const closeOtherTabsInPane = useCallback((paneId: string, keepTabId: string) => {
    const paneTabIds = getTabsForPane(openTabs.map((t) => t.id), splitView, paneId);
    const toClose = paneTabIds.filter((id) => id !== keepTabId);
    closeTabsByIds(toClose);
  }, [openTabs, splitView, closeTabsByIds]);

  const closeAllTabsInPane = useCallback((paneId: string) => {
    const paneTabIds = getTabsForPane(openTabs.map((t) => t.id), splitView, paneId);
    closeTabsByIds(paneTabIds);
  }, [openTabs, splitView, closeTabsByIds]);

  const closeTabsToRightInPane = useCallback((paneId: string, anchorTabId: string) => {
    const paneTabIds = getTabsForPane(openTabs.map((t) => t.id), splitView, paneId);
    const anchorIndex = paneTabIds.indexOf(anchorTabId);
    if (anchorIndex < 0 || anchorIndex === paneTabIds.length - 1) return;
    closeTabsByIds(paneTabIds.slice(anchorIndex + 1));
  }, [openTabs, splitView, closeTabsByIds]);

  const closeTabsToLeftInPane = useCallback((paneId: string, anchorTabId: string) => {
    const paneTabIds = getTabsForPane(openTabs.map((t) => t.id), splitView, paneId);
    const anchorIndex = paneTabIds.indexOf(anchorTabId);
    if (anchorIndex <= 0) return;
    closeTabsByIds(paneTabIds.slice(0, anchorIndex));
  }, [openTabs, splitView, closeTabsByIds]);

  const setPaneActiveTab = useCallback((paneId: string, tabId: string | null) => {
    setSplitView((prev) => normalizeSplitLayout(
      activatePane(tabId ? assignTabToPane(prev, tabId, paneId, true) : prev, paneId, tabId),
      openTabs.map((tab) => tab.id),
      tabId
    ));
  }, [openTabs]);

  const setActivePaneId = useCallback((paneId: string) => {
    snapshotTableTabState(activeTabIdRef.current);
    activePaneIdRef.current = paneId;
    logStudioDebug("set-active-pane", {
      paneId,
      previousPaneId: splitView.activePaneId,
      previousTabId: activeTabIdRef.current,
      nextPaneActiveTabId: splitView.paneState[paneId]?.activeTabId ?? null,
    });
    setSplitView((prev) => activatePane(prev, paneId, prev.paneState[paneId]?.activeTabId ?? null));
  }, [snapshotTableTabState, splitView.activePaneId, splitView.paneState]);

  const createSplit = useCallback(() => {
    logStudioDebug("create-split-start", {
      activePaneId: splitView.activePaneId,
      activeTabId: activeTabIdRef.current,
      selectedSchema: selectedSchemaRef.current,
      selectedTable: selectedTableRef.current,
    });
    const currentTabId = activeTabIdRef.current;
    if (currentTabId) {
      setOpenTabs((prev) => prev.map((t) =>
        t.id === currentTabId && t.type === 'sql'
          ? { ...t, query: queryRef.current }
          : t
      ));
    }
    snapshotTableTabState(currentTabId);
    setSplitView((prev) => {
      const next = normalizeSplitLayout(splitPane(prev, prev.activePaneId), openTabs.map((tab) => tab.id), null);
      activePaneIdRef.current = next.activePaneId;
      logStudioDebug("create-split-finish", {
        previousPaneId: prev.activePaneId,
        nextPaneId: next.activePaneId,
        paneIds: getPaneIds(next.root),
      });
      return next;
    });
    setActiveTabId(null);
    setSelectedCell(null);
    setSelectedRows(new Set());
  }, [openTabs, snapshotTableTabState, splitView.activePaneId]);

  const closePaneById = useCallback((paneIdToClose: string) => {
    const currentOpenTabs = openTabsRef.current;
    const currentSplitView = splitViewRef.current;
    const {
      nextActiveTabId,
      nextSplitView,
      remainingTabs,
      removedTabs,
    } = resolvePaneCloseState(
      currentOpenTabs,
      currentSplitView,
      paneIdToClose
    );
    logStudioDebug("close-pane-start", {
      paneIdToClose,
      removedTabIds: removedTabs.map((tab) => tab.id),
      remainingTabIds: remainingTabs.map((tab) => tab.id),
      currentActivePaneId: currentSplitView.activePaneId,
      currentActiveTabId: activeTabIdRef.current,
      tabPaneMap: Object.fromEntries(currentOpenTabs.map((tab) => [tab.id, getPaneIdForTab(tab.id, currentSplitView)])),
    });
    setOpenTabs(remainingTabs);
    setTabDataCache((prev) => {
      const next = { ...prev };
      removedTabs.forEach((tab) => delete next[tab.id]);
      return next;
    });
    setSqlTabStates((prev) => {
      const next = { ...prev };
      removedTabs.forEach((tab) => {
        delete next[tab.id];
        delete sqlTabRunRequestIdRef.current[tab.id];
        if (sqlTabTimerRef.current[tab.id]) {
          clearInterval(sqlTabTimerRef.current[tab.id]!);
          sqlTabTimerRef.current[tab.id] = null;
        }
      });
      return next;
    });
    activePaneIdRef.current = nextSplitView.activePaneId;
    setSplitView(nextSplitView);
    logStudioDebug("close-pane-finish", {
      paneIdToClose,
      nextPaneId: nextSplitView.activePaneId,
      nextActiveTabId,
      remainingPaneIds: getPaneIds(nextSplitView.root),
      remainingTabIds: remainingTabs.map((tab) => tab.id),
    });

    if (nextActiveTabId) {
      switchTab(nextActiveTabId, remainingTabs, getPaneIdForTab(nextActiveTabId, nextSplitView));
      return;
    }

    setActiveTabId(null);
    setSelectedTable(null);
    clearTableData();
    setForeignKeys([]);
    setTotalCount(null);
    setViewMode("tables");
  }, []);

  const closeActivePane = useCallback(() => {
    closePaneById(splitViewRef.current.activePaneId);
  }, [closePaneById]);

  const setSplitRatio = useCallback((splitId: string, ratio: number) => {
    setSplitView((prev) => updateSplitRatio(prev, splitId, ratio));
  }, []);

  const copyTableSchema = useCallback(async (table: string, schema: string) => {
    const toastId = toast.loading(dbType === "mongodb" ? "Copying collection definition..." : "Copying table definition...");
    try {
      if (dbType === "mongodb") {
        const sampleQuery = JSON.stringify({
          operation: "findOne",
          database: schema,
          collection: table,
          filter: {},
        }, null, 2);
        const startTime = Date.now();
        const sampleRes = await runQuery(currentConnectionString, sampleQuery);
        addHistoryEntry({
          query: sampleQuery,
          duration: sampleRes.data?.executionTime || (Date.now() - startTime),
          status: sampleRes.success ? "success" : "error",
          error: sampleRes.error,
          caller: "system",
        });

        if (!sampleRes.success) {
          toast.error(sampleRes.error || "Failed to inspect collection", { id: toastId });
          return;
        }

        const sampleDoc = sampleRes.data?.rows?.[0] ?? null;
        const definition = JSON.stringify({
          database: schema,
          collection: table,
          inferredSchema: sampleDoc ? inferMongoShape(sampleDoc) : {},
          sampleDocument: sampleDoc,
        }, null, 2);
        await navigator.clipboard.writeText(definition);
        toast.success("Copied", { id: toastId });
        return;
      }

      if (dbType === "sqlite") {
        type SqliteDefRow = {
          type: "table" | "view" | string;
          sql: string | null;
        };

        const sqliteDefinitionSql = `
          SELECT type, sql
          FROM ${schema === "main" ? "main" : `"${schema}"`}.sqlite_master
          WHERE name = ?
          LIMIT 1;
        `;

        const startTime = Date.now();
        const definitionRes = await runQuery(currentConnectionString, sqliteDefinitionSql, [table]);
        addHistoryEntry({
          query: `-- Copy SQLite definition for "${schema}"."${table}"`,
          duration: definitionRes.data?.executionTime || (Date.now() - startTime),
          status: definitionRes.success ? "success" : "error",
          error: definitionRes.error,
          caller: "system",
        });

// fallow-ignore-next-line code-duplication
        if (!definitionRes.success || !definitionRes.data?.rows?.length) {
          toast.error(definitionRes.error || `Relation "${schema}"."${table}" not found`, { id: toastId });
          return;
        }

        const row = (definitionRes.data.rows as SqliteDefRow[])[0];
// fallow-ignore-next-line code-duplication
        const sql = String(row?.sql || "").trim();
        if (!sql) {
          toast.error(`No SQL definition available for "${schema}"."${table}"`, { id: toastId });
          return;
        }

        copySqlToClipboard(sql, toastId);
        return;
      }

      if (dbType === "mysql" || dbType === "clickhouse") {
        const showCreateSql = `SHOW CREATE TABLE ${quoteTableRef(schema, table)};`;
        const startTime = Date.now();
        const showRes = await runQuery(currentConnectionString, showCreateSql);
        addHistoryEntry({
          query: `-- Copy ${dbType === "clickhouse" ? "ClickHouse" : "MySQL"} definition for "${schema}"."${table}"`,
          duration: showRes.data?.executionTime || (Date.now() - startTime),
          status: showRes.success ? "success" : "error",
          error: showRes.error,
          caller: "system",
        });

// fallow-ignore-next-line code-duplication
        if (!showRes.success || !showRes.data?.rows?.length) {
          toast.error(showRes.error || `Relation "${schema}"."${table}" not found`, { id: toastId });
          return;
        }

        const row = showRes.data.rows[0] as Record<string, any>;
        const definition = row["Create Table"] || row["Create View"] || Object.values(row).find((val) => typeof val === "string");
// fallow-ignore-next-line code-duplication
        const sql = String(definition || "").trim();
        if (!sql) {
          toast.error(`No SQL definition available for "${schema}"."${table}"`, { id: toastId });
          return;
        }

        copySqlToClipboard(sql, toastId);
        return;
      }

      if (dbType === "trino") {
        const parseTrinoSchemaRef = (value: string) => {
          const trimmed = String(value || "").trim();
          if (!trimmed) return { catalog: "", schema: "" };
          const parts = trimmed.split(".").filter(Boolean);
          if (parts.length >= 2) {
            return { catalog: parts[0], schema: parts.slice(1).join(".") };
          }
          return { catalog: "", schema: trimmed };
        };
        const parsed = parseTrinoSchemaRef(schema);
        const fallbackCatalog = (() => {
          try {
            const url = new URL(currentConnectionString);
            return url.searchParams.get("catalog") || "";
          } catch {
            return "";
          }
        })();
        const fallbackSchema = (() => {
          try {
            const url = new URL(currentConnectionString);
            return url.searchParams.get("schema") || "";
          } catch {
            return "";
          }
        })();
        const catalog = parsed.catalog || fallbackCatalog;
        const schemaName = parsed.schema || fallbackSchema;
        if (!catalog || !schemaName) {
          toast.error("Missing Trino catalog or schema.", { id: toastId });
          return;
        }
        const showCreateSql = `SHOW CREATE TABLE "${catalog}"."${schemaName}"."${table}";`;
        const startTime = Date.now();
        const showRes = await runQuery(currentConnectionString, showCreateSql);
        addHistoryEntry({
          query: `-- Copy Trino definition for "${catalog}"."${schemaName}"."${table}"`,
          duration: showRes.data?.executionTime || (Date.now() - startTime),
          status: showRes.success ? "success" : "error",
          error: showRes.error,
          caller: "system",
        });

        if (!showRes.success || !showRes.data?.rows?.length) {
          toast.error(showRes.error || `Relation "${schemaName}"."${table}" not found`, { id: toastId });
          return;
        }

        const row = showRes.data.rows[0] as Record<string, any>;
        const definition = row["Create Table"] || row["Create View"] || Object.values(row).find((val) => typeof val === "string");
// fallow-ignore-next-line code-duplication
        const sql = String(definition || "").trim();
        if (!sql) {
          toast.error(`No SQL definition available for "${schemaName}"."${table}"`, { id: toastId });
          return;
        }

        const constraintsSql = `
          SELECT
            c.conname AS constraint_name,
            c.contype AS constraint_type,
            pg_get_constraintdef(c.oid, true) AS constraint_def
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1
            AND t.relname = $2
            AND c.contype IN ('p', 'u', 'f')
          ORDER BY
            CASE c.contype
              WHEN 'p' THEN 1
              WHEN 'u' THEN 2
              WHEN 'f' THEN 3
              ELSE 4
            END,
            c.conname;
        `;

        let constraintsSqlOutput = "";
        try {
          const trinoConstraintsSql = `
            SELECT
              tc.constraint_name,
              tc.constraint_type,
              kcu.column_name,
              kcu.ordinal_position,
              kcu.position_in_unique_constraint,
              rcu.table_schema AS referenced_table_schema,
              rcu.table_name AS referenced_table_name,
              rcu.column_name AS referenced_column_name
            FROM "${catalog}".information_schema.table_constraints tc
            JOIN "${catalog}".information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            LEFT JOIN "${catalog}".information_schema.referential_constraints rc
              ON rc.constraint_name = tc.constraint_name
             AND rc.constraint_schema = tc.constraint_schema
            LEFT JOIN "${catalog}".information_schema.key_column_usage rcu
              ON rc.unique_constraint_name = rcu.constraint_name
             AND rc.unique_constraint_schema = rcu.constraint_schema
             AND kcu.position_in_unique_constraint = rcu.ordinal_position
            WHERE tc.table_schema = '${schemaName.replace(/'/g, "''")}'
              AND tc.table_name = '${table.replace(/'/g, "''")}'
              AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
            ORDER BY tc.constraint_name, kcu.ordinal_position;
          `;
          const consRes = await runQuery(currentConnectionString, trinoConstraintsSql);
          if (consRes.success && consRes.data?.rows?.length) {
            type ConsRow = {
              constraint_name: string;
              constraint_type: string;
              column_name: string;
              referenced_table_schema?: string | null;
              referenced_table_name?: string | null;
              referenced_column_name?: string | null;
            };
            const rows = consRes.data.rows as ConsRow[];
            const grouped = rows.reduce((acc, row) => {
              const key = `${row.constraint_name}::${row.constraint_type}`;
              if (!acc[key]) acc[key] = { name: row.constraint_name, type: row.constraint_type, cols: [], refs: [] as string[] };
              acc[key].cols.push(row.column_name);
              if (row.constraint_type === "FOREIGN KEY" && row.referenced_table_name && row.referenced_column_name) {
                acc[key].refs.push(`"${row.referenced_table_schema}"."${row.referenced_table_name}"("${row.referenced_column_name}")`);
              }
              return acc;
            }, {} as Record<string, { name: string; type: string; cols: string[]; refs: string[] }>);

            const alterLines = Object.values(grouped).map((c) => {
              const cols = c.cols.map((col) => `"${col}"`).join(", ");
              if (c.type === "PRIMARY KEY") {
                return `ALTER TABLE "${catalog}"."${schemaName}"."${table}" ADD CONSTRAINT "${c.name}" PRIMARY KEY (${cols});`;
              }
              if (c.type === "UNIQUE") {
                return `ALTER TABLE "${catalog}"."${schemaName}"."${table}" ADD CONSTRAINT "${c.name}" UNIQUE (${cols});`;
              }
              if (c.type === "FOREIGN KEY") {
                const ref = c.refs[0] || "";
                return `ALTER TABLE "${catalog}"."${schemaName}"."${table}" ADD CONSTRAINT "${c.name}" FOREIGN KEY (${cols}) REFERENCES ${ref};`;
              }
              return "";
            }).filter(Boolean);

            if (alterLines.length) {
              constraintsSqlOutput = `\n\n-- Constraints\n${alterLines.join("\n")}`;
            }
          }
        } catch {
          // Ignore constraint enrichment if not supported by connector
        }

        await navigator.clipboard.writeText(`${sql.endsWith(";") ? sql : `${sql};`}${constraintsSqlOutput}`);
        toast.success("Copied", { id: toastId });
        return;
      }

      if (dbType === "mssql") {
        type ColumnRow = {
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        };

        const columnSql = `
          SELECT
            COLUMN_NAME AS column_name,
            DATA_TYPE AS data_type,
            IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION;
        `;
        const startTime = Date.now();
        const columnRes = await runQuery(currentConnectionString, columnSql, [schema, table]);
        addHistoryEntry({
          query: `-- Copy SQL Server definition for "${schema}"."${table}"`,
          duration: columnRes.data?.executionTime || (Date.now() - startTime),
          status: columnRes.success ? "success" : "error",
          error: columnRes.error,
          caller: "system",
        });

        if (!columnRes.success || !columnRes.data?.rows?.length) {
          toast.error(columnRes.error || `Relation "${schema}"."${table}" not found`, { id: toastId });
          return;
        }

        const columns = (columnRes.data.rows as ColumnRow[]).map((col) => {
          let def = `  ${quoteIdentifier(col.column_name)} ${col.data_type}`;
          if (String(col.is_nullable || "").toUpperCase() === "NO") def += " NOT NULL";
          if (col.column_default) def += ` DEFAULT ${col.column_default}`;
          return def;
        });

        const sql = `CREATE TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (\n${columns.join(",\n")}\n);`;
        await navigator.clipboard.writeText(sql);
        toast.success("Copied", { id: toastId });
        return;
      }

      type RelationMetaRow = {
        relkind: "r" | "p" | "v" | "m" | "f" | string;
      };
      type ColumnRow = {
        column_name: string;
        data_type: string;
        not_null: boolean;
        column_default: string | null;
      };
      type ConstraintRow = {
        constraint_name: string;
        constraint_type: string;
        constraint_def: string;
      };
      type ViewDefRow = {
        definition: string;
      };

      const relationMetaSql = `
        SELECT c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relname = $2
        LIMIT 1;
      `;
      const viewDefSql = `
        SELECT pg_get_viewdef(c.oid, true) AS definition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relname = $2
        LIMIT 1;
      `;

      const columnSql = `
        SELECT
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          a.attnotnull AS not_null,
          pg_get_expr(ad.adbin, ad.adrelid) AS column_default
        FROM pg_attribute a
        JOIN pg_class t ON t.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = $1
          AND t.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum;
      `;
      const constraintsSql = `
        SELECT
          c.conname AS constraint_name,
          c.contype AS constraint_type,
          pg_get_constraintdef(c.oid, true) AS constraint_def
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1
          AND t.relname = $2
          AND c.contype IN ('p', 'u', 'f')
        ORDER BY
          CASE c.contype
            WHEN 'p' THEN 1
            WHEN 'u' THEN 2
            WHEN 'f' THEN 3
            ELSE 4
          END,
          c.conname;
      `;

      const startTime = Date.now();
      const relationMetaRes = await runQuery(currentConnectionString, relationMetaSql, [schema, table]);

      if (!relationMetaRes.success || !relationMetaRes.data?.rows?.length) {
        const error = relationMetaRes.error || `Relation "${schema}"."${table}" not found`;
        addHistoryEntry({
          query: `-- Copy table schema for "${schema}"."${table}"`,
          duration: relationMetaRes.data?.executionTime || (Date.now() - startTime),
          status: 'error',
          error,
          caller: 'system'
        });
        toast.error(error, { id: toastId });
        return;
      }

      const relkind = (relationMetaRes.data.rows as RelationMetaRow[])[0]?.relkind;
      if (relkind === "v" || relkind === "m") {
        const viewDefRes = await runQuery(currentConnectionString, viewDefSql, [schema, table]);
        addHistoryEntry({
          query: `-- Copy view definition for "${schema}"."${table}"`,
          duration: (relationMetaRes.data?.executionTime || 0) + (viewDefRes.data?.executionTime || 0) || (Date.now() - startTime),
          status: viewDefRes.success ? 'success' : 'error',
          error: viewDefRes.error,
          caller: 'system'
        });
        if (viewDefRes.success && viewDefRes.data?.rows?.length) {
          const definition = ((viewDefRes.data.rows as ViewDefRow[])[0]?.definition || "").trim();
          const createSql = relkind === "m"
            ? `CREATE MATERIALIZED VIEW "${schema}"."${table}" AS\n${definition};`
            : `CREATE VIEW "${schema}"."${table}" AS\n${definition};`;
          await navigator.clipboard.writeText(createSql);
          toast.success("Copied", { id: toastId });
        } else {
          toast.error(viewDefRes.error || "Failed to copy table definition", { id: toastId });
        }
        return;
      }

      const [columnsRes, constraintsRes] = await Promise.all([
        runQuery(currentConnectionString, columnSql, [schema, table]),
        runQuery(currentConnectionString, constraintsSql, [schema, table]),
      ]);

      addHistoryEntry({
        query: `-- Copy table schema for "${schema}"."${table}"`,
        duration: (columnsRes.data?.executionTime || 0) + (constraintsRes.data?.executionTime || 0) || (Date.now() - startTime),
        status: columnsRes.success && constraintsRes.success ? 'success' : 'error',
        error: columnsRes.error || constraintsRes.error,
        caller: 'system'
      });

      if (columnsRes.success && columnsRes.data && constraintsRes.success && constraintsRes.data) {
        const columns = (columnsRes.data.rows as ColumnRow[]).map((col) => {
          let def = `  ${quoteIdentifier(col.column_name)} ${col.data_type}`;
          if (col.not_null) def += ' NOT NULL';
          if (col.column_default) def += ` DEFAULT ${col.column_default}`;
          return def;
        });

        const constraints = (constraintsRes.data.rows as ConstraintRow[]).map((constraint) =>
          `  CONSTRAINT ${quoteIdentifier(constraint.constraint_name)} ${constraint.constraint_def}`
        );

        const createSql = `CREATE TABLE ${quoteTableRef(schema, table)} (\n${[...columns, ...constraints].join(',\n')}\n);`;
        await navigator.clipboard.writeText(createSql);
        toast.success("Copied", { id: toastId });
      } else {
        toast.error(columnsRes.error || constraintsRes.error || "Failed to copy table definition", { id: toastId });
      }
    } catch (err) {
      console.error("Failed to copy table schema:", err);
      toast.error(dbType === "mongodb" ? "Failed to copy collection definition" : "Failed to copy table definition", { id: toastId });
    }
  }, [currentConnectionString, dbType, addHistoryEntry, quoteIdentifier, quoteTableRef]);

  const copyFunctionSchema = useCallback(async (func: { name: string; arguments?: string; definition?: string; return_type?: string; language?: string; type?: string; schema?: string }, mode?: 'signature' | 'definition' | 'declaration') => {
    const toastId = toast.loading("Copying function definition...");
    try {
      let text = '';
      if (mode === 'signature') {
        text = `${func.name}(${func.arguments || ''})`;
      } else if (mode === 'declaration') {
        const args = func.arguments || '';
        const isProcedure = func.type === 'PROCEDURE';
        const schema = func.schema || 'public';
        const qualified = `"${schema}"."${func.name}"`;
        const returns = func.return_type && !isProcedure ? `\nRETURNS ${func.return_type}` : '';
        const lang = func.language ? `\nLANGUAGE ${func.language}` : '';
        const body = func.definition || '';
        text = `CREATE OR REPLACE FUNCTION ${qualified}(${args})${returns}${lang}\nAS $$\n${body}\n$$;`;
      } else {
        text = func.definition || func.name;
      }
      await navigator.clipboard.writeText(text);
      toast.success("Copied", { id: toastId });
    } catch (err) {
      console.error("Failed to copy function definition:", err);
      toast.error("Failed to copy", { id: toastId });
    }
  }, []);

  const copyTriggerSchema = useCallback(async (trigger: { name: string; definition?: string }) => {
    const toastId = toast.loading("Copying trigger definition...");
    try {
      await navigator.clipboard.writeText(trigger.definition || trigger.name);
      toast.success("Copied", { id: toastId });
    } catch (err) {
      console.error("Failed to copy trigger definition:", err);
      toast.error("Failed to copy trigger definition", { id: toastId });
    }
  }, []);

  const copyIndexSchema = useCallback(async (index: { name: string; definition?: string }) => {
    const toastId = toast.loading("Copying index definition...");
    try {
      await navigator.clipboard.writeText(index.definition || index.name);
      toast.success("Copied", { id: toastId });
    } catch (err) {
      console.error("Failed to copy index definition:", err);
      toast.error("Failed to copy index definition", { id: toastId });
    }
  }, []);

  const copyEnumSchema = useCallback(async (enumItem: { name: string; values?: string[]; schema?: string }) => {
    const toastId = toast.loading("Copying enum definition...");
    try {
      const values = (enumItem.values || []).map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      const ddl = `CREATE TYPE "${enumItem.schema || "public"}"."${enumItem.name}" AS ENUM (${values});`;
      await navigator.clipboard.writeText(ddl);
      toast.success("Copied enum definition", { id: toastId });
    } catch (err) {
      console.error("Failed to copy enum definition:", err);
      toast.error("Failed to copy enum definition", { id: toastId });
    }
  }, []);

  const withTableMutation = useCallback(async (opts: {
    reviewAction?: { type: string; description: string; sql: string; metadata: Record<string, unknown> };
    fetchTablesAfter?: string;
    fn: () => Promise<{ success: boolean; error?: string; data?: any }>;
    fallbackError: string;
  }) => {
    if (opts.reviewAction && addReviewAction(opts.reviewAction)) return;
    setMutationLoading(true);
    if (opts.fetchTablesAfter) setFetchingTables(true);
    try {
      const res = await opts.fn();
      if (res.success) {
        if (opts.fetchTablesAfter) {
          const updatedTables = await fetchTables(currentConnectionString, opts.fetchTablesAfter);
          if (updatedTables.success && updatedTables.data) {
            setTables(updatedTables.data);
          }
        }
      } else {
        setError(res.error || opts.fallbackError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : opts.fallbackError);
    } finally {
      setMutationLoading(false);
      if (opts.fetchTablesAfter) setFetchingTables(false);
    }
  }, [addReviewAction, fetchTables, currentConnectionString, setTables, setMutationLoading, setFetchingTables, setError]);

  const duplicateTable = useCallback(async (table: string, schema: string) => {
    const newName = `${table}_copy_${Date.now().toString().slice(-4)}`;
    const actionQuery = dbType === "mongodb"
      ? JSON.stringify({
        operation: "cloneCollection",
        database: schema,
        collection: table,
        targetCollection: newName,
      }, null, 2)
      : dbType === "mssql"
        ? `SELECT * INTO ${quoteTableRef(schema, newName)} FROM ${quoteTableRef(schema, table)};`
        : `CREATE TABLE ${quoteTableRef(schema, newName)} AS SELECT * FROM ${quoteTableRef(schema, table)};`;
    await withTableMutation({
      reviewAction: { type: 'duplicate_table', description: dbType === "mongodb" ? `Duplicate collection ${schema}.${table} to ${newName}` : `Duplicate table ${schema}.${table} to ${newName}`, sql: actionQuery, metadata: (dbType === "mongodb" ? { database: schema, collection: table, newName } : { schema, table, newName }) as Record<string, unknown> },
      fetchTablesAfter: schema,
      fn: () => runQueryWithTracking(actionQuery),
      fallbackError: dbType === "mongodb" ? "Failed to duplicate collection" : "Failed to duplicate table",
    });
  }, [currentConnectionString, executionMode, dbType, runQueryWithTracking, quoteTableRef, withTableMutation]);

  const emptyTable = useCallback(async (table: string, schema: string) => {
    const actionQuery = dbType === "mongodb"
      ? JSON.stringify({
        operation: "deleteMany",
        database: schema,
        collection: table,
        filter: {},
      }, null, 2)
      : dbType === "sqlite"
        ? `DELETE FROM ${quoteTableRef(schema, table)};`
        : dbType === "mysql" || dbType === "clickhouse" || dbType === "mssql"
          ? `TRUNCATE TABLE ${quoteTableRef(schema, table)};`
          : `TRUNCATE TABLE ${quoteTableRef(schema, table)} RESTART IDENTITY CASCADE;`;
    await withTableMutation({
      reviewAction: { type: 'empty_table', description: dbType === "mongodb" ? `Empty collection ${schema}.${table}` : `Empty table ${schema}.${table}`, sql: actionQuery, metadata: (dbType === "mongodb" ? { database: schema, collection: table } : { schema, table }) as Record<string, unknown> },
      fn: async () => {
        const res = await runQueryWithTracking(actionQuery);
        if (res.success && selectedTable === table && selectedSchema === schema) {
          applyOptimisticTableClear(schema, table);
          refreshTableData(table, schema);
        }
        return res;
      },
      fallbackError: dbType === "mongodb" ? "Failed to empty collection" : "Failed to empty table",
    });
  }, [currentConnectionString, selectedTable, selectedSchema, refreshTableData, runQueryWithTracking, executionMode, dbType, applyOptimisticTableClear, quoteTableRef, withTableMutation]);

  const deleteTable = useCallback(async (table: string, schema: string) => {
    const actionQuery = dbType === "mongodb"
      ? JSON.stringify({
        operation: "dropCollection",
        database: schema,
        collection: table,
      }, null, 2)
      : dbType === "sqlite" || dbType === "mysql" || dbType === "clickhouse" || dbType === "mssql"
        ? `DROP TABLE ${quoteTableRef(schema, table)};`
        : `DROP TABLE ${quoteTableRef(schema, table)} CASCADE;`;
    await withTableMutation({
      reviewAction: { type: 'delete_table', description: dbType === "mongodb" ? `Delete collection ${schema}.${table}` : `Delete table ${schema}.${table}`, sql: actionQuery, metadata: (dbType === "mongodb" ? { database: schema, collection: table } : { schema, table }) as Record<string, unknown> },
      fetchTablesAfter: schema,
      fn: async () => {
        const res = await runQueryWithTracking(actionQuery);
        if (res.success) {
          if (selectedTable === table && selectedSchema === schema) {
            setSelectedTable(null);
          }
          setOpenTabs(prev => prev.filter(t => !(t.type === "table" && t.schema === schema && t.name === table)));
        }
        return res;
      },
      fallbackError: dbType === "mongodb" ? "Failed to delete collection" : "Failed to delete table",
    });
  }, [currentConnectionString, selectedTable, selectedSchema, executionMode, dbType, runQueryWithTracking, quoteTableRef, withTableMutation]);

  const openSnippet = useCallback((s: Snippet) => {
    const tabId = `sql-${s.id}`;
    const existingTab = openTabs.find(t => t.id === tabId);

    if (!existingTab) {
      const newTab = {
        id: tabId,
        type: 'sql' as const,
        name: s.name,
        query: s.query
      };

      const newTabs = buildNewTabs(newTab, undefined, true);
      setOpenTabs(newTabs);
      switchTab(tabId, newTabs);
    } else {
      if (existingTab.isPreview) confirmPreviewTab(tabId);
      switchTab(tabId);
    }
  }, [openTabs, activeTabId, switchTab]);

  const openSqlEditor = useCallback((table?: string, schema?: string, initialQuery?: string) => {
    const targetPaneId = getCurrentPaneId();
    const baseTabId = `sql-new-${uid()}`;
    const tabId = splitView.enabled ? `${baseTabId}::pane::${targetPaneId}` : baseTabId;
    
    const defaultQuery = initialQuery ?? (dbType === "mongodb"
      ? `db.${table || "collection"}.find({}).limit(100)`
      : dbType === "redis"
        ? "PING"
        : table && schema
          ? `SELECT * FROM ${quoteTableRef(schema, table)} LIMIT 100`
          : "");
    const newTab = {
      id: tabId,
      type: 'sql' as const,
      name: dbType === "mongodb" ? "New JSON Query" : (dbType === "redis" ? "New Command" : "New Query"),
      query: defaultQuery
    };

    const newTabs = buildNewTabs(newTab);

    setError(null);
    setResults(null);
    setExecutionTime(0);
    setSelectedRows(new Set());
    setSelectedCell(null);

    setOpenTabs(newTabs);
    
    if (splitView.enabled) {
      setSplitView((prev) => {
        const next = assignTabToPane(prev, tabId, targetPaneId, true);
        return { ...next, activePaneId: targetPaneId };
      });
    }
    
    switchTab(tabId, newTabs, targetPaneId);
  }, [openTabs, activeTabId, switchTab, dbType, currentDatabase, currentConnectionString, splitView.enabled, getCurrentPaneId, assignTabToPane, quoteIdentifier]);

  const openRedisCommandForKey = useCallback((key: string, type: string) => {
    if (dbType !== "redis") return;
    const command = getRedisKeyCommand(key, type);
    openSqlEditor(undefined, undefined, command);
  }, [dbType, openSqlEditor]);

  const openSpacetimeDbTab = useCallback((tabId: string, name: string) => {
    if (dbType !== "spacetimedb") return;
    const existingTab = openTabs.find(t => t.id === tabId);
    if (existingTab) {
      switchTab(tabId);
    } else {
      const targetPaneId = getCurrentPaneId();
      const newTab = { id: tabId, type: tabId as any, name } as StudioInitialTab;
      addTabAndSwitch(newTab, tabId, targetPaneId);
    }
  }, [dbType, openTabs, switchTab, getCurrentPaneId, addTabAndSwitch]);

  const openSpacetimeDbReducers = useCallback(() => openSpacetimeDbTab("database-spacetimedb-reducers", "Reducers"), [openSpacetimeDbTab]);
  const openSpacetimeDbLogs = useCallback(() => openSpacetimeDbTab("database-spacetimedb-logs", "Logs"), [openSpacetimeDbTab]);
  const openSpacetimeDbSchema = useCallback(() => openSpacetimeDbTab("database-spacetimedb-schema", "Raw Schema"), [openSpacetimeDbTab]);

  const createRedisKey = useCallback(async (input: RedisCreateKeyInput) => {
    if (dbType !== "redis") return false;
    if (!currentConnectionString) {
      toast.error("No Redis connection available.");
      return false;
    }
    try {
      const commands = buildRedisCreateCommands(input);
      if (addReviewAction(commands.map((command) => ({ type: "redis_command" as const, description: `Redis: ${command}`, sql: command, metadata: { redisDb: selectedSchema || null, key: input.key, kind: "create_key" } })))) {
        return true;
      }

      for (const command of commands) {
        const res: SqlEditorRunQueryResult = await runQuery(currentConnectionString, command);
        if (!res.success) throw new Error(res.error || "Redis command failed.");
      }
      toast.success(`Created key ${input.key}.`);
      await refreshTablesSidebar();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create Redis key.");
      return false;
    }
  }, [dbType, currentConnectionString, executionMode, selectedSchema, runQuery, refreshTablesSidebar, setPendingActions, setIsReviewSheetOpen]);

  const toggleRowSelection = useToggleRowSelection(setSelectedRows);

  const toggleAllSelection = useCallback(() => {
    setSelectedRows(prev => {
      const rowCount = results?.rows?.length ?? 0;
      if (prev.size === rowCount) return new Set();
      return new Set((results?.rows ?? []).map((_: any, i: number) => i));
    });
  }, [results?.rows?.length]);

  const exportData = useCallback((format: 'json' | 'csv' | 'sql') => {
    const rows = results?.rows ?? [];
    const data = filterDataForExport(rows, selectedRows);
    if (!data) return;
    let content = '';
    const filename = `${selectedTable || 'query_results'}.${format}`;
    if (format === 'json') content = JSON.stringify(data, null, 2);
    else if (format === 'csv') {
      const headers = Object.keys(data[0] || {})
        .map((key) => formatDelimitedValue(key, ','))
        .join(',');
      const csvRows = data.map((r: any) =>
        Object.values(r).map((v) => formatDelimitedValue(v, ',')).join(',')
      ).join('\n');
      content = `${headers}\n${csvRows}`;
    } else if (format === 'sql') {
      if (!selectedTable) {
        toast.error("SQL export requires a selected table.");
        return;
      }
      content = data.map((r: any) => {
        const cols = Object.keys(r).map((col) => quoteIdentifier(col)).join(', ');
        const vals = Object.values(r).map((v) => formatSqlLiteral(v)).join(', ');
        return `INSERT INTO ${quoteTableRef(selectedSchema, selectedTable)} (${cols}) VALUES (${vals});`;
      }).join('\n');
    }
    downloadFile(content, filename);
  }, [results, selectedRows, selectedTable, selectedSchema, quoteIdentifier, quoteTableRef]);

  const copyRowData = useCallback((row: any, format: 'json' | 'csv') => {
    let content = '';
    if (format === 'json') {
      content = JSON.stringify(row, null, 2);
    } else if (format === 'csv') {
      const headers = Object.keys(row).map((key) => formatDelimitedValue(key, ',')).join(',');
      const values = Object.values(row).map((v) => formatDelimitedValue(v, ',')).join(',');
      content = `${headers}\n${values}`;
    }
    navigator.clipboard.writeText(content);
    toast.success(`Row copied as ${format.toUpperCase()}`);
  }, []);

  const onCopyRowJSON = useCallback((row: any) => copyRowData(row, 'json'), [copyRowData]);
  const onCopyRowCSV = useCallback((row: any) => copyRowData(row, 'csv'), [copyRowData]);

  const copyData = useCallback(async (format: 'json' | 'csv' | 'sql') => {
    const rows = results?.rows ?? [];
    const fields = results?.fields ?? [];
    const data = filterDataForExport(rows, selectedRows, "No data available to copy.", "No rows selected to copy.");
    if (!data) return;
    let content = '';
    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
    } else if (format === 'csv') {
      const headers = fields.map((f: any) => formatDelimitedValue(f.name, '\t')).join('\t');
      const rows = data.map((row: any) =>
        fields.map((f: any) => formatDelimitedValue(row[f.name], '\t')).join('\t')
      );
      content = [headers, ...rows].join('\n');
    } else if (format === 'sql') {
      const tableName = selectedTable || 'exported_table';
      content = data.map((row: any) => {
        const columns = fields.map((f: any) => quoteIdentifier(f.name)).join(', ');
        const values = fields.map((f: any) => formatSqlLiteral(row[f.name])).join(', ');
        return `INSERT INTO ${quoteTableRef(selectedSchema, tableName)} (${columns}) VALUES (${values});`;
      }).join('\n');
    }
    await navigator.clipboard.writeText(content);
  }, [results, selectedRows, selectedTable, selectedSchema, quoteIdentifier, quoteTableRef]);

  const handleExportDatabaseBundle = useCallback(async (format: "sql" | "json" | "csv") => {
    setIsImportExportLoading(true);
    setImportExportProgress({
      title: `Exporting ${format.toUpperCase()}`,
      steps: ["Preparing export", "Generating bundle", "Downloading file"],
      currentStep: 0
    });
    try {
      setImportExportProgress((prev) => prev ? { ...prev, currentStep: 1 } : prev);
      const res = await exportDatabaseBundle(currentConnectionString, format);
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to export database");
        return;
      }

      setImportExportProgress((prev) => prev ? { ...prev, currentStep: 2 } : prev);
      const blob = new Blob([res.data.content], { type: res.data.mimeType || "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.data.filename || `rexa-db-export-${Date.now()}.${format}`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`Database exported as ${format.toUpperCase()}`);
    } finally {
      setIsImportExportLoading(false);
      setImportExportProgress(null);
    }
  }, [currentConnectionString]);

  const handleImportDatabaseBundle = useCallback(async (file: File, format: "sql" | "json" | "csv") => {
    const confirmed = await confirm({
      title: "Import will replace current database",
      description: "This will drop existing schemas/data and rebuild from the backup file. Continue?",
      variant: "destructive",
      confirmText: "Import and Recreate"
    });
    if (!confirmed) return;

    setIsImportExportLoading(true);
    setImportExportProgress({
      title: `Importing ${format.toUpperCase()}`,
      steps: ["Reading file", "Applying backup", "Refreshing workspace"],
      currentStep: 0
    });
    try {
      const content = await file.text();
      setImportExportProgress((prev) => prev ? { ...prev, currentStep: 1 } : prev);
      const res = await importDatabaseBundle(currentConnectionString, format, content);
      if (!res.success) {
        toast.error(res.error || "Failed to import database");
        return;
      }

      setImportExportProgress((prev) => prev ? { ...prev, currentStep: 2 } : prev);
      await loadInitialDataWithConn(currentConnectionString);
      toast.success("Database imported successfully");
    } finally {
      setIsImportExportLoading(false);
      setImportExportProgress(null);
    }
  }, [confirm, currentConnectionString, loadInitialDataWithConn]);

  const handleDeleteRows = useCallback(async () => {
    if (!selectedTable || selectedRows.size === 0) return;
    const hasUnsaveable = Array.from(selectedRows).some(idx => {
      const row = results.rows[idx];
      return getRowId(row, idx)?.startsWith('idx:');
    });
    if (hasUnsaveable) {
      setError("Cannot delete: One or more rows do not have a primary key.");
      return;
    }
    setIsDeleting(true);
    try {
      const rowsToDelete = Array.from(selectedRows).map(idx => {
        const row = results.rows[idx];
        const rowId = getRowId(row, idx)!;
        const where = parseRowId(rowId);
        return where;
      });

      if (executionMode === 'review') {
        if (dbType === "mongodb") {
          addReviewAction(rowsToDelete.map((where) => ({
            type: 'delete_row' as const,
            description: `Delete document from ${selectedSchema}.${selectedTable}`,
            sql: JSON.stringify({
              operation: "deleteMany",
              database: selectedSchema,
              collection: selectedTable,
              filter: where,
            }, null, 2),
            metadata: { database: selectedSchema, collection: selectedTable, where }
          })));
          setSelectedRows(new Set());
          return;
        }

        const sqls = rowsToDelete.map(where => {
          const whereClause = Object.entries(where)
            .map(([col, val]) => `${quoteIdentifier(col)} = ${typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : val}`)
            .join(' AND ');
          return `DELETE FROM ${quoteTableRef(selectedSchema, selectedTable)} WHERE ${whereClause};`;
        });

        addReviewAction(sqls.map((sql, i) => ({
          type: 'delete_row' as const,
          description: `Delete row from ${selectedSchema}.${selectedTable}`,
          sql,
          metadata: { schema: selectedSchema, table: selectedTable, where: rowsToDelete[i] }
        })));
        setSelectedRows(new Set());
        return;
      }

      const res = await deleteTableRows(currentConnectionString, selectedSchema, selectedTable, rowsToDelete);
      if (res.success) {
        applyOptimisticRowDeletes(selectedSchema, selectedTable, rowsToDelete);
        setSelectedRows(new Set());
        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig);
      } else {
        setError(res.error || "Failed to delete rows");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rows");
    } finally {
      setIsDeleting(false);
    }
  }, [selectedTable, selectedRows, results, getRowId, executionMode, selectedSchema, currentConnectionString, refreshTableData, filterQuery, sortConfig, dbType, applyOptimisticRowDeletes, quoteIdentifier, quoteTableRef]);

  const buildInsertSql = (columnsSql: string, count: number) => {
    const returnClause = (isMysql || isClickhouse) ? "" : (isMssql ? " OUTPUT INSERTED.*" : " RETURNING *");
    return `INSERT INTO ${quoteTableRef(selectedSchema!, selectedTable!)} (${columnsSql}) VALUES (${buildPlaceholders(count)})${returnClause};`;
  };

  const handleDuplicateRow = useCallback(async (row: any) => {
    if (!selectedTable || !selectedSchema) return;
    setMutationLoading(true);
    try {
      if (dbType === "mongodb") {
        const duplicate = { ...row };
        delete duplicate._id;
        if (addReviewAction({ type: 'duplicate_row', description: `Duplicate document in ${selectedSchema}.${selectedTable}`, sql: JSON.stringify({ operation: "insertOne", database: selectedSchema, collection: selectedTable, document: duplicate }, null, 2), metadata: { database: selectedSchema, collection: selectedTable, document: duplicate } })) return;

        const command = JSON.stringify({
          operation: "insertOne",
          database: selectedSchema,
          collection: selectedTable,
          document: duplicate,
        }, null, 2);
        const res = await runQuery(currentConnectionString, command);
        if (res.success) {
          applyOptimisticRowInsertions(selectedSchema, selectedTable, [duplicate as Record<string, unknown>]);
          refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page);
        } else {
          setError(res.error || "Failed to duplicate row");
        }
        return;
      }

      // Filter out primary keys that are auto-incrementing/identity
      const columnsToInsert = tableStructure
        .filter(col => {
          // If it's not a PK, we always include it
          if (!col.is_primary_key) return true;
          // If it is a PK, only include it if it doesn't have a default value (like serial/identity)
          // This is a bit of a heuristic, but usually PKs with defaults shouldn't be manually inserted
          return !col.column_default;
        })
        .map(col => col.column_name);

      if (columnsToInsert.length === 0) {
        throw new Error("No columns to duplicate");
      }

      const columns = columnsToInsert.map((k) => quoteIdentifier(k)).join(', ');
      const data = columnsToInsert.map(k => row[k]);
      const sql = buildInsertSql(columns, columnsToInsert.length);

      if (addReviewAction({ type: 'duplicate_row', description: `Duplicate row in ${selectedSchema}.${selectedTable}`, sql, params: data, metadata: { schema: selectedSchema, table: selectedTable, data } })) return;

      const startTime = Date.now();
      const res = await runQuery(currentConnectionString, sql, data);

      addQueryHistoryEntry(sql, res, startTime);

      if (res.success) {
        const insertedRows = (res.data?.rows || []) as Array<Record<string, unknown>>;
        if (insertedRows.length > 0) {
          applyOptimisticRowInsertions(selectedSchema, selectedTable, insertedRows);
        }
        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page);
      } else {
        setError(res.error || "Failed to duplicate row");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate row");
    } finally {
      setMutationLoading(false);
    }
  }, [selectedTable, selectedSchema, tableStructure, executionMode, currentConnectionString, addHistoryEntry, refreshTableData, filterQuery, sortConfig, pageSize, page, dbType, applyOptimisticRowInsertions, quoteIdentifier, quoteTableRef, buildPlaceholders, isSpacetimedb, isMysql, isClickhouse, isMssql]);

  const handleInsertRow = useCallback(async () => {
    if (!selectedTable) return;
    const validData = Object.entries(insertData).filter(([_, v]) => v !== "");
    if (validData.length === 0) {
      setError("Please enter at least one value to insert.");
      return;
    }
    if (dbType === "mongodb") {
      const document = Object.fromEntries(validData);
      if (addReviewAction({ type: 'insert_row' as const, description: `Insert document into ${selectedSchema}.${selectedTable}`, sql: JSON.stringify({ operation: "insertOne", database: selectedSchema, collection: selectedTable, document }, null, 2), metadata: { database: selectedSchema, collection: selectedTable, document } })) {
        setIsInsertSheetOpen(false);
        setInsertData({});
        return;
      }

      setMutationLoading(true);
      const command = JSON.stringify({
        operation: "insertOne",
        database: selectedSchema,
        collection: selectedTable,
        document,
      }, null, 2);
      const res = await runQuery(currentConnectionString, command);
      if (res.success) {
        setIsInsertSheetOpen(false);
        setInsertData({});
        applyOptimisticRowInsertions(selectedSchema, selectedTable, [document as Record<string, unknown>]);
        refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig);
      } else {
        setError(res.error || "Failed to insert row");
      }
      setMutationLoading(false);
      return;
    }

    const columns = validData.map(([k]) => quoteIdentifier(k)).join(', ');
    const sql = buildInsertSql(columns, validData.length);

    if (addReviewAction({ type: 'insert_row' as const, description: `Insert row into ${selectedSchema}.${selectedTable}`, sql, params: validData.map(([_, v]) => v), metadata: { schema: selectedSchema, table: selectedTable, data: validData.map(([_, v]) => v) } })) {
      setIsInsertSheetOpen(false);
      setInsertData({});
      return;
    }

    setMutationLoading(true);
    const startTime = Date.now();
    const res = await runQuery(currentConnectionString, sql, validData.map(([_, v]) => v));

    addQueryHistoryEntry(sql, res, startTime);

    if (res.success) {
      setIsInsertSheetOpen(false);
      setInsertData({});
      const insertedRows = (res.data?.rows || []) as Array<Record<string, unknown>>;
      if (insertedRows.length > 0) {
        applyOptimisticRowInsertions(selectedSchema, selectedTable, insertedRows);
      }
      refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig);
    } else {
      setError(res.error || "Failed to insert row");
    }
    setMutationLoading(false);
  }, [selectedTable, insertData, selectedSchema, executionMode, currentConnectionString, addHistoryEntry, refreshTableData, filterQuery, sortConfig, dbType, applyOptimisticRowInsertions, quoteIdentifier, quoteTableRef, buildPlaceholders, isSpacetimedb, isMysql, isClickhouse, isMssql, tableStructure]);

  async function refreshCurrentTab() {
    if (viewMode === "dashboard") {
      console.log('[Dashboard] refreshCurrentTab called, delegating to DashboardView handleRefresh');
      return;
    }
    if (viewMode === "database") {
      if (databaseView === "schema") {
        await loadSchemaData();
        return;
      }
      if (databaseView === "tables" && selectedSchema) {
        await loadTables(true);
        return;
      }
      if (databaseView === "functions" && selectedSchema) {
        await loadFunctions();
        return;
      }
      if (databaseView === "extensions") {
        await loadExtensions();
        return;
      }
      if (databaseView === "triggers") {
        await loadTriggers();
        return;
      }
      if (databaseView === "enums") {
        await loadEnums();
        return;
      }
      if (databaseView === "indexes") {
        await loadIndexes();
        return;
      }
      if (databaseView === "rls-policies" && selectedSchema) {
        await Promise.all([loadRlsPolicies(selectedSchema), loadPostgresRoles()]);
      }
      return;
    }

    if (selectedTable && selectedSchema) {
      await refreshTableData(selectedTable, selectedSchema, filterQuery, sortConfig, pageSize, page);
      await refreshActiveTableStructure(
        currentConnectionString, selectedSchema, selectedTable,
        fetchTableStructure, fetchTableForeignKeys,
        resolveActiveTableTabId, updateTableStructureCache,
      );
    }
  }

  const handleSetViewMode = useCallback((mode: "tables" | "sql" | "code" | "database" | "dashboard" | "create-table" | "create-key" | "create-enum" | "create-index" | "create-trigger" | "create-schema" | "create-database" | "import-export" | "settings" | "agent-settings" | "profile-settings" | "keybindings" | "history" | "analytics" | "advisor" | "auth" | "rls-policy-edit" | "connect-studio" | "manage-workspaces" | "snapshots" | "snapshot-table" | "diff-table" | "workflow") => {
    if (mode === "create-enum" && !createSupport.enum) {
      toast.error("Create Enum is supported only for PostgreSQL connections.");
      return;
    }
    if (mode === "create-index" && !createSupport.index) {
      toast.error("Create Index is supported only for PostgreSQL connections.");
      return;
    }
    if (mode === "create-trigger" && !createSupport.trigger) {
      toast.error("Create Trigger is supported only for PostgreSQL connections.");
      return;
    }
    if (mode === "create-schema" && !createSupport.schema) {
      toast.error("Create Schema is supported only for PostgreSQL connections.");
      return;
    }
    if (mode === "create-database" && !createSupport.database) {
      toast.error("Create Database is not supported for this connection type.");
      return;
    }
    setViewMode(mode);
    const params = new URLSearchParams(searchParams.toString());
    if (mode === 'database') {
      params.set('view', 'database');
      params.delete('tab');
      params.delete('s');
      params.delete('t');
    } else if (mode === 'dashboard') {
      params.set('view', 'dashboard');
      params.delete('tab');
      params.delete('s');
      params.delete('t');
    } else if (mode === 'import-export') {
      params.set('view', 'import-export');
      params.delete('tab');
      params.delete('s');
      params.delete('t');
    } else if (mode === 'settings') {
      params.delete('view');
      params.set('tab', 'settings');
    } else if (mode === 'agent-settings') {
      params.delete('view');
      params.set('tab', 'settings');
    } else if (mode === 'profile-settings') {
      params.delete('view');
      params.set('tab', 'profile-settings');
    } else if (mode === 'keybindings') {
      params.delete('view');
      params.set('tab', 'keybindings');
    } else if (mode === 'history') {
      params.delete('view');
      params.set('tab', 'history');
    } else if (mode === 'create-table') {
      params.delete('view');
      params.set('tab', 'create-table');
    } else if (mode === 'create-enum') {
      params.delete('view');
      params.set('tab', 'create-enum');
    } else if (mode === 'create-index') {
      params.delete('view');
      params.set('tab', 'create-index');
    } else {
      params.delete('view');
    }
    const nextSearch = params.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) return;

    if (typeof window !== "undefined") {
      const nextUrl = `${pathname}?${nextSearch}`;
      window.history.replaceState(window.history.state, "", nextUrl);
      return;
    }

    router.replace(`${pathname}?${nextSearch}`);
  }, [searchParams, pathname, router]);

  const openDatabaseTab = useCallback((type: 'schema' | 'tables' | 'functions' | 'extensions' | 'triggers' | 'enums' | 'indexes' | 'rls-policies' | 'sessions' | 'locks' | 'explain-plan' | 'backup-restore') => {
    if (dbType !== "postgres" && dbType !== "supabase-mgmt" && ["functions", "extensions", "triggers", "enums", "indexes", "rls-policies", "sessions", "locks"].includes(type)) {
      toast.error("That database view is supported only for PostgreSQL connections.");
      return;
    }
    const tabId = `database-${type}`;
    const nameMap = {
      'schema': 'Schema Diagram',
      'tables': dbType === "mongodb" ? 'Collections List' : 'Tables List',
      'functions': 'Functions',
      'extensions': 'Extensions',
      'triggers': 'Triggers',
      'enums': 'Enumerated Types',
      'indexes': 'Indexes',
      'rls-policies': 'RLS Policies',
      'sessions': 'Sessions',
      'locks': 'Locks',
      'explain-plan': 'Explain Plan',
      'backup-restore': 'Backup & Restore',
    } as const;
    const typeMap = {
      'schema': 'database-schema' as const,
      'tables': 'database-tables' as const,
      'functions': 'database-functions' as const,
      'extensions': 'database-extensions' as const,
      'triggers': 'database-triggers' as const,
      'enums': 'database-enums' as const,
      'indexes': 'database-indexes' as const,
      'rls-policies': 'database-rls-policies' as const,
      'sessions': 'database-sessions' as const,
      'locks': 'database-locks' as const,
      'explain-plan': 'database-explain-plan' as const,
      'backup-restore': 'database-backup-restore' as const,
    };

    const existingTab = openTabs.find(t => t.id === tabId);
    if (!existingTab) {
      const newTab = {
        id: tabId,
        type: typeMap[type],
        name: nameMap[type]
      };

      addTabAndSwitch(newTab, tabId);
    } else {
      switchTab(tabId);
    }
  }, [openTabs, activeTabId, switchTab, dbType]);

  const viewTableSchema = useCallback((tableName: string) => {
    setSchemaHighlightedTable(tableName);
    openDatabaseTab('schema');
  }, [openDatabaseTab]);

  const openCurrentTableRlsPolicies = useCallback(() => {
    if (!selectedTable || !selectedSchema) return;
    setRlsTableFilter(selectedTable);
    setRlsPolicyFilter("");
    loadRlsPolicies(selectedSchema, selectedTable);
    openDatabaseTab("rls-policies");
  }, [selectedTable, selectedSchema, openDatabaseTab, loadRlsPolicies]);

  const openRlsPolicyEditTab = useCallback((policy: any) => {
    const tabId = `rls-policy-edit-${policy.schema}-${policy.table_name}-${policy.name}`;
    const existingTab = openTabs.find(t => t.id === tabId);
    if (existingTab) {
      switchTab(tabId);
      return;
    }
    setRlsPolicyEditData(prev => ({ ...prev, [tabId]: { policy } }));
    const newTab = {
      id: tabId,
      type: 'rls-policy-edit' as const,
      name: `Policy: ${policy.name}`,
    };
    addTabAndSwitch(newTab, tabId);
  }, [openTabs, activeTabId, switchTab, addTabAndSwitch]);

  const openRlsPolicyCreateTab = useCallback((schema: string, table?: string) => {
    const tabId = `rls-policy-create-${schema}-${table || "new"}-${Date.now()}`;
    const existingTab = openTabs.find(t => t.id === tabId);
    if (existingTab) {
      switchTab(tabId);
      return;
    }
    setRlsPolicyEditData(prev => ({ ...prev, [tabId]: { prefillSchema: schema, prefillTable: table } }));
    const newTab = {
      id: tabId,
      type: 'rls-policy-edit' as const,
      name: 'New RLS Policy',
    };
    addTabAndSwitch(newTab, tabId);
  }, [openTabs, activeTabId, switchTab, addTabAndSwitch]);

  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId | undefined>(undefined);

  const openSettingsTab = useCallback((section?: SettingsSectionId) => {
    setSettingsInitialSection(section);
    openSimpleTab('settings', 'settings', 'Settings');
  }, [openSimpleTab]);

  const openProfileSettingsTab = useCallback(() => {
    openSimpleTab('profile-settings', 'profile-settings', 'Profile Settings');
  }, [openSimpleTab]);

  const openKeybindingsTab = useCallback(() => {
    openSimpleTab('keybindings', 'keybindings', 'Keybindings');
  }, [openSimpleTab]);

  const goToRelativeTab = useCallback((direction: "next" | "prev") => {
    if (!openTabs.length) return;
    const currentIndex = activeTabId ? openTabs.findIndex((tab) => tab.id === activeTabId) : -1;
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = (safeIndex + delta + openTabs.length) % openTabs.length;
    switchTab(openTabs[nextIndex].id);
  }, [openTabs, activeTabId, switchTab]);

  const closeActiveTabByShortcut = useCallback(() => {
    if (!activeTabId) return;
    closeTabById(activeTabId);
  }, [activeTabId, closeTabById]);

  const executeKeybindingAction = useCallback((binding: any) => {
    switch (binding.type) {
      case "NAVIGATE_TABLE":
        if (!binding.schema || !binding.table) return;
        handleSetSelectedSchema(binding.schema);
        handleTableClick(binding.table);
        break;
      case "NAVIGATE_SCHEMA":
        if (!binding.schema) return;
        handleSetSelectedSchema(binding.schema);
        openDatabaseTab("schema");
        break;
      case "NAVIGATE_DATABASE":
        if (!binding.database) return;
        handleDatabaseChange(binding.database);
        break;
      case "GO_TO_TAB_INDEX": {
        const index = Number(binding.index);
        if (!Number.isInteger(index) || index < 0) return;
        if (openTabs[index]) switchTab(openTabs[index].id);
        break;
      }
      case "GO_TO_NEXT_TAB":
        goToRelativeTab("next");
        break;
      case "GO_TO_PREVIOUS_TAB":
        goToRelativeTab("prev");
        break;
      case "CLOSE_ACTIVE_TAB":
        closeActiveTabByShortcut();
        break;
      case "OPEN_SQL_EDITOR":
        openSqlEditor();
        break;
      case "RUN_ACTIVE_QUERY":
        if (viewMode === "sql" || openTabs.find((tab) => tab.id === activeTabId)?.type === "sql") {
          void handleRunQuery();
        }
        break;
      case "STOP_ACTIVE_QUERY":
        void handleStopQuery();
        break;
      case "REFRESH_CURRENT_TAB":
        void refreshCurrentTab();
        break;
      case "COMMIT_PENDING_CHANGES":
        void handleCommitChanges();
        break;
      case "OPEN_DATABASE_VIEW":
        if (!binding.view) return;
        if (["schema", "tables", "functions", "extensions", "triggers", "enums", "indexes", "rls-policies"].includes(binding.view)) {
          openDatabaseTab(binding.view);
        }
        break;
      case "OPEN_HISTORY":
        openHistoryTab();
        break;
      case "OPEN_IMPORT_EXPORT":
        openImportExportTab();
        break;
      case "OPEN_DASHBOARD_HOME":
        openDashboardHome();
        break;
      case "OPEN_SETTINGS":
        openSettingsTab();
        break;
      case "OPEN_PROFILE_SETTINGS":
        openProfileSettingsTab();
        break;
      case "OPEN_KEYBINDINGS":
        openKeybindingsTab();
        break;
      case "OPEN_CREATE_TABLE":
        openCreateTableTab();
        break;
      case "OPEN_CREATE_ENUM":
        openCreateEnumTab();
        break;
      case "OPEN_CREATE_INDEX":
        openCreateIndexTab();
        break;
      case "OPEN_CREATE_TRIGGER":
        openCreateTriggerTab();
        break;
      case "OPEN_CREATE_SCHEMA":
        openCreateSchemaTab();
        break;
      case "OPEN_CREATE_DATABASE":
        openCreateDatabaseTab();
        break;
      case "TOGGLE_SIDEBAR":
        toggleSidebar();
        break;
      case "SET_SIDEBAR_VIEW":
        if (!binding.sidebar) return;
        if (["dashboard", "tables", "sql", "database", "import-export", "workflows"].includes(binding.sidebar)) {
          setSidebarView(binding.sidebar as any);
          setIsSidebarVisible(true);
        }
        break;
      case "TOGGLE_COMMAND_MENU":
        setIsCommandMenuOpen((prev) => !prev);
        break;
      case "FORMAT_QUERY": {
        const currentQuery = queryRef.current?.trim();
        if (!currentQuery) break;
        if (viewMode !== "sql" && openTabs.find((tab) => tab.id === activeTabId)?.type !== "sql") break;
        try {
          if (dbType === "mongodb") {
            if (currentQuery.startsWith("{") || currentQuery.startsWith("[")) {
              setQuery(JSON.stringify(JSON.parse(currentQuery), null, 2));
            }
          } else if (dbType !== "redis") {
            const dialectMap = { postgres: "postgresql", mysql: "mysql", sqlite: "sqlite", clickhouse: "clickhouse", mssql: "transactsql", trino: "trino" } as const;
            const language = dialectMap[dbType as keyof typeof dialectMap] || "postgresql";
            setQuery(formatSql(currentQuery, {
              language,
              tabWidth: sqlFormatTabWidth,
              useTabs: sqlFormatUseTabs,
              keywordCase: sqlFormatKeywordCase,
              dataTypeCase: sqlFormatDataTypeCase,
              functionCase: sqlFormatFunctionCase,
              identifierCase: sqlFormatIdentifierCase,
              logicalOperatorNewline: sqlFormatLogicalOperatorNewline,
              expressionWidth: sqlFormatExpressionWidth,
              linesBetweenQueries: sqlFormatLinesBetweenQueries,
              denseOperators: sqlFormatDenseOperators,
              newlineBeforeSemicolon: sqlFormatNewlineBeforeSemicolon,
            }));
          }
        } catch (e) {
          console.error("Failed to format query:", e);
        }
        break;
      }
      case "COPY_QUERY": {
        const currentQuery = queryRef.current?.trim();
        if (!currentQuery) break;
        if (viewMode !== "sql" && openTabs.find((tab) => tab.id === activeTabId)?.type !== "sql") break;
        navigator.clipboard.writeText(currentQuery).then(
          () => toast.success("Query copied to clipboard"),
          () => toast.error("Failed to copy query")
        );
        break;
      }
      case "OPEN_SHORTCUT_NAVIGATOR":
        setIsShortcutNavigatorOpen(true);
        break;
      case "OPEN_INSERT_SHEET": {
        const activeTab = openTabs.find((tab) => tab.id === activeTabId);
        const isTableTabActive = activeTab?.type === "table" || (viewMode === "tables" && !!selectedTable);
        if (isTableTabActive) {
          setInsertData({});
          setIsInsertSheetOpen(true);
        }
        break;
      }
      default:
        break;
    }
  }, [
    handleSetSelectedSchema,
    handleTableClick,
    openDatabaseTab,
    handleDatabaseChange,
    openTabs,
    switchTab,
    goToRelativeTab,
    closeActiveTabByShortcut,
    openSqlEditor,
    viewMode,
    activeTabId,
    handleRunQuery,
    runSqlContextQuery,
    handleStopQuery,
    stopSqlContextQuery,
    refreshCurrentTab,
    handleCommitChanges,
    openHistoryTab,
    openSnapshotsTab,
    openImportExportTab,
    openDashboardHome,
    openSettingsTab,
    openProfileSettingsTab,
    openKeybindingsTab,
    openAuthUsersTab,
    openAuthSessionsTab,
    openAuthProvidersTab,
    closeTabById,
    openCreateTableTab,
    openCreateKeyTab,
    openCreateEnumTab,
    openCreateIndexTab,
    openCreateTriggerTab,
    openCreateSchemaTab,
    openCreateDatabaseTab,
    setSidebarView,
    setIsSidebarVisible,
    toggleSidebar,
    setIsShortcutNavigatorOpen,
    setIsInsertSheetOpen,
    dbType,
    queryRef,
    setQuery,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Always support Cmd/Ctrl+Digit tab index navigation (1-based => 0-based index),
      // independent from custom keybinding entries.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        // fallow-ignore-next-line code-duplication
        const codeMatch = /^Digit([1-9])$/.exec(e.code || "");
        const keyMatch = /^([1-9])$/.exec(e.key || "");
        const digit = codeMatch?.[1] ?? keyMatch?.[1];
        if (digit) {
          const tabIndex = Number(digit) - 1;
          if (openTabs[tabIndex]) {
            e.preventDefault();
            switchTab(openTabs[tabIndex].id);
            return;
          }
        }
      }

      // Always handle tab-navigation/close shortcuts before editable guards.
      const earlyCombo = buildShortcutCombo(e);
      if (earlyCombo) {
        const earlyBinding = keybindings[earlyCombo];
        if (
          earlyBinding?.type === "CLOSE_ACTIVE_TAB"
          || earlyBinding?.type === "GO_TO_TAB_INDEX"
          || earlyBinding?.type === "GO_TO_NEXT_TAB"
          || earlyBinding?.type === "GO_TO_PREVIOUS_TAB"
          || earlyBinding?.type === "COMMIT_PENDING_CHANGES"
          || earlyBinding?.type === "RUN_ACTIVE_QUERY"
          || earlyBinding?.type === "TOGGLE_COMMAND_MENU"
          || earlyBinding?.type === "TOGGLE_SIDEBAR"
          || earlyBinding?.type === "OPEN_SQL_EDITOR"
          || earlyBinding?.type === "OPEN_SETTINGS"
          || earlyBinding?.type === "OPEN_DATABASE_VIEW"
          || earlyBinding?.type === "OPEN_SHORTCUT_NAVIGATOR"
          || earlyBinding?.type === "OPEN_INSERT_SHEET"
        ) {
          e.preventDefault();
          executeKeybindingAction(earlyBinding);
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        !!target?.isContentEditable ||
        !!target?.closest(".monaco-editor");
      const isEditableActive =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        !!activeElement?.isContentEditable ||
        !!activeElement?.closest(".monaco-editor");

      // Don't trigger if user is typing in an editable control (including Monaco SQL editor)
      if (isEditableTarget || isEditableActive) {
        return;
      }

      const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const isTableNavModifier = isMac
        ? (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey)
        : (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey);

      if (isTableNavModifier && e.key === "ArrowUp") {
        e.preventDefault();
        navigateTableSelection("up");
        return;
      }

      if (isTableNavModifier && e.key === "ArrowDown") {
        e.preventDefault();
        navigateTableSelection("down");
        return;
      }

      // Never hijack native clipboard/edit shortcuts.
      if (
        (e.metaKey || e.ctrlKey) &&
        ["A", "C", "V", "X", "Z", "Y"].includes(e.key.toUpperCase())
      ) {
        return;
      }

      const comboStr = buildShortcutCombo(e);
      if (!comboStr) return;

      if (keybindings[comboStr]) {
        const binding = keybindings[comboStr];
        e.preventDefault();
        executeKeybindingAction(binding);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keybindings, navigateTableSelection, executeKeybindingAction, openTabs, switchTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().listen("tauri://close-request", () => {
          closeActiveTabByShortcut();
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [closeActiveTabByShortcut]);

  return {
    query, setQuery,
    tables, setTables,
    viewTables, setViewTables,
    tableSecurity,
    redisKeys, setRedisKeys,
    fetchingRedisKeys, setFetchingRedisKeys,
    schemas, setSchemas,
    selectedSchema, setSelectedSchema: handleSetSelectedSchema,
    selectedTable, setSelectedTable: handleSetSelectedTable,
    tableStructure, setTableStructure,
    viewMode, setViewMode: handleSetViewMode,
    databaseView, setDatabaseView,
    results, setResults,
    tableLoading,
    tableLoadingById,
    mutationLoading,
    setMutationLoading,
    loading: tableLoading,
    executionTime,
    error, setError,
    fetchingTables, setFetchingTables,
    fetchingSchemas, setFetchingSchemas,
    isInitialLoad, setIsInitialLoad,
    fetchingStructure, setFetchingStructure,
    selectedRows, setSelectedRows,
    selectedCell, setSelectedCell,
    selectedColumn, setSelectedColumn,
    editingCell, setEditingCell,
    hiddenColumnNames, toggleColumn, showAllColumns,
    pendingChanges, setPendingChanges,
    pendingActions, setPendingActions,
    tabDataCache,
    getTableTabSnapshot,
    isReviewSheetOpen, setIsReviewSheetOpen,
    isAddColumnSheetOpen, setIsAddColumnSheetOpen,
    isAddingColumn,
    isEditColumnSheetOpen, setIsEditColumnSheetOpen,
    columnToEdit, setColumnToEdit,
    isEditingColumn,
    isAddFKSheetOpen, setIsAddFKSheetOpen,
    newFKData, setNewFKData,
    columnToDelete,
    setColumnToDelete,
    foreignKeys, setForeignKeys,
    fkPreviewRecord, setFKPreviewRecord,
    isFKSelectionSheetOpen, setIsFKSelectionSheetOpen,
    fkSelectionTarget, setFKSelectionTarget,
    fkSelectionData, setFKSelectionData,
    fkSelectionLoading, setFKSelectionLoading,
    fkSelectionSearch, setFKSelectionSearch,
    isDeleting, setIsDeleting,
    openTabs, setOpenTabs,
    activeTabId, setActiveTabId,
    splitView, setSplitView,
    createSplit,
    closePaneById,
    closeActivePane,
    setSplitRatio,
    setPaneActiveTab,
    setActivePaneId,
    activePaneIdRef,
    tags, setTags,
    tableTags, setTableTags,
    sidebarSortMode,
    setSidebarSortMode,
    sidebarView, setSidebarView,
    dashboards,
    dashboardFolders,
    setDashboards,
    setDashboardFolders,
    addTag, toggleTableTag,
    snippets, setSnippets,
    folders, setFolders,
    addSnippet, updateSnippet, deleteSnippet,
    toggleSnippetShare, sharingSnippetId, updateSnippetPermissions, createSnippetVersion, getSnippetVersions, restoreSnippetVersion,
    addFolder, updateFolder, deleteFolder, handleImportSnippets,
    isInsertSheetOpen, setIsInsertSheetOpen,
    insertData, setInsertData,
    filterQuery, setFilterQuery,
    sortConfig, setSortConfig,
    tableSearch, setTableSearch,
    refreshTablesSidebar,
    isCreatingTable, setIsCreatingTable,
    newTableData, setNewTableData,
    isCreatingEnum, setIsCreatingEnum,
    isCreatingIndex, setIsCreatingIndex,
    isCreatingTrigger, setIsCreatingTrigger,
    databases, currentDatabase, handleDatabaseChange,
    currentConnectionString,
    dbType,
    connection,
    storageMode,
    refreshCloudSnippets: loadCloudSnippets,
    receivedSharedSnippets,
    receivedSharedDashboards,
    loadReceivedSharedItems,
    workspaceId: workspaceContext.workspaceId,
    isSharedWorkspace: storageMode === "cloud",
    planCode: workspaceContext.planCode,
    isCreatingSchema, setIsCreatingSchema,
    isCreatingDatabase, setIsCreatingDatabase,
    isEditingEnum, setIsEditingEnum,
    editingEnumName, setEditingEnumName,
    newEnumData, setNewEnumData,
    getRowId,
    hasChanges,
    getChangedValue,
    handleRunQuery,
    handleStopQuery,
    runSqlContextQuery,
    stopSqlContextQuery,
    canStopQuery: !!activeTabId && !!sqlTabStates[activeTabId]?.loading && !!sqlTabStates[activeTabId]?.activeQueryId,
    sqlTabStates,
    globalSqlContextId: GLOBAL_SQL_CONTEXT_ID,
    isActiveSqlTabRunning,
    handleUpdateRow,
    refreshTableData,
    refreshCurrentTab,
    handleCommitChanges,
    handleAddColumn,
    handleDeleteColumn,
    handleEditColumn,
    handleAddForeignKey,
    handleFKPreview,
    handleFKSelection,
    handleInsertFKSelection,
    selectFKRecord,
    openHistoryTab,
    openAnalyticsTab,
    openAdvisorTab,
    openWorkflowsTab,
    openSnapshotsTab,
    openConnectStudioTab,
    openManageWorkspacesTab,
    settingsInitialSection,
    openSettingsTab,
    openProfileSettingsTab,
    openKeybindingsTab,
    openAuthUsersTab,
    openAuthSessionsTab,
    openAuthProvidersTab,
    closeTabById,
    closeTabsByIds,
    closeOtherTabsInPane,
    closeAllTabsInPane,
    closeTabsToRightInPane,
    closeTabsToLeftInPane,
    setActiveResultTab,
    closeResultTab,
    closeAllResultTabs,
    closeOtherResultTabs,
    closeResultTabsToRight,
    closeResultTabsToLeft,
    openCreateTableTab,
    openCreateKeyTab,
    openCreateEnumTab,
    openCreateIndexTab,
    openCreateTriggerTab,
    openCreateSchemaTab,
    openCreateDatabaseTab,
    openTab,
    openImportExportTab,
    openDashboardHome,
    openDashboardTab,
    createDashboard,
    updateDashboard,
    toggleDashboardShare, sharingDashboardId, updateDashboardPermissions,
    deleteDashboard,
    addDashboardFolder,
    updateDashboardFolder,
    deleteDashboardFolder,
    handleExportDashboards,
    handleImportDashboards,
    openEditEnumTab,
    handleCreateTable,
    handleDeleteFunction,
    handleUpdateFunctionDefinition,
    handleCreateEnum,
    handleCreateIndex,
    handleCreateTrigger,
    handleCreateSchema,
    handleCreateDatabase,
    handleUpdateEnum,
    handleDeleteEnum,
    handleAddSchema,
    handleTableClick,
    switchTab,
    closeTab,
    togglePinTab,
    confirmPreviewTab,
    openSqlEditor,
    openRedisCommandForKey,
    openSpacetimeDbReducers,
    openSpacetimeDbLogs,
    openSpacetimeDbSchema,
    createRedisKey,
    openSnippet,
    toggleRowSelection,
    toggleAllSelection,
    exportData,
    copyData,
    handleExportDatabaseBundle,
    handleImportDatabaseBundle,
    isImportExportLoading,
    importExportProgress,
    copyRowData,
    copyTableSchema,
    copyFunctionSchema,
    copyTriggerSchema,
    copyIndexSchema,
    copyEnumSchema,
    duplicateTable,
    emptyTable,
    deleteTable,
    handleDeleteRows,
    handleInsertRow,
    handleDuplicateRow,
    onCopyRowJSON,
    onCopyRowCSV,
    viewTableSchema,
    schemaHighlightedTable,
    openDatabaseTab,
    openCurrentTableRlsPolicies,
    openRlsPolicyEditTab,
    openRlsPolicyCreateTab,
    rlsPolicyEditData,
    getActiveDashboard,
    addDashboardWidget,
    addDashboardWidgetFromBounds,
    updateDashboardWidget,
    removeDashboardWidget,
    applyDashboardWidgetLayout,
    runAgentChat,
    runAgentDashboardGeneration,
    pageSize,
    page,
    totalCount,
    handlePageChange,
    handlePageSizeChange,
    schemaData,
    functions,
    fetchingFunctions,
    loadFunctions,
    extensions,
    fetchingExtensions,
    triggers,
    fetchingTriggers,
    enums,
    fetchingEnums,
    indexes,
    fetchingIndexes,
    loadIndexes,
    allSchemaTables,
    allSchemaViews,
    fetchingAllSchema,
    loadAllSchemaData,
    rlsPolicies,
    postgresRoles,
    supabaseAuthUsers,
    fetchingTablePermissionOptions,
    tablePermissionContext,
    setTablePermissionContext,
    fetchingRlsPolicies,
    loadRlsPolicies,
    rlsTableFilter,
    setRlsTableFilter,
    rlsPolicyFilter,
    setRlsPolicyFilter,
    handleSaveRlsPolicy,
    handleDeleteRlsPolicy,
    handleAddRlsPolicy,
    handleDeleteIndex,
    handleToggleExtension,
    queryHistory, setQueryHistory,
    isCommandMenuOpen,
    setIsCommandMenuOpen,
    isShortcutNavigatorOpen,
    setIsShortcutNavigatorOpen,
    sidebarBehavior: sidebarBehaviorState,
    isNavigationRailExpanded,
    setIsSidebarVisible,
    toggleSidebar,
    setSidebarBehavior,
    setSidebarHoverOpen,
    isSidebarVisible,
    ...studioSettings,
    editorThemeId, setEditorThemeId,
    customEditorThemes, setCustomEditorThemes,
    appThemeId, setAppThemeId,
    customAppThemes, setCustomAppThemes,
    customFontFamily, setCustomFontFamily,
    appEditorTheme,
    effectiveEditorThemeId,
    canUseCloudDashboards,
    canUseCloudSnippets,
    refreshDashboards,
    agentChatMessages,
    appendAgentChatMessage,
    updateAgentChatMessage,
    clearAgentChatMessages,
    keybindings,
    setKeybindings,
    executeKeybindingAction,
    searchSettings,
    setSearchSettings,
    pendingSearchValue,
    setPendingSearchValue,
    startSnippetSplitDrag,
    updateSnippetSplitDrag,
    endSnippetSplitDrag,
    getSnippetSplitIndicator,
    snippetSplitDrag,
    startDashboardSplitDrag,
    endDashboardSplitDrag,
    dashboardSplitDrag,
    tabSplitDrag,
    startTabSplitDrag,
    updateTabSplitDrag,
    endTabSplitDrag,
    cancelTabSplitDrag,
    getTabSplitIndicator,
    markTabDirty,
    markTabClean
  };
}
