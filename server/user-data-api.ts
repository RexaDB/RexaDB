import { Effect } from "effect";
import { DbError } from "./effect/errors";

type UserDataActionNames =
  | "upsertUserProfile"
  | "deleteUserProfile"
  | "clearAllUsers"
  | "getAllUsers"
  | "getStoredUserProfile"
  | "logAppError"
  | "getUserAnalytics"
  | "getConnectionAnalytics";

type UserDataActions = Pick<typeof import("../lib/db/actions-core"), UserDataActionNames>;

function fromUserDataAction<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Effect facade for actions-core user profile, error log, and analytics APIs. */
export function createUserDataEffects(actions: UserDataActions) {
  return {
    upsertProfile: (...args: Parameters<UserDataActions["upsertUserProfile"]>) => fromUserDataAction(
      "Failed to save user profile",
      () => actions.upsertUserProfile(...args),
    ),
    deleteProfile: (...args: Parameters<UserDataActions["deleteUserProfile"]>) => fromUserDataAction(
      "Failed to delete user profile",
      () => actions.deleteUserProfile(...args),
    ),
    clearProfiles: (...args: Parameters<UserDataActions["clearAllUsers"]>) => fromUserDataAction(
      "Failed to clear user profiles",
      () => actions.clearAllUsers(...args),
    ),
    getAllProfiles: (...args: Parameters<UserDataActions["getAllUsers"]>) => fromUserDataAction(
      "Failed to list user profiles",
      () => actions.getAllUsers(...args),
    ),
    getProfile: (...args: Parameters<UserDataActions["getStoredUserProfile"]>) => fromUserDataAction(
      "Failed to fetch user profile",
      () => actions.getStoredUserProfile(...args),
    ),
    logAppError: (...args: Parameters<UserDataActions["logAppError"]>) => fromUserDataAction(
      "Failed to log application error",
      () => actions.logAppError(...args),
    ),
    getUserAnalytics: (...args: Parameters<UserDataActions["getUserAnalytics"]>) => fromUserDataAction(
      "Failed to fetch user analytics",
      () => actions.getUserAnalytics(...args),
    ),
    getConnectionAnalytics: (...args: Parameters<UserDataActions["getConnectionAnalytics"]>) => fromUserDataAction(
      "Failed to fetch connection analytics",
      () => actions.getConnectionAnalytics(...args),
    ),
  };
}
