import test from "node:test";
import assert from "node:assert/strict";
import { extractCodeBlock, parseDashboardBlock, parseWorkflowBlock } from "../../lib/ai/chat-blocks";

test("extractCodeBlock returns matching block", () => {
  const source = "Here is a block:\n```dashboard\n{\"a\":1}\n```";
  assert.equal(extractCodeBlock(source, "dashboard"), "{\"a\":1}");
  assert.equal(extractCodeBlock(source, "sql"), null);
});

test("parseDashboardBlock parses JSON", () => {
  const source = "```dashboard\n{\"widgets\":[{\"title\":\"Test\"}]}\n```";
  const parsed = parseDashboardBlock(source);
  assert.deepEqual(parsed, { widgets: [{ title: "Test" }] });

  const bad = parseDashboardBlock("```dashboard\nnot-json\n```");
  assert.equal(bad, null);
});

test("parseWorkflowBlock parses a valid workflow plan", () => {
  const source = '```workflow\n{"name":"My Flow","nodes":[{"id":"n1","type":"trigger-manual","name":"Start","config":{}}],"edges":[{"id":"e1","source":"n1","target":"n2"}]}\n```';
  const parsed = parseWorkflowBlock(source);
  assert.ok(parsed);
  assert.equal(parsed.name, "My Flow");
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].type, "trigger-manual");
  assert.equal(parsed.edges.length, 1);
});

test("parseWorkflowBlock returns null for a wrong fence language", () => {
  const source = '```sql\n{"nodes":[],"edges":[]}\n```';
  assert.equal(parseWorkflowBlock(source), null);
});

test("parseWorkflowBlock returns null for malformed JSON", () => {
  const source = "```workflow\nnot-json\n```";
  assert.equal(parseWorkflowBlock(source), null);
});

test("parseWorkflowBlock returns null when nodes array is missing", () => {
  const source = '```workflow\n{"name":"X","edges":[]}\n```';
  assert.equal(parseWorkflowBlock(source), null);
});
