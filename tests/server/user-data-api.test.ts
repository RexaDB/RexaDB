import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createUserDataEffects } from "../../server/user-data-api";
import { DbError } from "../../server/effect/errors";
import { failureFromExit, runServerPromiseExit } from "../../server/effect/runtime";

function fakeActions(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return async () => ({ success: true });
    },
  }) as any;
}

describe("user data Effects", () => {
  test("preserves typed profile and analytics values", async () => {
    let profileId: string | null | undefined;
    let analyticsArgs: unknown[] = [];
    const api = createUserDataEffects(fakeActions({
      getStoredUserProfile: async (id: string | null) => {
        profileId = id;
        return { success: true, data: { id: "user-1" } };
      },
      getConnectionAnalytics: async (connectionId: number, range?: string) => {
        analyticsArgs = [connectionId, range];
        return { success: true, data: { totalQueries: 3 } };
      },
    }));

    const profile = await Effect.runPromise(api.getProfile("user-1"));
    expect(profile.success).toBe(true);
    expect(profileId).toBe("user-1");
    const analytics = await Effect.runPromise(api.getConnectionAnalytics(9, "7d"));
    expect(analytics.data?.totalQueries).toBe(3);
    expect(analyticsArgs).toEqual([9, "7d"]);
  });

  test("maps rejected actions-core calls to DbError", async () => {
    const api = createUserDataEffects(fakeActions({
      getUserAnalytics: async () => { throw new Error("analytics unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.getUserAnalytics());
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("analytics unavailable");
  });
});
