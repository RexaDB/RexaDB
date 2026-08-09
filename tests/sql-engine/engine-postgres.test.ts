// fallow-ignore-file code-duplication
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSqlEngine,
  verifyReferencedRecordAndMutate,
} from "./load-sql-engine";
import { requireDockerDbOrSkip } from "./docker-helpers";

const POSTGRES_URL =
  process.env.REXADB_TEST_PG ||
  "postgres://postgres:postgres@127.0.0.1:5432/rexadb_test";

async function setupPostgres(sqlEngine: {
  executeSqlEngineQuery: (cs: string, q: string, p?: unknown[]) => Promise<any>;
}) {
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "DROP VIEW IF EXISTS public.user_emails",
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "DROP TABLE IF EXISTS public.posts",
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "DROP TABLE IF EXISTS public.users",
  );

  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "CREATE TABLE public.users (id integer primary key, name text not null, email text)",
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "CREATE TABLE public.posts (id integer primary key, user_id integer not null references public.users(id), title text)",
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "CREATE VIEW public.user_emails AS SELECT id, email FROM public.users",
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "INSERT INTO public.users (id, name, email) VALUES ($1, $2, $3)",
    [1, "Ada", "ada@example.com"],
  );
  await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "INSERT INTO public.posts (id, user_id, title) VALUES ($1, $2, $3)",
    [10, 1, "Hello"],
  );
}

test("sql-engine handles postgres catalog + mutations", async (t) => {
  const { sqlEngine } = await loadSqlEngine();
  if (!(await requireDockerDbOrSkip(t, sqlEngine, POSTGRES_URL, "select 1")))
    return;

  await setupPostgres(sqlEngine);

  const selectResult = await sqlEngine.executeSqlEngineQuery(
    POSTGRES_URL,
    "SELECT name FROM public.users WHERE id = $1",
    [1],
  );
  assert.equal(selectResult.rowCount, 1);
  assert.equal(selectResult.rows[0].name, "Ada");

  const tables = await sqlEngine.getSqlEngineTables(POSTGRES_URL, "public");
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("posts"));

  const views = await sqlEngine.getSqlEngineViews(POSTGRES_URL, "public");
  assert.ok(views.includes("user_emails"));

  const schemas = await sqlEngine.getSqlEngineSchemas(POSTGRES_URL);
  assert.ok(schemas.includes("public"));

  const databases = await sqlEngine.getSqlEngineDatabases(POSTGRES_URL);
  assert.ok(databases.includes("rexadb_test"));

  // fallow-ignore-next-line code-duplication
  const structure = await sqlEngine.getSqlEngineTableStructure(
    POSTGRES_URL,
    "public",
    "posts",
  );
  const userIdColumn = structure.find(
    (col: any) => col.column_name === "user_id",
  );
  assert.equal(Boolean(userIdColumn?.is_foreign_key), true);

  const primaryKey = await sqlEngine.getSqlEnginePrimaryKey(
    POSTGRES_URL,
    "public",
    "users",
  );
  assert.equal(primaryKey, "id");

  const foreignKeys = await sqlEngine.getSqlEngineTableForeignKeys(
    POSTGRES_URL,
    "public",
    "posts",
  );
  assert.equal(foreignKeys[0]?.foreign_table_name, "users");

  await verifyReferencedRecordAndMutate(
    sqlEngine,
    POSTGRES_URL,
    "public",
    "SELECT name FROM public.users WHERE id = $1",
    [1],
  );
});
