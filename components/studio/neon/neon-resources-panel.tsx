"use client";

import { HardDrive, EdgeFunctionsIcon, RefreshCw } from "@/lib/icon-theme/lucide-react";
import { useNeonResources } from "@/hooks/use-neon-resources";

export function NeonResourcesPanel({ studio, kind }: { studio: any; kind: "buckets" | "functions" }) {
  const connection = studio.connection?.connectionString ?? "";
  const { items, loading, error, refresh } = useNeonResources(connection, kind);
  const title = kind === "buckets" ? "Buckets" : "Functions";
  return <div className="flex flex-col gap-0.5 pt-1">
    <button type="button" className="flex h-8 items-center gap-2 px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => void refresh()}>
      {kind === "buckets" ? <HardDrive className="size-4" /> : <EdgeFunctionsIcon className="size-4" />}
      <span>{title}</span><RefreshCw className={`ml-auto size-3 ${loading ? "animate-spin" : ""}`} />
    </button>
    {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
    {!error && !loading && items.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No {title.toLowerCase()} found.</p>}
    {items.map((item) => {
      const name = "slug" in item ? item.slug : item.name;
      return <button key={name} type="button" className="truncate rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground" onClick={() => kind === "buckets" ? studio.openStorageFilesTab?.() : studio.openEdgeFunctionsTab?.()}>{name}</button>;
    })}
  </div>;
}
