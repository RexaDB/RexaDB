import { describe, expect, test } from "bun:test";
import {
  buildDatabaseObjectSections,
  databaseObjectKey,
  databaseObjectTabId,
  isRestorableTab,
  renameRoutineDefinition,
} from "@/lib/studio/database-objects";
import { mysqlRoutineCharacteristics } from "@/lib/db/mysql-client";
import { supportsRoutineCatalog, supportsSequenceCatalog } from "@/lib/db/connection-type";

describe("buildDatabaseObjectSections", () => {
  test("splits routines and carries Postgres metadata", () => {
    const sections = buildDatabaseObjectSections(
      {
        functions: [
          {
            schema: "public",
            name: "quotes_accepted_frozen",
            type: "FUNCTION",
            arguments: "",
            definition: "CREATE OR REPLACE FUNCTION public.quotes_accepted_frozen()",
            volatility: "VOLATILE",
            security_definer: false,
            owner: "postgres",
            language: "plpgsql",
            return_type: "trigger",
          },
          { schema: "public", name: "refresh", type: "PROCEDURE", arguments: "" },
          { schema: "other", name: "hidden", type: "FUNCTION", arguments: "" },
        ],
      },
      "public",
    );

    expect(sections.map((section) => section.kind)).toEqual(["function", "procedure"]);
    expect(sections[0].items[0].metadata).toEqual([
      { label: "Volatility", value: "VOLATILE" },
      { label: "Security", value: "INVOKER" },
      { label: "Owner", value: "postgres" },
      { label: "Language", value: "plpgsql" },
      { label: "Returns", value: "trigger" },
    ]);
  });

  test("merges one trigger's per-event rows and prefers its full definition", () => {
    const [section] = buildDatabaseObjectSections(
      {
        triggers: [
          { schema: "public", name: "t", table_name: "a", timing: "AFTER", event: "INSERT", definition: "EXECUTE FUNCTION f()", full_definition: "CREATE TRIGGER t" },
          { schema: "public", name: "t", table_name: "a", timing: "AFTER", event: "UPDATE", definition: "EXECUTE FUNCTION f()", full_definition: "CREATE TRIGGER t" },
        ],
      },
      "public",
    );

    expect(section.items).toHaveLength(1);
    expect(section.items[0].definition).toBe("CREATE TRIGGER t");
    expect(section.items[0].metadata).toContainEqual({ label: "Events", value: "INSERT, UPDATE" });
  });

  test("keeps triggers of the same name on different tables apart", () => {
    const [section] = buildDatabaseObjectSections(
      {
        triggers: [
          { schema: "public", name: "t", table_name: "a", event: "INSERT" },
          { schema: "public", name: "t", table_name: "b", event: "INSERT" },
        ],
      },
      "public",
    );
    expect(new Set(section.items.map(databaseObjectKey)).size).toBe(2);
  });

  test("matches schema names exactly", () => {
    const sections = buildDatabaseObjectSections(
      { enums: [{ schema: "Public", name: "other", values: [] }] },
      "public",
    );
    expect(sections).toEqual([]);
  });

  test("quotes embedded double quotes in generated SQL", () => {
    const sections = buildDatabaseObjectSections(
      {
        enums: [{ schema: 'a"b', name: 'c"d', values: [] }],
        sequences: [{ schema: 'a"b', name: 'c"d', start_value: "1" }],
      },
      'a"b',
    );
    for (const section of sections) {
      expect(section.items[0].definition).toContain(`"a""b"."c""d"`);
    }
  });

  test("gives same-named overloads different keys", () => {
    const [section] = buildDatabaseObjectSections(
      {
        functions: [
          { schema: "public", name: "f", arguments: "a integer" },
          { schema: "public", name: "f", arguments: "a text" },
        ],
      },
      "public",
    );
    expect(new Set(section.items.map(databaseObjectKey)).size).toBe(2);
  });

  test("synthesizes a Postgres sequence and leaves Oracle rows metadata-only", () => {
    const [postgres] = buildDatabaseObjectSections(
      {
        sequences: [{
          schema: "public", name: "s", data_type: "bigint", start_value: "1", min_value: "1",
          max_value: "9", increment_by: "1", cycle_flag: false, cache_size: "1", last_number: null,
        }],
      },
      "public",
    );
    expect(postgres.items[0].definition).toContain(`CREATE SEQUENCE "public"."s"`);

    const [oracle] = buildDatabaseObjectSections(
      { sequences: [{ schema: "HR", name: "S", last_number: 7, increment_by: 1, cycle_flag: true }] },
      "HR",
    );
    expect(oracle.items[0].definition).toBe("");
  });

  test("filters by name and drops sections left empty", () => {
    const sections = buildDatabaseObjectSections(
      {
        functions: [{ schema: "public", name: "alpha" }],
        enums: [{ schema: "public", name: "beta", values: ["it's"] }],
      },
      "public",
      "BET",
    );
    expect(sections.map((section) => section.kind)).toEqual(["enum"]);
    expect(sections[0].items[0].definition).toContain("'it''s'");
  });

  test("keeps database-wide links regardless of schema", () => {
    const [section] = buildDatabaseObjectSections(
      { dbLinks: [{ name: "REMOTE", owner: "PUBLIC", host: "db2" }] },
      "HR",
    );
    expect(section.kind).toBe("db-link");
  });
});

describe("renameRoutineDefinition", () => {
  test("renames the routine, not a schema of the same name", () => {
    expect(
      renameRoutineDefinition("CREATE OR REPLACE FUNCTION f.f(a int)\n SELECT f(1)", "f", "f_duplicate"),
    ).toBe("CREATE OR REPLACE FUNCTION f.f_duplicate(a int)\n SELECT f(1)");
  });

  test("handles quoted identifiers", () => {
    expect(
      renameRoutineDefinition(`CREATE FUNCTION "S"."Fn"()`, "Fn", "Fn_duplicate"),
    ).toBe(`CREATE FUNCTION "S"."Fn_duplicate"()`);
  });

  test("handles embedded quotes and parentheses", () => {
    expect(
      renameRoutineDefinition(`CREATE FUNCTION public."a""b"()`, 'a"b', 'a"b_duplicate'),
    ).toBe(`CREATE FUNCTION public."a""b_duplicate"()`);
    expect(
      renameRoutineDefinition(`CREATE FUNCTION public."a(b"(x int)`, "a(b", "a(b_duplicate"),
    ).toBe(`CREATE FUNCTION public."a(b_duplicate"(x int)`);
  });

  test("returns null rather than leaving the original name in place", () => {
    expect(renameRoutineDefinition("CREATE FUNCTION public.other()", "f", "f_duplicate")).toBeNull();
    expect(renameRoutineDefinition("", "f", "f_duplicate")).toBeNull();
  });
});

test("object tab IDs stay unique and free of selector and pane delimiters", () => {
  const object = (name: string) => ({
    kind: "function" as const,
    schema: "public",
    name,
    definition: "",
    metadata: [],
  });
  const id = databaseObjectTabId(object('a"b::pane::c'));
  expect(id).toMatch(/^object-[A-Za-z0-9%._~!*'()-]+$/);
  expect(id).not.toBe(databaseObjectTabId(object("a")));
});

test("only drops object tabs that have no object", () => {
  expect(isRestorableTab({ type: "sql" })).toBe(true);
  expect(isRestorableTab({ type: "database-object" })).toBe(false);
  expect(isRestorableTab({ type: "database-object", databaseObject: {} })).toBe(true);
});

test("MySQL definitions keep their behavior-changing characteristics", () => {
  expect(
    mysqlRoutineCharacteristics({
      is_deterministic: "YES",
      data_access: "READS SQL DATA",
      security_type: "INVOKER",
      comment: "it's",
    }),
  ).toEqual(["DETERMINISTIC", "READS SQL DATA", "SQL SECURITY INVOKER", "COMMENT 'it''s'"]);
});

test("catalog support covers MySQL routines and Postgres sequences", () => {
  expect(supportsRoutineCatalog("mysql")).toBe(true);
  expect(supportsSequenceCatalog("postgres")).toBe(true);
  expect(supportsSequenceCatalog("mysql")).toBe(false);
});
