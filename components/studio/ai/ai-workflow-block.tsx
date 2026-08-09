"use client";

import { Loader2, PlusSquare, Workflow } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import type { AgentWorkflowPlan } from "@/lib/ai/types";

export function AiWorkflowBlock({
  plan,
  onApplyWorkflow,
  busy = false,
}: {
  plan: AgentWorkflowPlan;
  onApplyWorkflow: (plan: AgentWorkflowPlan) => void;
  busy?: boolean;
}) {
  const name = plan.name?.trim() || "Untitled Workflow";
  const nodeCount = plan.nodes.length;
  const nodeSummary =
    nodeCount > 0 ? plan.nodes.map((node) => node.type).join(" → ") : "No nodes";
  const applyLabel = plan.workflowId ? "Update Workflow" : "Create Workflow";
  const disabled = busy || nodeCount === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{name}</span>
        </div>

        <span className="text-xs text-muted-foreground">
          {nodeCount} node{nodeCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="truncate text-xs text-muted-foreground">{nodeSummary}</p>

        <Button
          className="h-8 gap-1.5 px-3 text-xs"
          disabled={disabled}
          onClick={() => onApplyWorkflow(plan)}
          variant="outline"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlusSquare className="h-3.5 w-3.5" />
          )}
          {busy ? "Applying…" : applyLabel}
        </Button>
      </div>
    </div>
  );
}
