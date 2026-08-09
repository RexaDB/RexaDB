export type StudioPaneId = string;
export type StudioSplitDirection = "vertical" | "horizontal";

export interface StudioPaneNode {
  type: "pane";
  id: StudioPaneId;
}

export interface StudioSplitBranchNode {
  type: "split";
  id: string;
  direction: StudioSplitDirection;
  ratio: number;
  first: StudioSplitNode;
  second: StudioSplitNode;
}

export type StudioSplitNode = StudioPaneNode | StudioSplitBranchNode;

export interface StudioPaneState {
  activeTabId: string | null;
}

export interface StudioSplitViewState {
  enabled: boolean;
  root: StudioSplitNode;
  activePaneId: StudioPaneId;
  paneState: Record<StudioPaneId, StudioPaneState>;
  tabPaneMap: Record<string, StudioPaneId>;
  nextPaneNumber: number;
  nextSplitNumber: number;
}

const PANE_TAB_DELIMITER = "::pane::";

export function createDefaultSplitLayout(activeTabId: string | null): StudioSplitViewState {
  return {
    enabled: false,
    root: { type: "pane", id: "pane-1" },
    activePaneId: "pane-1",
    paneState: {
      "pane-1": { activeTabId },
    },
    tabPaneMap: {},
    nextPaneNumber: 2,
    nextSplitNumber: 1,
  };
}

export function getPaneIds(node: StudioSplitNode): StudioPaneId[] {
  if (node.type === "pane") return [node.id];
  return [...getPaneIds(node.first), ...getPaneIds(node.second)];
}

export function getFirstPaneId(node: StudioSplitNode): StudioPaneId {
  return node.type === "pane" ? node.id : getFirstPaneId(node.first);
}

function inferPaneIdFromTabId(
  tabId: string,
  paneIds: StudioPaneId[]
): StudioPaneId | null {
  const rawTabId = String(tabId || "");
  const paneSuffixIndex = rawTabId.indexOf(PANE_TAB_DELIMITER);
  if (paneSuffixIndex < 0) return null;
  const encodedPaneId = rawTabId
    .slice(paneSuffixIndex + PANE_TAB_DELIMITER.length)
    .split(PANE_TAB_DELIMITER)[0];
  return paneIds.includes(encodedPaneId) ? encodedPaneId : null;
}

export function resolvePaneForTab(
  state: StudioSplitViewState,
  tabId: string
): StudioPaneId {
  const paneIds = getPaneIds(state.root);
  const mappedPaneId = state.tabPaneMap[tabId];
  if (mappedPaneId && paneIds.includes(mappedPaneId)) {
    return mappedPaneId;
  }
  return inferPaneIdFromTabId(tabId, paneIds) ?? getFirstPaneId(state.root);
}

export function assignTabToPane(
  state: StudioSplitViewState,
  tabId: string,
  paneId: StudioPaneId,
  activate = false
): StudioSplitViewState {
  return {
    ...state,
    activePaneId: activate ? paneId : state.activePaneId,
    tabPaneMap: { ...state.tabPaneMap, [tabId]: paneId },
    paneState: {
      ...state.paneState,
      [paneId]: {
        activeTabId: activate ? tabId : (state.paneState[paneId]?.activeTabId ?? tabId),
      },
    },
  };
}

export function activatePane(
  state: StudioSplitViewState,
  paneId: StudioPaneId,
  tabId: string | null
): StudioSplitViewState {
  return {
    ...state,
    activePaneId: paneId,
    paneState: {
      ...state.paneState,
      [paneId]: { activeTabId: tabId },
    },
  };
}

function splitNodeAt(
  node: StudioSplitNode,
  paneId: StudioPaneId,
  branchId: string,
  newPaneId: StudioPaneId,
  direction: StudioSplitDirection = "vertical",
  splitOnRightOrBottom: boolean = false
): StudioSplitNode {
  if (node.type === "pane") {
    if (node.id !== paneId) return node;
    if (splitOnRightOrBottom) {
      return {
        type: "split",
        id: branchId,
        direction,
        ratio: 0.5,
        first: { type: "pane", id: newPaneId },
        second: node,
      };
    }
    return {
      type: "split",
      id: branchId,
      direction,
      ratio: 0.5,
      first: node,
      second: { type: "pane", id: newPaneId },
    };
  }
  return {
    ...node,
    first: splitNodeAt(node.first, paneId, branchId, newPaneId, direction, splitOnRightOrBottom),
    second: splitNodeAt(node.second, paneId, branchId, newPaneId, direction, splitOnRightOrBottom),
  };
}

export function splitPane(state: StudioSplitViewState, paneId: StudioPaneId, direction?: StudioSplitDirection, splitOnRightOrBottom: boolean = false): StudioSplitViewState {
  const newPaneId = `pane-${state.nextPaneNumber}`;
  const branchId = `split-${state.nextSplitNumber}`;
  return {
    ...state,
    enabled: true,
    root: splitNodeAt(state.root, paneId, branchId, newPaneId, direction || "vertical", splitOnRightOrBottom),
    activePaneId: newPaneId,
    paneState: {
      ...state.paneState,
      [newPaneId]: { activeTabId: null },
    },
    nextPaneNumber: state.nextPaneNumber + 1,
    nextSplitNumber: state.nextSplitNumber + 1,
  };
}

interface RemovePaneResult {
  node: StudioSplitNode | null;
  siblingPaneId: StudioPaneId | null;
}

function removePaneFromNode(node: StudioSplitNode, paneId: StudioPaneId): RemovePaneResult {
  if (node.type === "pane") {
    return node.id === paneId ? { node: null, siblingPaneId: null } : { node, siblingPaneId: null };
  }

  const left = removePaneFromNode(node.first, paneId);
  if (left.node === null) {
    return { node: node.second, siblingPaneId: getFirstPaneId(node.second) };
  }
  if (left.node !== node.first) {
    return {
      node: { ...node, first: left.node },
      siblingPaneId: left.siblingPaneId,
    };
  }

  const right = removePaneFromNode(node.second, paneId);
  if (right.node === null) {
    return { node: node.first, siblingPaneId: getFirstPaneId(node.first) };
  }
  if (right.node !== node.second) {
    return {
      node: { ...node, second: right.node },
      siblingPaneId: right.siblingPaneId,
    };
  }

  return { node, siblingPaneId: null };
}

export function closePane(
  state: StudioSplitViewState,
  paneId: StudioPaneId,
  openTabIds: string[]
): StudioSplitViewState {
  const paneIds = getPaneIds(state.root);
  if (paneIds.length <= 1 || !paneIds.includes(paneId)) {
    return state;
  }

  const removed = removePaneFromNode(state.root, paneId);
  if (!removed.node || !removed.siblingPaneId) {
    return state;
  }

  const nextPaneState = { ...state.paneState };
  delete nextPaneState[paneId];
  if (!nextPaneState[removed.siblingPaneId]) {
    nextPaneState[removed.siblingPaneId] = { activeTabId: null };
  }

  return {
    ...state,
    enabled: getPaneIds(removed.node).length > 1,
    root: removed.node,
    activePaneId: removed.siblingPaneId,
    paneState: nextPaneState,
    tabPaneMap: Object.fromEntries(Object.entries(state.tabPaneMap).filter(([tabId]) => openTabIds.includes(tabId))),
  };
}

export function updateSplitRatio(
  state: StudioSplitViewState,
  splitId: string,
  ratio: number
): StudioSplitViewState {
  const updateNode = (node: StudioSplitNode): StudioSplitNode => {
    if (node.type === "pane") return node;
    if (node.id === splitId) {
      return { ...node, ratio };
    }
    return {
      ...node,
      first: updateNode(node.first),
      second: updateNode(node.second),
    };
  };

  return {
    ...state,
    root: updateNode(state.root),
  };
}

export function getTabsForPane(
  tabIds: string[],
  state: StudioSplitViewState,
  paneId: StudioPaneId
): string[] {
  return tabIds.filter((tabId) => resolvePaneForTab(state, tabId) === paneId);
}

export function normalizeSplitLayout(
  state: StudioSplitViewState,
  openTabIds: string[],
  fallbackActiveTabId: string | null
): StudioSplitViewState {
  const paneIds = getPaneIds(state.root);
  const fallbackPaneId = paneIds[0] ?? "pane-1";
  const openTabIdSet = new Set(openTabIds);
  const nextTabPaneMap: Record<string, StudioPaneId> = {};

  for (const tabId of openTabIds) {
    const resolvedPaneId = resolvePaneForTab(state, tabId);
    nextTabPaneMap[tabId] = paneIds.includes(resolvedPaneId) ? resolvedPaneId : fallbackPaneId;
  }

  const nextPaneState: Record<StudioPaneId, StudioPaneState> = {};
  for (const paneId of paneIds) {
    const paneTabs = getTabsForPane(openTabIds, { ...state, tabPaneMap: nextTabPaneMap }, paneId);
    const candidate = state.paneState[paneId]?.activeTabId;
    nextPaneState[paneId] = {
      activeTabId: candidate && openTabIdSet.has(candidate) && paneTabs.includes(candidate)
        ? candidate
        : (paneTabs[0] ?? null),
    };
  }

  const nextActivePaneId = paneIds.includes(state.activePaneId) ? state.activePaneId : fallbackPaneId;
  const nextEnabled = paneIds.length > 1;
  const nextState: StudioSplitViewState = {
    ...state,
    enabled: nextEnabled,
    activePaneId: nextActivePaneId,
    paneState: nextPaneState,
    tabPaneMap: nextTabPaneMap,
  };

  if (fallbackActiveTabId) {
    const fallbackPaneForTab = nextTabPaneMap[fallbackActiveTabId];
    if (fallbackPaneForTab && nextPaneState[fallbackPaneForTab]) {
      nextState.activePaneId = fallbackPaneForTab;
      nextPaneState[fallbackPaneForTab] = { activeTabId: fallbackActiveTabId };
    }
  }

  const sameActivePane = nextState.activePaneId === state.activePaneId;
  const sameEnabled = nextState.enabled === state.enabled;
  const samePaneState = JSON.stringify(nextState.paneState) === JSON.stringify(state.paneState);
  const sameTabPaneMap = JSON.stringify(nextState.tabPaneMap) === JSON.stringify(state.tabPaneMap);
  return sameActivePane && sameEnabled && samePaneState && sameTabPaneMap ? state : nextState;
}

export function getPaneIdAtPosition(
  node: StudioSplitNode,
  x: number,
  y: number,
  width: number,
  height: number
): StudioPaneId | null {
  if (node.type === "pane") {
    return node.id;
  }

  const splitX = width * node.ratio;
  const splitY = height * node.ratio;

  if (node.direction === "vertical") {
    if (x < splitX) {
      return getPaneIdAtPosition(node.first, x, y, splitX, height);
    } else {
      return getPaneIdAtPosition(node.second, x - splitX, y, width - splitX, height);
    }
  } else {
    if (y < splitY) {
      return getPaneIdAtPosition(node.first, x, y, width, splitY);
    } else {
      return getPaneIdAtPosition(node.second, x, y - splitY, width, height - splitY);
    }
  }
}

export function getDropPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  paneId: StudioPaneId,
  splitView: StudioSplitViewState
): DropPosition {
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = x - centerX;
  const dy = y - centerY;

  if (Math.abs(dx) < width * 0.05 && Math.abs(dy) < height * 0.05) {
    return "center";
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;

  if (Math.abs(dx) / halfWidth > Math.abs(dy) / halfHeight) {
    return dx < 0 ? "left" : "right";
  } else {
    return dy < 0 ? "top" : "bottom";
  }
}

export type DropPosition = "left" | "right" | "top" | "bottom" | "center" | null;
