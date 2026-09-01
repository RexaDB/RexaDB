"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  GridCellKind,
  roundedRect,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorComponent,
} from "@glideapps/glide-data-grid";
import { cn } from "@/lib/utils";
import {
  CornerDownLeft,
  Maximize2,
  Minimize2,
  Calendar as CalendarIcon,
} from "@/lib/icon-theme/lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { classifyColumnType, safeParseDate, type RexaCellData } from "./cell-content";

export type RexaCell = CustomCell<RexaCellData>;

// Shared with data-grid.tsx's onCellClicked hit-test — one source of truth
// for where the FK preview button lives so the drawn button and the
// clickable zone can never drift apart.
export const FK_PREVIEW_BUTTON_SIZE = 20; // matches legacy grid's w-5 h-5
export const FK_PREVIEW_BUTTON_MARGIN = 6;

const COLORS = {
  red500: "#ef4444",
  red300: "#fca5a5",
  amber500: "#f59e0b",
  searchAmber: "rgba(158, 106, 9, 0.3)",
  green500: "#22c55e",
  blue500: "#3b82f6",
  // Matches the legacy grid's single-cell selection ring/fill exactly
  // (grid/grid-cell.tsx's `cellSelectionBorder`/`cellSelectionBg`). Drawn
  // by us, not Glide's own focus-ring machinery (disabled via
  // `drawFocusRing={false}` in data-grid.tsx) — that only draws a 1x1
  // outline for the *previous* full (non-damage) frame, so it visibly
  // trails a row/column behind on every selection change.
  selectionFill: "rgba(29, 55, 126, 0.2)",
  selectionBorder: "rgb(78, 129, 238)",
};

function isRexaCell(cell: CustomCell): cell is RexaCell {
  return (cell.data as RexaCellData | undefined)?.kind !== undefined;
}

function drawPendingDeleteBorder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.restore();
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  height: number,
  color: string,
) {
  ctx.save();
  ctx.font = "500 11px var(--font-sans, sans-serif)";
  const padX = 8;
  const dotSpace = 10;
  const textWidth = ctx.measureText(text).width;
  const pillHeight = 18;
  const pillWidth = textWidth + padX * 2 + dotSpace;
  const pillY = y + (height - pillHeight) / 2;

  ctx.fillStyle = `${color}1a`;
  ctx.strokeStyle = `${color}33`;
  ctx.lineWidth = 1;
  const radius = pillHeight / 2;
  ctx.beginPath();
  roundedRect(ctx, x, pillY, pillWidth, pillHeight, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + padX, pillY + pillHeight / 2, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x + padX + dotSpace, pillY + pillHeight / 2 + 1);
  ctx.restore();
}

function drawJsonBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  height: number,
  borderColor: string,
  bgColor: string,
  textColor: string,
) {
  ctx.save();
  ctx.font = "12px var(--font-mono, monospace)";
  const padX = 8;
  const textWidth = ctx.measureText(label).width;
  const badgeHeight = 18;
  const badgeWidth = textWidth + padX * 2;
  const badgeY = y + (height - badgeHeight) / 2;

  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedRect(ctx, x, badgeY, badgeWidth, badgeHeight, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, x + padX, badgeY + badgeHeight / 2 + 1);
  ctx.restore();
}

// Matches the legacy grid's FK preview affordance (grid/grid-cell.tsx's
// `isFK && value !== null` button): a small chevron-right button at the
// cell's right edge. The legacy version sits right after the text in an
// inline flex row (so its x position varies with text width); here it's
// pinned to the cell's right edge instead — canvas draw calls don't have
// an easy "after this much text" layout primitive, and a fixed zone is
// what data-grid.tsx's onCellClicked hit-tests against anyway.
function drawFKPreviewButton(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  borderColor: string,
  iconColor: string,
  hovered: boolean,
  hoverBg: string,
) {
  const size = FK_PREVIEW_BUTTON_SIZE;
  const btnX = rect.x + rect.width - FK_PREVIEW_BUTTON_MARGIN - size;
  const btnY = rect.y + (rect.height - size) / 2;
  ctx.save();
  if (hovered) {
    ctx.fillStyle = hoverBg;
    ctx.beginPath();
    roundedRect(ctx, btnX + 0.5, btnY + 0.5, size - 1, size - 1, 4);
    ctx.fill();
  }
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedRect(ctx, btnX + 0.5, btnY + 0.5, size - 1, size - 1, 4);
  ctx.stroke();

  // lucide "chevron-right" (`m9 18 6-6-6-6`), scaled/positioned by hand.
  const iconSize = 14;
  const s = iconSize / 24;
  const cx = btnX + size / 2;
  const cy = btnY + size / 2;
  ctx.beginPath();
  ctx.moveTo(cx + (9 - 12) * s, cy + (18 - 12) * s);
  ctx.lineTo(cx + (15 - 12) * s, cy + (12 - 12) * s);
  ctx.lineTo(cx + (9 - 12) * s, cy + (6 - 12) * s);
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = 2 * s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawPlainText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; width: number; height: number },
  opts: {
    color: string;
    italic?: boolean;
    bold?: boolean;
    strikethrough?: boolean;
    rtl?: boolean;
  },
) {
  const padding = 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  const weight = opts.bold ? "600 " : "";
  const style = opts.italic ? "italic " : "";
  ctx.font = `${style}${weight}13px var(--font-sans, sans-serif)`;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "middle";

  const centerY = rect.y + rect.height / 2 + 1;
  let textX: number;
  if (opts.rtl) {
    ctx.textAlign = "right";
    textX = rect.x + rect.width - padding;
  } else {
    ctx.textAlign = "left";
    textX = rect.x + padding;
  }
  ctx.fillText(text, textX, centerY);

  if (opts.strikethrough) {
    const width = ctx.measureText(text).width;
    const lineY = centerY;
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    if (opts.rtl) {
      ctx.moveTo(textX - width, lineY);
      ctx.lineTo(textX, lineY);
    } else {
      ctx.moveTo(textX, lineY);
      ctx.lineTo(textX + width, lineY);
    }
    ctx.stroke();
  }

  ctx.restore();
}

export const rexaCellRenderer: CustomRenderer<RexaCell> = {
  kind: GridCellKind.Custom,
  isMatch: isRexaCell,
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const d = cell.data;

    // Background layers (bottom to top), matching the legacy grid's
    // cell background priority: row hover < column hover < cell hover <
    // data bar < search match < pending change < pending delete. Each
    // color already carries its own intended opacity (or none, for the
    // fully-opaque column-hover swap) — no extra globalAlpha dilution,
    // and redraws are triggered explicitly via gridRef.updateCells() in
    // data-grid.tsx rather than Glide's own hover-animation system, which
    // would otherwise repaint these on top of themselves every animation
    // frame and stack into a brightening artifact.
    //
    // The legacy grid never applies its hover tint to the currently
    // selected cell — the cell's own selection overlay sits on a higher
    // DOM z-index instead. On canvas there are no layers, so skip these
    // overlays entirely for the selected cell and let our own selection
    // fill (drawn below) show through instead.
    if (d.isSelected) {
      ctx.fillStyle = COLORS.selectionFill;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else {
      if (d.isRowHovered) {
        ctx.fillStyle = d.rowHoverColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      if (d.isColumnHovered) {
        ctx.fillStyle = d.columnHoverColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      // Skipped while hovering the FK preview button specifically — that
      // gets its own highlight (drawn below) instead of washing the whole
      // cell, matching the ask: highlight the button, not the cell.
      if (d.isCellHovered && !d.isFKButtonHovered) {
        ctx.fillStyle = d.cellHoverColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
    if (d.dataBarRatio !== null && d.dataBarRatio > 0) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.10)";
      ctx.fillRect(rect.x, rect.y, rect.width * Math.min(1, d.dataBarRatio), rect.height);
    }
    if (d.isSearchMatch) {
      ctx.fillStyle = COLORS.searchAmber;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else if (d.isPendingDelete) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.16)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else if (d.isPendingChange) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    const textColor = d.isPendingDelete ? COLORS.red300 : theme.textDark;
    const hasFKButton = d.isForeignKey && d.value !== null && d.value !== undefined;
    // Reserve room for the FK preview button so text (in every render
    // path below, not just plain text) never draws underneath it —
    // without this the button just floats on top of the value with no
    // gap, as with the long uuid-style values FK columns usually hold.
    const contentRect = hasFKButton
      ? { ...rect, width: Math.max(0, rect.width - (FK_PREVIEW_BUTTON_SIZE + FK_PREVIEW_BUTTON_MARGIN * 2)) }
      : rect;

    if (d.kind === "null") {
      drawPlainText(ctx, "NULL", contentRect, {
        color: d.isPendingDelete ? COLORS.red300 : theme.textMedium,
        italic: true,
        strikethrough: d.isPendingDelete,
        rtl: d.isRtl,
      });
    } else if ((d.kind === "boolean" || d.kind === "enum") && d.colorizedPills) {
      const isTrue = d.kind === "boolean" && d.value === true;
      const color =
        d.kind === "boolean" ? (isTrue ? COLORS.green500 : COLORS.red500) : COLORS.blue500;
      drawPill(ctx, d.displayValue, contentRect.x + 8, contentRect.y, contentRect.height, color);
    } else if (d.kind === "json" && d.richJsonInspector && d.jsonType) {
      drawJsonBadge(
        ctx,
        `[${d.jsonType}]`,
        contentRect.x + 8,
        contentRect.y,
        contentRect.height,
        theme.borderColor,
        theme.bgHeader,
        theme.textDark,
      );
    } else if (d.kind === "date" && d.relativeDates && d.relativeDateLabel) {
      drawPlainText(ctx, d.relativeDateLabel, contentRect, {
        color: textColor,
        strikethrough: d.isPendingDelete,
        rtl: d.isRtl,
      });
    } else {
      drawPlainText(ctx, d.displayValue, contentRect, {
        color: textColor,
        bold: d.isPrimaryKey,
        strikethrough: d.isPendingDelete,
        rtl: d.isRtl,
      });
    }

    if (hasFKButton) {
      drawFKPreviewButton(
        ctx,
        rect,
        d.isFKButtonHovered ? theme.textDark : theme.borderColor,
        d.isFKButtonHovered ? theme.textDark : theme.textMedium,
        d.isFKButtonHovered,
        d.cellHoverColor,
      );
    }

    if (d.isPendingDelete) {
      drawPendingDeleteBorder(ctx, rect.x, rect.y, rect.width, rect.height);
    }

    if (d.isSelected) {
      // Glide draws its grid lines in a separate pass AFTER cell content
      // (drawCells, then drawGridLines), directly on the shared boundary
      // pixel between adjacent cells. A stroke whose outer edge touches
      // that same pixel gets partially overwritten by the thin gridline
      // color, leaving a 1px sliver of a different shade right next to
      // our border — which reads as a double border. Keep the whole
      // stroke strictly inside the cell, one pixel clear of that shared
      // boundary, so gridlines never touch it — this way the border
      // renders identically regardless of hover/redraw timing too, since
      // it no longer depends on draw-order with that separate pass.
      ctx.save();
      ctx.strokeStyle = COLORS.selectionBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3);
      ctx.restore();
    }

    return true;
  },
  provideEditor: () => ({
    editor: RexaCellEditor,
    disableStyling: true,
    disablePadding: true,
  }),
};

function rowSpacingToPx(rowSpacing: RexaCellData["rowSpacing"]): number {
  return rowSpacing === "compact" ? 28 : rowSpacing === "standard" ? 32 : 36;
}

function toDisplayValue(value: any): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Ported to match the legacy grid's per-type editors
 * (components/studio/grid/grid-cell.tsx's `SmartCellEditor` and inline
 * boolean/enum/date editors) as closely as the canvas-overlay model
 * allows: same footer (Save pending / Cancel / Set NULL / Discard change),
 * same maximize-to-fullscreen behavior, same inline listbox for small
 * enum/boolean option sets, same date Popover+Calendar.
 */
const RexaCellEditor: ProvideEditorComponent<RexaCell> = (p) => {
  const d = p.value.data;
  const { isDate, isBoolean } = classifyColumnType(d.columnType);
  const isEnum = !!d.enumOptions?.length;
  const isModified = !!d.discardChange;

  const commit = React.useCallback(
    (newValue: any) => {
      p.onFinishedEditing({
        ...p.value,
        data: { ...d, value: newValue, displayValue: toDisplayValue(newValue) },
      } as RexaCell);
    },
    [d, p],
  );
  const handleCancel = React.useCallback(() => p.onFinishedEditing(undefined), [p]);
  const handleSetNull = React.useCallback(() => commit(null), [commit]);
  const handleDiscardChange = React.useCallback(() => {
    d.discardChange?.();
    p.onFinishedEditing(undefined);
  }, [d, p]);

  if (isBoolean || isEnum) {
    return (
      <TypedEditor
        d={d}
        isModified={isModified}
        onCommit={commit}
        onCancel={handleCancel}
        onSetNull={handleSetNull}
        onDiscardChange={handleDiscardChange}
      />
    );
  }

  if (isDate) {
    return (
      <DateEditor
        d={d}
        isModified={isModified}
        onCommit={commit}
        onCancel={handleCancel}
        onSetNull={handleSetNull}
        onDiscardChange={handleDiscardChange}
      />
    );
  }

  return (
    <TextEditor
      d={d}
      isModified={isModified}
      onCommit={commit}
      onCancel={handleCancel}
      onSetNull={handleSetNull}
      onDiscardChange={handleDiscardChange}
    />
  );
};

interface EditorProps {
  d: RexaCellData;
  isModified: boolean;
  onCommit: (value: any) => void;
  onCancel: () => void;
  onSetNull: () => void;
  onDiscardChange: () => void;
}

function EditorFooter({
  isModified,
  onCommit,
  onCancel,
  onSetNull,
  onDiscardChange,
  extra,
}: {
  isModified: boolean;
  onCommit: () => void;
  onCancel: () => void;
  onSetNull: () => void;
  onDiscardChange: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div
      className="editor-footer flex items-center justify-between px-2 py-1.5 bg-studio-row-hover border-t border-studio-border gap-4 shrink-0 font-sans"
      style={{ fontFamily: "var(--font-sans, ui-sans-serif, system-ui)", letterSpacing: "0" }}
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
        {isModified && (
          <button
            onClick={onDiscardChange}
            className="inline-flex items-center gap-1.5 text-xs font-medium tracking-normal text-amber-500 hover:text-amber-400 transition-colors whitespace-nowrap"
          >
            <div className="flex items-center justify-center px-1 h-4 rounded bg-background border border-studio-border text-xs font-mono shrink-0">
              ⌥D
            </div>
            <span className="whitespace-nowrap">Discard change</span>
          </button>
        )}
      </div>
      {extra}
    </div>
  );
}

function TextEditor({ d, isModified, onCommit, onCancel, onSetNull, onDiscardChange }: EditorProps) {
  const [value, setValue] = React.useState(
    d.value === null || d.value === undefined ? "" : String(d.value),
  );
  const [isMaximized, setIsMaximized] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    if (!isMaximized) {
      node.style.height = "auto";
      const baseHeight = rowSpacingToPx(d.rowSpacing);
      const maxHeight = 240;
      node.style.height = `${Math.min(maxHeight, Math.max(baseHeight, node.scrollHeight))}px`;
    } else {
      node.style.height = "100%";
    }
  }, [value, d.rowSpacing, isMaximized]);

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
      onCommit(value);
    } else if (e.altKey && e.code === "KeyN") {
      e.preventDefault();
      onSetNull();
    } else if (isModified && e.altKey && e.code === "KeyD") {
      e.preventDefault();
      onDiscardChange();
    } else if (e.key === "Escape") {
      if (isMaximized) setIsMaximized(false);
      else onCancel();
    } else if (e.altKey && e.key === "m") {
      e.preventDefault();
      setIsMaximized((v) => !v);
    }
  };

  const editorContent = (
    <div
      className={cn(
        "z-[100] border border-studio-border shadow-2xl flex flex-col overflow-hidden",
        isMaximized
          ? "fixed inset-x-[15%] inset-y-[15%] rounded-lg bg-studio-bg"
          : "w-full rounded-b-md rounded-t-none bg-studio-bg",
      )}
      style={{
        backgroundColor: isMaximized
          ? "var(--studio-bg)"
          : "color-mix(in srgb, var(--studio-row-hover) 85%, var(--studio-bg))",
        // Glide's own overlay wrapper (data-grid-overlay-editor-style.tsx)
        // is `width: max-content; min-width: <cell width>px; max-width:
        // 400px` — a *minimum*, not a fixed size, so it grows to fit
        // whatever's inside up to 400px. The footer's row of buttons
        // (Save pending / Cancel / Set NULL) has enough combined natural
        // width to trigger that growth on any cell narrower than ~350px,
        // ballooning the editor far past the actual column. `width: 100%`
        // alone can't stop this — a percentage width can't resolve
        // against an auto-sizing (max-content) parent, so the browser
        // falls back to sizing from content anyway. `width: 0` is a
        // *definite* value, so it contributes nothing to that max-content
        // computation; `minWidth: 100%` then fills whatever width Glide's
        // wrapper ends up with once its own min-width has been applied.
        ...(isMaximized ? null : { width: 0, minWidth: "100%" }),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={cn("relative flex-1 flex flex-col", d.isRtl && "items-end")}>
        <textarea
          ref={textareaRef}
          autoFocus
          className={cn(
            "w-full px-3 py-2 bg-transparent outline-none border-none text-xs text-foreground resize-none leading-relaxed overflow-y-auto",
            d.isRtl && "self-end text-right",
            isMaximized && "text-sm p-8",
          )}
          dir="auto"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            if (isMaximized) return;
            if (!e.relatedTarget?.closest(".editor-footer")) onCommit(value);
          }}
          style={{
            unicodeBidi: "plaintext",
            fontFamily: d.isRtl ? "var(--font-arabic)" : undefined,
          }}
        />
      </div>
      <EditorFooter
        isModified={isModified}
        onCommit={() => onCommit(value)}
        onCancel={onCancel}
        onSetNull={onSetNull}
        onDiscardChange={onDiscardChange}
        extra={
          <button
            onClick={() => setIsMaximized((v) => !v)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium tracking-normal text-foreground/80 transition-colors hover:text-foreground p-1 hover:bg-muted rounded"
            title={isMaximized ? "Minimize (Alt+M)" : "Maximize (Alt+M)"}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        }
      />
    </div>
  );

  if (isMaximized) {
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.4)", backdropFilter: "blur(8px)" }}
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

const INLINE_TYPED_OPTIONS_MAX = 8;

function TypedEditor({ d, isModified, onCommit, onCancel, onSetNull, onDiscardChange }: EditorProps) {
  const base = React.useMemo(
    () => (d.enumOptions?.length ? d.enumOptions : ["true", "false"]),
    [d.enumOptions],
  );
  const currentStr = d.value === null || d.value === undefined ? "" : String(d.value);
  const options = React.useMemo(() => {
    if (currentStr && !base.includes(currentStr)) return [currentStr, ...base];
    return base;
  }, [base, currentStr]);

  const [localValue, setLocalValue] = React.useState(currentStr || options[0] || "");
  const isInlineTypedEditor = options.length > 0 && options.length <= INLINE_TYPED_OPTIONS_MAX;
  const rowHeightPx = rowSpacingToPx(d.rowSpacing);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  const isEnum = !!d.enumOptions?.length;
  const commitLocal = () => {
    onCommit(isEnum ? localValue : localValue === "true");
  };

  return (
    <div
      ref={ref}
      data-cell-editor
      tabIndex={0}
      className="border border-studio-border/80 shadow-2xl rounded-b-md rounded-t-none flex flex-col overflow-visible w-full"
      style={{
        minHeight: "100%",
        // See TextEditor's identical style for why: defeats Glide's own
        // overlay wrapper (width: max-content) ballooning past the
        // actual cell width to fit the footer buttons.
        width: 0,
        minWidth: "100%",
        backgroundColor: "color-mix(in srgb, var(--studio-row-hover) 70%, var(--studio-bg))",
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDownCapture={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.altKey && e.code === "KeyN") {
          e.preventDefault();
          e.stopPropagation();
          onSetNull();
        } else if (e.altKey && e.code === "KeyD" && isModified) {
          e.preventDefault();
          e.stopPropagation();
          onDiscardChange();
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const i = Math.max(0, options.indexOf(localValue || options[0]));
          setLocalValue(options[(i + 1) % options.length]);
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          const i = Math.max(0, options.indexOf(localValue || options[0]));
          setLocalValue(options[(i - 1 + options.length) % options.length]);
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commitLocal();
        }
      }}
    >
      <div className={cn("flex-1", isInlineTypedEditor ? "px-0 py-0" : "px-3 py-2")}>
        {isInlineTypedEditor ? (
          <div role="listbox" aria-label={`${d.columnName} options`} className="w-full overflow-hidden">
            {options.map((option) => {
              const isActive = option === localValue;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLocalValue(option)}
                  onDoubleClick={commitLocal}
                  className={cn(
                    "w-full text-left px-3 py-0 text-xs transition-colors flex items-center",
                    isActive ? "bg-[rgba(29,55,126,0.2)] text-foreground" : "text-foreground/72 hover:text-foreground",
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
          <Select value={localValue || options[0]} onValueChange={setLocalValue}>
            <SelectTrigger className="w-full bg-transparent border border-studio-border rounded-lg text-xs text-foreground px-2 py-1">
              <SelectValue placeholder="Select value" />
            </SelectTrigger>
            <SelectContent className="z-[220]" onEscapeKeyDown={(e) => { e.preventDefault(); onCancel(); }}>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <EditorFooter
        isModified={isModified}
        onCommit={commitLocal}
        onCancel={onCancel}
        onSetNull={onSetNull}
        onDiscardChange={onDiscardChange}
      />
    </div>
  );
}

function DateEditor({ d, isModified, onCommit, onCancel, onSetNull, onDiscardChange }: EditorProps) {
  const [localValue, setLocalValue] = React.useState(
    d.value === null || d.value === undefined ? "" : String(d.value),
  );

  return (
    <div
      data-cell-editor
      className="border border-studio-border/80 shadow-2xl rounded-b-md rounded-t-none flex flex-col overflow-hidden w-full"
      style={{
        // See TextEditor's identical style for why: defeats Glide's own
        // overlay wrapper (width: max-content) ballooning past the
        // actual cell width to fit the footer buttons.
        width: 0,
        minWidth: "100%",
        backgroundColor: "color-mix(in srgb, var(--studio-row-hover) 70%, var(--studio-bg))",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-1 flex items-center px-3 gap-2 py-2">
        <Popover open onOpenChange={(open) => !open && onCommit(localValue)}>
          <PopoverTrigger asChild>
            <div className="flex items-center w-full h-full gap-2 cursor-pointer">
              <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
              <input
                autoFocus
                className={cn(
                  "flex-1 h-full bg-transparent outline-none border-none text-xs text-foreground",
                  d.isRtl && "text-right",
                )}
                dir="auto"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommit(localValue);
                  else if (e.altKey && e.code === "KeyN") onSetNull();
                  else if (e.altKey && e.code === "KeyD" && isModified) onDiscardChange();
                  else if (e.key === "Escape") onCancel();
                }}
                style={{
                  unicodeBidi: "plaintext",
                  fontFamily: d.isRtl ? "var(--font-arabic)" : undefined,
                }}
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-popover border-studio-border shadow-2xl" align="start" sideOffset={8}>
            <Calendar
              mode="single"
              selected={safeParseDate(localValue) || undefined}
              onSelect={(date) => {
                if (date) onCommit(date.toISOString());
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
      <EditorFooter
        isModified={isModified}
        onCommit={() => onCommit(localValue)}
        onCancel={onCancel}
        onSetNull={onSetNull}
        onDiscardChange={onDiscardChange}
      />
    </div>
  );
}
