"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeTypes,
  type EdgeTypes,
  type OnConnect,
  type OnReconnect,
  Handle,
  Position,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { NODE_REGISTRY_MAP, getNodeIcon } from "@/lib/workflows/node-registry";
import { hexAlpha } from "@/lib/studio/themes/color-utils";
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WfNode = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
};

export type WfEdge = {
  id: string;
  source: string;
  target: string;
};

type NodeStatus = Record<string, "success" | "error" | "running" | null>;

type CustomNodeData = {
  wfNode: WfNode;
  isSelected: boolean;
  status: NodeStatus[string];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

function WorkflowNodeCard({ data }: { data: CustomNodeData }) {
  const { wfNode, isSelected, status, onSelect, onDelete } = data;
  const def = NODE_REGISTRY_MAP.get(wfNode.type);
  const Icon = getNodeIcon(def?.icon ?? "");
  const color = def?.color ?? "#6b7280";

  return (
    <div
      onClick={() => onSelect(wfNode.id)}
      className={cn(
        "group relative min-w-[180px] cursor-pointer rounded-xl border-2 bg-card shadow-md transition-colors",
        isSelected ? "border-primary" : "border-border hover:border-primary/40",
        status === "success" && "border-green-500/70",
        status === "error" && "border-red-500/70",
        status === "running" && "border-blue-500/70 animate-pulse",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-3 !border-2 !border-border !bg-background" />

      <div className="p-3">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md border text-white shadow-sm"
            style={{
              background: `linear-gradient(145deg, ${color} 0%, ${hexAlpha(color, 0.72)} 100%)`,
              borderColor: hexAlpha(color, 0.55),
            }}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold leading-tight">{wfNode.name}</div>
            <div className="truncate text-[10px] text-muted-foreground leading-tight">
              {def?.name ?? wfNode.type}
            </div>
          </div>
          {status === "success" && <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />}
          {status === "error" && <AlertCircle className="size-3.5 shrink-0 text-red-500" />}
          {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />}
        </div>

        {!def?.implemented && (
          <div className="mt-1.5 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[9px] text-yellow-600 dark:text-yellow-400">
            Not yet implemented
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(wfNode.id); }}
        className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
      >
        <Trash2 className="size-3" />
      </button>

      <Handle type="source" position={Position.Bottom} className="!size-3 !border-2 !border-border !bg-background" />
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  workflowNode: WorkflowNodeCard as any,
};

type DeletableEdgeData = { onDelete: (id: string) => void };

function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const onDelete = (data as DeletableEdgeData | undefined)?.onDelete;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, zIndex: 1000, pointerEvents: "all" }}
          className="nodrag nopan absolute"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
            title="Remove connection"
            className="flex size-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES: EdgeTypes = {
  deletable: DeletableEdge,
};

type Props = {
  nodes: WfNode[];
  edges: WfEdge[];
  onChange: (nodes: WfNode[]) => void;
  onEdgesUpdate: (edges: WfEdge[]) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onAddNode: () => void;
  nodeStatuses: NodeStatus;
};

const SPACING_X = 250;
const SPACING_Y = 140;
const PER_ROW = 3;

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({
  nodes: wfNodes,
  edges: wfEdges,
  onChange,
  onEdgesUpdate,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  nodeStatuses,
}: Props) {
  const { fitView } = useReactFlow();
  const prevNodeCount = useRef(wfNodes.length);

  // Keep newly added nodes in view - React Flow's `fitView` prop only runs
  // once on mount, so a node added later can land off-screen otherwise.
  useEffect(() => {
    const increased = wfNodes.length > prevNodeCount.current;
    prevNodeCount.current = wfNodes.length;
    if (!increased) return;
    const raf = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    return () => cancelAnimationFrame(raf);
  }, [wfNodes.length, fitView]);

  const onDelete = useCallback(
    (id: string) => {
      onChange(wfNodes.filter((n) => n.id !== id));
      onEdgesUpdate(wfEdges.filter((e) => e.source !== id && e.target !== id));
      if (selectedNodeId === id) onSelectNode(null);
    },
    [wfNodes, wfEdges, selectedNodeId, onChange, onEdgesUpdate, onSelectNode],
  );

  const onDeleteEdge = useCallback(
    (id: string) => onEdgesUpdate(wfEdges.filter((e) => e.id !== id)),
    [wfEdges, onEdgesUpdate],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState<Edge>([]);

  // Reconcile the workflow's node list into React Flow's managed node state:
  // update existing nodes' `data` in place (add/remove only what changed) so
  // React Flow keeps its internally-tracked position/measurement per node -
  // replacing the array wholesale on every render was resetting that tracking
  // and left nodes permanently stuck at `visibility: hidden`.
  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((n) => [n.id, n]));
      let placedCount = current.length;
      return wfNodes.map((wn) => {
        const data: CustomNodeData = {
          wfNode: wn,
          isSelected: wn.id === selectedNodeId,
          status: nodeStatuses[wn.id] ?? null,
          onSelect: onSelectNode,
          onDelete,
        };
        const existing = currentById.get(wn.id);
        if (existing) return { ...existing, data };
        const i = placedCount++;
        const position = wn.position ?? { x: (i % PER_ROW) * SPACING_X, y: Math.floor(i / PER_ROW) * SPACING_Y };
        return { id: wn.id, type: "workflowNode", position, data };
      });
    });
  }, [wfNodes, selectedNodeId, nodeStatuses, onSelectNode, onDelete, setNodes]);

  // Edges are fully derived from wfEdges + status each render - unlike nodes,
  // they carry no independent transient state worth preserving across rebuilds.
  useEffect(() => {
    setFlowEdges(
      wfEdges.map((we) => ({
        id: we.id,
        source: we.source,
        target: we.target,
        type: "deletable",
        animated: nodeStatuses[we.source] === "running",
        style: {
          stroke: nodeStatuses[we.source] === "success" ? "#22c55e"
            : nodeStatuses[we.source] === "error" ? "#ef4444"
              : "var(--border)",
          strokeWidth: 2,
        },
        data: { onDelete: onDeleteEdge } satisfies DeletableEdgeData,
      })),
    );
  }, [wfEdges, nodeStatuses, onDeleteEdge, setFlowEdges]);

  // Attach: drag from one node's handle to another's to create a new connection.
  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target) return;
      const exists = wfEdges.some((e) => e.source === connection.source && e.target === connection.target);
      if (exists) return;
      onEdgesUpdate([...wfEdges, { id: `e-${connection.source}-${connection.target}-${Date.now()}`, source: connection.source, target: connection.target }]);
    },
    [wfEdges, onEdgesUpdate],
  );

  // Reconnect: drag an existing connection's endpoint onto a different node to
  // re-attach it there, or drop it on empty canvas to detach it entirely.
  const reconnectSucceeded = useRef(true);
  const onReconnectStart = useCallback(() => { reconnectSucceeded.current = false; }, []);
  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      reconnectSucceeded.current = true;
      if (!newConnection.source || !newConnection.target) return;
      onEdgesUpdate(
        wfEdges.map((e) => (e.id === oldEdge.id ? { ...e, source: newConnection.source!, target: newConnection.target! } : e)),
      );
    },
    [wfEdges, onEdgesUpdate],
  );
  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      if (!reconnectSucceeded.current) onEdgesUpdate(wfEdges.filter((e) => e.id !== edge.id));
      reconnectSucceeded.current = true;
    },
    [wfEdges, onEdgesUpdate],
  );

  // Persist a node's new position once it's dropped, so layout survives reload.
  const onNodeDragStop = useCallback(
    (_event: unknown, draggedNode: Node) => {
      onChange(wfNodes.map((n) => (n.id === draggedNode.id ? { ...n, position: draggedNode.position } : n)));
    },
    [wfNodes, onChange],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onFlowEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { strokeWidth: 2 },
        }}
      >
        <Background gap={16} color="var(--border)" />
        <Controls className="[&_button]:border-border [&_button]:bg-card" />
        <MiniMap
          className="!border-border !bg-card"
          nodeColor={(n: any) => {
            const def = NODE_REGISTRY_MAP.get(n.data?.wfNode?.type ?? "");
            return def?.color ?? "#6b7280";
          }}
        />
        <Panel position="top-right">
          <Button size="sm" variant="secondary" onClick={onAddNode} className="gap-1.5 shadow-md">
            <Plus className="size-3.5" />
            Add Node
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
