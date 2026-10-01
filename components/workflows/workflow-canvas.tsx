"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  BackgroundVariant,
  Controls,
  type ColorMode,
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
import { useTheme } from "@/components/providers/theme-provider";
import { ChevronDown, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, X, TriangleAlert, Wand2 } from "lucide-react";
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

function categoryLabel(category: string | undefined, fallback: string): string {
  switch (category) {
    case "trigger": return "Triggers";
    case "database": return "Database";
    case "data": return "Data";
    case "code": return "Code";
    case "http": return "Requests";
    case "file": return "Files";
    case "flow": return "Flow";
    case "notify": return "Channels";
    case "ai": return "Agent";
    case "transform": return "Tools";
    case "utility": return "Memory";
    default: return fallback;
  }
}

function summarizeValue(value: unknown, max = 42): string {
  if (value === null || value === undefined || value === "") return "";
  let s: string;
  if (typeof value === "string") s = value;
  else if (typeof value === "number" || typeof value === "boolean") s = String(value);
  else {
    try { s = JSON.stringify(value); } catch { s = String(value); }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function getPreviewRows(wfNode: WfNode): string[] {
  const entries = Object.entries(wfNode.config ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  const rows = entries.map(([k, v]) => {
    if (isSensitiveField(k)) return `${k}: ••••••`;
    const text = summarizeValue(v);
    return text || k;
  }).filter(Boolean);
  return rows.slice(0, 5);
}

// Never render secrets on the canvas — API keys, tokens, passwords and
// webhook URLs stay in the configuration panel.
const SENSITIVE_FIELD_PATTERN = /\bkey\b|api[_-]?key|secret|token|passwd|password|auth|private[_-]?key|webhook[_-]?url|smtp[_-]?pass|headers?|account[_-]?sid/i;
function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(key);
}

function WorkflowNodeCard({ data }: { data: CustomNodeData }) {
  const { wfNode, isSelected, status, onSelect, onDelete } = data;
  const def = NODE_REGISTRY_MAP.get(wfNode.type);
  const Icon = getNodeIcon(def?.icon ?? "");
  const color = def?.color ?? "#71717a";

  const header = categoryLabel(def?.category, def?.name ?? wfNode.type);
  const rows = getPreviewRows(wfNode);
  const missingRequired = (def?.fields ?? []).some(
    (f) => f.required && (wfNode.config?.[f.key] === undefined || wfNode.config?.[f.key] === null || wfNode.config?.[f.key] === ""),
  );
  const needsSetup = missingRequired || !def?.implemented;

  // Collapsible card: header toggles the whole body, long row lists hide
  // behind a "Show N more" expander like the reference design.
  const [collapsed, setCollapsed] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const MAX_ROWS = 3;
  const visibleRows = showAllRows ? rows : rows.slice(0, MAX_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div
      onClick={() => onSelect(wfNode.id)}
      className={cn(
        "group relative w-[264px] cursor-pointer rounded-2xl border p-2 shadow-lg transition-colors",
        "border-border bg-card",
        isSelected && "border-dashed border-primary bg-primary/[0.06]",
        status === "success" && "border-green-500/60",
        status === "error" && "border-red-500/60",
        status === "running" && "animate-pulse border-blue-500/60",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-0"
        style={{ background: "var(--muted-foreground)", left: -3 }}
      />

      {/* header — click collapses / expands the body */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Expand" : "Collapse"}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 pb-1.5 pt-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{header}</span>
        {!def?.implemented ? (
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-blue-600 dark:text-blue-300">
            New
          </span>
        ) : needsSetup ? (
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600 dark:text-amber-300">
            <TriangleAlert className="size-3" />
            Set up
          </span>
        ) : null}
        {status === "success" && <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />}
        {status === "error" && <AlertCircle className="size-3.5 shrink-0 text-red-500" />}
        {status === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />}
      </button>

      {/* body */}
      {!collapsed && (
      <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
        {/* title block */}
        <div className="px-3 py-2.5">
          <div className="truncate text-[13px] font-semibold leading-tight text-foreground">{wfNode.name}</div>
          <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
            {def?.description ?? wfNode.type}
          </div>
        </div>

        {visibleRows.length > 0 && (
          <div className="divide-y divide-border border-t border-border">
            {visibleRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60"
                  style={{ color }}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/80">{row}</span>
              </div>
            ))}
          </div>
        )}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowAllRows(true); }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-muted-foreground">
              <ChevronDown className="size-3.5" />
            </span>
            <span>Show {hiddenCount} more</span>
          </button>
        )}
        {showAllRows && rows.length > MAX_ROWS && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowAllRows(false); }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60">
              <ChevronDown className="size-3.5 rotate-180" />
            </span>
            <span>Show less</span>
          </button>
        )}

        {!def?.implemented && (
          <div className="border-t border-border px-3 py-2 text-[11px] text-yellow-600 dark:text-yellow-400">
            Not yet implemented
          </div>
        )}
      </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(wfNode.id); }}
        className="absolute right-1.5 top-1.5 hidden rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
      >
        <Trash2 className="size-3" />
      </button>

      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-0"
        style={{ background: color, right: -3 }}
      />
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

const SPACING_X = 340;

// Estimated card height from content rows (worst case: all rows visible).
// Keeps expanded cards in the same layer from overlapping each other.
function estimateNodeHeight(wn: WfNode): number {
  const rows = getPreviewRows(wn).length;
  return Math.max(170, 120 + rows * 38);
}

export function getLayeredLayout(nodes: WfNode[], edges: WfEdge[]): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const out = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    out.set(id, []);
    indegree.set(id, 0);
  }
  for (const e of edges) {
    if (!out.has(e.source) || !indegree.has(e.target)) continue;
    out.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  // Longest-path depth via Kahn's topological pass.
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue: string[] = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  // Disconnected/cyclic fallback: seed with first node so every node gets placed.
  if (queue.length === 0 && ids.length > 0) queue.push(ids[0]);
  const visited = new Set<string>();
  const indeg = new Map(indegree);
  while (queue.length > 0) {
    // Stable order: process shallower, then insertion order.
    queue.sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || ids.indexOf(a) - ids.indexOf(b));
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of out.get(cur) ?? []) {
      const d = (depth.get(cur) ?? 0) + 1;
      if (d > (depth.get(next) ?? 0)) depth.set(next, d);
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if ((indeg.get(next) ?? 0) <= 0 && !visited.has(next)) queue.push(next);
    }
  }
  // Anything unvisited (cycle) goes on a new layer at the end.
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const id of ids) {
    if (!visited.has(id)) {
      maxDepth += 1;
      depth.set(id, maxDepth);
    }
  }
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(id);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
  // Order nodes within a layer by topology: parents' order first, then name.
  const orderIndex = new Map(ids.map((id, i) => [id, i]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Height-aware stacking: each layer reserves its tallest card + a gap,
  // so expanding a card ("show more") can't cover its neighbor.
  const LAYER_GAP = 90;
  for (const d of sortedDepths) {
    const layer = layers.get(d)!;
    layer.sort((a, b) => {
      const pa = edges.find((e) => e.target === a)?.source ?? "";
      const pb = edges.find((e) => e.target === b)?.source ?? "";
      const oa = pa ? (orderIndex.get(pa) ?? 0) : 0;
      const ob = pb ? (orderIndex.get(pb) ?? 0) : 0;
      if (oa !== ob) return oa - ob;
      return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
    });
    const heights = layer.map((id) => estimateNodeHeight(nodeById.get(id)!));
    const step = Math.max(...heights) + LAYER_GAP;
    const total = step * layer.length;
    layer.forEach((id, i) => {
      positions.set(id, {
        x: d * SPACING_X,
        y: -total / 2 + step * i + step / 2,
      });
    });
  }
  return positions;
}

function hasValidPosition(p: { x: number; y: number } | undefined): p is { x: number; y: number } {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// Cards overlap when their estimated boxes intersect.
export function hasOverlappingNodes(nodes: WfNode[]): boolean {
  const pts = nodes.map((n) => n.position);
  if (pts.some((p) => !hasValidPosition(p))) return false;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (Math.abs(a.x - b.x) < 300 && Math.abs(a.y - b.y) < 200) return true;
    }
  }
  return false;
}

// Returns tidied nodes, or null when the current arrangement should be left
// alone. Saved manual arrangements are preserved — untangles overlapping
// stacks wholesale, but fills position-less nodes individually, nudging each
// past any kept card it would otherwise cover.
export function tidyPositions(nodes: WfNode[], edges: WfEdge[]): WfNode[] | null {
  if (nodes.length === 0) return null;
  const missing = nodes.some((n) => !hasValidPosition(n.position));
  const overlap = !missing && hasOverlappingNodes(nodes);
  if (!missing && !overlap) return null;
  const layout = getLayeredLayout(nodes, edges);
  if (overlap) {
    let changed = false;
    const next = nodes.map((n) => {
      const p = layout.get(n.id) ?? { x: 0, y: 0 };
      if (!n.position || Math.abs(n.position.x - p.x) > 1 || Math.abs(n.position.y - p.y) > 1) {
        changed = true;
      }
      return { ...n, position: p };
    });
    return changed ? next : null;
  }
  // Gap-fill only: kept cards never move; each new card starts at its layered
  // slot and slides down until it clears every kept (and already placed) card.
  const occupied: Array<{ x: number; y: number }> = nodes
    .filter((n) => hasValidPosition(n.position))
    .map((n) => n.position as { x: number; y: number });
  const collides = (p: { x: number; y: number }) =>
    occupied.some((q) => Math.abs(q.x - p.x) < 300 && Math.abs(q.y - p.y) < 200);
  let changed = false;
  const next = nodes.map((n) => {
    if (hasValidPosition(n.position)) return n;
    let p = layout.get(n.id) ?? { x: 0, y: 0 };
    let guard = 0;
    while (guard++ < 60 && collides(p)) {
      p = { x: p.x, y: p.y + 120 };
    }
    occupied.push(p);
    changed = true;
    return { ...n, position: p };
  });
  return changed ? next : null;
}

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
  const { resolvedTheme } = useTheme();
  const colorMode = (resolvedTheme === "light" ? "light" : "dark") as ColorMode;

  // Auto-tidy: when the graph structure changes, fill in position-less nodes
  // or untangle overlapping stacks. Clean manual arrangements are left
  // alone (keyed on ids+edges, so free-dragging never triggers a snap-back).
  // The Tidy button forces a full re-layout on demand.
  const autoTidyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (wfNodes.length === 0) return;
    const key = `${wfNodes.map((n) => n.id).join("|")}#${wfEdges.map((e) => `${e.source}>${e.target}`).join("|")}`;
    if (autoTidyKeyRef.current === key) return;
    autoTidyKeyRef.current = key;
    const tidied = tidyPositions(wfNodes, wfEdges);
    if (!tidied) return;
    onChange(tidied);
    const raf = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    return () => cancelAnimationFrame(raf);
  }, [wfNodes, wfEdges, onChange, fitView]);

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
  // New nodes without a saved position get a flow-aware layered slot
  // (depth = longest path from a root), not a blind grid index.
  useEffect(() => {
    const layout = getLayeredLayout(wfNodes, wfEdges);
    setNodes((current) => {
      const currentById = new Map(current.map((n) => [n.id, n]));
      return wfNodes.map((wn) => {
        const data: CustomNodeData = {
          wfNode: wn,
          isSelected: wn.id === selectedNodeId,
          status: nodeStatuses[wn.id] ?? null,
          onSelect: onSelectNode,
          onDelete,
        };
        const existing = currentById.get(wn.id);
        if (existing) {
          // Adopt the saved position if it changed externally (e.g. tidy layout).
          if (wn.position && (wn.position.x !== existing.position.x || wn.position.y !== existing.position.y)) {
            return { ...existing, position: wn.position, data };
          }
          return { ...existing, data };
        }
        const position = wn.position ?? layout.get(wn.id) ?? { x: 0, y: 0 };
        return { id: wn.id, type: "workflowNode", position, data };
      });
    });
  }, [wfNodes, wfEdges, selectedNodeId, nodeStatuses, onSelectNode, onDelete, setNodes]);

  const handleTidyLayout = useCallback(() => {
    const layout = getLayeredLayout(wfNodes, wfEdges);
    onChange(wfNodes.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position ?? { x: 0, y: 0 } })));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  }, [wfNodes, wfEdges, onChange, fitView]);

  // Edges are fully derived from wfEdges + status each render - unlike nodes,
  // they carry no independent transient state worth preserving across rebuilds.
  // Dotted bezier style like the reference: thin dashed line tinted by source color.
  useEffect(() => {
    const nodeById = new Map(wfNodes.map((n) => [n.id, n]));
    setFlowEdges(
      wfEdges.map((we) => {
        const sourceNode = nodeById.get(we.source);
        const sourceDef = sourceNode ? NODE_REGISTRY_MAP.get(sourceNode.type) : undefined;
        const sourceColor = sourceDef?.color ?? "#71717a";
        const statusColor =
          nodeStatuses[we.source] === "success" ? "#22c55e"
            : nodeStatuses[we.source] === "error" ? "#ef4444"
              : nodeStatuses[we.source] === "running" ? "#60a5fa"
                : sourceColor;
        return {
          id: we.id,
          source: we.source,
          target: we.target,
          type: "deletable",
          animated: nodeStatuses[we.source] === "running",
          style: {
            stroke: statusColor,
            strokeWidth: 1.5,
            strokeDasharray: "3 6",
            strokeLinecap: "round" as const,
            opacity: 0.85,
          },
          data: { onDelete: onDeleteEdge } satisfies DeletableEdgeData,
        };
      }),
    );
  }, [wfNodes, wfEdges, nodeStatuses, onDeleteEdge, setFlowEdges]);

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
    <div className="h-full w-full bg-[var(--shell-content-bg)]!">
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
        colorMode={colorMode}
        style={{ "--xy-background-color": "transparent" } as React.CSSProperties}
        defaultEdgeOptions={{
          style: { strokeWidth: 1.5, strokeDasharray: "3 6" },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border !border-border !bg-card !fill-foreground/50 [&>button]:!border-b-border [&>button]:!bg-card [&>button]:!text-foreground/70 [&>button]:hover:!bg-muted [&>button]:hover:!text-foreground"
        />
        <Panel position="top-right">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={handleTidyLayout} className="gap-1.5 shadow-md">
              <Wand2 className="size-3.5" />
              Tidy
            </Button>
            <Button size="sm" variant="secondary" onClick={onAddNode} className="gap-1.5 shadow-md">
              <Plus className="size-3.5" />
              Add Node
            </Button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
