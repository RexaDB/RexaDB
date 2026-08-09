"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { toast } from "sonner";
import {
  Play,
  Save,
  Clock,
  Loader2,
} from "lucide-react";
import {
  updateWorkflow,
  runWorkflow,
} from "@/lib/api/actions-client";
import { WorkflowCanvas, type WfNode, type WfEdge } from "./workflow-canvas";
import { NodeConfigPanel } from "./node-config-panel";
import { NodePalette } from "./node-palette";
import {
  ScheduleBuilder,
  describeVisualSchedule,
  parseStoredSchedule,
  validateVisual,
  visualToStored,
  type ScheduleType,
  type VisualSchedule,
} from "./schedule-builder";
import type { WorkflowRow } from "./workflow-types";

type NodeStatus = Record<string, "success" | "error" | "running" | null>;

type Props = {
  workflow: WorkflowRow;
  onSaved: (updated: WorkflowRow) => void;
};

let nodeSeq = 0;
function newNodeId() {
  return `node_${Date.now()}_${++nodeSeq}`;
}

function parseEdges(workflow: WorkflowRow, nodes: WfNode[]): WfEdge[] {
  try {
    const parsed = JSON.parse(workflow.edgesJson || "[]") as WfEdge[];
    if (parsed.length > 0 || nodes.length < 2) return parsed;
  } catch {}
  return nodes.slice(0, -1).map((n, i) => ({ id: `e-${n.id}-${nodes[i + 1].id}`, source: n.id, target: nodes[i + 1].id }));
}

export function WorkflowEditor({ workflow, onSaved }: Props) {
  const [name, setName] = useState(workflow.name);
  const [nodes, setNodes] = useState<WfNode[]>(() => {
    try { return JSON.parse(workflow.nodesJson) as WfNode[]; } catch { return []; }
  });
  const [edges, setEdges] = useState<WfEdge[]>(() => parseEdges(workflow, nodes));
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(workflow.scheduleEnabled));
  const [scheduleType, setScheduleType] = useState<ScheduleType>(workflow.scheduleType ?? "cron");
  const [scheduleValue, setScheduleValue] = useState(workflow.scheduleValue ?? "");

  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [draftVisual, setDraftVisual] = useState<VisualSchedule>(() =>
    parseStoredSchedule(workflow.scheduleType, workflow.scheduleValue),
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [nodeStatuses, setNodeStatuses] = useState<NodeStatus>({});

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const scheduleLabel = scheduleEnabled
    ? describeVisualSchedule(parseStoredSchedule(scheduleType, scheduleValue))
    : null;

  useEffect(() => {
    setName(workflow.name);
    setScheduleEnabled(Boolean(workflow.scheduleEnabled));
    setScheduleType(workflow.scheduleType ?? "cron");
    setScheduleValue(workflow.scheduleValue ?? "");
    let parsedNodes: WfNode[] = [];
    try { parsedNodes = JSON.parse(workflow.nodesJson) as WfNode[]; } catch {}
    setNodes(parsedNodes);
    setEdges(parseEdges(workflow, parsedNodes));
    setSelectedNodeId(null);
  }, [workflow.id]);

  function openScheduleDialog() {
    setDraftVisual(parseStoredSchedule(scheduleType, scheduleValue));
    setShowScheduleDialog(true);
  }

  function handleScheduleToggle(checked: boolean) {
    if (checked) {
      openScheduleDialog();
      return;
    }
    setScheduleEnabled(false);
    setShowScheduleDialog(false);
  }

  function handleScheduleDialogOpenChange(open: boolean) {
    // Only allow programmatic / cancel / X close — outside click is blocked on content
    // so Select menus inside the dialog don't dismiss the whole dialog.
    setShowScheduleDialog(open);
  }

  function handleSaveSchedule() {
    const error = validateVisual(draftVisual);
    if (error) {
      toast.error(error);
      return;
    }
    const stored = visualToStored(draftVisual);
    setScheduleType(stored.type);
    setScheduleValue(stored.value);
    setScheduleEnabled(true);
    setShowScheduleDialog(false);
  }


  async function performSave(finalName?: string) {
    setSaving(true);
    try {
      await updateWorkflow(workflow.id, {
        name: finalName ?? name,
        nodes,
        edges,
        scheduleEnabled,
        scheduleType: scheduleEnabled ? scheduleType : null,
        scheduleValue: scheduleEnabled ? scheduleValue : null,
      });
      if (finalName) setName(finalName);
      onSaved({
        ...workflow,
        name: finalName ?? name,
        nodesJson: JSON.stringify(nodes),
        edgesJson: JSON.stringify(edges),
        scheduleEnabled,
        scheduleType: scheduleEnabled ? scheduleType : null,
        scheduleValue: scheduleEnabled ? scheduleValue : null,
        updatedAt: Date.now(),
      });
      window.dispatchEvent(new CustomEvent("studio:workflow-saved", { detail: { workflowId: workflow.id, name: finalName ?? name } }));
      toast.success("Workflow saved");
    } catch {
      toast.error("Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setNodeStatuses({});
    try {
      const res = await runWorkflow(workflow.id, undefined, (event) => {
        if (event.type === "node-start") {
          setNodeStatuses((prev) => ({ ...prev, [event.nodeId]: "running" }));
        } else {
          setNodeStatuses((prev) => ({ ...prev, [event.nodeId]: event.skipped ? null : event.error ? "error" : "success" }));
        }
      }, { nodes, edges });
      if (res.success || res.data?.status === "success") {
        toast.success("Workflow completed successfully");
      } else {
        toast.error(res.data?.error || res.error || "Workflow failed");
      }
    } catch (e: any) {
      toast.error(e.message || "Run failed");
    } finally {
      setRunning(false);
    }
  }

  function addNode(type: string, nodeName: string, config: Record<string, unknown>) {
    const node: WfNode = { id: newNodeId(), type, name: nodeName, config };
    setNodes((prev) => [...prev, node]);
    const attachFrom = selectedNodeId ?? nodes[nodes.length - 1]?.id;
    if (attachFrom && !type.startsWith("trigger-")) {
      setEdges((prev) => [...prev, { id: `e-${attachFrom}-${node.id}`, source: attachFrom, target: node.id }]);
    }
    setSelectedNodeId(node.id);
  }

  function updateNode(updated: WfNode) {
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {scheduleEnabled && scheduleLabel && (
            <button
              type="button"
              onClick={openScheduleDialog}
              className="outline-none"
              title="Edit schedule"
            >
              <Badge
                variant="secondary"
                className="gap-1 text-[10px] cursor-pointer hover:bg-secondary/80"
              >
                <Clock className="size-2.5" />
                {scheduleLabel}
              </Badge>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Schedule toggle — opens setup dialog; only enables on dialog save */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              id="schedule-toggle-toolbar"
              checked={scheduleEnabled || showScheduleDialog}
              onCheckedChange={handleScheduleToggle}
              className="scale-75"
            />
            <button
              type="button"
              className="cursor-pointer select-none"
              onClick={() => {
                if (scheduleEnabled) openScheduleDialog();
                else handleScheduleToggle(true);
              }}
            >
              Schedule
            </button>
          </div>

          {/* Save */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => performSave()}
            disabled={saving}
            className="h-7 gap-1.5 text-xs"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save
          </Button>

          {/* Run */}
          <Button
            size="sm"
            onClick={handleRun}
            disabled={running || nodes.length === 0}
            className="h-7 gap-1.5 text-xs"
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Run
          </Button>
        </div>
      </div>

      {/* ── Canvas area (no tabs) ─────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <div className="rounded-full bg-muted p-4">
              <Play className="size-8 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No nodes yet</p>
            <p className="text-xs text-muted-foreground">Add nodes to build your workflow</p>
            <Button size="sm" onClick={() => setShowPalette(true)} className="gap-1.5">
              Add First Node
            </Button>
          </div>
        ) : (
          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            onChange={setNodes}
            onEdgesUpdate={setEdges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onAddNode={() => setShowPalette(true)}
            nodeStatuses={nodeStatuses}
          />
        )}

        {/* Node config side panel */}
        {selectedNode && (
          <div className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
            <NodeConfigPanel
              node={selectedNode}
              onChange={updateNode}
              onClose={() => setSelectedNodeId(null)}
            />
          </div>
        )}
      </div>

      {/* ── Schedule setup dialog ───────────────────────────────────── */}
      <Dialog open={showScheduleDialog} onOpenChange={handleScheduleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => {
            // Select / popover / calendar portals render outside the dialog.
            // Always prevent outside-dismiss so nested menus don't close the dialog.
            e.preventDefault();
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
          onFocusOutside={(e) => {
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Schedule workflow</DialogTitle>
            <DialogDescription>
              Choose how often this workflow should run. Schedule is only enabled
              after you save these settings.
            </DialogDescription>
          </DialogHeader>

          <div className="py-1">
            <ScheduleBuilder value={draftVisual} onChange={setDraftVisual} />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowScheduleDialog(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSchedule} className="gap-1.5">
              <Clock className="size-3.5" />
              Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Node palette dialog ──────────────────────────────────────── */}
      <Dialog open={showPalette} onOpenChange={setShowPalette}>
        <DialogContent
          hideCloseButton
          className="p-0 max-w-none sm:max-w-none w-auto border-0 rounded-xl bg-transparent shadow-none"
        >
          <DialogTitle className="sr-only">Add node</DialogTitle>
          <NodePalette
            onSelect={addNode}
            onClose={() => setShowPalette(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
