"use client";

import {
  Search,
  Terminal,
  RefreshCw,
  XCircle,
  Ban,
  Loader2,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Session {
  pid: number;
  database: string;
  username: string;
  application_name: string;
  client_addr: string | null;
  client_port: number | null;
  state: string;
  query: string;
  query_start: string;
  wait_event_type: string | null;
  wait_event: string | null;
  backend_type: string;
  state_change: string;
}

interface SessionsListProps {
  connectionString: string;
}

export function SessionsList({ connectionString }: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionPid, setActionPid] = useState<number | null>(null);
  const [actionType, setActionType] = useState<"kill" | "cancel" | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { fetchSessions } = await import("@/lib/api/actions-client");
      const res = await fetchSessions(connectionString);
      if (res.success && Array.isArray(res.data)) {
        setSessions(res.data);
      } else {
        toast.error(res.error || "Failed to load sessions");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 15000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  const handleAction = async (pid: number, action: "kill" | "cancel") => {
    setActionPid(pid);
    try {
      const { killSession, cancelSessionQuery } =
        await import("@/lib/api/actions-client");
      const res =
        action === "kill"
          ? await killSession(connectionString, pid)
          : await cancelSessionQuery(connectionString, pid);
      if (res.success) {
        toast.success(
          action === "kill"
            ? `Session ${pid} terminated`
            : `Query on session ${pid} cancelled`,
        );
        loadSessions();
      } else {
        toast.error(res.error || `Failed to ${action} session`);
      }
    } catch (e: any) {
      toast.error(e.message || `Failed to ${action} session`);
    } finally {
      setActionPid(null);
      setActionType(null);
    }
  };

  const filteredSessions = sessions.filter(
    (s) =>
      s.query?.toLowerCase().includes(search.toLowerCase()) ||
      s.username?.toLowerCase().includes(search.toLowerCase()) ||
      s.database?.toLowerCase().includes(search.toLowerCase()) ||
      String(s.pid).includes(search),
  );

  const stateColor = (state: string) => {
    switch (state) {
      case "active":
        return "text-emerald-500 bg-emerald-500/10";
      case "idle":
        return "text-muted-foreground bg-muted/30";
      case "idle in transaction":
        return "text-amber-500 bg-amber-500/10";
      case "idle in transaction (aborted)":
        return "text-red-500 bg-red-500/10";
      case "fastpath function call":
        return "text-blue-500 bg-blue-500/10";
      case "disabled":
        return "text-muted-foreground bg-muted/30";
      default:
        return "text-muted-foreground bg-muted/30";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-studio-bg">
      <div className="max-w-6xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-sm sm:text-sm font-bold text-foreground tracking-tight">
              Sessions
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Active database sessions. Monitor and manage running queries.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSessions}
            disabled={loading}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="relative group w-full sm:max-w-md">
          <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Search by PID, username, database, or query..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 sm:pl-10 h-9 sm:h-10 bg-background/50 border-studio-border focus-visible:ring-primary/50 text-xs sm:text-sm"
          />
        </div>

        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading sessions...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-studio-border rounded-lg px-4">
            <Terminal className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground/20 mx-auto mb-2 sm:mb-3" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              {search
                ? "No sessions matching your search."
                : "No active sessions found."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSessions.map((session) => (
              <div
                key={session.pid}
                className="bg-background/40 border border-studio-border rounded-lg p-3 sm:p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-foreground shrink-0">
                      PID {session.pid}
                    </span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-none text-xs h-4 px-1.5 font-normal",
                        stateColor(session.state),
                      )}
                    >
                      {session.state || "unknown"}
                    </Badge>
                    {session.wait_event_type && (
                      <Badge
                        variant="outline"
                        className="text-xs h-4 px-1.5 font-normal text-amber-500 border-amber-500/30"
                      >
                        {session.wait_event_type}: {session.wait_event}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
                      disabled={actionPid === session.pid}
                      onClick={() => {
                        setActionType("cancel");
                        handleAction(session.pid, "cancel");
                      }}
                      title="Cancel query"
                    >
                      {actionPid === session.pid && actionType === "cancel" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Ban className="w-3 h-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      disabled={actionPid === session.pid}
                      onClick={() => {
                        setActionType("kill");
                        handleAction(session.pid, "kill");
                      }}
                      title="Terminate session"
                    >
                      {actionPid === session.pid && actionType === "kill" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">User</span>
                    <p className="font-medium text-foreground truncate">
                      {session.username}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Database</span>
                    <p className="font-medium text-foreground truncate">
                      {session.database}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Client</span>
                    <p className="font-medium text-foreground truncate font-mono">
                      {session.client_addr || "local"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Started</span>
                    <p className="font-medium text-foreground truncate">
                      {session.query_start
                        ? new Date(session.query_start).toLocaleString()
                        : "-"}
                    </p>
                  </div>
                </div>

                {session.query && (
                  <div className="pt-1">
                    <p className="text-xs text-muted-foreground mb-1">Query</p>
                    <pre className="text-xs font-mono bg-muted/20 p-2 rounded-lg overflow-x-auto max-h-20 text-foreground/80 whitespace-pre-wrap break-all">
                      {session.query.length > 500
                        ? session.query.slice(0, 500) + "..."
                        : session.query}
                    </pre>
                  </div>
                )}
              </div>
            ))}

            <p className="text-xs text-muted-foreground text-center pt-2">
              Auto-refreshes every 15s &middot; {sessions.length} session
              {sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      <AlertDialog
        open={!!actionType && actionPid !== null}
        onOpenChange={(open) => {
          if (!open) setActionType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === "kill" ? "Terminate Session" : "Cancel Query"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === "kill"
                ? `Are you sure you want to terminate session ${actionPid}? This will forcefully disconnect the session and roll back any open transaction.`
                : `Cancel the currently running query on session ${actionPid}?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                actionType === "kill"
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-amber-600 hover:bg-amber-500"
              }
              onClick={() =>
                actionPid !== null &&
                actionType &&
                handleAction(actionPid, actionType)
              }
            >
              {actionType === "kill" ? "Terminate" : "Cancel Query"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
