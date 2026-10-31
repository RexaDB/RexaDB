import { describe, expect, test } from "bun:test";
import {
  buildDatabaseObjectSections,
  databaseObjectKey,
  renameRoutineDefinition,
} from "@/lib/studio/database-objects";
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
    expect(section.items).toHaveLength(2);
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
      "hr",
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
});

test("catalog support covers MySQL routines and Postgres sequences", () => {
  expect(supportsRoutineCatalog("mysql")).toBe(true);
  expect(supportsSequenceCatalog("postgres")).toBe(true);
  expect(supportsSequenceCatalog("mysql")).toBe(false);
});
