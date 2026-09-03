import test from "node:test";
import assert from "node:assert/strict";
import { buildRows } from "../../components/studio/keybindings-view";
import {
  getDefaultKeybindings,
  normalizeKeybindingsForPlatform,
} from "../../lib/studio/keybindings";

test("buildRows tolerates null/undefined keybindings (connections-page settings crash)", () => {
  assert.deepEqual(buildRows(null as any, ""), []);
  assert.deepEqual(buildRows(undefined as any, ""), []);
  assert.deepEqual(buildRows(null as any, "save"), []);
});

test("buildRows renders default keybindings sorted", () => {
  const rows = buildRows(getDefaultKeybindings() as any, "");
  assert.ok(rows.length > 0, "expected default rows");
  const combos = rows.map((r) => r.combo);
  assert.deepEqual(combos, [...combos].sort((a, b) => a.localeCompare(b)));
});

test("buildRows filters by query", () => {
  const all = buildRows(getDefaultKeybindings() as any, "");
  const filtered = buildRows(getDefaultKeybindings() as any, "definitely-no-such-binding-zzz");
  assert.equal(filtered.length, 0);
  assert.ok(all.length > 0);
});

test("reset-all source restores a full normalized default map", () => {
  const reset = normalizeKeybindingsForPlatform(getDefaultKeybindings());
  const rows = buildRows(reset as any, "");
  assert.ok(rows.length > 0, "reset must restore rows");
  assert.ok(
    rows.every((r) => reset[r.combo] !== undefined),
    "every reset row must come from the normalized defaults",
  );
});
