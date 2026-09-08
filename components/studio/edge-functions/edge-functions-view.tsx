"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownWideNarrow,
  Copy,
  EdgeFunctionsIcon,
  RefreshCw,
  Search,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import {
  edgeFunctionUrl,
  listEdgeFunctions,
  resolveEdgeAccess,
  timeAgo,
  type EdgeAccess,
  type EdgeFunction,
} from "@/lib/studio/edge-functions-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function EdgeFunctionsView({ studio }: { studio: any }) {
  const connectionType: string | undefined =
    studio.connection?.connectionType ?? studio.dbType;
  const connectionString: string | undefined =
    studio.currentConnectionString || studio.connection?.connectionString;
  const [functions, setFunctions] = useState<EdgeFunction[]>([]);
  const [projectRef, setProjectRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "updated">("name");

  const loadFunctions = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    const { access, error: accessError } = await resolveEdgeAccess(
      connectionType,
      connectionString,
    );
    if (!access) {
      setFunctions([]);
      setProjectRef(null);
      setLoadError(accessError ?? "Edge Functions are unavailable here.");
      setLoading(false);
      return;
    }
    setProjectRef(access.projectRef);
    const { functions: list, error } = await listEdgeFunctions(access);
    setFunctions(list);
    setLoadError(error ?? null);
    if (error) toast.error(error);
    setLoading(false);
  }, [connectionString, connectionType]);

  useEffect(() => {
    void loadFunctions();
  }, [loadFunctions]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? functions.filter(
          (f) =>
            f.slug.toLowerCase().includes(q) ||
            f.name.toLowerCase().includes(q),
        )
      : [...functions];
    filtered.sort((a, b) =>
      sortBy === "name"
        ? a.slug.localeCompare(b.slug)
        : (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    );
    return filtered;
  }, [functions, search, sortBy]);

  function copyUrl(url: string) {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Function URL copied."))
      .catch(() => toast.error("Failed to copy URL."));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="flex flex-wrap items-center gap-2 px-6 py-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search function names"
            className="h-7 pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setSortBy((s) => (s === "name" ? "updated" : "name"))
          }
          title={sortBy === "name" ? "Sorted by name" : "Sorted by updated"}
        >
          <ArrowDownWideNarrow className="mr-1.5 size-3.5" />
          {sortBy === "name" ? "Sorted by name" : "Sorted by updated"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadFunctions()}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground">
          Viewing {visible.length} function{visible.length === 1 ? "" : "s"} in
          total
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loading && functions.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            Loading functions…
          </div>
        ) : loadError && functions.length === 0 ? (
          <div className="mx-auto w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
            <div className="text-sm font-medium text-foreground">
              Failed to load functions
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {loadError}
            </p>
            <Button size="sm" className="mt-3" onClick={() => void loadFunctions()}>
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyStatePresentational
            icon={EdgeFunctionsIcon}
            title={search ? "No matching functions" : "No functions yet"}
            description={
              search
                ? "Try a different search term."
                : "Deploy an Edge Function with the Supabase CLI to see it here."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_140px] gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Name</span>
              <span>URL</span>
              <span className="text-right">Updated</span>
            </div>
            <div className="divide-y divide-border">
              {visible.map((f) => {
                const url = projectRef
                  ? edgeFunctionUrl(projectRef, f.slug)
                  : "";
                return (
                  <div
                    key={f.slug}
                    role="button"
                    tabIndex={0}
                    onClick={() => studio.openEdgeFunctionTab?.(f.slug)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        studio.openEdgeFunctionTab?.(f.slug);
                    }}
                    className="grid w-full grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_140px] cursor-pointer items-center gap-2 px-4 py-3 text-left text-xs transition-colors hover:bg-muted/20"
                  >
                    <span className="truncate font-medium text-foreground">
                      {f.name || f.slug}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {url}
                      </span>
                      <button
                        type="button"
                        aria-label={`Copy URL for ${f.slug}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyUrl(url);
                        }}
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </span>
                    <span className="truncate text-right text-muted-foreground">
                      {timeAgo(f.updated_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

