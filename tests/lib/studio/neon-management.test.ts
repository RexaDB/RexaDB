import { describe, expect, it } from "bun:test";
import { buildNeonCliConnectionString } from "@/lib/neon-cli/pointer";
import { getNeonManagementPointer, isNeonDatabaseConnection, isNeonManagementConnection } from "@/lib/studio/neon-management";

const connection = buildNeonCliConnectionString({ profile: "DEFAULT", projectId: "proj-1", branchId: "br-1", database: "neondb", role: "neondb_owner" });

describe("Neon management connection detection", () => {
  it("accepts only account-linked Neon connection pointers", () => {
    expect(isNeonManagementConnection("neon", connection)).toBe(true);
    expect(isNeonManagementConnection("postgres", connection)).toBe(false);
    expect(isNeonManagementConnection("neon", "postgres://user:pass@host/db")).toBe(false);
  });

  it("detects Neon when PostgreSQL catalog mode or a direct Neon URL is used", () => {
    expect(isNeonDatabaseConnection("postgres", connection)).toBe(true);
    expect(isNeonDatabaseConnection("postgres", "postgresql://user:pass@ep-example.neon.tech/db")).toBe(true);
    expect(isNeonDatabaseConnection("postgres", "postgresql://localhost/db", ["neon_auth"])).toBe(true);
    expect(isNeonDatabaseConnection("postgres", "postgresql://localhost/db", ["public"])).toBe(false);
  });

  it("preserves the profile and branch scope for resource requests", () => {
    expect(getNeonManagementPointer(connection)).toEqual({
      profile: "DEFAULT", projectId: "proj-1", branchId: "br-1", database: "neondb", role: "neondb_owner",
    });
  });
});
