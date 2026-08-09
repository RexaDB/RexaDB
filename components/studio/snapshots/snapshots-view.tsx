"use client";

import { useState, useEffect, useCallback } from "react";
import { Camera, Plus, Trash2, GitCompare, Loader2, Check, X } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MultiSelect } from "@/components/ui/multi-select";
import { toast } from "sonner";
import { useSnapshots } from "@/hooks/use-snapshots";
import { SnapshotDetail } from "./snapshot-detail";
import { SnapshotCompareView } from "./snapshot-compare-view";
import type { DatabaseSnapshot, SnapshotMeta, SnapshotDiff, SnapshotProgressEvent, DataChange } from "@/lib/db/snapshot-types";
import { snapshotTableDataStore, diffTableDataStore } from "@/lib/db/snapshot-types";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import { API_BASE } from "@/lib/api-base";

type ViewState =
  | { mode: "list" }
  | { mode: "detail"; snapshot: DatabaseSnapshot }
  | { mode: "compare"; diff: SnapshotDiff };

interface SnapshotsViewProps {
  connectionId: string;
  connectionString: string;
  onOpenSnapshotTable?: (tabId: string, tabName: string) => void;
  onOpenDiffTable?: (tabId: string, tabName: string) => void;
}

interface TableProgress {
  table: string;
  status: "waiting" | "fetching" | "done" | "error";
  rows: number;
  chunk?: number;
}

export function SnapshotsView({ connectionId, connectionString, onOpenSnapshotTable, onOpenDiffTable }: SnapshotsViewProps) {
  const snapshots = useSnapshots(connectionId);
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [view, setView] = useState<ViewState>({ mode: "list" });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const engine = detectConnectionDbType(connectionString);

  const loadList = useCallback(async () => {
    const m = await snapshots.list();
    setMetas(m);
    if (m.length === 0) setView({ mode: "list" });
  }, [snapshots]);

  useEffect(() => { loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"tables" | "name" | "progress">("tables");
  const [allTables, setAllTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [tablesLoading, setTablesLoading] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [tableProgress, setTableProgress] = useState<TableProgress[]>([]);

  const openCreateDialog = async () => {
    setCreateOpen(true);
    setCreateStep("tables");
    setCreateName("");
    setCreateDesc("");
    setSelectedTables(new Set());
    setTableProgress([]);
    setTablesLoading(true);
    try {
      const dbType = detectConnectionDbType(connectionString);
      const schema = dbType === "sqlite" ? "main" : dbType === "postgres" ? "public" : "";
      const res = await fetch(`${API_BASE}/api/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString, schema }),
      });
      const json = await res.json();
      const data = json.data || json.tables || [];
      setAllTables(data as string[]);
    } catch {
      setAllTables([]);
    }
    setTablesLoading(false);
  };

  const startCreate = async () => {
    if (!createName.trim()) { toast.error("Enter a snapshot name"); return; }
    const tables = Array.from(selectedTables);
    setCreating(true);
    setCreateStep("progress");
    setTableProgress(tables.map(t => ({ table: t, status: "waiting" as const, rows: 0 })));

    const meta = await snapshots.create(
      connectionString,
      createName.trim(),
      createDesc.trim(),
      tables,
      (event: SnapshotProgressEvent) => {
        setTableProgress(prev => {
          const next = [...prev];
          const idx = event.current - 1;
          if (idx < 0 || idx >= next.length) return prev;
          if (event.type === "table-start") {
            next[idx] = { ...next[idx], status: "fetching" };
          } else if (event.type === "table-progress") {
            next[idx] = { ...next[idx], rows: event.rows };
          } else if (event.type === "table-chunk") {
            next[idx] = { ...next[idx], rows: event.rows, chunk: event.chunk };
          } else if (event.type === "table-done") {
            next[idx] = { ...next[idx], status: "done", rows: event.rows };
          } else if (event.type === "table-error") {
            next[idx] = { ...next[idx], status: "error" };
          }
          return next;
        });
      },
    );

    setCreating(false);
    if (meta) {
      toast.success(`Snapshot "${meta.name}" created`);
      setCreateOpen(false);
      await loadList();
    } else {
      toast.error(snapshots.error || "Failed to create snapshot");
      setCreateStep("name");
    }
  };

  const handleDelete = async (snapshotId: string) => {
    const ok = await snapshots.remove(snapshotId);
    if (ok) {
      toast.success("Snapshot deleted");
      setView({ mode: "list" });
      await loadList();
    } else if (snapshots.error) {
      toast.error(snapshots.error);
    }
  };

  const handleViewSnapshot = async (snapshotId: string) => {
    const s = await snapshots.getFull(snapshotId);
    if (s) {
      setView({ mode: "detail", snapshot: s });
    } else if (snapshots.error) {
      toast.error(snapshots.error);
    }
  };

  const handleOpenSnapshotTable = (
    tableRef: string,
    columns: { name: string; dataType: string }[],
    rows: Record<string, unknown>[],
    snapshotName: string,
  ) => {
    const tabId = `snapshot-table-${connectionId}-${tableRef}-${Date.now()}`;
    snapshotTableDataStore.set(tabId, { snapshotName, tableRef, columns: columns.map(c => ({ ...c, isNullable: false, defaultValue: null, isPrimary: false })), rows });
    onOpenSnapshotTable?.(tabId, `${snapshotName} — ${tableRef}`);
  };

  const handleOpenDiffTable = (
    table: string,
    dataChange: DataChange,
    olderName: string,
    newerName: string,
  ) => {
    const tabId = `diff-table-${connectionId}-${table}-${Date.now()}`;
    diffTableDataStore.set(tabId, { olderName, newerName, dataChange });
    onOpenDiffTable?.(tabId, `${dataChange.rowsAdded} added, ${dataChange.rowsRemoved} removed, ${dataChange.rowsModified} modified — ${table}`);
  };

  const handleCompare = async () => {
    if (selectedIds.length !== 2) return;
    setLoadingCompare(true);
    const sorted = [...selectedIds].sort();
    const diff = await snapshots.compare(sorted[0], sorted[1]);
    setLoadingCompare(false);
    if (diff) {
      setView({ mode: "compare", diff });
      setSelectMode(false);
      setSelectedIds([]);
    } else {
      toast.error(snapshots.error || "Failed to compare snapshots");
    }
  };

  const doneCount = tableProgress.filter(p => p.status === "done").length;
  const errorCount = tableProgress.filter(p => p.status === "error").length;

  if (view.mode === "detail") {
    return (
      <SnapshotDetail
        snapshot={view.snapshot}
        onBack={() => setView({ mode: "list" })}
        onCompare={(id) => {
          setSelectMode(true);
          setSelectedIds([id]);
          setView({ mode: "list" });
        }}
        onOpenSnapshotTable={handleOpenSnapshotTable}
      />
    );
  }

  if (view.mode === "compare") {
    return (
      <SnapshotCompareView
        diff={view.diff}
        onBack={() => setView({ mode: "list" })}
        onOpenDiffTable={handleOpenDiffTable}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-studio-border shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Snapshots</span>
          <span className="text-xs text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">{metas.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {metas.length >= 2 && !selectMode && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectMode(true)}>
              <GitCompare className="w-3 h-3 mr-1" /> Compare
            </Button>
          )}
          {selectMode && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectMode(false); setSelectedIds([]); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={selectedIds.length !== 2 || loadingCompare}
                onClick={handleCompare}
              >
                {loadingCompare ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <GitCompare className="w-3 h-3 mr-1" />}
                Compare Selected
              </Button>
            </>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={openCreateDialog}>
            <Plus className="w-3 h-3 mr-1" /> New Snapshot
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {snapshots.error && (
          <p className="text-xs text-red-500 mb-3">{snapshots.error}</p>
        )}

        {metas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <Camera className="w-10 h-10 opacity-30" />
            <div>
              <p className="text-sm font-medium">No snapshots yet</p>
              <p className="text-xs mt-1">Capture the current state of your database</p>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={openCreateDialog}>
              <Plus className="w-3 h-3 mr-1" /> Create Snapshot
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {metas.map((meta) => (
              <Card
                key={meta.id}
                className={`border-border/60 bg-studio-bg/40 p-3 cursor-pointer hover:bg-studio-bg/60 transition-colors ${
                  selectMode && selectedIds.includes(meta.id) ? "ring-2 ring-primary/50" : ""
                }`}
                onClick={() => {
                  if (selectMode) {
                    setSelectedIds(prev => {
                      if (prev.includes(meta.id)) return prev.filter(id => id !== meta.id);
                      if (prev.length >= 2) return [prev[1], meta.id];
                      return [...prev, meta.id];
                    });
                  } else {
                    handleViewSnapshot(meta.id);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{meta.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(meta.createdAt).toLocaleString()} · {engine}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{meta.tableCount} tables</p>
                      <p>{meta.rowCount.toLocaleString()} rows</p>
                    </div>
                    {!selectMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(meta.id); }}
                        className="p-1 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
        <DialogContent className="border-border bg-studio-bg max-w-lg">
          {createStep === "tables" && (
            <>
              <DialogHeader>
                <DialogTitle>Select Tables</DialogTitle>
                <DialogDescription>
                  Choose which tables to include in the snapshot.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <MultiSelect
                  options={allTables.map(t => ({ value: t, label: t }))}
                  selected={selectedTables}
                  onChange={setSelectedTables}
                  placeholder={tablesLoading ? "Loading tables..." : "Select tables..."}
                  emptyText={tablesLoading ? "" : "No tables found"}
                  loading={tablesLoading}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setCreateStep("name")} disabled={selectedTables.size === 0}>
                  Next ({selectedTables.size})
                </Button>
              </DialogFooter>
            </>
          )}

          {createStep === "name" && (
            <>
              <DialogHeader>
                <DialogTitle>Name Snapshot</DialogTitle>
                <DialogDescription>
                  {selectedTables.size} table{selectedTables.size !== 1 ? "s" : ""} selected.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Snapshot name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="h-9 text-sm"
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateStep("tables")}>Back</Button>
                <Button size="sm" onClick={startCreate} disabled={!createName.trim()}>
                  <Camera className="w-3 h-3 mr-1" /> Create Snapshot
                </Button>
              </DialogFooter>
            </>
          )}

          {createStep === "progress" && (
            <>
              <DialogHeader>
                <DialogTitle>Creating Snapshot</DialogTitle>
                <DialogDescription>
                  {doneCount + errorCount} of {tableProgress.length} tables processed
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <div className="w-full h-1.5 bg-border/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${tableProgress.length > 0 ? ((doneCount + errorCount) / tableProgress.length) * 100 : 0}%` }}
                  />
                </div>
                <ScrollArea className="h-56">
                  {tableProgress.map((p) => (
                    <div key={p.table} className="flex items-center gap-2.5 py-1.5 text-sm">
                      {p.status === "waiting" && (
                        <div className="w-4 h-4 rounded-full border border-border" />
                      )}
                      {p.status === "fetching" && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                      )}
                      {p.status === "done" && (
                        <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 text-green-500" />
                        </div>
                      )}
                      {p.status === "error" && (
                        <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                          <X className="w-3 h-3 text-red-500" />
                        </div>
                      )}
                      <span className="truncate flex-1">{p.table}</span>
                      {p.rows > 0 && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {p.rows.toLocaleString()} rows{p.chunk ? ` · chunk ${p.chunk}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </ScrollArea>
              </div>
              <DialogFooter>
                {(doneCount + errorCount) === tableProgress.length && !creating ? (
                  <Button size="sm" onClick={() => setCreateOpen(false)}>Close</Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Processing tables...</p>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
