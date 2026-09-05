"use client";

import { useCallback, useMemo } from "react";

export function normalizeSqlDbType(dbType: any): any {
  return dbType === "federated" || dbType === "jdbc" || dbType === "supabase-mgmt"
    ? "postgres"
    : dbType;
}

export function useGlobalSqlControls(studio: any, query: string, state: any) {
  const dbType = normalizeSqlDbType(studio.dbType);

  const handleRunQuery = useCallback(
    (nextQuery?: string) => {
      void studio.runSqlContextQuery(studio.globalSqlContextId, nextQuery ?? query);
    },
    [studio, query],
  );

  const handleStopQuery = useCallback(() => {
    void studio.stopSqlContextQuery(studio.globalSqlContextId);
  }, [studio]);

  const canStopQuery = Boolean(state?.loading && state?.activeQueryId);

  return { dbType, state, handleRunQuery, handleStopQuery, canStopQuery };
}

export function useStudioGridProps(studio: any, extra?: Record<string, unknown>) {
  return useMemo(
    () => ({
      pendingActions: studio.pendingActions,
      setSelectedRows: studio.setSelectedRows,
      toggleAllSelection: studio.toggleAllSelection,
      toggleRowSelection: studio.toggleRowSelection,
      getRowId: studio.getRowId,
      pendingChanges: studio.pendingChanges,
      setPendingChanges: studio.setPendingChanges,
      editingCell: studio.editingCell,
      setEditingCell: studio.setEditingCell,
      selectedColumn: studio.selectedColumn,
      setSelectedColumn: studio.setSelectedColumn,
      hasChanges: studio.hasChanges,
      getChangedValue: studio.getChangedValue,
      handleUpdateRow: studio.handleUpdateRow,
      handleFKSelection: studio.handleFKSelection,
      handleFKPreview: studio.handleFKPreview,
      fetchingStructure: studio.fetchingStructure,
      isAddColumnSheetOpen: studio.isAddColumnSheetOpen,
      setIsAddColumnSheetOpen: studio.setIsAddColumnSheetOpen,
      isAddingColumn: studio.isAddingColumn,
      handleAddColumn: studio.handleAddColumn,
      handleDeleteColumn: studio.handleDeleteColumn,
      columnToDelete: studio.columnToDelete,
      setColumnToDelete: studio.setColumnToDelete,
      selectedTable: studio.selectedTable,
      selectedSchema: studio.selectedSchema,
      sortConfig: studio.sortConfig ?? null,
      setSortConfig: (
        config: { column: string; direction: "ASC" | "DESC" } | null,
      ) => studio.setSortConfig(config),
      pageSize: studio.pageSize,
      page: studio.page,
      totalCount: studio.totalCount,
      onPageChange: studio.handlePageChange,
      onPageSizeChange: studio.handlePageSizeChange,
      onDuplicateRow: studio.handleDuplicateRow,
      onCopyRowJSON: studio.onCopyRowJSON,
      onCopyRowCSV: studio.onCopyRowCSV,
      onOpenInsertSheet: () => studio.setIsInsertSheetOpen(true),
      rowSpacing: studio.rowSpacing,
      alternatingRowColors: studio.alternatingRowColors,
      connectionString: studio.currentConnectionString,
      foreignKeys: studio.foreignKeys,
      enums: studio.enums,
      showPaginationFooter: true,
      isKeyboardInputSuspended:
        studio.isCommandMenuOpen || studio.isShortcutNavigatorOpen,
      ...extra,
    }),
    [studio, extra],
  );
}

export function useStudioEditorProps(studio: any) {
  return useMemo(
    () => ({
      toggleAllSelection: studio.toggleAllSelection,
      selectedRows: studio.selectedRows,
      tableStructure: studio.tableStructure,
      toggleRowSelection: studio.toggleRowSelection,
      setSelectedCell: studio.setSelectedCell,
      selectedCell: studio.selectedCell,
      snippets: studio.snippets,
      folders: studio.folders,
      addSnippet: studio.addSnippet,
      updateSnippet: studio.updateSnippet,
      deleteSnippet: studio.deleteSnippet,
      createSnippetVersion: studio.createSnippetVersion,
      getSnippetVersions: studio.getSnippetVersions,
      restoreSnippetVersion: studio.restoreSnippetVersion,
      addFolder: studio.addFolder,
      updateFolder: studio.updateFolder,
      deleteFolder: studio.deleteFolder,
      activeTabId: studio.activeTabId,
      vimMode: studio.vimMode,
      sqlEditorEngine: studio.sqlEditorEngine,
      editorFontSize: studio.editorFontSize,
      editorFontFamily: studio.editorFontFamily,
      editorThemeId: studio.effectiveEditorThemeId,
      customEditorThemes: studio.customEditorThemes,
      appEditorTheme: studio.appEditorTheme,
      sqlFormatTabWidth: studio.sqlFormatTabWidth,
      sqlFormatUseTabs: studio.sqlFormatUseTabs,
      sqlFormatKeywordCase: studio.sqlFormatKeywordCase,
      sqlFormatDataTypeCase: studio.sqlFormatDataTypeCase,
      sqlFormatFunctionCase: studio.sqlFormatFunctionCase,
      sqlFormatIdentifierCase: studio.sqlFormatIdentifierCase,
      sqlFormatLogicalOperatorNewline: studio.sqlFormatLogicalOperatorNewline,
      sqlFormatExpressionWidth: studio.sqlFormatExpressionWidth,
      sqlFormatLinesBetweenQueries: studio.sqlFormatLinesBetweenQueries,
      sqlFormatDenseOperators: studio.sqlFormatDenseOperators,
      sqlFormatNewlineBeforeSemicolon: studio.sqlFormatNewlineBeforeSemicolon,
      onOpenAiSettings: () => studio.openSettingsTab("ai"),
      selectedNamespace: studio.selectedSchema,
      schemaData: studio.schemaData,
    }),
    [studio],
  );
}
