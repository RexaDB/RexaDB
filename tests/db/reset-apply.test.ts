import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetAndApplySql } from "@/lib/db/export-helpers";

/**
 * Fake pg client with REAL transaction-abort semantics: any failed
 * statement aborts the transaction until ROLLBACK TO SAVEPOINT.
 * Catches regressions where an unprotected statement poisons the txn and
 * every later statement fails with "current transaction is aborted".
 */
function makeFakePg(failOn: (sql: string) => string | null) {
  const seen: string[] = [];
  let aborted = false;
  class FakeClient {
    constructor(public config: unknown) {}
    async connect() {}
    async end() {}
    async query(sql: string) {
      seen.push(sql);
      const s = sql.trim();
      if (/^SAVEPOINT\b/i.test(s)) {
        if (aborted) throw new Error("current transaction is aborted");
        return {};
      }
      if (/^ROLLBACK TO SAVEPOINT/i.test(s)) {
        aborted = false;
        return {};
      }
      if (/^RELEASE/i.test(s)) return {};
      if (/^BEGIN/i.test(s)) {
        aborted = false;
        return {};
      }
      if (/^COMMIT/i.test(s)) {
        if (aborted) throw new Error("current transaction is aborted");
        return {};
      }
      if (/^ROLLBACK;?$/i.test(s)) {
        aborted = false;
        return {};
      }
      if (aborted) {
        throw new Error("current transaction is aborted, commands ignored until end of transaction block");
      }
      const msg = failOn(sql);
      if (msg) {
        aborted = true;
        throw new Error(msg);
      }
      return { rows: [] };
    }
  }
  return { seen, FakeClient };
}

const DSN = "postgres://u:p@127.0.0.1:5432/db";
let savedPg: unknown;

beforeEach(() => {
  savedPg = (globalThis as any).__pg;
});

afterEach(() => {
  (globalThis as any).__pg = savedPg;
});

describe("resetAndApplySql transaction hygiene", () => {
  it("a failed trigger DISABLE does not poison later statements", async () => {
    const { seen, FakeClient } = makeFakePg((sql) =>
      /DISABLE TRIGGER ALL/.test(sql) ? "permission denied" : null,
    );
    (globalThis as any).__pg = { Client: FakeClient };
    const schema = `CREATE TABLE "public"."t" ("id" integer);`;
    const data =
      `-- Data for public.t (1 rows)\nINSERT INTO "public"."t" ("id") VALUES (1);`;
    const res = (await resetAndApplySql(DSN, schema, data)) as { warnings: string[] };
    expect(res.warnings.join(" ")).toContain("Could not disable triggers");
    // data still applied — no "transaction is aborted" cascade
    expect(seen.filter((s) => s.includes("INSERT INTO")).length).toBeGreaterThan(0);
    expect(JSON.stringify(res.warnings)).not.toContain("transaction is aborted");
  });

  it("a failing structural statement still aborts loudly with context", async () => {
    const { FakeClient } = makeFakePg((sql) =>
      sql.includes("CREATE TABLE") ? 'relation "t" already exists' : null,
    );
    (globalThis as any).__pg = { Client: FakeClient };
    await expect(
      resetAndApplySql(DSN, `CREATE TABLE "public"."t" ("id" integer);`),
    ).rejects.toThrow(/Schema apply failed at/);
  });
});
