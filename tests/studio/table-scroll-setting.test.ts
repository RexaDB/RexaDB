import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { DEFAULT_FAST_TABLE_LOADING, FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY, resolveFastTableLoading } from "@/lib/studio/fast-table-loading";
import { pickCommonSettings } from "@/lib/studio/settings-common";

const source = ts.createSourceFile("use-global-studio-settings.ts", readFileSync(new URL("../../hooks/use-global-studio-settings.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "useGlobalStudioSettings");
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function createSettingsHook(saved: Record<string, unknown> = {}) {
  let stored = saved;
  const state: any[] = [];
  const refs: any[] = [];
  const dependencies: unknown[][] = [];
  let pendingEffects: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  const bindings = {
    window: undefined,
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef: (initial: unknown) => {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useEffect: (effect: () => void, next: unknown[]) => {
      const index = effectIndex++;
      if (!dependencies[index] || next.some((value, position) => value !== dependencies[index][position])) {
        dependencies[index] = next;
        pendingEffects.push(effect);
      }
    },
    DEFAULT_FAST_TABLE_LOADING,
    FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY,
    resolveFastTableLoading,
    pickCommonSettings,
    DEFAULT_ICON_THEME_ID: "solar",
    getGlobalStudioSettings: async () => ({ success: true, data: stored }),
    saveGlobalStudioSettings: async (value: Record<string, unknown>) => { stored = value; },
    emitSettingsSyncLocalChanged: () => {},
    subscribeSettingsSyncApplied: () => () => {},
    normalizeCustomIconThemes: (themes: unknown) => themes,
  };
  const hook = new Function(...Object.keys(bindings), `${compiled}\nreturn useGlobalStudioSettings;`)(...Object.values(bindings));
  return {
    render() {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      return hook(true);
    },
    async flush() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const effect of effects) effect();
      await Promise.resolve();
    },
    get stored() { return stored; },
  };
}

test("existing users without a scrolling preference keep pagination", async () => {
  const fixture = createSettingsHook({ rowSpacing: "compact" });
  assert.equal(fixture.render().infiniteTableScrolling, false);
  await fixture.flush();
  assert.equal(fixture.render().infiniteTableScrolling, false);
  await fixture.flush();
  assert.equal(fixture.stored.infiniteTableScrolling, false);
});

test("infinite scrolling is restored from the saved preference", async () => {
  const fixture = createSettingsHook({ infiniteTableScrolling: true });
  fixture.render();
  await fixture.flush();
  assert.equal(fixture.render().infiniteTableScrolling, true);
});

test("enabling and disabling infinite scrolling persist across reloads", async () => {
  const fixture = createSettingsHook();
  fixture.render();
  await fixture.flush();
  const settings = fixture.render();
  settings.setInfiniteTableScrolling(true);
  fixture.render();
  await fixture.flush();
  assert.equal(fixture.stored.infiniteTableScrolling, true);

  const reloaded = createSettingsHook(fixture.stored);
  reloaded.render();
  await reloaded.flush();
  const restored = reloaded.render();
  assert.equal(restored.infiniteTableScrolling, true);
  restored.setInfiniteTableScrolling(false);
  reloaded.render();
  await reloaded.flush();
  assert.equal(reloaded.stored.infiniteTableScrolling, false);
});
