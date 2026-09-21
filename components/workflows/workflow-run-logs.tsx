"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  ScrollText,
  Terminal,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getWorkflowRun,
  listWorkflowRuns,
  parseWorkflowRunOutputs,
  type WorkflowNodeLog,
  type WorkflowRunRow,
} from "@/lib/api/actions-client";

export function formatRunTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function formatDuration(run: WorkflowRunRow) {
  if (!run.startedAt) return "—";
  const end = run.finishedAt ?? Date.now();
  const ms = end - run.startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <CheckCircle2 className="size-3 text-green-600" />
        success
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <XCircle className="size-3" />
        error
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Loader2 className="size-3 animate-spin" />
      running
    </Badge>
  );
}

function NodeStatusDot({ entry }: { entry: WorkflowNodeLog }) {
  if (entry.error) return <XCircle className="size-3 shrink-0 text-destructive" />;
  if (entry.skipped) return <ChevronRight className="size-3 shrink-0 text-muted-foreground" />;
  return <CheckCircle2 className="size-3 shrink-0 text-green-600" />;
}

function NodeLogPane({ entry }: { entry: WorkflowNodeLog }) {
  const outputText = useMemo(() => {
    try {
      return JSON.stringify(entry.output, null, 2) ?? "null";
    } catch {
      return String(entry.output);
    }
  }, [entry.output]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{entry.nodeName}</span>
        <Badge variant="outline" className="text-[10px]">{entry.nodeType}</Badge>
        {entry.skipped ? (
          <Badge variant="outline" className="text-[10px]">skipped</Badge>
        ) : entry.error ? (
          <Badge variant="destructive" className="text-[10px]">failed</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">ok</Badge>
        )}
        <span className="text-[11px] tabular-nums text-muted-foreground">{entry.durationMs}ms</span>
      </div>

      {entry.error && (
        <div className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {entry.error}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Terminal className="size-3" />
          Logs
        </div>
        {entry.logs.length > 0 ? (
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {entry.logs.join("\n")}
          </pre>
        ) : (
          <p className="text-[11px] text-muted-foreground">No logs for this node in this run.</p>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Output
        </div>
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {outputText}
        </pre>
      </div>
    </div>
  );
}

function NodeLogCard({ entry }: { entry: WorkflowNodeLog }) {
  const [expanded, setExpanded] = useState(Boolean(entry.error));
  const outputText = useMemo(() => {
    try {
      return JSON.stringify(entry.output, null, 2) ?? "null";
    } catch {
      return String(entry.output);
    }
  }, [entry.output]);

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {entry.error ? (
          <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        ) : entry.skipped ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {entry.nodeName}
          <span className="ml-1.5 font-normal text-muted-foreground">{entry.nodeType}</span>
        </span>
        {entry.skipped && <span className="text-[10px] text-muted-foreground">skipped</span>}
        <span className="text-[10px] tabular-nums text-muted-foreground">{entry.durationMs}ms</span>
        <ChevronRight
          className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")}
        />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {entry.error && (
            <div className="rounded bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {entry.error}
            </div>
          )}
          {entry.logs.length > 0 ? (
            <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {entry.logs.join("\n")}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground">No logs for this node.</p>
          )}
          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {outputText}
          </pre>
        </div>
      )}
    </div>
  );
}

function useWorkflowRuns(workflowId: string, refreshKey: number, enabled: boolean) {
  const [runs, setRuns] = useState<WorkflowRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowRunRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWorkflowRuns(workflowId, 30);
      if (res.success && res.data) {
        setRuns(res.data);
        setSelectedId((prev) => {
          if (prev && res.data!.some((r) => r.id === prev)) return prev;
          return res.data!.length > 0 ? res.data![0].id : null;
        });
      }
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (enabled) void loadRuns();
  }, [enabled, workflowId, refreshKey, loadRuns]);

  useEffect(() => {
    if (!enabled || !selectedId) {
      if (!selectedId) setDetail(null);
      return;
    }
    const fromList = runs.find((r) => r.id === selectedId) ?? null;
    setDetail(fromList);
    setDetailLoading(true);
    getWorkflowRun(workflowId, selectedId)
      .then((res) => {
        if (res.success && res.data) setDetail(res.data);
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [enabled, selectedId, workflowId, runs]);

  const detailOutputs = useMemo(() => parseWorkflowRunOutputs(detail), [detail]);

  return { runs, loading, loadRuns, selectedId, setSelectedId, detail, detailLoading, detailOutputs };
}

// ─── Inline tabbed logs view ────────────────────────────────────────────
// Layout: left column = run timestamps, right = per-node tabs (All + one
// tab per node) with that node's logs + output for the selected run.

export function WorkflowLogsView({
  workflowId,
  refreshKey,
  running,
  liveOutputs,
  liveStatus,
}: {
  workflowId: string;
  refreshKey: number;
  running?: boolean;
  liveOutputs?: WorkflowNodeLog[] | null;
  liveStatus?: string | null;
}) {
  const { runs, loading, loadRuns, selectedId, setSelectedId, detail, detailLoading, detailOutputs } =
    useWorkflowRuns(workflowId, refreshKey, true);
  const [activeNodeId, setActiveNodeId] = useState<string>("all");

  // Reset node tab when switching runs.
  useEffect(() => {
    setActiveNodeId("all");
  }, [selectedId]);

  const allLogs = useMemo(
    () => detailOutputs.flatMap((o) => o.logs.map((line) => `[${o.nodeName}] ${line}`)),
    [detailOutputs],
  );
  const activeEntry = useMemo(
    () => detailOutputs.find((o) => o.nodeId === activeNodeId) ?? null,
    [detailOutputs, activeNodeId],
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Run timestamps ── */}
      <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Runs ({runs.length})
          </span>
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => void loadRuns()}>
            <RefreshCw className="size-3" />
            Refresh
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {running && (
            <div className="m-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-[11px]">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              Running now…
            </div>
          )}
          {loading && runs.length === 0 ? (
            <div className="flex items-center justify-center p-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <Play className="size-6 text-muted-foreground opacity-50" />
              <p className="text-xs text-muted-foreground">No runs yet.<br />Press Run to execute.</p>
            </div>
          ) : (
            <div className="p-1.5">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className={cn(
                    "mb-1 w-full rounded-md border px-2 py-1.5 text-left",
                    selectedId === run.id
                      ? "border-border bg-accent hover:bg-accent"
                      : "border-transparent hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <StatusBadge status={run.status} />
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {formatDuration(run)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium leading-tight">
                    {formatRunTime(run.startedAt)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{run.trigger}</div>
                  {run.error && (
                    <div className="mt-0.5 truncate text-[10px] text-destructive">{run.error}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Selected run + per-node tabs ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedId || !detail ? (
          <>
            <div className="h-10 shrink-0 border-b border-border" />
            <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
              Select a run to view per-node logs.
            </div>
          </>
        ) : (
          <>
            <div className="flex h-10 shrink-0 flex-wrap items-center gap-2 overflow-hidden border-b border-border px-3">
              <StatusBadge status={detail.status} />
              <Badge variant="outline" className="text-[10px]">{detail.trigger}</Badge>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="size-3" />
                {formatRunTime(detail.startedAt)} · {formatDuration(detail)}
              </span>
              {detailLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </div>

            {detail.error && (
              <div className="shrink-0 border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {detail.error}
              </div>
            )}

            {detailOutputs.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No node outputs recorded for this run.</p>
            ) : (
              <>
                {/* Node tabs */}
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveNodeId("all")}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-muted",
                      activeNodeId === "all" ? "bg-muted font-medium" : "text-muted-foreground",
                    )}
                  >
                    <ScrollText className="size-3" />
                    All logs
                  </button>
                  {detailOutputs.map((o) => (
                    <button
                      key={o.nodeId}
                      type="button"
                      onClick={() => setActiveNodeId(o.nodeId)}
                      title={`${o.nodeName} (${o.nodeType})`}
                      className={cn(
                        "flex max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-muted",
                        activeNodeId === o.nodeId ? "bg-muted font-medium" : "text-muted-foreground",
                      )}
                    >
                      <NodeStatusDot entry={o} />
                      <span className="truncate">{o.nodeName}</span>
                    </button>
                  ))}
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-3">
                    {activeNodeId === "all" ? (
                      <div className="space-y-2">
                        {allLogs.length > 0 && (
                          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                            {allLogs.join("\n")}
                          </pre>
                        )}
                        {detailOutputs.map((entry) => (
                          <NodeLogCard key={entry.nodeId} entry={entry} />
                        ))}
                      </div>
                    ) : activeEntry ? (
                      <NodeLogPane entry={activeEntry} />
                    ) : (
                      <p className="text-xs text-muted-foreground">Node not found in this run.</p>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </>
        )}

        {liveOutputs && liveOutputs.length > 0 && !running && (
          <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Showing persisted run above · last in-memory run: {liveStatus ?? "done"} ({liveOutputs.length} nodes)
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sheet variant (kept for backwards-compat) ──────────────────────────

type Props = {
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshKey: number;
  liveOutputs?: WorkflowNodeLog[] | null;
  liveStatus?: string | null;
  running?: boolean;
};

export function WorkflowRunLogs({ workflowId, open, onOpenChange, refreshKey, liveOutputs, liveStatus, running }: Props) {
  const { runs, loading, loadRuns, selectedId, setSelectedId, detail, detailLoading, detailOutputs } =
    useWorkflowRuns(workflowId, refreshKey, open);

  const allLogs = useMemo(
    () => detailOutputs.flatMap((o) => o.logs.map((line) => `[${o.nodeName}] ${line}`)),
    [detailOutputs],
  );
  const [showCombined, setShowCombined] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Run logs</SheetTitle>
          <SheetDescription>
            History of workflow executions with per-node logs and outputs.
          </SheetDescription>
        </SheetHeader>

        {running && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            Workflow is running… live logs will appear here when it finishes.
          </div>
        )}

        {liveOutputs && liveOutputs.length > 0 && !running && (
          <div className="mt-3 rounded-md border border-border">
            <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              Last run {liveStatus ? `· ${liveStatus}` : ""}
            </div>
            <ScrollArea className="max-h-56">
              <div className="space-y-2 p-3">
                {liveOutputs.map((entry) => (
                  <NodeLogCard key={entry.nodeId} entry={entry} />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="mt-3 flex min-h-0 flex-1 gap-3 overflow-hidden">
          <div className="flex w-44 shrink-0 flex-col overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">History</span>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void loadRuns()}>
                Refresh
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {loading && runs.length === 0 ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : runs.length === 0 ? (
                <p className="p-3 text-[11px] text-muted-foreground">No runs yet. Press Run to execute.</p>
              ) : (
                <div className="p-1.5">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedId(run.id)}
                      className={cn(
                        "mb-1 w-full rounded-md px-2 py-1.5 text-left hover:bg-muted",
                        selectedId === run.id && "bg-muted",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <StatusBadge status={run.status} />
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatDuration(run)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {formatRunTime(run.startedAt)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{run.trigger}</div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="min-w-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full max-h-[65vh] pr-1">
              {!selectedId || !detail ? (
                <p className="p-2 text-xs text-muted-foreground">Select a run to view its logs.</p>
              ) : detailLoading && detailOutputs.length === 0 ? (
                <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading logs…
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={detail.status} />
                    <Badge variant="outline" className="text-[10px]">{detail.trigger}</Badge>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="size-3" />
                      {formatRunTime(detail.startedAt)} · {formatDuration(detail)}
                    </span>
                  </div>
                  {detail.error && (
                    <div className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                      {detail.error}
                    </div>
                  )}
                  {detailOutputs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No node outputs recorded.</p>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1 text-[11px] text-muted-foreground"
                        onClick={() => setShowCombined((v) => !v)}
                      >
                        <ScrollText className="size-3" />
                        {showCombined ? "Hide combined logs" : `View combined logs (${allLogs.length})`}
                      </Button>
                      {showCombined && (
                        <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                          {allLogs.length > 0 ? allLogs.join("\n") : "No log lines recorded."}
                        </pre>
                      )}
                      <div className="space-y-2">
                        {detailOutputs.map((entry) => (
                          <NodeLogCard key={entry.nodeId} entry={entry} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
