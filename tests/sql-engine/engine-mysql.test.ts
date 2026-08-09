// fallow-ignore-file code-duplication
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSqlEngine,
  verifyReferencedRecordAndMutate,
} from "./load-sql-engine";
import { requireDockerDbOrSkip } from "./docker-helpers";

const MYSQL_URL =
  process.env.REXADB_TEST_MYSQL ||
  "mysql://root:root@127.0.0.1:3306/rexadb_test";

async function setupMysql(sqlEngine: {
  executeSqlEngineQuery: (cs: string, q: string, p?: unknown[]) => Promise<any>;
}) {
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "DROP VIEW IF EXISTS user_emails",
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "DROP TABLE IF EXISTS posts",
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "DROP TABLE IF EXISTS users",
  );

  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "CREATE TABLE users (id int primary key, name varchar(255) not null, email varchar(255))",
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "CREATE TABLE posts (id int primary key, user_id int not null, title varchar(255), CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id))",
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "CREATE VIEW user_emails AS SELECT id, email FROM users",
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    [1, "Ada", "ada@example.com"],
  );
  await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)",
    [10, 1, "Hello"],
  );
}

test("sql-engine handles mysql catalog + mutations", async (t) => {
  const { sqlEngine } = await loadSqlEngine();
  if (!(await requireDockerDbOrSkip(t, sqlEngine, MYSQL_URL, "select 1")))
    return;

  await setupMysql(sqlEngine);

  const selectResult = await sqlEngine.executeSqlEngineQuery(
    MYSQL_URL,
    "SELECT name FROM users WHERE id = ?",
    [1],
  );
  assert.equal(selectResult.rowCount, 1);
  assert.equal(selectResult.rows[0].name, "Ada");

  const tables = await sqlEngine.getSqlEngineTables(MYSQL_URL, "rexadb_test");
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("posts"));

  const views = await sqlEngine.getSqlEngineViews(MYSQL_URL, "rexadb_test");
  assert.ok(views.includes("user_emails"));

  const schemas = await sqlEngine.getSqlEngineSchemas(MYSQL_URL);
  assert.ok(schemas.includes("rexadb_test"));

  const databases = await sqlEngine.getSqlEngineDatabases(MYSQL_URL);
  assert.ok(databases.includes("rexadb_test"));

  // fallow-ignore-next-line code-duplication
  const structure = await sqlEngine.getSqlEngineTableStructure(
    MYSQL_URL,
    "rexadb_test",
    "posts",
  );
  const userIdColumn = structure.find(
    (col: any) => col.column_name === "user_id",
  );
  assert.equal(Boolean(userIdColumn?.is_foreign_key), true);

  const primaryKey = await sqlEngine.getSqlEnginePrimaryKey(
    MYSQL_URL,
    "rexadb_test",
    "users",
  );
  assert.equal(primaryKey, "id");

  const foreignKeys = await sqlEngine.getSqlEngineTableForeignKeys(
    MYSQL_URL,
    "rexadb_test",
    "posts",
  );
  assert.equal(foreignKeys[0]?.foreign_table_name, "users");

  await verifyReferencedRecordAndMutate(
    sqlEngine,
    MYSQL_URL,
    "rexadb_test",
    "SELECT name FROM users WHERE id = ?",
    [1],
  );
});
