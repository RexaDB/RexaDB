import test from "node:test";
import assert from "node:assert/strict";
import { formatSqlIdentifier, sqlIdentifierNeedsQuotes } from "../../lib/studio/sql-identifier";
import { getSqlSuggestions } from "../../lib/studio/sql-suggestions";

const schemaData = {
  Users: {
    schema: "public",
    name: "Users",
    columns: [{ name: "id" }, { name: "firstName" }, { name: "created_at" }],
  },
  orders: {
    schema: "public",
    name: "orders",
    columns: [{ name: "id" }, { name: "user" }],
  },
};

function insertTextFor(query: string, label: string, dbType = "postgres", cursor = query.length) {
  const result = getSqlSuggestions(query, cursor, schemaData, dbType);
  return { result, item: result?.items.find((item) => item.label === label) };
}

test("identifier quoting follows dialect case folding", () => {
  assert.equal(formatSqlIdentifier("users", "postgres"), "users");
  assert.equal(formatSqlIdentifier("Users", "postgres"), '"Users"');
  assert.equal(formatSqlIdentifier("firstName", "postgres"), '"firstName"');
  assert.equal(formatSqlIdentifier("Users", "mysql"), "Users");
  assert.equal(formatSqlIdentifier("Users", "mssql"), "Users");
  assert.equal(formatSqlIdentifier("users", "oracle"), '"users"');
  assert.equal(formatSqlIdentifier("USERS", "oracle"), "USERS");
});

test("identifier quoting handles reserved words and special characters", () => {
  assert.equal(formatSqlIdentifier("user", "postgres"), '"user"');
  assert.equal(formatSqlIdentifier("order", "mysql"), "`order`");
  assert.equal(formatSqlIdentifier("my table", "mssql"), "[my table]");
  assert.equal(formatSqlIdentifier('we"ird', "postgres"), '"we""ird"');
  assert.equal(sqlIdentifierNeedsQuotes("2fa", "sqlite"), true);
});

test("mixed-case tables are inserted quoted in postgres", () => {
  const { item } = insertTextFor("select * from Use", "public.Users");
  assert.equal(item?.insertText, 'public."Users"');
});

test("lowercase names stay unquoted", () => {
  const { item } = insertTextFor("select * from ord", "public.orders");
  assert.equal(item?.insertText, "public.orders");
});

test("typing a mixed-case name in lowercase still offers the quoted name", () => {
  const { item } = insertTextFor("select * from users", "public.Users");
  assert.equal(item?.insertText, 'public."Users"');
});

test("columns of quoted tables resolve through aliases", () => {
  const { item } = insertTextFor('select * from "Users" u where u.fi', "firstName");
  assert.equal(item?.insertText, '"firstName"');
});

test("columns resolve after a quoted table name", () => {
  const { item } = insertTextFor('select * from public."Users" where "Users".fi', "firstName");
  assert.equal(item?.insertText, '"firstName"');
});

test("reserved column names are quoted", () => {
  const { item } = insertTextFor("select * from orders o where o.us", "user");
  assert.equal(item?.insertText, '"user"');
});

test("an opening quote typed by the user is replaced, not doubled", () => {
  const query = 'select * from "Use"';
  const cursor = query.length - 1; // inside the auto-closed pair
  const { result, item } = insertTextFor(query, "public.Users", "postgres", cursor);
  assert.equal(item?.insertText, '"Users"');
  assert.equal(result?.tokenStart, "select * from ".length);
  assert.equal(result?.tokenEnd, query.length);
  assert.ok(result?.items.every((entry) => entry.kind === "table" || entry.kind === "column"));
});

test("mysql uses backticks only when required", () => {
  const { item } = insertTextFor("select * from orders o where o.us", "user", "mysql");
  assert.equal(item?.insertText, "`user`");
  const { item: table } = insertTextFor("select * from Use", "public.Users", "mysql");
  assert.equal(table?.insertText, "public.Users");
});
