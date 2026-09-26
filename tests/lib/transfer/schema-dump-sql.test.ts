import { describe, it, expect } from "bun:test";
import { applyTransferViaQuery, buildSchemaDumpViaSql, sanitizeExtensionsForDestination } from "@/lib/transfer/schema-dump-sql";
import { isProgrammableStatement } from "@/lib/transfer/transfer-sql";
import type { QueryFn } from "@/lib/transfer/transfer-sql";

function mockQuery(
  handler: (sql: string) => { rows?: Record<string, unknown>[]; error?: string },
): QueryFn & { seen: string[] } {
  const seen: string[] = [];
  const fn = (async (_conn: string, sql: string) => {
    seen.push(sql);
    const out = handler(sql);
    if (out.error !== undefined) return { success: false, error: out.error };
    return { success: true, data: { rows: out.rows ?? [] } };
  }) as QueryFn & { seen: string[] };
  fn.seen = seen;
  return fn;
}

describe("buildSchemaDumpViaSql", () => {
  it("emits tables, primary keys and foreign keys from catalog rows", async () => {
    const query = mockQuery((sql) => {
      if (sql.includes("FROM pg_attribute")) {
        return {
          rows: [
            { table_name: "users", column_name: "id", data_type: "uuid", not_null: true, default_value: "gen_random_uuid()" },
            { table_name: "users", column_name: "email", data_type: "text", not_null: false, default_value: null },
            { table_name: "posts", column_name: "id", data_type: "bigint", not_null: true, default_value: null },
            { table_name: "posts", column_name: "user_id", data_type: "uuid", not_null: false, default_value: null },
          ],
        };
      }
      if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
        return {
          rows: [
            { table_name: "users", constraint_name: "users_pkey", column_name: "id" },
            { table_name: "posts", constraint_name: "posts_pkey", column_name: "id" },
          ],
        };
      }
      if (sql.includes("pg_constraint") && sql.includes("contype = 'f'")) {
        return {
          rows: [{
            table_name: "posts",
            name: "posts_user_id_fkey",
            def: "FOREIGN KEY (user_id) REFERENCES public.users(id)",
          }],
        };
      }
      if (sql.includes("pg_extension")) return { rows: [] };
      if (sql.includes("information_schema.sequences")) return { rows: [] };
      return { rows: [] };
    });
    const { sql, warnings } = await buildSchemaDumpViaSql(query, "supabase-mgmt://x?token=y", ["public"]);
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "public"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."users"');
    expect(sql).toContain('"id" uuid DEFAULT gen_random_uuid() NOT NULL');
    expect(sql).toContain('ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id")');
    expect(sql).toContain('ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id)');
    // tables before constraints (order-safe apply)
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("ADD CONSTRAINT"));
    expect(warnings).toEqual([]);
    expect(query.seen.length).toBeGreaterThan(3);
  });
});

describe("applyTransferViaQuery", () => {
  it("applies drops, schema and FK-ordered data through the query fn", async () => {
    const seen: string[] = [];
    const query = (async (_conn: string, sql: string) => {
      seen.push(sql);
      if (sql.includes("table_constraints")) {
        return {
          success: true,
          data: {
            rows: [{ schema: "public", tbl: "children", ref_schema: "public", ref_table: "parents" }],
          },
        };
      }
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    const dataSql = [
      "-- Data for public.children (1 rows)",
      'INSERT INTO "public"."children" ("id") VALUES (1);',
      "-- Data for public.parents (1 rows)",
      'INSERT INTO "public"."parents" ("id") VALUES (2);',
    ].join("\n");
    const { appliedStatements, warnings } = await applyTransferViaQuery(
      query,
      "supabase-mgmt://x?token=y",
      ['DROP SCHEMA IF EXISTS "old" CASCADE;'],
      'CREATE TABLE "public"."t" ("id" integer);',
      dataSql,
    );
    expect(warnings).toEqual([]);
    expect(appliedStatements).toBe(1 + 1 + 2);
    const stmts = seen.join("\n");
    // parents load before children despite export order
    expect(stmts.indexOf('"parents"')).toBeLessThan(stmts.indexOf('"children"'));
  });

  it("fails loudly with partial-modification disclosure", async () => {
    const query = (async (_conn: string, sql: string) => {
      if (sql.includes("CREATE TABLE")) return { success: false, error: "permission denied" };
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    await expect(
      applyTransferViaQuery(query, "conn", [], 'CREATE TABLE "public"."t" ("id" integer);'),
    ).rejects.toThrow(/PARTIALLY/);
  });
});

describe("sanitizeExtensionsForDestination", () => {  it("keeps creatable extensions and comments out rejected ones", async () => {
    const query = (async (_conn: string, sql: string) => {
      if (sql.includes("pg_cron")) return { success: false, error: "can only create extension in database postgres" };
      if (sql.includes("supabase_vault")) return { success: false, error: 'extension "supabase_vault" is not in the allowed extensions list' };
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    const { sql, warnings } = await sanitizeExtensionsForDestination(
      query,
      "conn",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\nCREATE EXTENSION IF NOT EXISTS "pg_cron";\nCREATE EXTENSION IF NOT EXISTS "supabase_vault";\nCREATE TABLE "public"."t" ("id" integer);',
    );
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(sql).toContain('CREATE TABLE "public"."t" ("id" integer);');
    expect(sql).not.toMatch(/^CREATE EXTENSION IF NOT EXISTS "pg_cron"/m);
    expect(sql).toContain("-- SKIPPED EXTENSION");
    expect(warnings.join(" ")).toContain("pg_cron");
    expect(warnings.join(" ")).toContain("supabase_vault");
    expect(warnings).toHaveLength(2);
  });

  it("re-terminates kept statements so they never fuse", async () => {
    const query = (async () => ({ success: true, data: { rows: [] } })) as QueryFn;
    const { sql } = await sanitizeExtensionsForDestination(
      query,
      "conn",
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\nCREATE SCHEMA IF NOT EXISTS "public";',
    );
    // every code statement ends with its own terminator
    const { splitSqlStatements } = await import("@/lib/transfer/transfer-sql");
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("uuid-ossp");
    expect(parts[1]).toContain("CREATE SCHEMA");
  });
});

describe("isProgrammableStatement", () => {
  it("classifies functions, triggers, policies and views", async () => {
    const { isProgrammableStatement: isP } = await import("@/lib/transfer/transfer-sql");
    expect(isP).toBe(isProgrammableStatement);
    expect(isProgrammableStatement("CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql")).toBe(true);
    expect(isProgrammableStatement("CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f()")).toBe(true);
    expect(isProgrammableStatement("CREATE POLICY p ON x FOR SELECT TO public USING (true)")).toBe(true);
    expect(isProgrammableStatement("CREATE OR REPLACE VIEW v AS SELECT 1")).toBe(true);
    expect(isProgrammableStatement('CREATE TABLE "x" ("id" integer)')).toBe(false);
    expect(isProgrammableStatement('ALTER TABLE "x" ADD CONSTRAINT c PRIMARY KEY ("id")')).toBe(false);
    expect(isProgrammableStatement("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")).toBe(false);
  });
});

describe("applyTransferViaQuery programmable tolerance", () => {
  it("warns on failing functions but throws on failing tables", async () => {
    const query = (async (_conn: string, sql: string) => {
      if (sql.includes("CREATE OR REPLACE FUNCTION bad")) return { success: false, error: "function does not exist" };
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    // failing function -> warnings, no throw
    const ok = await applyTransferViaQuery(
      query,
      "conn",
      [],
      'CREATE TABLE "public"."t" ("id" integer);\nCREATE OR REPLACE FUNCTION bad() RETURNS void AS $$ SELECT missing_fn(); $$ LANGUAGE sql;',
    );
    expect(ok.warnings.join(" ")).toContain("Skipped programmable object");
    // failing table -> throws
    const badTable = (async (_conn: string, sql: string) => {
      if (sql.includes("CREATE TABLE")) return { success: false, error: "denied" };
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    await expect(
      applyTransferViaQuery(badTable, "conn", [], 'CREATE TABLE "public"."t" ("id" integer);'),
    ).rejects.toThrow(/PARTIALLY/);
  });
});

describe("buildSchemaDumpViaSql custom types", () => {
  it("emits enums, domains and composites before tables", async () => {
    const query = (async (_conn: string, sql: string) => {
      if (sql.includes("pg_enum")) {
        return { success: true, data: { rows: [{ name: "mood", labels: "{happy,sad}" }] } };
      }
      if (sql.includes("typtype = 'd'")) {
        return { success: true, data: { rows: [{ name: "slug", base: "text", not_null: true }] } };
      }
      if (sql.includes("typtype = 'c'")) {
        return {
          success: true,
          data: { rows: [{ name: "address", col: "city", type: "text" }, { name: "address", col: "zip", type: "text" }] },
        };
      }
      return { success: true, data: { rows: [] } };
    }) as QueryFn;
    const { buildSchemaDumpViaSql: build } = await import("@/lib/transfer/schema-dump-sql");
    const { sql } = await build(query, "supabase-mgmt://ref?token=t", ["public"]);
    expect(sql).toContain('CREATE TYPE "public"."mood" AS ENUM (\'happy\', \'sad\')');
    expect(sql).toContain('CREATE DOMAIN "public"."slug" AS text NOT NULL');
    expect(sql).toContain('CREATE TYPE "public"."address" AS ("city" text, "zip" text)');
  });
});
