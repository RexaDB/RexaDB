import { Effect } from "effect";
import { DbError } from "./effect/errors";

type StudioStorageActions = {
  getStudioFolders: (...args: any[]) => Promise<unknown>;
  saveStudioFolders: (...args: any[]) => Promise<unknown>;
  getStudioSnippets: (...args: any[]) => Promise<unknown>;
  saveStudioSnippets: (...args: any[]) => Promise<unknown>;
  getStudioHistory: (...args: any[]) => Promise<unknown>;
  saveStudioHistory: (...args: any[]) => Promise<unknown>;
  insertHistoryEntry: (...args: any[]) => Promise<unknown>;
  clearStudioHistory: (...args: any[]) => Promise<unknown>;
  getStudioTags: (...args: any[]) => Promise<unknown>;
  saveStudioTags: (...args: any[]) => Promise<unknown>;
  getStudioTableTags: (...args: any[]) => Promise<unknown>;
  saveStudioTableTags: (...args: any[]) => Promise<unknown>;
  getStudioTabs: (...args: any[]) => Promise<unknown>;
  saveStudioTabs: (...args: any[]) => Promise<unknown>;
  getStudioSettings: (...args: any[]) => Promise<unknown>;
  saveStudioSettings: (...args: any[]) => Promise<unknown>;
  getStudioDashboards: (...args: any[]) => Promise<unknown>;
  saveStudioDashboards: (...args: any[]) => Promise<unknown>;
  getStudioNotes: (...args: any[]) => Promise<unknown>;
  saveStudioNotes: (...args: any[]) => Promise<unknown>;
};

function fromStudioStorage<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Server-side Effect facade for actions-core Studio persistence operations. */
export function createStudioStorageEffects(actions: StudioStorageActions) {
  return {
    getFolders: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio folders",
      () => actions.getStudioFolders(connectionId),
    ),
    saveFolders: (connectionId: number, folders: unknown[]) => fromStudioStorage(
      "Failed to save Studio folders",
      () => actions.saveStudioFolders(connectionId, folders),
    ),
    getSnippets: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio snippets",
      () => actions.getStudioSnippets(connectionId),
    ),
    saveSnippets: (connectionId: number, snippets: unknown[]) => fromStudioStorage(
      "Failed to save Studio snippets",
      () => actions.saveStudioSnippets(connectionId, snippets),
    ),
    getHistory: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio history",
      () => actions.getStudioHistory(connectionId),
    ),
    saveHistory: (connectionId: number, history: unknown[]) => fromStudioStorage(
      "Failed to save Studio history",
      () => actions.saveStudioHistory(connectionId, history),
    ),
    insertHistoryEntry: (connectionId: number, entry: unknown) => fromStudioStorage(
      "Failed to insert Studio history entry",
      () => actions.insertHistoryEntry(connectionId, entry),
    ),
    clearHistory: (connectionId: number) => fromStudioStorage(
      "Failed to clear Studio history",
      () => actions.clearStudioHistory(connectionId),
    ),
    getTags: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio tags",
      () => actions.getStudioTags(connectionId),
    ),
    saveTags: (connectionId: number, tags: unknown[]) => fromStudioStorage(
      "Failed to save Studio tags",
      () => actions.saveStudioTags(connectionId, tags),
    ),
    getTableTags: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio table tags",
      () => actions.getStudioTableTags(connectionId),
    ),
    saveTableTags: (connectionId: number, tags: Record<string, string[]>) => fromStudioStorage(
      "Failed to save Studio table tags",
      () => actions.saveStudioTableTags(connectionId, tags),
    ),
    getTabs: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio tabs",
      () => actions.getStudioTabs(connectionId),
    ),
    saveTabs: (connectionId: number, tabs: unknown[]) => fromStudioStorage(
      "Failed to save Studio tabs",
      () => actions.saveStudioTabs(connectionId, tabs),
    ),
    getSettings: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio settings",
      () => actions.getStudioSettings(connectionId),
    ),
    saveSettings: (connectionId: number, settings: unknown) => fromStudioStorage(
      "Failed to save Studio settings",
      () => actions.saveStudioSettings(connectionId, settings),
    ),
    getDashboards: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio dashboards",
      () => actions.getStudioDashboards(connectionId),
    ),
    saveDashboards: (connectionId: number, payload: unknown) => fromStudioStorage(
      "Failed to save Studio dashboards",
      () => actions.saveStudioDashboards(connectionId, payload),
    ),
    getNotes: (connectionId: number) => fromStudioStorage(
      "Failed to fetch Studio notes",
      () => actions.getStudioNotes(connectionId),
    ),
    saveNotes: (connectionId: number, payload: unknown) => fromStudioStorage(
      "Failed to save Studio notes",
      () => actions.saveStudioNotes(connectionId, payload),
    ),
  };
}
