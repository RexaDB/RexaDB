"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Table2,
  ArrowRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  Database,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  searchAllTables,
  searchLocalIndex,
  saveSearchResultsToIndex,
  clearSearchIndex,
  getSearchIndexStatus,
  type SearchAllResult,
} from "@/lib/api/actions-client";

interface UniversalSearchProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  connectionString: string;
  connectionType?: string;
  onSelectResult: (result: SearchAllResult) => void;
  localIndexEnabled?: boolean;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "never";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function UniversalSearch({
  isOpen,
  onOpenChange,
  connectionString,
  connectionType,
  onSelectResult,
  localIndexEnabled = false,
}: UniversalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchAllResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [indexStatus, setIndexStatus] = useState<{
    lastIndexedAt: number | null;
    totalEntries: number;
  } | null>(null);
  const [searchSource, setSearchSource] = useState<"local" | "remote" | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  const groupedResults = React.useMemo(() => {
    const groups = new Map<string, SearchAllResult[]>();
    for (const r of results) {
      const key = `${r.table_schema}.${r.table_name}`;
      const existing = groups.get(key);
      if (existing) {
        existing.push(r);
      } else {
        groups.set(key, [r]);
      }
    }
    return Array.from(groups.entries());
  }, [results]);

  const totalItems = React.useMemo(() => {
    let count = 0;
    for (const [, items] of groupedResults) {
      count += items.length;
    }
    return count;
  }, [groupedResults]);

  const fetchIndexStatus = useCallback(async () => {
    if (!connectionString) return;
    const res = await getSearchIndexStatus(connectionString);
    if (res.success) {
      setIndexStatus(res.data ?? null);
    }
  }, [connectionString]);

  useEffect(() => {
    if (isOpen && localIndexEnabled && connectionString) {
      fetchIndexStatus();
    }
  }, [isOpen, localIndexEnabled, connectionString, fetchIndexStatus]);

  const performSearch = useCallback(
    async (term: string) => {
      if (!term.trim() || !connectionString) {
        setResults([]);
        setError(null);
        setSearchSource(null);
        return;
      }

      setLoading(true);
      setError(null);
      setSelectedIndex(0);
      setSearchSource(null);

      if (localIndexEnabled) {
        try {
          const localRes = await searchLocalIndex(
            connectionString,
            term.trim(),
          );
          if (
            localRes.success &&
            Array.isArray(localRes.data) &&
            localRes.data.length > 0
          ) {
            setResults(localRes.data);
            setSearchSource("local");
            setLoading(false);
            return;
          }
        } catch {}
      }

      try {
        const res = await searchAllTables(connectionString, term.trim(), {
          connectionType,
        });
        if (res.success && Array.isArray(res.data)) {
          setResults(res.data);
          setSearchSource(localIndexEnabled ? "remote" : null);

          if (localIndexEnabled && res.data.length > 0) {
            saveSearchResultsToIndex(connectionString, res.data).then(() => {
              fetchIndexStatus();
            });
          }
        } else {
          setResults([]);
          setError(res.error || "Search failed.");
        }
      } catch (err: any) {
        setResults([]);
        setError(err.message || "Search failed.");
      } finally {
        setLoading(false);
      }
    },
    [connectionString, connectionType, localIndexEnabled, fetchIndexStatus],
  );

  const handleRefresh = useCallback(async () => {
    if (!query.trim() || !connectionString) return;
    setRefreshing(true);
    try {
      const res = await searchAllTables(connectionString, query.trim(), {
        connectionType,
      });
      if (res.success && Array.isArray(res.data)) {
        setResults(res.data);
        await clearSearchIndex(connectionString);
        if (res.data.length > 0) {
          await saveSearchResultsToIndex(connectionString, res.data);
        }
        setSearchSource("remote");
        await fetchIndexStatus();
      }
    } catch (err: any) {
      setError(err.message || "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [query, connectionString, connectionType, fetchIndexStatus]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setError(null);
      setIndexStatus(null);
      setSearchSource(null);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => performSearch(value), 300);
    },
    [performSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(totalItems, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) =>
            (prev - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1),
        );
      } else if (e.key === "Enter" && totalItems > 0) {
        e.preventDefault();
        let idx = 0;
        for (const [, items] of groupedResults) {
          for (const item of items) {
            if (idx === selectedIndex) {
              onSelectResult(item);
              onOpenChange(false);
              return;
            }
            idx++;
          }
        }
      } else if (e.key === "Escape") {
        onOpenChange(false);
      }
    },
    [totalItems, groupedResults, selectedIndex, onSelectResult, onOpenChange],
  );

  useEffect(() => {
    if (!resultsContainerRef.current) return;
    const selected = resultsContainerRef.current.querySelector(
      "[data-selected='true']",
    ) as HTMLElement | null;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleResultClick = useCallback(
    (result: SearchAllResult) => {
      onSelectResult(result);
      onOpenChange(false);
    },
    [onSelectResult, onOpenChange],
  );

  let globalIdx = 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="rounded-lg border border-studio-border bg-studio-bg p-2 pb-11 shadow-2xl data-[state=open]:animate-cmd-enter data-[state=closed]:animate-cmd-exit"
      >
        <DialogTitle className="sr-only">Universal Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a value across all tables and columns.
        </DialogDescription>

        <div className="flex items-center gap-2 mb-2 h-9 rounded-lg border border-studio-border bg-studio-bg/60 px-3">
          <Search className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search across all tables..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40"
          />
          {loading && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50 shrink-0" />
          )}
        </div>

        {localIndexEnabled && indexStatus && (
          <div className="flex items-center gap-2 px-3 py-1 mb-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <Database className="w-3 h-3" />
              Indexed {formatTime(indexStatus.lastIndexedAt)}
              {indexStatus.totalEntries > 0 && (
                <> &middot; {indexStatus.totalEntries} entries</>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing || !query.trim()}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors disabled:opacity-30"
            >
              <RefreshCw
                className={cn("w-3 h-3", refreshing && "animate-spin")}
              />
              Refresh
            </button>
          </div>
        )}

        <div
          ref={resultsContainerRef}
          className="no-scrollbar min-h-60 max-h-96 overflow-y-auto scroll-pt-2 scroll-pb-1.5"
        >
          {query.trim() && !loading && !error && results.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No results found.
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 py-6 text-center text-destructive text-sm justify-center">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {groupedResults.map(([key, items]) => (
            <div key={key} className="mb-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground/70">
                <Table2 className="w-3 h-3" />
                {key}
                {searchSource === "local" && (
                  <span className="text-xs text-muted-foreground/50 italic font-normal ml-1">
                    cached
                  </span>
                )}
                <span className="text-muted-foreground/40 ml-auto">
                  {items.length} match{items.length !== 1 ? "es" : ""}
                </span>
              </div>
              {items.map((item) => {
                const idx = globalIdx++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={`${key}.${item.column_name}.${idx}`}
                    data-selected={isSelected}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm rounded-lg border border-transparent",
                      isSelected &&
                        "border-studio-border/80 bg-studio-row-hover",
                    )}
                    onClick={() => handleResultClick(item)}
                  >
                    <span className="text-xs font-mono text-muted-foreground/60 min-w-[80px] truncate">
                      {item.column_name}
                    </span>
                    <span className="flex-1 truncate text-foreground/80">
                      {item.value}
                    </span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 rounded-b-xl border-t border-studio-border bg-studio-bg px-4 font-medium text-muted-foreground text-xs">
          <Kbd>Enter</Kbd>
          Open Table
          <span className="ml-auto flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            Navigate
            <Kbd>Esc</Kbd>
            Close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
