import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadSqlEngine } from "./load-sql-engine";

test("sqlite client detects connection strings", async () => {
  const { sqliteClient } = await loadSqlEngine();
  const { isSqliteConnectionString } = sqliteClient;

  assert.equal(isSqliteConnectionString(":memory:"), true);
  assert.equal(isSqliteConnectionString("libsql://example.turso.io"), true);
  assert.equal(isSqliteConnectionString("sqlite:./app.db"), true);
  assert.equal(isSqliteConnectionString("file:/tmp/app.sqlite"), true);
  assert.equal(isSqliteConnectionString("/tmp/app.sqlite"), true);
  assert.equal(isSqliteConnectionString("/Users/virus/state.vscdb"), true);
  assert.equal(isSqliteConnectionString("mysql://localhost:3306/db"), false);
  assert.equal(isSqliteConnectionString("https://example.com"), false);
});

test("sqlite client resolves sqlite paths", async () => {
  const { sqliteClient } = await loadSqlEngine();
  const { resolveSqlitePath } = sqliteClient;

  assert.equal(resolveSqlitePath(":memory:"), ":memory:");

  const relative = "data/test.sqlite";
  const resolved = resolveSqlitePath(relative);
  assert.equal(resolved, path.resolve(process.cwd(), relative));

  const sqliteUri = resolveSqlitePath("sqlite://data/app.sqlite");
  assert.equal(sqliteUri, path.resolve(process.cwd(), "data/app.sqlite"));

  const fileUri = resolveSqlitePath("file:/tmp/rexadb-test.sqlite");
  assert.equal(fileUri, "/tmp/rexadb-test.sqlite");

  assert.throws(() => resolveSqlitePath("sqlite:"), /SQLite file path is missing/);
});
