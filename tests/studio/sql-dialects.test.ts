import test from "node:test";
import assert from "node:assert/strict";
import { getSqlDialectKeywords, getSqlContinuationRule } from "../../lib/studio/sql-dialects";

test("getSqlDialectKeywords returns dialect-specific keywords", () => {
  const mysql = getSqlDialectKeywords("mysql");
  assert.ok(mysql.includes("SHOW"));
  const postgres = getSqlDialectKeywords("postgres");
  assert.ok(postgres.includes("ILIKE"));
});

test("getSqlContinuationRule matches phrases", () => {
  const rule = getSqlContinuationRule("postgres", ["select", "*"]);
  assert.equal(rule?.phrase, "select *");

  const mysqlRule = getSqlContinuationRule("mysql", ["show"]);
  assert.equal(mysqlRule?.phrase, "show");
});
