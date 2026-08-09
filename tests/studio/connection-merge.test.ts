import test from "node:test";
import assert from "node:assert/strict";
import { mergeConnections } from "../../lib/studio/connection-merge";

test("mergeConnections dedupes and sorts", () => {
  const primary = [
    { id: 1, sortOrder: 10 },
    { id: 2, sortOrder: 5 },
  ] as any[];
  const secondary = [
    { id: 2, sortOrder: 5 },
    { id: 3, createdAt: 20 },
  ] as any[];

  const merged = mergeConnections(primary, secondary);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((c) => c.id), [3, 1, 2]);
});
