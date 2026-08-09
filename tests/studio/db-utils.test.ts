import test from "node:test";
import assert from "node:assert/strict";
import {
  getDatabaseFromConnectionString,
  updateConnectionStringDatabase,
  getDefaultNewTableColumns,
} from "../../lib/studio/db-utils";

test("getDatabaseFromConnectionString detects db name", () => {
  assert.equal(getDatabaseFromConnectionString("redis://localhost:6379/2"), "db2");
  assert.equal(getDatabaseFromConnectionString("mongodb://localhost:27017/mydb"), "mydb");
  assert.equal(getDatabaseFromConnectionString("mysql://user:pass@localhost:3306/mydb"), "mydb");
  assert.equal(getDatabaseFromConnectionString("file:/tmp/test.db"), "test.db");
});

test("updateConnectionStringDatabase updates db names", () => {
  assert.equal(
    updateConnectionStringDatabase("redis://localhost:6379/0", "db5"),
    "redis://localhost:6379/5"
  );
  assert.equal(
    updateConnectionStringDatabase("Server=.;Database=old;", "newdb"),
    "Server=.;Database=newdb;"
  );
  assert.equal(
    updateConnectionStringDatabase("postgres://user:pass@localhost:5432/old", "new"),
    "postgres://user:pass@localhost:5432/new"
  );
});

test("getDefaultNewTableColumns returns defaults", () => {
  assert.equal(getDefaultNewTableColumns("sqlite")[0].name, "id");
  assert.equal(getDefaultNewTableColumns("mssql")[0].type, "INT");
  assert.equal(getDefaultNewTableColumns("mysql")[0].type, "INT");
  assert.equal(getDefaultNewTableColumns("redis").length, 0);
});
