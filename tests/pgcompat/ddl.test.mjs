import test from "node:test";
import assert from "node:assert/strict";
import { loadCompiler } from "./load-compiler.mjs";

test("compiles create table with references for sqlite", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('create table "posts" ("id" serial primary key, "user_id" integer references "users"("id"), "slug" text unique)', [], "sqlite");
  assert.equal(compiled.query, 'CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER REFERENCES "users"("id"), "slug" TEXT UNIQUE)');
});

test("compiles create table defaults for mysql", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('create table "users" ("id" serial primary key, "created_at" timestamptz default now())', [], "mysql");
  assert.equal(compiled.query, "CREATE TABLE `users` (`id` INTEGER PRIMARY KEY AUTO_INCREMENT, `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

test("compiles alter table drop column", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('alter table "users" drop column "age"', [], "mysql");
  assert.equal(compiled.query, "ALTER TABLE `users` DROP COLUMN `age`");
});

test("compiles alter table rename column", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('alter table "users" rename column "full_name" to "name"', [], "sqlite");
  assert.equal(compiled.query, 'ALTER TABLE "users" RENAME COLUMN "full_name" TO "name"');
});

test("compiles alter table rename table", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('alter table "users" rename to "app_users"', [], "mysql");
  assert.equal(compiled.query, "ALTER TABLE `users` RENAME TO `app_users`");
});

test("compiles alter table set default for mysql", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('alter table "users" alter column "created_at" set default now()', [], "mysql");
  assert.equal(compiled.query, "ALTER TABLE `users` ALTER COLUMN `created_at` SET DEFAULT CURRENT_TIMESTAMP");
});

test("compiles alter table add unique constraint for mysql", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  const compiled = compilePostgresQuery('alter table "users" add constraint "users_email_unique" unique ("email")', [], "mysql");
  assert.equal(compiled.query, "ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE (`email`)");
});

test("rejects sqlite alter table add constraint", async () => {
  const { compilePostgresQuery } = await loadCompiler();
  assert.throws(
    () => compilePostgresQuery('alter table "users" add constraint "users_email_unique" unique ("email")', [], "sqlite"),
    /SQLite does not safely support ALTER TABLE ADD CONSTRAINT/
  );
});
