"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  EdgeFunctionsIcon,
  RefreshCw,
  Search,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
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
    if (!q) return [...functions];
    return functions.filter(
      (f) =>
        f.slug.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q),
    );
  }, [functions, search]);

  function copyUrl(url: string) {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Function URL copied."))
      .catch(() => toast.error("Failed to copy URL."));
  }

  const columns: TableColumn<EdgeFunction>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: "1fr",
        cell: (f) => (
          <span className="block truncate font-medium" title={f.name || f.slug}>
            {f.name || f.slug}
          </span>
        ),
        sortValue: (f) => f.slug,
      },
      {
        key: "url",
        header: "URL",
        width: "1.6fr",
        cell: (f) => {
          const url = projectRef ? edgeFunctionUrl(projectRef, f.slug) : "";
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={url}>
                {url}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Copy URL for ${f.slug}`}
                title="Copy URL"
                onClick={() => copyUrl(url)}
              >
                <Copy className="size-3.5" />
              </Button>
            </span>
          );
        },
      },
      {
        key: "updated",
        header: "Updated",
        sortable: true,
        align: "right",
        width: "0.7fr",
        cell: (f) => (
          <span className="block truncate text-muted-foreground">
            {timeAgo(f.updated_at)}
          </span>
        ),
        sortValue: (f) => f.updated_at ?? "",
      },
    ],
    [projectRef],
  );

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
          onClick={() => void loadFunctions()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
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
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadFunctions()}>
              <RefreshCw className="size-3.5" />
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
          <DataTable<EdgeFunction>
            data={visible}
            columns={columns}
            getRowId={(f) => f.slug}
            onRowClick={(f) => studio.openEdgeFunctionTab?.(f.slug)}
            emptyState={
              <div className="py-8 text-center">
                <p className="text-sm text-foreground">No results found</p>
                <p className="text-sm text-muted-foreground">
                  Your search for &ldquo;{search}&rdquo; did not return any results
                </p>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

