import test from "node:test";
import assert from "node:assert/strict";
import { shouldCloneTabIntoPane } from "@/lib/studio/pane-tab-routing";

test("table tabs move between panes instead of cloning", () => {
  assert.equal(shouldCloneTabIntoPane("table"), true);
});

test("non-table tabs can still clone across panes", () => {
  assert.equal(shouldCloneTabIntoPane("sql"), true);
  assert.equal(shouldCloneTabIntoPane("settings"), true);
});
