import dagre from "@dagrejs/dagre";

import { NODE_REGISTRY_MAP } from "./node-registry-data";
import type { WorkflowEdge, WorkflowNode } from "./types";
import type { AgentWorkflowPlan } from "../ai/types";

export type NormalizedWorkflowNode = WorkflowNode & { position?: { x: number; y: number } };
export type NormalizedWorkflowPlan = { nodes: NormalizedWorkflowNode[]; edges: WorkflowEdge[] };

const MAX_NAME_LENGTH = 120;

function defaultConfig(type: string): Record<string, unknown> {
  const def = NODE_REGISTRY_MAP.get(type);
  if (!def) return {};
  const config: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return config;
}

function uniqueId(prefix: string, taken: Set<string>): string {
  let n = 1;
  let id = `${prefix}${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  taken.add(id);
  return id;
}

function sanitizeName(raw: unknown, fallback: string): string {
  let name = typeof raw === "string" ? raw : "";
  name = name.trim();
  if (name === "") name = fallback;
  return name.slice(0, MAX_NAME_LENGTH);
}

export function normalizeWorkflowPlan(
  plan: AgentWorkflowPlan,
  opts: { mode?: "create" | "update" } = {},
): NormalizedWorkflowPlan {
  const { mode = "create" } = opts;
  const rawNodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const rawEdges = Array.isArray(plan?.edges) ? plan.edges : [];

  const nodes: NormalizedWorkflowNode[] = [];
  const idMap = new Map<string, string>();
  const seenIds = new Set<string>();

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") continue;
    const type = typeof raw.type === "string" ? raw.type : "";
    const def = NODE_REGISTRY_MAP.get(type);
    if (!def || def.implemented !== true) continue;

    const oldId = typeof raw.id === "string" ? raw.id : "";
    let newId = oldId;
    if (newId === "" || seenIds.has(newId)) {
      newId = uniqueId("node_", seenIds);
    } else {
      seenIds.add(newId);
    }
    if (oldId !== "" && !idMap.has(oldId)) idMap.set(oldId, newId);

    const rawConfig =
      raw.config && typeof raw.config === "object" && !Array.isArray(raw.config) ? raw.config : {};
    const config = { ...defaultConfig(type), ...rawConfig };

    nodes.push({
      id: newId,
      type,
      name: sanitizeName(raw.name, def.name),
      config,
    });
  }

  const hasTrigger = nodes.some((n) => n.type.startsWith("trigger-"));
  if (mode === "create" && !hasTrigger) {
    let triggerId = "node_trigger";
    if (seenIds.has(triggerId)) {
      triggerId = uniqueId("node_trigger_", seenIds);
    } else {
      seenIds.add(triggerId);
    }
    nodes.unshift({
      id: triggerId,
      type: "trigger-manual",
      name: "Manual Trigger",
      config: defaultConfig("trigger-manual"),
    });
  }

  const pairSeen = new Set<string>();
  const edges: Array<{ id: string; source: string; target: string }> = [];
  for (const raw of rawEdges) {
    if (!raw || typeof raw !== "object") continue;
    const src = typeof raw.source === "string" ? raw.source : "";
    const tgt = typeof raw.target === "string" ? raw.target : "";
    const srcId = idMap.get(src);
    const tgtId = idMap.get(tgt);
    if (srcId === undefined || tgtId === undefined) continue;
    const pairKey = `${srcId}\u0000${tgtId}`;
    if (pairSeen.has(pairKey)) continue;
    pairSeen.add(pairKey);
    edges.push({ id: typeof raw.id === "string" ? raw.id : "", source: srcId, target: tgtId });
  }

  if (mode === "create" && rawEdges.length === 0 && nodes.length >= 2) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({ id: `e-${i + 1}`, source: nodes[i].id, target: nodes[i + 1].id });
    }
  }

  const edgeIds = new Set<string>();
  const finalEdges: WorkflowEdge[] = edges.map((e, i) => {
    let id = typeof e.id === "string" && e.id.trim() !== "" ? e.id : "";
    if (id !== "" && edgeIds.has(id)) id = "";
    if (id === "") {
      id = `e-${i}`;
      let k = 0;
      while (edgeIds.has(id)) {
        k += 1;
        id = `e-${i}-${k}`;
      }
    }
    edgeIds.add(id);
    return { id, source: e.source, target: e.target };
  });

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
  for (const node of nodes) g.setNode(node.id, { width: 200, height: 90 });
  for (const edge of finalEdges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);
  for (const node of nodes) {
    const laid = g.node(node.id);
    node.position = laid ? { x: laid.x, y: laid.y } : { x: 0, y: 0 };
  }

  return { nodes, edges: finalEdges };
}

export function summarizePlan(plan: AgentWorkflowPlan): { label: string; nodeTypes: string[] } {
  const rawNodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const nodeTypes: string[] = [];
  for (const n of rawNodes) {
    if (n && typeof n.type === "string") nodeTypes.push(n.type);
  }
  const label = nodeTypes.length > 0 ? nodeTypes.join(" → ") : "No nodes";
  return { label, nodeTypes };
}
