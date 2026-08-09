"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FileText, CheckCircle2, XCircle, Clock, Filter } from "@/lib/icon-theme/lucide-react";
import { studioApi } from "@/lib/studio-backend/api-client";
import { toast } from "sonner";
import {
  LogLoadingState,
  LogTable,
  LogUserCell,
  LogPageLayout,
} from "@/components/team/log-utils";
import type {
  ApiResponse,
  Connection,
  PendingQuery,
  PendingQueryStatus,
} from "@/lib/studio-backend/types";

type ViewFilter = "all" | "mine";

export function PendingQueryList({
  userId,
  onCountChange,
}: {
  userId?: string;
  onCountChange?: (count: number) => void;
}) {
  const [queries, setQueries] = useState<PendingQuery[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConnId, setSelectedConnId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<PendingQueryStatus | "all">("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [confirmAction, setConfirmAction] = useState<{
    type: "approve" | "reject";
    query: PendingQuery;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  const applySortedQueries = useCallback((allQueries: PendingQuery[], count: number) => {
    allQueries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setQueries(allQueries);
    setPendingCount(count);
    onCountChangeRef.current?.(count);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const connRes = await studioApi.get<ApiResponse<Connection[]>>("/connections");
        const conns = connRes.data || [];
        if (cancelled) return;
        setConnections(conns);

        const allQueries: PendingQuery[] = [];
        let count = 0;
        for (const conn of conns) {
          try {
            const res = await studioApi.get<ApiResponse<PendingQuery[]>>(
              `/connections/${conn.id}/pending-queries`,
            );
            if (cancelled) return;
// fallow-ignore-next-line code-duplication
            const items = (res.data || []).map((q) => ({
              ...q,
              connection: conn,
            }));
            allQueries.push(...items);
            count += items.filter((q) => q.status === "PENDING").length;
          } catch {
            // skip connections without access
          }
        }
        if (cancelled) return;
        applySortedQueries(allQueries, count);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Failed to load pending queries",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = () => {
    setLoading(true);
    studioApi.get<ApiResponse<Connection[]>>("/connections").then((connRes) => {
      const conns = connRes.data || [];
      setConnections(conns);
      const allQueries: PendingQuery[] = [];
      let count = 0;
      const promises = conns.map(async (conn) => {
        try {
          const res = await studioApi.get<ApiResponse<PendingQuery[]>>(
            `/connections/${conn.id}/pending-queries`,
          );
// fallow-ignore-next-line code-duplication
          const items = (res.data || []).map((q) => ({
            ...q,
            connection: conn,
          }));
          allQueries.push(...items);
          count += items.filter((q) => q.status === "PENDING").length;
        } catch {
          // skip
        }
      });
      Promise.all(promises).then(() => {
        applySortedQueries(allQueries, count);
        setLoading(false);
      });
    }).catch(() => setLoading(false));
  };

  async function handleAction() {
    if (!confirmAction) return;
    const { type, query } = confirmAction;
    setActionLoading(true);
    try {
      const endpoint =
        type === "approve"
          ? `/connections/${query.connectionId}/pending-queries/${query.id}/approve`
          : `/connections/${query.connectionId}/pending-queries/${query.id}/reject`;
      await studioApi.post(endpoint);
      toast.success(
        type === "approve" ? "Query approved and executed" : "Query rejected",
      );
      setConfirmAction(null);
      reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Action failed",
      );
    } finally {
      setActionLoading(false);
    }
  }

  const filteredQueries = queries.filter((q) => {
    if (selectedConnId !== "all" && q.connectionId !== selectedConnId) return false;
    if (statusFilter !== "all" && q.status !== statusFilter) return false;
    if (viewFilter === "mine" && userId && q.requestedBy !== userId) return false;
    return true;
  });

  const statusBadge = (status: PendingQueryStatus) => {
    switch (status) {
      case "PENDING":
        return (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-500/30"
          >
            <Clock className="w-3 h-3 mr-0.5" /> Pending
          </Badge>
        );
      case "APPROVED":
        return (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-600 border-green-500/30"
          >
            <CheckCircle2 className="w-3 h-3 mr-0.5" /> Approved
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 bg-red-500/10 text-red-600 border-red-500/30"
          >
            <XCircle className="w-3 h-3 mr-0.5" /> Rejected
          </Badge>
        );
    }
  };

  const canApprove = (q: PendingQuery) => q.status === "PENDING";

  if (loading) return <LogLoadingState loading />;

  return (
    <LogPageLayout
      title="Pending Queries"
      description="Review and approve queries submitted for execution"
      emptyIcon={FileText}
      emptyText="No pending queries"
      isEmpty={filteredQueries.length === 0}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-studio-border">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Select
          value={selectedConnId}
          onValueChange={setSelectedConnId}
        >
          <SelectTrigger className="w-44 h-7 text-xs">
            <SelectValue placeholder="All connections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All connections</SelectItem>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PendingQueryStatus | "all")}
        >
          <SelectTrigger className="w-28 h-7 text-xs">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant={viewFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setViewFilter("all")}
          >
            All
          </Button>
          <Button
            variant={viewFilter === "mine" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setViewFilter("mine")}
          >
            My requests
          </Button>
        </div>
      </div>
      <LogTable
        headers={["Created", "Connection", "Query", "Requester", "Status", "Actions"]}
      >
        {filteredQueries.map((q) => (
          <tr key={q.id} className="hover:bg-studio-bg/80">
            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
              {new Date(q.createdAt).toLocaleString()}
            </td>
            <td className="px-4 py-2.5 text-xs text-muted-foreground">
              {q.connection?.name ?? "—"}
            </td>
            <td className="px-4 py-2.5 max-w-[300px] truncate font-mono text-xs">
              {q.sql}
            </td>
            <td className="px-4 py-2.5">
              <LogUserCell user={q.requestedByUser} />
            </td>
            <td className="px-4 py-2.5">{statusBadge(q.status)}</td>
            <td className="px-4 py-2.5">
              {canApprove(q) ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-500/10"
                    onClick={() =>
                      setConfirmAction({ type: "approve", query: q })
                    }
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10"
                    onClick={() =>
                      setConfirmAction({ type: "reject", query: q })
                    }
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    Reject
                  </Button>
                </div>
              ) : q.approvedByUser ? (
                <span className="text-xs text-muted-foreground">
                  by {q.approvedByUser.name}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </LogTable>

      <AlertDialog
        open={!!confirmAction}
        onOpenChange={() => setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "approve"
                ? "Approve Query"
                : "Reject Query"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "approve"
                ? "This will execute the query against the database."
                : "The query will be discarded without execution."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmAction && (
            <div className="rounded-md bg-studio-bg/50 border border-studio-border p-3 font-mono text-xs max-h-32 overflow-y-auto">
              {confirmAction.query.sql}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              disabled={actionLoading}
              className={
                confirmAction?.type === "reject"
                  ? "bg-destructive hover:bg-destructive/90"
                  : ""
              }
            >
              {actionLoading
                ? "Processing..."
                : confirmAction?.type === "approve"
                  ? "Approve & Execute"
                  : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LogPageLayout>
  );
}
