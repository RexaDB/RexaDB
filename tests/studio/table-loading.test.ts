import test from "node:test";
import assert from "node:assert/strict";
import {
  findPreservedInactiveTableTabId,
  getActiveTableLoadingTabId,
  shouldShowInactivePaneTableLoading,
  shouldUseVisibleTableStateForInactivePane,
} from "@/lib/studio/table-loading";

test("getActiveTableLoadingTabId uses the active pane-scoped table tab id", () => {
  const openTabs = [
    { id: "sql-1", type: "sql" },
    { id: "table-main-users::pane::2", type: "table" },
  ];

  assert.equal(
    getActiveTableLoadingTabId(openTabs, "table-main-users::pane::2"),
    "table-main-users::pane::2"
  );
});

test("getActiveTableLoadingTabId ignores non-table active tabs", () => {
  const openTabs = [
    { id: "sql-1", type: "sql" },
    { id: "table-main-users", type: "table" },
  ];

  assert.equal(getActiveTableLoadingTabId(openTabs, "sql-1"), null);
});

test("shouldShowInactivePaneTableLoading hides stale loaders once results exist", () => {
  assert.equal(
    shouldShowInactivePaneTableLoading("table", { rows: [{ id: 1 }] }),
    false
  );
  assert.equal(
    shouldShowInactivePaneTableLoading("table", null),
    true
  );
  assert.equal(
    shouldShowInactivePaneTableLoading("sql", null),
    false
  );
});

test("shouldUseVisibleTableStateForInactivePane only during empty-pane focus handoff", () => {
  assert.equal(
    shouldUseVisibleTableStateForInactivePane({
      activeTabId: null,
      tabType: "table",
      tabSchema: "main",
      tabName: "connections",
      selectedSchema: "main",
      selectedTable: "connections",
    }),
    true
  );

  assert.equal(
    shouldUseVisibleTableStateForInactivePane({
      activeTabId: "sql-1",
      tabType: "table",
      tabSchema: "main",
      tabName: "connections",
      selectedSchema: "main",
      selectedTable: "connections",
    }),
    false
  );
});

test("findPreservedInactiveTableTabId snapshots the other pane table when switching from an empty focused pane", () => {
  const openTabs = [
    { id: "table-main-connections", type: "table", schema: "main", name: "connections" },
    { id: "table-main-connection_settings::pane::pane-2", type: "table", schema: "main", name: "connection_settings" },
  ];

  const result = findPreservedInactiveTableTabId({
    openTabs,
    activeTabId: null,
    selectedSchema: "main",
    selectedTable: "connections",
    targetPaneId: "pane-2",
    getPaneIdForTab: (tabId) => tabId.includes("pane-2") ? "pane-2" : "pane-1",
  });

  assert.equal(result, "table-main-connections");
});
