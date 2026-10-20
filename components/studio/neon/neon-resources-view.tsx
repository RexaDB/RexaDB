"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { useNeonResources } from "@/hooks/use-neon-resources";
import { NeonCreateBucketDialog } from "./neon-create-bucket-dialog";
import { NeonResourceRow } from "./neon-resource-row";

export function NeonResourcesView({ studio, kind }: { studio: any; kind: "buckets" | "functions" }) {
  const connection = studio.connection?.connectionString ?? "";
  const { items, loading, error, refresh, addBucket, getObjects } = useNeonResources(connection, kind);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [objects, setObjects] = useState<string[]>([]);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const objectsRequest = useRef(0);
  const heading = kind === "buckets" ? "Object Storage" : "Neon Functions";

  async function toggleBucket(name: string) {
    const requestId = ++objectsRequest.current;
    if (selectedBucket === name) {
      setSelectedBucket(null);
      setObjects([]);
      setObjectsError(null);
      setObjectsLoading(false);
      return;
    }
    setSelectedBucket(name);
    setObjects([]);
    setObjectsLoading(true);
    setObjectsError(null);
    try {
      const result = await getObjects(name);
      if (requestId === objectsRequest.current) setObjects(result);
    } catch (e) {
      if (requestId === objectsRequest.current) {
        setObjectsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (requestId === objectsRequest.current) setObjectsLoading(false);
    }
  }

  async function handleCreate(name: string, access: "private" | "public_read") {
    setCreating(true);
    try { await addBucket(name, access); setCreateOpen(false); toast.success(`Bucket "${name}" created.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not create bucket."); }
    finally { setCreating(false); }
  }

  return <section className="flex min-h-0 flex-1 flex-col bg-studio-bg">
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div><h1 className="text-sm font-semibold">{heading}</h1><p className="text-xs text-muted-foreground">Resources for the selected Neon branch.</p></div>
      <div className="flex gap-2">{kind === "buckets" && <Button size="sm" onClick={() => setCreateOpen(true)}>New bucket</Button>}
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`mr-2 size-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
    </header>
    <div className="flex-1 overflow-auto p-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : loading && !items.length ? <p className="text-sm text-muted-foreground">Loading…</p> : !items.length ? <p className="text-sm text-muted-foreground">No {kind} found on this branch.</p> :
        <div className="overflow-hidden rounded-lg border border-border divide-y divide-border/60">{items.map((item) => {
          const name = "slug" in item ? item.slug : item.name;
          return <NeonResourceRow key={name} item={item} selected={selectedBucket === name} onClick={() => kind === "buckets" ? void toggleBucket(name) : undefined} objects={objects} objectsLoading={objectsLoading} objectsError={objectsError} />;
        })}</div>}
    </div>
    {kind === "buckets" && <NeonCreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} busy={creating} />}
  </section>;
}
