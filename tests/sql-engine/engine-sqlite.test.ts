import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSqlEngine, verifyReferencedRecordAndMutate } from "./load-sql-engine";

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rexadb-tests-"));
  const dbPath = path.join(dir, "engine.sqlite");
  return {
    dir,
    dbPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function seedSqlite(sqlEngine: { executeSqlEngineQuery: (cs: string, q: string, p?: unknown[]) => Promise<any> }, dbPath: string) {
  await sqlEngine.executeSqlEngineQuery(
    dbPath,
    'create table "users" ("id" integer primary key, "name" text not null, "email" text)'
  );
  await sqlEngine.executeSqlEngineQuery(
    dbPath,
    'create table "posts" ("id" integer primary key, "user_id" integer not null, "title" text, foreign key("user_id") references "users"("id"))'
  );
  await sqlEngine.executeSqlEngineQuery(
    dbPath,
    'create view "user_emails" as select "id", "email" from "users"'
  );
  await sqlEngine.executeSqlEngineQuery(
    dbPath,
    'insert into "users" ("id", "name", "email") values ($1, $2, $3)',
    [1, "Ada", "ada@example.com"]
  );
  await sqlEngine.executeSqlEngineQuery(
    dbPath,
    'insert into "posts" ("id", "user_id", "title") values ($1, $2, $3)',
    [10, 1, "Hello"]
  );
}

test("sql-engine routes sqlite operations and returns expected metadata", async () => {
  const { sqlEngine } = await loadSqlEngine();
  const { dbPath, cleanup } = createTempDbPath();

  try {
    await seedSqlite(sqlEngine, dbPath);

    const selectResult = await sqlEngine.executeSqlEngineQuery(
      dbPath,
      'select "name" from "users" where "id" = $1',
      [1]
    );
    assert.equal(selectResult.rowCount, 1);
    assert.equal(selectResult.rows[0].name, "Ada");

    const tables = await sqlEngine.getSqlEngineTables(dbPath, "main");
    assert.ok(tables.includes("users"));
    assert.ok(tables.includes("posts"));

    const views = await sqlEngine.getSqlEngineViews(dbPath, "main");
    assert.ok(views.includes("user_emails"));

    const schemas = await sqlEngine.getSqlEngineSchemas(dbPath);
    assert.ok(schemas.includes("main"));

    const databases = await sqlEngine.getSqlEngineDatabases(dbPath);
    assert.deepEqual(databases, [path.basename(dbPath)]);

    const structure = await sqlEngine.getSqlEngineTableStructure(dbPath, "main", "posts");
    const userIdColumn = structure.find((col: any) => col.column_name === "user_id");
    assert.equal(userIdColumn?.is_foreign_key, true);

    const primaryKey = await sqlEngine.getSqlEnginePrimaryKey(dbPath, "main", "users");
    assert.equal(primaryKey, "id");

    const foreignKeys = await sqlEngine.getSqlEngineTableForeignKeys(dbPath, "main", "posts");
    assert.deepEqual(foreignKeys, [
      {
        column_name: "user_id",
        foreign_table_schema: "main",
        foreign_table_name: "users",
        foreign_column_name: "id",
      },
    ]);

    await verifyReferencedRecordAndMutate(sqlEngine, dbPath, "main", 'select "name" from "users" where "id" = $1', [1]);

    const allColumns = await sqlEngine.getSqlEngineAllTablesWithColumns(dbPath, "main");
    const postUserId = allColumns.find((row: any) => row.table_name === "posts" && row.column_name === "user_id");
    assert.equal(postUserId?.referenced_table_name, "users");
    assert.equal(postUserId?.referenced_column_name, "id");
  } finally {
    cleanup();
  }
});

test("sql-engine throws for unsupported connection types", async () => {
  const { sqlEngine } = await loadSqlEngine();
  await assert.rejects(
    () => sqlEngine.executeSqlEngineQuery("redis://localhost:6379", "select 1"),
    /Unsupported SQL engine/
  );
});
