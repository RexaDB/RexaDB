"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Workflow, Plus } from "lucide-react";
import { getWorkflow, createWorkflow } from "@/lib/api/actions-client";
import { WorkflowEditor } from "./workflow-editor";
import type { WorkflowRow } from "./workflow-types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function WorkflowView({ workflowId, connectionId }: { workflowId?: string; connectionId?: number }) {
  const [workflow, setWorkflow] = useState<WorkflowRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowDescription, setNewWorkflowDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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

  const handleCreateWorkflow = async () => {
    if (!newWorkflowName.trim() || !connectionId) return;
    setIsCreating(true);
    try {
      const res = await createWorkflow({
        name: newWorkflowName,
        connectionId,
        description: newWorkflowDescription,
        nodes: [],
        edges: [],
      });
      if (res.success && res.data) {
        setWorkflow(res.data);
        setCreateDialogOpen(false);
        setNewWorkflowName("");
        setNewWorkflowDescription("");
      }
    } catch (error) {
      console.error("Failed to create workflow:", error);
    } finally {
      setIsCreating(false);
    }
  };

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
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreateDialogOpen(true)}
          className="gap-2"
        >
          <Plus className="size-4" />
          Create New Workflow
        </Button>
      </div>
    );
  }

  return (
    <>
      <WorkflowEditor
        workflow={workflow}
        onSaved={(updated) => setWorkflow((prev) => (prev ? { ...prev, ...updated } : updated))}
      />
      <Sheet open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Create New Workflow</SheetTitle>
            <SheetDescription>
              Create a new workflow to automate database tasks and processes.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="workflow-name" className="text-sm font-medium">
                Workflow Name
              </label>
              <Input
                id="workflow-name"
                placeholder="My Workflow"
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="workflow-description" className="text font-medium">
                Description (optional)
              </label>
              <Textarea
                id="workflow-description"
                placeholder="Describe what this workflow does..."
                value={newWorkflowDescription}
                onChange={(e) => setNewWorkflowDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateWorkflow}
              disabled={!newWorkflowName.trim() || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                "Create Workflow"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
