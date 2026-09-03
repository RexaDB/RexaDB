"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DataEditor as DataEditorBase,
  GridCellKind,
  CompactSelection,
  type GridSelection,
  type Item,
  type GridMouseEventArgs,
  type GridKeyEventArgs,
  type EditableGridCell,
  type CellClickedEventArgs,
  type CellActivatedEventArgs,
  type DataEditorRef,
  type DataEditorProps,
  type HeaderClickedEventArgs,
  type SpriteMap,
  type DrawHeaderCallback,
  type Rectangle,
} from "@glideapps/glide-data-grid";
import { RexaContextMenu, type RexaContextMenuItem } from "./context-menu";
import type { DataGridProps } from "./types";
import { useGlideGridTheme, useGlideHoverColors } from "./theme";
import { computeAutoColumnWidths, buildGridColumns } from "./columns";
import { REXA_HEADER_ICONS, HEADER_ICON_KEYS } from "./header-icons";
import { NoResultsState, WhimsicalEmptyState } from "./states";
import { PaginationFooter } from "./pagination-footer";
import {
  buildEnumByName,
  classifyColumnType,
  computeColumnMaxValues,
  computePendingDeleteState,
  computeRelativeDateLabel,
  detectArabicScript,
  detectJsonInfo,
  getSortLabels,
  isRowPendingDelete,
  resolveEnumOptions,
  type RexaCellData,
  type RexaCellKind,
} from "./cell-content";
import {
  rexaCellRenderer,
  type RexaCell,
  FK_PREVIEW_BUTTON_SIZE,
  FK_PREVIEW_BUTTON_MARGIN,
} from "./rexa-cell-renderer";
import { AddColumnSheet } from "../grid/add-column-sheet";
import { EditColumnSheet } from "../grid/edit-column-sheet";
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
import { ExternalLink, X } from "@/lib/icon-theme/lucide-react";
import { fetchReferencedRecord, fetchTableForeignKeys } from "@/lib/api/actions-client";
import {
  findStudioForeignKey,
  normalizeStudioForeignKey,
} from "@/lib/db/foreign-key-utils";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";

const HEADER_MENU_ZONE_WIDTH = 30;

const CUSTOM_RENDERERS = [rexaCellRenderer];
const ROW_MARKER_WIDTH = 44;
const HEADER_HEIGHT = 40; // matches legacy grid's h-10 header cells
const ADD_COLUMN_WIDTH = 150;
// A real trailing GridColumn, not a DOM overlay: an overlay had to be
// hand-synced to Glide's own column layout on every scroll/resize (via
// getBounds/onVisibleRegionChanged) and, being a native `position: sticky`
// child of Glide's real `overflow: scroll` element when done via
// `rightElement`, inherited macOS's native rubber-band bounce with no way
// to suppress it from web content. A real column has neither problem —
// Glide lays it out and draws its one gridline itself, same as every other
// column.
//
// This exact string is also matched, verbatim, inside
// patches/@glideapps+glide-data-grid+6.0.4-alpha24.patch (applied via
// `bun patch`, see package.json's patchedDependencies) — that patch
// suppresses Glide's own horizontal row-separator lines specifically for
// the column with this id, which is what actually gets this column blank
// cells (no row structure) instead of the "accepted tradeoff" of visible
// rows underneath that an earlier, unpatched version of this component
// had. Renaming this constant means updating the patch file too.
const ADD_COLUMN_ID = "__rexa_add_column__";

/**
 * `headerIcons` is how we get the app's exact lucide icon set into
 * Glide's canvas-drawn header (see header-icons.ts). The runtime already
 * supports this prop end to end — `data-editor/data-editor.js` destructures
 * `headerIcons` straight off its props and threads it down to the
 * SpriteManager — but the public `DataEditorProps` type never declares
 * it (only the internal, non-exported `DataGrid` component's props do), so
 * TypeScript doesn't know about it. No glide-data-grid patch needed, just
 * this local type bridge to unblock passing the (fully functional) prop.
 */
const DataEditor = DataEditorBase as unknown as React.ForwardRefExoticComponent<
  (DataEditorProps & {
    headerIcons?: SpriteMap;
    drawHeader?: DrawHeaderCallback;
    overscrollX?: number;
    overscrollY?: number;
  }) &
    React.RefAttributes<DataEditorRef>
>;

/**
 * Glide only draws a column's menu triangle while its header is hovered
 * (`shouldDrawMenu = c.hasMenu && isHovered` internally) — matches most
 * spreadsheet apps, but this one wants it always visible, same as the
 * row-marker checkboxes (`checkbox-visible` instead of `checkbox`). There's
 * no prop for that, so this draws the same triangle Glide's own
 * `drawHeaderInner` draws (same bounds, same shape, same 0.7 alpha), only
 * when Glide itself didn't already draw one because the header isn't
 * hovered — `drawContent()` still renders everything else (background,
 * icon, title, indicator icon) unchanged.
 */
const onDrawHeader: DrawHeaderCallback = (args, drawContent) => {
  drawContent();
  const { ctx, column, menuBounds, theme } = args;
  // The row-marker's own header cell (the "select all" checkbox) isn't
  // one of our columns and must never get a menu chevron — its `id` is
  // undefined and it carries an internal `rowMarker` field at runtime
  // that our public `GridColumn` type doesn't declare.
  const isRowMarkerHeader = (column as { rowMarker?: unknown }).rowMarker !== undefined;
  if (isRowMarkerHeader || column.id === ADD_COLUMN_ID || menuBounds.width <= 0) return;

  // The exact lucide "chevron-down" path (`M6 9L12 15L18 9` in its 24x24
  // viewBox), scaled/positioned by hand rather than via ctx.scale so the
  // stroke width scales the same proportional way lucide's own SVG does.
  // Always drawn (not hover-gated, unlike Glide's own triangle affordance
  // which this replaces — `hasMenu: false` on the column in columns.ts
  // stops Glide from drawing or hit-testing its own).
  const size = theme.headerIconSize;
  const s = size / 24;
  const x0 = menuBounds.x + menuBounds.width / 2 - size / 2;
  const y0 = menuBounds.y + menuBounds.height / 2 - size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0 + 6 * s, y0 + 9 * s);
  ctx.lineTo(x0 + 12 * s, y0 + 15 * s);
  ctx.lineTo(x0 + 18 * s, y0 + 9 * s);
  ctx.strokeStyle = theme.textMedium;
  ctx.lineWidth = 2 * s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
};

/**
 * Glide Data Grid-backed implementation of the studio data grid. Satisfies
 * the same `DataGridProps` contract as the legacy DOM grid
 * (components/studio/data-grid.tsx) so every consumer can be pointed at
 * this component with no prop changes — see
 * /Users/virus/.claude/plans/nifty-noodling-mochi.md for the migration plan
 * and which behaviors are still pending in later checkpoints (FK preview
 * popover + FK picker, clipboard, context menu, in-grid search bar,
 * column DDL sheets, Set NULL/Discard shortcuts).
 */
export const DataGrid = React.memo(function DataGrid({
  results,
  tableStructure,
  selectedRows = new Set<number>(),
  setSelectedRows,
  getRowId,
  pendingChanges,
  setPendingChanges,
  pendingActions = [],
  onDuplicateRow,
  onCopyRowJSON,
  onCopyRowCSV,
  onFilterByCell,
  selectedCell,
  setSelectedCell,
  handleUpdateRow,
  loading,
  error,
  selectedTable,
  selectedSchema,
  pageSize,
  page,
  totalCount,
  onPageChange,
  onPageSizeChange,
  onOpenInsertSheet,
  rowSpacing = "standard",
  showPaginationFooter = true,
  whimsicalEmptyStates = false,
  hiddenColumns,
  isKeyboardInputSuspended: _isKeyboardInputSuspended,
  enums,
  globalSearchQuery = "",
  enableColumnHover = true,
  colorizedPills = false,
  relativeDates = false,
  richJsonInspector = false,
  dataBars = false,
  gridAnimations = false,
  showAddColumn = true,
  showHeaderIcons = true,
  stickyFirstDataColumn = true,
  connectionString,
  isAddColumnSheetOpen,
  setIsAddColumnSheetOpen,
  handleAddColumn,
  isAddingColumn,
  sortConfig,
  setSortConfig,
  selectedColumn: _selectedColumn,
  setSelectedColumn,
  handleDeleteColumn,
  handleEditColumn,
  columnToDelete,
  setColumnToDelete,
  columnToEdit,
  setColumnToEdit,
  isEditColumnSheetOpen,
  setIsEditColumnSheetOpen,
  isEditingColumn,
  foreignKeys = [],
  handleFKSelection,
  onNavigateToTable,
}: DataGridProps) {
  const theme = useGlideGridTheme();
  const hoverColors = useGlideHoverColors();
  const gridRef = useRef<DataEditorRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Glide measures its host element on mount / via its own ResizeObserver.
  // In the SQL editor the grid lives inside a percentage-height split pane,
  // so `height: 100%` can resolve against a not-yet-settled or zeroed size
  // (leaving the grid unable to size/scroll for large result sets). We
  // measure the wrapper ourselves and hand Glide explicit pixel dimensions,
  // which both gives it a definite size and re-triggers its layout whenever
  // the pane is laid out / resized (e.g. when a big query's results mount).
  const [gridSize, setGridSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        setGridSize((prev) =>
          prev && prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [manualColumnWidths, setManualColumnWidths] = useState<
    Record<string, number>
  >({});
  const [hoveredCell, setHoveredCell] = useState<Item | null>(null);
  const hoveredCellRef = useRef<Item | null>(null);
  const [hoveredHeaderCol, setHoveredHeaderCol] = useState<number | null>(null);
  const hoveredHeaderColRef = useRef<number | null>(null);
  // Tracks whether the pointer is currently over an FK cell's preview
  // button, kept up to date by onItemHovered. Selection is committed by
  // Glide on mousedown, before onCellClicked (which fires on mouseup) can
  // preventDefault it — so the only place we can actually stop "clicking
  // the button also selects the cell" is onGridSelectionChange, checking
  // this ref against the cell the new selection targets.
  const fkButtonHoverRef = useRef<Item | null>(null);
  // The state twin of fkButtonHoverRef: the ref is read synchronously by
  // onGridSelectionChange (a ref because that check must see the current
  // value immediately, not next render), while this state feeds
  // getCellContent so the button's own hovered-highlight actually
  // triggers a redraw when it changes.
  const [hoveredFKButton, setHoveredFKButton] = useState<Item | null>(null);

  // Multi-cell (range/discontiguous) selection. `selectedCell` (the prop)
  // only ever describes a single anchor cell — Glide's own drag-select,
  // shift-click-extend, and ctrl/cmd-click-discontiguous all produce a
  // richer `GridSelection.current.range`/`rangeStack` that the anchor
  // alone can't carry, so it's tracked separately here and merged back in
  // by the `gridSelection` memo below. Keyed by anchor [col,row] so an
  // externally-driven `selectedCell` change (e.g. search jumping to a
  // match) — which doesn't go through `onGridSelectionChange` — falls
  // back to a plain 1x1 selection instead of showing a stale range.
  const [multiSelection, setMultiSelection] = useState<{
    anchorCol: number;
    anchorRow: number;
    range: Rectangle;
    rangeStack: readonly Rectangle[];
  } | null>(null);

  // FK preview popover — ported verbatim from the legacy grid
  // (components/studio/data-grid.tsx's own `fkPreviewData` state and
  // `handleToggleFKPreview`), since it isn't part of the shared
  // DataGridProps contract (`handleFKPreview` in types.ts is a vestigial,
  // never-called prop — the legacy grid fetches and renders this itself).
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

  const rows: any[] = useMemo(() => results?.rows ?? [], [results]);
  const fields: Array<{ name: string }> = useMemo(
    () => results?.fields ?? [],
    [results],
  );

  const tableStructByName = useMemo(() => {
    const map = new Map<string, any>();
    (tableStructure ?? []).forEach((c) => {
      const name = c.name || c.column_name;
      if (name) map.set(name, c);
    });
    return map;
  }, [tableStructure]);

  const enumByName = useMemo(() => buildEnumByName(enums), [enums]);

  const columnMaxValues = useMemo(
    () => computeColumnMaxValues(results, tableStructure, dataBars),
    [results, tableStructure, dataBars],
  );

  const pendingDeleteState = useMemo(
    () => computePendingDeleteState(pendingActions, selectedSchema, selectedTable),
    [pendingActions, selectedSchema, selectedTable],
  );

  const autoWidths = useMemo(
    () => computeAutoColumnWidths(results, tableStructure),
    [results, tableStructure],
  );

  const columns = useMemo(() => {
    const cols = buildGridColumns(
      results,
      tableStructure,
      autoWidths,
      manualColumnWidths,
      hiddenColumns,
      {
        pendingDeleteColumns: pendingDeleteState.deletedColumns,
        showHeaderIcons,
        sortConfig,
      },
    );
    if (showAddColumn) {
      cols.push({
        id: ADD_COLUMN_ID,
        title: "Add column",
        width: ADD_COLUMN_WIDTH,
        hasMenu: false,
        icon: showHeaderIcons ? HEADER_ICON_KEYS.addColumn : undefined,
        themeOverride: { textHeader: theme.textMedium },
      });
    }
    return cols;
  }, [
    results,
    tableStructure,
    autoWidths,
    manualColumnWidths,
    hiddenColumns,
    pendingDeleteState,
    showHeaderIcons,
    sortConfig,
    showAddColumn,
    theme.textMedium,
  ]);

  const rowHeight =
    rowSpacing === "compact" ? 28 : rowSpacing === "relaxed" ? 36 : 32;

  useEffect(() => {
    // Stops the native rubber-band bounce at its source instead of
    // fighting the visual result of it: `overscroll-behavior` in
    // globals.css doesn't reliably suppress WKWebView's native
    // NSScrollView-level bounce on macOS (a documented, still-open
    // Tauri/wry limitation). Preventing the wheel event once the scroller
    // is already at its bounds stops the browser from ever entering that
    // overscrolled state in the first place.
    const scroller = wrapperRef.current?.querySelector<HTMLDivElement>(".dvn-scroller");
    if (!scroller) return;

    const preventOverscroll = (e: WheelEvent) => {
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      const atLeft = scroller.scrollLeft <= 0;
      const atRight = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
      if (
        (atTop && e.deltaY < 0) ||
        (atBottom && e.deltaY > 0) ||
        (atLeft && e.deltaX < 0) ||
        (atRight && e.deltaX > 0)
      ) {
        e.preventDefault();
      }
    };

    scroller.addEventListener("wheel", preventOverscroll, { passive: false });
    return () => scroller.removeEventListener("wheel", preventOverscroll);
  }, []);

  // Close FK preview when clicking outside it.
  useEffect(() => {
    if (!fkPreviewData) return;
    // "pointerdown", not "mousedown" — see the identical note in
    // context-menu.tsx: Glide's own canvas pointerdown handler calls
    // preventDefault(), which per spec suppresses the browser's
    // synthesized compatibility mousedown/click events for clicks landing
    // on the grid, so a "mousedown" listener never sees them.
    const handleClickOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-fk-preview]")) {
        setFKPreviewData(null);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside, true);
    return () => document.removeEventListener("pointerdown", handleClickOutside, true);
  }, [fkPreviewData]);

  // FK preview resize pointer events.
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

  // Ported from the legacy grid's `handleToggleFKPreview`, adapted for a
  // canvas grid: instead of a React.MouseEvent (whose `currentTarget` was
  // a real DOM button), this takes the FK preview button's own screen rect
  // directly — computed in onCellClicked below from Glide's `event.bounds`
  // (see rexa-cell-renderer.tsx's FK_PREVIEW_BUTTON_SIZE/MARGIN, which
  // that computation and the canvas draw call both key off, so the
  // clickable zone and the drawn button can never drift apart).
  const handleToggleFKPreview = useCallback(
    async (
      rowIndex: number,
      columnName: string,
      value: any,
      buttonRect: { left: number; top: number; bottom: number },
    ) => {
      if (
        fkPreviewData?.rowIndex === rowIndex &&
        fkPreviewData?.columnName === columnName
      ) {
        setFKPreviewData(null);
        return;
      }
      if (!connectionString) return;

      // Cached FKs (especially SMGT) may use referenced_* keys or be stale —
      // normalize first, then force a refetch when the target is still missing.
      let fk =
        findStudioForeignKey(foreignKeys, columnName) ||
        normalizeStudioForeignKey(
          foreignKeys.find((f) => f.column_name === columnName) as
            | Record<string, unknown>
            | undefined,
        );

      if ((!fk || !fk.foreign_table_name || !fk.foreign_column_name) &&
          selectedSchema &&
          selectedTable) {
        const fkRes = await fetchTableForeignKeys(
          connectionString,
          selectedSchema,
          selectedTable,
        );
        if (fkRes.success && fkRes.data) {
          fk = findStudioForeignKey(fkRes.data, columnName);
        }
      }

      if (!fk || value === null) {
        setFKPreviewData(null);
        return;
      }

      if (!fk.foreign_table_name || !fk.foreign_column_name) {
        setFKPreviewData({
          rowIndex,
          columnName,
          schema: fk.foreign_table_schema || "",
          table: fk.foreign_table_name || "",
          foreignColumnName: fk.foreign_column_name || "",
          foreignValue: value,
          data: null,
          fields: [],
          error: "Foreign key metadata is incomplete for this column.",
          loading: false,
          position: {
            x: Math.max(12, buttonRect.left),
            y: Math.max(12, buttonRect.bottom + 6),
            maxHeight: 160,
            width: 320,
            placement: "below",
          },
        });
        return;
      }

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

      let x = buttonRect.left;
      x = Math.min(
        Math.max(VIEWPORT_MARGIN, x),
        Math.max(VIEWPORT_MARGIN, viewportWidth - allowedWidth - VIEWPORT_MARGIN),
      );

      const PREVIEW_GAP = 6;
      const belowY = buttonRect.bottom + PREVIEW_GAP;
      const aboveBottomY = buttonRect.top - PREVIEW_GAP;
      const spaceBelow = Math.max(0, viewportHeight - belowY - VIEWPORT_MARGIN);
      const spaceAbove = Math.max(0, aboveBottomY - VIEWPORT_MARGIN);
      const minUsableHeight = 160;

      const shouldOpenBelow = spaceBelow >= minUsableHeight || spaceBelow >= spaceAbove;
      const placement: "above" | "below" = shouldOpenBelow ? "below" : "above";
      const y =
        placement === "below"
          ? Math.max(VIEWPORT_MARGIN, belowY)
          : Math.max(VIEWPORT_MARGIN, aboveBottomY);
      const availableHeight = placement === "below" ? spaceBelow : spaceAbove;
      const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, Math.max(80, availableHeight));

      const position = { x, y, maxHeight, width: allowedWidth, placement };

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
          error: err instanceof Error ? err.message : "Failed to fetch referenced record.",
          loading: false,
          position,
        });
      }
    },
    [fkPreviewData, foreignKeys, connectionString, selectedSchema, selectedTable],
  );

  // Tracks the FK preview button's hover/cursor state via a raw mousemove
  // listener, not onItemHovered: Glide dedupes onItemHovered by cell
  // location alone (mouseEventArgsAreEqual in glide-data-grid's own
  // event-args.ts compares only kind+location, never localEventX), so it
  // never fires again for mouse movement *within* the same cell — which
  // is exactly the button-vs-rest-of-cell distinction this needs. Reading
  // hoveredCellRef (still accurately kept up to date by onItemHovered,
  // since that only needs cell-granularity) plus getBounds for that cell
  // gives an always-fresh local x for every real mouse movement instead.
  //
  // Listens on `.dvn-scroller`, not `canvas`: glide-data-grid's own
  // infinite-scroller.tsx renders `.dvn-underlay` (which holds the
  // canvases) and `.dvn-scroller` as SIBLINGS, in that order — so
  // `.dvn-scroller` paints on top and is what actually receives mouse
  // hit-testing for the whole grid area (confirmed via glide-data-grid's
  // own hover handling: it listens for `pointermove` on `window`, in the
  // capture phase, and computes everything from clientX/Y itself — it
  // never relies on the canvas being the event target either). A
  // listener on `canvas` directly never fired; setting `canvas.style.
  // cursor` was equally inert, since `.dvn-scroller`'s cursor is the one
  // actually shown on screen.
  useEffect(() => {
    const scroller = wrapperRef.current?.querySelector<HTMLDivElement>(".dvn-scroller");
    if (!scroller) return;

    // Glide manages `.dvn-scroller`'s own cursor for resize/drag/etc. by
    // writing to `target.style.cursor` directly (see
    // node_modules/@glideapps/glide-data-grid's internal DataGrid: `if
    // (lastSetCursor.current !== style.cursor) target.style.cursor = ...`
    // on the same eventTarget element). Writing `cursor = ""` here on
    // *every* mousemove — even just to clear our own "pointer" — clobbers
    // whatever Glide just set (e.g. col-resize) almost as soon as it's
    // applied, and since Glide caches what it last wrote and only
    // reapplies on a genuine change, a stale value we left behind can
    // stick around instead of Glide's own. Only touch the cursor on the
    // actual on/off transition into our own override, never as a
    // per-mousemove no-op reset.
    let weSetPointer = false;

    const clearHover = () => {
      fkButtonHoverRef.current = null;
      if (weSetPointer) {
        scroller.style.cursor = "";
        weSetPointer = false;
      }
      setHoveredFKButton((prev) => (prev === null ? prev : null));
    };

    const handleMouseMove = (e: MouseEvent) => {
      const cell = hoveredCellRef.current;
      let overButtonCell: Item | null = null;
      if (cell) {
        const [col, row] = cell;
        const field = columns[col];
        const columnName = field?.id as string | undefined;
        if (columnName && columnName !== ADD_COLUMN_ID) {
          const struct = tableStructByName.get(columnName);
          if (struct?.is_foreign_key) {
            const rowData = rows[row];
            const rowId = rowData ? getRowId(rowData, row) : null;
            const pending = rowId && pendingChanges?.[rowId]?.[columnName];
            const value = rowData ? (pending ? pending.new : rowData[columnName]) : null;
            if (value !== null && value !== undefined) {
              const bounds = gridRef.current?.getBounds(col, row);
              if (bounds) {
                const localX = e.clientX - bounds.x;
                const zoneWidth = FK_PREVIEW_BUTTON_SIZE + FK_PREVIEW_BUTTON_MARGIN;
                if (localX >= bounds.width - zoneWidth) overButtonCell = cell;
              }
            }
          }
        }
      }
      fkButtonHoverRef.current = overButtonCell;
      if (overButtonCell && !weSetPointer) {
        scroller.style.cursor = "pointer";
        weSetPointer = true;
      } else if (!overButtonCell && weSetPointer) {
        scroller.style.cursor = "";
        weSetPointer = false;
      }
      setHoveredFKButton((prev) => {
        const changed =
          (prev === null) !== (overButtonCell === null) ||
          (prev && overButtonCell && (prev[0] !== overButtonCell[0] || prev[1] !== overButtonCell[1]));
        return changed ? overButtonCell : prev;
      });
    };

    scroller.addEventListener("mousemove", handleMouseMove);
    scroller.addEventListener("mouseleave", clearHover);
    return () => {
      scroller.removeEventListener("mousemove", handleMouseMove);
      scroller.removeEventListener("mouseleave", clearHover);
    };
  }, [columns, tableStructByName, rows, getRowId, pendingChanges]);

  // The rectangles of an *active* multi-cell selection (drag range and/or
  // ctrl/cmd-click discontiguous rects) — null when there isn't one, so
  // getCellContent falls back to the plain single-cell `isSelected`
  // check below. Without this, our own custom cell renderer (which draws
  // its own selection fill/border instead of relying on Glide's built-in
  // one) only ever highlighted the anchor cell, since it compared
  // against the single `selectedCell` prop and had no idea a range was
  // active — Glide's own drag-select mechanics and gridSelection state
  // were correct, only the *visual* was still single-cell.
  const activeSelectionRects = useMemo(() => {
    if (!multiSelection || !selectedCell) return null;
    const anchorColIndex = columns.findIndex((c) => c.id === selectedCell.columnName);
    if (
      anchorColIndex !== multiSelection.anchorCol ||
      selectedCell.rowIndex !== multiSelection.anchorRow
    ) {
      return null;
    }
    const { range, rangeStack } = multiSelection;
    if (rangeStack.length === 0 && range.width * range.height <= 1) return null;
    return [range, ...rangeStack];
  }, [multiSelection, selectedCell, columns]);

  const getCellContent = useCallback(
    (item: Item): RexaCell => {
      const [col, row] = item;
      const field = columns[col];
      const columnName = (field?.id as string) ?? "";
      const rowData = fields.length ? rows[row] : undefined;

      const empty: RexaCellData = {
        value: "",
        displayValue: "",
        kind: "text",
        columnName,
        rowIndex: row,
        rowId: null,
        isRtl: false,
        isSelected: false,
        isPendingChange: false,
        isPendingDelete: false,
        isSearchMatch: false,
        isColumnHovered: false,
        isRowHovered: false,
        isCellHovered: false,
        cellHoverColor: hoverColors.cellHoverColor,
        rowHoverColor: hoverColors.rowHoverColor,
        columnHoverColor: hoverColors.columnHoverColor,
        dataBarRatio: null,
        colorizedPills,
        relativeDates,
        richJsonInspector,
        jsonType: null,
        enumOptions: undefined,
        columnType: "",
        readonlyCell: false,
        isPrimaryKey: false,
        isForeignKey: false,
        isFKButtonHovered: false,
        relativeDateLabel: null,
        originalValue: null,
        discardChange: null,
        rowSpacing,
      };

      if (!field || !rowData || columnName === ADD_COLUMN_ID) {
        return { kind: GridCellKind.Custom, data: empty, copyData: "", allowOverlay: false };
      }

      const struct = tableStructByName.get(columnName);
      const columnType = struct?.data_type || struct?.type || "";
      const isForeignKey = !!struct?.is_foreign_key;
      const rowId = getRowId(rowData, row);
      const pending =
        rowId && pendingChanges?.[rowId]?.[columnName]
          ? pendingChanges[rowId][columnName]
          : undefined;
      const value = pending ? pending.new : rowData[columnName];

      const { isDate, isBoolean } = classifyColumnType(columnType);
      const enumOptions = resolveEnumOptions(struct, enumByName);
      const isEnum = !!enumOptions?.length;
      const jsonInfo = detectJsonInfo(value, richJsonInspector);

      let kind: RexaCellKind;
      if (value === null || value === undefined) kind = "null";
      else if (isBoolean) kind = "boolean";
      else if (isEnum) kind = "enum";
      else if (jsonInfo) kind = "json";
      else if (isDate) kind = "date";
      else kind = "text";

      let displayValue: string;
      if (value === null || value === undefined) displayValue = "NULL";
      else if (kind === "json") displayValue = JSON.stringify(value);
      else if (typeof value === "object") displayValue = JSON.stringify(value);
      else displayValue = String(value);

      const isPendingChange = !!pending;
      const originalValue = rowData[columnName];
      const discardChange = isPendingChange
        ? () => {
            setPendingChanges((prev: any) => {
              if (!prev?.[rowId!] || !(columnName in prev[rowId!])) return prev;
              const next = { ...prev };
              const rowChanges = { ...next[rowId!] };
              delete rowChanges[columnName];
              if (Object.keys(rowChanges).length === 0) delete next[rowId!];
              else next[rowId!] = rowChanges;
              return next;
            });
          }
        : null;
      const isPendingDelete =
        pendingDeleteState.deletedColumns.has(columnName) ||
        isRowPendingDelete(rowData, rowId, pendingDeleteState);

      const isRtl = detectArabicScript(displayValue);
      const isSelected = activeSelectionRects
        ? activeSelectionRects.some(
            (r) => col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height,
          )
        : selectedCell?.rowIndex === row && selectedCell?.columnName === columnName;
      const isSearchMatch =
        !!globalSearchQuery &&
        value !== null &&
        value !== undefined &&
        String(value).toLowerCase().includes(globalSearchQuery.toLowerCase());
      const isColumnHovered = enableColumnHover && hoveredHeaderCol === col;
      const isRowHovered =
        gridAnimations && hoveredCell !== null && hoveredCell[1] === row;
      const isCellHovered =
        hoveredCell !== null && hoveredCell[0] === col && hoveredCell[1] === row;

      const dataBarRatio =
        dataBars && typeof value === "number" && columnMaxValues[columnName]
          ? Math.abs(value) / columnMaxValues[columnName]
          : dataBars &&
              value !== null &&
              !Number.isNaN(Number(value)) &&
              columnMaxValues[columnName]
            ? Math.abs(Number(value)) / columnMaxValues[columnName]
            : null;

      const relativeDateLabel =
        kind === "date" && relativeDates ? computeRelativeDateLabel(value) : null;

      const data: RexaCellData = {
        value,
        displayValue,
        kind,
        columnName,
        rowIndex: row,
        rowId,
        isRtl,
        isSelected,
        isPendingChange,
        isPendingDelete,
        isSearchMatch,
        isColumnHovered,
        isRowHovered,
        isCellHovered,
        cellHoverColor: hoverColors.cellHoverColor,
        rowHoverColor: hoverColors.rowHoverColor,
        columnHoverColor: hoverColors.columnHoverColor,
        dataBarRatio,
        colorizedPills,
        relativeDates,
        richJsonInspector,
        jsonType: jsonInfo?.type ?? null,
        enumOptions,
        columnType,
        readonlyCell: false,
        isPrimaryKey: !!struct?.is_primary_key,
        isForeignKey,
        isFKButtonHovered:
          isForeignKey &&
          hoveredFKButton !== null &&
          hoveredFKButton[0] === col &&
          hoveredFKButton[1] === row,
        relativeDateLabel,
        originalValue,
        discardChange,
        rowSpacing,
      };

      return {
        kind: GridCellKind.Custom,
        data,
        copyData: value === null || value === undefined ? "" : String(value),
        // FK cells never open Glide's own text-editor overlay — matches
        // the legacy grid, where double-clicking an FK cell always goes
        // through the FK picker (handleFKSelection, wired via
        // onCellActivated below) instead of raw text editing.
        allowOverlay: !isForeignKey,
      };
    },
    [
      columns,
      fields.length,
      rows,
      tableStructByName,
      getRowId,
      pendingChanges,
      enumByName,
      pendingDeleteState,
      globalSearchQuery,
      enableColumnHover,
      gridAnimations,
      hoveredCell,
      hoveredHeaderCol,
      hoveredFKButton,
      colorizedPills,
      relativeDates,
      richJsonInspector,
      dataBars,
      columnMaxValues,
      hoverColors,
      setPendingChanges,
      rowSpacing,
      selectedCell,
      activeSelectionRects,
    ],
  );

  const onCellEdited = useCallback(
    (item: Item, newValue: EditableGridCell) => {
      if (newValue.kind !== GridCellKind.Custom) return;
      const rexaValue = newValue as RexaCell;
      const [col, row] = item;
      const field = columns[col];
      const rowData = rows[row];
      if (!field || !rowData || field.id === ADD_COLUMN_ID) return;
      const columnName = field.id as string;
      const rowId = getRowId(rowData, row);
      if (!rowId) return;

      const struct = tableStructByName.get(columnName);
      const columnType = struct?.data_type || struct?.type || "";
      const isCurrentlyModified =
        pendingChanges?.[rowId] && columnName in pendingChanges[rowId];
      const oldValue = isCurrentlyModified
        ? pendingChanges[rowId][columnName].old
        : rowData[columnName];

      const newVal = rexaValue.data.value;
      void handleUpdateRow(rowId, columnName, oldValue, newVal, columnType);
    },
    [columns, rows, getRowId, tableStructByName, pendingChanges, handleUpdateRow],
  );

  const onColumnResize = useCallback(
    (column: { id?: string }, newSize: number) => {
      if (!column.id || column.id === ADD_COLUMN_ID) return;
      setManualColumnWidths((prev) => ({
        ...prev,
        [column.id as string]: Math.max(80, Math.min(1200, newSize)),
      }));
    },
    [],
  );

  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      // Column hover mirrors the legacy grid exactly: it tracks the column
      // HEADER being hovered, not any cell in the column's body.
      const nextHeaderCol = args.kind === "header" ? args.location[0] : null;
      if (nextHeaderCol !== hoveredHeaderColRef.current) {
        hoveredHeaderColRef.current = nextHeaderCol;
        setHoveredHeaderCol(nextHeaderCol);
      }

      // Cell/row hover tracks the hovered body cell.
      const nextCell: Item | null = args.kind === "cell" ? args.location : null;
      const prevCell = hoveredCellRef.current;
      const cellChanged =
        (prevCell === null) !== (nextCell === null) ||
        (prevCell && nextCell && (prevCell[0] !== nextCell[0] || prevCell[1] !== nextCell[1]));
      if (cellChanged) {
        hoveredCellRef.current = nextCell;
        setHoveredCell(nextCell);
      }

      // Deliberately not using gridRef.current.updateCells() here: Glide's
      // damage-based partial redraw clips 1px off the top/left of every
      // redrawn cell (an optimization so it doesn't need to replay gridlines
      // for untouched neighbors), which left a stale sliver that read as a
      // border wherever our hover tint met an un-redrawn neighbor. Just
      // updating this state is enough — it changes getCellContent's identity,
      // which is one of DataEditor's own redraw dependencies, so Glide does a
      // normal (non-damaged, non-clipped) repaint on its own.
    },
    [],
  );

  const onHeaderClicked = useCallback(
    (colIndex: number, event: HeaderClickedEventArgs) => {
      const column = columns[colIndex];
      if (!column) return;
      const columnName = column.id as string;

      if (columnName === ADD_COLUMN_ID) {
        setIsAddColumnSheetOpen?.(true);
        return;
      }

      const isMenuZone = event.localEventX >= event.bounds.width - HEADER_MENU_ZONE_WIDTH;

      if (!isMenuZone) {
        // Header body click = sort only. No column selection / header
        // highlight — ASC → DESC → clear on successive clicks.
        if (!setSortConfig) return;
        if (sortConfig?.column !== columnName) {
          setSortConfig({ column: columnName, direction: "ASC" });
        } else if (sortConfig.direction === "ASC") {
          setSortConfig({ column: columnName, direction: "DESC" });
        } else {
          setSortConfig(null);
        }
        return;
      }

      const struct = tableStructByName.get(columnName);
      const dataType = String(struct?.data_type || struct?.type || "text");
      const sortLabels = getSortLabels(dataType);
      const items: RexaContextMenuItem[] = [
        {
          key: "sort-asc",
          label: sortLabels.asc,
          onSelect: () => setSortConfig?.({ column: columnName, direction: "ASC" }),
        },
        {
          key: "sort-desc",
          label: sortLabels.desc,
          onSelect: () => setSortConfig?.({ column: columnName, direction: "DESC" }),
        },
        {
          // Matches the legacy grid exactly: this item exists but has
          // never been wired to a handler there either.
          key: "resize-to-fit",
          label: "Resize to fit",
          onSelect: () => {},
          separatorBefore: true,
        },
      ];
      if (handleEditColumn) {
        items.push({
          key: "edit-column",
          label: "Edit column",
          onSelect: () => {
            setColumnToEdit?.(columnName);
            setIsEditColumnSheetOpen?.(true);
          },
          separatorBefore: true,
        });
      }
      if (handleDeleteColumn) {
        items.push({
          key: "delete-column",
          label: "Delete column",
          onSelect: () => setColumnToDelete?.(columnName),
          separatorBefore: !handleEditColumn,
        });
      }

      setContextMenu({
        x: event.bounds.x + event.bounds.width - 192,
        y: event.bounds.y + event.bounds.height,
        items,
      });
    },
    [
      columns,
      setIsAddColumnSheetOpen,
      tableStructByName,
      setSortConfig,
      sortConfig,
      handleEditColumn,
      handleDeleteColumn,
      setColumnToEdit,
      setIsEditColumnSheetOpen,
      setColumnToDelete,
    ],
  );

  const gridSelection: GridSelection = useMemo(() => {
    const rowsSelection = CompactSelection.fromArray(Array.from(selectedRows));
    // Column selection is intentionally disabled — headers stay visually
    // stable; clicks on them sort instead of selecting the column.
    const columnsSelection = CompactSelection.empty();
    const colIndex =
      selectedCell?.columnName != null
        ? columns.findIndex((c) => c.id === selectedCell.columnName)
        : -1;
    if (
      selectedCell &&
      colIndex >= 0 &&
      typeof selectedCell.rowIndex === "number"
    ) {
      // Only trust the stored multi-cell range when it's actually for
      // *this* anchor cell — otherwise selectedCell was set through some
      // other path (search, an external "select this cell" action) and
      // any leftover range would be stale.
      const useMulti =
        multiSelection !== null &&
        multiSelection.anchorCol === colIndex &&
        multiSelection.anchorRow === selectedCell.rowIndex;
      return {
        current: {
          cell: [colIndex, selectedCell.rowIndex],
          range: useMulti
            ? multiSelection!.range
            : { x: colIndex, y: selectedCell.rowIndex, width: 1, height: 1 },
          rangeStack: useMulti ? multiSelection!.rangeStack : [],
        },
        columns: columnsSelection,
        rows: rowsSelection,
      };
    }
    return {
      columns: columnsSelection,
      rows: rowsSelection,
    };
  }, [selectedRows, selectedCell, columns, multiSelection]);

  const onGridSelectionChange = useCallback(
    (newSelection: GridSelection) => {
      if (newSelection.current) {
        const [hoverCol, hoverRow] = fkButtonHoverRef.current ?? [];
        const [col, row] = newSelection.current.cell;
        if (hoverCol === col && hoverRow === row) return;
      }
      setSelectedRows(new Set(newSelection.rows.toArray()));
      // Never keep a Glide column-selection highlight — headers must not
      // change color when cells/columns are interacted with.
      setSelectedColumn?.(null);
      if (newSelection.current) {
        const [col, row] = newSelection.current.cell;
        const columnName = columns[col]?.id;
        if (columnName) {
          setSelectedCell({ rowIndex: row, columnName });
        }
        // Preserve whatever range/rangeStack Glide just computed (drag,
        // shift-click extend, ctrl/cmd-click discontiguous) instead of
        // collapsing every selection down to the single anchor cell —
        // this is what actually makes multi-cell selection (and Glide's
        // own built-in Ctrl+C, which copies from gridSelection.current.
        // range) work at all.
        setMultiSelection({
          anchorCol: col,
          anchorRow: row,
          range: newSelection.current.range,
          rangeStack: newSelection.current.rangeStack,
        });
      } else {
        setSelectedCell(null);
        setMultiSelection(null);
      }
    },
    [columns, setSelectedRows, setSelectedCell, setSelectedColumn],
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: RexaContextMenuItem[];
  } | null>(null);

  const toggleRowSelected = useCallback(
    (row: number) => {
      const next = new Set(selectedRows);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      setSelectedRows(next);
    },
    [selectedRows, setSelectedRows],
  );

  // Ported from the legacy grid's getCellValue/toClipboardValue
  // (components/studio/data-grid.tsx) verbatim.
  const getCellValue = useCallback(
    (rowIndex: number, columnName: string): any => {
      const row = rows[rowIndex];
      if (!row) return null;
      const rowId = getRowId(row, rowIndex);
      const rowPendingChanges = rowId ? pendingChanges?.[rowId] : undefined;
      if (rowPendingChanges && columnName in rowPendingChanges) {
        return rowPendingChanges[columnName].new;
      }
      return row[columnName];
    },
    [rows, getRowId, pendingChanges],
  );

  const toClipboardValue = useCallback((value: any): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }, []);

  const hasMultiCellSelection =
    multiSelection !== null &&
    (multiSelection.rangeStack.length > 0 ||
      multiSelection.range.width * multiSelection.range.height > 1);

  // Ported from the legacy grid's buildSelectedCellsClipboard, adapted for
  // Glide's rectangle-based selection model (a `range` plus any
  // discontiguous `rangeStack` entries from ctrl/cmd-click) instead of a
  // flat Set of "row:column" cell keys. A plain drag-selected rectangle
  // (no rangeStack) copies as a real grid, matching the legacy
  // `selectionRange` path; anything with discontiguous rects copies as
  // "row / column / value" triples, matching the legacy
  // `multiSelectedCells` path — same two formats, same rule for which one
  // applies.
  const buildSelectedCellsClipboard = useCallback(
    (includeHeaders: boolean): string => {
      if (!multiSelection) return "";
      const rects: Rectangle[] = [multiSelection.range, ...multiSelection.rangeStack];

      if (multiSelection.rangeStack.length > 0) {
        const seen = new Set<string>();
        const cells: Array<{ rowIndex: number; columnName: string; colIndex: number }> = [];
        for (const rect of rects) {
          for (let r = rect.y; r < rect.y + rect.height; r++) {
            for (let c = rect.x; c < rect.x + rect.width; c++) {
              const columnName = columns[c]?.id as string | undefined;
              if (!columnName) continue;
              const key = `${r}:${columnName}`;
              if (seen.has(key)) continue;
              seen.add(key);
              cells.push({ rowIndex: r, columnName, colIndex: c });
            }
          }
        }
        cells.sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
        const lines: string[] = [];
        if (includeHeaders) lines.push("row\tcolumn\tvalue");
        for (const cell of cells) {
          lines.push(
            `${cell.rowIndex + 1}\t${cell.columnName}\t${toClipboardValue(getCellValue(cell.rowIndex, cell.columnName))}`,
          );
        }
        return lines.join("\n");
      }

      const rect = multiSelection.range;
      const lines: string[] = [];
      if (includeHeaders) {
        const headerValues: string[] = [];
        for (let c = rect.x; c < rect.x + rect.width; c++) {
          const columnName = columns[c]?.id as string | undefined;
          if (columnName) headerValues.push(columnName);
        }
        lines.push(headerValues.join("\t"));
      }
      for (let r = rect.y; r < rect.y + rect.height; r++) {
        const rowValues: string[] = [];
        for (let c = rect.x; c < rect.x + rect.width; c++) {
          const columnName = columns[c]?.id as string | undefined;
          rowValues.push(columnName ? toClipboardValue(getCellValue(r, columnName)) : "");
        }
        lines.push(rowValues.join("\t"));
      }
      return lines.join("\n");
    },
    [multiSelection, columns, getCellValue, toClipboardValue],
  );

  const copySelectedCells = useCallback(
    async (includeHeaders: boolean) => {
      const text = buildSelectedCellsClipboard(includeHeaders);
      if (!text) return;
      await navigator.clipboard.writeText(text);
    },
    [buildSelectedCellsClipboard],
  );

  const selectRowsFromSelectedCells = useCallback(() => {
    if (!multiSelection) return;
    const rowsSet = new Set<number>();
    for (const rect of [multiSelection.range, ...multiSelection.rangeStack]) {
      for (let r = rect.y; r < rect.y + rect.height; r++) rowsSet.add(r);
    }
    if (rowsSet.size === 0) return;
    setSelectedRows(rowsSet);
  }, [multiSelection, setSelectedRows]);

  const onCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [col, row] = cell;
      const field = columns[col];
      const columnName = field?.id as string | undefined;
      if (!columnName || columnName === ADD_COLUMN_ID) return;
      const struct = tableStructByName.get(columnName);
      if (!struct?.is_foreign_key) return;
      const rowData = rows[row];
      if (!rowData) return;
      const rowId = getRowId(rowData, row);
      const pending = rowId && pendingChanges?.[rowId]?.[columnName];
      const value = pending ? pending.new : rowData[columnName];
      if (value === null || value === undefined) return;

      // Same right-edge zone rexa-cell-renderer.tsx draws the FK preview
      // button in — see FK_PREVIEW_BUTTON_SIZE/MARGIN there.
      const zoneWidth = FK_PREVIEW_BUTTON_SIZE + FK_PREVIEW_BUTTON_MARGIN;
      if (event.localEventX < event.bounds.width - zoneWidth) return;

      event.preventDefault();
      const btnTop = event.bounds.y + (event.bounds.height - FK_PREVIEW_BUTTON_SIZE) / 2;
      void handleToggleFKPreview(row, columnName, value, {
        left: event.bounds.x + event.bounds.width - FK_PREVIEW_BUTTON_MARGIN - FK_PREVIEW_BUTTON_SIZE,
        top: btnTop,
        bottom: btnTop + FK_PREVIEW_BUTTON_SIZE,
      });
    },
    [columns, tableStructByName, rows, getRowId, pendingChanges, handleToggleFKPreview],
  );

  const onCellActivated = useCallback(
    (cell: Item, _event: CellActivatedEventArgs) => {
      if (!handleFKSelection) return;
      const [col, row] = cell;
      const field = columns[col];
      const columnName = field?.id as string | undefined;
      if (!columnName || columnName === ADD_COLUMN_ID) return;
      const struct = tableStructByName.get(columnName);
      if (!struct?.is_foreign_key) return;
      void handleFKSelection(row, columnName);
    },
    [columns, tableStructByName, handleFKSelection],
  );

  const onCellContextMenu = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      event.preventDefault();
      const [col, row] = cell;
      const field = columns[col];
      const rowData = rows[row];
      if (!rowData) return;
      const columnName = field?.id as string | undefined;
      const value = columnName ? rowData[columnName] : undefined;
      const isRowSelected = selectedRows.has(row);

      const items: RexaContextMenuItem[] = [
        {
          key: "select-row",
          label: isRowSelected ? "Deselect row" : "Select row",
          onSelect: () => toggleRowSelected(row),
        },
      ];

      if (onDuplicateRow) {
        items.push({
          key: "duplicate-row",
          label: "Duplicate row",
          onSelect: () => onDuplicateRow(rowData),
        });
      }

      if (columnName) {
        items.push({
          key: "copy-cell",
          label: "Copy cell",
          onSelect: () => {
            void navigator.clipboard.writeText(
              value === null || value === undefined
                ? ""
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value),
            );
          },
        });
        if (onFilterByCell) {
          items.push({
            key: "filter-by-cell",
            label: "Filter by this value",
            onSelect: () => onFilterByCell(columnName, value),
          });
        }
      }

      if (hasMultiCellSelection) {
        items.push(
          {
            key: "copy-selected-cells",
            label: "Copy selected cells",
            onSelect: () => void copySelectedCells(true),
            separatorBefore: true,
          },
          {
            key: "copy-selected-cell-values",
            label: "Copy selected cell values",
            onSelect: () => void copySelectedCells(false),
          },
          {
            key: "select-rows-from-selected-cells",
            label: "Select rows from selected cells",
            onSelect: selectRowsFromSelectedCells,
          },
        );
      }

      if (onCopyRowJSON) {
        items.push({
          key: "copy-row-json",
          label: "Copy row as JSON",
          onSelect: () => onCopyRowJSON(rowData),
          separatorBefore: true,
        });
      }
      if (onCopyRowCSV) {
        items.push({
          key: "copy-row-csv",
          label: "Copy row as CSV",
          onSelect: () => onCopyRowCSV(rowData),
          separatorBefore: !onCopyRowJSON,
        });
      }

      setContextMenu({
        x: event.bounds.x + event.localEventX,
        y: event.bounds.y + event.localEventY,
        items,
      });
    },
    [
      columns,
      rows,
      selectedRows,
      toggleRowSelected,
      onDuplicateRow,
      onFilterByCell,
      onCopyRowJSON,
      onCopyRowCSV,
      hasMultiCellSelection,
      copySelectedCells,
      selectRowsFromSelectedCells,
    ],
  );

  const onGridKeyDown = useCallback(
    (event: GridKeyEventArgs) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedRows(new Set(rows.map((_, i) => i)));
        setSelectedCell(null);
        return;
      }

      if (event.altKey && selectedCell) {
        const rowData = rows[selectedCell.rowIndex];
        if (!rowData) return;
        const rowId = getRowId(rowData, selectedCell.rowIndex);
        if (!rowId) return;
        const columnName = selectedCell.columnName as string;

        if (event.key.toLowerCase() === "n") {
          event.preventDefault();
          const struct = tableStructByName.get(columnName);
          const columnType = struct?.data_type || struct?.type || "";
          const isCurrentlyModified =
            pendingChanges?.[rowId] && columnName in pendingChanges[rowId];
          const oldValue = isCurrentlyModified
            ? pendingChanges[rowId][columnName].old
            : rowData[columnName];
          void handleUpdateRow(rowId, columnName, oldValue, null, columnType);
        } else if (event.key.toLowerCase() === "d") {
          event.preventDefault();
          setPendingChanges((prev: any) => {
            if (!prev?.[rowId] || !(columnName in prev[rowId])) return prev;
            const next = { ...prev };
            const rowChanges = { ...next[rowId] };
            delete rowChanges[columnName];
            if (Object.keys(rowChanges).length === 0) delete next[rowId];
            else next[rowId] = rowChanges;
            return next;
          });
        }
      }
    },
    [
      rows,
      selectedCell,
      getRowId,
      tableStructByName,
      pendingChanges,
      handleUpdateRow,
      setPendingChanges,
      setSelectedRows,
      setSelectedCell,
    ],
  );

  if (!results && !loading) {
    return <NoResultsState error={error} />;
  }

  const showWhimsicalEmptyState =
    whimsicalEmptyStates && results && rows.length === 0 && !loading;

  if (showWhimsicalEmptyState) {
    return <WhimsicalEmptyState onOpenInsertSheet={onOpenInsertSheet} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-studio-bg overflow-hidden">
      <div ref={wrapperRef} className="relative flex-1 min-h-0">
        <DataEditor
          ref={gridRef}
          getCellContent={getCellContent}
          columns={columns}
          rows={rows.length}
          rowHeight={rowHeight}
          headerHeight={HEADER_HEIGHT}
          theme={theme}
          headerIcons={REXA_HEADER_ICONS}
          drawHeader={onDrawHeader}
          overscrollX={0}
          overscrollY={0}
          onCellEdited={onCellEdited}
          onColumnResize={onColumnResize}
          onItemHovered={onItemHovered}
          onCellClicked={onCellClicked}
          onCellActivated={onCellActivated}
          onCellContextMenu={onCellContextMenu}
          onKeyDown={onGridKeyDown}
          onHeaderClicked={onHeaderClicked}
          customRenderers={CUSTOM_RENDERERS}
          rowMarkers={{
            kind: "checkbox-visible",
            width: ROW_MARKER_WIDTH,
            headerAlwaysVisible: true,
          }}
          freezeColumns={stickyFirstDataColumn ? 1 : 0}
          rowSelectionMode="multi"
          // Headers are for sorting only — never select/highlight columns.
          columnSelect="none"
          // Default is "rect" (drag-select / shift-click extend a single
          // contiguous rectangle only). "multi-rect" additionally allows
          // ctrl/cmd-click to add further discontiguous rectangles to
          // gridSelection.current.rangeStack — matching the legacy grid's
          // ctrl-click multiSelectedCells behavior.
          rangeSelect="multi-rect"
          drawFocusRing={false}
          gridSelection={gridSelection}
          onGridSelectionChange={onGridSelectionChange}
          getCellsForSelection={true}
          smoothScrollX
          smoothScrollY
          width={gridSize ? gridSize.width : "100%"}
          height={gridSize ? gridSize.height : "100%"}
        />
        {showAddColumn && connectionString && selectedTable && setIsAddColumnSheetOpen ? (
          <AddColumnSheet
            isOpen={!!isAddColumnSheetOpen}
            onOpenChange={setIsAddColumnSheetOpen}
            connectionString={connectionString}
            selectedSchema={selectedSchema}
            tableName={selectedTable}
            onAddColumn={handleAddColumn!}
            isAdding={!!isAddingColumn}
          />
        ) : null}
        {handleEditColumn && connectionString && selectedTable && setIsEditColumnSheetOpen ? (
          <EditColumnSheet
            isOpen={!!isEditColumnSheetOpen}
            onOpenChange={setIsEditColumnSheetOpen}
            connectionString={connectionString}
            selectedSchema={selectedSchema}
            tableName={selectedTable}
            columnName={columnToEdit ?? null}
            tableStructure={tableStructure}
            foreignKeys={foreignKeys}
            enums={enums}
            onEditColumn={handleEditColumn}
            isEditing={!!isEditingColumn}
          />
        ) : null}
        {handleDeleteColumn && setColumnToDelete ? (
          <AlertDialog
            open={!!columnToDelete}
            onOpenChange={(open) => !open && setColumnToDelete(null)}
          >
            <AlertDialogContent className="bg-popover border-studio-border text-foreground">
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  This will permanently delete the column{" "}
                  <span className="text-foreground font-medium">"{columnToDelete}"</span>{" "}
                  and all its data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-transparent border-studio-border hover:bg-studio-row-hover hover:text-foreground">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => columnToDelete && handleDeleteColumn(columnToDelete)}
                  className="bg-red-600 hover:bg-red-700 text-white border-none"
                >
                  Delete Column
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {contextMenu ? (
          <RexaContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        ) : null}
        {fkPreviewData &&
          createPortal(
          <div
            data-fk-preview
            className="fixed z-[300] bg-studio-bg border-2 border-blue-500 shadow-2xl rounded-lg flex flex-col"
            style={{
              left: `${fkPreviewData.position?.x || 0}px`,
              top: `${fkPreviewData.position?.y || 0}px`,
              transform:
                fkPreviewData.position?.placement === "above" ? "translateY(-100%)" : undefined,
              width: fkPreviewSize?.width ?? fkPreviewData.position?.width ?? 420,
              height: fkPreviewSize?.height ?? "auto",
              maxWidth: "80vw",
              maxHeight: "80vh",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 bg-muted/30 border-b border-studio-border flex items-center justify-between shrink-0">
              <div className="text-xs font-bold text-muted-foreground tracking-widest">
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
                  <span className="text-xs text-muted-foreground">Loading...</span>
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
                              <span className="text-xs font-semibold">{f.name}</span>
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
                            style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}
                          >
                            {fkPreviewData.data?.[f.name] === null ? (
                              <span className="text-muted-foreground/30 italic text-xs">NULL</span>
                            ) : typeof fkPreviewData.data?.[f.name] === "object" ? (
                              <span className="text-blue-400/80 font-mono text-xs">
                                {JSON.stringify(fkPreviewData.data?.[f.name])}
                              </span>
                            ) : (
                              <span className="text-xs">{String(fkPreviewData.data?.[f.name])}</span>
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
          </div>,
          document.body,
        )}
      </div>
      {showPaginationFooter ? (
        <PaginationFooter
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          loading={loading}
          recordCount={rows.length}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
});
