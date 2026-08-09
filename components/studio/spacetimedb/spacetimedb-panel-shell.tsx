"use client";

import { Loader2, RefreshCw, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SpacetimeDbPanelShellProps {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  error: string | null;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  loadingText: string;
  emptyText: string;
  onRefresh: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}

export function SpacetimeDbPanelShell({
  title,
  icon,
  loading,
  error,
  search,
  onSearchChange,
  searchPlaceholder,
  loadingText,
  emptyText,
  onRefresh,
  onClose,
  children,
}: SpacetimeDbPanelShellProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <div className="flex-1" />
        {onSearchChange && (
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder || `Search ${title.toLowerCase()}...`}
              className="pl-7 h-7 text-xs"
            />
          </div>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {loadingText}
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={onRefresh}>Retry</Button>
        </div>
      ) : (
        children
      )}
    </>
  );
}
