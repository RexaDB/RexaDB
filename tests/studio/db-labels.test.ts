import test from "node:test";
import assert from "node:assert/strict";
import { getEditorLabel, getEditorBadge, getTableLabels } from "../../lib/studio/db-labels";

test("db labels vary by db type", () => {
  assert.equal(getEditorLabel("mongodb"), "Query Editor");
  assert.equal(getEditorLabel("redis"), "Command Editor");
  assert.equal(getEditorLabel("postgres"), "SQL Editor");

  assert.equal(getEditorBadge("mongodb"), "MONGO SHELL");
  assert.equal(getEditorBadge("redis"), "CMD");
  assert.equal(getEditorBadge("mysql"), "SQL");

  assert.deepEqual(getTableLabels("mongodb"), { singular: "Collection", plural: "Collections" });
  assert.deepEqual(getTableLabels("redis"), { singular: "Key", plural: "Keys" });
  assert.deepEqual(getTableLabels("postgres"), { singular: "Table", plural: "Tables" });
});
