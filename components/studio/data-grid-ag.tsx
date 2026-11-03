"use client";

import React, { useMemo } from "react";
import { DataTableProvider, type DataTableComponentOverrides } from "@rexadbapp/data-table";
import {
  DataGrid as GlideDataGrid,
  type DataGridProps as LibraryDataGridProps,
} from "@rexadbapp/data-table/grid";
import { useTheme } from "@/components/providers/theme-provider";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { fetchReferencedRecord, fetchTableForeignKeys } from "@/lib/api/actions-client";
import { ChevronLeft, ChevronRight } from "@/lib/icon-theme/lucide-react";
import { AddColumnSheet } from "./grid/add-column-sheet";
import { EditColumnSheet } from "./grid/edit-column-sheet";
import type { EditColumnPayload } from "./grid/types";

/** The grid's props as the studio uses them: the connection drives the database lookups. */
export type DataGridProps = Omit<
  LibraryDataGridProps,
  | "handleEditColumn"
  | "fetchReferencedRecord"
  | "fetchForeignKeys"
  | "renderAddColumnSheet"
  | "renderEditColumnSheet"
  | "onRetry"
  | "onRefresh"
  | "themeKey"
  | "colorScheme"
> & {
  connectionString?: string;
  handleEditColumn?: (payload: EditColumnPayload) => Promise<void>;
};

// The grid's footers use the icon-theme chevrons; the list tables use plain lucide.
const GRID_COMPONENTS: DataTableComponentOverrides = {
  icons: { ChevronLeft, ChevronRight },
};

const refreshCurrentTab = () =>
  window.dispatchEvent(new CustomEvent("studio:refresh-current-tab"));

/**
 * Every consumer in the app reaches the grid through this file, so this is
 * the single entry point for the Glide Data Grid (`@rexadbapp/data-table/grid`).
 * It connects the grid to the studio: FK lookups over the connection, the
 * column DDL sheets, tab refresh, and the app theme.
 */
export const DataGridAg = React.memo(function DataGridAg({
  connectionString,
  ...props
}: DataGridProps) {
  const { resolvedTheme } = useTheme();
  const { appThemeId, customAppThemes } = useGlobalAppTheme();
  // A new identity whenever the light/dark theme or the custom app theme
  // (id or palette) changes, so the canvas re-reads its CSS variables.
  const themeKey = useMemo(
    () => ({ resolvedTheme, appThemeId, customAppThemes }),
    [resolvedTheme, appThemeId, customAppThemes],
  );

  const fetchReferenced = useMemo<LibraryDataGridProps["fetchReferencedRecord"]>(
    () =>
      connectionString
        ? (schema, table, keyValues) =>
            fetchReferencedRecord(connectionString, schema, table, keyValues)
        : undefined,
    [connectionString],
  );
  const fetchForeignKeys = useMemo<LibraryDataGridProps["fetchForeignKeys"]>(
    () =>
      connectionString
        ? (schema, table) => fetchTableForeignKeys(connectionString, schema, table)
        : undefined,
    [connectionString],
  );

  const {
    handleAddColumn,
    isAddingColumn,
    handleEditColumn,
    isEditingColumn,
    tableStructure,
    foreignKeys,
    enums,
  } = props;

  return (
    <DataTableProvider components={GRID_COMPONENTS}>
      <GlideDataGrid
        {...props}
        colorScheme={resolvedTheme === "dark" ? "dark" : "light"}
        fetchForeignKeys={fetchForeignKeys}
        fetchReferencedRecord={fetchReferenced}
        onRefresh={refreshCurrentTab}
        onRetry={refreshCurrentTab}
        renderAddColumnSheet={
          connectionString
            ? ({ open, onOpenChange, schema, table }) => (
                <AddColumnSheet
                  isOpen={open}
                  onOpenChange={onOpenChange}
                  connectionString={connectionString}
                  selectedSchema={schema}
                  tableName={table}
                  onAddColumn={handleAddColumn!}
                  isAdding={!!isAddingColumn}
                />
              )
            : undefined
        }
        renderEditColumnSheet={
          connectionString && handleEditColumn
            ? ({ open, onOpenChange, schema, table, columnName }) => (
                <EditColumnSheet
                  isOpen={open}
                  onOpenChange={onOpenChange}
                  connectionString={connectionString}
                  selectedSchema={schema}
                  tableName={table}
                  columnName={columnName}
                  tableStructure={tableStructure}
                  foreignKeys={foreignKeys}
                  enums={enums}
                  onEditColumn={handleEditColumn}
                  isEditing={!!isEditingColumn}
                />
              )
            : undefined
        }
        themeKey={themeKey}
      />
    </DataTableProvider>
  );
});
