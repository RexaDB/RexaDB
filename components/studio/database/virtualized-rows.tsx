"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

/** Sidebar table rows are h-8; tag folder rows are h-7. */
export const SIDEBAR_TABLE_ROW_HEIGHT = 32;

/**
 * Lists at or below this size render directly (no scroll box, no behavior
 * change). Above it we switch to a bounded virtualized scroll region so a
 * 5k-table schema only ever mounts ~30 rows instead of 5k menu trees.
 */
export const VIRTUALIZE_THRESHOLD = 100;

interface VirtualizedRowsProps<T> {
  items: T[];
  keyFor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  rowHeight?: number;
  overscan?: number;
  className?: string;
  /** Scroll back to top whenever this changes (query, schema, filters). */
  resetKey?: string;
}

/**
 * Fixed-height virtualized list with its own scroll container. Rows are
 * absolutely positioned, so variable gaps (space-y) must NOT be applied
 * inside — bake spacing into rowHeight instead.
 */
export function VirtualizedRows<T>({
  items,
  keyFor,
  renderItem,
  rowHeight = SIDEBAR_TABLE_ROW_HEIGHT,
  overscan = 10,
  className,
  resetKey,
}: VirtualizedRowsProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={scrollRef} className={cn("overflow-y-auto", className)}>
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <div
              key={keyFor(item, virtualRow.index)}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{
                height: rowHeight,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MaybeVirtualizedTablesProps {
  tables: string[];
  renderTable: (table: string) => React.ReactNode;
  keyPrefix: string;
  resetKey?: string;
  /** Bounded height for the virtual scroll box (only used when virtualized). */
  maxHeightClass?: string;
  threshold?: number;
}

/**
 * Drop-in for `tables.map(renderTable)`: renders normally for small lists,
 * switches to a bounded virtualized scroll box for huge ones (tag folders,
 * schema-explorer sections) where changing the surrounding layout isn't
 * an option.
 */
export function MaybeVirtualizedTables({
  tables,
  renderTable,
  keyPrefix,
  resetKey,
  maxHeightClass = "max-h-96",
  threshold = VIRTUALIZE_THRESHOLD,
}: MaybeVirtualizedTablesProps) {
  if (tables.length <= threshold) {
    return <>{tables.map((t) => renderTable(t))}</>;
  }
  return (
    <VirtualizedRows
      items={tables}
      keyFor={(t) => `${keyPrefix}.${t}`}
      renderItem={(t) => renderTable(t)}
      resetKey={resetKey}
      className={maxHeightClass}
    />
  );
}
