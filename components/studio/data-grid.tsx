import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useId,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Table2 as TableIcon,
  X,
  Plus,
  ExternalLink,
} from "@/lib/icon-theme/lucide-react";
import { GridHeader } from "./grid/grid-header";
import { GridRow } from "./grid/grid-row";
import { GridSearch } from "./grid/grid-search";
import { AddColumnSheet } from "./grid/add-column-sheet";
import {
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";
import { EditColumnSheet } from "./grid/edit-column-sheet";
import { getRowIndicesFromCellKeys } from "./grid/column-sheet-common";
import type { DataGridProps } from "./grid-glide/types";
import { Button } from "@/components/ui/button";
import {
  fetchReferencedRecord,
  fetchTableForeignKeys,
} from "@/lib/api/actions-client";
import { buildHoveredColumnCss } from "@/lib/studio/grid-hover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const DataGrid = React.memo(function DataGrid({
  results,
  tableStructure,
  customCellRenderer,
  globalSearchQuery = "",
  pendingActions = [],
  selectedRows,
  setSelectedRows,
  toggleAllSelection: _toggleAllSelection,
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
  hasChanges,
  handleUpdateRow,
  handleFKSelection,
  handleFKPreview,
  loading,
  error,
  isAddColumnSheetOpen,
  setIsAddColumnSheetOpen,
  isAddingColumn,
  handleAddColumn,
  handleDeleteColumn,
  handleEditColumn,
  columnToDelete,
  setColumnToDelete,
  columnToEdit = null,
  setColumnToEdit = () => {},
  isEditColumnSheetOpen = false,
  setIsEditColumnSheetOpen = () => {},
  isEditingColumn = false,
  selectedTable,
  selectedSchema,
  sortConfig,
  setSortConfig,
  pageSize,
  page,
  totalCount,
  onPageChange,
  onPageSizeChange,
  onDuplicateRow,
  onCopyRowJSON,
  onCopyRowCSV,
  onFilterByCell,
  onCellClick,
  onOpenInsertSheet,
  onNavigateToTable,
  rowSpacing = "relaxed",
  alternatingRowColors = false,
  connectionString = "",
  foreignKeys = [],
  enums = [],
  enableColumnHover = true,
  showAddColumn = true,
  showHeaderIcons = true,
  renderSelectionCell,
  selectionColumnWidth = 48,
  stickySelectionColumn = true,
  stickyFirstDataColumn = true,
  stickyHeader = true,
  showPaginationFooter = true,
  isKeyboardInputSuspended = false,
  glassmorphicHeaders = false,
  gridAnimations = false,
  sleekSelection = false,
  colorizedPills = false,
  relativeDates = false,
  richJsonInspector = false,
  dataBars = false,
  skeletonLoaders = false,
  whimsicalEmptyStates = false,
  hiddenColumns = [],
  pendingSearchValue = null,
  onConsumeSearchValue,
}: DataGridProps) {
  type CellRange = {
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
  };
  const gridInstanceId = useId();

  const onCellClickGuard = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      if (onCellClick) {
        const row = results?.rows?.[cell.rowIndex];
        if (row !== undefined) {
          void onCellClick(cell, row);
        }
      }
    },
    [onCellClick, results?.rows],
  );

  const isActionForThisTable = (action: any) => {
    const schemaName = selectedSchema ?? "";
    const tableName = selectedTable ?? "";
    const isMongo = action.metadata?.database && action.metadata?.collection;
    return isMongo
      ? action.metadata.database === schemaName &&
          action.metadata.collection === tableName
      : action.metadata?.schema === schemaName &&
          action.metadata?.table === tableName;
  };

  const SpacerRow = ({
    height,
    colSpan,
  }: {
    height: number;
    colSpan: number;
  }) =>
    height > 0 ? (
      <tr>
        <td colSpan={colSpan} style={{ height }} />
      </tr>
    ) : null;

  React.useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        setSearchQuery("");
        setCurrentMatchIndex(0);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  React.useEffect(() => {
    if (pendingSearchValue) {
      setIsSearchOpen(true);
      setSearchQuery(pendingSearchValue);
      setCurrentMatchIndex(0);
      onConsumeSearchValue?.();
    }
  }, [pendingSearchValue, onConsumeSearchValue]);

  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [manualColumnWidths, setManualColumnWidths] = useState<
    Record<string, number>
  >({});
  const [selectionRange, setSelectionRange] = useState<CellRange | null>(null);
  const [multiSelectedCells, setMultiSelectedCells] = useState<Set<string>>(
    new Set(),
  );
  const [pressedPreviewCell, setPressedPreviewCell] = useState<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const selectionRangeRef = useRef<CellRange | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const selectionAnchorRef = useRef<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const dragAnchorRef = useRef<{ rowIndex: number; colIndex: number } | null>(
    null,
  );
  const dragCurrentCellRef = useRef<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const pendingClickSelectionRef = useRef<{
    cell: { rowIndex: number; columnName: string };
  } | null>(null);
  const isDragSelectingRef = useRef(false);
  const didDragMoveRef = useRef(false);
  const lastDragRangeRef = useRef<CellRange | null>(null);
  const lastScrollTopRef = useRef(0);
  const scrollDirectionRef = useRef<"up" | "down">("down");
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const lastScrollEventTsRef = useRef<number>(0);
  const scrollVelocityRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isInitialMountFrame, setIsInitialMountFrame] = useState(false);
  const initialMountRafRef = useRef<number | null>(null);
  const [fkPreviewData, setFKPreviewData] = useState<{
    rowIndex: number;
    columnName: string;
    schema: string;
    table: string;
    foreignColumnName: string;
    foreignValue: any;
    data: any;
    fields: any[];
    error?: string;
    loading?: boolean;
    position?: {
      x: number;
      y: number;
      maxHeight?: number;
      width?: number;
      placement?: "above" | "below";
    };
  } | null>(null);
  const [fkPreviewSize, setFKPreviewSize] = useState<{
    width: number;
    height?: number;
  } | null>(null);
  const fkPreviewResizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const [isResizingFK, setIsResizingFK] = useState(false);
  const perfRenderCycleRef = useRef<{
    resultsRef: unknown;
    startedAt: number;
    logged: boolean;
  } | null>(null);
  const prevResultsRef = useRef<unknown>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isCustomPageInput, setIsCustomPageInput] = useState(false);
  const [customPageInputValue, setCustomPageInputValue] = useState("");
  const customPageInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<{ rowIndex: number; columnName: string } | null>(
    null,
  );

  React.useEffect(() => {
    if (isCustomPageInput && customPageInputRef.current) {
      customPageInputRef.current.focus();
      customPageInputRef.current.select();
    }
  }, [isCustomPageInput]);

  const emitGridPerf = React.useCallback(
    (stage: string, extra: Record<string, unknown> = {}) => {
      const payload = {
        stage,
        table: selectedTable ?? null,
        schema: selectedSchema ?? null,
        rows: Array.isArray(results?.rows) ? results.rows.length : 0,
        ...extra,
      };

      console.log("[GridPerf]", payload);
    },
    [results?.rows, selectedSchema, selectedTable],
  );

  const measuredMemo = React.useCallback(
    <T,>(stage: string, compute: () => T): T => {
      const t0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const value = compute();
      const t1 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      emitGridPerf(stage, { durationMs: Math.round((t1 - t0) * 100) / 100 });
      return value;
    },
    [emitGridPerf],
  );

  const pendingDeleteState = useMemo(() => {
    const deletedColumns = new Set<string>();
    const deletedRowIds = new Set<string>();
    const deletedRowWhereClauses: Array<Record<string, any>> = [];
    const schemaName = selectedSchema ?? "";
    const tableName = selectedTable ?? "";

    for (const action of pendingActions) {
      if (action?.type === "delete_column") {
        if (!isActionForThisTable(action)) continue;
        const columnName = action.metadata?.columnName;
        if (typeof columnName === "string" && columnName.trim()) {
          deletedColumns.add(columnName);
        }
      }

      if (action?.type === "delete_row") {
        if (!isActionForThisTable(action)) continue;
        const where = action.metadata?.where;
        if (!where || typeof where !== "object") continue;
        deletedRowWhereClauses.push(where);
        const rowId = Object.entries(where)
          .map(([col, val]) => `${col}:${val}`)
          .join("|");
        if (rowId) {
          deletedRowIds.add(rowId);
        }
      }
    }

    return {
      deletedColumns,
      deletedRowIds,
      deletedRowWhereClauses,
    };
  }, [pendingActions, selectedSchema, selectedTable]);

  const searchTerm = React.useMemo(
    () => globalSearchQuery.trim().toLowerCase(),
    [globalSearchQuery],
  );

  const rowMatchesSearch = React.useCallback(function rowMatchesSearch(
    value: any,
    term: string,
  ): boolean {
    if (!term) return true;
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) {
      return value.some((entry) => rowMatchesSearch(entry, term));
    }
    if (typeof value === "object") {
      return Object.values(value).some((entry) =>
        rowMatchesSearch(entry, term),
      );
    }
    return String(value).toLowerCase().includes(term);
  }, []);

  const normalizeSortDirection = React.useCallback(
    (direction?: string | null): "ASC" | "DESC" => {
      if (String(direction || "").toUpperCase() === "DESC") return "DESC";
      return "ASC";
    },
    [],
  );

  const toSortableValue = React.useCallback((value: any) => {
    if (value === null || value === undefined)
      return { kind: "null" as const, value: null };
    if (typeof value === "number" && Number.isFinite(value))
      return { kind: "number" as const, value };
    if (typeof value === "boolean")
      return { kind: "number" as const, value: value ? 1 : 0 };
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return { kind: "number" as const, value: value.getTime() };
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber))
          return { kind: "number" as const, value: asNumber };
        const asDate = Date.parse(trimmed);
        if (!Number.isNaN(asDate))
          return { kind: "number" as const, value: asDate };
      }
      return { kind: "string" as const, value: value.toLowerCase() };
    }
    try {
      return { kind: "string" as const, value: JSON.stringify(value) };
    } catch {
      return { kind: "string" as const, value: String(value) };
    }
  }, []);

  const filteredRowEntries = React.useMemo(
    () =>
      measuredMemo("filtered-row-entries", () => {
        if (!results?.rows) return [];
        const rows = results.rows as any[];
        let entries = rows.map((row, index) => ({ row, index }));
        if (searchTerm) {
          const fields = results?.fields ?? [];
          const fieldNames = fields.map((f: any) => f.name);
          entries = entries.filter(({ row }) =>
            fieldNames.some((name: string) =>
              rowMatchesSearch(row?.[name], searchTerm),
            ),
          );
        }

        if (sortConfig?.column) {
          const direction = normalizeSortDirection(sortConfig.direction);
          const multiplier = direction === "DESC" ? -1 : 1;
          const column = sortConfig.column;

          entries.sort((a, b) => {
            const aValue = toSortableValue(a.row?.[column]);
            const bValue = toSortableValue(b.row?.[column]);

            if (aValue.kind === "null" && bValue.kind === "null")
              return a.index - b.index;
            if (aValue.kind === "null") return 1;
            if (bValue.kind === "null") return -1;

            if (aValue.kind === "number" && bValue.kind === "number") {
              const diff = aValue.value - bValue.value;
              return diff === 0 ? a.index - b.index : diff * multiplier;
            }

            const aStr = String(aValue.value);
            const bStr = String(bValue.value);
            const diff = aStr.localeCompare(bStr, undefined, {
              sensitivity: "base",
              numeric: true,
            });
            return diff === 0 ? a.index - b.index : diff * multiplier;
          });
        }

        return entries;
      }),
    [
      measuredMemo,
      results?.rows,
      results?.fields,
      rowMatchesSearch,
      searchTerm,
      sortConfig,
      normalizeSortDirection,
      toSortableValue,
    ],
  );

  const selectableRowIndexes = React.useMemo(
    () => filteredRowEntries.map(({ index }) => index),
    [filteredRowEntries],
  );

  const isRowPendingDelete = useCallback(
    (row: any, rowId: string | null) => {
      if (rowId && pendingDeleteState.deletedRowIds.has(rowId)) {
        return true;
      }
      return pendingDeleteState.deletedRowWhereClauses.some((whereClause) =>
        Object.entries(whereClause).every(
          ([column, expected]) => String(row?.[column]) === String(expected),
        ),
      );
    },
    [pendingDeleteState],
  );

  // Close FK preview when clicking outside
  useEffect(() => {
    if (!fkPreviewData) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside the FK preview
      if (!target.closest("[data-fk-preview]")) {
        setFKPreviewData(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [fkPreviewData]);

  const handleHoverColumn = React.useCallback(
    (column: string | null) => {
      if (!enableColumnHover) return;
      setHoveredColumn(column);
    },
    [enableColumnHover],
  );

  const handleToggleFKPreview = React.useCallback(
    async (
      rowIndex: number,
      columnName: string,
      value: any,
      event?: React.MouseEvent,
    ) => {
      // If clicking the same cell, close the preview
      if (
        fkPreviewData?.rowIndex === rowIndex &&
        fkPreviewData?.columnName === columnName
      ) {
        setFKPreviewData(null);
        return;
      }

      // Find the FK relationship info from foreignKeys
      let fk = foreignKeys.find((f) => f.column_name === columnName);
      if (!fk && selectedSchema && selectedTable) {
        const fkRes = await fetchTableForeignKeys(
          connectionString,
          selectedSchema,
          selectedTable,
        );
        if (fkRes.success && fkRes.data) {
          fk = (
            fkRes.data as Array<{
              column_name: string;
              foreign_table_schema: string;
              foreign_table_name: string;
              foreign_column_name: string;
            }>
          ).find((f) => f.column_name === columnName);
        }
      }

      if (!fk || value === null) {
        setFKPreviewData(null);
        return;
      }

      // Calculate position from the button click and clamp within viewport
      const buttonRect = (
        event?.currentTarget as HTMLElement
      )?.getBoundingClientRect();
      const PREVIEW_MAX_WIDTH = 420;
      const PREVIEW_MAX_HEIGHT = 420;
      const VIEWPORT_MARGIN = 12;
      const viewportWidth =
        typeof window !== "undefined"
          ? window.innerWidth
          : PREVIEW_MAX_WIDTH + VIEWPORT_MARGIN * 2;
      const viewportHeight =
        typeof window !== "undefined"
          ? window.innerHeight
          : PREVIEW_MAX_HEIGHT + VIEWPORT_MARGIN * 2;
      const allowedWidth = Math.max(
        280,
        Math.min(PREVIEW_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2),
      );

      let x = buttonRect ? buttonRect.left : VIEWPORT_MARGIN;
      x = Math.min(
        Math.max(VIEWPORT_MARGIN, x),
        Math.max(
          VIEWPORT_MARGIN,
          viewportWidth - allowedWidth - VIEWPORT_MARGIN,
        ),
      );

      const PREVIEW_GAP = 6;
      const belowY = buttonRect
        ? buttonRect.bottom + PREVIEW_GAP
        : VIEWPORT_MARGIN;
      const aboveBottomY = buttonRect
        ? buttonRect.top - PREVIEW_GAP
        : viewportHeight - VIEWPORT_MARGIN;
      const spaceBelow = Math.max(0, viewportHeight - belowY - VIEWPORT_MARGIN);
      const spaceAbove = Math.max(0, aboveBottomY - VIEWPORT_MARGIN);
      const minUsableHeight = 160;

      const shouldOpenBelow =
        spaceBelow >= minUsableHeight || spaceBelow >= spaceAbove;
      const placement: "above" | "below" = shouldOpenBelow ? "below" : "above";
      const y =
        placement === "below"
          ? Math.max(VIEWPORT_MARGIN, belowY)
          : Math.max(VIEWPORT_MARGIN, aboveBottomY);
      const availableHeight = placement === "below" ? spaceBelow : spaceAbove;
      const maxHeight = Math.min(
        PREVIEW_MAX_HEIGHT,
        Math.max(80, availableHeight),
      );

      const position = { x, y, maxHeight, width: allowedWidth, placement };

      // Reset saved size when opening new preview
      setFKPreviewSize(null);
      setFKPreviewData({
        rowIndex,
        columnName,
        schema: fk.foreign_table_schema,
        table: fk.foreign_table_name,
        foreignColumnName: fk.foreign_column_name,
        foreignValue: value,
        data: null,
        fields: [],
        error: undefined,
        loading: true,
        position,
      });

      // Fetch the FK data
      try {
        const res = await fetchReferencedRecord(
          connectionString,
          fk.foreign_table_schema,
          fk.foreign_table_name,
          { [fk.foreign_column_name]: value },
        );

        if (res.success) {
          const fields = Array.isArray(res.fields) ? res.fields : [];
          setFKPreviewData({
            rowIndex,
            columnName,
            schema: fk.foreign_table_schema,
            table: fk.foreign_table_name,
            foreignColumnName: fk.foreign_column_name,
            foreignValue: value,
            data: res.data,
            fields,
            error: undefined,
            loading: false,
            position,
          });
        } else {
          setFKPreviewData({
            rowIndex,
            columnName,
            schema: fk.foreign_table_schema,
            table: fk.foreign_table_name,
            foreignColumnName: fk.foreign_column_name,
            foreignValue: value,
            data: null,
            fields: [],
            error:
              res.error ||
              `Failed to fetch ${fk.foreign_table_schema}.${fk.foreign_table_name}`,
            loading: false,
            position,
          });
        }
      } catch (err) {
        setFKPreviewData({
          rowIndex,
          columnName,
          schema: fk.foreign_table_schema,
          table: fk.foreign_table_name,
          foreignColumnName: fk.foreign_column_name,
          foreignValue: value,
          data: null,
          fields: [],
          error:
            err instanceof Error
              ? err.message
              : "Failed to fetch referenced record.",
          loading: false,
          position,
        });
      }
    },
    [
      fkPreviewData,
      foreignKeys,
      connectionString,
      selectedSchema,
      selectedTable,
    ],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    lastScrollEventTsRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const handleScroll = () => {
      const nextScrollTop = container.scrollTop;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const deltaPx = Math.abs(nextScrollTop - lastScrollTopRef.current);
      const deltaMs = Math.max(1, now - lastScrollEventTsRef.current);
      scrollVelocityRef.current = deltaPx / deltaMs;
      lastScrollEventTsRef.current = now;
      scrollDirectionRef.current =
        nextScrollTop >= lastScrollTopRef.current ? "down" : "up";
      lastScrollTopRef.current = nextScrollTop;
      pendingScrollTopRef.current = nextScrollTop;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setScrollTop(pendingScrollTopRef.current);
      });
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
        setContainerWidth(entry.contentRect.width);
      }
    });

    container.addEventListener("scroll", handleScroll, { passive: true });
    resizeObserver.observe(container);

    // Initial values
    setScrollTop(container.scrollTop);
    setContainerHeight(container.clientHeight);
    setContainerWidth(container.clientWidth);

    // Ensure we check scroll again after a short delay in case of layout shifts
    const timer = setTimeout(() => {
      setScrollTop(container.scrollTop);
      setContainerHeight(container.clientHeight);
      setContainerWidth(container.clientWidth);
    }, 100);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      clearTimeout(timer);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [results]); // Re-run when results change to ensure proper dimensions

  const ROW_HEIGHT =
    rowSpacing === "compact" ? 28 : rowSpacing === "standard" ? 32 : 36;
  const viewportRows = Math.max(1, Math.ceil(containerHeight / ROW_HEIGHT));
  const baseBuffer = Math.max(8, Math.ceil(viewportRows * 0.75));
  const baseForwardBuffer = Math.max(16, Math.ceil(viewportRows * 1.5));
  const speedBoostRows =
    scrollVelocityRef.current > 2
      ? viewportRows
      : scrollVelocityRef.current > 1
        ? Math.ceil(viewportRows / 2)
        : 0;
  const forwardBuffer = baseForwardBuffer + speedBoostRows;
  const backwardBuffer = baseBuffer;
  const isScrollingDown = scrollDirectionRef.current === "down";

  const start = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) -
      (isScrollingDown ? backwardBuffer : forwardBuffer),
  );
  const end = Math.min(
    filteredRowEntries.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) +
      (isScrollingDown ? forwardBuffer : backwardBuffer),
  );
  const initialRenderCap = Math.max(viewportRows + 2, 18);
  const effectiveEnd = isInitialMountFrame
    ? Math.min(end, start + initialRenderCap)
    : end;

  const visibleRows = React.useMemo(
    () =>
      measuredMemo("visible-rows-slice", () => {
        if (!filteredRowEntries.length) return [];
        return filteredRowEntries.slice(start, effectiveEnd);
      }),
    [measuredMemo, filteredRowEntries, start, effectiveEnd],
  );

  const paddingTop = start * ROW_HEIGHT;
  const paddingBottom =
    Math.max(0, filteredRowEntries.length - (start + visibleRows.length)) *
    ROW_HEIGHT;

  const autoColumnWidths = React.useMemo(
    () =>
      measuredMemo("auto-column-widths", () => {
        if (!results?.rows || !results?.fields) return {};

        const widths: Record<string, number> = {};
        const CHAR_WIDTH = 7.5; // Adjusted character width for better readability
        const MIN_WIDTH = 150; // Increased minimum width to accommodate UUIDs
        const MAX_WIDTH = 600; // Increased maximum width for wider columns
        const CELL_PADDING = 20; // Adjusted padding
        const HEADER_ICON_SPACE = 24; // Reduced space for icons

        results.fields.forEach((field: any) => {
          const struct = tableStructure?.find(
            (c) => (c.name || c.column_name) === field.name,
          );
          const isPK = struct?.is_primary_key;
          const isFK = struct?.is_foreign_key;

          // Calculate header width (name + icons)
          let headerWidth = field.name.length * CHAR_WIDTH + HEADER_ICON_SPACE;
          if (isPK) headerWidth += 12; // PK icon
          if (isFK) headerWidth += 12; // FK icon

          // Start with header width as minimum
          let maxLen = Math.ceil(headerWidth / CHAR_WIDTH);

          // Sample rows to find max content length (checking first 1000 rows)
          const rowsToScan = results.rows.slice(0, 1000);
          rowsToScan.forEach((row: any) => {
            const val = row[field.name];
            if (val !== null && val !== undefined) {
              const strLen = String(val).length;
              if (strLen > maxLen) maxLen = strLen;
            }
          });

          widths[field.name] = Math.min(
            MAX_WIDTH,
            Math.max(MIN_WIDTH, maxLen * CHAR_WIDTH + CELL_PADDING),
          );
        });

        return widths;
      }),
    [measuredMemo, results?.rows, results?.fields, tableStructure],
  );

  React.useEffect(() => {
    if (results === prevResultsRef.current) return;
    prevResultsRef.current = results;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    perfRenderCycleRef.current = {
      resultsRef: results,
      startedAt,
      logged: false,
    };
    setIsInitialMountFrame(true);
  }, [results]);

  React.useEffect(() => {
    if (!isInitialMountFrame) return;
    if (initialMountRafRef.current !== null) {
      window.cancelAnimationFrame(initialMountRafRef.current);
    }
    initialMountRafRef.current = window.requestAnimationFrame(() => {
      setIsInitialMountFrame(false);
      initialMountRafRef.current = null;
    });
    return () => {
      if (initialMountRafRef.current !== null) {
        window.cancelAnimationFrame(initialMountRafRef.current);
        initialMountRafRef.current = null;
      }
    };
  }, [isInitialMountFrame]);

  const columnWidths: Record<string, number> = React.useMemo(() => {
    const widths: Record<string, number> = {};
    if (results?.fields) {
      results.fields.forEach((field: any) => {
        widths[field.name] =
          manualColumnWidths[field.name] ?? autoColumnWidths[field.name] ?? 150;
      });
    }
    return widths;
  }, [results?.fields, manualColumnWidths, autoColumnWidths]);

  const columnMaxValues = React.useMemo(() => {
    if (!dataBars || !results?.rows || !results?.fields) return {};
    const maxValues: Record<string, number> = {};
    results.fields.forEach((field: any) => {
      const struct = tableStructure?.find(
        (c) => (c.name || c.column_name) === field.name,
      );
      const type = (struct?.data_type || "").toLowerCase();
      if (
        type.includes("int") ||
        type.includes("float") ||
        type.includes("decimal") ||
        type.includes("numeric")
      ) {
        let max = 0;
        results.rows.forEach((row: any) => {
          const val = Number(row[field.name]);
          if (!isNaN(val) && val > max) max = val;
        });
        maxValues[field.name] = max;
      }
    });
    return maxValues;
  }, [dataBars, results?.rows, results?.fields, tableStructure]);

  const renderedFieldCount = React.useMemo(() => {
    const fields = results?.fields ?? [];
    if (!fields.length) return 0;
    if (!isInitialMountFrame) return fields.length;

    const availableWidth = Math.max(160, containerWidth - 48);
    let used = 0;
    let count = 0;
    for (const field of fields) {
      used += columnWidths[field.name] ?? 150;
      count += 1;
      if (used >= availableWidth) break;
    }
    return Math.max(1, Math.min(fields.length, count + 1));
  }, [results?.fields, isInitialMountFrame, containerWidth, columnWidths]);

  const renderFields = React.useMemo(() => {
    const fields = results?.fields ?? [];
    let filtered = fields;
    if (hiddenColumns && hiddenColumns.length > 0) {
      filtered = fields.filter((f: any) => !hiddenColumns.includes(f.name));
      if (filtered.length === 0) filtered = fields;
    }
    if (renderedFieldCount >= filtered.length) return filtered;
    return filtered.slice(0, renderedFieldCount);
  }, [results?.fields, renderedFieldCount, hiddenColumns]);

  React.useLayoutEffect(() => {
    const cycle = perfRenderCycleRef.current;
    if (!cycle || cycle.logged || cycle.resultsRef !== results) return;
    cycle.logged = true;
    const endAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    emitGridPerf("first-commit", {
      durationMs: Math.round((endAt - cycle.startedAt) * 100) / 100,
      visibleRows: visibleRows.length,
      containerHeight,
      renderedColumns: renderFields.length,
    });
  }, [
    containerHeight,
    emitGridPerf,
    results,
    visibleRows.length,
    renderFields.length,
  ]);

  const fieldIndexByName = React.useMemo(() => {
    const map = new Map<string, number>();
    results?.fields?.forEach((field: any, index: number) => {
      map.set(field.name, index);
    });
    return map;
  }, [results?.fields]);

  const tableStructByName = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const column of tableStructure ?? []) {
      const key = (column?.name || column?.column_name) as string | undefined;
      if (key) map.set(key, column);
    }
    return map;
  }, [tableStructure]);

  const enumByName = React.useMemo(() => {
    const map = new Map<
      string,
      { schema: string; name: string; values: string[] }[]
    >();
    for (const e of enums ?? []) {
      const list = map.get(e.name) ?? [];
      list.push(e);
      map.set(e.name, list);
    }
    return map;
  }, [enums]);

  const selectedDiscreteRows = React.useMemo(
    () => getRowIndicesFromCellKeys(multiSelectedCells),
    [multiSelectedCells],
  );

  const rangeFromCells = React.useCallback(
    (
      from: { rowIndex: number; columnName: string },
      to: { rowIndex: number; columnName: string },
    ) => {
      const fromCol = fieldIndexByName.get(from.columnName);
      const toCol = fieldIndexByName.get(to.columnName);
      if (fromCol === undefined || toCol === undefined) return null;

      return {
        rowStart: Math.min(from.rowIndex, to.rowIndex),
        rowEnd: Math.max(from.rowIndex, to.rowIndex),
        colStart: Math.min(fromCol, toCol),
        colEnd: Math.max(fromCol, toCol),
      };
    },
    [fieldIndexByName],
  );

  const rangesEqual = React.useCallback(
    (a: CellRange | null, b: CellRange | null) => {
      if (!a || !b) return a === b;
      return (
        a.rowStart === b.rowStart &&
        a.rowEnd === b.rowEnd &&
        a.colStart === b.colStart &&
        a.colEnd === b.colEnd
      );
    },
    [],
  );

  const scheduleDragRangeUpdate = React.useCallback(
    (nextRange: CellRange) => {
      if (
        rangesEqual(lastDragRangeRef.current, nextRange) ||
        rangesEqual(selectionRangeRef.current, nextRange)
      ) {
        return;
      }

      lastDragRangeRef.current = nextRange;
      setSelectionRange(nextRange);
      selectionRangeRef.current = nextRange;
    },
    [rangesEqual],
  );

  const clearCellSelection = React.useCallback(() => {
    setSelectedCell(null);
    setSelectionRange(null);
    selectionRangeRef.current = null;
    setSelectionAnchor(null);
    selectionAnchorRef.current = null;
    setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
    setPressedPreviewCell(null);
  }, [setSelectedCell]);

  const toCellKey = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      return `${cell.rowIndex}:${cell.columnName}`;
    },
    [],
  );

  const closeEditingIfDifferentCell = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      if (!editingCell) return;
      if (
        editingCell.rowIndex !== cell.rowIndex ||
        editingCell.columnName !== cell.columnName
      ) {
        setEditingCell(null);
      }
    },
    [editingCell, setEditingCell],
  );

  const setSingleCellSelection = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      const colIndex = fieldIndexByName.get(cell.columnName);
      if (colIndex === undefined) return;
      closeEditingIfDifferentCell(cell);
      setSelectedCell(cell);
      setSelectionRange({
        rowStart: cell.rowIndex,
        rowEnd: cell.rowIndex,
        colStart: colIndex,
        colEnd: colIndex,
      });
      selectionRangeRef.current = {
        rowStart: cell.rowIndex,
        rowEnd: cell.rowIndex,
        colStart: colIndex,
        colEnd: colIndex,
      };
      setSelectionAnchor(cell);
      selectionAnchorRef.current = cell;
      setSelectedColumn(null);
      setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
    },
    [
      closeEditingIfDifferentCell,
      fieldIndexByName,
      setSelectedCell,
      setSelectedColumn,
    ],
  );

  const handleToggleAllSelection = React.useCallback(() => {
    if (!selectableRowIndexes.length) {
      if (selectedRows.size > 0) setSelectedRows(new Set());
      return;
    }
    const allVisibleSelected = selectableRowIndexes.every((index) =>
      selectedRows.has(index),
    );
    if (allVisibleSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(selectableRowIndexes));
    }
  }, [selectableRowIndexes, selectedRows, setSelectedRows]);

  const toggleSelectAllGrid = React.useCallback(() => {
    handleToggleAllSelection();
    // Cmd/Ctrl+A should only affect row selection.
    clearCellSelection();
    setSelectedColumn(null);
  }, [clearCellSelection, handleToggleAllSelection, setSelectedColumn]);

  const focusGridContainer = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (document.activeElement !== container) {
      container.focus();
    }
  }, []);

  const selectCellRange = React.useCallback(
    (
      from: { rowIndex: number; columnName: string },
      to: { rowIndex: number; columnName: string },
    ) => {
      const nextRange = rangeFromCells(from, to);
      if (!nextRange) return;
      closeEditingIfDifferentCell(to);
      setSelectionRange(nextRange);
      selectionRangeRef.current = nextRange;
      setSelectedCell(to);
      setSelectedColumn(null);
      setSelectionAnchor(from);
      selectionAnchorRef.current = from;
      setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
    },
    [
      closeEditingIfDifferentCell,
      rangeFromCells,
      setSelectedCell,
      setSelectedColumn,
    ],
  );

  const handleCellSelect = React.useCallback(
    (
      cell: { rowIndex: number; columnName: string },
      event: React.MouseEvent,
    ) => {
      setPressedPreviewCell(null);
      if (didDragMoveRef.current) {
        didDragMoveRef.current = false;
        pendingClickSelectionRef.current = null;
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        pendingClickSelectionRef.current = null;
        closeEditingIfDifferentCell(cell);
        const existingRange = selectionRangeRef.current;
        setSelectedColumn(null);
        setSelectionAnchor(cell);
        selectionAnchorRef.current = cell;
        setSelectedCell(cell);
        const cellKey = toCellKey(cell);
        setMultiSelectedCells((prev) => {
          const next = new Set(prev);
          // When entering cmd/ctrl multi-select mode, preserve the prior selection.
          if (next.size === 0 && existingRange && results?.fields?.length) {
            for (
              let rowIndex = existingRange.rowStart;
              rowIndex <= existingRange.rowEnd;
              rowIndex += 1
            ) {
              for (
                let colIndex = existingRange.colStart;
                colIndex <= existingRange.colEnd;
                colIndex += 1
              ) {
                const columnName = results.fields[colIndex]?.name;
                if (columnName) {
                  next.add(`${rowIndex}:${columnName}`);
                }
              }
            }
          } else if (next.size === 0 && selectedCell) {
            next.add(toCellKey(selectedCell));
          }
          if (next.has(cellKey)) next.delete(cellKey);
          else next.add(cellKey);
          return next;
        });
        setSelectionRange(null);
        selectionRangeRef.current = null;
        focusGridContainer();
        onCellClickGuard(cell);
        return;
      }
      const anchor = selectionAnchorRef.current;
      if (event.shiftKey && anchor) {
        pendingClickSelectionRef.current = null;
        setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
        selectCellRange(anchor, cell);
        focusGridContainer();
        return;
      }
      const pendingClick = pendingClickSelectionRef.current;
      if (
        pendingClick &&
        pendingClick.cell.rowIndex === cell.rowIndex &&
        pendingClick.cell.columnName === cell.columnName
      ) {
        pendingClickSelectionRef.current = null;
        setSingleCellSelection(cell);
        focusGridContainer();
        onCellClickGuard(cell);
        return;
      }
      pendingClickSelectionRef.current = null;
      setSingleCellSelection(cell);
      focusGridContainer();
      onCellClickGuard(cell);
    },
    [
      closeEditingIfDifferentCell,
      focusGridContainer,
      onCellClick,
      results?.fields,
      results?.rows,
      selectCellRange,
      selectedCell,
      setSelectedCell,
      setSelectedColumn,
      setSingleCellSelection,
      toCellKey,
    ],
  );

  const handleCellMouseDown = React.useCallback(
    (
      cell: { rowIndex: number; columnName: string },
      event: React.MouseEvent,
    ) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey) return;
      const colIndex = fieldIndexByName.get(cell.columnName);
      if (colIndex === undefined) return;

      if (event.shiftKey) return;

      event.preventDefault();
      closeEditingIfDifferentCell(cell);
      setSelectedCell(cell);
      setSelectedColumn(null);
      setSelectionAnchor(cell);
      selectionAnchorRef.current = cell;
      const initialRange = {
        rowStart: cell.rowIndex,
        rowEnd: cell.rowIndex,
        colStart: colIndex,
        colEnd: colIndex,
      };
      setSelectionRange(initialRange);
      selectionRangeRef.current = initialRange;
      lastDragRangeRef.current = initialRange;
      setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
      setPressedPreviewCell(cell);
      pendingClickSelectionRef.current = {
        cell,
      };
      focusGridContainer();
      dragAnchorRef.current = { rowIndex: cell.rowIndex, colIndex };
      dragCurrentCellRef.current = cell;
      didDragMoveRef.current = false;
    },
    [
      closeEditingIfDifferentCell,
      fieldIndexByName,
      focusGridContainer,
      setSelectedCell,
      setSelectedColumn,
    ],
  );

  const handleCellMouseEnter = React.useCallback(
    (
      cell: { rowIndex: number; columnName: string },
      event: React.MouseEvent,
    ) => {
      if ((event.buttons & 1) !== 1) return;
      const anchor = dragAnchorRef.current;
      const currentCol = fieldIndexByName.get(cell.columnName);
      if (!anchor || currentCol === undefined) return;
      if (!isDragSelectingRef.current) {
        isDragSelectingRef.current = true;
      }
      preventTextSelection();
      didDragMoveRef.current = true;
      dragCurrentCellRef.current = cell;
      const nextRange = {
        rowStart: Math.min(anchor.rowIndex, cell.rowIndex),
        rowEnd: Math.max(anchor.rowIndex, cell.rowIndex),
        colStart: Math.min(anchor.colIndex, currentCol),
        colEnd: Math.max(anchor.colIndex, currentCol),
      };
      scheduleDragRangeUpdate(nextRange);
    },
    [fieldIndexByName, scheduleDragRangeUpdate],
  );

  const handleCellContextMenu = React.useCallback(
    (
      cell: { rowIndex: number; columnName: string },
      _event: React.MouseEvent,
    ) => {
      const cellKey = toCellKey(cell);
      if (multiSelectedCells.has(cellKey)) {
        return;
      }
      const colIndex = fieldIndexByName.get(cell.columnName);
      if (colIndex === undefined) return;
      const currentRange = selectionRangeRef.current;
      if (
        currentRange &&
        cell.rowIndex >= currentRange.rowStart &&
        cell.rowIndex <= currentRange.rowEnd &&
        colIndex >= currentRange.colStart &&
        colIndex <= currentRange.colEnd
      ) {
        return;
      }
      setSingleCellSelection(cell);
      focusGridContainer();
    },
    [
      fieldIndexByName,
      focusGridContainer,
      multiSelectedCells,
      setSingleCellSelection,
      toCellKey,
    ],
  );

  useEffect(() => {
    const stopMetaDrag = () => {
      const wasDragSelecting = isDragSelectingRef.current;
      isDragSelectingRef.current = false;
      dragAnchorRef.current = null;
      if (
        wasDragSelecting &&
        didDragMoveRef.current &&
        dragCurrentCellRef.current
      ) {
        // Finalize to range mode and keep anchor on drag origin.
        setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
        setSelectedCell(dragCurrentCellRef.current);
        pendingClickSelectionRef.current = null;
      }
      setPressedPreviewCell(null);
      dragCurrentCellRef.current = null;
      didDragMoveRef.current = false;
      lastDragRangeRef.current = null;
      allowTextSelection();
    };
    window.addEventListener("mouseup", stopMetaDrag);
    return () => {
      window.removeEventListener("mouseup", stopMetaDrag);
      allowTextSelection();
    };
  }, [setSelectedCell]);

  useEffect(() => {
    if (selectedCell === null) {
      setSelectionRange(null);
      selectionRangeRef.current = null;
      setSelectionAnchor(null);
      selectionAnchorRef.current = null;
      isDragSelectingRef.current = false;
      dragAnchorRef.current = null;
      dragCurrentCellRef.current = null;
      pendingClickSelectionRef.current = null;
      lastDragRangeRef.current = null;
      setMultiSelectedCells((prev) => (prev.size === 0 ? prev : new Set()));
      setPressedPreviewCell(null);
    }
  }, [selectedCell]);

  const selectedCellCount = React.useMemo(() => {
    if (multiSelectedCells.size > 0) return multiSelectedCells.size;
    if (!selectionRange) return 0;
    return (
      (selectionRange.rowEnd - selectionRange.rowStart + 1) *
      (selectionRange.colEnd - selectionRange.colStart + 1)
    );
  }, [multiSelectedCells, selectionRange]);
  const hasMultiCellSelection = selectedCellCount > 1;

  const getCellValue = React.useCallback(
    (rowIndex: number, columnName: string) => {
      const row = results?.rows?.[rowIndex];
      if (!row) return null;

      const rowId = getRowId(row, rowIndex);
      const rowPendingChanges = rowId ? pendingChanges[rowId] : undefined;
      if (rowPendingChanges && columnName in rowPendingChanges) {
        return rowPendingChanges[columnName].new;
      }
      return row[columnName];
    },
    [getRowId, pendingChanges, results?.rows],
  );

  const toClipboardValue = React.useCallback((value: any) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }, []);

  const buildSelectedCellsClipboard = React.useCallback(
    (includeHeaders: boolean) => {
      if (!results?.fields?.length) return "";

      if (multiSelectedCells.size > 0) {
        const lines: string[] = [];
        if (includeHeaders) {
          lines.push("row\tcolumn\tvalue");
        }
        const sortedCells = Array.from(multiSelectedCells)
          .map((key) => {
            const separatorIndex = key.indexOf(":");
            const rowIndex = Number(key.slice(0, separatorIndex));
            const columnName = key.slice(separatorIndex + 1);
            const colIndex =
              fieldIndexByName.get(columnName) ?? Number.POSITIVE_INFINITY;
            return { rowIndex, columnName, colIndex };
          })
          .filter(
            ({ rowIndex, columnName }) =>
              Number.isFinite(rowIndex) && !!columnName,
          )
          .sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);

        for (const cell of sortedCells) {
          lines.push(
            `${cell.rowIndex + 1}\t${cell.columnName}\t${toClipboardValue(getCellValue(cell.rowIndex, cell.columnName))}`,
          );
        }
        return lines.join("\n");
      }

      if (!selectionRange) return "";

      const lines: string[] = [];
      if (includeHeaders) {
        const headerValues: string[] = [];
        for (
          let colIndex = selectionRange.colStart;
          colIndex <= selectionRange.colEnd;
          colIndex += 1
        ) {
          headerValues.push(results.fields[colIndex].name);
        }
        lines.push(headerValues.join("\t"));
      }

      for (
        let rowIndex = selectionRange.rowStart;
        rowIndex <= selectionRange.rowEnd;
        rowIndex += 1
      ) {
        const rowValues: string[] = [];
        for (
          let colIndex = selectionRange.colStart;
          colIndex <= selectionRange.colEnd;
          colIndex += 1
        ) {
          const columnName = results.fields[colIndex].name;
          rowValues.push(toClipboardValue(getCellValue(rowIndex, columnName)));
        }
        lines.push(rowValues.join("\t"));
      }

      return lines.join("\n");
    },
    [
      fieldIndexByName,
      getCellValue,
      multiSelectedCells,
      results?.fields,
      selectionRange,
      toClipboardValue,
    ],
  );

  const buildSelectedRowsClipboard = React.useCallback(
    (includeHeaders: boolean) => {
      if (!results?.fields?.length) return "";
      if (selectedRows.size === 0) return "";
      const lines: string[] = [];
      if (includeHeaders) {
        lines.push(results.fields.map((field: any) => field.name).join("\t"));
      }
      const sortedRows = Array.from(selectedRows).sort((a, b) => a - b);
      for (const rowIndex of sortedRows) {
        const rowValues = results.fields.map((field: any) =>
          toClipboardValue(getCellValue(rowIndex, field.name)),
        );
        lines.push(rowValues.join("\t"));
      }
      return lines.join("\n");
    },
    [getCellValue, results?.fields, selectedRows, toClipboardValue],
  );

  const copySelectedCells = React.useCallback(
    async (includeHeaders: boolean) => {
      const text = buildSelectedCellsClipboard(includeHeaders);
      if (!text) return;
      await navigator.clipboard.writeText(text);
    },
    [buildSelectedCellsClipboard],
  );

  const copySelectedRows = React.useCallback(
    async (includeHeaders: boolean) => {
      const text = buildSelectedRowsClipboard(includeHeaders);
      if (!text) return;
      await navigator.clipboard.writeText(text);
    },
    [buildSelectedRowsClipboard],
  );

  const copySingleCell = React.useCallback(
    async (cell: { rowIndex: number; columnName: string }) => {
      const text = toClipboardValue(
        getCellValue(cell.rowIndex, cell.columnName),
      );
      await navigator.clipboard.writeText(text);
    },
    [getCellValue, toClipboardValue],
  );

  const handleCopySelectedCells = React.useCallback(() => {
    void copySelectedCells(true);
  }, [copySelectedCells]);

  const handleCopySelectedCellValues = React.useCallback(() => {
    void copySelectedCells(false);
  }, [copySelectedCells]);

  const handleSelectRowsFromSelectedCells = React.useCallback(() => {
    if (multiSelectedCells.size > 0) {
      const rows = getRowIndicesFromCellKeys(multiSelectedCells);
      if (rows.size === 0) return;
      setSelectedRows(rows);
      return;
    }

    const range = selectionRangeRef.current ?? selectionRange;
    if (!range) return;
    const rows = new Set<number>();
    for (
      let rowIndex = range.rowStart;
      rowIndex <= range.rowEnd;
      rowIndex += 1
    ) {
      rows.add(rowIndex);
    }
    if (rows.size === 0) return;
    setSelectedRows(rows);
  }, [multiSelectedCells, selectionRange, setSelectedRows]);

  const discardPendingChangeForCell = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      const row = results?.rows?.[cell.rowIndex];
      if (!row) return false;
      const rowId = getRowId(row, cell.rowIndex);
      if (!rowId) return false;

      let changed = false;
      setPendingChanges((prev: any) => {
        if (!prev?.[rowId] || !(cell.columnName in prev[rowId])) return prev;
        const next = { ...prev };
        const rowChanges = { ...next[rowId] };
        delete rowChanges[cell.columnName];
        if (Object.keys(rowChanges).length === 0) {
          delete next[rowId];
        } else {
          next[rowId] = rowChanges;
        }
        changed = true;
        return next;
      });
      return changed;
    },
    [results?.rows, getRowId, setPendingChanges],
  );

  const ensureCellInView = React.useCallback(
    (cell: { rowIndex: number; columnName: string }) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const thead = container.querySelector("thead") as HTMLElement | null;
      const headerHeight = thead?.getBoundingClientRect().height ?? 40;
      const rowTop = headerHeight + cell.rowIndex * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < container.scrollTop) {
        container.scrollTop = Math.max(0, rowTop - headerHeight);
      } else if (rowBottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
      const colIndex = fieldIndexByName.get(cell.columnName);
      if (colIndex === undefined) return;
      const firstFieldName = results.fields?.[0]?.name;
      const selectionWidth = stickySelectionColumn ? selectionColumnWidth : 0;
      const firstDataColWidth =
        stickyFirstDataColumn && firstFieldName
          ? (columnWidths[firstFieldName] ?? 150)
          : 0;
      const pinnedWidth = selectionWidth + firstDataColWidth;
      const gutter = 6;
      const cellEl = container.querySelector(
        `td[data-column-name="${cell.columnName}"][data-row-index="${cell.rowIndex}"]`,
      ) as HTMLElement | null;
      if (cellEl) {
        const cellRect = cellEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const visibleLeft = containerRect.left + pinnedWidth + gutter;
        const visibleRight = containerRect.right - gutter;
        if (cellRect.left < visibleLeft) {
          container.scrollLeft = Math.max(
            0,
            container.scrollLeft - (visibleLeft - cellRect.left),
          );
        } else if (cellRect.right > visibleRight) {
          container.scrollLeft = Math.max(
            0,
            container.scrollLeft + (cellRect.right - visibleRight),
          );
        }
      } else {
        let left = selectionWidth;
        for (let i = 0; i < colIndex; i += 1) {
          const name = results.fields[i].name;
          left += columnWidths[name] ?? 150;
        }
        const right = left + (columnWidths[cell.columnName] ?? 150);
        const viewLeft = container.scrollLeft;
        const coveredLeft = viewLeft + pinnedWidth;
        const viewRight = viewLeft + container.clientWidth;
        if (left < coveredLeft) {
          container.scrollLeft = Math.max(0, left - pinnedWidth - gutter);
        } else if (right > viewRight) {
          container.scrollLeft = Math.max(
            0,
            right - container.clientWidth + gutter,
          );
        }
      }
    },
    [
      ROW_HEIGHT,
      fieldIndexByName,
      columnWidths,
      results?.fields,
      selectionColumnWidth,
      stickyFirstDataColumn,
      stickySelectionColumn,
    ],
  );

  const focusGridWithFallbackCell = React.useCallback(() => {
    if (!results?.fields?.length || !results?.rows?.length) return;
    const targetCell = selectedCell ?? {
      rowIndex: 0,
      columnName: results.fields[0].name,
    };
    setSingleCellSelection(targetCell);
    focusGridContainer();
    ensureCellInView(targetCell);
  }, [
    results?.fields,
    results?.rows,
    selectedCell,
    setSingleCellSelection,
    focusGridContainer,
    ensureCellInView,
  ]);

  const handleGridKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isKeyboardInputSuspended) return;
      const target = event.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        target.isContentEditable ||
        editingCell
      )
        return;
      if (!results?.fields?.length || !results?.rows?.length) return;
      const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        toggleSelectAllGrid();
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        setIsSearchOpen(true);
        setSearchQuery("");
        setCurrentMatchIndex(0);
        return;
      }

      if (isSearchOpen && event.key === "Escape") {
        event.preventDefault();
        setIsSearchOpen(false);
        setSearchQuery("");
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "i"
      ) {
        if (onOpenInsertSheet) {
          event.preventDefault();
          onOpenInsertSheet();
          return;
        }
      }

      if (
        !hasCommandModifier &&
        !event.shiftKey &&
        event.key.toLowerCase() === "i"
      ) {
        event.preventDefault();
        const firstCell = { rowIndex: 0, columnName: results.fields[0].name };
        setSingleCellSelection(firstCell);
        ensureCellInView(firstCell);
        return;
      }

      const isPlainNavigationKey =
        !hasCommandModifier &&
        (event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "Enter");
      if (!selectedCell && isPlainNavigationKey) {
        event.preventDefault();
        const firstCell = { rowIndex: 0, columnName: results.fields[0].name };
        setSingleCellSelection(firstCell);
        ensureCellInView(firstCell);
        return;
      }

      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "d"
      ) {
        if (!selectedCell) return;
        if (!hasChanges(selectedCell.rowIndex, selectedCell.columnName)) return;
        event.preventDefault();
        discardPendingChangeForCell(selectedCell);
        return;
      }

      const activeCell = selectedCell ?? {
        rowIndex: 0,
        columnName: results.fields[0].name,
      };
      const currentCol = fieldIndexByName.get(activeCell.columnName) ?? 0;
      let nextCell = activeCell;

      if (event.key === "ArrowUp" && !hasCommandModifier) {
        event.preventDefault();
        nextCell = {
          ...activeCell,
          rowIndex: Math.max(0, activeCell.rowIndex - 1),
        };
      } else if (event.key === "ArrowDown" && !hasCommandModifier) {
        event.preventDefault();
        nextCell = {
          ...activeCell,
          rowIndex: Math.min(results.rows.length - 1, activeCell.rowIndex + 1),
        };
      } else if (event.key === "ArrowLeft" && !hasCommandModifier) {
        event.preventDefault();
        const nextCol = Math.max(0, currentCol - 1);
        nextCell = { ...activeCell, columnName: results.fields[nextCol].name };
      } else if (event.key === "ArrowRight" && !hasCommandModifier) {
        event.preventDefault();
        const nextCol = Math.min(results.fields.length - 1, currentCol + 1);
        nextCell = { ...activeCell, columnName: results.fields[nextCol].name };
      } else if (event.key === "Enter" && !hasCommandModifier) {
        event.preventDefault();
        const struct = tableStructure?.find(
          (c) => (c.name || c.column_name) === activeCell.columnName,
        );
        const isFK = struct?.is_foreign_key;
        if (isFK && !event.shiftKey) {
          void handleFKSelection(activeCell.rowIndex, activeCell.columnName);
        } else {
          setEditingCell({
            rowIndex: activeCell.rowIndex,
            columnName: activeCell.columnName,
          });
        }
        return;
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "c"
      ) {
        if (selectedRows.size > 0) {
          event.preventDefault();
          void copySelectedRows(true);
          return;
        }
        if (hasMultiCellSelection || selectionRange) {
          event.preventDefault();
          void copySelectedCells(false);
          return;
        }
        if (selectedCell) {
          event.preventDefault();
          void copySingleCell(selectedCell);
          return;
        }
        return;
      } else {
        return;
      }

      if (event.shiftKey && selectionAnchor) {
        selectCellRange(selectionAnchor, nextCell);
      } else {
        setSingleCellSelection(nextCell);
      }
      ensureCellInView(nextCell);
    },
    [
      copySelectedCells,
      copySelectedRows,
      copySingleCell,
      discardPendingChangeForCell,
      editingCell,
      ensureCellInView,
      fieldIndexByName,
      handleFKSelection,
      hasChanges,
      hasMultiCellSelection,
      isKeyboardInputSuspended,
      onOpenInsertSheet,
      results?.fields,
      results?.rows,
      selectCellRange,
      selectedCell,
      selectionAnchor,
      selectionRange,
      selectedRows.size,
      setEditingCell,
      setSingleCellSelection,
      tableStructure,
      toggleSelectAllGrid,
    ],
  );

  React.useEffect(() => {
    if (editingCell) return;
    if (!selectedCell) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const active = document.activeElement as HTMLElement | null;
    // Only reclaim focus if no interactive element outside the grid currently holds it.
    // This prevents stealing keyboard focus from inputs, textareas, Monaco editor, etc.
    const isInteractiveExternalFocus =
      active &&
      active !== document.body &&
      active !== container &&
      !container.contains(active) &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        !!active.isContentEditable ||
        !!active.closest(".monaco-editor") ||
        !!active.closest('[role="dialog"]') ||
        !!active.closest("[data-radix-popper-content-wrapper]"));
    if (isInteractiveExternalFocus) return;
    if (document.activeElement !== container) {
      container.focus();
    }
  }, [editingCell, selectedCell]);

  React.useEffect(() => {
    if (editingCell) return;
    if (!results?.fields?.length || !results?.rows?.length) return;
    const active = document.activeElement as HTMLElement | null;
    const container = scrollContainerRef.current;
    // Only auto-focus the grid on data load if nothing else interactive holds focus.
    // Specifically, never steal focus from inputs, textareas, Monaco, or dialogs.
    const isSafeToClaim =
      !active ||
      active === document.body ||
      active === container ||
      (container && container.contains(active));
    if (!isSafeToClaim) return;
    focusGridContainer();
  }, [editingCell, results?.fields, results?.rows, focusGridContainer]);

  // Register global helpers to clear selections
  useEffect(() => {
    (window as any).__studio_clear_cell_selection = () => clearCellSelection();
    (window as any).__studio_clear_column_selection = () =>
      setSelectedColumn(null);
    return () => {
      delete (window as any).__studio_clear_cell_selection;
      delete (window as any).__studio_clear_column_selection;
    };
  }, [clearCellSelection, setSelectedColumn]);

  useEffect(() => {
    if (selectedColumn !== null) {
      clearCellSelection();
    }
  }, [selectedColumn, clearCellSelection]);

  useEffect(() => {
    const handleGridFocusRequest = () => {
      focusGridWithFallbackCell();
    };

    window.addEventListener(
      "studio:grid-focus-request",
      handleGridFocusRequest,
    );
    return () => {
      window.removeEventListener(
        "studio:grid-focus-request",
        handleGridFocusRequest,
      );
    };
  }, [focusGridWithFallbackCell]);

  // FK preview resize pointer events
  useEffect(() => {
    if (!isResizingFK) return;
    const handlePointerMove = (e: PointerEvent) => {
      if (!fkPreviewResizeRef.current) return;
      const { startX, startY, startW, startH } = fkPreviewResizeRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const newW = Math.max(280, Math.min(Math.round(vw * 0.8), startW + dx));
      const newH = Math.max(120, Math.min(Math.round(vh * 0.8), startH + dy));
      setFKPreviewSize({ width: newW, height: newH });
    };
    const handlePointerUp = () => {
      setIsResizingFK(false);
      fkPreviewResizeRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);

    window.addEventListener("pointerup", handlePointerUp);
    document.body.style.cursor = "nwse-resize";
    preventTextSelection();
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      allowTextSelection();
    };
  }, [isResizingFK]);

  const handleAddColumnClick = useCallback(
    () => setIsAddColumnSheetOpen(true),
    [setIsAddColumnSheetOpen],
  );
  const handleColumnDeleteRequest = useCallback(
    (columnName: string) => setColumnToDelete(columnName),
    [setColumnToDelete],
  );
  const handleColumnDeleteCancel = useCallback(
    (open: boolean) => !open && setColumnToDelete(null),
    [setColumnToDelete],
  );
  const canEditColumn = Boolean(handleEditColumn);
  const handleColumnEditRequest = useCallback(
    (columnName: string) => {
      if (!canEditColumn) return;
      setColumnToEdit(columnName);
      setIsEditColumnSheetOpen(true);
    },
    [canEditColumn, setColumnToEdit, setIsEditColumnSheetOpen],
  );
  const handlePrevPage = useCallback(
    () => onPageChange(page - 1),
    [onPageChange, page],
  );
  const handleNextPage = useCallback(
    () => onPageChange(page + 1),
    [onPageChange, page],
  );
  const handlePageSizeUpdate = useCallback(
    (value: string) => {
      if (value === "custom") {
        setCustomPageInputValue(pageSize.toString());
        setIsCustomPageInput(true);
      } else {
        onPageSizeChange(parseInt(value));
      }
    },
    [onPageSizeChange, pageSize],
  );
  const handleCustomPageSizeSubmit = useCallback(() => {
    const parsed = parseInt(customPageInputValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onPageSizeChange(parsed);
    }
    setIsCustomPageInput(false);
  }, [customPageInputValue, onPageSizeChange]);
  const pageSizeOptions = useMemo(() => {
    const predefined = [25, 50, 100, 200, 500];
    return predefined.includes(pageSize)
      ? predefined
      : [...predefined, pageSize].sort((a, b) => a - b);
  }, [pageSize]);
  const totalPages =
    totalCount !== null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;
  const recordLabel =
    totalCount !== null
      ? `${totalCount} ${totalCount === 1 ? "record" : "records"}`
      : `${filteredRowEntries.length} ${filteredRowEntries.length === 1 ? "record" : "records"}`;
  const handleColumnWidthChange = useCallback(
    (columnName: string, width: number) => {
      const clamped = Math.max(80, Math.min(1200, width));
      setManualColumnWidths((prev) => ({ ...prev, [columnName]: clamped }));
    },
    [],
  );

  if (!results && !loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
            <TableIcon className="w-8 h-8 opacity-20" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {error ? "Failed to load data" : "No table selected"}
          </h3>
          <p className="text-xs">
            {error ||
              "Select a table from the sidebar to view its data directly."}
          </p>
          {error && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("studio:refresh-current-tab"),
                )
              }
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  const showWhimsicalEmptyState =
    whimsicalEmptyStates && results && results.rows.length === 0 && !loading;

  if (showWhimsicalEmptyState) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-studio-bg animate-in fade-in duration-500">
        <div className="text-center max-w-md px-6">
          <div className="w-24 h-24 bg-studio-accent-purple/10 rounded-lg flex items-center justify-center mx-auto mb-6 relative">
            <TableIcon className="w-12 h-12 text-studio-accent-purple" />
            <div className="absolute -right-1 -top-1 w-8 h-8 bg-studio-bg border-2 border-studio-accent-purple rounded-lg flex items-center justify-center animate-bounce">
              <Plus className="w-4 h-4 text-studio-accent-purple" />
            </div>
          </div>
          <h3 className="text-sm font-bold text-foreground mb-2">
            This table is currently empty
          </h3>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Ready to start building? Insert your first row manually or use the
            SQL editor to import data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              onClick={onOpenInsertSheet}
              className="w-full sm:w-auto bg-studio-accent-purple hover:bg-studio-accent-purple/90 text-black dark:text-white font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" />
              Insert your first row
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("studio:refresh-current-tab"),
                )
              }
              className="w-full sm:w-auto border-studio-border hover:bg-studio-row-hover"
            >
              Refresh table
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-studio-bg overflow-hidden"
      data-grid-instance={gridInstanceId}
    >
      {enableColumnHover && hoveredColumn && (
        <style
          dangerouslySetInnerHTML={{
            __html: buildHoveredColumnCss(gridInstanceId, hoveredColumn),
          }}
        />
      )}
      <div className="relative flex-1 flex flex-col min-h-0">
        <GridSearch
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          setSearchQuery("");
        }}
        rows={results?.rows ?? []}
        fields={results?.fields?.map((f: any) => f.name) ?? []}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onNavigateToMatch={(rowIndex, columnName) => {
          searchRef.current = { rowIndex, columnName };
          const targetCell = { rowIndex, columnName };
          setSingleCellSelection(targetCell);
          ensureCellInView(targetCell);
        }}
        currentMatchIndex={currentMatchIndex}
        onMatchIndexChange={setCurrentMatchIndex}
        matchCount={
          searchQuery && results?.rows
            ? filteredRowEntries.filter((entry) => {
                const row = results.rows[entry.index];
                if (!row) return false;
                return results.fields.some((field: any) => {
                  const val = row[field.name];
                  if (val === null || val === undefined) return false;
                  const str = String(val).toLowerCase();
                  return str.includes(searchQuery.toLowerCase());
                });
              }).length
            : 0
        }
        onReplaceCurrent={(rowIndex, columnName, replaceValue) => {
          const row = results?.rows?.[rowIndex];
          if (!row || !columnName) return;
          const rowId = getRowId(row, rowIndex);
          if (!rowId) return;
          const oldValue = String(row[columnName] ?? "");
          const searchValue = searchQuery;
          if (!oldValue.toLowerCase().includes(searchValue.toLowerCase()))
            return;
          const escaped = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(escaped, "gi");
          const newValue = oldValue.replace(regex, replaceValue);
          setPendingChanges((prev: any) => ({
            ...prev,
            [rowId]: {
              ...(prev[rowId] ?? {}),
              [columnName]: { old: oldValue, new: newValue },
            },
          }));
        }}
        onReplaceAll={(searchValue, replaceValue) => {
          if (!results?.rows) return 0;
          let count = 0;
          setPendingChanges((prev: any) => {
            const newChanges = { ...prev };
            for (let i = 0; i < results.rows.length; i++) {
              const row = results.rows[i];
              const rowId = getRowId(row, i);
              if (!rowId) continue;
              for (const field of results.fields) {
                const val = row[field.name];
                if (val === null || val === undefined) continue;
                const strVal = String(val);
                const lowerStr = strVal.toLowerCase();
                if (lowerStr.includes(searchValue.toLowerCase())) {
                  const escaped = searchValue.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    "\\$&",
                  );
                  const regex = new RegExp(escaped, "gi");
                  const newVal = strVal.replace(regex, replaceValue);
                  newChanges[rowId] = {
                    ...(newChanges[rowId] ?? {}),
                    [field.name]: { old: val, new: newVal },
                  };
                  count++;
                }
              }
            }
            return newChanges;
          });
          return count;
        }}
      />
      {results && (
        <div className="h-full flex flex-col">
          <div
            ref={scrollContainerRef}
            style={{ overscrollBehavior: "none", outline: "none" }}
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
            className="flex-1 overflow-auto relative isolate z-0 custom-scrollbar [will-change:scroll-position] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ring-0"
          >
            <table className="w-max text-xs font-sans border-separate border-spacing-0 min-w-max table-fixed">
              <colgroup>
                <col style={{ width: `${selectionColumnWidth}px` }} />
                {renderFields.map((field: any) => (
                  <col
                    key={field.name}
                    style={{ width: `${columnWidths[field.name]}px` }}
                  />
                ))}
              </colgroup>
              <GridHeader
                fields={renderFields}
                tableStructure={tableStructure}
                pendingDeletedColumns={pendingDeleteState.deletedColumns}
                columnWidths={columnWidths}
                selectedRowsCount={selectedRows.size}
                totalRowsCount={filteredRowEntries.length}
                toggleAllSelection={handleToggleAllSelection}
                selectionColumnWidth={selectionColumnWidth}
                stickySelectionColumn={stickySelectionColumn}
                stickyHeader={stickyHeader}
                stickyFirstDataColumn={stickyFirstDataColumn}
                hoveredColumn={enableColumnHover ? hoveredColumn : null}
                setHoveredColumn={handleHoverColumn}
                selectedColumn={selectedColumn}
                setSelectedColumn={setSelectedColumn}
                onAddColumnClick={handleAddColumnClick}
                showAddColumn={showAddColumn}
                showHeaderIcons={showHeaderIcons}
                sortConfig={sortConfig}
                setSortConfig={setSortConfig}
                onDeleteColumn={
                  handleDeleteColumn ? handleColumnDeleteRequest : undefined
                }
                onEditColumn={
                  canEditColumn ? handleColumnEditRequest : undefined
                }
                onColumnWidthChange={handleColumnWidthChange}
                onClearCellSelection={clearCellSelection}
                glassmorphicHeaders={glassmorphicHeaders}
              />
              <tbody className="bg-studio-bg">
                <SpacerRow
                  height={paddingTop}
                  colSpan={renderFields.length + 1}
                />
                {visibleRows.map(
                  (
                    { row, index: i }: { row: any; index: number },
                    visibleRowPosition: number,
                  ) => {
                    const prevVisibleRowIndex =
                      visibleRowPosition > 0
                        ? (visibleRows[visibleRowPosition - 1]?.index ?? null)
                        : null;
                    const nextVisibleRowIndex =
                      visibleRowPosition < visibleRows.length - 1
                        ? (visibleRows[visibleRowPosition + 1]?.index ?? null)
                        : null;
                    const rowId = getRowId(row, i);
                    const rowPendingChanges = rowId
                      ? pendingChanges[rowId]
                      : undefined;
                    const rowMarkedForDelete = isRowPendingDelete(row, rowId);
                    const isSelected = selectedRows.has(i);
                    const isPrevSelected = i > 0 && selectedRows.has(i - 1);
                    const isNextSelected =
                      i < results.rows.length - 1 && selectedRows.has(i + 1);

                    return (
                      <GridRow
                        key={i}
                        rowIndex={i}
                        prevVisibleRowIndex={prevVisibleRowIndex}
                        nextVisibleRowIndex={nextVisibleRowIndex}
                        row={row}
                        fields={renderFields}
                        tableStructure={tableStructure}
                        tableStructByName={tableStructByName}
                        enumByName={enumByName}
                        renderSelectionCell={renderSelectionCell}
                        selectionColumnWidth={selectionColumnWidth}
                        columnWidths={columnWidths}
                        stickySelectionColumn={stickySelectionColumn}
                        stickyFirstDataColumn={stickyFirstDataColumn}
                        customCellRenderer={customCellRenderer}
                        enums={enums}
                        isSelected={isSelected}
                        isFirstInSelection={isSelected && !isPrevSelected}
                        isLastInSelection={isSelected && !isNextSelected}
                        rowPendingChanges={rowPendingChanges}
                        isPendingDeleteRow={rowMarkedForDelete}
                        pendingDeletedColumns={
                          pendingDeleteState.deletedColumns
                        }
                        onToggleSelection={toggleRowSelection}
                        getRowId={getRowId}
                        setPendingChanges={setPendingChanges}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        selectedCell={selectedCell}
                        pressedPreviewCell={pressedPreviewCell}
                        selectedCellKeys={multiSelectedCells}
                        selectedDiscreteRows={selectedDiscreteRows}
                        selectionRange={selectionRange}
                        onCellSelect={handleCellSelect}
                        onCellMouseDown={handleCellMouseDown}
                        onCellMouseEnter={handleCellMouseEnter}
                        onCellContextMenu={handleCellContextMenu}
                        handleUpdateRow={handleUpdateRow}
                        handleFKSelection={handleFKSelection}
                        handleFKPreview={handleFKPreview}
                        selectedColumn={selectedColumn}
                        totalRows={results.rows.length}
                        onDuplicateRow={onDuplicateRow}
                        onCopyRowJSON={onCopyRowJSON}
                        onCopyRowCSV={onCopyRowCSV}
                        rowSpacing={rowSpacing}
                        alternatingRowColors={alternatingRowColors}
                        fkPreviewData={fkPreviewData}
                        onToggleFKPreview={handleToggleFKPreview}
                        hasMultiCellSelection={hasMultiCellSelection}
                        onCopySelectedCells={handleCopySelectedCells}
                        onCopySelectedCellValues={handleCopySelectedCellValues}
                        onSelectRowsFromSelectedCells={
                          handleSelectRowsFromSelectedCells
                        }
                        onFilterByCell={onFilterByCell}
                        gridAnimations={gridAnimations}
                        sleekSelection={sleekSelection}
                        colorizedPills={colorizedPills}
                        relativeDates={relativeDates}
                        richJsonInspector={richJsonInspector}
                        dataBars={dataBars}
                        columnMaxValues={columnMaxValues}
                        searchHighlight={isSearchOpen ? searchQuery : undefined}
                      />
                    );
                  },
                )}
                <SpacerRow
                  height={paddingBottom}
                  colSpan={renderFields.length + 1}
                />
                {filteredRowEntries.length === 0 && (
                  <tr>
                    <td
                      colSpan={renderFields.length + 1}
                      className="p-0 align-middle text-muted-foreground bg-studio-bg"
                    ></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {showPaginationFooter ? (
            <div className="shrink-0 border-t border-studio-border bg-studio-bg/95 px-3 py-1.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded border-border/70 bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    onClick={handlePrevPage}
                    disabled={page === 0 || loading}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Page</span>
                    <Input
                      value={String(page + 1)}
                      readOnly
                      className="h-7 w-12 rounded border-border/70 bg-background px-2 text-xs font-medium text-foreground text-center"
                    />
                    <span className="text-xs text-muted-foreground">
                      {totalPages !== null ? `of ${totalPages}` : "of —"}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded border-border/70 bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    onClick={handleNextPage}
                    disabled={
                      (totalCount !== null &&
                        (page + 1) * pageSize >= totalCount) ||
                      loading
                    }
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>

                  <div className="ml-2 flex items-center gap-1.5">
                    {isCustomPageInput ? (
                      <Input
                        ref={customPageInputRef}
                        type="number"
                        min={1}
                        value={customPageInputValue}
                        onChange={(e) =>
                          setCustomPageInputValue(e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCustomPageSizeSubmit();
                          } else if (e.key === "Escape") {
                            setIsCustomPageInput(false);
                          }
                        }}
                        onBlur={handleCustomPageSizeSubmit}
                        className="h-7 w-[72px] rounded border-border/70 bg-background text-xs"
                      />
                    ) : (
                      <Select
                        value={pageSize.toString()}
                        onValueChange={handlePageSizeUpdate}
                      >
                        <SelectTrigger className="h-7 w-[96px] rounded border-border/70 bg-background text-xs">
                          <SelectValue placeholder={pageSize.toString()} />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {pageSizeOptions.map((size) => (
                            <SelectItem
                              key={size}
                              value={size.toString()}
                              className="text-xs"
                            >
                              {size} rows
                            </SelectItem>
                          ))}
                          <SelectItem value="custom" className="text-xs">
                            Custom...
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  {recordLabel}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      </div>

      {/* Floating FK Preview */}
      {fkPreviewData && (
        <div
          data-fk-preview
          className="fixed z-[300] bg-studio-bg border-2 border-blue-500 shadow-2xl rounded-lg flex flex-col"
          style={{
            left: `${fkPreviewData.position?.x || 0}px`,
            top: `${fkPreviewData.position?.y || 0}px`,
            transform:
              fkPreviewData.position?.placement === "above"
                ? "translateY(-100%)"
                : undefined,
            width: fkPreviewSize?.width ?? fkPreviewData.position?.width ?? 420,
            height: fkPreviewSize?.height ?? "auto",
            maxWidth: "80vw",
            maxHeight: "80vh",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 bg-muted/30 border-b border-studio-border flex items-center justify-between shrink-0">
            <div className="text-xs font-bold text-muted-foregroundtracking-widest">
              Referencing record from{" "}
              <span className="text-blue-500 font-mono">
                {fkPreviewData.schema}.{fkPreviewData.table}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToTable?.(
                    fkPreviewData.schema,
                    fkPreviewData.table,
                    fkPreviewData.foreignColumnName,
                    fkPreviewData.foreignValue,
                  );
                  setFKPreviewData(null);
                }}
                className="text-muted-foreground hover:text-blue-500 transition-colors p-1"
                title="Open referenced table with filter"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFKPreviewData(null);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-0">
            {fkPreviewData.loading ? (
              <div className="flex items-center justify-center p-8 gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-lg animate-spin" />
                <span className="text-xs text-muted-foreground">
                  Loading...
                </span>
              </div>
            ) : fkPreviewData.data ? (
              <div className="overflow-x-auto">
                <table className="w-auto text-xs border-separate border-spacing-0">
                  <thead className="sticky top-0 bg-studio-bg">
                    <tr>
                      {fkPreviewData.fields.map((f: any) => (
                        <th
                          key={f.name}
                          className="px-3 py-2 text-left border-b border-r border-studio-border last:border-r-0 bg-muted/30 font-medium text-foreground whitespace-nowrap"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold">
                              {f.name}
                            </span>
                            <span className="text-xs text-muted-foreground font-normal">
                              {f.dataTypeName}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-studio-bg">
                    <tr className="hover:bg-studio-row-hover">
                      {fkPreviewData.fields.map((f: any) => (
                        <td
                          key={f.name}
                          className="px-3 py-2 border-b border-r border-studio-border last:border-r-0 text-studio-cell-text whitespace-nowrap"
                          style={{
                            maxWidth: "300px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {fkPreviewData.data?.[f.name] === null ? (
                            <span className="text-muted-foreground/30 italic text-xs">
                              NULL
                            </span>
                          ) : typeof fkPreviewData.data?.[f.name] ===
                            "object" ? (
                            <span className="text-blue-400/80 font-mono text-xs">
                              {JSON.stringify(fkPreviewData.data?.[f.name])}
                            </span>
                          ) : (
                            <span className="text-xs">
                              {String(fkPreviewData.data?.[f.name])}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : fkPreviewData.error ? (
              <div className="flex items-center justify-center p-8 gap-2 text-muted-foreground">
                <span className="text-xs">{fkPreviewData.error}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center p-8 gap-2 text-muted-foreground">
                <span className="text-xs">Record not found</span>
              </div>
            )}
          </div>

          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const el = e.currentTarget.closest("[data-fk-preview]");
              if (!el) return;
              const rect = el.getBoundingClientRect();
              fkPreviewResizeRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startW: fkPreviewSize?.width ?? rect.width,
                startH: fkPreviewSize?.height ?? rect.height,
              };
              setIsResizingFK(true);
            }}
          >
            <svg
              viewBox="0 0 10 10"
              className="w-3 h-3 text-muted-foreground/40 absolute bottom-0.5 right-0.5"
              fill="currentColor"
            >
              <path d="M0 10 L10 10 L10 0 Z" />
            </svg>
          </div>
        </div>
      )}

      <AddColumnSheet
        isOpen={isAddColumnSheetOpen}
        onOpenChange={setIsAddColumnSheetOpen}
        connectionString={connectionString}
        selectedSchema={selectedSchema}
        tableName={selectedTable || ""}
        onAddColumn={handleAddColumn}
        isAdding={isAddingColumn}
      />

      {canEditColumn && handleEditColumn && (
        <EditColumnSheet
          isOpen={isEditColumnSheetOpen}
          onOpenChange={setIsEditColumnSheetOpen}
          connectionString={connectionString}
          selectedSchema={selectedSchema}
          tableName={selectedTable || ""}
          columnName={columnToEdit}
          tableStructure={tableStructure}
          foreignKeys={foreignKeys}
          enums={enums}
          onEditColumn={handleEditColumn}
          isEditing={isEditingColumn}
        />
      )}

      {handleDeleteColumn && (
        <AlertDialog
          open={!!columnToDelete}
          onOpenChange={handleColumnDeleteCancel}
        >
          <AlertDialogContent className="bg-popover border-studio-border text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will permanently delete the column{" "}
                <span className="text-foreground font-medium">
                  "{columnToDelete}"
                </span>{" "}
                and all its data. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-transparent border-studio-border hover:bg-studio-row-hover hover:text-foreground">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  columnToDelete && handleDeleteColumn(columnToDelete)
                }
                className="bg-red-600 hover:bg-red-700 text-white border-none"
              >
                Delete Column
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
});
