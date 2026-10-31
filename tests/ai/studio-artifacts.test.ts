import test from "node:test";
import assert from "node:assert/strict";
import { streamPiResponse } from "../../lib/ai/pi-agent";
import { createPiDbTools } from "../../lib/ai/pi-tools";
import { messageTextForHistory, readMessageArtifacts, serializeMessageArtifacts } from "../../lib/ai/studio-artifacts";
import {
  prepareAppThemeArtifact,
  prepareDashboardArtifact,
  prepareEditorThemeArtifact,
  prepareWorkflowArtifact,
} from "../../lib/ai/studio-artifact-prepare";
import { buildDashboardWidgetsFromBlock } from "../../lib/ai/dashboard-plan";

const dashboard = { name: "Sales", widgets: [{ title: "Total", type: "metric" as const, query: "SELECT 1 AS value" }] };
const trigger = { id: "n1", type: "trigger-manual", name: "Start", config: {} };

test("dashboard artifacts feed the existing widget builder", () => {
  const artifact = prepareDashboardArtifact(dashboard, "postgres");
  assert.equal(artifact.action, "create");
  if (artifact.kind !== "dashboard") return assert.fail("expected a dashboard");
  assert.equal(buildDashboardWidgetsFromBlock(artifact.dashboard)[0].widgetType, "metric");
});

test("dashboard artifacts reject what the model can fix", () => {
  const withQuery = (query?: string) => ({ ...dashboard, widgets: [{ ...dashboard.widgets[0], query }] });
  assert.throws(() => prepareDashboardArtifact(withQuery("DELETE FROM users"), "postgres"), /Total/);
  assert.throws(() => prepareDashboardArtifact(withQuery(undefined), "postgres"), /needs a query/);
  assert.throws(() => prepareDashboardArtifact({ name: "Empty", widgets: [] }, "postgres"), /at least one widget/);
});

test("dashboard artifacts reject Mongo and Redis writes", () => {
  const withQuery = (query: string) => ({ ...dashboard, widgets: [{ ...dashboard.widgets[0], query }] });
  for (const query of [
    '{"collection":"users"}',
    'db.users.find({}).limit(5)',
    'db.users.aggregate([{"$group":{"_id":"$plan"}}])',
    '{"collection":"users","operation":"count"}',
  ]) assert.doesNotThrow(() => prepareDashboardArtifact(withQuery(query), "mongodb"), query);
  for (const query of [
    'db.users.insertOne({"a":1})',
    'db.users.deleteMany({})',
    '{"collection":"users","operation":"insertOne","document":{"a":1}}',
    '{"collection":"users","operation":"dropCollection"}',
    '{"collection":"users","operation":"aggregate","pipeline":[{"$out":"copy"}]}',
    '{"collection":"users","operation":"aggregate","pipeline":[{"$merge":{"into":"copy"}}]}',
  ]) assert.throws(() => prepareDashboardArtifact(withQuery(query), "mongodb"), /read-only|not allowed/, query);
  assert.doesNotThrow(() => prepareDashboardArtifact(withQuery("get counter"), "redis"));
  for (const query of ["SET key value", "del key", "FLUSHALL", '"SET" key value']) {
    assert.throws(() => prepareDashboardArtifact(withQuery(query), "redis"), /read-only Redis/, query);
  }
});

test("workflow artifacts report invalid graphs instead of dropping nodes", () => {
  const plan = { name: "Flow", nodes: [trigger], edges: [] };
  assert.equal(prepareWorkflowArtifact(plan).action, "create");
  assert.equal(prepareWorkflowArtifact({ ...plan, workflowId: "wf" }).action, "update");
  assert.throws(() => prepareWorkflowArtifact({ ...plan, nodes: [{ ...trigger, type: "nope" }] }), /Unknown workflow node type/);
  assert.throws(() => prepareWorkflowArtifact({ ...plan, nodes: [trigger, trigger] }), /Duplicate node id/);
  assert.throws(() => prepareWorkflowArtifact({ ...plan, edges: [{ id: "e", source: "n1", target: "n9" }] }), /does not exist/);
  assert.throws(
    () => prepareWorkflowArtifact({ ...plan, nodes: [{ id: "q", type: "db-query", name: "Q", config: {} }] }),
    /missing required field/,
  );
});

test("app theme artifacts avoid taken ids", () => {
  const artifact = prepareAppThemeArtifact({ name: "Ocean", base: "dark", colors: { "--background": "#000000" } }, new Set(["ocean"]));
  assert.equal(artifact.theme.theme.id, "ocean-2");
});

test("themes created without saved ids never reuse an id", () => {
  const app = () => prepareAppThemeArtifact({ name: "Ocean", base: "dark", colors: { "--background": "#000000" } }).theme.theme.id;
  const editor = () => prepareEditorThemeArtifact({ name: "Ocean", themeJson: '{"rules":[]}' }).theme.theme.id;
  assert.notEqual(app(), app());
  assert.notEqual(editor(), editor());
  assert.match(app(), /^ocean-[0-9a-f]{8}$/);
});

test("artifacts survive storage and stay visible to the model", () => {
  const artifact = prepareDashboardArtifact(dashboard, "postgres");
  const metaJson = serializeMessageArtifacts([artifact]);
  assert.deepEqual(readMessageArtifacts(metaJson), [artifact]);
  assert.deepEqual(readMessageArtifacts("not-json"), []);
  assert.match(messageTextForHistory("", metaJson), /Created dashboard "Sales"/);
});

test("streamPiResponse emits artifacts from tool details and allows a silent reply", async () => {
  const artifact = prepareDashboardArtifact(dashboard, "postgres");
  let listener: (event: any) => void = () => {};
  const session: any = {
    subscribe: (fn: (event: any) => void) => { listener = fn; },
    prompt: async () => {
      listener({ type: "tool_execution_end", toolCallId: "1", isError: true, result: { content: [], details: { artifact } } });
      listener({ type: "tool_execution_end", toolCallId: "2", isError: false, result: { content: [], details: { artifact } } });
    },
    dispose: () => {},
    state: { messages: [] },
  };
  const events: any[] = [];
  const text = await streamPiResponse({ session, history: [], prompt: "go", emit: (event) => events.push(event) });
  assert.equal(text, "");
  assert.deepEqual(events.filter((event) => event.type === "artifact").map((event) => event.artifact), [artifact]);
});

function piTool(name: string, context: Record<string, unknown>) {
  const tools = createPiDbTools({ connectionString: "postgres://localhost/app", emitStep: () => {}, ...context });
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool);
  return (params: unknown) => (tool.execute as any)("call", params);
}

test("Pi dashboard tools return an artifact in chat and refuse without a studio client", async () => {
  const result = await piTool("create_dashboard", { studioChat: true })(dashboard);
  assert.equal(result.details.artifact.kind, "dashboard");
  assert.match(result.content[0].text, /Created dashboard "Sales"/);
  await assert.rejects(() => piTool("create_dashboard", {})(dashboard), /Studio AI chat/);
});

test("Pi update tools resolve their targets", async () => {
  const widgets = dashboard.widgets;
  const dashboardContext = [{ id: "abc123", ref: "dashboard.sales-abc123", name: "Sales", widgets: [] }];
  const updated = await piTool("update_dashboard", { studioChat: true, dashboardContext })({ dashboardId: "dashboard.sales-abc123", name: "Sales", widgets });
  assert.equal(updated.details.artifact.dashboardId, "abc123");
  await assert.rejects(() => piTool("update_dashboard", { studioChat: true, dashboardContext })({ dashboardId: "missing", name: "Sales", widgets }), /not found/);

  const plan = { workflowId: "wf1", name: "Flow", nodes: [trigger], edges: [] };
  const workflowContext = { existing: [{ id: "wf1", name: "Flow", nodeCount: 1, nodeTypes: [] }], current: null };
  assert.equal((await piTool("update_workflow", { studioChat: true, workflowContext })(plan)).details.artifact.action, "update");
  await assert.rejects(() => piTool("update_workflow", { studioChat: true, workflowContext })({ ...plan, workflowId: "nope" }), /not found/);
});

test("Pi create_workflow saves the full graph when no studio client is listening", async () => {
  const saved: any[] = [];
  const persistWorkflow = async (input: any) => { saved.push(input); return { id: "wf1", name: input.name }; };
  const result = await piTool("create_workflow", { persistWorkflow })({ name: "Flow", nodes: [trigger], edges: [] });
  assert.equal(result.details?.artifact, undefined);
  assert.equal(saved[0].nodes[0].type, "trigger-manual");
  assert.equal((await piTool("create_workflow", { studioChat: true, persistWorkflow })({ name: "Flow", nodes: [trigger], edges: [] })).details.artifact.kind, "workflow");
  assert.equal(saved.length, 1);
});
