"use client";

import { RefreshCw } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { AuthSectionSearch } from "./auth-section-search";
import type { AuthSectionHeaderProps } from "./auth-section-header.types";

export function AuthSectionHeader({
  title,
  description,
  onRefresh,
  loading,
  countLabel,
  placeholder,
  search,
  onSearchChange,
  showSearch,
  actions,
}: AuthSectionHeaderProps) {
  const canSearch = showSearch !== false && Boolean(onSearchChange);
  return (
    <div className="border-b border-studio-border bg-studio-bg px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">{title}</h1>
            {countLabel ? (
              <span className="text-xs font-semiboldtracking-wider text-muted-foreground">{countLabel}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {actions}
        </div>
      </div>
      {canSearch ? (
        <AuthSectionSearch
          value={search ?? ""}
          onChange={(value) => onSearchChange?.(value)}
          placeholder={placeholder}
        />
      ) : null}
    </div>
  );
}
