"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, Plus, RefreshCw, Search } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import { runQuery } from "@/lib/api/actions-client";
import { fetchStorageBuckets } from "@/lib/studio/storage-utils";
import type { StorageBucket } from "@/lib/studio/storage-utils";
import { formatBytes } from "@/lib/studio/storage-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function StorageFilesView({ studio }: { studio: any }) {
  const connectionString: string =
    studio.currentConnectionString || studio.connection?.connectionString || "";
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPublic, setNewPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadBuckets = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    const { buckets, error } = await fetchStorageBuckets(connectionString);
    setBuckets(buckets);
    setLoadError(error ?? null);
    if (error) toast.error(error);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    const onRefresh = () => void loadBuckets();
    window.addEventListener("studio:storage-buckets-changed", onRefresh);
    return () => window.removeEventListener("studio:storage-buckets-changed", onRefresh);
  }, [loadBuckets]);

  const filtered = buckets.filter((b) =>
    b.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("Bucket name is required.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      toast.error("Use lowercase letters, numbers, dots, underscores, or hyphens.");
      return;
    }
    setCreating(true);
    try {
      const res = await runQuery(
        connectionString,
        `INSERT INTO storage.buckets (id, name, public)
         VALUES ('${name.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', ${newPublic})`,
      );
      if (res?.error) throw new Error(res.error);
      toast.success(`Bucket "${name}" created.`);
      setCreateOpen(false);
      setNewName("");
      setNewPublic(false);
      window.dispatchEvent(new Event("studio:storage-buckets-changed"));
      await loadBuckets();
      studio.openStorageBucketTab?.(name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bucket");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center justify-between gap-4 border-b border-studio-border px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Files</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Browse buckets and manage objects in Supabase Storage.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadBuckets()}
            disabled={loading}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-3.5" />
            New bucket
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search buckets…"
            className="h-9 pl-9 text-xs"
          />
        </div>

        {loading && buckets.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            Loading buckets…
          </div>
        ) : loadError && buckets.length === 0 ? (
          <div className="mx-auto w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
            <div className="text-sm font-medium text-foreground">Failed to load buckets</div>
            <p className="mt-1 break-words text-xs text-muted-foreground">{loadError}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Try running{" "}
              <code className="rounded bg-muted px-1">SELECT * FROM storage.buckets;</code>{" "}
              in the SQL editor to check access.
            </p>
            <Button size="sm" className="mt-3" onClick={() => void loadBuckets()}>
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyStatePresentational
            icon={HardDrive}
            title={search ? "No matching buckets" : "No buckets yet"}
            description={
              search
                ? "Try a different search term."
                : "Create a bucket to start uploading files to Storage."
            }
          >
            {!search && (
              <Button size="sm" className="mt-2" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                New bucket
              </Button>
            )}
          </EmptyStatePresentational>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1fr_100px_120px_160px] gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Name</span>
              <span>Visibility</span>
              <span>File size limit</span>
              <span>Created</span>
            </div>
            <div className="divide-y divide-border/60">
              {filtered.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => studio.openStorageBucketTab?.(b.name)}
                  className="grid w-full grid-cols-[1fr_100px_120px_160px] items-center gap-2 px-4 py-3 text-left text-xs transition-colors hover:bg-muted/20"
                >
                  <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                    <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{b.name}</span>
                  </span>
                  <span>
                    <Badge variant={b.public ? "default" : "secondary"} className="text-[10px]">
                      {b.public ? "Public" : "Private"}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {b.file_size_limit != null ? formatBytes(b.file_size_limit) : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {b.created_at
                      ? new Date(b.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create a new bucket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bucket-name">Name</Label>
              <Input
                id="bucket-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="avatars"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Public bucket</div>
                <p className="text-xs text-muted-foreground">
                  Anyone with the URL can access objects
                </p>
              </div>
              <Switch checked={newPublic} onCheckedChange={setNewPublic} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
