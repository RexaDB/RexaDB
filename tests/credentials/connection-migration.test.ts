import { afterEach, describe, expect, it } from "bun:test";
import { migrateAndHydrateConnections } from "@/lib/credentials/connection-migration";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Vault locked / sidecar unreachable, except the secure-cleanup endpoint
// which reports success so tests observe only migration behavior.
function mockLockedVault() {
  globalThis.fetch = (async (input) => {
    if (String(input).includes("/api/connections/secure-migration/complete")) {
      return Response.json({ success: true });
    }
    throw new Error("vault locked");
  }) as typeof fetch;
}

describe("connection migration fallback (issue #21)", () => {
  it("preserves working inline passwords when migration fails", async () => {
    mockLockedVault();
    const rows = [
      {
        id: 1,
        connectionString: "postgresql://postgres:12345@localhost:5432/mydb?sslmode=prefer",
        credentialRef: null,
      },
    ];
    const [out] = await migrateAndHydrateConnections(rows as any);
    expect(out.connectionString).toContain("12345");
    expect(out.credentialError).toBeUndefined();
  });

  it("flags credentialError when a stored reference cannot be unlocked", async () => {
    mockLockedVault();
    const rows = [
      {
        id: 2,
        connectionString: "postgresql://postgres@localhost:5432/mydb?sslmode=prefer",
        credentialRef: "abc123",
        password: null,
        authToken: null,
      },
    ];
    const [out] = await migrateAndHydrateConnections(rows as any);
    expect(out.credentialError).toBe(true);
    expect(out.connectionString).not.toContain("12345");
  });
});
