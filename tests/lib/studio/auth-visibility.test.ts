import { describe, expect, it } from "bun:test";
import { buildSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import { isSupabaseAuthConnection, shouldShowAuth } from "@/lib/studio/auth/visibility";

const mgmt = buildSupabaseMgmtConnectionString("abcdefghijklmnop", "sbp_token");

describe("Authentication section visibility", () => {
  it("shows for supabase-mgmt connections before schemas load", () => {
    expect(isSupabaseAuthConnection("supabase-mgmt", mgmt)).toBe(true);
    expect(shouldShowAuth("supabase-mgmt", mgmt, [])).toBe(true);
    expect(shouldShowAuth("supabase-mgmt", mgmt, undefined)).toBe(true);
  });

  it("shows for direct Postgres connections to a Supabase project", () => {
    const url = "postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres";
    expect(shouldShowAuth("postgres", url, [])).toBe(true);
  });

  it("shows for any connection exposing an auth schema", () => {
    expect(shouldShowAuth("postgres", "postgres://u:p@localhost/db", ["public", "auth"])).toBe(true);
  });

  it("stays hidden for plain Postgres without an auth schema", () => {
    expect(shouldShowAuth("postgres", "postgres://u:p@localhost/db", ["public"])).toBe(false);
    expect(isSupabaseAuthConnection("postgres", "postgres://u:p@localhost/db")).toBe(false);
  });
});
