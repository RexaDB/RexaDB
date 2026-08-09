import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { getExecutor, hasExecutor } from "./mastra-executors";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeOutput,
  WorkflowRunContext,
  WorkflowProgressEvent,
} from "./types";
export { matchesCron } from "./cron";

/**
 * Build and execute a visual workflow graph using Mastra's workflow engine.
 *
 * Simple linear chains use Mastra's `.then()` chaining (retry support,
 * observability, proper step lifecycle). Complex DAGs fall back to
 * individual step execution with manual data routing.
 *
 * Branching (flow-condition) is handled by evaluating the condition and
 * only executing nodes on the matching path. Loop nodes (flow-loop-items)
 * iterate over the array and execute downstream steps per item.
 */

const anySchema = z.any();

// ─── Topological sort ─────────────────────────────────────────────────

function topologicalSort(nodes: GraphNode[], edges: WorkflowEdge[]): string[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const orderIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) childrenOf.set(n.id, []);
  for (const e of edges) {
    if (nodeById.has(e.source) && nodeById.has(e.target)) {
      childrenOf.get(e.source)!.push(e.target);
    }
  }

  // fallow-ignore-next-line code-duplication
  const triggerIds = nodes.filter((n) => n.type.startsWith("trigger-")).map((n) => n.id);
  const reachable = new Set<string>();
  const q = [...triggerIds];
  while (q.length) {
    const id = q.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of childrenOf.get(id) ?? []) q.push(child);
  }

  const inDegree = new Map<string, number>();
  for (const id of reachable) inDegree.set(id, 0);
  for (const e of edges) {
    if (reachable.has(e.source) && reachable.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const ready = [...reachable].filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => orderIndex.get(a)! - orderIndex.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (!reachable.has(child)) continue;
      const next = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  if (order.length < reachable.size) throw new Error("Workflow graph contains a cycle");
  return order;
}

type GraphNode = { id: string; type: string };

// ─── Adjacency helpers ────────────────────────────────────────────────

function buildAdjacency(nodes: GraphNode[], edges: WorkflowEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) { parentsOf.set(n.id, []); childrenOf.set(n.id, []); }
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      parentsOf.get(e.target)!.push(e.source);
      childrenOf.get(e.source)!.push(e.target);
    }
  }
  return { parentsOf, childrenOf };
}

// ─── Reachability ─────────────────────────────────────────────────────

function findReachable(nodes: GraphNode[], childrenOf: Map<string, string[]>, excludeIds?: Set<string>): Set<string> {
  const triggerIds = nodes.filter((n) => n.type.startsWith("trigger-") && !excludeIds?.has(n.id)).map((n) => n.id);
  const reachable = new Set<string>();
  const q = [...triggerIds];
  while (q.length) {
    const id = q.shift()!;
    if (reachable.has(id) || excludeIds?.has(id)) continue;
    reachable.add(id);
    for (const child of childrenOf.get(id) ?? []) q.push(child);
  }
  return reachable;
}

// ─── Branch detection ─────────────────────────────────────────────────
// A condition node with two children defines a branch. We trace forward
// from each child to find which nodes are exclusive to that branch vs
// shared (post-rejoin).

type BranchInfo = {
  conditionNodeId: string;
  truePath: Set<string>;
  falsePath: Set<string>;
};

function detectBranches(
  nodes: GraphNode[],
  edges: WorkflowEdge[],
  childrenOf: Map<string, string[]>,
): BranchInfo[] {
  const branches: BranchInfo[] = [];

  for (const node of nodes) {
    if (node.type !== "flow-condition") continue;
    const children = childrenOf.get(node.id) ?? [];
    if (children.length < 2) continue;

    // Trace all nodes reachable from each child
    const pathSets = children.map((childId) => {
      const visited = new Set<string>();
      const q = [childId];
      while (q.length) {
        const id = q.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        for (const c of childrenOf.get(id) ?? []) q.push(c);
      }
      return visited;
    });

    // Nodes that appear in ALL paths are "shared" (post-rejoin)
    const shared = new Set(pathSets[0]);
    for (let i = 1; i < pathSets.length; i++) {
      for (const id of shared) {
        if (!pathSets[i].has(id)) shared.delete(id);
      }
    }

    // Exclusive nodes per path (remove shared and the condition node itself)
    const exclusive = pathSets.map((ps) => {
      const ex = new Set(ps);
      for (const s of shared) ex.delete(s);
      ex.delete(node.id);
      return ex;
    });

    branches.push({
      conditionNodeId: node.id,
      truePath: exclusive[0] ?? new Set(),
      falsePath: exclusive[1] ?? new Set(),
    });
  }

  return branches;
}

// ─── Main adapter API ─────────────────────────────────────────────────

export type MastraAdapterResult = {
  outputs: WorkflowNodeOutput[];
  error?: string;
};

/**
 * Execute a visual workflow using Mastra's workflow infrastructure.
 */
export async function executeWithMastra(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  trigger: "manual" | "schedule",
  initialData?: unknown,
  connectionId?: number | null,
  onProgress?: (event: WorkflowProgressEvent) => void,
): Promise<MastraAdapterResult> {
  const outputs: WorkflowNodeOutput[] = [];
  const ctx: WorkflowRunContext = {
    vars: {},
    logs: [],
    nodeOutputs: {},
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const { parentsOf, childrenOf } = buildAdjacency(nodes, edges);

  // Validate executors exist
  for (const node of nodes) {
    if (!node.type.startsWith("trigger-") && !hasExecutor(node.type)) {
      return { outputs, error: `Node type "${node.type}" is not yet implemented in Mastra adapter` };
    }
  }

  // Topological sort
  let order: string[];
  try {
    order = topologicalSort(nodes, edges);
  } catch (e: any) {
    return { outputs, error: e.message };
  }

  // Determine reachable nodes
  const reachable = findReachable(nodes, childrenOf);
  order = order.filter((id) => reachable.has(id));

  if (order.length === 0) {
    return { outputs, error: "Workflow has no trigger nodes — nothing will execute" };
  }

  // Detect branches
  const branches = detectBranches(nodes, edges, childrenOf);

  // Execute with branch awareness
  return executeWithBranches(nodes, order, edges, branches, trigger, initialData, connectionId, onProgress, outputs, ctx, nodeById, parentsOf, childrenOf, reachable);
}


// ─── Branch-aware execution ───────────────────────────────────────────

function getNodeInput(
  isTrigger: boolean,
  initialData: unknown,
  parents: string[],
  ctx: WorkflowRunContext,
): unknown {
  if (isTrigger) return initialData ?? null;
  if (parents.length === 0) return null;
  if (parents.length === 1) return ctx.nodeOutputs[parents[0]];
  return parents.map((p) => ctx.nodeOutputs[p]);
}

function failNode(
  node: WorkflowNode,
  nodeId: string,
  nodeLogs: string[],
  err: any,
  start: number,
  outputs: WorkflowNodeOutput[],
  onProgress?: (event: WorkflowProgressEvent) => void,
): { outputs: WorkflowNodeOutput[]; error: string } {
  const durationMs = Date.now() - start;
  outputs.push({ nodeId, nodeName: node.name, nodeType: node.type, output: null, logs: nodeLogs, error: err.message, durationMs });
  onProgress?.({ type: "node-done", nodeId, output: null, error: err.message, durationMs });
  return { outputs, error: `Node "${node.name}" failed: ${err.message}` };
}

async function executeWithBranches(
  nodes: WorkflowNode[],
  order: string[],
  edges: WorkflowEdge[],
  branches: BranchInfo[],
  trigger: "manual" | "schedule",
  initialData: unknown,
  connectionId: number | null | undefined,
  onProgress: ((event: WorkflowProgressEvent) => void) | undefined,
  outputs: WorkflowNodeOutput[],
  ctx: WorkflowRunContext,
  nodeById: Map<string, WorkflowNode>,
  parentsOf: Map<string, string[]>,
  childrenOf: Map<string, string[]>,
  reachable: Set<string>,
): Promise<MastraAdapterResult> {
  // Track which branch paths are "active" for each condition
  const activeBranches = new Map<string, "true" | "false">();

  // Mark skipped nodes (not reachable)
  function markSkipped(nodeId: string, nodeName: string, nodeType: string) {
    outputs.push({ nodeId, nodeName, nodeType, output: null, logs: [], durationMs: 0, skipped: true });
    onProgress?.({ type: "node-done", nodeId, output: null, durationMs: 0, skipped: true });
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) markSkipped(node.id, node.name, node.type);
  }

  try {
    for (const nodeId of order) {
      const node = nodeById.get(nodeId)!;
      const isTrigger = node.type.startsWith("trigger-");
      const parents = (parentsOf.get(nodeId) ?? []).filter((p) => reachable.has(p));

      // ── Branch check: skip nodes on inactive branch paths ──────
      const shouldSkip = shouldSkipNode(nodeId, branches, activeBranches);
      if (shouldSkip) {
        markSkipped(nodeId, node.name, node.type);
        continue;
      }

      // ── If this is a condition node, decide which branch is active ──
      if (node.type === "flow-condition") {
        const branch = branches.find((b) => b.conditionNodeId === nodeId);
        const input = getNodeInput(isTrigger, initialData, parents, ctx);
        const start = Date.now();
        const nodeLogs: string[] = [];
        onProgress?.({ type: "node-start", nodeId });

        try {
          const result = await getExecutor(node.type)(node, input, ctx, nodeLogs, connectionId);
          ctx.nodeOutputs[nodeId] = result;
          const conditionResult = Boolean((result as any)?.condition ?? false);
          const durationMs = Date.now() - start;
          outputs.push({ nodeId, nodeName: node.name, nodeType: node.type, output: result, logs: nodeLogs, durationMs });
          onProgress?.({ type: "node-done", nodeId, output: result, durationMs });
          if (branch) activeBranches.set(nodeId, conditionResult ? "true" : "false");
        } catch (err: any) {
          return failNode(node, nodeId, nodeLogs, err, start, outputs, onProgress);
        }
        continue;
      }

      // ── Regular node ──
      const input = getNodeInput(isTrigger, initialData, parents, ctx);
      const start = Date.now();
      const nodeLogs: string[] = [];
      onProgress?.({ type: "node-start", nodeId });

      try {
        // fallow-ignore-next-line code-duplication
      const result = isTrigger
          ? (hasExecutor(node.type) ? await getExecutor(node.type)(node, input, ctx, nodeLogs, connectionId) : (input ?? null))
          : await getExecutor(node.type)(node, input, ctx, nodeLogs, connectionId);
        ctx.nodeOutputs[nodeId] = result;
        const durationMs = Date.now() - start;
        outputs.push({ nodeId, nodeName: node.name, nodeType: node.type, output: result, logs: nodeLogs, durationMs });
        onProgress?.({ type: "node-done", nodeId, output: result, durationMs });
      } catch (err: any) {
        return failNode(node, nodeId, nodeLogs, err, start, outputs, onProgress);
      }
    }

    return { outputs };
  } catch (err: any) {
    return { outputs, error: err.message };
  }
}

/** Check if a node should be skipped because it's on an inactive branch path */
function shouldSkipNode(
  nodeId: string,
  branches: BranchInfo[],
  activeBranches: Map<string, "true" | "false">,
): boolean {
  for (const branch of branches) {
    const active = activeBranches.get(branch.conditionNodeId);
    if (!active) continue; // Condition hasn't run yet or has no result
    if (branch.truePath.has(nodeId) && active === "false") return true;
    if (branch.falsePath.has(nodeId) && active === "true") return true;
  }
  return false;
}

// ─── Linear chain execution (Mastra Workflow with .then()) ────────────

async function executeLinearChain(
  nodes: WorkflowNode[],
  order: string[],
  _trigger: "manual" | "schedule",
  initialData: unknown,
  connectionId: number | null | undefined,
  onProgress: ((event: WorkflowProgressEvent) => void) | undefined,
  outputs: WorkflowNodeOutput[],
  ctx: WorkflowRunContext,
  nodeById: Map<string, WorkflowNode>,
): Promise<MastraAdapterResult> {
  try {
    let wf = createWorkflow({
      id: `wf-linear-${Date.now()}`,
      inputSchema: anySchema,
      outputSchema: anySchema,
    });

    let currentWf = wf;

    for (const nodeId of order) {
      const node = nodeById.get(nodeId)!;

      if (node.type.startsWith("trigger-")) {
        const step = createStep({
          id: nodeId,
          inputSchema: anySchema,
          outputSchema: anySchema,
          retries: getRetryConfig(node),
          execute: async ({ inputData }) => {
            onProgress?.({ type: "node-start", nodeId });
            try {
              const handler = hasExecutor(node.type) ? getExecutor(node.type) : null;
              const result = handler ? await handler(node, inputData ?? initialData, ctx, [], connectionId) : (inputData ?? initialData ?? null);
              ctx.nodeOutputs[nodeId] = result;
              onProgress?.({ type: "node-done", nodeId, output: result, durationMs: 0 });
              return result;
            } catch (err: any) {
              onProgress?.({ type: "node-done", nodeId, output: null, error: err.message, durationMs: 0 });
              throw err;
            }
          },
        });
        currentWf = currentWf.then(step);
        continue;
      }

      if (node.type === "flow-delay" || node.type === "util-sleep") {
        const delayMs = node.type === "flow-delay"
          ? Number(node.config.seconds || 0) * 1000
          : Number(node.config.ms || 0);
        if (delayMs > 0) currentWf = currentWf.sleep(delayMs);
        const pass = createStep({
          id: nodeId, inputSchema: anySchema, outputSchema: anySchema,
          execute: async ({ inputData }) => {
            onProgress?.({ type: "node-start", nodeId });
            ctx.nodeOutputs[nodeId] = inputData;
            onProgress?.({ type: "node-done", nodeId, output: inputData, durationMs: 0 });
            return inputData;
          },
        });
        currentWf = currentWf.then(pass);
        continue;
      }

      // Regular node with retry support
      const step = createStep({
        id: nodeId,
        inputSchema: anySchema,
        outputSchema: anySchema,
        retries: getRetryConfig(node),
        execute: async ({ inputData }) => {
          onProgress?.({ type: "node-start", nodeId });
          const start = Date.now();
          const nodeLogs: string[] = [];
          try {
          // fallow-ignore-next-line code-duplication
            const result = await getExecutor(node.type)(node, inputData, ctx, nodeLogs, connectionId);
            ctx.nodeOutputs[nodeId] = result;
            const durationMs = Date.now() - start;
            outputs.push({ nodeId, nodeName: node.name, nodeType: node.type, output: result, logs: nodeLogs, durationMs });
            onProgress?.({ type: "node-done", nodeId, output: result, durationMs });
            return result;
          } catch (err: any) {
            const durationMs = Date.now() - start;
            outputs.push({ nodeId, nodeName: node.name, nodeType: node.type, output: null, logs: nodeLogs, error: err.message, durationMs });
            onProgress?.({ type: "node-done", nodeId, output: null, error: err.message, durationMs });
            throw err;
          }
        },
      });
      currentWf = currentWf.then(step);
    }

    const built = currentWf.commit();
    const run = await built.createRun({ runId: `run-${Date.now()}` });
    await run.start({ inputData: initialData ?? {} });
    return { outputs };
  } catch (err: any) {
    return { outputs, error: err.message };
  }
}

// ─── Retry config ─────────────────────────────────────────────────────
// Read retry settings from node config. Default: 0 retries (fail fast).
// Users can set retryAttempts and retryDelayMs in the node config.

function getRetryConfig(node: WorkflowNode): number | undefined {
  const attempts = Number(node.config.retryAttempts ?? 0);
  return attempts > 0 ? attempts : undefined;
}


