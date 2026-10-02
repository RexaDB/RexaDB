import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  FastTableCountCache,
} from "../../lib/studio/fast-table-count";

test("a pending count is shared, pages reuse it, and refresh invalidates it", async () => {
  const cache = new FastTableCountCache();
  let calls = 0;
  let finish!: (count: number) => void;
  const count = () => {
    calls++;
    return new Promise<number>((resolve) => { finish = resolve; });
  };
  const first = cache.load("table/filter/permission", count);
  const second = cache.load("table/filter/permission", count);
  assert.equal(calls, 1);
  finish(200_001);
  assert.deepEqual(await Promise.all([first, second]), [200_001, 200_001]);
  assert.equal(await cache.load("table/filter/permission", count), 200_001);
  cache.clear();
  const refreshed = cache.load("table/filter/permission", count);
  assert.equal(calls, 2);
  finish(200_002);
  assert.equal(await refreshed, 200_002);
});

test("superseded counts cannot repopulate a cleared cache", async () => {
  const cache = new FastTableCountCache();
  let finish!: (count: number) => void;
  const stale = cache.load("old-filter", () => new Promise((resolve) => { finish = resolve; }));
  cache.clear();
  finish(17);
  await stale;
  assert.equal(cache.get("old-filter"), null);
  assert.equal(await cache.load("old-filter", async () => null), null);
  assert.equal(await cache.load("old-filter", async () => 18), 18);
});
