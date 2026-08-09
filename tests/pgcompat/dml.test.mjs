import test from "node:test";
import assert from "node:assert/strict";
import { loadCompiler } from "./load-compiler.mjs";

test("compiles postgres syntax for sqlite returning", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery(
    'insert into "users" ("name") values ($1) returning "id", "name"',
    ["a"],
    "sqlite"
  );
  assert.equal(compiled.query, 'insert into "users" ("name") values (?) returning "id", "name"');
  assert.deepEqual(compiled.params, ["a"]);
});

test("compiles postgres syntax for libsql-compatible sqlite path", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery(
    'select "name"::text from "users" where "email" ilike $1',
    ["%a%"],
    "sqlite"
  );
  assert.equal(compiled.query, 'select CAST("name" AS TEXT) from "users" where LOWER("email") LIKE LOWER(?)');
  assert.deepEqual(compiled.params, ["%a%"]);
});
