import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentInstructions, renderWorkflowInstructions } from "../../lib/ai/system-prompt";

test("renderWorkflowInstructions lists implemented nodes only", () => {
  const out = renderWorkflowInstructions();
  assert.ok(out.includes("trigger-manual"));
  assert.ok(!out.includes("ai-chat"));
});

test("buildAgentInstructions includes the workflow block schema without unimplemented nodes", () => {
  const out = buildAgentInstructions({ dbType: "postgres" });
  assert.ok(out.includes("```workflow"));
  assert.ok(!out.includes("ai-chat"));
});
