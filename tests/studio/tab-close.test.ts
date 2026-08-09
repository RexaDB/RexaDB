import test from "node:test";
import assert from "node:assert/strict";
import {
  assignTabToPane,
  createDefaultSplitLayout,
  splitPane,
} from "@/lib/studio/split-layout";
import {
  filterTabsAfterClose,
  resolveTabCloseState,
} from "@/lib/studio/tab-close";

function setupTwoPaneWithAiChat() {
  let sv = createDefaultSplitLayout("table-main-connections");
  sv = splitPane(sv, "pane-1");
  sv = assignTabToPane(sv, "table-main-connections", "pane-1", false);
  sv = assignTabToPane(sv, "table-main-ai_chat_messages::pane::pane-2", "pane-2", true);
  return sv;
}

const getTabBaseId = (tab: { id: string; baseId?: string }) => {
  if (tab.baseId) return tab.baseId;
  const marker = "::pane::";
  const index = tab.id.indexOf(marker);
  return index >= 0 ? tab.id.slice(0, index) : tab.id;
};

test("filterTabsAfterClose removes only the closed tab instance", () => {
  const tabs = [
    {
      id: "table-main-drizzle_migrations",
      type: "table",
      baseId: "table-main-drizzle_migrations",
    },
    { id: "table-main-folders", type: "table", baseId: "table-main-folders" },
    {
      id: "table-main-folders::pane::pane-2",
      type: "table",
      baseId: "table-main-folders",
    },
  ];

  const nextTabs = filterTabsAfterClose(tabs, tabs[2], getTabBaseId);

  assert.deepEqual(
    nextTabs.map((tab) => tab.id),
    ["table-main-drizzle_migrations", "table-main-folders"],
  );
});

test("resolveTabCloseState clears focus when the last tab in the active pane is closed", () => {
  const splitView = createDefaultSplitLayout("table-main-ai_chats");
  const result = resolveTabCloseState({
    activeTabId: "table-main-ai_chats",
    closedTabId: "table-main-ai_chats",
    openTabs: [{ id: "table-main-ai_chats" }],
    splitView,
  });

  assert.deepEqual(result.nextTabs, []);
  assert.equal(result.nextFocusedTabId, null);
  assert.equal(result.nextSplitView.paneState["pane-1"]?.activeTabId, null);
});

test("resolveTabCloseState promotes the next tab in the same pane when closing the active tab", () => {
  const splitView = createDefaultSplitLayout("table-main-ai_chats");
  const result = resolveTabCloseState({
    activeTabId: "table-main-ai_chats",
    closedTabId: "table-main-ai_chats",
    openTabs: [{ id: "table-main-ai_chats" }, { id: "sql-1" }],
    splitView,
  });

  assert.deepEqual(
    result.nextTabs.map((tab) => tab.id),
    ["sql-1"],
  );
  assert.equal(result.nextFocusedTabId, "sql-1");
  assert.equal(result.nextFocusedTab?.id, "sql-1");
});

test("resolveTabCloseState keeps the active pane stable when closing a background tab in another pane", () => {
  let splitView = createDefaultSplitLayout("table-main-connections");
  splitView = splitPane(splitView, "pane-1");
  splitView = assignTabToPane(
    splitView,
    "table-main-connections",
    "pane-1",
    true,
  );
  splitView = assignTabToPane(
    splitView,
    "table-main-ai_chats::pane::pane-2",
    "pane-2",
    true,
  );
  splitView = assignTabToPane(
    splitView,
    "sql-2::pane::pane-2",
    "pane-2",
    false,
  );
  splitView = assignTabToPane(
    splitView,
    "table-main-connections",
    "pane-1",
    true,
  );

  const result = resolveTabCloseState({
    activeTabId: "table-main-connections",
    closedTabId: "sql-2::pane::pane-2",
    openTabs: [
      { id: "table-main-connections" },
      { id: "table-main-ai_chats::pane::pane-2" },
      { id: "sql-2::pane::pane-2" },
    ],
    splitView,
  });

  assert.equal(result.nextFocusedTabId, "table-main-connections");
  assert.equal(result.nextSplitView.activePaneId, "pane-1");
  assert.equal(
    result.nextSplitView.paneState["pane-2"]?.activeTabId,
    "table-main-ai_chats::pane::pane-2",
  );
});

test("resolveTabCloseState keeps focus in split 2 when closing its active tab and another split-2 tab remains", () => {
  let splitView = setupTwoPaneWithAiChat();
  splitView = assignTabToPane(
    splitView,
    "table-main-open_tabs::pane::pane-2",
    "pane-2",
    false,
  );

  const result = resolveTabCloseState({
    activeTabId: "table-main-ai_chat_messages::pane::pane-2",
    closedTabId: "table-main-ai_chat_messages::pane::pane-2",
    openTabs: [
      { id: "table-main-connections" },
      { id: "table-main-ai_chat_messages::pane::pane-2" },
      { id: "table-main-open_tabs::pane::pane-2" },
    ],
    splitView,
  });

  assert.equal(result.nextSplitView.activePaneId, "pane-2");
  assert.equal(result.nextFocusedTabId, "table-main-open_tabs::pane::pane-2");
  assert.equal(
    result.nextSplitView.paneState["pane-2"]?.activeTabId,
    "table-main-open_tabs::pane::pane-2",
  );
});

test("resolveTabCloseState leaves split 2 empty instead of jumping to split 1 when closing its last active tab", () => {
  const splitView = setupTwoPaneWithAiChat();

  const result = resolveTabCloseState({
    activeTabId: "table-main-ai_chat_messages::pane::pane-2",
    closedTabId: "table-main-ai_chat_messages::pane::pane-2",
    openTabs: [
      { id: "table-main-connections" },
      { id: "table-main-ai_chat_messages::pane::pane-2" },
    ],
    splitView,
  });

  assert.equal(result.nextSplitView.activePaneId, "pane-2");
  assert.equal(result.nextFocusedTabId, null);
  assert.equal(result.nextSplitView.paneState["pane-2"]?.activeTabId, null);
});
