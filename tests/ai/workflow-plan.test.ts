import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkflowPlan } from "../../lib/workflows/agent-plan";
import type { AgentWorkflowPlan } from "../../lib/ai/types";

type PlanNode = AgentWorkflowPlan["nodes"][number];
type PlanEdge = AgentWorkflowPlan["edges"][number];

function makeNode(
  id: string,
  type: string,
  name = id,
  config: Record<string, unknown> = {},
): PlanNode {
  return { id, type, name, config };
}

function makeEdge(id: string, source: string, target: string): PlanEdge {
  return { id, source, target };
}

function edgeKeys(edges: Array<{ source: string; target: string }>): string[] {
  return edges.map((e) => `${e.source}->${e.target}`);
}

test("valid plan round-trips nodes, edges, and adds positions", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("n1", "trigger-manual", "Manual"),
      makeNode("n2", "db-query", "Query Users", { sql: "SELECT * FROM users" }),
      makeNode("n3", "data-map", "Transform", { expression: "({ ...item })" }),
    ],
    edges: [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n2", "n3")],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.equal(out.nodes.length, 3);
  assert.equal(out.edges.length, 2);
  assert.deepEqual(
    out.nodes.map((n) => n.id),
    ["n1", "n2", "n3"],
  );
  assert.deepEqual(
    out.nodes.map((n) => n.type),
    ["trigger-manual", "db-query", "data-map"],
  );
  assert.deepEqual(
    out.nodes.map((n) => n.name),
    ["Manual", "Query Users", "Transform"],
  );
  assert.deepEqual(out.nodes[1].config, { sql: "SELECT * FROM users" });
  assert.deepEqual(
    edgeKeys(out.edges),
    ["n1->n2", "n2->n3"],
  );
  assert.ok(out.nodes.some((n) => n.type.startsWith("trigger-")));
  for (const node of out.nodes) {
    assert.ok(typeof node.position?.x === "number");
    assert.ok(typeof node.position?.y === "number");
  }
});

test("unknown and unimplemented node types are dropped", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("t1", "trigger-manual", "Start"),
      makeNode("q1", "db-query", "Query", { sql: "select 1" }),
      makeNode("ai1", "ai-chat", "AI Chat"),
      makeNode("f1", "file-read", "Read File"),
      makeNode("b1", "totally-bogus", "Bogus"),
    ],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.deepEqual(
    out.nodes.map((n) => `${n.id}:${n.type}`),
    ["t1:trigger-manual", "q1:db-query"],
  );
});

test("missing config fields are filled from registry defaults", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [makeNode("c1", "trigger-cron", "Schedule")],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.equal(out.nodes.length, 1);
  const cron = out.nodes[0];
  assert.equal(cron.type, "trigger-cron");
  assert.ok(cron.config && typeof cron.config === "object");
  assert.equal(cron.config.timezone, "UTC");
  assert.equal(cron.config.expression, undefined);
});

test("dangling edges are dropped and duplicate edges are deduped", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("t1", "trigger-manual", "Start"),
      makeNode("q1", "db-query", "Query", { sql: "select 1" }),
    ],
    edges: [
      makeEdge("e1", "t1", "q1"),
      makeEdge("e2", "t1", "q1"),
      makeEdge("e3", "q1", "ghost"),
    ],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.deepEqual(edgeKeys(out.edges), ["t1->q1"]);
  assert.equal(out.edges.length, 1);
});

test("empty edges with at least two nodes are auto-chained", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("n0", "trigger-manual", "Start"),
      makeNode("n1", "db-query", "Query A", { sql: "select 1" }),
      makeNode("n2", "data-map", "Transform", { expression: "item" }),
    ],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.deepEqual(
    edgeKeys(out.edges),
    ["n0->n1", "n1->n2"],
  );
  assert.deepEqual(
    out.edges.map((e) => e.id),
    ["e-1", "e-2"],
  );
});

test("missing trigger node gets a leading trigger-manual prepended", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("a", "db-query", "Query A", { sql: "select 1" }),
      makeNode("b", "data-map", "Transform", { expression: "item" }),
    ],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.equal(out.nodes[0].type, "trigger-manual");
  assert.equal(out.nodes.length, 3);
  assert.deepEqual(
    edgeKeys(out.edges),
    [`${out.nodes[0].id}->a`, "a->b"],
  );
});

test("duplicate node ids are re-id'd and edges remap to the first occurrence", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("x", "db-query", "Query One", { sql: "select 1" }),
      makeNode("x", "data-map", "Map Two", { expression: "item" }),
      makeNode("other", "util-log", "Logger", { message: "$input" }),
      makeNode("t", "trigger-manual", "Start"),
    ],
    edges: [makeEdge("e1", "x", "other")],
  };

  const out = normalizeWorkflowPlan(plan);

  const ids = out.nodes.map((n) => n.id);
  assert.deepEqual(ids, ["x", "node_1", "other", "t"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(edgeKeys(out.edges), ["x->other"]);
  const idSet = new Set(ids);
  for (const edge of out.edges) {
    assert.ok(idSet.has(edge.source), `edge source ${edge.source} must resolve`);
    assert.ok(idSet.has(edge.target), `edge target ${edge.target} must resolve`);
  }
});

test("empty plan gets a single trigger-manual node", () => {
  const out = normalizeWorkflowPlan({ nodes: [], edges: [] });

  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0].type, "trigger-manual");
  assert.equal(out.edges.length, 0);
  assert.ok(typeof out.nodes[0].position?.x === "number");
  assert.ok(typeof out.nodes[0].position?.y === "number");
});

test("single trigger-manual node stays a single node with no edges", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [makeNode("s", "trigger-manual", "Start")],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0].id, "s");
  assert.equal(out.nodes[0].type, "trigger-manual");
  assert.equal(out.edges.length, 0);
  assert.ok(typeof out.nodes[0].position?.x === "number");
  assert.ok(typeof out.nodes[0].position?.y === "number");
});

test("update mode keeps a partial edit trigger-free", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [makeNode("a", "db-query", "Query A", { sql: "select 1" })],
    edges: [],
  };

  const out = normalizeWorkflowPlan(plan, { mode: "update" });

  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0].type, "db-query");
  assert.equal(out.edges.length, 0);
});

test("update mode does not re-chain when edges reference dropped nodes", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("a", "db-query", "Query A", { sql: "select 1" }),
      makeNode("b", "data-map", "Transform", { expression: "item" }),
    ],
    edges: [makeEdge("e1", "a", "ghost")],
  };

  const out = normalizeWorkflowPlan(plan, { mode: "update" });

  assert.equal(out.nodes.length, 2);
  assert.equal(out.edges.length, 0);
});

test("create mode with all-dangling raw edges does not auto-chain", () => {
  const plan: AgentWorkflowPlan = {
    nodes: [
      makeNode("a", "db-query", "Query A", { sql: "select 1" }),
      makeNode("b", "data-map", "Transform", { expression: "item" }),
    ],
    edges: [makeEdge("e1", "ghost1", "ghost2")],
  };

  const out = normalizeWorkflowPlan(plan);

  assert.equal(out.nodes.length, 3);
  assert.equal(out.nodes[0].type, "trigger-manual");
  assert.equal(out.edges.length, 0);
});
