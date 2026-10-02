import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canAdvanceFastPage } from "../../lib/studio/fast-table-count";
import {
  DEFAULT_FAST_TABLE_LOADING,
  FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY,
  migrateFastTableLoading,
  resolveFastTableLoading,
  waitForTableCount,
} from "../../lib/studio/fast-table-loading";
import { pickCommonSettings } from "../../lib/studio/settings-common";
import { filterSettingsSearch } from "../../components/studio/settings/settings-search";

test("fast loading is enabled by default and participates in settings plumbing", () => {
  assert.equal(DEFAULT_FAST_TABLE_LOADING, true);
  assert.equal(pickCommonSettings({ fastTableLoading: true }).fastTableLoading, true);
  assert.ok(filterSettingsSearch("fast table").some((entry) => entry.id === "fast-table-loading"));
});

test("old saved off values migrate to on, but new off choices persist", () => {
  assert.equal(resolveFastTableLoading({ fastTableLoading: false }), true);
  assert.equal(resolveFastTableLoading({}), true);
  assert.equal(resolveFastTableLoading({
    fastTableLoading: false,
    [FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY]: true,
  }), false);
  assert.equal(resolveFastTableLoading({
    fastTableLoading: true,
    [FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY]: true,
  }), true);
  const migrated = migrateFastTableLoading({ fastTableLoading: false, rowSpacing: "compact" });
  assert.equal(migrated.fastTableLoading, true);
  assert.equal(migrated.rowSpacing, "compact");
  assert.equal(resolveFastTableLoading({ ...migrated, fastTableLoading: false }), false);
});

test("unknown totals allow only a full page to advance", () => {
  assert.equal(canAdvanceFastPage(0, 100, 100, null), true);
  assert.equal(canAdvanceFastPage(0, 100, 99, null), false);
  assert.equal(canAdvanceFastPage(2, 100, 100, 250), false);
  assert.equal(canAdvanceFastPage(1, 100, 100, 250), true);
});

test("fast mode releases rows before count, disabled mode waits", async () => {
  let finish!: (count: number) => void;
  const count = new Promise<number>((resolve) => { finish = resolve; });
  const seen: number[] = [];
  await waitForTableCount(true, count, (value) => seen.push(value!));
  assert.deepEqual(seen, []);
  finish(200_000);
  await count;
  await Promise.resolve();
  assert.deepEqual(seen, [200_000]);

  let finishLegacy!: (count: number) => void;
  const legacyCount = new Promise<number>((resolve) => { finishLegacy = resolve; });
  let released = false;
  const waiting = waitForTableCount(false, legacyCount, () => {}).then(() => { released = true; });
  await Promise.resolve();
  assert.equal(released, false);
  finishLegacy(200_000);
  await waiting;
  assert.equal(released, true);
});
