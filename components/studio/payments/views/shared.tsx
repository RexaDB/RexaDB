"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

export function ViewShell({
  title,
  description,
  loading,
  onRefresh,
  actions,
  children,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

export function ViewError({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
      <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function SetupCta({ onGoSetup }: { onGoSetup: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-studio-border/60 px-4 py-10 text-center">
      <p className="text-sm font-medium">Billing schema not found</p>
      <p className="max-w-md text-xs text-muted-foreground">
        This project has no <span className="font-mono">paykit</span> schema
        tables yet. Push the schema and deploy the edge functions to start
        accepting payments.
      </p>
      <Button size="sm" className="mt-1 h-8 text-xs" onClick={onGoSetup}>
        Open Setup
      </Button>
    </div>
  );
}

export function ViewLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-studio-border/60 px-4 py-10 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const variant =
    s === "active" || s === "paid" || s === "processed" || s === "trialing"
      ? "default"
      : s === "failed" || s === "canceled" || s === "unpaid"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="font-mono text-[10px]">
      {status}
    </Badge>
  );
}

export interface DataColumn {
  key: string;
  label: string;
  mono?: boolean;
  render?: (row: Record<string, any>) => ReactNode;
}

export function DataTable({ columns, rows }: { columns: DataColumn[]; rows: Record<string, any>[] }) {
  return (
    <div className="overflow-auto rounded-xl border border-studio-border/60">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-studio-border/60 bg-muted/30">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-medium text-muted-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-studio-border/40 last:border-0 hover:bg-muted/20"
            >
              {columns.map((c) => (
                <td key={c.key} className={`max-w-[280px] truncate px-3 py-2 ${c.mono ? "font-mono text-[11px]" : ""}`}>
                  {c.render ? c.render(row) : formatCell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
