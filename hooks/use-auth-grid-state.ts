"use client";
import { useCallback, useMemo, useState } from "react";
import { useToggleRowSelection } from "@/hooks/use-selection-utils";

interface ColumnDef {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
}

export function useAuthGridState(
  rows: any[],
  columns: ColumnDef[],
  idKey: string = "id",
) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const [editingCell, setEditingCell] = useState<any>(null);
  const [selectedCell, setSelectedCell] = useState<any>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "ASC" | "DESC";
  } | null>(null);
  const [isAddColumnSheetOpen, setIsAddColumnSheetOpen] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(200);

  const results = useMemo(
    () => ({
      rows,
      fields: columns.map((c) => ({ name: c.name, dataTypeName: c.type })),
    }),
    [rows, columns],
  );
  const tableStructure = useMemo(
    () =>
      columns.map((c) => ({
        name: c.name,
        data_type: c.type,
        is_primary_key: !!c.isPrimaryKey,
        is_foreign_key: false,
      })),
    [columns],
  );
  const toggleAllSelection = useCallback(
    () =>
      setSelectedRows((prev) =>
        prev.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)),
      ),
    [rows],
  );

  const toggleRowSelection = useToggleRowSelection(setSelectedRows);
  const getRowId = useCallback(
    (row: any, index: number) => String(row?.[idKey] ?? row?.id ?? index),
    [idKey],
  );

  return {
    results,
    tableStructure,
    selectedRows,
    setSelectedRows,
    toggleAllSelection,
    toggleRowSelection,
    getRowId,
    pendingChanges,
    setPendingChanges,
    editingCell,
    setEditingCell,
    selectedCell,
    setSelectedCell,
    selectedColumn,
    setSelectedColumn,
    sortConfig,
    setSortConfig,
    isAddColumnSheetOpen,
    setIsAddColumnSheetOpen,
    columnToDelete,
    setColumnToDelete,
    page,
    setPage,
    pageSize,
    setPageSize,
  };
}
