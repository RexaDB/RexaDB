import { describe, expect, test } from "bun:test";
import { buildNeonWindowSql } from "@/lib/realtime/table-watch";

const base = { connectionString: "neon-cli://p/proj/br/db?role=r", schema: "public", table: "orders", limit: 100, offset: 900 };

describe("buildNeonWindowSql", () => {
  test("orders by primary key when the grid is unsorted", () => {
    expect(buildNeonWindowSql({ ...base, primaryKey: ["id"] })).toBe(
      `SELECT * FROM "public"."orders" ORDER BY "id" ASC LIMIT $1 OFFSET $2`,
    );
  });

  test("mirrors the grid's filter and sort, with the key as tiebreak", () => {
    expect(
      buildNeonWindowSql({
        ...base,
        primaryKey: ["tenant", "id"],
        filter: "status = 'open'",
        sort: { column: "id", direction: "DESC" },
      }),
    ).toBe(`SELECT * FROM "public"."orders" WHERE status = 'open' ORDER BY "id" DESC, "tenant" ASC LIMIT $1 OFFSET $2`);
  });
});
