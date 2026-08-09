import test from "node:test";
import assert from "node:assert/strict";
import { isJsonColumnType, normalizeJsonInput, stableStringify } from "../../lib/studio/general-utils";

test("isJsonColumnType detects json types", () => {
  assert.equal(isJsonColumnType("jsonb"), true);
  assert.equal(isJsonColumnType("text"), false);
});

test("normalizeJsonInput parses and validates", () => {
  assert.deepEqual(normalizeJsonInput("{\"a\":1}", "data"), { value: { a: 1 }, error: null });
  assert.deepEqual(normalizeJsonInput("", "data"), { value: null, error: null });
  const invalid = normalizeJsonInput("{a}", "data");
  assert.equal(invalid.error, "Invalid JSON in column \"data\"");
});

test("stableStringify handles objects and primitives", () => {
  assert.equal(stableStringify({ a: 1 }), "{\"a\":1}");
  assert.equal(stableStringify(5), "5");
});
