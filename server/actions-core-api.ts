import { Effect } from "effect";
import { DbError } from "./effect/errors";

type RemainingActionNames =
  | "updateUserPlan" | "getStoredUserEntitlement" | "upsertUserEntitlement" | "deleteAiChat"
  | "createSnippetVersion" | "getSnippetVersions" | "restoreSnippetVersion" | "getStudioBootstrap"
  | "createSnapshot" | "listSnapshots" | "getSnapshot" | "getSnapshotFull" | "deleteSnapshot" | "compareSnapshots";
type RemainingActions = Pick<typeof import("../lib/db/actions-core"), RemainingActionNames>;

function fromActionsCore<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

export function createActionsCoreEffects(actions: RemainingActions) {
  const wrap = <Name extends RemainingActionNames>(name: Name) =>
    (...args: Parameters<RemainingActions[Name]>) => fromActionsCore(
      `Failed to ${name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`,
      () => (actions[name] as unknown as (...values: any[]) => Promise<any>)(...args),
    );
  return {
    updateUserPlan: wrap("updateUserPlan"),
    getStoredUserEntitlement: wrap("getStoredUserEntitlement"),
    upsertUserEntitlement: wrap("upsertUserEntitlement"),
    deleteAiChat: wrap("deleteAiChat"),
    createSnippetVersion: wrap("createSnippetVersion"),
    getSnippetVersions: wrap("getSnippetVersions"),
    restoreSnippetVersion: wrap("restoreSnippetVersion"),
    getStudioBootstrap: wrap("getStudioBootstrap"),
    createSnapshot: wrap("createSnapshot"),
    listSnapshots: wrap("listSnapshots"),
    getSnapshot: wrap("getSnapshot"),
    getSnapshotFull: wrap("getSnapshotFull"),
    deleteSnapshot: wrap("deleteSnapshot"),
    compareSnapshots: wrap("compareSnapshots"),
  };
}
