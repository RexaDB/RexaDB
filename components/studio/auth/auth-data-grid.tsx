"use client";
import { DataGridAg } from "@/components/studio/data-grid-ag";
import { useAuthGridState } from "@/hooks/use-auth-grid-state";
import { AuthProvidersCell } from "./auth-providers-cell";
import { AuthSelectionCell } from "./auth-selection-cell";
import type { Dispatch, SetStateAction } from "react";

interface ColumnDef { name: string; type: string; isPrimaryKey?: boolean; }

interface AuthDataGridProps {
  rows: any[];
  columns: ColumnDef[];
  loading: boolean;
  error: string | null;
  search: string;
  selectedTable: string;
  selectedSchema: string;
  idKey?: string;
  selectedRows?: Set<number>;
  setSelectedRows?: Dispatch<SetStateAction<Set<number>>>;
  toggleAllSelection?: () => void;
  toggleRowSelection?: (index: number) => void;
}

export function AuthDataGrid({
  rows,
  columns,
  loading,
  error,
  search,
  selectedTable,
  selectedSchema,
  idKey,
  selectedRows,
  setSelectedRows,
  toggleAllSelection,
  toggleRowSelection,
}: AuthDataGridProps) {
  const grid = useAuthGridState(rows, columns, idKey);
  const customCellRenderer = ({ row, columnName, value }: { row: any; columnName: string; value: any }) => {
    if (columnName === "Providers")
      return (
        <AuthProvidersCell
          providers={Array.isArray(row.Providers) ? row.Providers : String(row.Providers ?? "").split(", ")}
          icons={row.__provider_icons}
        />
      );
    if (columnName === "Last sign in at" && !row.__confirmed && value)
      return <span className="text-studio-cell-muted">Waiting for verification</span>;
    if (value === null || value === undefined || value === "")
      return <span className="text-muted-foreground"> - </span>;
    return undefined;
  };
  return (
    <div className="h-full flex flex-col">
      <DataGridAg 
        results={grid.results} 
        tableStructure={grid.tableStructure} 
        globalSearchQuery={search} 
        pendingActions={[]} 
        selectedRows={selectedRows ?? grid.selectedRows} 
        setSelectedRows={setSelectedRows ?? grid.setSelectedRows} 
        toggleAllSelection={toggleAllSelection ?? grid.toggleAllSelection} 
        toggleRowSelection={toggleRowSelection ?? grid.toggleRowSelection} 
        getRowId={grid.getRowId} 
        pendingChanges={grid.pendingChanges} 
        setPendingChanges={grid.setPendingChanges} 
        editingCell={grid.editingCell} 
        setEditingCell={grid.setEditingCell} 
        selectedCell={grid.selectedCell} 
        setSelectedCell={grid.setSelectedCell} 
        selectedColumn={grid.selectedColumn} 
        setSelectedColumn={grid.setSelectedColumn} 
        hasChanges={() => false} 
        getChangedValue={() => null} 
        handleUpdateRow={async () => {}} 
        handleFKSelection={async () => false} 
        handleFKPreview={() => {}} 
        loading={loading} 
        fetchingStructure={false} 
        error={error} 
        showAddColumn={false} 
        showHeaderIcons={false} 
        stickyHeader={true} 
        customCellRenderer={customCellRenderer} 
        renderSelectionCell={(row) => <AuthSelectionCell row={row} />} 
        isAddColumnSheetOpen={grid.isAddColumnSheetOpen} 
        setIsAddColumnSheetOpen={grid.setIsAddColumnSheetOpen} 
        isAddingColumn={false} 
        handleAddColumn={async () => {}} 
        handleDeleteColumn={async () => {}} 
        columnToDelete={grid.columnToDelete} 
        setColumnToDelete={grid.setColumnToDelete} 
        selectedTable={selectedTable} 
        selectedSchema={selectedSchema} 
        sortConfig={grid.sortConfig} 
        setSortConfig={grid.setSortConfig} 
        pageSize={grid.pageSize} 
        page={grid.page} 
        totalCount={rows.length} 
        onPageChange={grid.setPage} 
        onPageSizeChange={grid.setPageSize} 
        onDuplicateRow={() => {}} 
        onCopyRowJSON={() => {}} 
        onCopyRowCSV={() => {}} 
        rowSpacing="relaxed" 
        alternatingRowColors={false} 
        showPaginationFooter={false} 
        selectionColumnWidth={95} 
        stickySelectionColumn={false} 
        stickyFirstDataColumn={false} 
      />
    </div>
  );
}
