import test from "node:test";
import assert from "node:assert/strict";
import { extractCodeBlock } from "../../lib/ai/chat-blocks";

test("extractCodeBlock returns matching block", () => {
  const source = "Here is a block:\n```dashboard\n{\"a\":1}\n```";
  assert.equal(extractCodeBlock(source, "dashboard"), "{\"a\":1}");
  assert.equal(extractCodeBlock(source, "sql"), null);
});
