import { describe, it, expect } from "bun:test";
import {
  applyDataSql,
  escapeIdent,
  escapeLiteral,
  exportTableDataSql,
  formatSqlValue,
  formatValueWithType,
  orderChunksByDependency,
  parseDataChunks,
  splitSqlStatements,
  stripCommentLines,
} from "@/lib/transfer/transfer-sql";

describe("transfer-sql", () => {
  it("escapes identifiers so source names cannot break out of quotes", () => {
    expect(escapeIdent('public')).toBe('"public"');
    expect(escapeIdent('weird"name')).toBe('"weird""name"');
  });

  it("escapes literals so source values cannot alter SQL", () => {
    expect(escapeLiteral("o'clock")).toBe("'o''clock'");
    expect(escapeLiteral("'; DROP TABLE users; --")).toBe(
      "'''; DROP TABLE users; --'",
    );
  });

  it("formats JS values as SQL literals", () => {
    expect(formatSqlValue(null)).toBe("NULL");
    expect(formatSqlValue(undefined)).toBe("NULL");
    expect(formatSqlValue("a'b")).toBe("'a''b'");
    expect(formatSqlValue(true)).toBe("TRUE");
    expect(formatSqlValue(false)).toBe("FALSE");
    expect(formatSqlValue(42)).toBe("42");
    expect(formatSqlValue(NaN)).toBe("NULL");
    expect(formatSqlValue({ a: 1 })).toBe("'{\"a\":1}'");
  });

  it("splits statements without breaking on semicolons inside strings", () => {
    const sql = [
      `-- Data for public.notes (2 rows)`,
      `INSERT INTO "public"."notes" ("id", "body") VALUES (1, 'hello; world');`,
      `INSERT INTO "public"."notes" ("id", "body") VALUES (2, 'it''s; fine');`,
    ].join("\n");
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("hello; world");
    expect(parts[1]).toContain("it''s; fine");
  });

  it("handles dollar-quoted function bodies containing semicolons", () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE 'x;y'; END; $$ LANGUAGE plpgsql; SELECT 1;`;
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("RAISE NOTICE");
  });

  it("exports table data with escaped identifiers and values", async () => {
    const rows = [{ id: 1, body: "a'; DROP TABLE x; --" }];
    const query = async () => ({ success: true, data: { rows } });
    const { sql, exportedRows } = await exportTableDataSql(
      query,
      "conn",
      'weird"schema',
      "notes",
      1,
    );
    expect(exportedRows).toBe(1);
    expect(sql).toContain('"weird""schema"."notes"');
    expect(sql).toContain("'a''; DROP TABLE x; --'");
  });

  it("skips oversized tables but keeps the export going", async () => {
    let called = false;
    const query = async () => {
      called = true;
      return { success: true, data: { rows: [] } };
    };
    const { sql, exportedRows } = await exportTableDataSql(query, "conn", "public", "big", 10_000);
    expect(sql).toBe("");
    expect(exportedRows).toBe(0);
    expect(called).toBe(false);
  });

  it("applies dataSql statement-by-statement and reports failures", async () => {
    const seen: string[] = [];
    const query = async (_conn: string, sql: string) => {
      seen.push(sql);
      if (sql.includes("VALUES (2,")) return { success: false, error: "boom" };
      return { success: true };
    };
    const { applied, failed, errors } = await applyDataSql(
      query,
      "conn",
      `INSERT INTO "t" ("id") VALUES (1, 'a;b');\nINSERT INTO "t" ("id") VALUES (2, 'c');`,
    );
    expect(applied).toBe(1);
    expect(failed).toBe(1);
    expect(errors).toEqual(["boom"]);
    // semicolon inside the string literal must not create a third statement
    expect(seen).toHaveLength(2);
  });

  it("does not skip the first row under a marker header", async () => {
    const seen: string[] = [];
    const query = async (_conn: string, sql: string) => {
      seen.push(sql);
      return { success: true };
    };
    const { applied, failed } = await applyDataSql(
      query,
      "conn",
      `-- Data for public.notes (2 rows)\nINSERT INTO "public"."notes" ("id") VALUES (1);\nINSERT INTO "public"."notes" ("id") VALUES (2);`,
    );
    expect(failed).toBe(0);
    expect(applied).toBe(2);
    expect(seen).toHaveLength(2);
    // marker comments are stripped, not executed
    expect(seen[0]).not.toContain("-- Data for");
  });

  it("parses per-table chunks from marker headers", () => {
    const chunks = parseDataChunks(
      `-- Data for public.parents (1 rows)\nINSERT INTO "public"."parents" ("id") VALUES (1);\n-- Data for public.children (1 rows)\nINSERT INTO "public"."children" ("id") VALUES (2);`,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ schema: "public", table: "parents" });
    expect(chunks[1]).toMatchObject({ schema: "public", table: "children" });
    expect(chunks[0].sql).toContain("VALUES (1)");
  });

  it("orders child tables after their parents", () => {
    const chunks = [
      { schema: "public", table: "children", sql: "INSERT INTO c" },
      { schema: "public", table: "parents", sql: "INSERT INTO p" },
      { schema: "public", table: "unrelated", sql: "INSERT INTO u" },
    ];
    const ordered = orderChunksByDependency(chunks, [
      { schema: "public", table: "children", refSchema: "public", refTable: "parents" },
    ]);
    const names = ordered.map((c) => c.table);
    expect(names.indexOf("parents")).toBeLessThan(names.indexOf("children"));
    // unknown tables keep working and are never dropped
    expect(names).toHaveLength(3);
  });

  it("never drops chunks involved in dependency cycles", () => {
    const chunks = [
      { schema: "public", table: "a", sql: "INSERT INTO a" },
      { schema: "public", table: "b", sql: "INSERT INTO b" },
    ];
    const ordered = orderChunksByDependency(chunks, [
      { schema: "public", table: "a", refSchema: "public", refTable: "b" },
      { schema: "public", table: "b", refSchema: "public", refTable: "a" },
    ]);
    expect(ordered).toHaveLength(2);
  });

  it("formats bytea and array values so they round-trip", () => {
    // Buffer serialized through JSON
    expect(formatValueWithType({ type: "Buffer", data: [222, 173] }, "bytea")).toBe(
      "'\\xdead'::bytea",
    );
    // hex strings restore exactly on bytea columns
    expect(formatValueWithType("\\xdead", "bytea")).toBe("'\\xdead'::bytea");
    // plain text on bytea columns stays backslash-safe
    expect(formatValueWithType("a\\b", "bytea")).toBe("'a\\\\b'");
    // arrays carry an explicit cast
    expect(formatValueWithType([1, 2], "_int4")).toBe("ARRAY[1,2]::int4[]");
    expect(formatValueWithType(["x;y"], "_text")).toBe("ARRAY['x;y']::text[]");
    expect(formatValueWithType([], "_text")).toBe("ARRAY[]::text[]");
  });

  it("strips comment-only lines", () => {
    expect(stripCommentLines("-- hello\n  -- world")).toBe("");
    expect(stripCommentLines("-- Data for x\nINSERT INTO t VALUES (1);")).toBe(
      "INSERT INTO t VALUES (1);",
    );
  });

  it("keeps -- lines that live inside multiline string values", () => {
    const sql = `INSERT INTO "t" ("body") VALUES ('line one\n-- not a comment\nline three');`;
    expect(stripCommentLines(sql)).toBe(sql);
  });

  it("ignores quotes inside comment lines when tracking strings", () => {
    // An apostrophe in a marker must not toggle string state: the following
    // multiline value's -- line is data and must survive.
    const sql = `-- Data for public.o'brien (1 rows)\nINSERT INTO "t" ("body") VALUES ('a\n-- kept\nb');`;
    expect(stripCommentLines(sql)).toBe(`INSERT INTO "t" ("body") VALUES ('a\n-- kept\nb');`);
  });

  it("terminates every chunk statement so multi-row tables execute", () => {
    const chunks = parseDataChunks(
      `-- Data for public.notes (2 rows)\nINSERT INTO "public"."notes" ("id") VALUES (1);\nINSERT INTO "public"."notes" ("id") VALUES (2);`,
    );
    expect(chunks).toHaveLength(1);
    // each INSERT carries its own terminator — sent as one query, both run
    expect(chunks[0].sql).toContain("VALUES (1);");
    expect(chunks[0].sql).toContain("VALUES (2);");
  });
});
