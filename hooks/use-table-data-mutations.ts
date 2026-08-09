import { useState, useMemo, useCallback } from "react";
import { stableStringify } from "@/lib/studio/general-utils"; // Assuming stableStringify is in general-utils

interface UseTableDataMutationsProps {
  tableStructure: any[];
  selectedTable: string | null;
  results: any;
  pendingChanges: Record<string, any>;
  selectedSchema: string | null;
  setResults: React.Dispatch<React.SetStateAction<any>>;
  setTabDataCache: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setTotalCount: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<number>>>;
  setSelectedCell: React.Dispatch<
    React.SetStateAction<{ rowIndex: number; columnName: string } | null>
  >;
}

export function useTableDataMutations({
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
}: UseTableDataMutationsProps) {
  const [isAddFKSheetOpen, setIsAddFKSheetOpen] = useState(false);
  const [newFKData, setNewFKData] = useState<{
    sourceSchema: string;
    sourceTable: string;
    sourceColumn: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
    constraintName: string;
    onUpdate: string;
    onDelete: string;
  } | null>(null);

  const pkColumns = useMemo(() => {
    return tableStructure
      .filter(
        (col: any) =>
          col.is_primary_key === true || (col.is_primary_key as any) === "t",
      )
      .map((col: any) => col.column_name);
  }, [tableStructure]);

  const getRowId = useCallback(
    (row: any, index?: number) => {
      if (!selectedTable) return null;

      if (pkColumns.length > 0) {
        return pkColumns.map((col) => `${col}:${row[col]}`).join("|");
      }

      if (index !== undefined) {
        return `idx:${index}`;
      }

      return null;
    },
    [selectedTable, pkColumns],
  );

  const hasChanges = useCallback(
    (rowIndex: number, columnName: string) => {
      const row = results?.rows[rowIndex];
      if (!row) return false;
      const rowId = getRowId(row, rowIndex);
      if (!rowId) return false;
      return pendingChanges[rowId] && columnName in pendingChanges[rowId];
    },
    [results, getRowId, pendingChanges],
  );

  const getChangedValue = useCallback(
    (rowIndex: number, columnName: string) => {
      const row = results?.rows[rowIndex];
      if (!row) return null;
      const rowId = getRowId(row, rowIndex);
      if (!rowId) return null;
      return pendingChanges[rowId]?.[columnName]?.new;
    },
    [results, getRowId, pendingChanges],
  );

  const mutateOptimisticTableRows = useCallback(
    (
      schema: string,
      table: string,
      mutateRows: (
        rows: Array<Record<string, unknown>>,
      ) => Array<Record<string, unknown>>,
    ) => {
      const patchResults = (currentResults: unknown): unknown => {
        if (
          !currentResults ||
          typeof currentResults !== "object" ||
          !("rows" in currentResults) ||
          !Array.isArray((currentResults as { rows?: unknown }).rows)
        ) {
          return currentResults;
        }
        const typedResults = currentResults as {
          rows: Array<Record<string, unknown>>;
        } & Record<string, unknown>;
        if (typedResults.rows.length === 0) return currentResults;

        const nextRows = mutateRows(typedResults.rows);
        if (nextRows === typedResults.rows) return currentResults;
        return { ...typedResults, rows: nextRows };
      };

      if (selectedSchema === schema && selectedTable === table) {
        setResults((prev: unknown) => patchResults(prev));
      }

      const tabId = `table-${schema}-${table}`;
      setTabDataCache((prev) => {
        const currentTab = prev[tabId];
        if (!currentTab) return prev;
        const nextResults = patchResults(currentTab.results);
        if (nextResults === currentTab.results) return prev;
        return {
          ...prev,
          [tabId]: {
            ...currentTab,
            results: nextResults,
          },
        };
      });
    },
    [selectedSchema, selectedTable, setResults, setTabDataCache],
  );

  const rowMatchesWhere = useCallback(
    (row: Record<string, unknown>, where: Record<string, unknown>) =>
      Object.entries(where).every(
        ([column, expected]) =>
          stableStringify(row?.[column]) === stableStringify(expected),
      ),
    [],
  );

  const applyOptimisticRowUpdates = useCallback(
    (
      schema: string,
      table: string,
      updates: Array<{
        where: Record<string, unknown>;
        set: Record<string, unknown>;
      }>,
    ) => {
      if (!updates.length) return;
      mutateOptimisticTableRows(schema, table, (rows) => {
        let didChange = false;
        const nextRows = rows.map((row) => {
          const matchingUpdate = updates.find((update) =>
            rowMatchesWhere(row, update.where),
          );
          if (!matchingUpdate) return row;
          didChange = true;
          return { ...row, ...matchingUpdate.set };
        });
        return didChange ? nextRows : rows;
      });
    },
    [rowMatchesWhere, mutateOptimisticTableRows],
  );

  const applyOptimisticRowDeletes = useCallback(
    (
      schema: string,
      table: string,
      whereClauses: Array<Record<string, unknown>>,
    ) => {
      if (!whereClauses.length) return;
      mutateOptimisticTableRows(schema, table, (rows) => {
        const nextRows = rows.filter(
          (row) => !whereClauses.some((where) => rowMatchesWhere(row, where)),
        );
        return nextRows.length === rows.length ? rows : nextRows;
      });
      if (selectedSchema === schema && selectedTable === table) {
        setTotalCount((prev) =>
          prev === null ? prev : Math.max(0, prev - whereClauses.length),
        );
      }
    },
    [rowMatchesWhere, mutateOptimisticTableRows, selectedSchema, selectedTable, setTotalCount],
  );

  const applyOptimisticRowInsertions = useCallback(
    (
      schema: string,
      table: string,
      rowsToInsert: Array<Record<string, unknown>>,
    ) => {
      if (!rowsToInsert.length) return;
      mutateOptimisticTableRows(schema, table, (rows) => [
        ...rowsToInsert,
        ...rows,
      ]);
      if (selectedSchema === schema && selectedTable === table) {
        setTotalCount((prev) =>
          prev === null ? prev : prev + rowsToInsert.length,
        );
      }
    },
    [mutateOptimisticTableRows, selectedSchema, selectedTable, setTotalCount],
  );

  const applyOptimisticTableClear = useCallback(
    (schema: string, table: string) => {
      mutateOptimisticTableRows(schema, table, (rows) =>
        rows.length ? [] : rows,
      );
      if (selectedSchema === schema && selectedTable === table) {
        setTotalCount(0);
        setSelectedRows(new Set());
        setSelectedCell(null);
      }
    },
    [
      mutateOptimisticTableRows,
      selectedSchema,
      selectedTable,
      setTotalCount,
      setSelectedRows,
      setSelectedCell,
    ],
  );

  return {
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
  };
}
