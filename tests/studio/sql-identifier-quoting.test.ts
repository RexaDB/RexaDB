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
  assert.equal(item?.insertText, 'public."Users"');
  assert.equal(result?.tokenStart, "select * from ".length);
  assert.equal(result?.tokenEnd, query.length);
  assert.ok(result?.items.every((entry) => entry.kind === "table" || entry.kind === "column"));
});

test("mysql uses backticks only when required", () => {
  const { item } = insertTextFor("select * from orders o where o.us", "user", "mysql");
  // `user` is not reserved in MySQL, so it stays bare there.
  assert.equal(item?.insertText, "user");
  const { item: table } = insertTextFor("select * from Use", "public.Users", "mysql");
  assert.equal(table?.insertText, "public.Users");
});

test("a quoted name containing spaces is replaced as a whole", () => {
  const data = { t: { schema: "public", name: "t", columns: [{ name: "my column" }] } };
  const query = 'select "my col';
  const result = getSqlSuggestions(query, query.length, data, "postgres");
  const item = result?.items.find((entry) => entry.label === "my column");
  assert.equal(item?.insertText, '"my column"');
  assert.equal(result?.tokenStart, "select ".length);
});

test("an escaped quote inside the fragment does not end it", () => {
  const data = { t: { schema: "public", name: "t", columns: [{ name: 'we"ird' }] } };
  const query = 'select "we""i';
  const result = getSqlSuggestions(query, query.length, data, "postgres");
  assert.equal(result?.items.find((entry) => entry.label === 'we"ird')?.insertText, '"we""ird"');
  assert.equal(result?.tokenStart, "select ".length);
});

test("a quoted table keeps its schema", () => {
  const data = { u: { schema: "analytics", name: "Users", columns: [] } };
  const query = 'select * from "Use';
  const result = getSqlSuggestions(query, query.length, data, "postgres");
  assert.equal(result?.items.find((entry) => entry.kind === "table")?.insertText, 'analytics."Users"');
});

test("tables are suggested after a schema prefix", () => {
  const quotedQuery = 'select * from public."Use';
  const quoted = getSqlSuggestions(quotedQuery, quotedQuery.length, schemaData, "postgres");
  assert.equal(quoted?.items.find((entry) => entry.label === "Users")?.insertText, '"Users"');
  assert.equal(quoted?.tokenStart, "select * from public.".length);

  const bareQuery = "select * from public.ord";
  const bare = getSqlSuggestions(bareQuery, bareQuery.length, schemaData, "postgres");
  assert.equal(bare?.items.find((entry) => entry.label === "orders")?.insertText, "orders");
});

test("quoted and unquoted tables that differ only by case resolve separately", () => {
  const data = {
    lower: { schema: "public", name: "users", columns: [{ name: "lower_col" }] },
    upper: { schema: "public", name: "Users", columns: [{ name: "upper_col" }] },
  };
  const quotedQuery = 'select * from public."Users" u where u.';
  const quoted = getSqlSuggestions(quotedQuery, quotedQuery.length, data, "postgres");
  assert.deepEqual(quoted?.items.map((entry) => entry.label), ["upper_col"]);

  const bareQuery = "select * from public.Users u where u.";
  const bare = getSqlSuggestions(bareQuery, bareQuery.length, data, "postgres");
  assert.deepEqual(bare?.items.map((entry) => entry.label), ["lower_col"]);
});

test("dialect-specific reserved words are quoted", () => {
  assert.equal(formatSqlIdentifier("returning", "postgres"), '"returning"');
  assert.equal(formatSqlIdentifier("top", "mssql"), "[top]");
  assert.equal(formatSqlIdentifier("rank", "mysql"), "`rank`");
  assert.equal(formatSqlIdentifier("pragma", "sqlite"), '"pragma"');
  assert.equal(formatSqlIdentifier("level", "oracle"), '"level"');
  assert.equal(formatSqlIdentifier("unnest", "trino"), '"unnest"');
  assert.equal(formatSqlIdentifier("top", "postgres"), "top");
});

test("a schema prefix prefers the exactly resolved schema", () => {
  const data = {
    upper: { schema: "Foo", name: "upper_table", columns: [] },
    lower: { schema: "foo", name: "lower_table", columns: [] },
  };
  const query = "select * from foo.";
  const result = getSqlSuggestions(query, query.length, data, "postgres");
  assert.deepEqual(result?.items.map((entry) => entry.label), ["lower_table"]);

  const quotedQuery = 'select * from "Foo".';
  const quoted = getSqlSuggestions(quotedQuery, quotedQuery.length, data, "postgres");
  assert.deepEqual(quoted?.items.map((entry) => entry.label), ["upper_table"]);
});

test("quotes inside comments do not open an identifier", () => {
  for (const comment of ['-- "example\n', '/* "example */ ']) {
    const query = `${comment}select * from Use`;
    const result = getSqlSuggestions(query, query.length, schemaData, "postgres");
    assert.equal(result?.items.find((entry) => entry.kind === "table")?.insertText, 'public."Users"');
  }
  const mysqlQuery = "# `example\nselect * from ord";
  const mysql = getSqlSuggestions(mysqlQuery, mysqlQuery.length, schemaData, "mysql");
  assert.equal(mysql?.items.find((entry) => entry.kind === "table")?.insertText, "public.orders");
});
