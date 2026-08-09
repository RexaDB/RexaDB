type TableLikeTab = {
  id: string;
  type?: string;
};

export function getActiveTableLoadingTabId(
  openTabs: TableLikeTab[],
  activeTabId: string | null
) {
  if (!activeTabId) return null;
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  return activeTab?.type === "table" ? activeTab.id : null;
}

export function shouldShowInactivePaneTableLoading(
  tabType: string | undefined,
  cachedResults: unknown
) {
  return tabType === "table" && !cachedResults;
}

type InactivePaneFallbackArgs = {
  activeTabId: string | null;
  tabType: string | undefined;
  tabSchema: string | null | undefined;
  tabName: string | null | undefined;
  selectedSchema: string | null | undefined;
  selectedTable: string | null | undefined;
};

export function shouldUseVisibleTableStateForInactivePane({
  activeTabId,
  tabType,
  tabSchema,
  tabName,
  selectedSchema,
  selectedTable,
}: InactivePaneFallbackArgs) {
  return !activeTabId
    && tabType === "table"
    && tabSchema === selectedSchema
    && tabName === selectedTable;
}

type SnapshotCandidateTab = {
  id: string;
  type?: string;
  schema?: string | null;
  name?: string | null;
};

type PreservedInactiveTableArgs = {
  openTabs: SnapshotCandidateTab[];
  activeTabId: string | null;
  selectedSchema: string | null | undefined;
  selectedTable: string | null | undefined;
  targetPaneId: string;
  getPaneIdForTab: (tabId: string) => string;
};

export function findPreservedInactiveTableTabId({
  openTabs,
  activeTabId,
  selectedSchema,
  selectedTable,
  targetPaneId,
  getPaneIdForTab,
}: PreservedInactiveTableArgs) {
  if (activeTabId || !selectedSchema || !selectedTable) return null;
  const match = openTabs.find((tab) =>
    tab.type === "table"
    && tab.schema === selectedSchema
    && tab.name === selectedTable
    && getPaneIdForTab(tab.id) !== targetPaneId
  );
  return match?.id ?? null;
}
