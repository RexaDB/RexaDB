"use client";

import { useMemo } from "react";
import type { DataChange } from "@/lib/db/snapshot-types";

interface SnapshotDiffGridProps {
  dataChange: DataChange;
}

export function SnapshotDiffGrid({ dataChange }: SnapshotDiffGridProps) {
  const { allAdded, allRemoved, allModified } = dataChange;

  const columns = useMemo(() => {
    const colSet = new Set<string>();
    for (const row of allAdded) {
      for (const key of Object.keys(row)) colSet.add(key);
    }
    for (const row of allRemoved) {
      for (const key of Object.keys(row)) colSet.add(key);
    }
    for (const m of allModified) {
      for (const key of Object.keys(m.new)) colSet.add(key);
    }
    return Array.from(colSet);
  }, [allAdded, allRemoved, allModified]);

  const diffRows = useMemo(() => {
    const rows: {
      type: "added" | "removed" | "modified-old" | "modified-new";
      data: Record<string, unknown>;
      changedColumns?: Set<string>;
    }[] = [];
    for (const row of allRemoved) {
      rows.push({ type: "removed", data: row });
    }
    for (const row of allAdded) {
      rows.push({ type: "added", data: row });
    }
    for (const m of allModified) {
      const changed = new Set<string>();
      for (const key of Object.keys(m.new)) {
        if (JSON.stringify(m.old[key]) !== JSON.stringify(m.new[key])) {
          changed.add(key);
        }
      }
      rows.push({ type: "modified-old", data: m.old, changedColumns: changed });
      rows.push({ type: "modified-new", data: m.new, changedColumns: changed });
    }
    return rows;
  }, [allAdded, allRemoved, allModified]);

  if (diffRows.length === 0) return null;

  const typeIcon = (type: string) => {
    switch (type) {
      case "added":
        return (
          <span className="text-green-500 font-mono text-xs w-5 text-center">
            ++
          </span>
        );
      case "removed":
        return (
          <span className="text-red-500 font-mono text-xs w-5 text-center">
            --
          </span>
        );
      case "modified-old":
        return (
          <span className="text-red-400 font-mono text-xs w-5 text-center">
            ~
          </span>
        );
      case "modified-new":
        return (
          <span className="text-green-400 font-mono text-xs w-5 text-center">
            ~
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="overflow-x-auto custom-scrollbar border border-studio-border rounded-lg">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="bg-table-header-bg border-b border-studio-border sticky top-0 z-10">
            <th className="h-8 px-2 text-left text-muted-foreground font-medium w-10 border-r border-studio-border text-xs">
              <span className="sr-only">Diff</span>
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="h-8 px-2 text-left text-muted-foreground font-medium whitespace-nowrap border-r border-studio-border text-xs"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {diffRows.map((row, i) => {
            const bgColor =
              row.type === "added"
                ? "rgba(34, 197, 94, 0.06)"
                : row.type === "removed"
                  ? "rgba(239, 68, 68, 0.06)"
                  : row.type === "modified-old"
                    ? "rgba(239, 68, 68, 0.06)"
                    : "rgba(34, 197, 94, 0.06)";
            const borderColor =
              row.type === "added"
                ? "border-l-green-500"
                : row.type === "removed"
                  ? "border-l-red-500"
                  : row.type === "modified-old"
                    ? "border-l-red-400"
                    : "border-l-green-400";
            return (
              <tr
                key={i}
                className={`border-b border-studio-border/40 ${borderColor}`}
                style={{ backgroundColor: bgColor }}
              >
                <td className="h-7 px-2 border-r border-studio-border/40 text-center">
                  {typeIcon(row.type)}
                </td>
                {columns.map((col) => {
                  const val = row.data[col];
                  const isChanged = row.changedColumns?.has(col);
                  const cellBg = isChanged
                    ? row.type === "modified-old"
                      ? "rgba(239, 68, 68, 0.15)"
                      : "rgba(34, 197, 94, 0.15)"
                    : "transparent";
                  return (
                    <td
                      key={col}
                      className="h-7 px-2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[300px] border-r border-studio-border/40"
                      style={{ backgroundColor: cellBg }}
                    >
                      {val === null || val === undefined ? (
                        <span className="text-muted-foreground/40 italic">
                          NULL
                        </span>
                      ) : (
                        String(val)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
