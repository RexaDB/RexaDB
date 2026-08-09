import * as React from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import { GridCell } from "./grid-cell";
import { cn } from "@/lib/utils";
import type { FKPreviewData, ToggleFKPreviewFn } from "./types";

interface GridRowProps {
  rowIndex: number;
  prevVisibleRowIndex: number | null;
  nextVisibleRowIndex: number | null;
  row: any;
  fields: any[];
  tableStructure: any[];
  tableStructByName: Map<string, any>;
  customCellRenderer?: (args: {
    row: any;
    columnName: string;
    value: any;
    rowIndex: number;
  }) => React.ReactNode;
  enums?: Array<{
    schema: string;
    name: string;
    values: string[];
  }>;
  enumByName: Map<string, { schema: string; name: string; values: string[] }[]>;
  isSelected: boolean;
  isFirstInSelection: boolean;
  isLastInSelection: boolean;
  rowPendingChanges: Record<string, any> | undefined;
  isPendingDeleteRow?: boolean;
  pendingDeletedColumns?: Set<string>;
  renderSelectionCell?: (row: any) => React.ReactNode;
  selectionColumnWidth?: number;
  columnWidths: Record<string, number>;
  stickySelectionColumn?: boolean;
  stickyFirstDataColumn?: boolean;
  onToggleSelection: (index: number) => void;
  getRowId: (row: any, index: number) => string | null;
  setPendingChanges: (changes: Record<string, any>) => void;
  editingCell: { rowIndex: number; columnName: string } | null;
  setEditingCell: (cell: { rowIndex: number; columnName: string } | null) => void;
  selectedCell: { rowIndex: number; columnName: string } | null;
  pressedPreviewCell?: { rowIndex: number; columnName: string } | null;
  selectedCellKeys?: Set<string>;
  selectedDiscreteRows?: Set<number>;
  selectionRange: { rowStart: number; rowEnd: number; colStart: number; colEnd: number } | null;
  onCellSelect: (cell: { rowIndex: number; columnName: string }, event: React.MouseEvent) => void;
  onCellMouseDown: (cell: { rowIndex: number; columnName: string }, event: React.MouseEvent) => void;
  onCellMouseEnter: (cell: { rowIndex: number; columnName: string }, event: React.MouseEvent) => void;
  onCellContextMenu: (cell: { rowIndex: number; columnName: string }, event: React.MouseEvent) => void;
  handleUpdateRow: (rowId: string, columnName: string, oldValue: any, newValue: any, columnType: string) => Promise<void>;
  handleFKSelection: (rowIndex: number, columnName: string) => Promise<boolean>;
  handleFKPreview: (columnName: string, value: any) => void;
  selectedColumn: string | null;
  totalRows: number;
  onDuplicateRow: (row: any) => void;
  onCopyRowJSON: (row: any) => void;
  onCopyRowCSV: (row: any) => void;
  rowSpacing?: 'compact' | 'standard' | 'relaxed';
  alternatingRowColors?: boolean;
  fkPreviewData?: FKPreviewData | null;
  onToggleFKPreview?: ToggleFKPreviewFn;
  hasMultiCellSelection?: boolean;
  onCopySelectedCells?: () => void;
  onCopySelectedCellValues?: () => void;
  onSelectRowsFromSelectedCells?: () => void;
  onFilterByCell?: (columnName: string, value: any) => void;
  gridAnimations?: boolean;
  sleekSelection?: boolean;
  colorizedPills?: boolean;
  relativeDates?: boolean;
  richJsonInspector?: boolean;
  dataBars?: boolean;
  searchHighlight?: string;
  columnMaxValues?: Record<string, number>;
}

function GridRowComponent({
  rowIndex,
  prevVisibleRowIndex,
  nextVisibleRowIndex,
  row,
  fields,
  tableStructByName,
  customCellRenderer,
  enumByName,
  isSelected,
  isFirstInSelection,
  isLastInSelection,
  rowPendingChanges,
  isPendingDeleteRow = false,
  pendingDeletedColumns = new Set<string>(),
  renderSelectionCell,
  selectionColumnWidth = 48,
  columnWidths,
  stickySelectionColumn = true,
  stickyFirstDataColumn = true,
  onToggleSelection,
  getRowId,
  editingCell,
  setEditingCell,
  selectedCell,
  pressedPreviewCell,
  selectedCellKeys,
  selectionRange,
  onCellSelect,
  onCellMouseDown,
  onCellMouseEnter,
  onCellContextMenu,
  handleUpdateRow,
  handleFKSelection,
  handleFKPreview,
  selectedColumn,
  totalRows,
  onDuplicateRow,
  onCopyRowJSON,
  onCopyRowCSV,
  rowSpacing = 'relaxed',
  alternatingRowColors = false,
  fkPreviewData,
  onToggleFKPreview,
  hasMultiCellSelection = false,
  onCopySelectedCells,
  onCopySelectedCellValues,
  onSelectRowsFromSelectedCells,
  onFilterByCell,
  gridAnimations = false,
  sleekSelection = false,
  colorizedPills = false,
  relativeDates = false,
  richJsonInspector = false,
  dataBars = false,
  columnMaxValues = {},
  searchHighlight = "",
}: GridRowProps) {
  const rowId = getRowId(row, rowIndex);

  const handleCellDoubleClick = React.useCallback((columnName: string) => {
    const struct = tableStructByName.get(columnName);
    const isFK = struct?.is_foreign_key;
    if (isFK) {
      void (async () => {
        const opened = await handleFKSelection(rowIndex, columnName);
        // If FK picker cannot load (e.g. permissions on referenced table), allow manual editing.
        if (!opened) {
          setEditingCell({ rowIndex, columnName });
        }
      })();
    } else {
      setEditingCell({ rowIndex, columnName });
    }
  }, [handleFKSelection, rowIndex, setEditingCell, tableStructByName]);

  const handleCellEditChange = React.useCallback((columnName: string, newValue: any) => {
    if (rowId) {
      const struct = tableStructByName.get(columnName);
      const columnType = struct?.data_type || struct?.type || '';
      const isCurrentlyModified = rowPendingChanges && columnName in rowPendingChanges;
      const oldValue = isCurrentlyModified ? rowPendingChanges![columnName].old : row[columnName];
      handleUpdateRow(rowId, columnName, oldValue, newValue, columnType);
    }
  }, [handleUpdateRow, row, rowId, rowPendingChanges, tableStructByName]);

  const handleEditCommit = React.useCallback(() => {
    setEditingCell(null);
  }, [setEditingCell]);

  const handleDuplicate = React.useCallback(() => {
    onDuplicateRow(row);
  }, [onDuplicateRow, row]);

  const handleCopyJSON = React.useCallback(() => {
    onCopyRowJSON(row);
  }, [onCopyRowJSON, row]);

  const handleCopyCSV = React.useCallback(() => {
    onCopyRowCSV(row);
  }, [onCopyRowCSV, row]);

  const handleSelectCellInRow = React.useCallback((columnName: string, event: React.MouseEvent) => {
    onCellSelect({ rowIndex, columnName }, event);
  }, [onCellSelect, rowIndex]);

  const handleMouseDownCellInRow = React.useCallback((columnName: string, event: React.MouseEvent) => {
    onCellMouseDown({ rowIndex, columnName }, event);
  }, [onCellMouseDown, rowIndex]);

  const handleMouseEnterCellInRow = React.useCallback((columnName: string, event: React.MouseEvent) => {
    onCellMouseEnter({ rowIndex, columnName }, event);
  }, [onCellMouseEnter, rowIndex]);

  const handleContextMenuCellInRow = React.useCallback((columnName: string, event: React.MouseEvent) => {
    onCellContextMenu({ rowIndex, columnName }, event);
  }, [onCellContextMenu, rowIndex]);

  const isEven = rowIndex % 2 === 0;
  const rowBg = isSelected 
    ? 'color-mix(in srgb, var(--studio-accent-purple) 15%, var(--studio-bg))' 
    : isPendingDeleteRow
      ? 'rgba(239, 68, 68, 0.12)'
    : (alternatingRowColors && !isEven)
      ? 'color-mix(in srgb, var(--foreground) 2%, var(--studio-bg))'
      : 'var(--studio-bg)';

  const rowHeightClass = rowSpacing === 'compact' ? 'h-7' : rowSpacing === 'standard' ? 'h-8' : 'h-9';

  return (
    <>
    <tr className={cn(
      "group relative",
      gridAnimations ? "transition-colors duration-200 hover:bg-studio-accent-purple/5" : ""
    )}>
      {/* Selection Checkbox Cell */}
      <td
        className={cn(
          rowHeightClass,
          "border-b border-r p-0 select-none",
          stickySelectionColumn ? "sticky left-0 z-[12]" : "",
          isPendingDeleteRow ? "border-red-500/70" : "border-studio-border"
        )}
        style={{
          backgroundColor: rowBg,
          width: selectionColumnWidth,
        }}
      >
        <div
          className="w-full h-full flex items-center justify-center gap-2 relative cursor-pointer px-2"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('button') || target.closest('[role="checkbox"]') || target.closest('input[type="checkbox"]')) {
              return;
            }
            onToggleSelection(rowIndex);
          }}
        >
          {isPendingDeleteRow && (
            <div className="absolute inset-[2px] pointer-events-none rounded-[2px] border border-dashed border-red-500/80" />
          )}
          {isSelected && (
            <div className={cn(
              "absolute inset-0 z-40 pointer-events-none",
              sleekSelection ? "shadow-[inset_2px_0_0_0_var(--studio-accent-purple),inset_0_2px_0_0_var(--studio-accent-purple),inset_0_-2px_0_0_var(--studio-accent-purple)]" : ""
            )}>
              {!sleekSelection && <div className="absolute inset-y-0 left-0 w-[2px] bg-studio-accent-purple" />}
              {isFirstInSelection && !sleekSelection && <div className="absolute top-0 left-0 -right-[1px] h-[2px] bg-studio-accent-purple" />}
              {isLastInSelection && !sleekSelection && <div className="absolute bottom-0 left-0 -right-[1px] h-[2px] bg-studio-accent-purple" />}
              {sleekSelection && isFirstInSelection && <div className="absolute top-0 left-0 right-0 h-[2px] bg-studio-accent-purple shadow-[0_0_8px_var(--studio-accent-purple)]" />}
              {sleekSelection && isLastInSelection && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-studio-accent-purple shadow-[0_0_8px_var(--studio-accent-purple)]" />}
              {sleekSelection && <div className="absolute inset-y-0 left-0 w-[2px] bg-studio-accent-purple shadow-[0_0_8px_var(--studio-accent-purple)]" />}
            </div>
          )}
          <Checkbox 
            checked={isSelected} 
            onCheckedChange={() => onToggleSelection(rowIndex)}
            className="w-4 h-4 border-studio-border data-[state=checked]:bg-studio-accent-purple data-[state=checked]:border-studio-accent-purple data-[state=checked]:text-black dark:data-[state=checked]:text-white"
          />
          {renderSelectionCell ? renderSelectionCell(row) : null}
        </div>
      </td>

      {/* Data Cells */}
      {fields.map((field: any, idx: number) => {
        const struct = tableStructByName.get(field.name);
        const isPK = struct?.is_primary_key;
        const isFK = struct?.is_foreign_key;
        const columnType = struct?.data_type || struct?.type || '';
        const udtName = String(struct?.udt_name || "").trim();
        const udtSchema = String(struct?.udt_schema || "").trim();
        const enumMatch = udtName
          ? (
            enumByName.get(udtName)?.find((e) => !udtSchema || e.schema === udtSchema)
            || enumByName.get(udtName)?.[0]
          )
          : null;
        const enumOptions = Array.isArray(enumMatch?.values) ? enumMatch.values : undefined;
        const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === field.name;
        const hasDiscreteSelection = (selectedCellKeys?.size ?? 0) > 0;
        const isSingleCellRangeSelection = !hasDiscreteSelection
          && !!selectionRange
          && selectionRange.rowStart === selectionRange.rowEnd
          && selectionRange.colStart === selectionRange.colEnd;
        const isInDiscreteSelection = selectedCellKeys?.has(`${rowIndex}:${field.name}`) ?? false;
        const isPrimarySelected = (selectedCell?.rowIndex === rowIndex && selectedCell?.columnName === field.name)
          && (!hasDiscreteSelection || isInDiscreteSelection);
        const isPressedPreviewSelected = pressedPreviewCell?.rowIndex === rowIndex && pressedPreviewCell?.columnName === field.name;
        const isCellSelected = isPrimarySelected || isPressedPreviewSelected;
        const isInRangeSelection = !hasDiscreteSelection
          && !!selectionRange
          && rowIndex >= selectionRange.rowStart
          && rowIndex <= selectionRange.rowEnd
          && idx >= selectionRange.colStart
          && idx <= selectionRange.colEnd;
        const leftColumnName = idx > 0 ? fields[idx - 1]?.name : null;
        const rightColumnName = idx < fields.length - 1 ? fields[idx + 1]?.name : null;
        const hasDiscreteTopNeighbor = isInDiscreteSelection && prevVisibleRowIndex !== null && (selectedCellKeys?.has(`${prevVisibleRowIndex}:${field.name}`) ?? false);
        const hasDiscreteBottomNeighbor = isInDiscreteSelection && nextVisibleRowIndex !== null && (selectedCellKeys?.has(`${nextVisibleRowIndex}:${field.name}`) ?? false);
        const hasDiscreteLeftNeighbor = isInDiscreteSelection && !!leftColumnName && (selectedCellKeys?.has(`${rowIndex}:${leftColumnName}`) ?? false);
        const hasDiscreteRightNeighbor = isInDiscreteSelection && !!rightColumnName && (selectedCellKeys?.has(`${rowIndex}:${rightColumnName}`) ?? false);
        const isDiscreteSelectionTopEdge = isInDiscreteSelection && !hasDiscreteTopNeighbor;
        const isDiscreteSelectionBottomEdge = isInDiscreteSelection && !hasDiscreteBottomNeighbor;
        const isDiscreteSelectionLeftEdge = isInDiscreteSelection && !hasDiscreteLeftNeighbor;
        const isDiscreteSelectionRightEdge = isInDiscreteSelection && !hasDiscreteRightNeighbor;
        const isInCellSelection = hasDiscreteSelection
          ? isInDiscreteSelection
          : (isInRangeSelection && !(isCellSelected && isSingleCellRangeSelection));
        const isSelectionTopEdge = isInRangeSelection && !!selectionRange && rowIndex === selectionRange.rowStart;
        const isSelectionBottomEdge = isInRangeSelection && !!selectionRange && rowIndex === selectionRange.rowEnd;
        const isSelectionLeftEdge = isInRangeSelection && !!selectionRange && idx === selectionRange.colStart;
        const isSelectionRightEdge = isInRangeSelection && !!selectionRange && idx === selectionRange.colEnd;
        const isModified = rowPendingChanges && field.name in rowPendingChanges;
        const isPendingDelete = isPendingDeleteRow || pendingDeletedColumns.has(field.name);
        const value = isModified ? rowPendingChanges![field.name].new : row[field.name];
        const columnWidth = columnWidths[field.name];
        const customContent = customCellRenderer
          ? customCellRenderer({
              row,
              columnName: field.name,
              value,
              rowIndex,
            })
          : null;
        const isLast = idx === fields.length - 1;
        const isSticky = stickyFirstDataColumn && idx === 0;

        return (
          <GridCell
            key={field.name}
            rowIndex={rowIndex}
            columnName={field.name}
            value={value}
            originalValue={row[field.name]}
            customContent={customContent}
            isPK={isPK}
            isFK={isFK}
            columnType={columnType}
            enumOptions={enumOptions}
            columnWidth={columnWidth}
            isSelected={isSelected}
            isFirstInSelection={isFirstInSelection}
            isLastInSelection={isLastInSelection}
            isLastCell={isLast}
            isCellSelected={isCellSelected}
            isColumnSelected={selectedColumn === field.name}
            isFirstRow={rowIndex === 0}
            isLastRow={rowIndex === totalRows - 1}
            isEditing={isEditing}
            isModified={!!isModified}
            isPendingDelete={isPendingDelete}
            isSticky={isSticky}
            isInCellSelection={isInCellSelection}
            isDiscreteCellSelection={isInDiscreteSelection}
            isDiscreteSelectionTopEdge={isDiscreteSelectionTopEdge}
            isDiscreteSelectionBottomEdge={isDiscreteSelectionBottomEdge}
            isDiscreteSelectionLeftEdge={isDiscreteSelectionLeftEdge}
            isDiscreteSelectionRightEdge={isDiscreteSelectionRightEdge}
            hasDiscreteBottomNeighbor={hasDiscreteBottomNeighbor}
            hasDiscreteRightNeighbor={hasDiscreteRightNeighbor}
            isSelectionTopEdge={isSelectionTopEdge}
            isSelectionBottomEdge={isSelectionBottomEdge}
            isSelectionLeftEdge={isSelectionLeftEdge}
            isSelectionRightEdge={isSelectionRightEdge}
            editingValue={isEditing ? (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')) : ''}
            onSelect={handleSelectCellInRow}
            onMouseDownCell={handleMouseDownCellInRow}
            onMouseEnterCell={handleMouseEnterCellInRow}
            onContextMenuCell={handleContextMenuCellInRow}
            onDoubleClick={handleCellDoubleClick}
            onEditChange={handleCellEditChange}
            onEditCommit={handleEditCommit}
            handleFKPreview={handleFKPreview}
            onDuplicateRow={handleDuplicate}
            onSelectRow={onToggleSelection}
            onCopyRowJSON={handleCopyJSON}
            onCopyRowCSV={handleCopyCSV}
            rowSpacing={rowSpacing}
            rowBg={rowBg}
            fkPreviewData={fkPreviewData}
            onToggleFKPreview={onToggleFKPreview}
            hasMultiCellSelection={hasMultiCellSelection}
            onCopySelectedCells={onCopySelectedCells}
            onCopySelectedCellValues={onCopySelectedCellValues}
            onSelectRowsFromSelectedCells={onSelectRowsFromSelectedCells}
            onFilterByCell={onFilterByCell}
            colorizedPills={colorizedPills}
            relativeDates={relativeDates}
            richJsonInspector={richJsonInspector}
            dataBars={dataBars}
            columnMax={columnMaxValues[field.name]}
            searchHighlight={searchHighlight}
          />
        );
      })}
      
      {/* Empty space cell at end */}
       <td className="w-px bg-transparent border-none" />
    </tr>
    </>
  );
}

export const GridRow = React.memo(GridRowComponent, areGridRowPropsEqual);

function rowInRange(range: { rowStart: number; rowEnd: number; colStart: number; colEnd: number } | null, rowIndex: number): boolean {
  if (!range) return false;
  return rowIndex >= range.rowStart && rowIndex <= range.rowEnd;
}

function rowHasDiscreteSelection(rowIndex: number, fields: any[], selectedCellKeys?: Set<string>): boolean {
  if (!selectedCellKeys || selectedCellKeys.size === 0) return false;
  for (const field of fields) {
    if (selectedCellKeys.has(`${rowIndex}:${field.name}`)) return true;
  }
  return false;
}

function areGridRowPropsEqual(prev: GridRowProps, next: GridRowProps): boolean {
  if (prev.rowIndex !== next.rowIndex) return false;
  if (prev.prevVisibleRowIndex !== next.prevVisibleRowIndex) return false;
  if (prev.nextVisibleRowIndex !== next.nextVisibleRowIndex) return false;
  if (prev.row !== next.row) return false;
  if (prev.fields !== next.fields) return false;
  if (prev.tableStructure !== next.tableStructure) return false;
  if (prev.tableStructByName !== next.tableStructByName) return false;
  if (prev.customCellRenderer !== next.customCellRenderer) return false;
  if (prev.enums !== next.enums) return false;
  if (prev.enumByName !== next.enumByName) return false;
  if (prev.rowPendingChanges !== next.rowPendingChanges) return false;
  if (prev.isPendingDeleteRow !== next.isPendingDeleteRow) return false;
  if (prev.pendingDeletedColumns !== next.pendingDeletedColumns) return false;
  if (prev.renderSelectionCell !== next.renderSelectionCell) return false;
  if (prev.selectionColumnWidth !== next.selectionColumnWidth) return false;
  if (prev.columnWidths !== next.columnWidths) return false;
  if (prev.stickySelectionColumn !== next.stickySelectionColumn) return false;
  if (prev.stickyFirstDataColumn !== next.stickyFirstDataColumn) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isFirstInSelection !== next.isFirstInSelection) return false;
  if (prev.isLastInSelection !== next.isLastInSelection) return false;
  if (prev.selectedColumn !== next.selectedColumn) return false;
  if (prev.rowSpacing !== next.rowSpacing) return false;
  if (prev.alternatingRowColors !== next.alternatingRowColors) return false;
  if (prev.totalRows !== next.totalRows) return false;
  if (prev.fkPreviewData !== next.fkPreviewData) return false;
  if (prev.hasMultiCellSelection !== next.hasMultiCellSelection) return false;
  if (prev.gridAnimations !== next.gridAnimations) return false;
  if (prev.sleekSelection !== next.sleekSelection) return false;
  if (prev.colorizedPills !== next.colorizedPills) return false;
  if (prev.relativeDates !== next.relativeDates) return false;
  if (prev.richJsonInspector !== next.richJsonInspector) return false;
  if (prev.dataBars !== next.dataBars) return false;
  if (prev.columnMaxValues !== next.columnMaxValues) return false;

  const row = prev.rowIndex;
  const prevSelectedCellHitsRow = prev.selectedCell?.rowIndex === row;
  const nextSelectedCellHitsRow = next.selectedCell?.rowIndex === row;
  if (prevSelectedCellHitsRow || nextSelectedCellHitsRow) {
    if (
      prev.selectedCell?.rowIndex !== next.selectedCell?.rowIndex
      || prev.selectedCell?.columnName !== next.selectedCell?.columnName
    ) {
      return false;
    }
  }

  const prevPressedHitsRow = prev.pressedPreviewCell?.rowIndex === row;
  const nextPressedHitsRow = next.pressedPreviewCell?.rowIndex === row;
  if (prevPressedHitsRow || nextPressedHitsRow) {
    if (
      prev.pressedPreviewCell?.rowIndex !== next.pressedPreviewCell?.rowIndex
      || prev.pressedPreviewCell?.columnName !== next.pressedPreviewCell?.columnName
    ) {
      return false;
    }
  }

  const prevRangeHitsRow = rowInRange(prev.selectionRange, row);
  const nextRangeHitsRow = rowInRange(next.selectionRange, row);
  if (prevRangeHitsRow !== nextRangeHitsRow) return false;
  if (prevRangeHitsRow && nextRangeHitsRow) {
    if (
      prev.selectionRange?.colStart !== next.selectionRange?.colStart
      || prev.selectionRange?.colEnd !== next.selectionRange?.colEnd
    ) {
      return false;
    }
    const wasTopEdge = prev.selectionRange?.rowStart === row;
    const isTopEdge = next.selectionRange?.rowStart === row;
    if (wasTopEdge !== isTopEdge) return false;
    const wasBottomEdge = prev.selectionRange?.rowEnd === row;
    const isBottomEdge = next.selectionRange?.rowEnd === row;
    if (wasBottomEdge !== isBottomEdge) return false;
  }

  const prevEditingHitsRow = prev.editingCell?.rowIndex === row;
  const nextEditingHitsRow = next.editingCell?.rowIndex === row;
  if (prevEditingHitsRow || nextEditingHitsRow) {
    if (
      prev.editingCell?.rowIndex !== next.editingCell?.rowIndex
      || prev.editingCell?.columnName !== next.editingCell?.columnName
    ) {
      return false;
    }
  }

  const prevDiscreteHitsRow = prev.selectedDiscreteRows?.has(row) ?? rowHasDiscreteSelection(row, prev.fields, prev.selectedCellKeys);
  const nextDiscreteHitsRow = next.selectedDiscreteRows?.has(row) ?? rowHasDiscreteSelection(row, next.fields, next.selectedCellKeys);
  if (prevDiscreteHitsRow !== nextDiscreteHitsRow) return false;
  if (prevDiscreteHitsRow && nextDiscreteHitsRow && prev.selectedCellKeys !== next.selectedCellKeys) return false;

  if (prev.searchHighlight !== next.searchHighlight) return false;

  return true;
}
