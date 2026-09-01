import test from "node:test";
import assert from "node:assert/strict";

import {
  findStudioForeignKey,
  normalizeStudioForeignKey,
  normalizeStudioForeignKeys,
} from "../../../lib/db/foreign-key-utils";

test("normalizeStudioForeignKey maps referenced_* aliases", () => {
  const fk = normalizeStudioForeignKey({
    column_name: "user_id",
    referenced_schema: "public",
    referenced_table: "users",
    referenced_column: "id",
  });

  assert.deepEqual(fk, {
    column_name: "user_id",
    foreign_table_schema: "public",
    foreign_table_name: "users",
    foreign_column_name: "id",
  });
});

test("normalizeStudioForeignKey rejects incomplete rows", () => {
  assert.equal(
    normalizeStudioForeignKey({
      column_name: "user_id",
      referenced_schema: "public",
    }),
    null,
  );
  assert.equal(
    normalizeStudioForeignKey({
      column_name: "user_id",
      foreign_table_name: "undefined",
      foreign_column_name: "id",
    }),
    null,
  );
});

test("findStudioForeignKey finds by column after normalizing", () => {
  const found = findStudioForeignKey(
    [
      {
        column_name: "org_id",
        referenced_table_schema: "public",
        referenced_table_name: "orgs",
        referenced_column_name: "id",
      },
    ],
    "org_id",
  );

  assert.equal(found?.foreign_table_name, "orgs");
  assert.equal(found?.foreign_column_name, "id");
});

test("normalizeStudioForeignKeys drops invalid entries", () => {
  const rows = normalizeStudioForeignKeys([
    {
      column_name: "a",
      foreign_table_schema: "public",
      foreign_table_name: "t",
      foreign_column_name: "id",
    },
    { column_name: "b" },
    null,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].column_name, "a");
});
