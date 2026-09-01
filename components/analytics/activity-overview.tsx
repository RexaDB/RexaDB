"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Activity,
  Zap,
  Flame,
  Users,
  Table2,
  Clock,
  AlertCircle,
  Database,
} from "@/lib/icon-theme/lucide-react";
import { ContributionHeatmap } from "@/components/analytics/contribution-heatmap";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api-base";
import { getProviderLogoUrl } from "@/components/shared/provider-logo";
import { buildPaddedDays } from "@/lib/studio/date-utils";

/** @deprecated No longer rendered anywhere; the connections list activity sidebar was removed. Kept only until callers/data are confirmed unused. */
export function ActivityOverview({
  connectionId,
  connectionName,
  onBackToAll,
}: {
  connectionId?: number | null;
  connectionName?: string | null;
  onBackToAll?: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const url = connectionId
          ? `${API_BASE}/api/connections/${connectionId}/analytics`
          : `${API_BASE}/api/user/analytics`;
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled && json.success) setData(json.data);
      } catch (e) {
        if (!cancelled) console.error("Failed to load activity data:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data || data.totalQueries === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 text-center gap-3">
        {onBackToAll && (
          <button
            onClick={onBackToAll}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            All activity
          </button>
        )}
        <Activity className="w-8 h-8 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  const successPct = (data.successRate * 100).toFixed(0);

  const days: { date: string; count: number }[] = data.queriesByDay ?? [];
  const paddedDays = buildPaddedDays(days, 52);

  let streak = 0;
  for (let i = paddedDays.length - 1; i >= 0; i--) {
    if (paddedDays[i].count > 0) streak++;
    else break;
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold tracking-tight text-sm">Activity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connectionName ?? "All connections"}
            </p>
          </div>
          {connectionId && onBackToAll && (
            <button
              onClick={onBackToAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              All activity
            </button>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-1.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tabular-nums">
              {data.totalQueries.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">queries</span>
          </div>
          {streak > 1 && (
            <div className="flex items-center gap-1 text-sm">
              <Flame className="w-4 h-4 text-amber-500" />
              <span className="font-semibold">{streak}-day</span>
            </div>
          )}
        </div>

        <ContributionHeatmap queriesByDay={days} />

        <div className="grid grid-cols-3 gap-3 pt-1">
          <div>
            <p className="text-sm font-bold tabular-nums">{successPct}%</p>
            <p className="text-xs text-muted-foreground">Success</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">
              {connectionId ? "—" : data.totalConnections}
            </p>
            <p className="text-xs text-muted-foreground">
              {connectionId ? "Duration" : "Databases"}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">
              {data.avgDuration}ms
            </p>
            <p className="text-xs text-muted-foreground">Avg duration</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Success / Errors
          </span>
          {data.statusDistribution && (
            <div className="space-y-1">
              <div className="flex h-2 rounded-lg overflow-hidden bg-muted/50">
                <div
                  className="bg-emerald-500/70 transition-all"
                  style={{ width: `${successPct}%` }}
                />
                <div
                  className="bg-red-500/60 transition-all"
                  style={{ width: `${100 - Number(successPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{data.statusDistribution.success} succeeded</span>
                <span>{data.statusDistribution.error} failed</span>
              </div>
            </div>
          )}
        </div>

        {data.mostQueriedTables?.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
              <Table2 className="w-3 h-3" />
              Most queried tables
            </span>
            <div className="space-y-1">
              {data.mostQueriedTables.slice(0, 5).map((t: any) => (
                <div
                  key={t.table}
                  className="flex items-center justify-between text-xs"
                >
                  <code className="text-xs bg-muted/60 px-1 py-0.5 rounded truncate font-mono max-w-[180px]">
                    {t.table}
                  </code>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t.count}x
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.contributors?.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3 h-3" />
              Top contributors
            </span>
            <div className="space-y-1">
              {data.contributors.slice(0, 4).map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="truncate max-w-[160px]">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {c.queryCount} queries
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.connectionActivity && (
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Activity
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="font-medium tabular-nums">
                  {data.connectionActivity.totalSessions}
                </p>
                <p className="text-xs text-muted-foreground">Sessions</p>
              </div>
              <div>
                <p className="font-medium tabular-nums">
                  {data.connectionActivity.lastActive
                    ? (() => {
                        const diff =
                          Date.now() - data.connectionActivity.lastActive;
                        const mins = Math.floor(diff / 60000);
                        if (mins < 60) return `${mins}m ago`;
                        const hrs = Math.floor(mins / 60);
                        if (hrs < 24) return `${hrs}h ago`;
                        const days = Math.floor(hrs / 24);
                        return `${days}d ago`;
                      })()
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Last active</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Top queries
          </span>
          {data.topQueries?.length > 0 ? (
            <div className="space-y-1">
              {data.topQueries.slice(0, 3).map((q: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 text-xs text-muted-foreground font-medium tabular-nums w-6 text-right">
                    {q.count}x
                  </span>
                  <code className="text-xs bg-muted/60 px-1 py-0.5 rounded truncate flex-1 font-mono">
                    {q.query}
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No queries yet</p>
          )}
        </div>

        {!connectionId && data.connectionsOverview?.length > 0 && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-primary" />
              Databases & Share
            </span>
            <div className="space-y-2.5">
              {data.connectionsOverview.map((conn: any) => {
                const pct =
                  data.totalQueries > 0
                    ? ((conn.totalQueries / data.totalQueries) * 100).toFixed(0)
                    : "0";
                const logo = getProviderLogoUrl(conn.type);

                return (
                  <div key={conn.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative w-4 h-4 rounded bg-muted/40 flex items-center justify-center shrink-0">
                          <Image
                            src={logo}
                            alt=""
                            width={12}
                            height={12}
                            className="object-contain rounded-lg"
                          />
                        </div>
                        <span className="font-medium truncate text-foreground/90">
                          {conn.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        <span>{conn.totalQueries.toLocaleString()} q</span>
                        <span className="font-semibold text-foreground/60">
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-lg bg-muted/30 overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-lg transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!connectionId && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              Insights
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/20 p-2 rounded-lg border border-border/30">
                <p className="text-xs text-muted-foreground">
                  Total Query Time
                </p>
                <p className="font-semibold mt-0.5 text-foreground/90">
                  {data.totalDuration
                    ? (() => {
                        const sec = Math.floor(data.totalDuration / 1000);
                        if (sec < 60) return `${sec}s`;
                        const min = Math.floor(sec / 60);
                        if (min < 60) return `${min}m`;
                        const hrs = (min / 60).toFixed(1);
                        return `${hrs}h`;
                      })()
                    : "0s"}
                </p>
              </div>
              <div className="bg-muted/20 p-2 rounded-lg border border-border/30">
                <p className="text-xs text-muted-foreground">Saved Snippets</p>
                <p className="font-semibold mt-0.5 text-foreground/90">
                  {data.totalSnippets ?? 0}
                </p>
              </div>
              {data.peakDay && data.peakDay.count > 0 && (
                <div className="col-span-2 bg-muted/20 p-2 rounded-lg border border-border/30 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Peak Activity Day
                    </p>
                    <p className="font-semibold mt-0.5 text-foreground/90">
                      {new Date(data.peakDay.date).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", year: "numeric" },
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-primary">
                      {data.peakDay.count}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                      queries
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {connectionId && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              Health & Performance
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/20 p-2 rounded-lg border border-border/30">
                <p className="text-xs text-muted-foreground">Latency Status</p>
                <p
                  className={cn(
                    "font-semibold mt-0.5",
                    data.avgDuration < 50
                      ? "text-emerald-500"
                      : data.avgDuration < 200
                        ? "text-amber-500"
                        : "text-red-500",
                  )}
                >
                  {data.avgDuration < 50
                    ? "Excellent"
                    : data.avgDuration < 200
                      ? "Warning"
                      : "Slow"}
                </p>
              </div>
              <div className="bg-muted/20 p-2 rounded-lg border border-border/30">
                <p className="text-xs text-muted-foreground">Reliability</p>
                <p
                  className={cn(
                    "font-semibold mt-0.5",
                    Number(successPct) > 95
                      ? "text-emerald-500"
                      : Number(successPct) > 80
                        ? "text-amber-500"
                        : "text-red-500",
                  )}
                >
                  {Number(successPct) > 95
                    ? "Healthy"
                    : Number(successPct) > 80
                      ? "Unstable"
                      : "Critical"}
                </p>
              </div>
            </div>
          </div>
        )}

        {!connectionId && data.queriesByDayByConnection?.length > 0 && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
              <Database className="w-3 h-3" />
              Per-connection activity
            </span>
            {data.queriesByDayByConnection.map((conn: any) => (
              <div key={conn.connectionId} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate max-w-[200px]">
                    {conn.connectionName}
                  </span>
                </div>
                <ContributionHeatmap queriesByDay={conn.queriesByDay} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
