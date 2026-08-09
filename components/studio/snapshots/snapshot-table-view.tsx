"use client";

import { useMemo } from "react";
import { Table2, Database } from "@/lib/icon-theme/lucide-react";
import { DataGridAg as DataGrid } from "@/components/studio/data-grid-ag";
import { snapshotTableDataStore } from "@/lib/db/snapshot-types";

interface SnapshotTableViewProps {
  tabId: string;
}

export function SnapshotTableView({ tabId }: SnapshotTableViewProps) {
  const data = snapshotTableDataStore.get(tabId);

  const tableStructure = useMemo(() => {
    if (!data) return [];
    return data.columns.map(c => ({
      column_name: c.name,
      data_type: c.dataType,
      is_nullable: "YES",
      column_default: null,
      is_primary_key: false,
      is_foreign_key: false,
    }));
  }, [data]);

  const noop = () => {};
  const noopAsync = async () => {};

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
        <Database className="w-4 h-4" />
        Snapshot data not found
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-studio-border text-xs text-muted-foreground shrink-0">
        <Table2 className="w-3 h-3" />
        <span className="font-medium text-foreground">{data.snapshotName}</span>
        <span className="text-muted-foreground">—</span>
        <span className="font-mono">{data.tableRef}</span>
        <span className="ml-auto">{data.rows.length} rows</span>
      </div>
      <DataGrid
        results={{ rows: data.rows, fields: data.columns.map(c => ({ name: c.name })) }}
        tableStructure={tableStructure}
        selectedRows={new Set<number>()}
        setSelectedRows={noop}
        toggleAllSelection={noop}
        toggleRowSelection={noop}
        getRowId={(_row: any, index: number) => String(index)}
        pendingChanges={{} as any}
        setPendingChanges={noop}
        editingCell={null}
        setEditingCell={noop}
        selectedCell={null}
        setSelectedCell={noop}
        selectedColumn={null}
        setSelectedColumn={noop}
        hasChanges={() => false}
        getChangedValue={() => null}
        handleUpdateRow={noopAsync}
        handleFKSelection={noopAsync as any}
        handleFKPreview={noop}
        loading={false}
        fetchingStructure={false}
        error={null}
        isAddColumnSheetOpen={false}
        setIsAddColumnSheetOpen={noop}
        isAddingColumn={false}
        handleAddColumn={noopAsync}
        handleDeleteColumn={noopAsync}
        columnToDelete={null}
        setColumnToDelete={noop}
        selectedTable={null}
        selectedSchema={null}
        sortConfig={null}
        setSortConfig={noop}
        pageSize={data.rows.length || 100}
        page={0}
        totalCount={data.rows.length}
        onPageChange={noop}
        onPageSizeChange={noop}
        onDuplicateRow={noop}
        onCopyRowJSON={noop}
        onCopyRowCSV={noop}
        skeletonLoaders={false}
        showPaginationFooter={false}
      />
    </div>
  );
}
