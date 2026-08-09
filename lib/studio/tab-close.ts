import {
  activatePane,
  getTabsForPane,
  normalizeSplitLayout,
  resolvePaneForTab,
  type StudioSplitViewState,
} from "@/lib/studio/split-layout";

type TabLike = {
  id: string;
  type?: string;
  baseId?: string;
};

export interface ResolveTabCloseStateParams<TTab extends TabLike> {
  activeTabId: string | null;
  closedTabId: string;
  openTabs: TTab[];
  splitView: StudioSplitViewState;
}

export interface TabCloseStateResult<TTab extends TabLike> {
  closedPaneId: string;
  nextFocusedTab: TTab | null;
  nextFocusedTabId: string | null;
  nextSplitView: StudioSplitViewState;
  nextTabs: TTab[];
}

export function filterTabsAfterClose<TTab extends TabLike>(
  openTabs: TTab[],
  closedTab: TTab,
  getTabBaseId: (tab: TTab) => string
): TTab[] {
  void getTabBaseId;
  return openTabs.filter((tab) => tab.id !== closedTab.id);
}

export function resolveTabCloseState<TTab extends TabLike>({
  activeTabId,
  closedTabId,
  openTabs,
  splitView,
}: ResolveTabCloseStateParams<TTab>): TabCloseStateResult<TTab> {
  const wasClosingActiveTab = activeTabId === closedTabId;
  const nextTabs = openTabs.filter((tab) => tab.id !== closedTabId);
  const closedPaneId = resolvePaneForTab(splitView, closedTabId);
  const nextTabPaneMap = { ...splitView.tabPaneMap };
  delete nextTabPaneMap[closedTabId];

  const normalized = normalizeSplitLayout(
    { ...splitView, tabPaneMap: nextTabPaneMap },
    nextTabs.map((tab) => tab.id),
    wasClosingActiveTab ? null : activeTabId
  );

  const originalPaneTabIds = getTabsForPane(
    openTabs.map((tab) => tab.id),
    splitView,
    closedPaneId
  );
  const closedIndex = originalPaneTabIds.indexOf(closedTabId);

  const nextPaneTabs = getTabsForPane(
    nextTabs.map((tab) => tab.id),
    normalized,
    closedPaneId
  );
  const nextPaneActiveTabId = closedIndex > 0
    ? nextPaneTabs[Math.min(closedIndex - 1, nextPaneTabs.length - 1)] ?? null
    : nextPaneTabs[0] ?? null;
  const targetPaneId = wasClosingActiveTab ? closedPaneId : normalized.activePaneId;
  const targetTabId = wasClosingActiveTab
    ? nextPaneActiveTabId
    : normalized.paneState[normalized.activePaneId]?.activeTabId ?? null;

  const nextSplitView = activatePane(normalized, targetPaneId, targetTabId);
  const nextFocusedTabId = wasClosingActiveTab
    ? targetTabId
    : activeTabId;

  return {
    closedPaneId,
    nextFocusedTab: nextTabs.find((tab) => tab.id === nextFocusedTabId) ?? null,
    nextFocusedTabId,
    nextSplitView,
    nextTabs,
  };
}
