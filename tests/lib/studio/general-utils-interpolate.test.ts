import { describe, it, expect } from "bun:test";
import {
  interpolateSqlParamsForDisplay,
  interpolateSqlParamsForExecution,
} from "@/lib/studio/general-utils";

describe("interpolateSqlParams", () => {
  it("execution keeps string values quoted (no keyword collapse)", () => {
    const sql = `INSERT INTO "t" ("a", "b", "c") VALUES ($1, $2, $3);`;
    expect(interpolateSqlParamsForExecution(sql, ["null", "42", true])).toBe(
      `INSERT INTO "t" ("a", "b", "c") VALUES ('null', '42', TRUE);`,
    );
  });

  it("leaves $n inside quoted identifiers alone", () => {
    const sql = `INSERT INTO "t" ("$1", "v") VALUES ($1, $2);`;
    expect(interpolateSqlParamsForExecution(sql, ["x", "y"])).toBe(
      `INSERT INTO "t" ("$1", "v") VALUES ('x', 'y');`,
    );
  });

  it("leaves $n inside string literals alone", () => {
    const sql = `INSERT INTO "t" ("v") VALUES ('cost is $1');`;
    expect(interpolateSqlParamsForExecution(sql, ["x"])).toBe(sql);
  });

  it("leaves $n inside comments alone", () => {
    const sql = `INSERT INTO "t" ("v") VALUES ($1); -- $1 stays\n-- $2 stays`;
    expect(interpolateSqlParamsForExecution(sql, ["x"])).toBe(
      `INSERT INTO "t" ("v") VALUES ('x'); -- $1 stays\n-- $2 stays`,
    );
  });

  it("leaves function-body $n inside dollar quotes alone", () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE '%', $1; END; $$ LANGUAGE plpgsql;`;
    expect(interpolateSqlParamsForExecution(sql, ["x"])).toBe(sql);
  });

  it("escapes single quotes in values", () => {
    const sql = `INSERT INTO "t" ("v") VALUES ($1);`;
    expect(interpolateSqlParamsForExecution(sql, ["o'clock"])).toBe(
      `INSERT INTO "t" ("v") VALUES ('o''clock');`,
    );
  });

  it("supports ? placeholders outside strings", () => {
    expect(
      interpolateSqlParamsForExecution(`INSERT INTO "t" ("v") VALUES (?);`, ["a?b"]),
    ).toBe(`INSERT INTO "t" ("v") VALUES ('a?b');`);
  });

  it("keeps out-of-range placeholders untouched", () => {
    const sql = `INSERT INTO "t" ("v") VALUES ($1, $9);`;
    expect(interpolateSqlParamsForExecution(sql, ["x"])).toBe(
      `INSERT INTO "t" ("v") VALUES ('x', $9);`,
    );
  });

  it("display interpolation is also identifier-safe", () => {
    const sql = `INSERT INTO "t" ("$1", "v") VALUES ($1, $2);`;
    expect(interpolateSqlParamsForDisplay(sql, ["x", "y"])).toBe(
      `INSERT INTO "t" ("$1", "v") VALUES ('x', 'y');`,
    );
  });
});
