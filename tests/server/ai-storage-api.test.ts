import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createAiStorageEffects } from "../../server/ai-storage-api";
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

describe("AI storage Effects", () => {
  test("preserves typed AI settings and message result values", async () => {
    const api = createAiStorageEffects(fakeActions({
      getGlobalAiSettings: async () => ({ success: true, data: {
        permissionMode: "schema_only",
        providers: {},
        defaultProvider: "openai",
        defaultModel: "gpt-test",
      } }),
      appendAiChatMessage: async () => ({ success: true }),
    }));

    const settings = await Effect.runPromise(api.getSettings());
    expect(settings.success).toBe(true);
    if (settings.success) expect(settings.data?.defaultModel).toBe("gpt-test");
    const appended = await Effect.runPromise(api.appendMessage({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      content: "hello",
      timestamp: 1,
    }));
    expect(appended.success).toBe(true);
  });

  test("maps rejected actions-core calls to DbError", async () => {
    const api = createAiStorageEffects(fakeActions({
      listAiChats: async () => { throw new Error("chat store unavailable"); },
    }));
    const exit = await runServerPromiseExit(api.listChats(17));
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("chat store unavailable");
  });
});
