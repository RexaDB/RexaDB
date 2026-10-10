// components
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InfiniteScrollingFooterProps {
  recordCount: number;
  totalCount: number | null;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  hasMoreRows: boolean;
  error: string | null;
  onLoadMore?: () => void;
  onPageSizeChange: (size: number) => void;
}

export function InfiniteScrollingFooter({
  recordCount,
  totalCount,
  pageSize,
  loading,
  loadingMore,
  hasMoreRows,
  error,
  onLoadMore,
  onPageSizeChange,
}: InfiniteScrollingFooterProps) {
  const batchSizes = Array.from(new Set([25, 50, 100, 200, 500, pageSize])).sort((a, b) => a - b);
  const status = loading
    ? "Loading rows…"
    : loadingMore
    ? "Loading more rows…"
    : error
      ? "Couldn’t load more rows."
      : hasMoreRows
        ? "Scroll to load more"
        : "All rows loaded";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-studio-bg/95 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalCount === null ? recordCount : `${recordCount} of ${totalCount}`} rows loaded
        </span>

        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))} disabled={loading || loadingMore}>
          <SelectTrigger aria-label="Rows per batch" className="h-7 w-auto text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {batchSizes.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">
                {size} rows per batch
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span role="status" aria-live="polite" title={error ?? undefined} className="text-xs text-muted-foreground">
          {status}
        </span>

        {hasMoreRows && (
          <Button variant="outline" size="sm" disabled={loading || loadingMore} onClick={onLoadMore}>
            {error ? "Retry" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}
