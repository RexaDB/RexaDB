"use client";

import { RefreshCw, Search, X } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type NeonUserStatusFilter = "all" | "verified" | "unverified";

interface NeonAuthUsersToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: NeonUserStatusFilter;
  onStatusChange: (value: NeonUserStatusFilter) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function NeonAuthUsersToolbar({ search, onSearchChange, status, onStatusChange, onRefresh, loading }: NeonAuthUsersToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 bg-background px-5 pb-8 pt-5 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative w-64 sm:w-[min(480px,45vw)]">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-studio-cell-muted" />
          <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name or email" className="h-[26px] pl-7 pr-7 text-xs" />
          {search && <button type="button" aria-label="Clear search" onClick={() => onSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>}
        </div>
        <Select value={status} onValueChange={(value) => onStatusChange(value as NeonUserStatusFilter)}>
          <SelectTrigger className="h-[26px] w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="verified">Verified</SelectItem><SelectItem value="unverified">Unverified</SelectItem></SelectContent>
        </Select>
      </div>
      <Button variant="outline" size="icon-sm" onClick={() => void onRefresh()} disabled={loading} className="shrink-0" aria-label="Refresh users" title="Refresh users">
        <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
