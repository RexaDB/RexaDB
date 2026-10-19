import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createStudioStorageEffects } from "../../server/studio-storage-api";
import { DbError } from "../../server/effect/errors";
import { failureFromExit, runServerPromiseExit } from "../../server/effect/runtime";

function fakeActions(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return async (...args: unknown[]) => ({ action: property, args });
    },
  }) as any;
}

describe("Studio storage Effects", () => {
  test("preserves Promise facade result values and arguments", async () => {
    let received: unknown[] = [];
    const api = createStudioStorageEffects(fakeActions({
      saveStudioFolders: async (...args: unknown[]) => {
        received = args;
        return { success: true };
      },
    }));
    const result = await Effect.runPromise(api.saveFolders(42, [{ id: "folder-1" }]));
    expect(result).toEqual({ success: true });
    expect(received).toEqual([42, [{ id: "folder-1" }]]);
  });

  test("maps rejected actions-core calls to DbError", async () => {
    const api = createStudioStorageEffects(fakeActions({
      getStudioSnippets: async () => { throw new Error("storage unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.getSnippets(7));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("Failed to fetch Studio snippets");
    expect(error.message).toContain("storage unavailable");
  });
});
