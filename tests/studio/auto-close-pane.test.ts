import test from "node:test";
import assert from "node:assert/strict";
import {
  assignTabToPane,
  createDefaultSplitLayout,
  splitPane,
} from "@/lib/studio/split-layout";
import {
  tryAutoClosePane,
  tryAutoCloseEmptyPanes,
} from "@/lib/studio/auto-close-pane";

function setupThreePaneLayout() {
  let sv = createDefaultSplitLayout("tab-a");
  sv = splitPane(sv, "pane-1");
  sv = splitPane(sv, "pane-2");
  sv = assignTabToPane(sv, "tab-a", "pane-1", false);
  sv = assignTabToPane(sv, "tab-b::pane::pane-2", "pane-2", true);
  sv = assignTabToPane(sv, "tab-c::pane::pane-3", "pane-3", false);
  return sv;
}

function setupTwoPaneLayout() {
  let sv = createDefaultSplitLayout("tab-a");
  sv = splitPane(sv, "pane-1");
  sv = assignTabToPane(sv, "tab-a", "pane-1", false);
  sv = assignTabToPane(sv, "tab-b::pane::pane-2", "pane-2", true);
  return sv;
}

test("tryAutoClosePane does not close pane when other tabs remain in the pane", () => {
  let splitView = setupTwoPaneLayout();
  splitView = assignTabToPane(
    splitView,
    "tab-c::pane::pane-2",
    "pane-2",
    false,
  );

  const result = tryAutoClosePane(
    [{ id: "tab-a" }, { id: "tab-c::pane::pane-2" }],
    splitView,
    "pane-2",
  );

  assert.equal(result.didClose, false);
});

test("tryAutoClosePane closes pane when last tab in that pane is closed", () => {
  const splitView = setupTwoPaneLayout();

  const result = tryAutoClosePane([{ id: "tab-a" }], splitView, "pane-2");

  assert.equal(result.didClose, true);
  if (result.didClose) {
    assert.equal(result.nextSplitView.enabled, false);
    assert.equal(result.remainingTabs.length, 1);
    assert.equal(result.remainingTabs[0].id, "tab-a");
    assert.equal(result.nextActiveTabId, "tab-a");
  }
});

test("tryAutoClosePane does not close pane when only one pane exists", () => {
  const splitView = createDefaultSplitLayout("tab-a");

  const result = tryAutoClosePane([], splitView, "pane-1");

  assert.equal(result.didClose, false);
});

test("tryAutoClosePane closes correct pane in three-pane layout", () => {
  const splitView = setupThreePaneLayout();

  const result = tryAutoClosePane(
    [{ id: "tab-a" }, { id: "tab-c::pane::pane-3" }],
    splitView,
    "pane-2",
  );

  assert.equal(result.didClose, true);
  if (result.didClose) {
    assert.equal(result.remainingTabs.length, 2);
    assert(result.remainingTabs.some((t) => t.id === "tab-a"));
    assert(result.remainingTabs.some((t) => t.id === "tab-c::pane::pane-3"));
  }
});

test("tryAutoCloseEmptyPanes closes all empty panes", () => {
  const splitView = setupThreePaneLayout();

  const result = tryAutoCloseEmptyPanes([{ id: "tab-a" }], splitView);

  assert.equal(result.didClose, true);
  if (result.didClose) {
    assert.equal(result.remainingTabs.length, 1);
    assert.equal(result.remainingTabs[0].id, "tab-a");
  }
});
