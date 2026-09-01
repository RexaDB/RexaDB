import React from "react";
import { useToggleRowSelection } from "@/hooks/use-selection-utils";
import { Search, Loader2 } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGridAg as DataGrid } from "./data-grid-ag";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
} from "@/components/ui/sheet";

interface FKSelectionSheetProps {
  isFKSelectionSheetOpen: boolean;
  setIsFKSelectionSheetOpen: (open: boolean) => void;
  fkSelectionTarget: any;
  fkSelectionSearch: string;
  setFKSelectionSearch: (search: string) => void;
  fkSelectionData: any;
  fkSelectionLoading: boolean;
  selectFKRecord: (row: any) => void;
  rowSpacing?: "compact" | "standard" | "relaxed";
  alternatingRowColors?: boolean;
}

export function FKSelectionSheet({
  isFKSelectionSheetOpen,
  setIsFKSelectionSheetOpen,
  fkSelectionTarget,
  fkSelectionSearch,
  setFKSelectionSearch,
  fkSelectionData,
  fkSelectionLoading,
  selectFKRecord,
  rowSpacing = "relaxed",
  alternatingRowColors = false,
}: FKSelectionSheetProps) {
  const [selectedRows, setSelectedRows] = React.useState<Set<number>>(
    new Set(),
  );
  const [pendingChanges, setPendingChanges] = React.useState<any>({});
  const [editingCell, setEditingCell] = React.useState<any>(null);
  const [selectedCell, setSelectedCell] = React.useState<any>(null);
  const [selectedColumn, setSelectedColumn] = React.useState<string | null>(
    null,
  );
  const [sortConfig, setSortConfig] = React.useState<{
    column: string;
    direction: "ASC" | "DESC";
  } | null>(null);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(100);
  const [isAddColumnSheetOpen, setIsAddColumnSheetOpen] = React.useState(false);
  const [columnToDelete, setColumnToDelete] = React.useState<string | null>(
    null,
  );

  const requestGridFocus = React.useCallback(() => {
    window.dispatchEvent(new Event("studio:grid-focus-request"));
  }, []);

  // When the picker was opened from the insert-row sheet (rowIndex === null), there is
  // no grid cell to return focus to - and refocusing the background grid would register
  // as an "outside" interaction on the still-open insert sheet and dismiss it. Tracked in
  // a ref (rather than read directly off fkSelectionTarget) because selectFKRecord clears
  // the target before these close handlers/callbacks run.
  const cameFromInsertSheetRef = React.useRef(false);
  React.useEffect(() => {
    if (isFKSelectionSheetOpen) {
      cameFromInsertSheetRef.current = fkSelectionTarget?.rowIndex === null;
    }
  }, [isFKSelectionSheetOpen, fkSelectionTarget]);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      setIsFKSelectionSheetOpen(open);
      if (!open && !cameFromInsertSheetRef.current) {
        window.requestAnimationFrame(() => requestGridFocus());
      }
    },
    [requestGridFocus, setIsFKSelectionSheetOpen],
  );

  const handleCancel = React.useCallback(() => {
    setIsFKSelectionSheetOpen(false);
    if (!cameFromInsertSheetRef.current) {
      window.requestAnimationFrame(() => requestGridFocus());
    }
  }, [requestGridFocus, setIsFKSelectionSheetOpen]);

  const selectedRowData = React.useMemo(() => {
    if (!fkSelectionData?.rows || selectedRows.size !== 1) return null;
    const [index] = selectedRows;
    return fkSelectionData.rows[index] ?? null;
  }, [fkSelectionData?.rows, selectedRows]);

  const handleContinue = React.useCallback(() => {
    if (!selectedRowData) return;
    selectFKRecord(selectedRowData);
    if (!cameFromInsertSheetRef.current) {
      window.requestAnimationFrame(() => requestGridFocus());
    }
  }, [selectedRowData, selectFKRecord, requestGridFocus]);

  React.useEffect(() => {
    if (!isFKSelectionSheetOpen) {
      setSelectedRows(new Set());
      setPendingChanges({});
      setEditingCell(null);
      setSelectedCell(null);
      setSelectedColumn(null);
      setSortConfig(null);
      setPage(0);
      setPageSize(100);
      setIsAddColumnSheetOpen(false);
      setColumnToDelete(null);
    }
  }, [isFKSelectionSheetOpen]);

  const tableStructure = React.useMemo(() => {
    if (!fkSelectionData?.fields) return [];
    const targetColumn = fkSelectionTarget?.fkInfo?.foreign_column_name;
    return fkSelectionData.fields.map((field: any) => ({
      name: field.name,
      column_name: field.name,
      data_type: field.dataTypeName || "",
      type: field.dataTypeName || "",
      is_primary_key: field.name === targetColumn,
      is_foreign_key: false,
    }));
  }, [fkSelectionData?.fields, fkSelectionTarget?.fkInfo?.foreign_column_name]);

  const getRowId = React.useCallback(
    (row: any, index: number) => {
      const keyColumn = fkSelectionTarget?.fkInfo?.foreign_column_name;
      const keyValue = keyColumn ? row?.[keyColumn] : undefined;
      return `${String(keyValue ?? "")}:${index}`;
    },
    [fkSelectionTarget?.fkInfo?.foreign_column_name],
  );

  const toggleAllSelection = React.useCallback(() => {
    const rows = fkSelectionData?.rows || [];
    if (!rows.length) {
      setSelectedRows(new Set());
      return;
    }
    setSelectedRows((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((_: any, index: number) => index));
    });
  }, [fkSelectionData?.rows]);

  const toggleRowSelection = useToggleRowSelection(setSelectedRows);

  const hasChanges = React.useCallback(
    (rowIndex: number, columnName: string) => {
      const row = fkSelectionData?.rows?.[rowIndex];
      if (!row) return false;
      const rowId = getRowId(row, rowIndex);
      return !!(
        rowId &&
        pendingChanges[rowId] &&
        columnName in pendingChanges[rowId]
      );
    },
    [fkSelectionData?.rows, getRowId, pendingChanges],
  );

  return (
    <Sheet open={isFKSelectionSheetOpen} onOpenChange={handleOpenChange} modal={false}>
      <SheetContent
        side="right"
        contained
        showCloseButton={false}
        data-fk-selection-sheet="true"
        onCloseAutoFocus={(e) => {
          // Radix returns focus to the trigger on close by default. This sheet is opened
          // programmatically (no Dialog.Trigger), so that would send focus to document.body,
          // which the insert-row sheet sees as an "outside" interaction and tries to dismiss on.
          if (cameFromInsertSheetRef.current) e.preventDefault();
        }}
        className="bg-background border-border text-foreground flex flex-col p-0 gap-0 max-w-none sm:max-w-none z-[60]"
        style={{ width: "768px" }}
        minResizeWidth={560}
        maxResizeWidth={1400}
        resizeHandleLabel="Resize select record sheet"
      >
        <SheetHeader className="h-12 border-b shrink-0 flex flex-row items-center gap-2 px-4">
          <span className="text-xs text-muted-foreground shrink-0">
            Choose a record from{" "}
            <span className="font-mono text-primary bg-primary/10 px-1 rounded">
              {fkSelectionTarget?.fkInfo.foreign_table_schema}.
              {fkSelectionTarget?.fkInfo.foreign_table_name}
            </span>{" "}
            to link.
          </span>
          <div className="relative ml-auto w-[200px] shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
            <Input
              placeholder="Search..."
              value={fkSelectionSearch}
              onChange={(e) => setFKSelectionSearch(e.target.value)}
              className="pl-7 h-7 text-xs bg-background border-border"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {fkSelectionLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">
                Loading available records...
              </p>
            </div>
          ) : fkSelectionData ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <DataGrid
                results={fkSelectionData}
                tableStructure={tableStructure}
                customCellRenderer={({ columnName, value }) => {
                  if (
                    columnName !==
                      fkSelectionTarget?.fkInfo?.foreign_column_name ||
                    value === null ||
                    value === undefined
                  ) {
                    return null;
                  }
                  return (
                    <span className="text-primary font-bold">
                      {String(value)}
                    </span>
                  );
                }}
                globalSearchQuery={fkSelectionSearch}
                pendingActions={[]}
                selectedRows={selectedRows}
                setSelectedRows={setSelectedRows}
                toggleAllSelection={toggleAllSelection}
                toggleRowSelection={toggleRowSelection}
                getRowId={getRowId}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                editingCell={editingCell}
                setEditingCell={setEditingCell}
                selectedCell={selectedCell}
                setSelectedCell={setSelectedCell}
                selectedColumn={selectedColumn}
                setSelectedColumn={setSelectedColumn}
                hasChanges={hasChanges}
                getChangedValue={() => undefined}
                handleUpdateRow={async () => {}}
                handleFKSelection={async () => false}
                handleFKPreview={() => {}}
                loading={false}
                fetchingStructure={false}
                error={null}
                isAddColumnSheetOpen={isAddColumnSheetOpen}
                setIsAddColumnSheetOpen={setIsAddColumnSheetOpen}
                isAddingColumn={false}
                handleAddColumn={async () => {}}
                handleDeleteColumn={async () => {}}
                columnToDelete={columnToDelete}
                setColumnToDelete={setColumnToDelete}
                selectedTable={
                  fkSelectionTarget?.fkInfo?.foreign_table_name || null
                }
                selectedSchema={
                  fkSelectionTarget?.fkInfo?.foreign_table_schema || null
                }
                sortConfig={sortConfig}
                setSortConfig={setSortConfig}
                pageSize={pageSize}
                page={page}
                totalCount={fkSelectionData?.rows?.length || 0}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                onDuplicateRow={() => {}}
                onCopyRowJSON={() => {}}
                onCopyRowCSV={() => {}}
                rowSpacing={rowSpacing}
                alternatingRowColors={alternatingRowColors}
                connectionString=""
                foreignKeys={[]}
                enums={[]}
                enableColumnHover
                showPaginationFooter={true}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              No data found
            </div>
          )}
        </div>

        <SheetFooter className="py-2 px-4 border-t bg-muted/10 shrink-0 flex items-center justify-end">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleContinue} disabled={!selectedRowData} className="h-7 text-xs">
              Continue
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
