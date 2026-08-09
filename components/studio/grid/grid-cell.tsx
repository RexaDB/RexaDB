import * as React from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Calendar as CalendarIcon,
  CornerDownLeft,
  Link as LinkIcon,
  ChevronRight,
  X,
  List as ListIcon,
  Maximize2,
  Minimize2,
} from "@/lib/icon-theme/lucide-react";
import { format, parseISO, isValid, formatDistanceToNow } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { stringifyForClipboard } from "@/lib/studio/clipboard-utils";
import type { FKPreviewData, ToggleFKPreviewFn } from "./types";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface GridCellProps {
  rowIndex: number;
  columnName: string;
  value: any;
  originalValue?: any;
  customContent?: React.ReactNode;
  isPK: boolean;
  isFK: boolean;
  columnType?: string;
  enumOptions?: string[];
  isSelected: boolean;
  isCellSelected: boolean;
  isColumnSelected: boolean;
  isFirstRow?: boolean;
  isLastRow?: boolean;
  isFirstInSelection?: boolean;
  isLastInSelection?: boolean;
  isLastCell?: boolean;
  isEditing: boolean;
  isModified: boolean;
  isPendingDelete?: boolean;
  isSticky?: boolean;
  isInCellSelection?: boolean;
  isDiscreteCellSelection?: boolean;
  isDiscreteSelectionTopEdge?: boolean;
  isDiscreteSelectionBottomEdge?: boolean;
  isDiscreteSelectionLeftEdge?: boolean;
  isDiscreteSelectionRightEdge?: boolean;
  hasDiscreteBottomNeighbor?: boolean;
  hasDiscreteRightNeighbor?: boolean;
  isSelectionTopEdge?: boolean;
  isSelectionBottomEdge?: boolean;
  isSelectionLeftEdge?: boolean;
  isSelectionRightEdge?: boolean;
  editingValue: string;
  onSelect: (columnName: string, event: React.MouseEvent) => void;
  onMouseDownCell?: (columnName: string, event: React.MouseEvent) => void;
  onMouseEnterCell?: (columnName: string, event: React.MouseEvent) => void;
  onContextMenuCell?: (columnName: string, event: React.MouseEvent) => void;
  onDoubleClick: (columnName: string) => void;
  onEditChange: (columnName: string, value: any) => void;
  onEditCommit: () => void;
  handleFKPreview: (columnName: string, value: any) => void;
  onDuplicateRow?: () => void;
  onSelectRow?: (index: number) => void;
  onCopyRowJSON?: () => void;
  onCopyRowCSV?: () => void;
  rowSpacing?: "compact" | "standard" | "relaxed";
  rowBg?: string;
  columnWidth?: number;
  fkPreviewData?: FKPreviewData | null;
  onToggleFKPreview?: ToggleFKPreviewFn;
  hasMultiCellSelection?: boolean;
  onCopySelectedCells?: () => void;
  onCopySelectedCellValues?: () => void;
  onSelectRowsFromSelectedCells?: () => void;
  onFilterByCell?: (columnName: string, value: any) => void;
  colorizedPills?: boolean;
  relativeDates?: boolean;
  richJsonInspector?: boolean;
  dataBars?: boolean;
  columnMax?: number;
  searchHighlight?: string;
}

function SmartCellEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  onSetNull,
  onDiscardChange,
  isRtl = false,
  showDiscardAction = false,
  rowSpacing = "relaxed",
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onSetNull: () => void;
  onDiscardChange: () => void;
  isRtl?: boolean;
  showDiscardAction?: boolean;
  rowSpacing?: "compact" | "standard" | "relaxed";
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;

    if (!isMaximized) {
      // Auto-size textarea height up to a point
      node.style.height = "auto";
      const baseHeight =
        rowSpacing === "compact" ? 28 : rowSpacing === "standard" ? 32 : 36;
      const scrollHeight = node.scrollHeight;
      const maxHeight = 240;
      node.style.height = `${Math.min(maxHeight, Math.max(baseHeight, scrollHeight))}px`;
    } else {
      node.style.height = "100%";
    }
  }, [value, rowSpacing, isMaximized]);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    const placeCursorAtEnd = () => {
      const end = node.value.length;
      node.focus();
      node.setSelectionRange(end, end);
    };
    const frame = window.requestAnimationFrame(placeCursorAtEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [isMaximized]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onCommit();
    } else if (e.altKey && e.code === "KeyN") {
      e.preventDefault();
      onSetNull();
    } else if (showDiscardAction && e.altKey && e.code === "KeyD") {
      e.preventDefault();
      onDiscardChange();
    } else if (e.key === "Escape") {
      if (isMaximized) {
        setIsMaximized(false);
      } else {
        onCancel();
      }
    } else if (e.altKey && e.key === "m") {
      e.preventDefault();
      setIsMaximized(!isMaximized);
    }
  };

  const editorContent = (
    <div
      className={cn(
        "z-[100] border border-studio-border shadow-2xl flex flex-col overflow-hidden",
        isMaximized
          ? "fixed inset-x-[15%] inset-y-[15%] rounded-lg bg-studio-bg"
          : "absolute top-0 left-0 right-0 rounded-b-md rounded-t-none bg-studio-bg",
      )}
      style={{
        backgroundColor: isMaximized
          ? "var(--studio-bg)"
          : "color-mix(in srgb, var(--studio-row-hover) 85%, var(--studio-bg))",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn("relative flex-1 flex flex-col", isRtl && "items-end")}
      >
        <textarea
          ref={textareaRef}
          autoFocus
          className={cn(
            "w-full px-3 py-2 bg-transparent outline-none border-none text-xs text-foreground resize-none leading-relaxed overflow-y-auto",
            isRtl && "self-end text-right",
            isMaximized && "text-sm p-8",
          )}
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            if (isMaximized) return;
            // Only commit if we didn't click on the footer buttons
            if (!e.relatedTarget?.closest(".editor-footer")) {
              onCommit();
            }
          }}
          style={{
            unicodeBidi: "plaintext",
            fontFamily: isRtl ? "var(--font-arabic)" : undefined,
          }}
        />
      </div>

      <div
        className="editor-footer flex items-center justify-between px-3 py-1.5 bg-studio-row-hover border-t border-studio-border gap-4 shrink-0 font-sans"
        style={{
          fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
          letterSpacing: "0",
        }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            onClick={onCommit}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
          >
            <div className="flex items-center justify-center w-4 h-4 rounded bg-background border border-studio-border shrink-0 font-mono text-xs">
              <CornerDownLeft className="w-2.5 h-2.5" />
            </div>
            <span className="whitespace-nowrap">Save pending</span>
          </button>
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
          >
            <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
              esc
            </div>
            <span className="whitespace-nowrap">Cancel</span>
          </button>
          <button
            onClick={onSetNull}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
          >
            <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
              ⌥N
            </div>
            <span className="whitespace-nowrap">Set NULL</span>
          </button>
          {showDiscardAction && (
            <button
              onClick={onDiscardChange}
              className="flex items-center gap-1.5 text-xs text-amber-500 hover:text-amber-400 transition-colors whitespace-nowrap"
            >
              <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-medium shrink-0">
                ⌥D
              </div>
              <span className="whitespace-nowrap">Discard change</span>
            </button>
          )}
        </div>

        <button
          onClick={() => setIsMaximized(!isMaximized)}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground p-1 hover:bg-muted rounded"
          title={isMaximized ? "Minimize (Alt+M)" : "Maximize (Alt+M)"}
        >
          {isMaximized ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );

  if (isMaximized) {
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(8px)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          setIsMaximized(false);
        }}
      >
        {editorContent}
      </div>,
      document.body,
    );
  }

  return editorContent;
}

function JsonSyntaxHighlighter({ data }: { data: any }) {
  const jsonString = JSON.stringify(data, null, 2);

  // Basic regex for JSON highlighting
  const tokens = jsonString.split(
    /("(?:\\.|[^"])*")|(\b(?:true|false|null)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([\{\}\[\]:,])/g,
  );

  return (
    <div className="p-3 font-mono text-xs max-h-[400px] overflow-auto whitespace-pre leading-relaxed text-popover-foreground/90">
      {tokens.map((token, i) => {
        if (!token) return null;

        // String (key or value)
        if (token.startsWith('"')) {
          const isKey =
            jsonString[
              jsonString.indexOf(token, tokens.slice(0, i).join("").length) +
                token.length
            ] === ":";
          return (
            <span
              key={i}
              className={isKey ? "text-purple-400" : "text-green-400"}
            >
              {token}
            </span>
          );
        }

        // Boolean or Null
        if (/^(true|false|null)$/.test(token)) {
          return (
            <span key={i} className="text-orange-400 italic">
              {token}
            </span>
          );
        }

        // Number
        if (/^\d/.test(token)) {
          return (
            <span key={i} className="text-blue-400">
              {token}
            </span>
          );
        }

        // Punctuation
        return (
          <span key={i} className="text-slate-500">
            {token}
          </span>
        );
      })}
    </div>
  );
}

export const GridCell = React.memo(function GridCell({
  rowIndex,
  columnName,
  value,
  originalValue,
  customContent,
  isPK,
  isFK,
  columnType,
  enumOptions = [],
  isSelected,
  isCellSelected,
  isColumnSelected,
  isFirstRow,
  isLastRow,
  isFirstInSelection,
  isLastInSelection,
  isLastCell,
  isEditing,
  isModified,
  isPendingDelete = false,
  isSticky,
  isInCellSelection = false,
  isDiscreteCellSelection = false,
  isDiscreteSelectionTopEdge = false,
  isDiscreteSelectionBottomEdge = false,
  isDiscreteSelectionLeftEdge = false,
  isDiscreteSelectionRightEdge = false,
  hasDiscreteBottomNeighbor = false,
  hasDiscreteRightNeighbor = false,
  isSelectionTopEdge = false,
  isSelectionBottomEdge = false,
  isSelectionLeftEdge = false,
  isSelectionRightEdge = false,
  editingValue,
  onSelect,
  onMouseDownCell,
  onMouseEnterCell,
  onContextMenuCell,
  onDoubleClick,
  onEditChange,
  onEditCommit,
  handleFKPreview,
  onDuplicateRow,
  onSelectRow,
  onCopyRowJSON,
  onCopyRowCSV,
  rowSpacing = "relaxed",
  rowBg = "var(--studio-bg)",
  columnWidth,
  fkPreviewData,
  onToggleFKPreview,
  hasMultiCellSelection = false,
  onCopySelectedCells,
  onCopySelectedCellValues,
  onSelectRowsFromSelectedCells,
  onFilterByCell,
  colorizedPills = false,
  relativeDates = false,
  richJsonInspector = false,
  dataBars = false,
  columnMax,
  searchHighlight = "",
}: GridCellProps) {
  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest(
        'textarea, input, button, [role="button"], [role="listbox"], [role="option"], [data-cell-editor]',
      ),
    );
  };

  const typedEditorRef = React.useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = React.useState(editingValue);
  const [isHovered, setIsHovered] = React.useState(false);
  const normalizedColumnType = String(columnType || "").toLowerCase();
  const isDateType =
    normalizedColumnType.includes("timestamp") ||
    normalizedColumnType.includes("date");
  const isBooleanType =
    normalizedColumnType === "boolean" ||
    normalizedColumnType === "bool" ||
    normalizedColumnType.includes("bool");
  const isEnumType = enumOptions.length > 0;
  const INLINE_TYPED_OPTIONS_MAX = 8;
  const editorOptions = React.useMemo(() => {
    const base = isBooleanType
      ? ["true", "false"]
      : isEnumType
        ? enumOptions
        : [];
    if (!base.length) return [];
    if (!base.includes(localValue) && localValue) {
      return [localValue, ...base];
    }
    return base;
  }, [enumOptions, isBooleanType, isEnumType, localValue]);
  const isInlineTypedEditor =
    (isBooleanType || isEnumType) &&
    editorOptions.length > 0 &&
    editorOptions.length <= INLINE_TYPED_OPTIONS_MAX;

  React.useEffect(() => {
    if (isEditing) {
      setLocalValue(editingValue);
    }
  }, [isEditing, editingValue]);

  React.useEffect(() => {
    if (!isEditing || !(isBooleanType || isEnumType)) return;
    if (!editorOptions.length) return;
    if (!localValue || !editorOptions.includes(localValue)) {
      setLocalValue(editorOptions[0]);
    }
  }, [editorOptions, isBooleanType, isEditing, isEnumType, localValue]);

  const handleCommit = () => {
    onEditChange(columnName, localValue);
    onEditCommit();
  };

  const handleCancel = () => {
    setLocalValue(editingValue);
    onEditCommit();
  };

  const handleSetNull = React.useCallback(() => {
    onEditChange(columnName, null);
    onEditCommit();
  }, [columnName, onEditChange, onEditCommit]);

  const handleDiscardChange = React.useCallback(() => {
    if (!isModified) return;
    onEditChange(columnName, originalValue);
    onEditCommit();
  }, [isModified, columnName, originalValue, onEditChange, onEditCommit]);

  const cancelRef = React.useRef(handleCancel);
  React.useEffect(() => {
    cancelRef.current = handleCancel;
  }, [handleCancel]);

  React.useEffect(() => {
    if (!isEditing || !(isBooleanType || isEnumType)) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isEditing, isBooleanType, isEnumType]);

  React.useEffect(() => {
    if (!isEditing || !(isBooleanType || isEnumType)) return;
    typedEditorRef.current?.focus();
  }, [isEditing, isBooleanType, isEnumType]);

  const selectTypedOption = React.useCallback((nextValue: string) => {
    setLocalValue(nextValue);
  }, []);

  const moveTypedOptionSelection = React.useCallback(
    (delta: number) => {
      if (!editorOptions.length) return;
      const currentIndex = Math.max(
        0,
        editorOptions.indexOf(localValue || editorOptions[0]),
      );
      const nextIndex =
        (currentIndex + delta + editorOptions.length) % editorOptions.length;
      setLocalValue(editorOptions[nextIndex]);
    },
    [editorOptions, localValue],
  );

  const handleCopyCell = () => {
    navigator.clipboard.writeText(stringifyForClipboard(value));
  };

  const jsonInfo = React.useMemo(() => {
    if (!richJsonInspector || value === null || value === undefined)
      return null;

    if (typeof value === "object") {
      return {
        data: value,
        type: Array.isArray(value) ? "Array" : "Object",
      };
    }

    if (typeof value === "string" && value.length > 1) {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object") {
            return {
              data: parsed,
              type: Array.isArray(parsed) ? "Array" : "Object",
            };
          }
        } catch (e) {
          return null;
        }
      }
    }

    return null;
  }, [value, richJsonInspector]);

  const safeParseDate = (val: any): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return isValid(val) ? val : null;
    if (typeof val === "string") {
      const parsed = parseISO(val);
      return isValid(parsed) ? parsed : null;
    }
    if (typeof val === "number") {
      const parsed = new Date(val);
      return isValid(parsed) ? parsed : null;
    }
    return null;
  };

  const displayValue = React.useMemo(() => {
    if (value === null) return null;
    if (isDateType && value) {
      const date = safeParseDate(value);
      if (date) return format(date, "MMM d, yyyy HH:mm:ss");
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }, [value, isDateType]);
  const hasArabicScript = React.useMemo(() => {
    const raw =
      displayValue ??
      (value === null || value === undefined ? "" : String(value));
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(raw);
  }, [displayValue, value]);

  const isSearchMatch =
    searchHighlight && value !== null
      ? String(value).toLowerCase().includes(searchHighlight.toLowerCase())
      : false;

  const rowHeightClass =
    rowSpacing === "compact"
      ? "h-7"
      : rowSpacing === "standard"
        ? "h-8"
        : "h-9";
  const rowHeightPx =
    rowSpacing === "compact" ? 28 : rowSpacing === "standard" ? 32 : 36;

  const isFKPreviewOpen =
    fkPreviewData?.rowIndex === rowIndex &&
    fkPreviewData?.columnName === columnName;
  const cellSelectionBg = "rgba(29, 55, 126, 0.2)";
  // Sticky cells must use an opaque fill so scrolled columns underneath do not bleed through.
  const cellSelectionBgSticky =
    "color-mix(in srgb, rgb(78, 129, 238) 22%, var(--studio-bg))";
  const cellSelectionBorder = "rgb(78, 129, 238)";
  const dataBarWidth =
    dataBars &&
    columnMax &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isFinite(columnMax) &&
    columnMax > 0
      ? Math.max(0, Math.min(100, (value / columnMax) * 100))
      : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <td
          data-column-name={columnName}
          data-row-index={rowIndex}
          data-editing={isEditing}
          data-selected={
            isInCellSelection || isCellSelected || isColumnSelected
          }
          onClick={(event) => onSelect(columnName, event)}
          onMouseDown={(event) => {
            if (isEditing || isInteractiveTarget(event.target)) return;
            onMouseDownCell?.(columnName, event);
          }}
          onMouseEnter={(event) => {
            if ((event.buttons & 1) !== 1) {
              setIsHovered(true);
            }
            onMouseEnterCell?.(columnName, event);
          }}
          onContextMenu={(event) => onContextMenuCell?.(columnName, event)}
          onDoubleClick={(event) => {
            if (isInteractiveTarget(event.target)) return;
            onDoubleClick(columnName);
          }}
          onMouseLeave={() => setIsHovered(false)}
          className={cn(
            rowHeightClass,
            "px-3 font-normal text-xs border-r border-b border-studio-border last:border-r-0 cursor-default relative isolate overflow-hidden group/cell",
            "text-studio-cell-text",
            !isEditing && "select-none",
            isEditing && "px-0 py-0 overflow-visible",
            isSticky && "sticky z-10",
          )}
          style={
            {
              fontFamily: hasArabicScript ? "var(--font-arabic)" : undefined,
              width: columnWidth ? `${columnWidth}px` : undefined,
              minWidth: columnWidth ? `${columnWidth}px` : undefined,
              maxWidth: columnWidth ? `${columnWidth}px` : undefined,
              backgroundColor:
                isCellSelected || isColumnSelected
                  ? isSticky
                    ? cellSelectionBgSticky
                    : cellSelectionBg
                  : isInCellSelection
                    ? isSticky
                      ? cellSelectionBgSticky
                      : cellSelectionBg
                    : isSelected
                      ? "color-mix(in srgb, var(--studio-accent-purple) 15%, var(--studio-bg))"
                      : isPendingDelete
                        ? isSticky
                          ? "color-mix(in srgb, #ef4444 18%, var(--studio-bg))"
                          : "rgba(239, 68, 68, 0.16)"
                        : isModified
                          ? isSticky
                            ? "color-mix(in srgb, #f59e0b 15%, var(--studio-bg))"
                            : "rgba(245, 158, 11, 0.15)"
                          : isSearchMatch
                            ? "color-mix(in srgb, #9e6a09 30%, var(--studio-bg))"
                            : rowBg,
              backgroundImage:
                dataBarWidth !== null && !isEditing
                  ? `linear-gradient(to right, rgba(59, 130, 246, 0.10) 0%, rgba(59, 130, 246, 0.10) ${dataBarWidth}%, transparent ${dataBarWidth}%, transparent 100%)`
                  : undefined,
              // Keep selection layers below sticky cells and keep all grid z-layers local.
              zIndex: isEditing
                ? 18
                : isSticky
                  ? 12 + (isColumnSelected ? 2 : isSelected ? 1 : 0)
                  : isInCellSelection || isCellSelected
                    ? 4
                    : isColumnSelected
                      ? 2
                      : isSelected
                        ? 1
                        : 0,
              left: isSticky ? "48px" : undefined,
              // In cmd/ctrl multi-cell mode, hide native grid borders entirely and rely on
              // discrete edge overlays to draw the contiguous selection perimeter.
              borderColor: isDiscreteCellSelection ? "transparent" : undefined,
            } as React.CSSProperties
          }
        >
          {isHovered &&
            !isCellSelected &&
            !isColumnSelected &&
            !isInCellSelection && (
              <div className="absolute inset-0 z-0 bg-white/[0.03] dark:bg-[#24262b] pointer-events-none" />
            )}
          {isPendingDelete && (
            <div className="absolute inset-[1px] z-[36] pointer-events-none rounded-[2px] border border-dashed border-red-500/80" />
          )}
          {isColumnSelected && (
            <div className="absolute inset-0 z-50 pointer-events-none">
              <div className="absolute inset-y-0 left-0 w-[2px] bg-[rgb(78,129,238)]" />
              <div className="absolute inset-y-0 right-0 w-[2px] bg-[rgb(78,129,238)]" />
              {rowIndex === 0 && (
                <div className="absolute inset-x-0 top-0 h-[2px] bg-[rgb(78,129,238)]" />
              )}
              {isLastRow && (
                <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[rgb(78,129,238)]" />
              )}
            </div>
          )}
          {isSelected && (
            <div className="absolute inset-0 z-40 pointer-events-none">
              {isFirstInSelection && (
                <div className="absolute top-0 -left-[1px] -right-[1px] h-[2px] bg-studio-accent-purple" />
              )}
              {isLastInSelection && (
                <div className="absolute bottom-0 -left-[1px] -right-[1px] h-[2px] bg-studio-accent-purple" />
              )}
              {isLastCell && (
                <div className="absolute inset-y-0 right-0 w-[2px] bg-studio-accent-purple" />
              )}
            </div>
          )}
          {isInCellSelection && (
            <div className="absolute inset-0 z-[49] pointer-events-none">
              {isSelectionTopEdge && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-[rgb(78,129,238)]" />
              )}
              {isSelectionBottomEdge && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[rgb(78,129,238)]" />
              )}
              {isSelectionLeftEdge && (
                <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-[rgb(78,129,238)]" />
              )}
              {isSelectionRightEdge && (
                <div className="absolute top-0 bottom-0 right-0 w-[2px] bg-[rgb(78,129,238)]" />
              )}
            </div>
          )}
          {isDiscreteCellSelection && (
            <div className="absolute inset-0 z-50 pointer-events-none">
              {isDiscreteSelectionTopEdge && (
                <div
                  className="absolute top-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: cellSelectionBorder }}
                />
              )}
              {isDiscreteSelectionBottomEdge && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: cellSelectionBorder }}
                />
              )}
              {isDiscreteSelectionLeftEdge && (
                <div
                  className="absolute top-0 bottom-0 left-0 w-[2px]"
                  style={{ backgroundColor: cellSelectionBorder }}
                />
              )}
              {isDiscreteSelectionRightEdge && (
                <div
                  className="absolute top-0 bottom-0 right-0 w-[2px]"
                  style={{ backgroundColor: cellSelectionBorder }}
                />
              )}
            </div>
          )}
          {isCellSelected &&
            !hasMultiCellSelection &&
            !isDiscreteCellSelection && (
              <div
                className="absolute inset-0 z-50 pointer-events-none"
                style={{
                  backgroundColor: "transparent",
                  border: `2px solid ${cellSelectionBorder}`,
                }}
              />
            )}
          {isEditing ? (
            isBooleanType || isEnumType ? (
              <div
                ref={typedEditorRef}
                data-cell-editor
                tabIndex={0}
                className="absolute top-0 left-0 z-[100] border border-studio-border/80 shadow-2xl rounded-b-md rounded-t-none flex flex-col overflow-visible"
                style={{
                  width: "100%",
                  minHeight: "100%",
                  backgroundColor:
                    "color-mix(in srgb, var(--studio-row-hover) 70%, var(--studio-bg))",
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDownCapture={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCancel();
                  } else if (e.altKey && e.code === "KeyN") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSetNull();
                  } else if (e.altKey && e.code === "KeyD" && isModified) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDiscardChange();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                    e.preventDefault();
                    e.stopPropagation();
                    moveTypedOptionSelection(1);
                  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    e.stopPropagation();
                    moveTypedOptionSelection(-1);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCommit();
                  }
                }}
              >
                <div
                  className={cn(
                    "flex-1",
                    isInlineTypedEditor ? "px-0 py-0" : "px-3 py-2",
                  )}
                >
                  {isInlineTypedEditor ? (
                    <div
                      role="listbox"
                      aria-label={`${columnName} options`}
                      className="w-full overflow-hidden"
                    >
                      {editorOptions.map((option) => {
                        const isActive = option === localValue;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => selectTypedOption(option)}
                            className={cn(
                              "w-full text-left px-3 py-0 text-xs transition-colors flex items-center",
                              isActive
                                ? "bg-[rgba(29,55,126,0.2)] text-foreground"
                                : "text-foreground/72 hover:text-foreground",
                            )}
                            aria-selected={isActive}
                            style={{ height: rowHeightPx }}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <Select
                      value={localValue || editorOptions[0]}
                      onValueChange={(nextValue) => {
                        setLocalValue(nextValue);
                      }}
                    >
                      <SelectTrigger className="w-full bg-transparent border border-studio-border rounded-lg text-xs text-foreground px-2 py-1">
                        <SelectValue placeholder="Select value" />
                      </SelectTrigger>
                      <SelectContent
                        className="z-[220]"
                        onEscapeKeyDown={(e) => {
                          e.preventDefault();
                          handleCancel();
                        }}
                      >
                        {editorOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div
                  className="editor-footer flex items-center justify-between px-2 py-1.5 bg-studio-row-hover border-t border-studio-border gap-4 shrink-0 font-sans"
                  style={{
                    fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
                    letterSpacing: "0",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button
                      onClick={handleCommit}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center w-4 h-4 rounded bg-background border border-studio-border shrink-0 font-mono text-xs">
                        <CornerDownLeft className="w-2.5 h-2.5" />
                      </div>
                      <span className="whitespace-nowrap">Save pending</span>
                    </button>
                    <button
                      onClick={handleCancel}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                        esc
                      </div>
                      <span className="whitespace-nowrap">Cancel</span>
                    </button>
                    <button
                      onClick={handleSetNull}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                        ⌥N
                      </div>
                      <span className="whitespace-nowrap">Set NULL</span>
                    </button>
                    {isModified && (
                      <button
                        onClick={handleDiscardChange}
                        className="inline-flex items-center gap-1.5 text-xs font-medium tracking-normal text-amber-500 hover:text-amber-400 transition-colors whitespace-nowrap"
                      >
                        <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                          ⌥D
                        </div>
                        <span className="whitespace-nowrap">
                          Discard change
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : isDateType ? (
              <div
                data-cell-editor
                className="absolute inset-0 z-[100] border border-studio-border/80 shadow-2xl rounded-b-md rounded-t-none flex flex-col overflow-hidden"
                style={{
                  width: "100%",
                  backgroundColor:
                    "color-mix(in srgb, var(--studio-row-hover) 70%, var(--studio-bg))",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex-1 flex items-center px-3 gap-2 py-2">
                  <Popover
                    open={true}
                    onOpenChange={(open) => !open && handleCommit()}
                  >
                    <PopoverTrigger asChild>
                      <div className="flex items-center w-full h-full gap-2 cursor-pointer">
                        <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
                        <input
                          autoFocus
                          className={cn(
                            "flex-1 h-full bg-transparent outline-none border-none text-xs text-foreground",
                            hasArabicScript && "text-right",
                          )}
                          dir="auto"
                          value={localValue}
                          onChange={(e) => setLocalValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCommit();
                            else if (e.altKey && e.code === "KeyN")
                              handleSetNull();
                            else if (
                              e.altKey &&
                              e.code === "KeyD" &&
                              isModified
                            )
                              handleDiscardChange();
                            else if (e.key === "Escape") handleCancel();
                          }}
                          style={{
                            unicodeBidi: "plaintext",
                            fontFamily: hasArabicScript
                              ? "var(--font-arabic)"
                              : undefined,
                          }}
                        />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto p-0 bg-popover border-studio-border shadow-2xl"
                      align="start"
                      sideOffset={8}
                    >
                      <Calendar
                        mode="single"
                        selected={safeParseDate(localValue) || undefined}
                        onSelect={(date) => {
                          if (date) {
                            const formatted = date.toISOString();
                            onEditChange(columnName, formatted);
                            onEditCommit();
                          }
                        }}
                        initialFocus
                        className="bg-popover text-foreground"
                        classNames={{
                          day_selected:
                            "bg-blue-600 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-600 focus:text-white",
                          day_today: "bg-accent text-accent-foreground",
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div
                  className="editor-footer flex items-center justify-between px-2 py-1.5 bg-studio-row-hover border-t border-studio-border gap-4 shrink-0 font-sans"
                  style={{
                    fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
                    letterSpacing: "0",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button
                      onClick={handleCommit}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center w-4 h-4 rounded bg-background border border-studio-border shrink-0 font-mono text-xs">
                        <CornerDownLeft className="w-2.5 h-2.5" />
                      </div>
                      <span className="whitespace-nowrap">Save pending</span>
                    </button>
                    <button
                      onClick={handleCancel}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                        esc
                      </div>
                      <span className="whitespace-nowrap">Cancel</span>
                    </button>
                    <button
                      onClick={handleSetNull}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                        ⌥N
                      </div>
                      <span className="whitespace-nowrap">Set NULL</span>
                    </button>
                    {isModified && (
                      <button
                        onClick={handleDiscardChange}
                        className="inline-flex items-center gap-1.5 text-xs font-medium tracking-normal text-amber-500 hover:text-amber-400 transition-colors whitespace-nowrap"
                      >
                        <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
                          ⌥D
                        </div>
                        <span className="whitespace-nowrap">
                          Discard change
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div data-cell-editor className="absolute inset-0 z-[100]">
                <SmartCellEditor
                  value={localValue}
                  onChange={setLocalValue}
                  onCommit={handleCommit}
                  onCancel={handleCancel}
                  onSetNull={handleSetNull}
                  onDiscardChange={handleDiscardChange}
                  isRtl={hasArabicScript}
                  showDiscardAction={isModified}
                  rowSpacing={rowSpacing}
                />
              </div>
            )
          ) : (
            <div className="relative z-[2] flex h-full w-full min-w-0 items-center gap-2 overflow-hidden">
              {customContent !== undefined && customContent !== null ? (
                <div className="flex-1 min-w-0">{customContent}</div>
              ) : (
                <div
                  className={cn(
                    "flex-1 min-w-0 truncate flex items-center h-full",
                    hasArabicScript && "text-right",
                  )}
                  dir="auto"
                  lang={hasArabicScript ? "ar" : undefined}
                  style={{ unicodeBidi: "plaintext" }}
                >
                  {value === null ? (
                    <span
                      className={cn(
                        "block truncate italic text-xs",
                        hasArabicScript && "text-right",
                        isPendingDelete
                          ? "text-red-300/80 line-through decoration-dashed"
                          : "text-foreground/45",
                      )}
                    >
                      NULL
                    </span>
                  ) : colorizedPills && (isBooleanType || isEnumType) ? (
                    <div
                      className={cn(
                        "px-2 py-0.5 rounded-lg text-xs font-medium inline-flex items-center gap-1",
                        isBooleanType
                          ? value === true ||
                            String(value).toLowerCase() === "true"
                            ? "bg-green-500/10 text-green-500 border border-green-500/20"
                            : "bg-red-500/10 text-red-500 border border-red-500/20"
                          : "bg-blue-500/10 text-blue-500 border border-blue-500/20",
                      )}
                    >
                      {isBooleanType && (
                        <div
                          className={cn(
                            "w-1 h-1 rounded-lg",
                            value === true ||
                              String(value).toLowerCase() === "true"
                              ? "bg-green-500"
                              : "bg-red-500",
                          )}
                        />
                      )}
                      {String(value)}
                    </div>
                  ) : jsonInfo ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-studio-border bg-muted/30 text-xs font-mono text-studio-cell-text hover:bg-muted/50 transition-colors">
                            <ListIcon className="w-3 h-3 text-studio-cell-muted" />
                            <span>[{jsonInfo.type}]</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md p-0 shadow-2xl">
                          <JsonSyntaxHighlighter data={jsonInfo.data} />
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : relativeDates && isDateType && safeParseDate(value) ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "block truncate",
                              isPendingDelete
                                ? "text-red-300 line-through decoration-dashed"
                                : "text-studio-cell-text",
                            )}
                          >
                            {formatDistanceToNow(safeParseDate(value)!, {
                              addSuffix: true,
                            })}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          {displayValue}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : typeof value === "object" ? (
                    <span
                      className={cn(
                        "block truncate font-mono text-xs",
                        hasArabicScript && "text-right",
                        isPendingDelete &&
                          "text-red-300 line-through decoration-dashed",
                      )}
                    >
                      {JSON.stringify(value)}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "block truncate",
                        hasArabicScript && "text-right",
                        isPK ? "font-medium" : "",
                        isPendingDelete
                          ? "text-red-300 line-through decoration-dashed"
                          : isPK
                            ? "text-foreground"
                            : "text-studio-cell-text",
                      )}
                    >
                      {displayValue}
                    </span>
                  )}
                </div>
              )}
              {isFK && value !== null && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFKPreview?.(rowIndex, columnName, value, e);
                  }}
                  className="shrink-0 flex items-center justify-center w-5 h-5 rounded border border-studio-border/80 bg-background/10 text-studio-cell-muted transition-colors hover:border-studio-border hover:bg-muted/40 hover:text-studio-cell-text"
                  title="Preview referenced record"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSelectRow?.(rowIndex)}>
          {isSelected ? "Deselect row" : "Select row"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDuplicateRow}>
          Duplicate row
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleCopyCell}>Copy cell</ContextMenuItem>
        {onFilterByCell && (
          <ContextMenuItem onClick={() => onFilterByCell(columnName, value)}>
            Filter by this value
          </ContextMenuItem>
        )}
        {hasMultiCellSelection && (
          <>
            <ContextMenuItem onClick={onCopySelectedCells}>
              Copy selected cells
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopySelectedCellValues}>
              Copy selected cell values
            </ContextMenuItem>
            <ContextMenuItem onClick={onSelectRowsFromSelectedCells}>
              Select rows from selected cells
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={onCopyRowJSON}>
          Copy row as JSON
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyRowCSV}>
          Copy row as CSV
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
