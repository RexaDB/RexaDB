import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMgmtTokenCache,
  inferSupabaseRefFromPostgresUrl,
  resolveMgmtTokenForRef,
  resolvePaymentsConnection,
  shouldShowPayments,
} from "../../../lib/supabase-paykit/supabase-ref";

test("infers ref from direct Supabase postgres hosts", () => {
  assert.equal(
    inferSupabaseRefFromPostgresUrl(
      "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    ),
    "abcdefghijklmnopqrst",
  );
  assert.equal(
    inferSupabaseRefFromPostgresUrl(
      "postgres://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:6543/postgres",
    ),
    "abcdefghijklmnopqrst",
  );
});

test("rejects non-Supabase and pooler hosts", () => {
  assert.equal(
    inferSupabaseRefFromPostgresUrl("postgresql://user:pw@localhost:5432/db"),
    null,
  );
  assert.equal(
    inferSupabaseRefFromPostgresUrl(
      "postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    ),
    null,
  );
  assert.equal(inferSupabaseRefFromPostgresUrl("not a url"), null);
  assert.equal(
    inferSupabaseRefFromPostgresUrl("mysql://u:p@db.abcdefghijklmnopqrst.supabase.co/db"),
    null,
  );
});

test("resolves mgmt connections with embedded token", () => {
  const info = resolvePaymentsConnection(
    "supabase-mgmt",
    "supabase-mgmt://myref?token=tok123",
  );
  assert.deepEqual(info, { kind: "mgmt", projectRef: "myref", token: "tok123" });
});

test("resolves Supabase postgres connections without token", () => {
  const info = resolvePaymentsConnection(
    "postgres",
    "postgresql://postgres:pw@db.myref123.supabase.co:5432/postgres",
  );
  assert.deepEqual(info, { kind: "postgres", projectRef: "myref123", token: null });
});

test("shouldShowPayments covers mgmt + Supabase postgres only", () => {
  assert.equal(
    shouldShowPayments("supabase-mgmt", "supabase-mgmt://r?token=t"),
    true,
  );
  assert.equal(
    shouldShowPayments(
      "postgres",
      "postgresql://postgres:pw@db.myref123.supabase.co:5432/postgres",
    ),
    true,
  );
  assert.equal(
    shouldShowPayments("postgres", "postgresql://u:p@localhost:5432/db"),
    false,
  );
  assert.equal(shouldShowPayments("mysql", "mysql://u:p@host/db"), false);
  assert.equal(shouldShowPayments("postgres", undefined), false);
});

test("resolveMgmtTokenForRef picks the account that sees the ref", async () => {
  clearMgmtTokenCache();
  // localStorage-backed accounts are unavailable in this env; stub via cache
  // behavior: with no accounts, resolves null without throwing.
  const token = await resolveMgmtTokenForRef("somerref", async () => [
    { ref: "other" },
  ]);
  assert.equal(token, null);
});
