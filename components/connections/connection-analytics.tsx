"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Dashboard,
  type RunRow,
} from "@/components/analytics/dashboard";
import { Connection } from "@/lib/db/schema";
import { apiFetch } from "@/lib/api-base";
import { AnalyticsLoading, AnalyticsError } from "@/components/analytics/analytics-utils";
import type { ConnectionAnalytics as ConnectionAnalyticsData } from "@/lib/db/actions";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export function ConnectionAnalytics({
  connectionId,
  connection,
}: {
  connectionId: number;
  connection?: Connection | null;
}) {
  const [data, setData] = useState<ConnectionAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch(
        `/api/connections/${connectionId}/analytics`,
      );
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading) return <AnalyticsLoading />;
  if (error || !data) return <AnalyticsError />;

  const recentQueries = data.recentQueries ?? [];

  const toHourKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
  };

  const queriesByHour = recentQueries.length > 0
    ? Array.from(
// fallow-ignore-next-line code-duplication
        recentQueries.reduce((acc, q) => {
          const k = toHourKey(q.executedAt);
          acc.set(k, (acc.get(k) || 0) + 1);
          return acc;
        }, new Map<string, number>()),
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }))
    : (data.queriesByDay || []).map((d) => ({ date: d.date, count: d.count }));

  const totalQueries = queriesByHour.reduce((s, d) => s + d.count, 0);
  const qHalf = Math.ceil(queriesByHour.length / 2);
  const qFirst = queriesByHour.slice(0, qHalf).reduce((s, d) => s + d.count, 0);
  const qSecond = queriesByHour.slice(qHalf).reduce((s, d) => s + d.count, 0);
  const queriesTrend = qFirst > 0 ? Math.round(((qSecond - qFirst) / qFirst) * 100) : 0;

  const errorsByHour = recentQueries.length > 0
    ? Array.from(
        recentQueries
// fallow-ignore-next-line code-duplication
          .filter((q) => q.status?.toLowerCase() !== "success")
          .reduce((acc, q) => {
            const k = toHourKey(q.executedAt);
            acc.set(k, (acc.get(k) || 0) + 1);
            return acc;
          }, new Map<string, number>()),
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, errors]) => ({ date, errors }))
    : (data.errorsByDay || []).length > 0
      ? data.errorsByDay!
      : (data.queriesByDay || []).map((d) => ({
          date: d.date,
          errors: d.errorCount ?? 0,
        }));

  const totalErrors = errorsByHour.reduce((s, d) => s + d.errors, 0);

  const TOOLTIP_STYLE = {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    fontSize: "12px",
  } as const;

  const half = Math.ceil(errorsByHour.length / 2);
  const firstHalf = errorsByHour.slice(0, half).reduce((s, d) => s + d.errors, 0);
  const secondHalf = errorsByHour.slice(half).reduce((s, d) => s + d.errors, 0);
  const errorsTrend = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;

  const rightPanel = (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-1 flex shrink-0 items-center justify-between">
        <span className="text-sm text-muted-foreground">Errors over time</span>
        <span className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium border", errorsTrend >= 0 ? "bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive border-[color-mix(in_srgb,var(--destructive)_25%,var(--border))]" : "bg-[color-mix(in_srgb,var(--success)_12%,var(--card))] text-success border-[color-mix(in_srgb,var(--success)_25%,var(--border))]")}>
          {errorsTrend >= 0 ? "+" : ""}{errorsTrend}%
        </span>
      </div>
      <div className="mb-3 shrink-0 text-2xl font-medium tracking-tight text-foreground">
        {totalErrors}
      </div>
      <div className="min-h-0 w-full flex-1">
        {totalErrors > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <BarChart data={errorsByHour} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v: string, i: number) => i === 0 || i === errorsByHour.length - 1 ? v.slice(5) : ""} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="errors" fill="var(--destructive)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            No errors recorded
          </div>
        )}
      </div>
    </div>
  );

  const topQueries = data.topQueries || [];
  const connectionActivity = data.connectionActivity || {
    lastActive: null,
    totalSessions: 0,
  };
  const avgDuration = data.avgDuration || 0;

  const runRows: RunRow[] = topQueries.slice(0, 10).map((q, i) => {
    return {
      id: `run-${i}`,
      started: i === 0
        ? (connectionActivity.lastActive
            ? new Date(connectionActivity.lastActive).toLocaleString()
            : "N/A")
        : `${i * 2 + 1}m ago`,
      workflow: q.query.substring(0, 50) + (q.query.length > 50 ? "..." : ""),
      duration: `${avgDuration}ms`,
      status: "success" as const,
    };
  });

  if (runRows.length === 0) {
    runRows.push({
      id: "empty",
      started: "—",
      workflow: "No queries executed yet",
      duration: "—",
      status: "success",
    });
  }

  const historyRows: RunRow[] = (data.recentQueries ?? []).map((q) => ({
    id: q.id,
    started: new Date(q.executedAt).toLocaleString(),
    workflow: q.query,
    duration: `${q.duration}ms`,
    status: q.status?.toLowerCase() === "success" ? "success" : "failed",
    error: q.error,
  }));

  return (
    <Dashboard
      queriesOverTime={queriesByHour}
      queriesTotal={totalQueries}
      queriesTrend={queriesTrend}
      rightPanel={rightPanel}
      runs={{
        rows: runRows,
        historyRows,
      }}
      onConnect={() => {
        window.location.href = `/studio?id=${connectionId}`;
      }}
      className="h-full w-full min-w-0"
    />
  );
}

export default ConnectionAnalytics;
