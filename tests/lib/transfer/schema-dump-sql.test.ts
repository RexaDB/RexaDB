import { describe, it, expect } from "bun:test";
import { applyTransferViaQuery, buildSchemaDumpViaSql } from "@/lib/transfer/schema-dump-sql";
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
    expect(sql).toContain('CREATE TABLE "public"."users"');
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
