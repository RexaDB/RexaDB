"use client";

import { KeyRound, Hash } from "@/lib/icon-theme/lucide-react";
import { highlightSql } from "@/lib/ai/sql-highlight";
import type { TableColumn } from "./rls-policies-list";

interface TableDefinitionViewProps {
  tableKey: string;
  columns: TableColumn[];
  viewMode: "columns" | "sql";
  onViewModeChange: (mode: "columns" | "sql") => void;
  sqlContent: string;
}

export function TableDefinitionView({
  tableKey,
  columns,
  viewMode,
  onViewModeChange,
  sqlContent,
}: TableDefinitionViewProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Table: {tableKey} ({columns.length}{" "}
          {columns.length === 1 ? "column" : "columns"})
        </label>
        <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange("columns")}
            className={`text-xs px-2 py-0.5 rounded-lg transition-colors ${
              viewMode === "columns"
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Columns
          </button>
          <button
            onClick={() => onViewModeChange("sql")}
            className={`text-xs px-2 py-0.5 rounded-lg transition-colors ${
              viewMode === "sql"
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            SQL
          </button>
        </div>
      </div>
      {viewMode === "columns" ? (
        <div className="rounded-lg border border-border bg-muted/20 flex-1 min-h-0 overflow-y-auto">
          <div className="divide-y divide-border/30">
            {columns.map((col, idx) => (
              <div
                key={`${col.name}-${idx}`}
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                {col.isPrimary ? (
                  <KeyRound className="w-3 h-3 text-amber-400 shrink-0" />
                ) : (
                  <Hash className="w-3 h-3 text-foreground/45 shrink-0" />
                )}
                <span className="font-medium text-foreground/90 truncate">
                  {col.name}
                </span>
                <span className="text-foreground/50 truncate ml-auto">
                  {col.type}
                </span>
                {col.isNullable && (
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    nullable
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 flex-1 min-h-0 overflow-y-auto">
          <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            <code>{highlightSql(sqlContent)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
