import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createAppSettingsEffects } from "../../server/app-settings-api";
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

describe("app settings Effects", () => {
  test("preserves concrete settings migration result types", async () => {
    const api = createAppSettingsEffects(fakeActions({
      migrateSettingsFromSqlite: async () => ({ done: true, error: null }),
    }));
    const result = await Effect.runPromise(api.migrateSettings());
    expect(result.done).toBe(true);
    expect(result.error).toBeNull();
  });

  test("passes settings arguments and maps rejected storage calls", async () => {
    let savedFont: string | null | undefined;
    const api = createAppSettingsEffects(fakeActions({
      saveAppFontFamily: async (font: string | null) => {
        savedFont = font;
        return { success: true };
      },
      getGlobalAppThemeSettings: async () => { throw new Error("settings store unavailable"); },
    }));
    expect(await Effect.runPromise(api.saveFontFamily("Inter"))).toEqual({ success: true });
    expect(savedFont).toBe("Inter");

    const exit = await runServerPromiseExit(api.getAppTheme());
    const error = failureFromExit(exit) as DbError;
    expect(error._tag).toBe("DbError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("settings store unavailable");
  });
});
