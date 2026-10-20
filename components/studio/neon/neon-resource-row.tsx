import type { NeonBucket, NeonFunction } from "@/lib/neon-cli/client";

export function NeonResourceRow({ item, selected, onClick, objects, objectsLoading, objectsError }: {
  item: NeonBucket | NeonFunction;
  selected: boolean;
  onClick: () => void;
  objects?: string[];
  objectsLoading?: boolean;
  objectsError?: string | null;
}) {
  const bucket = !("slug" in item);
  const title = bucket ? item.name : item.name || item.slug;
  const detail = bucket ? item.access_level ?? "private" : item.status ?? "deployed";
  return <div>
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-muted/20">
      <span className="truncate font-medium">{title}</span><span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
    </button>
    {bucket && selected && <div className="border-t border-border/60 bg-muted/10 px-6 py-2 text-xs text-muted-foreground">
      {objectsLoading ? "Loading objects…" : objectsError ? objectsError : objects?.length ? objects.map((key) => <div key={key} className="truncate py-1 font-mono">{key}</div>) : "This bucket is empty."}
    </div>}
  </div>;
}
