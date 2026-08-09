// fallow-ignore-file code-duplication
"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Plus,
  Minus,
  Pencil,
  Table2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SnapshotDiffGrid } from "./snapshot-diff-grid";
import type { SnapshotDiff, DataChange } from "@/lib/db/snapshot-types";
import { DiffTableHeader, DiffCell } from "./snapshot-diff-shared";

interface SnapshotCompareViewProps {
  diff: SnapshotDiff;
  onBack: () => void;
  onOpenDiffTable: (
    table: string,
    dataChange: DataChange,
    olderName: string,
    newerName: string,
  ) => void;
}

export function SnapshotCompareView({
  diff,
  onBack,
  onOpenDiffTable,
}: SnapshotCompareViewProps) {
  const { schemaChanges, dataChanges, summary } = diff;
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const toggleExpand = (table: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-studio-border shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="text-sm font-medium truncate">
          <span className="text-muted-foreground">{diff.olderName}</span>
          <span className="mx-1.5 text-muted-foreground/50">→</span>
          <span className="text-foreground">{diff.newerName}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-border/60 bg-studio-bg/40 p-3 text-center">
            <p className="text-xs text-muted-foreground">Tables Changed</p>
            <p className="text-sm font-semibold">
              {summary.tablesAdded +
                summary.tablesRemoved +
                summary.tablesModified}
            </p>
          </Card>
          <Card className="border-border/60 bg-studio-bg/40 p-3 text-center">
            <p className="text-xs text-muted-foreground">Rows Added</p>
            <p className="text-sm font-semibold text-green-500">
              {summary.rowsAdded}
            </p>
          </Card>
          <Card className="border-border/60 bg-studio-bg/40 p-3 text-center">
            <p className="text-xs text-muted-foreground">Rows Removed</p>
            <p className="text-sm font-semibold text-red-500">
              {summary.rowsRemoved}
            </p>
          </Card>
        </div>

        {/* Schema Changes */}
        {schemaChanges.length > 0 && (
          <Card className="border-border/60 bg-studio-bg/40 p-3">
            <p className="text-xs font-bold tracking-wider text-muted-foreground mb-2">
              Schema Changes ({schemaChanges.length})
            </p>
            <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
              {schemaChanges.map((ch, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  {ch.action === "added" ? (
                    <Plus className="w-3 h-3 text-green-500 shrink-0" />
                  ) : ch.action === "removed" ? (
                    <Minus className="w-3 h-3 text-red-500 shrink-0" />
                  ) : (
                    <Pencil className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  <span
                    className={
                      ch.action === "added"
                        ? "text-green-400"
                        : ch.action === "removed"
                          ? "text-red-400"
                          : "text-amber-400"
                    }
                  >
                    {ch.action}
                  </span>
                  <span className="text-muted-foreground">{ch.type}</span>
                  <span className="font-mono">{ch.entityName}</span>
                  {ch.details && (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {ch.details}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Per-Table Data Diffs */}
        {dataChanges.map((dc) => (
          <Card
            key={dc.table}
            className="border-border/60 bg-studio-bg/40 p-0 overflow-hidden"
          >
            {/* Table Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-studio-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <Table2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium font-mono truncate">
                  {dc.table}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs shrink-0">
                {dc.rowsAdded > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">
                    +{dc.rowsAdded}
                  </span>
                )}
                {dc.rowsRemoved > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">
                    -{dc.rowsRemoved}
                  </span>
                )}
                {dc.rowsModified > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                    ~{dc.rowsModified}
                  </span>
                )}
                <button
                  onClick={() =>
                    onOpenDiffTable(
                      dc.table,
                      dc,
                      diff.olderName,
                      diff.newerName,
                    )
                  }
                  className="p-0.5 hover:bg-studio-border/40 rounded text-muted-foreground hover:text-foreground transition-colors ml-1"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Preview Rows */}
            <div className="p-3 space-y-2">
              {dc.sampleRemoved.length > 0 && (
                <DiffPreview
                  rows={dc.sampleRemoved}
                  type="removed"
                  count={dc.rowsRemoved}
                />
              )}
              {dc.sampleAdded.length > 0 && (
                <DiffPreview
                  rows={dc.sampleAdded}
                  type="added"
                  count={dc.rowsAdded}
                />
              )}
              {dc.sampleModified.length > 0 && (
                <ModifiedPreview
                  rows={dc.sampleModified}
                  total={dc.rowsModified}
                />
              )}

              {/* View Full Diff */}
              {(dc.allAdded.length > 0 ||
                dc.allRemoved.length > 0 ||
                dc.allModified.length > 0) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs mt-1"
                  onClick={() => toggleExpand(dc.table)}
                >
                  {expandedTables.has(dc.table) ? (
                    <ChevronDown className="w-3 h-3 mr-1" />
                  ) : (
                    <ChevronRight className="w-3 h-3 mr-1" />
                  )}
                  {expandedTables.has(dc.table)
                    ? "Hide Full Diff"
                    : "View Full Table Diff"}
                </Button>
              )}
            </div>

            {/* Full Diff Grid */}
            {expandedTables.has(dc.table) && (
              <div className="border-t border-studio-border/60 p-3">
                <SnapshotDiffGrid dataChange={dc} />
              </div>
            )}
          </Card>
        ))}

        {/* No Changes */}
        {schemaChanges.length === 0 && dataChanges.length === 0 && (
          <Card className="border-border/60 bg-emerald-500/10 p-3 text-sm text-emerald-600">
            Snapshots are identical. No changes detected.
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---- Sub-components ---- */

function DiffPreview({
  rows,
  type,
  count,
}: {
  rows: Record<string, unknown>[];
  type: "added" | "removed";
  count: number;
}) {
  const cols = Object.keys(rows[0] || {}).slice(0, 6);
  if (rows.length === 0) return null;
  const isGreen = type === "added";

  return (
    <div>
      <p
        className={`text-xs font-bold mb-1 ${isGreen ? "text-green-500" : "text-red-500"}`}
      >
        {isGreen ? "Added" : "Removed"} ({count})
        {count > rows.length && (
          <span className="text-muted-foreground font-normal ml-1">
            (showing {rows.length})
          </span>
        )}
      </p>
      <div className="overflow-x-auto custom-scrollbar border border-studio-border/40 rounded-lg">
        <table className="w-full text-xs font-mono border-collapse">
          <DiffTableHeader cols={cols} />
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-studio-border/30"
                style={{
                  backgroundColor: isGreen
                    ? "rgba(34, 197, 94, 0.04)"
                    : "rgba(239, 68, 68, 0.04)",
                }}
              >
                <td className="px-1 py-1 border-r border-studio-border/30 text-center">
                  {isGreen ? (
                    <span className="text-green-500 text-xs font-mono">+</span>
                  ) : (
                    <span className="text-red-500 text-xs font-mono">-</span>
                  )}
                </td>
                {cols.map((c) => (
                  <DiffCell key={c} value={row[c]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModifiedPreview({
  rows,
  total,
}: {
  rows: { old: Record<string, unknown>; new: Record<string, unknown> }[];
  total: number;
}) {
  const cols = Object.keys(rows[0]?.new || {}).slice(0, 6);
  if (rows.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-bold text-amber-500 mb-1">
        Modified ({total})
        {total > 5 && (
          <span className="text-muted-foreground font-normal ml-1">
            (showing {rows.length})
          </span>
        )}
      </p>
      <div className="space-y-2">
        {rows.map((m, i) => (
          <div
            key={i}
            className="border border-studio-border/40 rounded-lg overflow-x-auto"
          >
            <table className="w-full text-xs font-mono border-collapse">
              <DiffTableHeader cols={cols} />
              <tbody>
                {/* Old row */}
                <tr
                  className="border-b border-studio-border/30"
                  style={{ backgroundColor: "rgba(239, 68, 68, 0.05)" }}
                >
                  <td className="px-1 py-1 border-r border-studio-border/30 text-center">
                    <span className="text-red-400 text-xs font-mono">-</span>
                  </td>
                  {/* fallow-ignore-next-line code-duplication */}
                  {cols.map((c) => {
                    const isChanged =
                      JSON.stringify(m.old[c]) !== JSON.stringify(m.new[c]);
                    return <DiffCell key={c} value={m.old[c]} highlight={isChanged} />;
                  })}
                </tr>
                {/* New row */}
                <tr style={{ backgroundColor: "rgba(34, 197, 94, 0.05)" }}>
                  <td className="px-1 py-1 border-r border-studio-border/30 text-center">
                    <span className="text-green-400 text-xs font-mono">+</span>
                  </td>
                  {/* fallow-ignore-next-line code-duplication */}
                  {cols.map((c) => {
                    const isChanged =
                      JSON.stringify(m.old[c]) !== JSON.stringify(m.new[c]);
                    return <DiffCell key={c} value={m.new[c]} highlight={isChanged} />;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
