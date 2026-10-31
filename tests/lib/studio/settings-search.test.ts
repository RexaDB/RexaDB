import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS_SEARCH_INDEX,
  filterSettingsSearch,
} from "../../../components/studio/settings/settings-search";

test("filterSettingsSearch returns empty list for blank query", () => {
  assert.deepEqual(filterSettingsSearch(""), []);
  assert.deepEqual(filterSettingsSearch("   "), []);
});

test("filterSettingsSearch matches titles case-insensitively", () => {
  const ids = filterSettingsSearch("VIM").map((e) => e.id);
  assert.ok(ids.includes("vim-mode"));
});

test("filterSettingsSearch matches keywords and descriptions", () => {
  const ids = filterSettingsSearch("zebra").map((e) => e.id);
  assert.ok(ids.includes("alternating-rows"));
});

test("filterSettingsSearch requires every token to match", () => {
  const ids = filterSettingsSearch("sql tabs").map((e) => e.id);
  assert.ok(ids.includes("sql-use-tabs"));
  assert.ok(!ids.includes("sql-tab-width"));
});

test("filterSettingsSearch matches section names", () => {
  const ids = filterSettingsSearch("workspace").map((e) => e.id);
  assert.ok(ids.includes("workspace-connect"));
  assert.ok(ids.includes("workspace-saved"));
});

test("SETTINGS_SEARCH_INDEX has unique ids", () => {
  const ids = SETTINGS_SEARCH_INDEX.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});


test("table scrolling is discoverable through pagination settings search", () => {
  assert.ok(filterSettingsSearch("pagination").some((entry) => entry.id === "infinite-table-scrolling"));
});

test("filterSettingsSearch offers desktop-only settings only in the desktop app", () => {
  const hasAppIcon = () => filterSettingsSearch("app icon").some((entry) => entry.id === "app-icon");
  const previous = globalThis.window;
  try {
    assert.equal(hasAppIcon(), false);
    Object.assign(globalThis, { window: { __TAURI_INTERNALS__: {} } });
    assert.equal(hasAppIcon(), true);
  } finally {
    Object.assign(globalThis, { window: previous });
  }
});
