import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { migrateAndHydrateConnections } from "@/lib/credentials/connection-migration";
import * as connectionCredentials from "@/lib/credentials/connection-credentials";
import * as localVault from "@/lib/credentials/local-vault";

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

  it("does not fall back to pre-migration inline secrets after persist already wrote a ref", async () => {
    const modeSpy = spyOn(localVault, "getCredentialStorageMode").mockReturnValue("keychain");
    const protectSpy = spyOn(connectionCredentials, "protectConnectionPayload").mockImplementation(async (payload: any) => ({
      ...payload,
      connectionString: "postgresql://postgres@localhost:5432/mydb?sslmode=prefer",
      password: null,
      authToken: null,
      credentialRef: "migrated-ref",
      credentialSecret: null,
      credentialStorageMode: "keychain",
    }));
    let hydrateCalls = 0;
    const hydrateSpy = spyOn(connectionCredentials, "hydrateConnection").mockImplementation(async () => {
      hydrateCalls += 1;
      throw new Error("Could not unlock saved credentials.");
    });

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/api/connections/secure-migration/complete")) {
        return Response.json({ success: true });
      }
      if (url.includes("/api/connections/") && init?.method === "PUT") {
        return Response.json({ success: true });
      }
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    try {
      const rows = [
        {
          id: 3,
          connectionString: "postgresql://postgres:12345@localhost:5432/mydb?sslmode=prefer",
          credentialRef: null,
        },
      ];
      const [out] = await migrateAndHydrateConnections(rows as any);
      expect(protectSpy).toHaveBeenCalled();
      expect(hydrateCalls).toBeGreaterThan(0);
      expect(out.credentialError).toBe(true);
      expect(out.credentialRef).toBe("migrated-ref");
      expect(out.connectionString).not.toContain("12345");
    } finally {
      modeSpy.mockRestore();
      protectSpy.mockRestore();
      hydrateSpy.mockRestore();
    }
  });
});
