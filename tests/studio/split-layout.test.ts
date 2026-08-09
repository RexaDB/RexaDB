import test from "node:test";
import assert from "node:assert/strict";
import {
  activatePane,
  assignTabToPane,
  closePane,
  createDefaultSplitLayout,
  getPaneIds,
  resolvePaneForTab,
  getTabsForPane,
  normalizeSplitLayout,
  splitPane,
  updateSplitRatio,
} from "@/lib/studio/split-layout";

function setupTwoPaneLayout() {
  let layout = createDefaultSplitLayout("tab-1");
  layout = splitPane(layout, "pane-1");
  layout = assignTabToPane(layout, "tab-1", "pane-1", false);
  layout = assignTabToPane(layout, "tab-2", "pane-2", true);
  return layout;
}

test("splitPane creates nested panes and focuses the new pane", () => {
  let layout = createDefaultSplitLayout("tab-1");
  layout = splitPane(layout, "pane-1");
  layout = splitPane(layout, "pane-2");

  assert.deepEqual(getPaneIds(layout.root), ["pane-1", "pane-2", "pane-3"]);
  assert.equal(layout.activePaneId, "pane-3");
  assert.equal(layout.enabled, true);
});

test("assignTabToPane and normalize keep pane-local active tabs isolated", () => {
  let layout = setupTwoPaneLayout();
  layout = activatePane(layout, "pane-1", "tab-1");
  layout = normalizeSplitLayout(layout, ["tab-1", "tab-2"], "tab-1");

  assert.equal(layout.activePaneId, "pane-1");
  assert.equal(layout.paneState["pane-1"]?.activeTabId, "tab-1");
  assert.equal(layout.paneState["pane-2"]?.activeTabId, "tab-2");
  assert.deepEqual(getTabsForPane(["tab-1", "tab-2"], layout, "pane-1"), [
    "tab-1",
  ]);
  assert.deepEqual(getTabsForPane(["tab-1", "tab-2"], layout, "pane-2"), [
    "tab-2",
  ]);
});

test("closePane preserves the remaining pane layout without reassigning removed pane tabs", () => {
  let layout = setupTwoPaneLayout();
  layout = closePane(layout, "pane-2", ["tab-1"]);
  layout = normalizeSplitLayout(layout, ["tab-1"], "tab-1");

  assert.deepEqual(getPaneIds(layout.root), ["pane-1"]);
  assert.equal(layout.enabled, false);
  assert.deepEqual(getTabsForPane(["tab-1"], layout, "pane-1"), ["tab-1"]);
  assert.equal(layout.tabPaneMap["tab-2"], undefined);
});

test("updateSplitRatio updates only the targeted branch", () => {
  let layout = createDefaultSplitLayout("tab-1");
  layout = splitPane(layout, "pane-1");
  layout = splitPane(layout, "pane-2");
  layout = updateSplitRatio(layout, "split-2", 0.62);

  if (layout.root.type !== "split") throw new Error("expected split root");
  const nested = layout.root.second;
  if (nested.type !== "split") throw new Error("expected nested split");

  assert.equal(layout.root.ratio, 0.5);
  assert.equal(nested.ratio, 0.62);
});

test("pane-scoped tab ids stay attached to their encoded pane before explicit mapping", () => {
  let layout = createDefaultSplitLayout("tab-1");
  layout = splitPane(layout, "pane-1");
  const paneScopedTabId = "table-main-ai_chat_messages::pane::pane-2";

  assert.equal(resolvePaneForTab(layout, paneScopedTabId), "pane-2");
  assert.deepEqual(getTabsForPane([paneScopedTabId], layout, "pane-2"), [
    paneScopedTabId,
  ]);

  const normalized = normalizeSplitLayout(
    layout,
    [paneScopedTabId],
    paneScopedTabId,
  );
  assert.equal(normalized.tabPaneMap[paneScopedTabId], "pane-2");
  assert.equal(normalized.paneState["pane-2"]?.activeTabId, paneScopedTabId);
});
