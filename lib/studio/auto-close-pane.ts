import {
  getPaneIds,
  getTabsForPane,
  type StudioPaneId,
  type StudioSplitViewState,
} from "@/lib/studio/split-layout";
import { resolvePaneCloseState, type PaneCloseStateResult } from "@/lib/studio/pane-close";

type TabLike = { id: string };

export type AutoCloseResult<TTab extends TabLike> =
  | ({ didClose: true } & PaneCloseStateResult<TTab>)
  | { didClose: false };

export function tryAutoClosePane<TTab extends TabLike>(
  tabs: TTab[],
  splitView: StudioSplitViewState,
  closedPaneId: StudioPaneId
): AutoCloseResult<TTab> {
  const paneTabsAfterClose = getTabsForPane(
    tabs.map((t) => t.id),
    splitView,
    closedPaneId
  );
  if (paneTabsAfterClose.length === 0 && getPaneIds(splitView.root).length > 1) {
    return { didClose: true, ...resolvePaneCloseState(tabs, splitView, closedPaneId) };
  }
  return { didClose: false };
}

export function tryAutoCloseEmptyPanes<TTab extends TabLike>(
  tabs: TTab[],
  splitView: StudioSplitViewState
): AutoCloseResult<TTab> {
  if (getPaneIds(splitView.root).length <= 1) {
    return { didClose: false };
  }
  const paneIds = getPaneIds(splitView.root);
  for (const paneId of paneIds) {
    const paneTabs = getTabsForPane(tabs.map((t) => t.id), splitView, paneId);
    if (paneTabs.length === 0) {
      return { didClose: true, ...resolvePaneCloseState(tabs, splitView, paneId) };
    }
  }
  return { didClose: false };
}
