"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "@/lib/icon-theme/lucide-react";

export function ProviderListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  actions,
  extra,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
  /** Extra row rendered below the toolbar, e.g. an org picker. */
  extra?: ReactNode;
}) {
  return (
    <div className="border-b border-studio-border/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[160px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 border-border/60 bg-background/70 pl-8 text-sm"
          />
        </div>

        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>

      {extra && <div className="mt-2.5">{extra}</div>}
    </div>
  );
}
