import {
  closePane,
  normalizeSplitLayout,
  resolvePaneForTab,
  type StudioSplitViewState,
} from "@/lib/studio/split-layout";

type TabLike = { id: string };

export function partitionTabsByPane<TTab extends TabLike>(
  openTabs: TTab[],
  splitView: StudioSplitViewState,
  paneId: string
): { remainingTabs: TTab[]; removedTabs: TTab[] } {
  const remainingTabs: TTab[] = [];
  const removedTabs: TTab[] = [];

  for (const tab of openTabs) {
    if (resolvePaneForTab(splitView, tab.id) === paneId) {
      removedTabs.push(tab);
    } else {
      remainingTabs.push(tab);
    }
  }

  return { remainingTabs, removedTabs };
}

export interface PaneCloseStateResult<TTab extends TabLike> {
  nextActiveTabId: string | null;
  nextSplitView: StudioSplitViewState;
  remainingTabs: TTab[];
  removedTabs: TTab[];
}

export function resolvePaneCloseState<TTab extends TabLike>(
  openTabs: TTab[],
  splitView: StudioSplitViewState,
  paneId: string
): PaneCloseStateResult<TTab> {
  const { remainingTabs, removedTabs } = partitionTabsByPane(openTabs, splitView, paneId);
  const nextSplitView = normalizeSplitLayout(
    closePane(splitView, paneId, remainingTabs.map((tab) => tab.id)),
    remainingTabs.map((tab) => tab.id),
    null
  );

  return {
    nextActiveTabId: nextSplitView.paneState[nextSplitView.activePaneId]?.activeTabId ?? null,
    nextSplitView,
    remainingTabs,
    removedTabs,
  };
}
