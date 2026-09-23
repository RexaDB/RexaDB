"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getTabIcon } from "@/lib/studio/tab-registry";
import { HardDrive, FolderOpen, Settings, Shield, Plus, RefreshCw } from "@/lib/icon-theme/lucide-react";
import {
  createStorageBucket,
  useStorageBuckets,
} from "@/components/studio/storage/storage-buckets-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const ROW =
  "flex h-8 w-full select-none items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

/**
 * Storage sidebar section for supabase-mgmt (and Supabase Postgres) connections.
 * Files lists buckets; Settings / Policies open their management tabs.
 */
export function StoragePanel({ studio }: { studio: any }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const connectionString: string = studio.currentConnectionString || studio.connection?.connectionString || "";
  const { buckets, loading, loadError, loadBuckets, notifyBucketsChanged } =
    useStorageBuckets(connectionString, {
      onError: (message) => console.warn("[storage] failed to list buckets:", message),
    });

  const navItems: Array<{ label: string; tabType: string; fn?: () => void; icon: React.ReactNode }> = [
    {
      label: "Files",
      tabType: "storage-files",
      fn: studio.openStorageFilesTab,
      icon: <FolderOpen className="size-4 shrink-0" />,
    },
    {
      label: "Settings",
      tabType: "storage-settings",
      fn: studio.openStorageSettingsTab,
      icon: <Settings className="size-4 shrink-0" />,
    },
    {
      label: "Policies",
      tabType: "storage-policies",
      fn: studio.openStoragePoliciesTab,
      icon: <Shield className="size-4 shrink-0" />,
    },
  ];

  async function handleCreate() {
    const name = newName.trim();
    setCreating(true);
    try {
      await createStorageBucket(connectionString, name, false);
      toast.success(`Bucket "${name}" created.`);
      setCreateOpen(false);
      setNewName("");
      await loadBuckets();
      notifyBucketsChanged();
      studio.openStorageBucketTab?.(name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bucket");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {navItems.map((i) => {
        const Icon = getTabIcon(i.tabType);
        return (
          <button
            key={i.tabType}
            type="button"
            onClick={() => i.fn?.()}
            className={ROW}
          >
            {i.icon ?? (Icon ? <Icon className="size-4 shrink-0" /> : <HardDrive className="size-4 shrink-0" />)}
            <span>{i.label}</span>
          </button>
        );
      })}

      <div className="mt-2 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Buckets
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Refresh buckets"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
            onClick={() => void loadBuckets()}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            aria-label="New bucket"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {loadError ? (
        <div
          className="mx-0.5 mt-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
          title={loadError}
        >
          Failed to load buckets: <span className="break-words">{loadError}</span>
        </div>
      ) : buckets.length === 0 && !loading ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No buckets</div>
      ) : (
        buckets.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => studio.openStorageBucketTab?.(b.name)}
            className={cn(
              ROW,
              studio.activeTabId?.includes(`storage-bucket-${b.name}`) && "bg-white/10 text-foreground",
            )}
          >
            <HardDrive className="size-4 shrink-0" />
            <span className="truncate">{b.name}</span>
            {b.public ? (
              <span className="ml-auto text-[10px] text-muted-foreground/70">public</span>
            ) : null}
          </button>
        ))
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create bucket</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="bucket-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
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
