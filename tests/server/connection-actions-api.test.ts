import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createConnectionActionEffects } from "../../server/connection-actions-api";
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

describe("connection action Effects", () => {
  test("preserves connection group results and forwards arguments", async () => {
    let received: unknown[] = [];
    const api = createConnectionActionEffects(fakeActions({
      renameConnectionGroup: async (...args: unknown[]) => {
        received = args;
        return { success: true, data: "Renamed" };
      },
    }));
    const result = await Effect.runPromise(api.renameConnectionGroup("old", "new"));
    expect((result as any).data).toBe("Renamed");
    expect(received).toEqual(["old", "new"]);
  });

  test("maps rejected connection calls to DbError", async () => {
    const api = createConnectionActionEffects(fakeActions({
      getConnection: async () => { throw new Error("connection store unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.getConnection(3));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("connection store unavailable");
  });
});
