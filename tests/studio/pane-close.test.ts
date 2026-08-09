import test from "node:test";
import assert from "node:assert/strict";
import {
  assignTabToPane,
  createDefaultSplitLayout,
  splitPane,
} from "@/lib/studio/split-layout";
import {
  partitionTabsByPane,
  resolvePaneCloseState,
} from "@/lib/studio/pane-close";

function createSplitSetup() {
  let splitView = createDefaultSplitLayout("table-main-drizzle_migrations");
  splitView = splitPane(splitView, "pane-1");
  splitView = assignTabToPane(
    splitView,
    "table-main-drizzle_migrations",
    "pane-1",
    false,
  );
  splitView = assignTabToPane(
    splitView,
    "table-main-folders::pane::pane-2",
    "pane-2",
    true,
  );
  return { splitView };
}

test("partitionTabsByPane removes pane-scoped tabs from the targeted split pane", () => {
  const { splitView } = createSplitSetup();

  const { remainingTabs, removedTabs } = partitionTabsByPane(
    [
      { id: "table-main-drizzle_migrations" },
      { id: "table-main-folders::pane::pane-2" },
    ],
    splitView,
    "pane-2",
  );

  assert.deepEqual(
    remainingTabs.map((tab) => tab.id),
    ["table-main-drizzle_migrations"],
  );
  assert.deepEqual(
    removedTabs.map((tab) => tab.id),
    ["table-main-folders::pane::pane-2"],
  );
});

test("resolvePaneCloseState keeps the remaining pane tab active after closing split 2", () => {
  const { splitView } = createSplitSetup();

  const result = resolvePaneCloseState(
    [
      { id: "table-main-drizzle_migrations" },
      { id: "table-main-folders::pane::pane-2" },
    ],
    splitView,
    "pane-2",
  );

  assert.equal(result.nextSplitView.enabled, false);
  assert.equal(result.nextSplitView.activePaneId, "pane-1");
  assert.equal(result.nextActiveTabId, "table-main-drizzle_migrations");
  assert.deepEqual(
    result.remainingTabs.map((tab) => tab.id),
    ["table-main-drizzle_migrations"],
  );
});
