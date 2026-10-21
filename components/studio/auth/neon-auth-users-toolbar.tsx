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
    <div className="flex min-h-6 items-center gap-2">
      <div className="relative flex h-6 min-w-0 flex-1 items-center rounded-md border border-border bg-studio-bg">
        <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
        <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name or email" className="h-6 border-0 bg-transparent pl-7 pr-7 text-xs shadow-none focus-visible:ring-0" />
        {search && <button type="button" aria-label="Clear search" onClick={() => onSearchChange("")} className="absolute right-2 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>}
      </div>
      <Select value={status} onValueChange={(value) => onStatusChange(value as NeonUserStatusFilter)}>
        <SelectTrigger size="sm" className="!h-6 w-20 rounded-md border-border bg-studio-bg px-2 !py-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="verified">Verified</SelectItem><SelectItem value="unverified">Unverified</SelectItem></SelectContent>
      </Select>
      <Button variant="outline" size="xs" onClick={() => void onRefresh()} disabled={loading} className="h-6 rounded-md border-border bg-studio-bg px-2 text-xs font-normal">
        <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}
