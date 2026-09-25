import { describe, it, expect } from "bun:test";
import {
  applyDataSql,
  escapeIdent,
  escapeLiteral,
  exportTableDataSql,
  formatSqlValue,
  splitSqlStatements,
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
});
