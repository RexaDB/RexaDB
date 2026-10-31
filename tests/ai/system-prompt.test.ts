import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentInstructions, renderWorkflowInstructions } from "../../lib/ai/system-prompt";

test("renderWorkflowInstructions lists implemented nodes only", () => {
  const out = renderWorkflowInstructions();
  assert.ok(out.includes("trigger-manual"));
  assert.ok(!out.includes("ai-chat"));
});

test("buildAgentInstructions directs creation to tools without unimplemented nodes", () => {
  const out = buildAgentInstructions({ dbType: "postgres" });
  for (const tool of ["create_dashboard", "create_workflow", "create_app_theme"]) assert.ok(out.includes(tool));
  for (const fence of ["```dashboard", "```workflow", "```theme"]) assert.ok(!out.includes(fence));
  assert.ok(!out.includes("ai-chat"));
});
