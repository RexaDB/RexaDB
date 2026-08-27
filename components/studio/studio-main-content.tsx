import { EditorHeader } from "./editor-header";
import { ModernPaneTabs } from "./modern-pane-tabs";
import { WelcomeScreen } from "./welcome-screen";
import { SqlEditor } from "./sql-editor";
import { TableEditorView } from "./table-editor-view";
import { SchemaDiagram } from "./database/schema-diagram";
import { TablesList } from "./database/tables-list";
import { FunctionsList } from "./database/functions-list";
import { ExtensionsList } from "./database/extensions-list";
import { TriggersList } from "./database/triggers-list";
import { EnumsList } from "./database/enums-list";
import { IndexesList } from "./database/indexes-list";
import { RlsPoliciesList } from "./database/rls-policies-list";
import { RlsPolicyEditorView } from "./database/rls-policy-editor-view";
import { SessionsList } from "./database/sessions-list";
import { LocksList } from "./database/locks-list";
import { ExplainPlanView } from "./database/explain-plan-view";
import { BackupRestoreView } from "./database/backup-restore-view";
import { CreateTableView } from "./create-table-view";
import { SpacetimeDBTableBuilder } from "./spacetimedb/table-builder";
import { CreateEnumView } from "./create-enum-view";
import { CreateIndexView } from "./create-index-view";
import { CreateTriggerView } from "./create-trigger-view";
import { CreateSchemaView } from "./create-schema-view";
import { CreateDatabaseView } from "./create-database-view";
import { MonacoSqlInput } from "./monaco-sql-input";
import { DashboardView } from "./dashboard-view";
import { RedisKeysList } from "./redis/redis-keys-list";
import { RedisKeyDetails } from "./redis/redis-key-details";
import { RedisCreateKeyView } from "./redis/redis-create-key-view";
import { SpacetimeDbReducerPanel } from "./spacetimedb/reducer-panel";
import { SpacetimeDbLogViewer } from "./spacetimedb/log-viewer";
import { SpacetimeDbSchemaViewer } from "./spacetimedb/schema-viewer";
import { AuthUsersView } from "./auth/auth-users-view";
import { AuthSessionsView } from "./auth/auth-sessions-view";
import { AuthProvidersView } from "./auth/auth-providers-view";
import { SplitView } from "./split-view";
import { HorizontalSplitView } from "./horizontal-split-view";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { resolveTabViewMode } from "@/lib/studio/tab-types";
import { getTabConfigByViewMode } from "@/lib/studio/tab-registry";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type DragEvent,
} from "react";
import {
  resolveEditorThemeId,
  type MonacoThemeRef,
} from "@/lib/studio/editor-themes";
import {
  shouldShowInactivePaneTableLoading,
  shouldUseVisibleTableStateForInactivePane,
} from "@/lib/studio/table-loading";
import { useStablePaneTabRenderOrder } from "@/hooks/use-stable-pane-tab-render-order";
import { logStudioDebug } from "@/lib/studio/studio-debug";
import {
  getFirstPaneId,
  getPaneIds,
  getTabsForPane,
  splitPane,
  getPaneIdAtPosition,
  getDropPosition,
  DropPosition,
  type StudioSplitNode,
  type StudioPaneId,
} from "@/lib/studio/split-layout";
import type { RedisKeyInfo } from "@/types/redis";

interface DropIndicator {
  position: DropPosition;
  paneId: StudioPaneId;
}

function quoteColumn(rawColumn: string, dbType: string): string {
  if (dbType === "mysql" || dbType === "clickhouse") {
    return `\`${rawColumn.replace(/`/g, "``")}\``;
  }
  if (dbType === "mssql") {
    return `[${rawColumn.replace(/]/g, "]]")}]`;
  }
  return `"${rawColumn.replace(/"/g, '""')}"`;
}

function dropCreateTabInNewPane(
  studio: any,
  newPaneId: string,
  tabId: string,
  tabData: any,
  extraCallback?: () => void,
) {
  studio.activePaneIdRef.current = newPaneId;
  const currentTabs = studio.openTabs;
  const newTabs = [...currentTabs, { id: tabId, ...tabData }];
  studio.setOpenTabs(newTabs);
  studio.setSplitView((prev: any) => ({
    ...prev,
    activePaneId: newPaneId,
    paneState: { ...prev.paneState, [newPaneId]: { activeTabId: tabId } },
    tabPaneMap: { ...prev.tabPaneMap, [tabId]: newPaneId },
  }));
  extraCallback?.();
  studio.switchTab(tabId, newTabs, newPaneId);
}

function serializeFilterValue(value: any, dbType: string): string {
  if (value === null || value === undefined) return "IS NULL";
  if (typeof value === "number" && Number.isFinite(value)) return `= ${value}`;
  if (typeof value === "boolean") {
    return dbType === "mssql"
      ? `= ${value ? 1 : 0}`
      : `= ${value ? "TRUE" : "FALSE"}`;
  }
  const serialized =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `= '${serialized.replace(/'/g, "''")}'`;
}

function resolveDashboardId(paneTabs: any[], paneActiveTabId: string | null): string | null {
  const paneTab = paneTabs.find((t: any) => t.id === paneActiveTabId);
  if (!paneTab || (!paneTab.id.startsWith("dashboard-") && !paneTab.id.startsWith("dashboard_"))) {
    return null;
  }
  const match = paneTab.id.match(/^dashboard[-_](.+?)(?:[-_][\w]+)?(?:::pane::.*)?$/);
  return match ? match[1] : null;
}

interface StudioMainContentProps {
  connection: any;
  studio: any;
  onEditDashboardWithAi: (dashboard: any) => void;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
  /** Opens the Ask AI panel — wired to "Create with RexaDB Assistant". */
  onAskAI?: () => void;
  snippetSplitDrag?: {
    snippet: any;
    mouseX: number;
    mouseY: number;
  } | null;
  dashboardSplitDrag?: {
    dashboard: { id: string; name: string };
    mouseX: number;
    mouseY: number;
  } | null;
  tabSplitDrag?: {
    tab: any;
    mouseX: number;
    mouseY: number;
    sourcePaneId: string;
  } | null;
  /** Hide the per-pane tab bar (the AppShell "New Layout" renders tabs itself). */
  hideTabBar?: boolean;
  /** Tab bar styling per pane: "classic" (EditorHeader) or "modern" pills
   *  (used by shell layouts when split-view is active). */
  paneTabsVariant?: "classic" | "modern";
}

export function StudioMainContent({
  connection,
  studio,
  onEditDashboardWithAi,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
  onAskAI,
  snippetSplitDrag,
  dashboardSplitDrag,
  tabSplitDrag,
  hideTabBar,
  paneTabsVariant = "classic",
}: StudioMainContentProps) {
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchScope, setGlobalSearchScope] = useState<"page" | "table">(
    "page",
  );
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const { currentConnectionString, dbType } = studio;

  const showInsert = dbType !== "spacetimedb";
  const {
    activeTabId,
    setActiveTabId,
    openSqlEditor,
    snippets,
    folders,
    addSnippet,
    updateSnippet,
    deleteSnippet,
    createSnippetVersion,
    getSnippetVersions,
    restoreSnippetVersion,
    addFolder,
    updateFolder,
    deleteFolder,
    viewMode,
    query,
    setQuery,
    error,
    setError,
    results,
    tableLoading,
    toggleAllSelection,
    selectedRows,
    tableStructure,
    toggleRowSelection,
    setSelectedCell,
    selectedCell,
    selectedColumn,
    setSelectedColumn,
    hiddenColumnNames,
    toggleColumn,
    showAllColumns,
    selectedSchema,
    selectedTable,
    setSelectedTable,
    openTabs,
    redisKeys,
    fetchingRedisKeys,
    setSelectedSchema,
    refreshTablesSidebar,
    refreshCurrentTab,
    handleRunQuery,
    setSelectedRows,
    exportData,
    copyData,
    onCopyRowJSON,
    onCopyRowCSV,
    handleDeleteRows,
    handleDuplicateRow,
    filterQuery,
    setFilterQuery,
    refreshTableData,
    sortConfig,
    setSortConfig,
    setIsInsertSheetOpen,
    pendingChanges,
    tabDataCache,
    getTableTabSnapshot,
    setPendingChanges,
    pendingActions,
    setPendingActions,
    isReviewSheetOpen,
    setIsReviewSheetOpen,
    handleCommitChanges,
    executionMode,
    showPendingChangesBanner,
    isDeleting,
    fetchingStructure,
    getRowId,
    editingCell,
    setEditingCell,
    hasChanges,
    getChangedValue,
    handleUpdateRow,
    handleFKSelection,
    handleFKPreview,
    isAddColumnSheetOpen,
    setIsAddColumnSheetOpen,
    isAddingColumn,
    isEditColumnSheetOpen,
    setIsEditColumnSheetOpen,
    columnToEdit,
    setColumnToEdit,
    isEditingColumn,
    handleAddColumn,
    handleDeleteColumn,
    handleEditColumn,
    columnToDelete,
    setColumnToDelete,
    pageSize,
    page,
    totalCount,
    handlePageChange,
    handlePageSizeChange,
    schemaData,
    functions,
    fetchingFunctions,
    tables,
    tableSecurity,
    handleTableClick,
    schemas,
    handleCreateTable,
    isCreatingTable,
    extensions,
    fetchingExtensions,
    triggers,
    fetchingTriggers,
    enums,
    fetchingEnums,
    indexes,
    fetchingIndexes,
    rlsPolicies,
    postgresRoles,
    supabaseAuthUsers,
    fetchingTablePermissionOptions,
    tablePermissionContext,
    setTablePermissionContext,
    fetchingRlsPolicies,
    loadRlsPolicies,
    handleSaveRlsPolicy,
    handleDeleteRlsPolicy,
    handleAddRlsPolicy,
    rlsTableFilter,
    setRlsTableFilter,
    rlsPolicyFilter,
    setRlsPolicyFilter,
    openCurrentTableRlsPolicies,
    handleDeleteIndex,
    handleToggleExtension,
    handleDeleteFunction,
    handleUpdateFunctionDefinition,
    handleCreateEnum,
    rowSpacing,
    alternatingRowColors,
    appEditorTheme,
    effectiveEditorThemeId,
    sqlEditorEngine,
    editorFontSize,
    customEditorThemes,
    foreignKeys,
    splitView,
    createSplit,
    closePaneById,
    closeActivePane,
    setSplitRatio,
    setActivePaneId,
    isCommandMenuOpen,
    isShortcutNavigatorOpen,
    openRedisCommandForKey,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
    showTabIndicator,
    dashboards,
  } = studio;

  useEffect(() => {
    const activeDrag = snippetSplitDrag || dashboardSplitDrag || tabSplitDrag;
    if (!activeDrag) {
      setDropIndicator(null);
      return;
    }

    const contentArea = contentAreaRef.current;
    if (!contentArea) return;

    const rect = contentArea.getBoundingClientRect();
    const x = activeDrag.mouseX - rect.left;
    const y = activeDrag.mouseY - rect.top;

    const paneId = getPaneIdAtPosition(
      splitView.root,
      x,
      y,
      rect.width,
      rect.height,
    );
    if (!paneId) {
      setDropIndicator(null);
      return;
    }

    const position = getDropPosition(
      x,
      y,
      rect.width,
      rect.height,
      paneId,
      splitView,
    );
    if (!position) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator({ position, paneId });
  }, [snippetSplitDrag, dashboardSplitDrag, tabSplitDrag]);

  const { theme, resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme || theme;
  const resolvedEditorThemeId = resolveEditorThemeId(
    effectiveEditorThemeId || "auto",
    currentTheme,
    appEditorTheme?.id,
  );
  const supportsWholeTableSearch =
    studio.dbType !== "mongodb" && studio.dbType !== "redis";
  const effectiveGlobalSearchScope: "page" | "table" = supportsWholeTableSearch
    ? globalSearchScope
    : "page";
  const hasAuthSchema = schemas.includes("auth");
  const authEnabled = hasAuthSchema && (studio.dbType === "postgres" || studio.dbType === "supabase-mgmt");
  const dataApiInstalled =
    (studio.dbType === "postgres" || studio.dbType === "supabase-mgmt") &&
    (extensions || []).some(
      (ext: any) =>
        String(ext?.name ?? "").toLowerCase() === "data_api" &&
        ext?.installed_version,
    );
  const selectedTableSecurity = selectedTable
    ? tableSecurity?.[selectedTable]
    : undefined;
  const permissionPreviewActive = Boolean(tablePermissionContext);
  const wholeTableBaseFilterRef = useRef<string | null>(null);
  const wholeTableTargetRef = useRef<string | null>(null);
  const wholeTableDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastWholeTableAppliedFilterRef = useRef<string | null>(null);

  const buildWholeTableSearchClause = useCallback(
    (queryText: string, fields: Array<{ name: string }> | undefined) => {
      const term = queryText.trim();
      if (!term || !fields?.length) return "";

      const escapeChar = "!";
      const escapedLike = term
        .replace(/!/g, "!!")
        .replace(/%/g, "!%")
        .replace(/_/g, "!_")
        .replace(/'/g, "''");
      const pattern = `'%${escapedLike}%'`;

      const predicates = fields.map((field) => {
        const raw = String(field.name);
        const quoted = quoteColumn(raw, studio.dbType);
        if (studio.dbType === "postgres" || studio.dbType === "supabase-mgmt") {
          return `CAST(${quoted} AS TEXT) ILIKE ${pattern} ESCAPE '${escapeChar}'`;
        }
        if (studio.dbType === "mysql") {
          return `LOWER(CAST(${quoted} AS CHAR)) LIKE LOWER(${pattern}) ESCAPE '${escapeChar}'`;
        }
        if (studio.dbType === "clickhouse") {
          return `LOWER(CAST(${quoted} AS String)) LIKE LOWER(${pattern}) ESCAPE '${escapeChar}'`;
        }
        if (studio.dbType === "mssql") {
          return `LOWER(CAST(${quoted} AS NVARCHAR(MAX))) LIKE LOWER(${pattern})`;
        }
        return `LOWER(CAST(${quoted} AS TEXT)) LIKE LOWER(${pattern}) ESCAPE '${escapeChar}'`;
      });

      return predicates.length > 0 ? `(${predicates.join(" OR ")})` : "";
    },
    [studio.dbType],
  );

  const combineFilters = useCallback(
    (
      baseFilter: string,
      queryText: string,
      fields: Array<{ name: string }> | undefined,
    ) => {
      const searchClause = buildWholeTableSearchClause(queryText, fields);
      if (!searchClause) return baseFilter;
      if (!baseFilter.trim()) return searchClause;
      return `(${baseFilter}) AND ${searchClause}`;
    },
    [buildWholeTableSearchClause],
  );

  const resultFields = useMemo(
    () => (results?.fields || []) as Array<{ name: string }>,
    [results?.fields],
  );

  useEffect(() => {
    return () => {
      if (wholeTableDebounceRef.current) {
        clearTimeout(wholeTableDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const tableKey =
      selectedSchema && selectedTable
        ? `${selectedSchema}.${selectedTable}`
        : null;

    if (effectiveGlobalSearchScope !== "table" || !tableKey) {
      if (wholeTableDebounceRef.current) {
        clearTimeout(wholeTableDebounceRef.current);
        wholeTableDebounceRef.current = null;
      }
      if (
        wholeTableBaseFilterRef.current !== null &&
        selectedSchema &&
        selectedTable
      ) {
        const restoredFilter = wholeTableBaseFilterRef.current;
        wholeTableBaseFilterRef.current = null;
        wholeTableTargetRef.current = null;
        lastWholeTableAppliedFilterRef.current = null;
        if (filterQuery !== restoredFilter) {
          setFilterQuery(restoredFilter);
          refreshTableData(
            selectedTable,
            selectedSchema,
            restoredFilter,
            sortConfig,
          );
        }
      } else {
        wholeTableBaseFilterRef.current = null;
        wholeTableTargetRef.current = null;
        lastWholeTableAppliedFilterRef.current = null;
      }
      return;
    }

    if (wholeTableTargetRef.current !== tableKey) {
      wholeTableTargetRef.current = tableKey;
      wholeTableBaseFilterRef.current = filterQuery;
      lastWholeTableAppliedFilterRef.current = null;
    }

    const baseFilter = wholeTableBaseFilterRef.current ?? "";
    const combinedFilter = combineFilters(
      baseFilter,
      globalSearchQuery,
      resultFields,
    );

    if (filterQuery !== combinedFilter) {
      setFilterQuery(combinedFilter);
    }

    if (
      lastWholeTableAppliedFilterRef.current === combinedFilter &&
      filterQuery === combinedFilter
    ) {
      return;
    }

    if (wholeTableDebounceRef.current) {
      clearTimeout(wholeTableDebounceRef.current);
    }
    wholeTableDebounceRef.current = setTimeout(() => {
      refreshTableData(
        selectedTable,
        selectedSchema,
        combinedFilter,
        sortConfig,
        undefined,
        0,
      );
      lastWholeTableAppliedFilterRef.current = combinedFilter;
    }, 150);
  }, [
    combineFilters,
    filterQuery,
    globalSearchQuery,
    effectiveGlobalSearchScope,
    refreshTableData,
    resultFields,
    selectedSchema,
    selectedTable,
    setFilterQuery,
    sortConfig,
  ]);

  const handleFilterByCell = useCallback(
    (columnName: string, value: any) => {
      if (!selectedTable || !selectedSchema) return;

      const quotedColumn = quoteColumn(String(columnName), studio.dbType);
      const filter =
        value === null || value === undefined
          ? `${quotedColumn} IS NULL`
          : `${quotedColumn} ${serializeFilterValue(value, studio.dbType)}`;

      if (effectiveGlobalSearchScope === "table") {
        wholeTableBaseFilterRef.current = filter;
        const combinedFilter = combineFilters(
          filter,
          globalSearchQuery,
          resultFields,
        );
        setFilterQuery(combinedFilter);
        refreshTableData(
          selectedTable,
          selectedSchema,
          combinedFilter,
          sortConfig,
          undefined,
          0,
        );
        lastWholeTableAppliedFilterRef.current = combinedFilter;
        return;
      }

      setFilterQuery(filter);
      refreshTableData(selectedTable, selectedSchema, filter, sortConfig);
    },
    [
      combineFilters,
      effectiveGlobalSearchScope,
      globalSearchQuery,
      refreshTableData,
      resultFields,
      selectedSchema,
      selectedTable,
      setFilterQuery,
      sortConfig,
      studio.dbType,
    ],
  );

  const openTableInNewTab = useCallback(
    (schema: string, table: string, filterColumn: string, filterValue: any) => {
      if (!table || !schema) return;
      const quotedColumn = quoteColumn(String(filterColumn), studio.dbType);
      const filter =
        filterValue === null || filterValue === undefined
          ? `${quotedColumn} IS NULL`
          : `${quotedColumn} ${serializeFilterValue(filterValue, studio.dbType)}`;
      handleTableClick(table, schema);
      setFilterQuery(filter);
      refreshTableData(table, schema, filter, sortConfig);
    },
    [
      handleTableClick,
      refreshTableData,
      setFilterQuery,
      sortConfig,
      studio.dbType,
    ],
  );

  const tableToolbarProps = {
    selectedRows,
    setSelectedRows,
    exportData,
    copyData,
    handleDeleteRows,
    isDeleting,
    filterQuery,
    setFilterQuery,
    selectedTable,
    selectedSchema,
    refreshTableData: (
      table: string,
      schema: string,
      filter: string,
      sort: Array<{ column: string; direction: "ASC" | "DESC" }>,
    ) => refreshTableData(table, schema, filter, sort[0] ?? null),
    refreshCurrentTab,
    sortConfig: !showInsert ? [] : sortConfig ? [sortConfig] : [],
    setSortConfig: !showInsert
      ? () => {}
      : (config: Array<{ column: string; direction: "ASC" | "DESC" }>) =>
          setSortConfig(config[0] ?? null),
    results,
    tableStructure,
    setIsInsertSheetOpen,
    loading: tableLoading,
    fetchingStructure,
    onOpenRlsPolicies: openCurrentTableRlsPolicies,
    globalSearchQuery,
    setGlobalSearchQuery,
    globalSearchScope: effectiveGlobalSearchScope,
    setGlobalSearchScope: (scope: "page" | "table") =>
      setGlobalSearchScope(supportsWholeTableSearch ? scope : "page"),
    supportsWholeTableSearch,
    dbType: studio.dbType,
    rlsEnabled: selectedTableSecurity?.rlsEnabled,
    rlsPolicyCount: selectedTableSecurity?.policyCount,
    permissionContext: tablePermissionContext,
    setPermissionContext: setTablePermissionContext,
    postgresRoles,
    supabaseAuthUsers,
    loadingPermissionOptions: fetchingTablePermissionOptions,
    isPermissionPreview: permissionPreviewActive,
    hiddenColumns: hiddenColumnNames,
    onToggleColumn: toggleColumn,
    onShowAllColumns: showAllColumns,
    connectionString: currentConnectionString,
  };

  const tableGridProps = {
    results,
    tableStructure,
    hiddenColumns: hiddenColumnNames,
    enums,
    pendingActions,
    selectedRows,
    setSelectedRows,
    toggleAllSelection,
    toggleRowSelection,
    getRowId,
    pendingChanges,
    setPendingChanges,
    editingCell,
    setEditingCell: permissionPreviewActive ? () => {} : setEditingCell,
    selectedCell,
    setSelectedCell,
    hasChanges,
    getChangedValue,
    selectedColumn,
    setSelectedColumn,
    handleUpdateRow: permissionPreviewActive ? async () => {} : handleUpdateRow,
    handleFKSelection,
    handleFKPreview,
    loading: tableLoading,
    fetchingStructure,
    error,
    setError,
    isAddColumnSheetOpen,
    setIsAddColumnSheetOpen,
    isAddingColumn,
    handleAddColumn,
    handleDeleteColumn,
    handleEditColumn,
    columnToDelete,
    setColumnToDelete,
    columnToEdit,
    setColumnToEdit,
    isEditColumnSheetOpen,
    setIsEditColumnSheetOpen,
    isEditingColumn,
    selectedTable,
    selectedSchema,
    sortConfig: !showInsert ? null : (sortConfig ?? null),
    setSortConfig: !showInsert
      ? () => {}
      : (config: { column: string; direction: "ASC" | "DESC" } | null) =>
          setSortConfig(config),
    pageSize,
    page,
    totalCount,
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
    onDuplicateRow: permissionPreviewActive ? () => {} : handleDuplicateRow,
    onCopyRowJSON,
    onCopyRowCSV,
    onFilterByCell: handleFilterByCell,
    onNavigateToTable: openTableInNewTab,
    onOpenInsertSheet:
      permissionPreviewActive || !showInsert
        ? () => {}
        : () => setIsInsertSheetOpen(true),
    rowSpacing,
    alternatingRowColors,
    connectionString: currentConnectionString,
    foreignKeys,
    globalSearchQuery:
      effectiveGlobalSearchScope === "page" ? globalSearchQuery : "",
    isKeyboardInputSuspended: isCommandMenuOpen || isShortcutNavigatorOpen,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
    pendingSearchValue: studio.pendingSearchValue,
    onConsumeSearchValue: () => studio.setPendingSearchValue(null),
    showPaginationFooter: studio.dbType !== "spacetimedb",
    showAddColumn: studio.dbType !== "spacetimedb",
  };

  const sqlEditorGridProps = {
    pendingActions,
    setSelectedRows,
    toggleAllSelection,
    toggleRowSelection,
    getRowId,
    pendingChanges,
    setPendingChanges,
    editingCell,
    setEditingCell,
    selectedColumn,
    setSelectedColumn,
    hasChanges,
    getChangedValue,
    handleUpdateRow,
    handleFKSelection,
    handleFKPreview,
    fetchingStructure,
    isAddColumnSheetOpen,
    setIsAddColumnSheetOpen,
    isAddingColumn,
    handleAddColumn,
    handleDeleteColumn,
    handleEditColumn,
    columnToDelete,
    setColumnToDelete,
    columnToEdit,
    setColumnToEdit,
    isEditColumnSheetOpen,
    setIsEditColumnSheetOpen,
    isEditingColumn,
    selectedTable,
    selectedSchema,
    sortConfig,
    setSortConfig,
    pageSize,
    page,
    totalCount,
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
    onDuplicateRow: handleDuplicateRow,
    onCopyRowJSON,
    onCopyRowCSV,
    onFilterByCell: handleFilterByCell,
    onNavigateToTable: openTableInNewTab,
    onOpenInsertSheet: showInsert ? () => setIsInsertSheetOpen(true) : () => {},
    rowSpacing,
    alternatingRowColors,
    connectionString: currentConnectionString,
    foreignKeys,
    enums,
    globalSearchQuery:
      effectiveGlobalSearchScope === "page" ? globalSearchQuery : "",
    showPaginationFooter: true,
    isKeyboardInputSuspended: isCommandMenuOpen || isShortcutNavigatorOpen,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
  };

  const renderSqlEditor = (options: {
    query: string;
    setQuery: (val: string) => void;
    sqlTabId: string;
    tabState: {
      error: string | null;
      results: any;
      loading: boolean;
      executionTime: number;
      activeQueryId?: string | null;
      resultTabs?: any[];
      activeResultTabId?: string | null;
    } | null;
    onRun: (query?: string) => void;
    onStop: () => void;
    canStopQuery: boolean;
  }) => {
    const resultTabs = (options.tabState as any)?.resultTabs ?? [];
    const activeResultTabId =
      (options.tabState as any)?.activeResultTabId ?? null;
    return (
      <SqlEditor
        connectionId={connection.id}
        connectionString={currentConnectionString}
        dbType={studio.dbType}
        query={options.query}
        setQuery={options.setQuery}
        error={options.tabState?.error ?? null}
        results={options.tabState?.results ?? null}
        loading={Boolean(options.tabState?.loading)}
        executionTime={options.tabState?.executionTime ?? 0}
        handleRunQuery={options.onRun}
        handleStopQuery={options.onStop}
        canStopQuery={options.canStopQuery}
        toggleAllSelection={toggleAllSelection}
        selectedRows={selectedRows}
        tableStructure={tableStructure}
        toggleRowSelection={toggleRowSelection}
        setSelectedCell={setSelectedCell}
        selectedCell={selectedCell}
        snippets={snippets}
        folders={folders}
        addSnippet={addSnippet}
        updateSnippet={updateSnippet}
        deleteSnippet={deleteSnippet}
        createSnippetVersion={createSnippetVersion}
        getSnippetVersions={getSnippetVersions}
        restoreSnippetVersion={restoreSnippetVersion}
        addFolder={addFolder}
        updateFolder={updateFolder}
        deleteFolder={deleteFolder}
        activeTabId={activeTabId}
        sqlEditorEngine={studio.sqlEditorEngine}
        editorFontSize={studio.editorFontSize}
        editorFontFamily={studio.editorFontFamily}
        editorThemeId={effectiveEditorThemeId}
        customEditorThemes={studio.customEditorThemes}
        appEditorTheme={appEditorTheme as MonacoThemeRef | null}
        vimMode={studio.vimMode}
        slashAiTrigger={studio.slashAiTrigger}
        keybindings={studio.keybindings}
        resultTabsEnabled={studio.resultTabsEnabled}
        onOpenAiSettings={() => studio.openSettingsTab("ai")}
        selectedNamespace={selectedSchema}
        schemaData={schemaData}
        gridProps={sqlEditorGridProps}
        resultTabs={resultTabs}
        activeResultTabId={activeResultTabId}
        onSelectResultTab={(id: string) =>
          studio.setActiveResultTab(options.sqlTabId, id)
        }
        onCloseResultTab={(id: string) =>
          studio.closeResultTab(options.sqlTabId, id)
        }
        onCloseAllResultTabs={() => studio.closeAllResultTabs(options.sqlTabId)}
        onCloseOtherResultTabs={(keepId: string) =>
          studio.closeOtherResultTabs(options.sqlTabId, keepId)
        }
        onCloseResultTabsToRight={(anchorId: string) =>
          studio.closeResultTabsToRight(options.sqlTabId, anchorId)
        }
        onCloseResultTabsToLeft={(anchorId: string) =>
          studio.closeResultTabsToLeft(options.sqlTabId, anchorId)
        }
        onOpenUnsavedQuery={(name: string, query: string) =>
          studio.openSqlEditor(undefined, undefined, query)
        }
      />
    );
  };

  const buildInactiveTableProps = (tab: any | null | undefined) => {
    const noop = () => {};
    const noopAsync = async () => {};
    const selectedTableName = tab?.name ?? null;
    const selectedSchemaName = tab?.schema ?? selectedSchema ?? "";
    const useVisibleTableState = shouldUseVisibleTableStateForInactivePane({
      activeTabId,
      tabType: tab?.type,
      tabSchema: tab?.schema,
      tabName: tab?.name,
      selectedSchema,
      selectedTable,
    });
    const cached = tab?.id
      ? (getTableTabSnapshot?.(tab.id) ?? tabDataCache?.[tab.id])
      : undefined;
    const cachedResults =
      cached?.results ?? (useVisibleTableState ? results : null);
    const cachedStructure =
      cached?.tableStructure ?? (useVisibleTableState ? tableStructure : []);
    const cachedForeignKeys =
      cached?.foreignKeys ?? (useVisibleTableState ? foreignKeys : []);
    const cachedFilterQuery =
      cached?.filterQuery ?? (useVisibleTableState ? filterQuery : "");
    const cachedSortConfig =
      cached?.sortConfig ?? (useVisibleTableState ? sortConfig : null);
    const cachedPage = cached?.page ?? (useVisibleTableState ? page : 0);
    const cachedPageSize =
      cached?.pageSize ?? (useVisibleTableState ? pageSize : 100);
    const cachedTotalCount =
      cached?.totalCount ?? (useVisibleTableState ? totalCount : null);
    const cachedPermissionContext = cached?.permissionContext ?? null;
    const cachedSecurity = selectedTableName
      ? tableSecurity?.[selectedTableName]
      : undefined;
    const shouldShowLoading = shouldShowInactivePaneTableLoading(
      tab?.type,
      cachedResults,
    );
    return {
      toolbarProps: {
        selectedRows: new Set<number>(),
        setSelectedRows: noop,
        exportData: noop,
        copyData: noop,
        handleDeleteRows: noop,
        isDeleting: false,
        filterQuery: cachedFilterQuery,
        setFilterQuery: noop,
        selectedTable: selectedTableName,
        selectedSchema: selectedSchemaName,
        refreshTableData: noop,
        refreshCurrentTab: noop,
        sortConfig: cachedSortConfig ? [cachedSortConfig] : [],
        setSortConfig: noop,
        results: cachedResults,
        setIsInsertSheetOpen: noop,
        loading: shouldShowLoading,
        fetchingStructure: false,
        onOpenRlsPolicies: noop,
        globalSearchQuery: "",
        setGlobalSearchQuery: noop,
        globalSearchScope: effectiveGlobalSearchScope,
        setGlobalSearchScope: noop,
        supportsWholeTableSearch,
        dbType: studio.dbType,
        rlsEnabled: cachedSecurity?.rlsEnabled,
        rlsPolicyCount: cachedSecurity?.policyCount,
        permissionContext: cachedPermissionContext,
        setPermissionContext: noop,
        connectionString: currentConnectionString,
        postgresRoles,
        supabaseAuthUsers,
        loadingPermissionOptions: fetchingTablePermissionOptions,
        isPermissionPreview: Boolean(cachedPermissionContext),
      },
      gridProps: {
        results: cachedResults,
        tableStructure: cachedStructure,
        enums,
        pendingActions: [],
        selectedRows: new Set<number>(),
        setSelectedRows: noop,
        toggleAllSelection: noop,
        toggleRowSelection: noop,
        getRowId,
        pendingChanges: {},
        setPendingChanges: noop,
        editingCell: null,
        setEditingCell: noop,
        selectedCell: null,
        setSelectedCell: noop,
        hasChanges: () => false,
        getChangedValue: () => undefined,
        selectedColumn: null,
        setSelectedColumn: noop,
        handleUpdateRow: noopAsync,
        handleFKSelection: async () => false,
        handleFKPreview: noop,
        loading: shouldShowLoading,
        fetchingStructure: false,
        error: null,
        isAddColumnSheetOpen: false,
        setIsAddColumnSheetOpen: noop,
        isAddingColumn: false,
        handleAddColumn: noopAsync,
        handleDeleteColumn: noopAsync,
        columnToDelete: null,
        setColumnToDelete: noop,
        selectedTable: selectedTableName,
        selectedSchema: selectedSchemaName,
        sortConfig: cachedSortConfig ?? null,
        setSortConfig: noop,
        pageSize: cachedPageSize,
        page: cachedPage,
        totalCount: cachedTotalCount,
        onPageChange: noop,
        onPageSizeChange: noop,
        onDuplicateRow: noop,
        onCopyRowJSON: noop,
        onCopyRowCSV: noop,
        onFilterByCell: noop,
        onNavigateToTable: noop,
        onOpenInsertSheet: noop,
        rowSpacing,
        alternatingRowColors,
        connectionString: currentConnectionString,
        foreignKeys: cachedForeignKeys,
        globalSearchQuery: "",
        isKeyboardInputSuspended: true,
      },
    };
  };

  const buildTablePropsForPane = (
    tab: any | null | undefined,
    useGlobalState: boolean,
  ) => {
    if (!tab || useGlobalState) {
      return { toolbarProps: tableToolbarProps, gridProps: tableGridProps };
    }
    return buildInactiveTableProps(tab);
  };

  const rootPaneId = useMemo(
    () => getFirstPaneId(splitView.root),
    [splitView.root],
  );
  const paneIds = useMemo(
    () => (splitView.enabled ? getPaneIds(splitView.root) : [rootPaneId]),
    [rootPaneId, splitView.enabled, splitView.root],
  );
  const isSplitViewEnabled = paneIds.length > 1;
  const paneTabsById = useMemo(() => {
    const openTabIds = openTabs.map((tab: any) => tab.id);
    const tabsById = new Map(openTabs.map((tab: any) => [tab.id, tab]));

    return Object.fromEntries(
      paneIds.map((paneId) => {
        const paneTabIds = getTabsForPane(openTabIds, splitView, paneId);
        const paneTabs = paneTabIds
          .map((tabId: string) => tabsById.get(tabId))
          .filter(Boolean);

        return [paneId, paneTabs];
      }),
    ) as Record<string, any[]>;
  }, [openTabs, paneIds, splitView]);
  const paneBodyTabsById = useStablePaneTabRenderOrder(paneTabsById);
  const getPaneTabs = (paneId: string) => paneTabsById[paneId] ?? [];
  const getPaneBodyTabs = (paneId: string) =>
    paneBodyTabsById[paneId] ?? paneTabsById[paneId] ?? [];
  const getPaneActiveTabId = (paneId: string) =>
    splitView.paneState[paneId]?.activeTabId ??
    getPaneTabs(paneId)[0]?.id ??
    null;

  const getDatabaseViewFromTab = (
    tabId: string | null,
  ):
    | "schema"
    | "tables"
    | "functions"
    | "extensions"
    | "triggers"
    | "enums"
    | "indexes"
    | "rls-policies"
    | "sessions"
    | "locks"
    | "explain-plan"
    | "backup-restore"
    | "spacetimedb-reducers"
    | "spacetimedb-logs"
    | "spacetimedb-schema"
    | null => {
    if (!tabId?.startsWith("database-")) return null;
    const view = tabId.replace("database-", "");
    const validViews = [
      "schema",
      "tables",
      "functions",
      "extensions",
      "triggers",
      "enums",
      "indexes",
      "rls-policies",
      "sessions",
      "locks",
      "explain-plan",
      "backup-restore",
      "spacetimedb-reducers",
      "spacetimedb-logs",
      "spacetimedb-schema",
    ];
    return validViews.includes(view)
      ? (view as
          | "schema"
          | "tables"
          | "functions"
          | "extensions"
          | "triggers"
          | "enums"
          | "indexes"
          | "rls-policies"
          | "sessions"
          | "locks"
          | "explain-plan"
          | "backup-restore"
          | "spacetimedb-reducers"
          | "spacetimedb-logs"
          | "spacetimedb-schema")
      : null;
  };

  const renderPaneBody = (paneId: string) => {
    const paneTabs = getPaneBodyTabs(paneId);
    const paneActiveTabId = getPaneActiveTabId(paneId);
    const paneDatabaseView = getDatabaseViewFromTab(paneActiveTabId);
    const isPaneActive = splitView.activePaneId === paneId;

    if (paneTabs.length === 0) {
      return (
        <WelcomeScreen
          onOpenSqlEditor={openSqlEditor}
          dbType={studio.dbType}
          onClosePane={
            isSplitViewEnabled && isPaneActive
              ? () => closePaneById(paneId)
              : undefined
          }
        />
      );
    }

    return (
      <div className="flex-1 relative min-h-0 w-full">
        {paneTabs.map((tab: any) => {
          const isVisible = tab.id === paneActiveTabId;
          const paneViewMode = resolveTabViewMode(tab, viewMode);
          const paneIsActive = splitView.activePaneId === paneId;
          const paneSqlTabState =
            tab.type === "sql" ? (studio.sqlTabStates?.[tab.id] ?? null) : null;
          const paneIsActiveTab = paneIsActive && tab.id === activeTabId;
          const paneQueryValue = paneIsActiveTab ? query : (tab.query ?? "");
          const setPaneQuery = paneIsActiveTab
            ? setQuery
            : (val: string) => {
                const next = (studio.openTabs as any[]).map((t: any) =>
                  t.id === tab.id ? { ...t, query: val || "" } : t,
                );
                studio.setOpenTabs(next);
              };
          const canStopPaneSql = Boolean(
            paneSqlTabState?.loading &&
            paneSqlTabState?.activeQueryId &&
            paneIsActiveTab,
          );
          const useGlobalTableState = paneIsActive && tab.id === activeTabId;
          const { toolbarProps: paneToolbarProps, gridProps: paneGridProps } =
            buildTablePropsForPane(tab, useGlobalTableState);

          const registryRenderComponent = (() => {
            const rc = getTabConfigByViewMode(paneViewMode);
            return rc?.renderComponent
              ? rc.renderComponent({
                  tab,
                  studio,
                  context: {
                    connection,
                    connectionString: currentConnectionString,
                    dbType: studio.dbType,
                    onOpenThemeCreator,
                    onOpenIconThemeCreator,
                  },
                })
              : null;
          })();

          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0 flex flex-col min-h-0 w-full",
                isVisible
                  ? "z-10 visible opacity-100"
                  : "z-0 invisible opacity-0 pointer-events-none",
              )}
            >
              {registryRenderComponent
                ? registryRenderComponent
                : paneViewMode === "database" ? (
                paneDatabaseView === "schema" ? (
                  <SchemaDiagram
                    schemaData={schemaData}
                    selectedSchema={selectedSchema}
                    schemas={schemas}
                    onSchemaChange={setSelectedSchema}
                    dbType={studio.dbType}
                    refreshCurrentTab={refreshCurrentTab}
                    setIsAddFKSheetOpen={studio.setIsAddFKSheetOpen}
                    setNewFKData={studio.setNewFKData}
                    onOpenTable={handleTableClick}
                    highlightedTable={studio.schemaHighlightedTable}
                  />
                ) : paneDatabaseView === "tables" ? (
                  studio.dbType === "redis" ? (
                    <RedisKeysList
                      keys={redisKeys}
                      selectedDatabase={selectedSchema}
                      databases={schemas}
                      onDatabaseChange={setSelectedSchema}
                      onKeyClick={handleTableClick}
                      onRefresh={refreshTablesSidebar}
                      onCreateKeyTab={studio.openCreateKeyTab}
                      isLoading={fetchingRedisKeys}
                    />
                  ) : (
                    <TablesList
                      dbType={studio.dbType}
                      tables={tables}
                      selectedSchema={selectedSchema}
                      schemas={schemas}
                      onSchemaChange={setSelectedSchema}
                      onTableClick={handleTableClick}
                      onOpenCreateTableTab={studio.openCreateTableTab}
                      tableSecurity={tableSecurity}
                      dataApiInstalled={dataApiInstalled}
                      onViewSchema={studio.viewTableSchema}
                      onOpenSqlEditor={(table) =>
                        studio.openSqlEditor(table, selectedSchema)
                      }
                      onCopyName={(table) =>
                        studio.copyTableSchema(table, selectedSchema)
                      }
                      tags={studio.tags}
                      tableTags={studio.tableTags}
                      toggleTableTag={studio.toggleTableTag}
                      copyTableSchema={studio.copyTableSchema}
                      duplicateTable={studio.duplicateTable}
                      emptyTable={studio.emptyTable}
                      deleteTable={studio.deleteTable}
                      exportData={studio.exportData}
                      viewTables={studio.viewTables}
                    />
                  )
                ) : paneDatabaseView === "functions" ? (
                  <FunctionsList
                    functions={functions}
                    selectedSchema={selectedSchema}
                    schemas={schemas}
                    onSchemaChange={setSelectedSchema}
                    onDeleteFunction={handleDeleteFunction}
                    onSaveFunctionDefinition={handleUpdateFunctionDefinition}
                    fetchingFunctions={fetchingFunctions}
                    dbType={studio.dbType}
                    sqlEditorEngine={sqlEditorEngine}
                    editorFontSize={
                      typeof editorFontSize === "string"
                        ? parseInt(editorFontSize, 10) || 13
                        : editorFontSize || 13
                    }
                    editorFontFamily={studio.editorFontFamily}
                    editorThemeId={resolvedEditorThemeId}
                    appEditorTheme={appEditorTheme}
                    customEditorThemes={customEditorThemes}
                    vimMode={studio.vimMode}
                    schemaData={schemaData}
                    onAskAI={onAskAI}
                  />
                ) : paneDatabaseView === "extensions" ? (
                  <ExtensionsList
                    extensions={extensions || []}
                    fetchingExtensions={fetchingExtensions}
                    onToggleExtension={handleToggleExtension}
                  />
                ) : paneDatabaseView === "triggers" ? (
                  <TriggersList
                    triggers={triggers || []}
                    fetchingTriggers={fetchingTriggers}
                    onOpenCreateTriggerTab={studio.openCreateTriggerTab}
                    schemas={schemas}
                    selectedSchema={selectedSchema}
                    onSchemaChange={setSelectedSchema}
                    onAskAI={onAskAI}
                  />
                ) : paneDatabaseView === "enums" ? (
                  <EnumsList
                    enums={enums || []}
                    fetchingEnums={fetchingEnums}
                    onOpenCreateEnumTab={studio.openCreateEnumTab}
                    onOpenEditEnumTab={studio.openEditEnumTab}
                    onDeleteEnum={studio.handleDeleteEnum}
                    schemas={schemas}
                    selectedSchema={selectedSchema}
                    onSchemaChange={setSelectedSchema}
                  />
                ) : paneDatabaseView === "indexes" ? (
                  <IndexesList
                    indexes={indexes || []}
                    fetchingIndexes={fetchingIndexes}
                    onDeleteIndex={handleDeleteIndex}
                    onOpenCreateIndexTab={studio.openCreateIndexTab}
                    onViewDefinition={(index: any) => {
                      const tabId = `sql-index-${index.name}`;
                      const newTab = {
                        id: tabId,
                        type: "sql" as const,
                        name: `Index: ${index.name}`,
                        query: index.definition,
                      };
                      const nextTabs = [...openTabs, newTab];
                      studio.setOpenTabs(nextTabs);
                      studio.switchTab(tabId, nextTabs);
                    }}
                    schemas={schemas}
                    selectedSchema={selectedSchema}
                    onSchemaChange={setSelectedSchema}
                  />
                ) : paneDatabaseView === "rls-policies" ? (
                  <RlsPoliciesList
                    policies={rlsPolicies || []}
                    selectedSchema={selectedSchema}
                    schemas={schemas}
                    tables={(tables || []).map((t: any) => {
                      if (typeof t === "string")
                        return { schema: selectedSchema, table_name: t };
                      return {
                        schema: t.schema || selectedSchema,
                        table_name: t.name || t.table_name,
                      };
                    })}
                    onSchemaChange={setSelectedSchema}
                    onRefresh={loadRlsPolicies}
                    onSavePolicy={handleSaveRlsPolicy}
                    onDeletePolicy={handleDeleteRlsPolicy}
                    onAddPolicy={handleAddRlsPolicy}
                    availableRoles={postgresRoles || []}
                    tableFilter={rlsTableFilter}
                    setTableFilter={setRlsTableFilter}
                    policyFilter={rlsPolicyFilter}
                    setPolicyFilter={setRlsPolicyFilter}
                    fetchingPolicies={fetchingRlsPolicies}
                    schemaData={studio.schemaData}
                    rlsPolicyTabEditor={studio.rlsPolicyTabEditor}
                    onOpenEditTab={studio.openRlsPolicyEditTab}
                    onOpenCreateTab={studio.openRlsPolicyCreateTab}
                  />
                ) : paneDatabaseView === "sessions" ? (
                  <SessionsList connectionString={currentConnectionString} />
                ) : paneDatabaseView === "locks" ? (
                  <LocksList connectionString={currentConnectionString} />
                ) : paneDatabaseView === "explain-plan" ? (
                  <ExplainPlanView connectionString={currentConnectionString} />
                ) : paneDatabaseView === "backup-restore" ? (
                  <BackupRestoreView
                    connectionString={currentConnectionString}
                    dbType={studio.dbType}
                  />
                ) : paneDatabaseView === "spacetimedb-reducers" ? (
                  <SpacetimeDbReducerPanel
                    connectionString={currentConnectionString}
                    onClose={() =>
                      paneActiveTabId && studio.closeTabById(paneActiveTabId)
                    }
                  />
                ) : paneDatabaseView === "spacetimedb-logs" ? (
                  <SpacetimeDbLogViewer
                    connectionString={currentConnectionString}
                    onClose={() =>
                      paneActiveTabId && studio.closeTabById(paneActiveTabId)
                    }
                  />
                ) : paneDatabaseView === "spacetimedb-schema" ? (
                  <SpacetimeDbSchemaViewer
                    connectionString={currentConnectionString}
                    onClose={() =>
                      paneActiveTabId && studio.closeTabById(paneActiveTabId)
                    }
                    editorThemeId={effectiveEditorThemeId}
                    appEditorTheme={appEditorTheme as MonacoThemeRef | null}
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    Unknown database view: {paneDatabaseView}
                  </div>
                )
              ) : paneViewMode === "create-key" ? (
                <RedisCreateKeyView
                  onCreateKey={studio.createRedisKey}
                  onClose={() => tab.id && studio.closeTabById(tab.id)}
                />
              ) : paneViewMode === "auth" ? (
                tab?.type === "auth-sessions" ? (
                  <AuthSessionsView
                    connectionString={currentConnectionString}
                    enabled={authEnabled}
                  />
                ) : tab?.type === "auth-providers" ? (
                  <AuthProvidersView
                    connectionString={currentConnectionString}
                    enabled={authEnabled}
                  />
                ) : (
                  <AuthUsersView
                    connectionString={currentConnectionString}
                    enabled={authEnabled}
                  />
                )
              ) : paneViewMode === "create-table" ? (
                dbType === "spacetimedb" ? (
                  <SpacetimeDBTableBuilder
                    onClose={() => tab.id && studio.closeTabById(tab.id)}
                  />
                ) : (
                  <CreateTableView
                    dbType={studio.dbType}
                    schemas={schemas}
                    selectedSchema={selectedSchema}
                    tables={tables}
                    onCreateTable={handleCreateTable}
                    isCreating={isCreatingTable}
                    newTableData={studio.newTableData}
                    setNewTableData={studio.setNewTableData}
                  />
                )
              ) : paneViewMode === "create-enum" ? (
                <CreateEnumView
                  selectedSchema={selectedSchema}
                  onCreateEnum={studio.handleCreateEnum}
                  onUpdateEnum={studio.handleUpdateEnum}
                  isCreating={studio.isCreatingEnum}
                  isEditing={studio.isEditingEnum}
                  newEnumData={studio.newEnumData}
                  setNewEnumData={studio.setNewEnumData}
                />
              ) : paneViewMode === "create-index" ? (
                <CreateIndexView
                  connectionString={studio.currentConnectionString}
                  selectedSchema={selectedSchema}
                  onCreateIndex={studio.handleCreateIndex}
                  isCreating={studio.isCreatingIndex}
                />
              ) : paneViewMode === "create-trigger" ? (
                <CreateTriggerView
                  connectionString={studio.currentConnectionString}
                  selectedSchema={selectedSchema}
                  onCreateTrigger={studio.handleCreateTrigger}
                  isCreating={studio.isCreatingTrigger}
                />
              ) : paneViewMode === "rls-policy-edit" ? (
                <RlsPolicyEditorView
                  policy={studio.rlsPolicyEditData?.[tab.id]?.policy}
                  prefillSchema={
                    studio.rlsPolicyEditData?.[tab.id]?.prefillSchema
                  }
                  prefillTable={
                    studio.rlsPolicyEditData?.[tab.id]?.prefillTable
                  }
                  tables={(tables || []).map((t: any) => {
                    if (typeof t === "string")
                      return { schema: selectedSchema, table_name: t };
                    return {
                      schema: t.schema || selectedSchema,
                      table_name: t.name || t.table_name,
                    };
                  })}
                  availableRoles={postgresRoles || []}
                  schemaData={studio.schemaData}
                  onSavePolicy={handleSaveRlsPolicy}
                  onCreatePolicy={handleAddRlsPolicy}
                  onClose={() => tab.id && studio.closeTabById(tab.id)}
                />
              ) : paneViewMode === "create-schema" ? (
                <CreateSchemaView
                  onCreateSchema={studio.handleCreateSchema}
                  isCreating={studio.isCreatingSchema}
                />
              ) : paneViewMode === "create-database" ? (
                <CreateDatabaseView
                  onCreateDatabase={studio.handleCreateDatabase}
                  isCreating={studio.isCreatingDatabase}
                />
              ) : paneViewMode === "dashboard" ? (
                <DashboardView
                  dashboard={(() => {
                    const dashId = resolveDashboardId(paneTabs, paneActiveTabId);
                    if (!dashId) return null;
                    return (
                      studio.dashboards.find((d: any) => d.id === dashId) ||
                      null
                    );
                  })()}
                  onEditWithAi={onEditDashboardWithAi}
                  onRefresh={refreshCurrentTab}
                  isLocked={(() => {
                    const dashId = resolveDashboardId(paneTabs, paneActiveTabId);
                    if (!dashId) return false;
                    const dashboard = studio.dashboards.find(
                      (d: any) => d.id === dashId,
                    );
                    return dashboard?.isLocked || false;
                  })()}
                  onToggleLock={() => {
                    const dashId = resolveDashboardId(paneTabs, paneActiveTabId);
                    if (!dashId) return;
                    const dashboard = studio.dashboards.find(
                      (d: any) => d.id === dashId,
                    );
                    if (dashboard) {
                      studio.updateDashboard(dashId, {
                        isLocked: !dashboard.isLocked,
                      });
                    }
                  }}
                  addDashboardWidgetFromBounds={
                    studio.addDashboardWidgetFromBounds
                  }
                  updateDashboardWidget={studio.updateDashboardWidget}
                  removeDashboardWidget={studio.removeDashboardWidget}
                  applyDashboardWidgetLayout={studio.applyDashboardWidgetLayout}
                  tables={tables}
                  selectedSchema={selectedSchema}
                  connectionString={currentConnectionString}
                  editorThemeId={effectiveEditorThemeId}
                  appEditorTheme={appEditorTheme as MonacoThemeRef | null}
                  vimMode={studio.vimMode}
                />
              ) : paneViewMode === "sql" ? (
                renderSqlEditor({
                  query: paneQueryValue,
                  setQuery: setPaneQuery,
                  sqlTabId: tab.id,
                  tabState: paneSqlTabState,
                  onRun: paneIsActiveTab ? handleRunQuery : () => {},
                  onStop: paneIsActiveTab ? studio.handleStopQuery : () => {},
                  canStopQuery: canStopPaneSql,
                })
              ) : paneViewMode === "code" ? (
                <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
                  <MonacoSqlInput
                    dbType={studio.dbType}
                    query={tab?.query || ""}
                    onChange={(val) => {
                      const next = (studio.openTabs as any[]).map((t: any) =>
                        t.id === tab.id ? { ...t, query: val || "" } : t,
                      );
                      studio.setOpenTabs(next);
                    }}
                    fontSize={parseInt(studio.editorFontSize, 10) || 13}
                    themeId={resolvedEditorThemeId}
                    customEditorThemes={studio.customEditorThemes}
                    appEditorTheme={appEditorTheme as MonacoThemeRef | null}
                    vimMode={studio.vimMode}
                    schemaData={schemaData}
                    readOnly
                    onRun={() => {}}
                    onRunSelected={() => {}}
                    onSaveSnippet={() => {}}
                    onSelectionChange={() => {}}
                  />
                </div>
              ) : studio.dbType === "redis" ? (
                <RedisKeyDetails
                  keyInfo={
                    redisKeys.find(
                      (entry: RedisKeyInfo) => entry.key === selectedTable,
                    ) || null
                  }
                  onOpenCommand={openRedisCommandForKey}
                  connectionString={currentConnectionString}
                  selectedDatabase={selectedSchema}
                  executionMode={executionMode}
                  setPendingActions={setPendingActions}
                  setIsReviewSheetOpen={setIsReviewSheetOpen}
                />
              ) : (
                /* TABLE EDITOR MODE - DIRECT DATA */
                <TableEditorView
                  toolbarProps={paneToolbarProps}
                  gridProps={paneGridProps}
                  showPendingChangesBanner={showPendingChangesBanner}
                  onOpenReviewPanel={() => setIsReviewSheetOpen(true)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderPane = (paneId: string) => {
    const paneTabs = getPaneTabs(paneId);
    const paneActiveTabId = getPaneActiveTabId(paneId);
    const isPaneActive = splitView.activePaneId === paneId;
    const setPaneOpenTabs: React.Dispatch<React.SetStateAction<any[]>> = (
      updater,
    ) => {
      studio.setOpenTabs((prev: any[]) => {
        const paneTabIds = getTabsForPane(
          prev.map((tab) => tab.id),
          splitView,
          paneId,
        );
        const paneTabList = prev.filter((tab) => paneTabIds.includes(tab.id));
        const otherTabs = prev.filter((tab) => !paneTabIds.includes(tab.id));
        const nextPaneTabs =
          typeof updater === "function"
            ? (updater as (tabs: any[]) => any[])(paneTabList)
            : updater;
        return [...otherTabs, ...nextPaneTabs];
      });
    };
    const handlePaneSwitchTab = (tabId: string) => {
      setActivePaneId(paneId);
      studio.switchTab(tabId, undefined, paneId);
    };
    const handleActivatePane = () => {
      logStudioDebug("pane-mouse-down", {
        paneId,
        currentActivePaneId: splitView.activePaneId,
        paneActiveTabId,
        currentActiveTabId: activeTabId,
      });
      if (splitView.activePaneId !== paneId) {
        setActivePaneId(paneId);
      }
      if (paneActiveTabId && activeTabId !== paneActiveTabId) {
        studio.switchTab(paneActiveTabId, undefined, paneId);
      } else if (!paneActiveTabId) {
        setActiveTabId(null);
      }
    };
    const openSqlEditorForPane = () => {
      setActivePaneId(paneId);
      openSqlEditor();
    };
    const handlePaneCloseTab = (e: MouseEvent, tabId: string) => {
      e.stopPropagation();
      studio.closeTab(e, tabId);
    };
    const handleCloseOtherTabs = (keepTabId: string) => {
      studio.closeOtherTabsInPane(paneId, keepTabId);
    };
    const handleCloseAllTabs = () => {
      studio.closeAllTabsInPane(paneId);
    };
    const handleCloseTabsToRight = (anchorTabId: string) => {
      studio.closeTabsToRightInPane(paneId, anchorTabId);
    };
    const handleCloseTabsToLeft = (anchorTabId: string) => {
      studio.closeTabsToLeftInPane(paneId, anchorTabId);
    };
    const paneTabIds = getTabsForPane(
      openTabs.map((t: any) => t.id),
      splitView,
      paneId,
    );

    return (
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 relative"
        onMouseDown={handleActivatePane}
      >
        {!hideTabBar && paneTabs.length > 0 &&
          (paneTabsVariant === "modern" ? (
            <ModernPaneTabs
              tabs={paneTabs}
              activeTabId={paneActiveTabId}
              switchTab={handlePaneSwitchTab}
              closeTab={handlePaneCloseTab}
              openSqlEditor={openSqlEditorForPane}
              isPaneActive={isPaneActive}
              onActivatePane={handleActivatePane}
              onSplitPane={createSplit}
              onClosePane={isSplitViewEnabled ? closeActivePane : undefined}
              paneId={paneId}
            />
          ) : (
            <EditorHeader
            {...studio}
            connection={connection}
            openTabs={paneTabs}
            setOpenTabs={setPaneOpenTabs}
            activeTabId={paneActiveTabId}
            switchTab={handlePaneSwitchTab}
            openSqlEditor={openSqlEditorForPane}
            isPaneActive={isPaneActive}
            onActivatePane={handleActivatePane}
            onSplitPane={createSplit}
            onClosePane={isSplitViewEnabled ? closeActivePane : undefined}
            closeTab={handlePaneCloseTab}
            showTabIndicator={showTabIndicator}
            paneId={paneId}
            paneTabIds={paneTabIds}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onCloseTabsToRight={handleCloseTabsToRight}
            onCloseTabsToLeft={handleCloseTabsToLeft}
            onTabPaneDragStart={(tab, cx, cy) =>
              studio.startTabSplitDrag(tab, cx, cy, paneId)
            }
            onTabPaneDragMove={(cx, cy) => studio.updateTabSplitDrag(cx, cy)}
            onTabPaneDragEnd={() => studio.endTabSplitDrag()}
            onTabPaneDragCancel={() => studio.cancelTabSplitDrag()}
            isTabPaneDragging={!!tabSplitDrag}
          />
          ))}
        <div className="relative z-10 flex-1 flex flex-col min-h-0">
          {renderPaneBody(paneId)}
        </div>
      </div>
    );
  };

  const renderSplitNode = (node: StudioSplitNode): React.ReactNode => {
    if (node.type === "pane") {
      return renderPane(node.id);
    }
    const SplitComponent =
      node.direction === "horizontal" ? HorizontalSplitView : SplitView;
    return (
      <SplitComponent
        primary={renderSplitNode(node.first)}
        secondary={renderSplitNode(node.second)}
        ratio={node.ratio}
        onRatioChange={(ratio) => setSplitRatio(node.id, ratio)}
      />
    );
  };

  const splitViewRef = useRef(splitView);
  const dropIndicatorRef = useRef<any>(null);

  useEffect(() => {
    splitViewRef.current = splitView;
  }, [splitView]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const contentArea = contentAreaRef.current;
    if (!contentArea) return;

    const rect = contentArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const paneId = getPaneIdAtPosition(
      splitViewRef.current.root,
      x,
      y,
      rect.width,
      rect.height,
    );
    if (!paneId) return;

    const position = getDropPosition(
      x,
      y,
      rect.width,
      rect.height,
      paneId,
      splitViewRef.current,
    );
    const indicator: DropIndicator = { position, paneId };
    dropIndicatorRef.current = indicator;
    setDropIndicator(indicator);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && contentAreaRef.current?.contains(relatedTarget))
      return;
    dropIndicatorRef.current = null;
    setDropIndicator(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const dataStr = e.dataTransfer.getData("application/x-rexadb-item");
      if (!dataStr) {
        setDropIndicator(null);
        dropIndicatorRef.current = null;
        return;
      }

      let itemData: { type: string; name: string; schema: string };
      try {
        itemData = JSON.parse(dataStr);
      } catch {
        setDropIndicator(null);
        dropIndicatorRef.current = null;
        return;
      }

      const currentIndicator: DropIndicator | null = dropIndicatorRef.current;
      if (!currentIndicator || !currentIndicator.paneId) {
        setDropIndicator(null);
        dropIndicatorRef.current = null;
        return;
      }

      const paneId = currentIndicator.paneId;
      const position = currentIndicator.position;

      setDropIndicator(null);
      dropIndicatorRef.current = null;

      if (position === "center") {
        studio.activePaneIdRef.current = paneId;
        studio.setSplitView((prev: any) => ({
          ...prev,
          activePaneId: paneId,
        }));
        if (itemData.type === "table") {
          studio.handleTableClick(itemData.name);
        } else if (itemData.type === "dashboard") {
          studio.openDashboardTab(itemData.name);
        } else if (itemData.type === "sql-editor") {
          studio.openSqlEditor();
        } else if (itemData.type === "sql-snippet") {
          const snippet = studio.snippets?.find(
            (s: any) => s.id === itemData.name,
          );
          if (snippet) {
            studio.openSqlEditor(undefined, undefined, snippet.query);
          }
        } else if (itemData.type === "auth-users") {
          studio.openTab("auth-users", undefined, {
            afterCreated: () => studio.setSidebarView("auth"),
            afterExisting: () => studio.setSidebarView("auth"),
          });
        } else if (itemData.type === "auth-sessions") {
          studio.openTab("auth-sessions", undefined, {
            afterCreated: () => studio.setSidebarView("auth"),
            afterExisting: () => studio.setSidebarView("auth"),
          });
        } else if (itemData.type === "auth-providers") {
          studio.openTab("auth-providers", undefined, {
            afterCreated: () => studio.setSidebarView("auth"),
            afterExisting: () => studio.setSidebarView("auth"),
          });
        } else if (itemData.type === "database-schema") {
          studio.setDatabaseView("schema");
        } else if (itemData.type === "database-tables") {
          studio.setDatabaseView("tables");
        } else if (itemData.type === "database-functions") {
          studio.setDatabaseView("functions");
        } else if (itemData.type === "database-extensions") {
          studio.setDatabaseView("extensions");
        } else if (itemData.type === "database-triggers") {
          studio.setDatabaseView("triggers");
        } else if (itemData.type === "database-enums") {
          studio.setDatabaseView("enums");
        } else if (itemData.type === "database-indexes") {
          studio.setDatabaseView("indexes");
        } else if (itemData.type === "database-rls-policies") {
          studio.setDatabaseView("rls-policies");
        } else if (itemData.type === "database-sessions") {
          studio.setDatabaseView("sessions");
        } else if (itemData.type === "database-locks") {
          studio.setDatabaseView("locks");
        } else if (itemData.type === "database-explain-plan") {
          studio.setDatabaseView("explain-plan");
        } else if (itemData.type === "database-backup-restore") {
          studio.setDatabaseView("backup-restore");
        }
        return;
      }

      const direction =
        position === "left" || position === "right" ? "vertical" : "horizontal";
      const splitOnRightOrBottom = position === "left" || position === "top";
      const currentSplit = splitViewRef.current;
      const newLayout = splitPane(
        currentSplit,
        paneId,
        direction,
        splitOnRightOrBottom,
      );
      const newPaneId = newLayout.activePaneId;

      studio.setSplitView(newLayout);

      if (itemData.type === "table") {
        const schema = itemData.schema || studio.selectedSchema;
        const baseId = `table-${schema}-${itemData.name}`;
        const tabId = `${baseId}::pane::${newPaneId}`;

        studio.activePaneIdRef.current = newPaneId;

        const currentTabs = studio.openTabs;

        const existingTab = currentTabs.find((t: any) => t.baseId === baseId);

        if (existingTab) {
          const existingTabId = existingTab.id;
          studio.setSplitView((prev: any) => ({
            ...prev,
            activePaneId: newPaneId,
            paneState: {
              ...prev.paneState,
              [newPaneId]: { activeTabId: tabId },
            },
            tabPaneMap: {
              ...prev.tabPaneMap,
              [tabId]: newPaneId,
            },
          }));

          const newTabs = [
            ...currentTabs,
            {
              id: tabId,
              baseId,
              type: "table" as const,
              name: itemData.name,
              schema,
            },
          ];

          studio.setOpenTabs(newTabs);

          studio.switchTab(tabId, newTabs, newPaneId);
        } else {
          dropCreateTabInNewPane(studio, newPaneId, tabId, {
            baseId,
            type: "table" as const,
            name: itemData.name,
            schema,
          });
        }
      } else if (itemData.type === "dashboard") {
        const dashboardId = itemData.name;
        const tabId = `dashboard-${dashboardId}::pane::${newPaneId}`;
        dropCreateTabInNewPane(studio, newPaneId, tabId, {
          type: "dashboard" as const,
          name: dashboardId,
        });
      } else if (itemData.type === "sql-editor") {
        studio.activePaneIdRef.current = newPaneId;
        studio.openSqlEditor();
        studio.setSplitView((prev: any) => ({
          ...prev,
          activePaneId: newPaneId,
        }));
      } else if (itemData.type === "sql-snippet") {
        const snippet = studio.snippets?.find(
          (s: any) => s.id === itemData.name,
        );
        if (snippet) {
          studio.activePaneIdRef.current = newPaneId;
          studio.openSqlEditor(undefined, undefined, snippet.query);
          studio.setSplitView((prev: any) => ({
            ...prev,
            activePaneId: newPaneId,
          }));
        }
      } else if (itemData.type === "auth-users") {
        dropCreateTabInNewPane(
          studio,
          newPaneId,
          `auth-users::pane::${newPaneId}`,
          { type: "auth-users" as const, name: "Users" },
        );
      } else if (itemData.type === "auth-sessions") {
        dropCreateTabInNewPane(
          studio,
          newPaneId,
          `auth-sessions::pane::${newPaneId}`,
          { type: "auth-sessions" as const, name: "Sessions" },
        );
      } else if (itemData.type === "auth-providers") {
        dropCreateTabInNewPane(
          studio,
          newPaneId,
          `auth-providers::pane::${newPaneId}`,
          { type: "auth-providers" as const, name: "Providers" },
        );
      } else if (itemData.type?.startsWith("database-")) {
        const viewType = itemData.type.replace("database-", "");
        const viewMap: Record<string, any> = {
          schema: "schema",
          tables: "tables",
          functions: "functions",
          extensions: "extensions",
          triggers: "triggers",
          enums: "enums",
          indexes: "indexes",
          "rls-policies": "rls-policies",
        };
        const tabId = `database-${viewType}::pane::${newPaneId}`;
        dropCreateTabInNewPane(
          studio,
          newPaneId,
          tabId,
          {
            type: `database-${viewType}` as any,
            name: viewMap[viewType] || viewType,
          },
          () => {
            studio.setDatabaseView(viewMap[viewType]);
          },
        );
      }
    },
    [studio],
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative">
      <div
        ref={contentAreaRef}
        data-studio-content-area
        className="flex-1 flex flex-col overflow-hidden min-h-0 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {renderSplitNode(splitView.root)}
        {dropIndicator && (
          <DropIndicatorOverlay
            position={dropIndicator.position}
            paneId={dropIndicator.paneId}
            splitView={splitView}
            contentAreaRef={contentAreaRef}
          />
        )}
      </div>
    </div>
  );
}

function getPaneGeometry(
  paneId: StudioPaneId,
  node: StudioSplitNode,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  if (node.type === "pane") {
    if (node.id === paneId) {
      return { x: 0, y: 0, w: width, h: height };
    }
    return null;
  }

  const splitX = width * node.ratio;
  const splitY = height * node.ratio;

  if (node.direction === "vertical") {
    const left = getPaneGeometry(paneId, node.first, splitX, height);
    if (left) return left;

    const right = getPaneGeometry(paneId, node.second, width - splitX, height);
    if (right)
      return { x: right.x + splitX, y: right.y, w: right.w, h: right.h };
  } else {
    const top = getPaneGeometry(paneId, node.first, width, splitY);
    if (top) return top;

    const bottom = getPaneGeometry(paneId, node.second, width, height - splitY);
    if (bottom)
      return { x: bottom.x, y: bottom.y + splitY, w: bottom.w, h: bottom.h };
  }

  return null;
}

interface DropIndicatorOverlayProps {
  position: DropPosition;
  paneId: StudioPaneId;
  splitView: any;
  contentAreaRef: React.RefObject<HTMLDivElement | null>;
}

function DropIndicatorOverlay({
  position,
  paneId,
  splitView,
  contentAreaRef,
}: DropIndicatorOverlayProps) {
  const contentRect = contentAreaRef.current?.getBoundingClientRect();
  if (!contentRect) return null;

  const geo = getPaneGeometry(
    paneId,
    splitView.root,
    contentRect.width,
    contentRect.height,
  );
  if (!geo) return null;

  let style: React.CSSProperties;
  const className =
    "fixed pointer-events-none rounded-lg transition-all duration-100 ease-out bg-primary/25 ring-2 ring-primary z-[99999]";

  switch (position) {
    case "center":
      style = {
        left: contentRect.left + geo.x,
        top: contentRect.top + geo.y,
        width: geo.w,
        height: geo.h,
      };
      break;
    case "left":
      style = {
        left: contentRect.left + geo.x,
        top: contentRect.top + geo.y,
        width: geo.w * 0.5,
        height: geo.h,
      };
      break;
    case "right":
      style = {
        left: contentRect.left + geo.x + geo.w * 0.5,
        top: contentRect.top + geo.y,
        width: geo.w * 0.5,
        height: geo.h,
      };
      break;
    case "top":
      style = {
        left: contentRect.left + geo.x,
        top: contentRect.top + geo.y,
        width: geo.w,
        height: geo.h * 0.5,
      };
      break;
    case "bottom":
      style = {
        left: contentRect.left + geo.x,
        top: contentRect.top + geo.y + geo.h * 0.5,
        width: geo.w,
        height: geo.h * 0.5,
      };
      break;
    default:
      return null;
  }

  return <div className={className} style={style} />;
}
