"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type NodeOutput = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  output: unknown;
  logs: string[];
  error?: string;
  durationMs: number;
  skipped?: boolean;
};

type WorkflowRun = {
  id: string;
  workflowId: string;
  status: "running" | "success" | "error";
  startedAt: number;
  finishedAt: number | null;
  nodesOutputJson: string | null;
  error: string | null;
  trigger: "manual" | "schedule";
};

type Props = {
  runs: WorkflowRun[];
  onRefresh: () => void;
};

export function WorkflowRunHistory({ runs, onRefresh }: Props) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Clock className="size-8 opacity-30" />
        <p className="text-sm">No runs yet</p>
        <p className="text-xs opacity-70">Run the workflow to see history here</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        {runs.map((run) => {
          const isExpanded = expandedRun === run.id;
          const duration = run.finishedAt ? run.finishedAt - run.startedAt : null;
          const nodeOutputs: NodeOutput[] = run.nodesOutputJson ? (() => { try { return JSON.parse(run.nodesOutputJson); } catch { return []; } })() : [];

          return (
            <div
              key={run.id}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              {/* Run header */}
              <button
                type="button"
                onClick={() => {
                  setExpandedRun(isExpanded ? null : run.id);
                  setExpandedNode(null);
                }}
                className="flex w-full items-center gap-2 p-3 text-left hover:bg-accent/50"
              >
                <StatusIcon status={run.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">
                      {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                    </span>
                    <Badge variant="secondary" className="h-4 text-[10px] px-1 py-0">
                      {run.trigger}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {duration !== null ? `${duration}ms` : "running..."} · {nodeOutputs.length} nodes
                    {run.error && ` · ${run.error.slice(0, 60)}`}
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {/* Expanded: per-node output */}
              {isExpanded && (
                <div className="border-t border-border p-2 space-y-1">
                  {nodeOutputs.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1">No node output recorded</p>
                  )}
                  {nodeOutputs.map((no) => {
                    const nodeKey = `${run.id}:${no.nodeId}`;
                    const isNodeExpanded = expandedNode === nodeKey;
                    return (
                      <div key={no.nodeId} className="overflow-hidden rounded-md border border-border">
                        <button
                          type="button"
                          onClick={() => setExpandedNode(isNodeExpanded ? null : nodeKey)}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/30"
                        >
                          <StatusIcon status={no.error ? "error" : "success"} size="sm" />
                          <span className="flex-1 truncate text-[11px] font-medium">{no.nodeName}</span>
                          <span className="text-[10px] text-muted-foreground">{no.durationMs}ms</span>
                          {isNodeExpanded ? (
                            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                        {isNodeExpanded && (
                          <div className="border-t border-border bg-muted/30 p-2 space-y-2">
                            {no.error && (
                              <div className="rounded bg-red-500/10 p-2 text-[10px] text-red-600 dark:text-red-400 font-mono">
                                {no.error}
                              </div>
                            )}
                            {no.logs.length > 0 && (
                              <div>
                                <div className="mb-0.5 text-[9px] font-semibold uppercase text-muted-foreground tracking-wider">Logs</div>
                                <div className="space-y-0.5">
                                  {no.logs.map((log, i) => (
                                    <div key={i} className="text-[10px] font-mono text-muted-foreground">{log}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div>
                              <div className="mb-0.5 text-[9px] font-semibold uppercase text-muted-foreground tracking-wider">Output</div>
                              <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-[10px] font-mono leading-relaxed">
                                {JSON.stringify(no.output, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function StatusIcon({ status, size = "default" }: { status: string; size?: "sm" | "default" }) {
  const cls = size === "sm" ? "size-3" : "size-4";
  if (status === "success") return <CheckCircle2 className={cn(cls, "text-green-500 shrink-0")} />;
  if (status === "error") return <AlertCircle className={cn(cls, "text-red-500 shrink-0")} />;
  return <Loader2 className={cn(cls, "text-blue-500 shrink-0 animate-spin")} />;
}
