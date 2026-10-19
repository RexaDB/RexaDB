import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createDatabaseActionEffects } from "../../server/database-actions-api";
import { DbError } from "../../server/effect/errors";
import { failureFromExit, runServerPromiseExit } from "../../server/effect/runtime";

function fakeActions(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return async () => ({ success: false, error: "operation failed" });
    },
  }) as any;
}

describe("database action Effects", () => {
  test("preserves SQL results and forwards query arguments", async () => {
    let received: unknown[] = [];
    const api = createDatabaseActionEffects(fakeActions({
      runQuery: async (...args: unknown[]) => {
        received = args;
        return { success: false, error: "syntax error" };
      },
    }));
    const result = await Effect.runPromise(api.runQuery("postgres://db", "bad sql", [1], { queryId: "q1" }));
    expect(result.success).toBe(false);
    expect(result.error).toBe("syntax error");
    expect(received).toEqual(["postgres://db", "bad sql", [1], { queryId: "q1" }]);
  });

  test("maps rejected table operations to DbError", async () => {
    const api = createDatabaseActionEffects(fakeActions({
      fetchTables: async () => { throw new Error("database unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.fetchTables("postgres://db", "public"));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("database unavailable");
  });
});
