"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  SchemaPlan,
  SchemaPlanColumn,
  SchemaPlanColumnChange,
} from "@/lib/ai/types";

const CHANGE_STYLES: Record<
  SchemaPlanColumnChange,
  { label: string; row: string; badge: string }
> = {
  added: {
    label: "added",
    row: "bg-emerald-500/10 text-emerald-200",
    badge: "bg-emerald-500/20 text-emerald-300",
  },
  removed: {
    label: "removed",
    row: "bg-red-500/10 text-red-200 line-through decoration-red-400/70",
    badge: "bg-red-500/20 text-red-300",
  },
  modified: {
    label: "modified",
    row: "bg-amber-500/10 text-amber-100",
    badge: "bg-amber-500/20 text-amber-300",
  },
  unchanged: {
    label: "unchanged",
    row: "text-muted-foreground/80",
    badge: "bg-muted text-muted-foreground",
  },
};

/**
 * Visual “table gateway” for ```schema-plan blocks —
 * green = added columns, red = removed, amber = modified.
 */
export function SchemaPlanBlock({
  plan,
  canApply = false,
  onOpenSql,
}: {
  plan: SchemaPlan;
  canApply?: boolean;
  onOpenSql?: (sql: string) => void;
}) {
  return (
    <div className="my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-muted/30">
      <div className="flex items-start justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">
            {plan.title || "Schema plan"}
          </div>
          {plan.summary && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {plan.summary}
            </div>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {plan.mode === "build" ? "build" : "plan"}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {plan.tables.map((table) => (
          <div
            key={`${table.schema}.${table.table}`}
            className="overflow-hidden rounded-md border border-border/60 bg-background/40"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/40 px-2.5 py-1.5">
              <div className="min-w-0 truncate font-mono text-[11px] text-foreground">
                <span className="text-muted-foreground">{table.schema}.</span>
                {table.table}
              </div>
              <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {table.action}
              </span>
            </div>
            <TableColumns columns={table.columns} />
          </div>
        ))}
      </div>

      {plan.notes && plan.notes.length > 0 && (
        <ul className="space-y-1 border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          {plan.notes.map((note, i) => (
            <li key={i}>• {note}</li>
          ))}
        </ul>
      )}

      {plan.applySql && (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Proposed SQL {canApply ? "" : "(not executed in plan mode)"}
          </div>
          <pre className="overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-[11px] text-foreground/90">
            {plan.applySql}
          </pre>
          {canApply && onOpenSql && (
            <button
              type="button"
              onClick={() => onOpenSql(plan.applySql!)}
              className="mt-2 text-[11px] font-medium text-primary hover:underline"
            >
              Open in SQL editor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const CHANGE_ORDER: SchemaPlanColumnChange[] = [
  "added",
  "removed",
  "modified",
  "unchanged",
];

function TableColumns({ columns }: { columns: SchemaPlanColumn[] }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  if (columns.length === 0) {
    return (
      <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
        No column details
      </div>
    );
  }

  const changed = columns.filter((c) => c.change !== "unchanged");
  const unchanged = columns.filter((c) => c.change === "unchanged");
  const visible = [
    ...CHANGE_ORDER.flatMap((change) =>
      (change === "unchanged" ? (showUnchanged ? unchanged : []) : changed.filter((c) => c.change === change)),
    ),
  ];

  return (
    <div className="divide-y divide-border/30">
      {visible.length === 0 && unchanged.length > 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
          No added or removed columns
        </div>
      ) : (
        visible.map((col) => {
          const style = CHANGE_STYLES[col.change];
          const typeLabel =
            col.change === "modified" && col.previousType
              ? `${col.previousType} → ${col.type}`
              : col.type && col.type !== "—"
                ? col.type
                : "";
          return (
            <div
              key={`${col.name}-${col.change}`}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 text-[11px]",
                style.row,
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase",
                  style.badge,
                )}
              >
                {style.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">
                {col.name}
              </span>
              {typeLabel ? (
                <span className="shrink-0 font-mono text-muted-foreground">
                  {typeLabel}
                </span>
              ) : null}
            </div>
          );
        })
      )}
      {unchanged.length > 0 && (
        <button
          type="button"
          onClick={() => setShowUnchanged((v) => !v)}
          className="w-full px-2.5 py-1.5 text-left text-[10px] text-muted-foreground/80 hover:text-muted-foreground"
        >
          {showUnchanged ? "Hide" : "Show"} {unchanged.length} unchanged column
          {unchanged.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
