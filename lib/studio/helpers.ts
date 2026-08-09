import { toast } from "sonner";
import type { Snippet } from "./types";

export function copySqlToClipboard(sql: string, toastId?: string | number) {
  navigator.clipboard.writeText(sql.endsWith(";") ? sql : `${sql};`);
  toast.success("Copied", toastId != null ? { id: toastId } : undefined);
}

export function createSnippetAndPersist(
  name: string,
  query: string,
  folderId: string | null,
  connectionId: number,
  uid: () => string,
  setSnippets: React.Dispatch<React.SetStateAction<Snippet[]>>,
  saveFn: (id: number, snippets: any[]) => Promise<any>,
): Snippet {
  const newSnippet: Snippet = {
    id: uid(),
    name,
    query,
    folderId,
    createdAt: Date.now(),
  };
  let nextSnippets: Snippet[] = [];
  setSnippets(prev => {
    nextSnippets = [...prev, newSnippet];
    return nextSnippets;
  });
  saveFn(connectionId, nextSnippets).catch(() => {});
  return newSnippet;
}

export function validateAgentPrerequisites(apiKey: string, model: string) {
  if (!apiKey.trim() || !model.trim()) {
    throw new Error("Agent provider, API key, and model must be configured first.");
  }
}

export function mergeTableTabSnapshot(
  previous: Record<string, any> | undefined,
  snapshot: Record<string, any>,
) {
  return {
    ...previous,
    ...snapshot,
    results: snapshot.results ?? previous?.results ?? null,
    tableStructure: snapshot.tableStructure.length > 0 ? snapshot.tableStructure : (previous?.tableStructure ?? []),
    foreignKeys: snapshot.foreignKeys.length > 0 ? snapshot.foreignKeys : (previous?.foreignKeys ?? []),
    totalCount: snapshot.totalCount ?? previous?.totalCount ?? null,
    filterQuery: snapshot.filterQuery ?? previous?.filterQuery ?? "",
    sortConfig: snapshot.sortConfig ?? previous?.sortConfig ?? null,
    page: snapshot.page ?? previous?.page ?? 0,
    pageSize: snapshot.pageSize ?? previous?.pageSize ?? 25,
  };
}

export function filterDataForExport(
  rows: any[],
  selectedRows: Set<number>,
  emptyMessage = "No data available to export.",
  noSelectionMessage = "No rows selected to export.",
) {
  if (rows.length === 0) {
    toast.error(emptyMessage);
    return null;
  }
  const data = selectedRows.size > 0
    ? rows.filter((_: any, i: number) => selectedRows.has(i))
    : rows;
  if (data.length === 0) {
    toast.error(noSelectionMessage);
    return null;
  }
  return data;
}

export function closeResultTabsByDirection(
  state: any,
  anchorId: string,
  direction: "left" | "right",
) {
  const anchorIdx = state.resultTabs.findIndex((t: any) => t.id === anchorId);
  if (anchorIdx === -1) return null;
  const newTabs = direction === "right"
    ? state.resultTabs.slice(0, anchorIdx + 1)
    : state.resultTabs.slice(anchorIdx);
  const newActiveId = newTabs.find((t: any) => t.id === state.activeResultTabId) ? state.activeResultTabId : anchorId;
  return { newTabs, newActiveId };
}

export function refreshActiveTableStructure(
  connectionId: string,
  schema: string,
  table: string,
  fetchTableStructureFn: (connId: string, schema: string, table: string) => Promise<any>,
  fetchTableForeignKeysFn: (connId: string, schema: string, table: string) => Promise<any>,
  resolveActiveTableTabIdFn: (schema: string, table: string) => string | null,
  updateTableStructureCacheFn: (structRes: any, fkRes: any, tabId: string) => void,
) {
  return Promise.all([
    fetchTableStructureFn(connectionId, schema, table),
    fetchTableForeignKeysFn(connectionId, schema, table),
  ]).then(([structRes, fkRes]) => {
    const tabId = resolveActiveTableTabIdFn(schema, table) || `table-${schema}-${table}`;
    updateTableStructureCacheFn(structRes, fkRes, tabId);
  });
}
