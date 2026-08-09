import test from "node:test";
import assert from "node:assert/strict";
import { loadMysqlAlterModule } from "./load-mysql-alter.mjs";

test("builds a mysql not-null column definition with default and extra", async () => {
  const { buildMysqlColumnDefinition } = await loadMysqlAlterModule();
  const sql = buildMysqlColumnDefinition({
    column_name: "created_at",
    column_type: "datetime",
    column_default: "CURRENT_TIMESTAMP",
    extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP",
  }, false);
  assert.equal(sql, "`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP");
});

test("builds a nullable mysql text column definition with quoted string default", async () => {
  const { buildMysqlColumnDefinition } = await loadMysqlAlterModule();
  const sql = buildMysqlColumnDefinition({
    column_name: "name",
    column_type: "varchar(255)",
    column_default: "guest",
    extra: "",
  }, true);
  assert.equal(sql, "`name` varchar(255) NULL DEFAULT 'guest'");
});

test("detects mysql alter column set and drop not null queries", async () => {
  const { isMysqlNotNullAlterQuery } = await loadMysqlAlterModule();
  assert.equal(isMysqlNotNullAlterQuery('alter table "users" alter column "name" set not null'), true);
  assert.equal(isMysqlNotNullAlterQuery('alter table "users" alter column "name" drop not null'), true);
  assert.equal(isMysqlNotNullAlterQuery('alter table "users" alter column "name" set default now()'), false);
});
