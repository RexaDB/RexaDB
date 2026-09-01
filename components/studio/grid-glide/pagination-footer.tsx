"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Ported verbatim (markup + behavior) from the legacy grid's pagination
 * footer (components/studio/data-grid.tsx) — this piece is plain DOM below
 * the canvas and is unaffected by the Glide rewrite.
 */
export function PaginationFooter({
  page,
  pageSize,
  totalCount,
  loading,
  recordCount,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number | null;
  loading: boolean;
  recordCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const [isCustomPageInput, setIsCustomPageInput] = useState(false);
  const [customPageInputValue, setCustomPageInputValue] = useState("");
  const customPageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCustomPageInput && customPageInputRef.current) {
      customPageInputRef.current.focus();
      customPageInputRef.current.select();
    }
  }, [isCustomPageInput]);

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
      : `${recordCount} ${recordCount === 1 ? "record" : "records"}`;

  return (
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
              (totalCount !== null && (page + 1) * pageSize >= totalCount) ||
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
                onChange={(e) => setCustomPageInputValue(e.target.value)}
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
              <Select value={pageSize.toString()} onValueChange={handlePageSizeUpdate}>
                <SelectTrigger className="h-7 w-[96px] rounded border-border/70 bg-background text-xs">
                  <SelectValue placeholder={pageSize.toString()} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={size.toString()} className="text-xs">
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

        <div className="text-xs text-muted-foreground">{recordLabel}</div>
      </div>
    </div>
  );
}
