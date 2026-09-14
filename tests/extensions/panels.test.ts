import test from "node:test";
import assert from "node:assert/strict";
import { resolvePanelTarget } from "../../lib/extensions/panels";

test("resolvePanelTarget routes editor panels to tabs, everything else to dialogs", () => {
  assert.equal(resolvePanelTarget("editor"), "tab");
  assert.equal(resolvePanelTarget("panel"), "dialog");
  assert.equal(resolvePanelTarget("both"), "dialog");
  assert.equal(resolvePanelTarget(undefined), "dialog");
  assert.equal(resolvePanelTarget(""), "dialog");
});
