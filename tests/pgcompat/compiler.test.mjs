import test from "node:test";
import assert from "node:assert/strict";
import { loadCompiler } from "./load-compiler.mjs";

test("compiles postgres select syntax for mysql", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('select "name" from "users" where "email" ilike $1 and id = $2', ["%a%", 7], "mysql");
  assert.equal(compiled.query, "select `name` from `users` where LOWER(`email`) LIKE LOWER(?) and id = ?");
  assert.deepEqual(compiled.params, ["%a%", 7]);
});

test("compiles postgres upsert syntax for mysql", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('insert into "users" ("id","name") values ($1,$2) on conflict ("id") do nothing', [1, "a"], "mysql");
  assert.equal(compiled.query, "insert IGNORE into `users` (`id`,`name`) values (?,?)");
  assert.deepEqual(compiled.params, [1, "a"]);
});

test("rejects unsupported alter column type", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  assert.throws(
    () => compilePostgresQuery('alter table "users" alter column "name" type varchar(255)', [], "sqlite"),
    /ALTER COLUMN TYPE is not safely supported/
  );
});
