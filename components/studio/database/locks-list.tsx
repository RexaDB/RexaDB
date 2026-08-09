"use client";

import { Search, Lock, RefreshCw, Loader2, AlertTriangle } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LockEntry {
  locktype: string;
  database: string;
  relation_name: string | null;
  pid: number;
  mode: string;
  granted: boolean;
  fastpath: boolean;
  virtualtransaction: string;
  transactionid: string | null;
  page: number | null;
  tuple: number | null;
  query: string;
  state: string;
  query_start: string;
  application_name: string;
  usename: string;
  client_addr: string | null;
}

interface LocksListProps {
  connectionString: string;
}

export function LocksList({ connectionString }: LocksListProps) {
  const [locks, setLocks] = useState<LockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [killingPid, setKillingPid] = useState<number | null>(null);

  const loadLocks = useCallback(async () => {
    setLoading(true);
    try {
      const { fetchLocks } = await import("@/lib/api/actions-client");
      const res = await fetchLocks(connectionString);
      if (res.success && Array.isArray(res.data)) {
        setLocks(res.data);
      } else {
        toast.error(res.error || "Failed to load locks");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load locks");
    } finally {
      setLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    loadLocks();
    const interval = setInterval(loadLocks, 10000);
    return () => clearInterval(interval);
  }, [loadLocks]);

  const handleKillSession = async (pid: number) => {
    setKillingPid(pid);
    try {
      const { killSession } = await import("@/lib/api/actions-client");
      const res = await killSession(connectionString, pid);
      if (res.success) {
        toast.success(`Session ${pid} terminated`);
        loadLocks();
      } else {
        toast.error(res.error || "Failed to terminate session");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to terminate session");
    } finally {
      setKillingPid(null);
    }
  };

  const blockedLocks = locks.filter((l) => !l.granted);
  const blockingPids = new Set(blockedLocks.map((l) => l.pid));

  const filteredLocks = locks.filter(
    (l) =>
      l.pid.toString().includes(search) ||
      l.mode?.toLowerCase().includes(search.toLowerCase()) ||
      l.locktype?.toLowerCase().includes(search.toLowerCase()) ||
      l.relation_name?.toLowerCase().includes(search.toLowerCase()) ||
      l.query?.toLowerCase().includes(search.toLowerCase()),
  );

  const groupedLocks = filteredLocks.reduce(
    (acc, lock) => {
      const key = lock.pid;
      if (!acc[key]) acc[key] = [];
      acc[key].push(lock);
      return acc;
    },
    {} as Record<number, LockEntry[]>,
  );

  const modeColor = (mode: string) => {
    const exclusive = [
      "AccessExclusiveLock",
      "ExclusiveLock",
      "RowExclusiveLock",
    ];
    const moderate = [
      "ShareLock",
      "ShareRowExclusiveLock",
      "ShareUpdateExclusiveLock",
    ];
    if (exclusive.some((m) => mode.includes(m)))
      return "text-red-500 bg-red-500/10 border-red-500/30";
    if (moderate.some((m) => mode.includes(m)))
      return "text-amber-500 bg-amber-500/10 border-amber-500/30";
    return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  };

  return (
    <div className="flex-1 overflow-y-auto bg-studio-bg">
      <div className="max-w-6xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-sm sm:text-sm font-bold text-foreground tracking-tight">
              Locks
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Active database locks. Monitor blocking sessions and contention.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadLocks}
            disabled={loading}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {blockedLocks.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg text-xs text-red-500">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {blockedLocks.length} blocked lock
              {blockedLocks.length !== 1 ? "s" : ""} detected across{" "}
              {blockingPids.size} session{blockingPids.size !== 1 ? "s" : ""}.
              Check for blocking chains.
            </span>
          </div>
        )}

        <div className="relative group w-full sm:max-w-md">
          <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Search by PID, mode, relation, or query..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 sm:pl-10 h-9 sm:h-10 bg-background/50 border-studio-border focus-visible:ring-primary/50 text-xs sm:text-sm"
          />
        </div>

        {loading && locks.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading locks...
          </div>
        ) : filteredLocks.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-studio-border rounded-lg px-4">
            <Lock className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground/20 mx-auto mb-2 sm:mb-3" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              {search ? "No locks matching your search." : "No active locks."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedLocks).map(([pidStr, sessionLocks]) => {
              const pid = Number(pidStr);
              const firstLock = sessionLocks[0];
              const hasBlocked = sessionLocks.some((l) => !l.granted);

              return (
                <div
                  key={pid}
                  className={cn(
                    "bg-background/40 border rounded-lg",
                    hasBlocked
                      ? "border-red-500/30 bg-red-500/[0.02]"
                      : "border-studio-border",
                  )}
                >
                  <div className="flex items-center justify-between p-3 border-b border-studio-border/50">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        PID {pid}
                      </span>
                      {hasBlocked && (
                        <Badge
                          variant="secondary"
                          className="bg-red-500/10 text-red-500 border-none text-xs h-4 px-1.5"
                        >
                          Blocked
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {firstLock.usename} @{" "}
                        {firstLock.application_name || "?"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      disabled={killingPid === pid}
                      onClick={() => handleKillSession(pid)}
                    >
                      {killingPid === pid ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Lock className="w-3 h-3 mr-1" />
                      )}
                      Kill
                    </Button>
                  </div>

                  <div className="divide-y divide-studio-border/30">
                    {sessionLocks.map((lock, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 flex items-center gap-3 text-xs"
                      >
                        <Badge
                          variant="outline"
                          className={cn(
                            "border text-xs h-5 px-1.5 font-mono shrink-0",
                            modeColor(lock.mode),
                          )}
                        >
                          {lock.mode}
                        </Badge>
                        <span className="text-muted-foreground font-mono shrink-0 w-20">
                          {lock.locktype}
                        </span>
                        <span className="text-foreground font-mono truncate min-w-0 flex-1">
                          {lock.relation_name ||
                            lock.transactionid ||
                            lock.virtualtransaction ||
                            "-"}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-none text-xs h-4 px-1.5 shrink-0",
                            lock.granted
                              ? "text-emerald-500 bg-emerald-500/10"
                              : "text-red-500 bg-red-500/10",
                          )}
                        >
                          {lock.granted ? "Granted" : "Waiting"}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {firstLock.query && (
                    <div className="px-3 py-2 border-t border-studio-border/30">
                      <pre className="text-xs font-mono text-foreground/60 whitespace-pre-wrap break-all max-h-12 overflow-y-auto">
                        {firstLock.query.length > 300
                          ? firstLock.query.slice(0, 300) + "..."
                          : firstLock.query}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground text-center pt-2">
              Auto-refreshes every 10s &middot; {locks.length} lock
              {locks.length !== 1 ? "s" : ""} across{" "}
              {Object.keys(groupedLocks).length} session
              {Object.keys(groupedLocks).length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
