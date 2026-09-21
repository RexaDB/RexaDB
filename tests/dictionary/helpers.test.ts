import test from "node:test";
import assert from "node:assert/strict";
import {
  tableKey,
  columnKey,
  splitTableKey,
  splitColumnKey,
  applyColumnDecorator,
  isValidDecorator,
  mergeDescription,
  buildCatalogEntries,
  searchCatalog,
} from "../../lib/dictionary/helpers";

test("table/column keys round-trip", () => {
  assert.equal(tableKey("public", "users"), "public.users");
  assert.equal(columnKey("public", "users", "id"), "public.users.id");
  assert.deepEqual(splitTableKey("public.users"), { schema: "public", table: "users" });
  assert.equal(splitTableKey("nope"), null);
  assert.deepEqual(splitColumnKey("public.users.id"), {
    schema: "public",
    table: "users",
    column: "id",
  });
  assert.equal(splitColumnKey("public.users"), null);
});

test("applyColumnDecorator handles nulls and passthrough", () => {
  assert.deepEqual(applyColumnDecorator(null, null), { display: "NULL", masked: false });
  assert.deepEqual(applyColumnDecorator(undefined, null), { display: "NULL", masked: false });
  assert.deepEqual(applyColumnDecorator(42, null), { display: "42", masked: false });
  assert.deepEqual(applyColumnDecorator(42, { kind: "unknown" } as never), {
    display: "42",
    masked: false,
  });
});

test("enum-map decorator maps labels with fallback", () => {
  const decorator = { kind: "enum-map", mapping: { active: "Active", banned: "Banned" } } as const;
  assert.deepEqual(applyColumnDecorator("active", decorator), {
    display: "Active",
    masked: false,
  });
  assert.deepEqual(applyColumnDecorator("other", decorator), {
    display: "other",
    masked: false,
  });
  assert.deepEqual(applyColumnDecorator(1, decorator), { display: "1", masked: false });
});

test("mask decorator hides leading chars", () => {
  assert.deepEqual(
    applyColumnDecorator("secret-value", { kind: "mask", visibleChars: 4 }),
    { display: "••••••••alue", masked: true },
  );
  const full = applyColumnDecorator("abc", { kind: "mask" });
  assert.equal(full.masked, true);
  assert.equal(full.display, "•••");
  const custom = applyColumnDecorator("abcdef", { kind: "mask", visibleChars: 2, maskChar: "*" });
  assert.deepEqual(custom, { display: "****ef", masked: true });
});

test("prefix-suffix and truncate decorators", () => {
  assert.deepEqual(
    applyColumnDecorator(19.99, { kind: "prefix-suffix", prefix: "$" }),
    { display: "$19.99", masked: false },
  );
  assert.deepEqual(
    applyColumnDecorator("hello world", { kind: "truncate", maxLength: 5 }),
    { display: "hello…", masked: false },
  );
  assert.deepEqual(
    applyColumnDecorator("hi", { kind: "truncate", maxLength: 5 }),
    { display: "hi", masked: false },
  );
});

test("date-format decorator handles valid and invalid dates", () => {
  const out = applyColumnDecorator("2026-01-15T12:00:00.000Z", {
    kind: "date-format",
    format: "date",
  });
  assert.equal(out.masked, false);
  assert.ok(out.display.length > 0);
  assert.deepEqual(
    applyColumnDecorator("not-a-date", { kind: "date-format", format: "date" }),
    { display: "not-a-date", masked: false },
  );
  const relative = applyColumnDecorator(new Date(Date.now() - 30_000).toISOString(), {
    kind: "date-format",
    format: "relative",
  });
  assert.equal(relative.display, "just now");
});

test("isValidDecorator accepts known shapes only", () => {
  assert.equal(isValidDecorator({ kind: "enum-map", mapping: {} }), true);
  assert.equal(isValidDecorator({ kind: "enum-map" }), false);
  assert.equal(isValidDecorator({ kind: "mask" }), true);
  assert.equal(isValidDecorator({ kind: "truncate", maxLength: 10 }), true);
  assert.equal(isValidDecorator({ kind: "truncate", maxLength: 0 }), false);
  assert.equal(isValidDecorator({ kind: "truncate", maxLength: 50_000 }), false);
  assert.equal(isValidDecorator({ kind: "nope" }), false);
  assert.equal(isValidDecorator(null), false);
  assert.equal(isValidDecorator("mask"), false);
});

test("mergeDescription prefers local overlay", () => {
  assert.deepEqual(mergeDescription(" local ", "native"), {
    description: "local",
    source: "local",
  });
  assert.deepEqual(mergeDescription("", "native"), {
    description: "native",
    source: "native",
  });
  assert.deepEqual(mergeDescription(null, null), { description: null, source: null });
});

test("buildCatalogEntries merges local, native, and decorators", () => {
  const entries = buildCatalogEntries(
    [
      {
        schema: "public",
        table: "users",
        columns: [
          { column: "id", dataType: "int", isNullable: false, isPrimary: true, isForeignKey: false },
          { column: "role", dataType: "text", isNullable: true, isPrimary: false, isForeignKey: false },
        ],
      },
    ],
    {
      tables: { "public.users": "Local table note" },
      columns: {},
      decorators: { "public.users.role": { kind: "mask" } },
      updatedAt: {},
    },
    { tables: { "public.users": "Native comment" }, columns: { "public.users.id": "PK" } },
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].description, "Local table note");
  assert.equal(entries[0].descriptionSource, "local");
  assert.equal(entries[0].columns[0].description, "PK");
  assert.equal(entries[0].columns[0].descriptionSource, "native");
  assert.deepEqual(entries[0].columns[1].decorator, { kind: "mask" });
});

test("searchCatalog ranks exact and prefix matches first", () => {
  const entries = buildCatalogEntries(
    [
      {
        schema: "public",
        table: "users",
        columns: [
          { column: "id", dataType: "int", isNullable: false, isPrimary: true, isForeignKey: false },
          { column: "email", dataType: "text", isNullable: true, isPrimary: false, isForeignKey: false },
        ],
      },
      { schema: "public", table: "orders", columns: [] },
    ],
    { tables: {}, columns: {}, decorators: {}, updatedAt: {} },
  );
  const byTable = searchCatalog(entries, "users");
  assert.equal(byTable[0].kind, "table");
  assert.equal(byTable[0].table, "users");
  const byColumn = searchCatalog(entries, "email");
  assert.equal(byColumn[0].kind, "column");
  assert.equal(byColumn[0].column, "email");
  const byDesc = searchCatalog(
    buildCatalogEntries(
      [{ schema: "public", table: "t", columns: [] }],
      { tables: { "public.t": "stores payment records" }, columns: {}, decorators: {}, updatedAt: {} },
    ),
    "payment",
  );
  assert.equal(byDesc.length, 1);
  const all = searchCatalog(entries, "");
  assert.equal(all.length, 2);
});
