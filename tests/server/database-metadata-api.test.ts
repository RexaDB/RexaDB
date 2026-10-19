import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createDatabaseMetadataEffects } from "../../server/database-metadata-api";
import { DbError } from "../../server/effect/errors";
import { failureFromExit, runServerPromiseExit } from "../../server/effect/runtime";

function fakeActions(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return async () => ({ success: true, data: [] });
    },
  }) as any;
}

describe("database metadata Effects", () => {
  test("preserves results and forwards optional metadata arguments", async () => {
    let received: unknown[] = [];
    const api = createDatabaseMetadataEffects(fakeActions({
      fetchRlsPolicies: async (...args: unknown[]) => {
        received = args;
        return { success: true, data: [{ name: "policy" }] };
      },
    }));

    const result = await Effect.runPromise(api.fetchRlsPolicies("postgres://db", "public", "users"));
    expect((result as any).data).toEqual([{ name: "policy" }]);
    expect(received).toEqual(["postgres://db", "public", "users"]);
  });

  test("maps rejected metadata operations to DbError", async () => {
    const api = createDatabaseMetadataEffects(fakeActions({
      fetchIndexes: async () => { throw new Error("metadata unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.fetchIndexes("postgres://db", "public"));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("metadata unavailable");
  });
});
