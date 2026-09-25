import { useEffect, useMemo, useState } from "react";

interface PaneTabLike {
  id: string;
}

function arePaneOrdersEqual(
  current: Record<string, string[]>,
  next: Record<string, string[]>
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  if (currentKeys.length !== nextKeys.length) return false;

  for (const key of nextKeys) {
    const currentIds = current[key] ?? [];
    const nextIds = next[key] ?? [];

    if (currentIds.length !== nextIds.length) return false;
    if (currentIds.some((id, index) => id !== nextIds[index])) return false;
  }

  return true;
}

export function useStablePaneTabRenderOrder<T extends PaneTabLike>(
  paneTabsById: Record<string, T[]> | null | undefined
): Record<string, T[]> {
  const [stableTabOrderByPane, setStableTabOrderByPane] = useState<Record<string, string[]>>({});

  const safePaneTabsById: Record<string, T[]> = useMemo(
    () => (paneTabsById && typeof paneTabsById === "object" ? paneTabsById : {}),
    [paneTabsById],
  );

  const nextTabOrderByPane = useMemo(() => {
    return Object.fromEntries(
      Object.entries(safePaneTabsById).map(([paneId, tabs]) => {
        const safeTabs = Array.isArray(tabs) ? tabs : [];
        const currentIds = safeTabs.map((tab) => tab.id);
        const currentIdSet = new Set(currentIds);
        const previousIds = stableTabOrderByPane[paneId] ?? [];
        const keptIds = previousIds.filter((id) => currentIdSet.has(id));
        const keptIdSet = new Set(keptIds);
        const addedIds = currentIds.filter((id) => !keptIdSet.has(id));

        return [paneId, [...keptIds, ...addedIds]];
      })
    );
  }, [safePaneTabsById, stableTabOrderByPane]);

  useEffect(() => {
    if (arePaneOrdersEqual(stableTabOrderByPane, nextTabOrderByPane)) return;
    setStableTabOrderByPane(nextTabOrderByPane);
  }, [nextTabOrderByPane, stableTabOrderByPane]);

  return useMemo(() => {
    return Object.fromEntries(
      Object.entries(safePaneTabsById).map(([paneId, tabs]) => {
        const safeTabs = Array.isArray(tabs) ? tabs : [];
        const tabsById = new Map(safeTabs.map((tab) => [tab.id, tab]));
        const orderedTabs = (nextTabOrderByPane[paneId] ?? [])
          .map((tabId) => tabsById.get(tabId))
          .filter((tab): tab is T => Boolean(tab));

        return [paneId, orderedTabs];
      })
    );
  }, [nextTabOrderByPane, safePaneTabsById]);
}
