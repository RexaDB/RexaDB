"use client";

import { Check } from "@/lib/icon-theme/lucide-react";
import { RefreshCw } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { TableTypeFilter } from "@/lib/studio/table-filter";

interface TablesFilterMenuProps {
  typeFilter: TableTypeFilter;
  onTypeFilterChange: (mode: TableTypeFilter) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  wildcardsEnabled: boolean;
  onWildcardsEnabledChange: (value: boolean) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  tablesCount?: number;
  viewsCount?: number;
}

const TYPE_OPTIONS: Array<{ value: TableTypeFilter; label: string }> = [
  { value: "all", label: "Tables + views" },
  { value: "tables", label: "Tables only" },
  { value: "views", label: "Views only" },
];

export function TablesFilterMenu({
  typeFilter,
  onTypeFilterChange,
  caseSensitive,
  onCaseSensitiveChange,
  wildcardsEnabled,
  onWildcardsEnabledChange,
  onRefresh,
  isRefreshing = false,
  tablesCount,
  viewsCount,
}: TablesFilterMenuProps) {
  const countFor = (value: TableTypeFilter) => {
    if (value === "tables") return tablesCount;
    if (value === "views") return viewsCount;
    return tablesCount !== undefined && viewsCount !== undefined
      ? tablesCount + viewsCount
      : undefined;
  };

  return (
    <div className="w-64 p-1.5">
      <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Show
      </p>
      <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Object type filter">
        {TYPE_OPTIONS.map((option) => {
          const count = countFor(option.value);
          const active = typeFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onTypeFilterChange(option.value)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="flex size-4 items-center justify-center">
                {active && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
              {count !== undefined && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="my-1.5 border-t border-border" />

      <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Search options
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50">
        <Checkbox
          checked={caseSensitive}
          onCheckedChange={(checked) => onCaseSensitiveChange(checked === true)}
        />
        <span className="min-w-0 flex-1">Case sensitive</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50">
        <Checkbox
          checked={wildcardsEnabled}
          onCheckedChange={(checked) => onWildcardsEnabledChange(checked === true)}
        />
        <span className="min-w-0 flex-1">
          Wildcards
          <span className="block text-[11px] font-normal text-muted-foreground">
            % any text, _ one character
          </span>
        </span>
      </label>

      {onRefresh && (
        <>
          <div className="my-1.5 border-t border-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing…" : "Refresh tables & views"}
          </Button>
        </>
      )}
    </div>
  );
}
