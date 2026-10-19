import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createActionsCoreEffects } from "../../server/actions-core-api";
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

describe("remaining actions-core Effects", () => {
  test("preserves snapshot values and forwards arguments", async () => {
    let received: unknown[] = [];
    const api = createActionsCoreEffects(fakeActions({
      compareSnapshots: async (...args: unknown[]) => {
        received = args;
        return { success: true, data: { added: [] } };
      },
    }));
    const result = await Effect.runPromise(api.compareSnapshots("17", "old", "new"));
    expect((result as any).data).toEqual({ added: [] });
    expect(received).toEqual(["17", "old", "new"]);
  });

  test("maps rejected actions-core calls to DbError", async () => {
    const api = createActionsCoreEffects(fakeActions({
      deleteAiChat: async () => { throw new Error("chat store unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.deleteAiChat("chat-1"));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("chat store unavailable");
  });
});
