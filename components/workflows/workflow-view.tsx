"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Workflow } from "lucide-react";
import { getWorkflow } from "@/lib/api/actions-client";
import { WorkflowEditor } from "./workflow-editor";
import type { WorkflowRow } from "./workflow-types";

export function WorkflowView({ workflowId }: { workflowId?: string }) {
  const [workflow, setWorkflow] = useState<WorkflowRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!workflowId) {
      setWorkflow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await getWorkflow(workflowId);
      if (res.success && res.data) {
        setWorkflow(res.data);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Workflow className="size-10 opacity-40" />
        <p className="text-sm font-medium">Workflow not found</p>
      </div>
    );
  }

  return (
    <WorkflowEditor
      workflow={workflow}
      onSaved={(updated) => setWorkflow((prev) => (prev ? { ...prev, ...updated } : updated))}
    />
  );
}
