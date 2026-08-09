import test from "node:test";
import assert from "node:assert/strict";
import { getSqlSuggestions } from "../../lib/studio/sql-suggestions";

const schemaData = {
  users: {
    schema: "public",
    name: "users",
    columns: [{ name: "id" }, { name: "email" }],
  },
};

test("sql suggestions include select star after select", () => {
  const query = "select ";
  const result = getSqlSuggestions(query, query.length, schemaData, "postgres");
  assert.ok(result);
  assert.ok(result?.items.some((item) => item.label === "*"));
});

test("sql suggestions include columns for alias context", () => {
  const query = "select u.id from public.users u where u.";
  const result = getSqlSuggestions(query, query.length, schemaData, "postgres");
  assert.ok(result);
  assert.ok(result?.items.some((item) => item.label === "id" && item.kind === "column"));
});

test("sql suggestions return null when token matches keyword", () => {
  const query = "select";
  const result = getSqlSuggestions(query, query.length, schemaData, "postgres");
  assert.equal(result, null);
});
