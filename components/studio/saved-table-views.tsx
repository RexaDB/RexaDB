"use client";

import * as React from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SortRule = { column: string; direction: "ASC" | "DESC" };
type SavedView = { id: string; name: string; table: string; schema: string; filter: string; sort: SortRule[] };

interface Props {
  connectionString?: string;
  table: string | null;
  schema: string;
  filter: string;
  sort: SortRule[];
  onApply: (filter: string, sort: SortRule[]) => void;
}

function storageKey(connection: string | undefined) {
  // Keep connection credentials out of the localStorage key.
  let hash = 2166136261;
  for (const char of connection || "default") hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `rexadb:saved-table-views:${(hash >>> 0).toString(36)}`;
}

function readViews(key: string): SavedView[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string") : [];
  } catch { return []; }
}

export function SavedTableViews({ connectionString, table, schema, filter, sort, onApply }: Props) {
  const key = React.useMemo(() => storageKey(connectionString), [connectionString]);
  const [views, setViews] = React.useState<SavedView[]>([]);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => setViews(readViews(key)), [key]);
  const scoped = views.filter((view) => view.table === table && view.schema === schema);
  const persist = (next: SavedView[]) => {
    setViews(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
  };
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !table) return;
    persist([...views, { id: crypto.randomUUID(), name: trimmed, table, schema, filter, sort }]);
    setName("");
    setCreating(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!table} className="font-normal dark:border-white/15 dark:bg-white/[0.02]">
            <Bookmark className="h-3.5 w-3.5" /> Views{scoped.length ? ` (${scoped.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium">Saved views</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setCreating(true); setOpen(false); }}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Save current
            </Button>
          </div>
          {scoped.length ? scoped.map((view) => (
            <div key={view.id} className="flex items-center gap-1 rounded px-1 hover:bg-muted">
              <button className="min-w-0 flex-1 truncate py-2 text-left text-xs" onClick={() => { onApply(view.filter, view.sort); setOpen(false); }}>
                {view.name}<span className="ml-2 text-muted-foreground">{view.filter ? "Filtered" : "All rows"}</span>
              </button>
              <Button size="icon" variant="ghost" aria-label={`Delete ${view.name}`} className="h-7 w-7" onClick={() => persist(views.filter((item) => item.id !== view.id))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )) : <p className="px-1 py-3 text-xs text-muted-foreground">No saved views for this table yet.</p>}
        </PopoverContent>
      </Popover>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save table view</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Save the current filters and sorting for {schema}.{table}.</p>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="View name" onKeyDown={(event) => { if (event.key === "Enter") save(); }} />
          <DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={save} disabled={!name.trim()}>Save view</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
