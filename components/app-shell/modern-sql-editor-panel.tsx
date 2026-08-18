"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SqlEditor } from "@/components/studio/sql-editor";

/**
 * VS Code-style bottom "SQL Editor" panel for the Modern UI. Reuses the real
 * <SqlEditor /> component wired to the studio's global SQL context, so it is
 * exactly the same editor as the SQL editor tab. Toggleable with the panel
 * button or the Toggle Bottom Panel keybinding (default Cmd+J). The shell
 * controls the height; the drag handle lives in
 * the shell between the content card and this panel.
 */
export function ModernSqlEditorPanel({
	studio,
}: {
	studio: any;
}) {
	const [query, setQuery] = useState("");
	const state = studio.sqlTabStates?.[studio.globalSqlContextId] ?? null;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [layoutVersion, setLayoutVersion] = useState(0);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() =>
			setLayoutVersion((v) => v + 1),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const dbType =
		studio.dbType === "federated" ||
		studio.dbType === "jdbc" ||
		studio.dbType === "supabase-mgmt"
			? "postgres"
			: studio.dbType;

	const handleRunQuery = useCallback(
		(nextQuery?: string) => {
			void studio.runSqlContextQuery(
				studio.globalSqlContextId,
				nextQuery ?? query,
			);
		},
		[studio, query],
	);

	const handleStopQuery = useCallback(() => {
		void studio.stopSqlContextQuery(studio.globalSqlContextId);
	}, [studio]);

	const canStopQuery = Boolean(
		state?.loading && state?.activeQueryId,
	);

	const gridProps = useMemo(
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
		}),
		[studio],
	);

	return (
		<div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex min-h-0 flex-1 flex-col">
				<SqlEditor
					hideResults
					connectionId={studio.connection.id}
					connectionString={studio.currentConnectionString}
					dbType={dbType}
					query={query}
					setQuery={setQuery}
					error={state?.error ?? null}
					results={state?.results ?? null}
					loading={Boolean(state?.loading)}
					executionTime={state?.executionTime ?? 0}
					handleRunQuery={handleRunQuery}
					handleStopQuery={handleStopQuery}
					canStopQuery={canStopQuery}
					toggleAllSelection={studio.toggleAllSelection}
					selectedRows={studio.selectedRows}
					tableStructure={studio.tableStructure}
					toggleRowSelection={studio.toggleRowSelection}
					setSelectedCell={studio.setSelectedCell}
					selectedCell={studio.selectedCell}
					snippets={studio.snippets}
					folders={studio.folders}
					addSnippet={studio.addSnippet}
					updateSnippet={studio.updateSnippet}
					deleteSnippet={studio.deleteSnippet}
					createSnippetVersion={studio.createSnippetVersion}
					getSnippetVersions={studio.getSnippetVersions}
					restoreSnippetVersion={studio.restoreSnippetVersion}
					addFolder={studio.addFolder}
					updateFolder={studio.updateFolder}
					deleteFolder={studio.deleteFolder}
					activeTabId={studio.activeTabId}
					vimMode={studio.vimMode}
					layoutVersion={layoutVersion}
					sqlEditorEngine={studio.sqlEditorEngine}
					editorFontSize={studio.editorFontSize}
					editorFontFamily={studio.editorFontFamily}
					editorThemeId={studio.effectiveEditorThemeId}
					customEditorThemes={studio.customEditorThemes}
					appEditorTheme={studio.appEditorTheme}
					keybindings={studio.keybindings}
					slashAiTrigger={studio.slashAiTrigger}
					resultTabsEnabled={studio.resultTabsEnabled}
					sqlFormatTabWidth={studio.sqlFormatTabWidth}
					sqlFormatUseTabs={studio.sqlFormatUseTabs}
					sqlFormatKeywordCase={studio.sqlFormatKeywordCase}
					sqlFormatDataTypeCase={studio.sqlFormatDataTypeCase}
					sqlFormatFunctionCase={studio.sqlFormatFunctionCase}
					sqlFormatIdentifierCase={studio.sqlFormatIdentifierCase}
					sqlFormatLogicalOperatorNewline={
						studio.sqlFormatLogicalOperatorNewline
					}
					sqlFormatExpressionWidth={studio.sqlFormatExpressionWidth}
					sqlFormatLinesBetweenQueries={
						studio.sqlFormatLinesBetweenQueries
					}
					sqlFormatDenseOperators={studio.sqlFormatDenseOperators}
					sqlFormatNewlineBeforeSemicolon={
						studio.sqlFormatNewlineBeforeSemicolon
					}
					onOpenAiSettings={() => studio.openSettingsTab("ai")}
					selectedNamespace={studio.selectedSchema}
					schemaData={studio.schemaData}
					gridProps={gridProps}
					onOpenUnsavedQuery={(name, nextQuery) =>
						studio.openSqlEditor(undefined, undefined, nextQuery)
					}
				/>
			</div>
		</div>
	);
}
