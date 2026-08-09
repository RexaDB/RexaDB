"use client";

import { useEffect, useState } from "react";
import { SelectItem } from "@/components/ui/select";
import { FK_ACTIONS } from "@/lib/db/column-types";
import {
  fetchSchemas,
  fetchTables,
  fetchTableStructure,
} from "@/lib/api/actions-client";
import { useSheetCloseConfirm } from "@/hooks/use-sheet-close-confirm";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";

export function useColumnSheetCommon({
  isDirty,
  onOpenChange,
  setAddForeignKey,
  setFkTable,
  setFkColumn,
  setFkSchema,
  selectedSchema,
  schemas,
}: {
  isDirty: boolean;
  onOpenChange: (open: boolean) => void;
  setAddForeignKey: (v: boolean) => void;
  setFkTable: (v: string) => void;
  setFkColumn: (v: string) => void;
  setFkSchema: (v: string) => void;
  selectedSchema?: string | null;
  schemas: string[];
}) {
  const { confirmSheetClose } = useGlobalStudioSettings();
  const { handleInteractOutside, ConfirmDialog } = useSheetCloseConfirm(
    isDirty,
    confirmSheetClose,
    () => onOpenChange(false),
  );

  const onForeignKeyToggle = (checked: boolean) => {
    setAddForeignKey(checked);
    if (!checked) {
      setFkTable("");
      setFkColumn("");
    } else {
      setFkSchema(selectedSchema || schemas[0] || "");
    }
  };

  return { handleInteractOutside, ConfirmDialog, onForeignKeyToggle };
}

export function FkActionSelectItems({ className = "text-xs" }: { className?: string }) {
  return FK_ACTIONS.map((action) => (
    <SelectItem key={action} value={action} className={className}>
      {action}
    </SelectItem>
  ));
}

export function useForeignKeyFetchEffects({
  isOpen,
  skip,
  addForeignKey,
  fkSchema,
  fkTable,
  connectionString,
  setSchemas,
  setFkTables,
  setFkColumns,
  setFkColumn,
  fkColumn,
}: {
  isOpen: boolean;
  skip: boolean;
  addForeignKey: boolean;
  fkSchema: string;
  fkTable: string;
  connectionString: string;
  setSchemas: (schemas: string[]) => void;
  setFkTables: (tables: string[]) => void;
  setFkColumns: (cols: string[]) => void;
  setFkColumn: (col: string) => void;
  fkColumn: string;
}) {
  useEffect(() => {
    if (!isOpen || skip) return;
    let cancelled = false;
    (async () => {
      const res = await fetchSchemas(connectionString);
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setSchemas(res.data.filter((s): s is string => typeof s === "string"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, skip, connectionString, setSchemas]);

  useEffect(() => {
    if (!isOpen || !addForeignKey || !fkSchema || skip) return;
    let cancelled = false;
    (async () => {
      const res = await fetchTables(connectionString, fkSchema);
      if (!cancelled && res.success && Array.isArray(res.data)) {
        setFkTables(res.data.filter((t): t is string => typeof t === "string"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, addForeignKey, fkSchema, skip, connectionString, setFkTables]);

  useEffect(() => {
    if (!isOpen || !addForeignKey || !fkSchema || !fkTable || skip) return;
    let cancelled = false;
    (async () => {
      const res = await fetchTableStructure(
        connectionString,
        fkSchema,
        fkTable,
      );
      if (!cancelled && res.success && Array.isArray(res.data)) {
        const cols = res.data
          .map((col: { column_name?: unknown; name?: unknown }) =>
            String(col?.column_name || col?.name || "").trim(),
          )
          .filter(Boolean);
        setFkColumns(cols);
        if (cols.length > 0 && !cols.includes(fkColumn)) {
          setFkColumn(cols.includes("id") ? "id" : cols[0]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    addForeignKey,
    fkSchema,
    fkTable,
    skip,
    connectionString,
    fkColumn,
    setFkColumns,
    setFkColumn,
  ]);
}

export function getRowIndicesFromCellKeys(cellKeys: Set<string>): Set<number> {
  const rows = new Set<number>();
  for (const key of cellKeys) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number(key.slice(0, separatorIndex));
    if (Number.isFinite(rowIndex)) rows.add(rowIndex);
  }
  return rows;
}

export function useFkColumnSheetState(selectedSchema?: string | null) {
  const [addForeignKey, setAddForeignKey] = useState(false);
  const [fkSchema, setFkSchema] = useState(selectedSchema || "");
  const [fkTable, setFkTable] = useState("");
  const [fkColumn, setFkColumn] = useState("");
  const [fkOnUpdate, setFkOnUpdate] = useState("NO ACTION");
  const [fkOnDelete, setFkOnDelete] = useState("NO ACTION");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [fkTables, setFkTables] = useState<string[]>([]);
  const [fkColumns, setFkColumns] = useState<string[]>([]);

  return {
    addForeignKey, setAddForeignKey,
    fkSchema, setFkSchema,
    fkTable, setFkTable,
    fkColumn, setFkColumn,
    fkOnUpdate, setFkOnUpdate,
    fkOnDelete, setFkOnDelete,
    schemas, setSchemas,
    fkTables, setFkTables,
    fkColumns, setFkColumns,
  };
}
