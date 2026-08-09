"use client";

import { GitCompare, Table2 } from "@/lib/icon-theme/lucide-react";
import { SnapshotDiffGrid } from "./snapshot-diff-grid";
import { diffTableDataStore } from "@/lib/db/snapshot-types";

interface DiffTableViewProps {
  tabId: string;
}

export function DiffTableView({ tabId }: DiffTableViewProps) {
  const data = diffTableDataStore.get(tabId);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
        <GitCompare className="w-4 h-4" />
        Diff data not found
      </div>
    );
  }

  const { dataChange } = data;
  const total = dataChange.rowsAdded + dataChange.rowsRemoved + dataChange.rowsModified;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-studio-border text-xs text-muted-foreground shrink-0">
        <GitCompare className="w-3 h-3" />
        <span className="text-muted-foreground">{data.olderName}</span>
        <span className="text-muted-foreground/50">→</span>
        <span className="font-medium text-foreground">{data.newerName}</span>
        <span className="text-muted-foreground">—</span>
        <span className="font-mono">{dataChange.table}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {dataChange.rowsAdded > 0 && <span className="text-green-500">+{dataChange.rowsAdded}</span>}
          {dataChange.rowsRemoved > 0 && <span className="text-red-500">-{dataChange.rowsRemoved}</span>}
          {dataChange.rowsModified > 0 && <span className="text-amber-500">~{dataChange.rowsModified}</span>}
          <span className="text-muted-foreground/50 ml-1">{total} changes</span>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <SnapshotDiffGrid dataChange={dataChange} />
      </div>
    </div>
  );
}
