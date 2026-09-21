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

function CreateWorkflowSheet({
  open,
  onOpenChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="workflow-description" className="text font-medium">
              Description (optional)
            </label>
            <Textarea
              id="workflow-description"
              placeholder="Describe what this workflow does..."
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={!name.trim() || creating}>
            {creating ? (
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
  );
}

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

  const createSheet = (
    <CreateWorkflowSheet
      open={createDialogOpen}
      onOpenChange={setCreateDialogOpen}
      name={newWorkflowName}
      onNameChange={setNewWorkflowName}
      description={newWorkflowDescription}
      onDescriptionChange={setNewWorkflowDescription}
      creating={isCreating}
      onCreate={() => void handleCreateWorkflow()}
    />
  );

  if (notFound || !workflow) {
    return (
      <>
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
        {createSheet}
      </>
    );
  }

  return (
    <>
      <WorkflowEditor
        workflow={workflow}
        onSaved={(updated) => setWorkflow((prev) => (prev ? { ...prev, ...updated } : updated))}
      />
      {createSheet}
    </>
  );
}
