import * as React from "react";
import {
  ChevronDown,
  Key,
  Type,
  Hash,
  Calendar,
  CheckSquare,
  List,
  Link as LinkIcon,
  Database,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit2,
} from "@/lib/icon-theme/lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const getTypeIcon = (type: string) => {
  const t = type.toLowerCase();
  if (
    t.includes("int") ||
    t.includes("float") ||
    t.includes("decimal") ||
    t.includes("numeric")
  )
    return <Hash className="w-3.5 h-3.5" />;
  if (t.includes("date") || t.includes("time"))
    return <Calendar className="w-3.5 h-3.5" />;
  if (t.includes("bool")) return <CheckSquare className="w-3.5 h-3.5" />;
  if (t.includes("uuid")) return <Database className="w-3.5 h-3.5" />;
  if (t.includes("json")) return <List className="w-3.5 h-3.5" />;
  if (t.includes("char") || t.includes("text") || t.includes("varchar"))
    return <Type className="w-3.5 h-3.5" />;
  return <Type className="w-3.5 h-3.5" />;
};

interface GridHeaderProps {
  fields: any[];
  tableStructure: any[];
  pendingDeletedColumns?: Set<string>;
  columnWidths: Record<string, number>;
  selectedRowsCount: number;
  totalRowsCount: number;
  toggleAllSelection: () => void;
  selectionColumnWidth?: number;
  stickySelectionColumn?: boolean;
  stickyFirstDataColumn?: boolean;
  hoveredColumn: string | null;
  setHoveredColumn: (column: string | null) => void;
  selectedColumn: string | null;
  setSelectedColumn: (column: string | null) => void;
  onAddColumnClick: () => void;
  showAddColumn?: boolean;
  showHeaderIcons?: boolean;
  stickyHeader?: boolean;
  sortConfig: { column: string; direction: "ASC" | "DESC" } | null;
  setSortConfig: (
    config: { column: string; direction: "ASC" | "DESC" } | null,
  ) => void;
  onDeleteColumn?: (columnName: string) => void;
  onEditColumn?: (columnName: string) => void;
  onColumnWidthChange: (columnName: string, width: number) => void;
  onClearCellSelection?: () => void;
  glassmorphicHeaders?: boolean;
}

export const GridHeader = React.memo(function GridHeader({
  fields,
  tableStructure,
  pendingDeletedColumns = new Set<string>(),
  columnWidths,
  selectedRowsCount,
  totalRowsCount,
  toggleAllSelection,
  selectionColumnWidth = 48,
  stickySelectionColumn = true,
  stickyFirstDataColumn = true,
  hoveredColumn,
  setHoveredColumn,
  selectedColumn,
  setSelectedColumn,
  onAddColumnClick,
  showAddColumn = true,
  showHeaderIcons = true,
  stickyHeader = true,
  sortConfig,
  setSortConfig,
  onDeleteColumn,
  onEditColumn,
  onColumnWidthChange,
  onClearCellSelection,
  glassmorphicHeaders = false,
}: GridHeaderProps) {
  const HOVER_TOOLTIP_DELAY_MS = 900;
  const isAllSelected =
    totalRowsCount > 0 && selectedRowsCount === totalRowsCount;
  const isSomeSelected =
    selectedRowsCount > 0 && selectedRowsCount < totalRowsCount;
  const hoverTooltipTimerRef = React.useRef<number | null>(null);
  const [hoverTooltip, setHoverTooltip] = React.useState<{
    visible: boolean;
    fieldName: string;
    type: string;
    isPK: boolean;
    isFK: boolean;
    x: number;
    y: number;
  } | null>(null);

  const clearHoverTooltipTimer = React.useCallback(() => {
    if (hoverTooltipTimerRef.current !== null) {
      window.clearTimeout(hoverTooltipTimerRef.current);
      hoverTooltipTimerRef.current = null;
    }
  }, []);

  const showHoverTooltipWithDelay = React.useCallback(
    (payload: {
      fieldName: string;
      type: string;
      isPK: boolean;
      isFK: boolean;
      x: number;
      y: number;
    }) => {
      clearHoverTooltipTimer();
      setHoverTooltip({
        ...payload,
        visible: false,
      });
      hoverTooltipTimerRef.current = window.setTimeout(() => {
        setHoverTooltip((prev) => {
          if (!prev || prev.fieldName !== payload.fieldName) return prev;
          return { ...prev, visible: true };
        });
        hoverTooltipTimerRef.current = null;
      }, HOVER_TOOLTIP_DELAY_MS);
    },
    [clearHoverTooltipTimer],
  );

  React.useEffect(() => {
    return () => {
      clearHoverTooltipTimer();
    };
  }, [clearHoverTooltipTimer]);

  const getDisplayType = React.useCallback((struct: any, field: any) => {
    const structType = String(struct?.data_type || "").trim();
    const udtName = String(struct?.udt_name || "").trim();
    const fieldType = String(field?.dataTypeName || "").trim();
    const normalized = structType || udtName || fieldType || "text";
    if (normalized === "USER-DEFINED" && udtName) return udtName;
    return normalized;
  }, []);

  const getSortLabels = (type: string) => {
    const t = type.toLowerCase();
    if (
      t.includes("int") ||
      t.includes("decimal") ||
      t.includes("numeric") ||
      t.includes("real") ||
      t.includes("double") ||
      t.includes("serial")
    ) {
      return { asc: "Less to more", desc: "More to less" };
    }
    if (t.includes("date") || t.includes("time") || t.includes("timestamp")) {
      return { asc: "Oldest first", desc: "Newest first" };
    }
    if (t.includes("bool")) {
      return { asc: "False first", desc: "True first" };
    }
    return { asc: "A - Z", desc: "Z - A" };
  };

  return (
    <thead
      className={cn(
        "studio-grid-header select-none",
        stickyHeader ? "sticky top-0 z-[120]" : "",
        glassmorphicHeaders
          ? "backdrop-blur-md bg-table-header-bg/80"
          : "bg-table-header-bg",
      )}
    >
      <tr
        className={cn(
          glassmorphicHeaders ? "bg-transparent" : "bg-table-header-bg",
        )}
      >
        {/* Selection Header */}
        <th
          className={cn(
            "h-10 border-b border-r border-studio-border p-0",
            stickySelectionColumn ? "sticky left-0 z-[140]" : "",
            glassmorphicHeaders
              ? stickySelectionColumn
                ? "bg-table-header-bg/95 backdrop-blur-md"
                : "bg-transparent"
              : "bg-table-header-bg",
          )}
          style={{ width: selectionColumnWidth }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={toggleAllSelection}
              className="w-4 h-4 border-studio-border data-[state=checked]:bg-studio-accent-purple data-[state=checked]:border-studio-accent-purple data-[state=checked]:text-black dark:data-[state=checked]:text-white"
            />
          </div>
        </th>

        {/* Column Headers */}
        {fields.map((field, idx) => {
          const struct = tableStructure?.find(
            (c) => (c.name || c.column_name) === field.name,
          );
          const isPK = struct?.is_primary_key;
          const isFK = struct?.is_foreign_key;
          const type = getDisplayType(struct, field);
          const isSticky = stickyFirstDataColumn && idx === 0;
          const isHovered = hoveredColumn === field.name;
          const isSelected = selectedColumn === field.name;
          const isSorted = sortConfig?.column === field.name;
          const isPendingDelete = pendingDeletedColumns.has(field.name);
          const sortLabels = getSortLabels(type);
          const handleResizeStart = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startWidth = columnWidths[field.name] ?? 150;

            const handleMouseMove = (event: MouseEvent) => {
              const nextWidth = startWidth + (event.clientX - startX);
              onColumnWidthChange(field.name, nextWidth);
            };

            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
              document.body.style.cursor = "";
              allowTextSelection();
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "col-resize";
            preventTextSelection();
          };

          return (
            <th
              key={field.name}
              onMouseEnter={(e) => {
                setHoveredColumn(field.name);
                showHoverTooltipWithDelay({
                  fieldName: field.name,
                  type,
                  isPK: Boolean(isPK),
                  isFK: Boolean(isFK),
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onMouseMove={(e) => {
                setHoverTooltip((prev) => {
                  if (!prev || prev.fieldName !== field.name) return prev;
                  return { ...prev, x: e.clientX, y: e.clientY };
                });
              }}
              onMouseLeave={() => {
                setHoveredColumn(null);
                clearHoverTooltipTimer();
                setHoverTooltip(null);
              }}
              onClick={() => {
                onClearCellSelection?.();
                setSelectedColumn(field.name);
              }}
              className={cn(
                "h-10 p-0 text-left border-b border-r border-studio-border transition-colors relative group cursor-default select-none",
                glassmorphicHeaders
                  ? isSticky
                    ? "bg-table-header-bg/95 backdrop-blur-md"
                    : "bg-transparent"
                  : "bg-table-header-bg",
                isPendingDelete && "border-red-500/70",
                isSticky && "sticky z-[130]",
                isSelected && "bg-muted/50",
              )}
              style={{
                width: columnWidths[field.name] ?? 150,
                backgroundColor: isPendingDelete
                  ? "rgba(239, 68, 68, 0.16)"
                  : isHovered
                    ? "var(--studio-border)"
                    : undefined,
                left: isSticky ? `${selectionColumnWidth}px` : undefined,
              }}
            >
              <div className="px-4 h-full flex items-center justify-between group/cell">
                <div className="flex items-center gap-2 overflow-hidden">
                  {showHeaderIcons && (
                    <div className="shrink-0 text-foreground/60">
                      {getTypeIcon(type)}
                    </div>
                  )}
                  <span
                    className={cn(
                      "truncate font-medium text-xs",
                      isPendingDelete
                        ? "text-red-300 line-through decoration-dashed"
                        : "text-studio-cell-text",
                    )}
                  >
                    {field.name}
                  </span>
                  {showHeaderIcons && isPK && (
                    <Key className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  {showHeaderIcons && isFK && (
                    <LinkIcon className="w-3 h-3 text-blue-400 shrink-0" />
                  )}
                  {showHeaderIcons &&
                    isSorted &&
                    (sortConfig?.direction === "ASC" ? (
                      <ArrowUp className="w-3 h-3 text-blue-500" />
                    ) : (
                      <ArrowDown className="w-3 h-3 text-blue-500" />
                    ))}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`p-1 rounded hover:bg-studio-row-hover transition-colors ${
                        isHovered || isSelected ? "opacity-100" : "opacity-0"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ChevronDown className="w-3.5 h-3.5 text-studio-cell-muted" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48 bg-popover border-studio-border text-popover-foreground"
                  >
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-xs focus:bg-studio-row-hover focus:text-foreground cursor-pointer"
                      onClick={() =>
                        setSortConfig({ column: field.name, direction: "ASC" })
                      }
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-studio-cell-muted" />
                      {sortLabels.asc}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-xs focus:bg-studio-row-hover focus:text-foreground cursor-pointer"
                      onClick={() =>
                        setSortConfig({ column: field.name, direction: "DESC" })
                      }
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-studio-cell-muted" />
                      {sortLabels.desc}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-studio-border" />
                    <DropdownMenuItem className="flex items-center gap-2 text-xs focus:bg-studio-row-hover focus:text-foreground cursor-pointer">
                      Resize to fit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-studio-border" />
                    {onEditColumn && (
                      <>
                        <DropdownMenuItem
                          className="flex items-center gap-2 text-xs focus:bg-studio-row-hover focus:text-foreground cursor-pointer"
                          onClick={() => onEditColumn(field.name)}
                        >
                          <Edit2 className="w-3.5 h-3.5 text-studio-cell-muted" />
                          Edit column
                        </DropdownMenuItem>
                        {onDeleteColumn && (
                          <DropdownMenuSeparator className="bg-studio-border" />
                        )}
                      </>
                    )}
                    {onDeleteColumn && (
                      <DropdownMenuItem
                        className="flex items-center gap-2 text-xs text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                        onClick={() => onDeleteColumn(field.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete column
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {isPendingDelete && (
                <div className="absolute inset-[2px] pointer-events-none rounded-[3px] border border-dashed border-red-500/80" />
              )}
              <div
                className="absolute top-0 right-0 h-full w-2 cursor-col-resize z-20"
                onMouseDown={handleResizeStart}
              >
                <div className="absolute right-0 top-0 h-full w-px bg-transparent group-hover:bg-blue-500/60" />
              </div>
            </th>
          );
        })}

        {/* Add Column Placeholder */}
        {showAddColumn && (
          <th
            onClick={onAddColumnClick}
            className="bg-table-header-bg border-b border-r-0 border-studio-border hover:bg-studio-row-hover cursor-default group whitespace-nowrap"
          >
            <div className="px-6 flex items-center gap-2 text-xs text-studio-cell-muted font-medium group-hover:text-foreground transition-colors">
              <Plus className="w-3.5 h-3.5" />
              <span>Add column</span>
            </div>
          </th>
        )}
      </tr>
      {hoverTooltip?.visible && (
        <tr>
          <th className="p-0 border-0 h-0">
            <div
              className="pointer-events-none fixed z-[220] w-max rounded-lg border border-studio-border/80 bg-popover/95 px-2.5 py-1.5 shadow-md backdrop-blur"
              style={{
                left: hoverTooltip.x + 12,
                top: hoverTooltip.y + 12,
              }}
            >
              <div className="flex items-center gap-2 whitespace-nowrap text-xs">
                <span className="text-foreground/65">Column:</span>
                <span className="font-semibold text-foreground">
                  {hoverTooltip.fieldName}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-xs">
                <span className="text-foreground/65">Type:</span>
                <span className="font-mono text-foreground">
                  {hoverTooltip.type}
                </span>
                {hoverTooltip.isPK && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0 text-xs font-semibold text-amber-300">
                    PK
                  </span>
                )}
                {hoverTooltip.isFK && (
                  <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1 py-0 text-xs font-semibold text-blue-300">
                    FK
                  </span>
                )}
              </div>
            </div>
          </th>
        </tr>
      )}
    </thead>
  );
});
