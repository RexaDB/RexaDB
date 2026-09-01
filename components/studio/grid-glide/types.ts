import type React from "react";
import type { EditColumnPayload } from "../grid/types";

/**
 * Shared prop contract for the studio data grid. Both the legacy DOM
 * implementation (`components/studio/data-grid.tsx`) and the Glide
 * Data Grid implementation (`components/studio/grid-glide/data-grid.tsx`)
 * implement this exact interface so consumers never need to change during
 * the parallel-run/cutover migration (see PLAN in
 * /Users/virus/.claude/plans/nifty-noodling-mochi.md).
 */
export interface DataGridProps {
  results: any;
  tableStructure: any[];
  customCellRenderer?: (args: {
    row: any;
    columnName: string;
    value: any;
    rowIndex: number;
  }) => React.ReactNode;
  globalSearchQuery?: string;
  pendingActions?: Array<{
    type: string;
    metadata: any;
  }>;
  selectedRows: Set<number>;
  setSelectedRows: (rows: Set<number>) => void;
  toggleAllSelection: () => void;
  toggleRowSelection: (index: number) => void;
  getRowId: (row: any, index: number) => string | null;
  pendingChanges: any;
  setPendingChanges: (changes: any) => void;
  editingCell: any;
  setEditingCell: (cell: any) => void;
  selectedCell: any;
  setSelectedCell: (cell: any) => void;
  selectedColumn: string | null;
  setSelectedColumn: (column: string | null) => void;
  hasChanges: (rowIndex: number, columnName: string) => boolean;
  getChangedValue: (rowIndex: number, columnName: string) => any;
  handleUpdateRow: (
    rowId: string,
    columnName: string,
    oldValue: any,
    newValue: any,
    columnType: string,
  ) => Promise<void>;
  handleFKSelection: (rowIndex: number, columnName: string) => Promise<boolean>;
  handleFKPreview: (columnName: string, value: any) => void;
  loading: boolean;
  fetchingStructure: boolean;
  error: string | null;
  isAddColumnSheetOpen: boolean;
  setIsAddColumnSheetOpen: (open: boolean) => void;
  isAddingColumn: boolean;
  handleAddColumn: (column: any) => Promise<void>;
  handleDeleteColumn?: (columnName: string) => Promise<void>;
  handleEditColumn?: (payload: EditColumnPayload) => Promise<void>;
  columnToDelete: string | null;
  setColumnToDelete: (column: string | null) => void;
  columnToEdit?: string | null;
  setColumnToEdit?: (column: string | null) => void;
  isEditColumnSheetOpen?: boolean;
  setIsEditColumnSheetOpen?: (open: boolean) => void;
  isEditingColumn?: boolean;
  selectedTable: string | null;
  selectedSchema?: string | null;
  sortConfig: { column: string; direction: "ASC" | "DESC" } | null;
  setSortConfig: (
    config: { column: string; direction: "ASC" | "DESC" } | null,
  ) => void;
  pageSize: number;
  page: number;
  totalCount: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onDuplicateRow: (row: any) => void;
  onCopyRowJSON: (row: any) => void;
  onCopyRowCSV: (row: any) => void;
  onFilterByCell?: (columnName: string, value: any) => void;
  onReplaceCell?: (rowIndex: number, columnName: string, newValue: any) => void;
  onReplaceAllCells?: (searchValue: string, replaceValue: string) => number;
  onCellClick?: (
    cell: { rowIndex: number; columnName: string },
    row: any,
  ) => void | Promise<void>;
  onOpenInsertSheet?: () => void;
  onNavigateToTable?: (
    schema: string,
    table: string,
    filterColumn: string,
    filterValue: any,
  ) => void;

  rowSpacing?: "compact" | "standard" | "relaxed";
  alternatingRowColors?: boolean;
  connectionString?: string;
  foreignKeys?: Array<{
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>;
  enums?: Array<{
    schema: string;
    name: string;
    values: string[];
  }>;
  enableColumnHover?: boolean;
  showAddColumn?: boolean;
  showHeaderIcons?: boolean;
  renderSelectionCell?: (row: any) => React.ReactNode;
  selectionColumnWidth?: number;
  stickySelectionColumn?: boolean;
  stickyFirstDataColumn?: boolean;
  stickyHeader?: boolean;
  showPaginationFooter?: boolean;
  isKeyboardInputSuspended?: boolean;

  glassmorphicHeaders?: boolean;
  gridAnimations?: boolean;
  sleekSelection?: boolean;
  colorizedPills?: boolean;
  relativeDates?: boolean;
  richJsonInspector?: boolean;
  dataBars?: boolean;
  skeletonLoaders?: boolean;
  whimsicalEmptyStates?: boolean;
  hiddenColumns?: string[];
  pendingSearchValue?: string | null;
  onConsumeSearchValue?: () => void;
}
