"use client";

import { Check, Workflow } from "@/lib/icon-theme/lucide-react";

import type { AgentWorkflowPlan } from "@/lib/ai/types";

export function AiWorkflowBlock({
  plan,
  action,
}: {
  plan: AgentWorkflowPlan;
  action: "create" | "update";
}) {
  const name = plan.name?.trim() || "Untitled Workflow";
  const nodeCount = plan.nodes.length;
  const nodeSummary =
    nodeCount > 0 ? plan.nodes.map((node) => node.type).join(" → ") : "No nodes";

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

      <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-muted-foreground">
        <p className="truncate">{nodeSummary}</p>
        <span className="flex shrink-0 items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          {action === "update" ? "Updated" : "Created"}
        </span>
      </div>
    </div>
  );
}
