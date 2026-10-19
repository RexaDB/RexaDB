import { Effect } from "effect";
import { DbError } from "./effect/errors";

type StudioStorageActionNames =
  | "getStudioFolders"
  | "saveStudioFolders"
  | "getStudioSnippets"
  | "saveStudioSnippets"
  | "getStudioHistory"
  | "saveStudioHistory"
  | "insertHistoryEntry"
  | "clearStudioHistory"
  | "getStudioTags"
  | "saveStudioTags"
  | "getStudioTableTags"
  | "saveStudioTableTags"
  | "getStudioTabs"
  | "saveStudioTabs"
  | "getStudioSettings"
  | "saveStudioSettings"
  | "getStudioDashboards"
  | "saveStudioDashboards"
  | "getStudioNotes"
  | "saveStudioNotes";

type StudioStorageActions = Pick<
  typeof import("../lib/db/actions-core"),
  StudioStorageActionNames
>;

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
    getFolders: (...args: Parameters<StudioStorageActions["getStudioFolders"]>) => fromStudioStorage(
      "Failed to fetch Studio folders",
      () => actions.getStudioFolders(...args),
    ),
    saveFolders: (...args: Parameters<StudioStorageActions["saveStudioFolders"]>) => fromStudioStorage(
      "Failed to save Studio folders",
      () => actions.saveStudioFolders(...args),
    ),
    getSnippets: (...args: Parameters<StudioStorageActions["getStudioSnippets"]>) => fromStudioStorage(
      "Failed to fetch Studio snippets",
      () => actions.getStudioSnippets(...args),
    ),
    saveSnippets: (...args: Parameters<StudioStorageActions["saveStudioSnippets"]>) => fromStudioStorage(
      "Failed to save Studio snippets",
      () => actions.saveStudioSnippets(...args),
    ),
    getHistory: (...args: Parameters<StudioStorageActions["getStudioHistory"]>) => fromStudioStorage(
      "Failed to fetch Studio history",
      () => actions.getStudioHistory(...args),
    ),
    saveHistory: (...args: Parameters<StudioStorageActions["saveStudioHistory"]>) => fromStudioStorage(
      "Failed to save Studio history",
      () => actions.saveStudioHistory(...args),
    ),
    insertHistoryEntry: (...args: Parameters<StudioStorageActions["insertHistoryEntry"]>) => fromStudioStorage(
      "Failed to insert Studio history entry",
      () => actions.insertHistoryEntry(...args),
    ),
    clearHistory: (...args: Parameters<StudioStorageActions["clearStudioHistory"]>) => fromStudioStorage(
      "Failed to clear Studio history",
      () => actions.clearStudioHistory(...args),
    ),
    getTags: (...args: Parameters<StudioStorageActions["getStudioTags"]>) => fromStudioStorage(
      "Failed to fetch Studio tags",
      () => actions.getStudioTags(...args),
    ),
    saveTags: (...args: Parameters<StudioStorageActions["saveStudioTags"]>) => fromStudioStorage(
      "Failed to save Studio tags",
      () => actions.saveStudioTags(...args),
    ),
    getTableTags: (...args: Parameters<StudioStorageActions["getStudioTableTags"]>) => fromStudioStorage(
      "Failed to fetch Studio table tags",
      () => actions.getStudioTableTags(...args),
    ),
    saveTableTags: (...args: Parameters<StudioStorageActions["saveStudioTableTags"]>) => fromStudioStorage(
      "Failed to save Studio table tags",
      () => actions.saveStudioTableTags(...args),
    ),
    getTabs: (...args: Parameters<StudioStorageActions["getStudioTabs"]>) => fromStudioStorage(
      "Failed to fetch Studio tabs",
      () => actions.getStudioTabs(...args),
    ),
    saveTabs: (...args: Parameters<StudioStorageActions["saveStudioTabs"]>) => fromStudioStorage(
      "Failed to save Studio tabs",
      () => actions.saveStudioTabs(...args),
    ),
    getSettings: (...args: Parameters<StudioStorageActions["getStudioSettings"]>) => fromStudioStorage(
      "Failed to fetch Studio settings",
      () => actions.getStudioSettings(...args),
    ),
    saveSettings: (...args: Parameters<StudioStorageActions["saveStudioSettings"]>) => fromStudioStorage(
      "Failed to save Studio settings",
      () => actions.saveStudioSettings(...args),
    ),
    getDashboards: (...args: Parameters<StudioStorageActions["getStudioDashboards"]>) => fromStudioStorage(
      "Failed to fetch Studio dashboards",
      () => actions.getStudioDashboards(...args),
    ),
    saveDashboards: (...args: Parameters<StudioStorageActions["saveStudioDashboards"]>) => fromStudioStorage(
      "Failed to save Studio dashboards",
      () => actions.saveStudioDashboards(...args),
    ),
    getNotes: (...args: Parameters<StudioStorageActions["getStudioNotes"]>) => fromStudioStorage(
      "Failed to fetch Studio notes",
      () => actions.getStudioNotes(...args),
    ),
    saveNotes: (...args: Parameters<StudioStorageActions["saveStudioNotes"]>) => fromStudioStorage(
      "Failed to save Studio notes",
      () => actions.saveStudioNotes(...args),
    ),
  };
}
