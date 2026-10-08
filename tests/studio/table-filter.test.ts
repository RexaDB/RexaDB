import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  effectiveNameFilterMode,
  filterTablesByNameAndType,
  hasWildcardChars,
  matchesTableName,
  mergeTablesAndViews,
} from "../../lib/studio/table-filter";

test("PROJ_% prefix filter matches like SQL Developer", () => {
  assert.equal(matchesTableName("PROJ_ORDERS", "PROJ_%"), true);
  // NOTE: in SQL LIKE, _ is a single-char wildcard, so PROJ_% also matches
  // PROJECTS (5th char E matches _). Use PROJ\\_% for a literal underscore.
  assert.equal(matchesTableName("PROJECTS", "PROJ_%"), true);
  assert.equal(matchesTableName("PROJECTS", "PROJ\\_%"), false);
  assert.equal(matchesTableName("PROJ_ORDERS", "PROJ\\_%"), true);
  assert.equal(matchesTableName("OTHER_PROJ_X", "PROJ\\_%"), false);
  assert.equal(matchesTableName("proj_orders", "PROJ\\_%"), true); // case-insensitive by default
});

test("underscore matches single char, escapes work", () => {
  assert.equal(matchesTableName("PROJ_A", "PROJ__"), true);
  assert.equal(matchesTableName("PROJ_AB", "PROJ__"), false);
  assert.equal(matchesTableName("PROJ_ABC", "PROJ__"), false);
  assert.equal(matchesTableName("PROJ_%", "PROJ\\_%"), true);
  assert.equal(matchesTableName("PROJ_X", "PROJ\\_%"), true);
  assert.equal(matchesTableName("PROJECTS", "PROJ\\_%"), false);
  assert.equal(matchesTableName("AUDIT_LOG", "%\\_LOG"), true);
  assert.equal(matchesTableName("AUDITXLOG", "%\\_LOG"), false);
});

test("auto mode falls back to substring without wildcards", () => {
  assert.equal(matchesTableName("MY_PROJ_TABLE", "proj"), true);
  assert.equal(effectiveNameFilterMode("proj", "auto"), "substring");
  assert.equal(effectiveNameFilterMode("PROJ_%", "auto"), "pattern");
});

test("caseSensitive option is honored", () => {
  assert.equal(matchesTableName("proj_orders", "PROJ_%", { caseSensitive: true }), false);
  assert.equal(matchesTableName("PROJ_ORDERS", "PROJ_%", { caseSensitive: true }), true);
});

test("type filter separates tables from views", () => {
  const tables = ["ORDERS", "V_ORDER_SUMMARY", "PROJ_X"];
  const views = new Set(["V_ORDER_SUMMARY"]);
  assert.deepEqual(
    filterTablesByNameAndType(tables, (t) => t, { query: "", typeFilter: "views", viewSet: views }),
    ["V_ORDER_SUMMARY"],
  );
  assert.deepEqual(
    filterTablesByNameAndType(tables, (t) => t, { query: "PROJ_%", typeFilter: "tables", viewSet: views }),
    ["PROJ_X"],
  );
  assert.deepEqual(
    filterTablesByNameAndType(tables, (t) => t, { query: "%ORDER%", typeFilter: "all", viewSet: views }),
    ["ORDERS", "V_ORDER_SUMMARY"],
  );
});

test("hasWildcardChars ignores escaped wildcards", () => {
  assert.equal(hasWildcardChars("PROJ\\%"), false);
  assert.equal(hasWildcardChars("PROJ%"), true);
});

test("mergeTablesAndViews unions split backends and dedupes postgres-style overlap", () => {
  // Oracle/MSSQL style: tables and views arrive separately.
  assert.deepEqual(mergeTablesAndViews(["ORDERS"], ["V_SUMMARY"]), ["ORDERS", "V_SUMMARY"]);
  // Postgres style: getTables already includes views.
  assert.deepEqual(
    mergeTablesAndViews(["ORDERS", "V_SUMMARY"], ["V_SUMMARY"]),
    ["ORDERS", "V_SUMMARY"],
  );
  assert.deepEqual(mergeTablesAndViews([], undefined), []);
});

test("wildcardsEnabled=false treats % as literal", () => {
  assert.equal(
    filterTablesByNameAndType(["PROJ_ORDERS", "PROJ_%_X"], (t) => t, {
      query: "PROJ_%",
      wildcardsEnabled: false,
    }).length,
    1,
  );
});
