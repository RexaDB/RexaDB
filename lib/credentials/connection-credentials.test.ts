import { describe, expect, it, spyOn } from "bun:test";
import { hydrateConnection, protectConnectionPayload } from "./connection-credentials";
import * as localVault from "./local-vault";
import {
  applyRowDriverSettings,
  hasConnectionSecret,
  redactedTargetForComparison,
  restorePostgresPassword,
  stripConnectionSecrets,
} from "./connection-secret-utils";

describe("protectConnectionPayload reference retention (issue #21)", () => {
  it("keeps an existing credentialRef when the payload has no inline secret", async () => {
    const out = await protectConnectionPayload({
      id: 1,
      name: "local",
      connectionString: "postgresql://postgres@localhost:5432/postgres?sslmode=disable",
      password: "",
      credentialRef: "kept-ref-123",
      credentialSecret: null,
    });
    expect(out.credentialRef).toBe("kept-ref-123");
    expect(out.connectionString).toContain("postgresql://postgres@localhost");
  });

  it("keeps credentialRef on partial updates such as lastActive-only payloads that include the ref", async () => {
    const out = await protectConnectionPayload({
      lastActive: Date.now(),
      credentialRef: "partial-ref",
    });
    expect(out.credentialRef).toBe("partial-ref");
  });

  it("clears credentials only when credentialRef is explicitly null", async () => {
    const out = await protectConnectionPayload({
      connectionString: "postgresql://postgres@localhost:5432/postgres",
      credentialRef: null,
      credentialSecret: "v1.should-clear",
      password: null,
    });
    expect(out.credentialRef).toBeNull();
    expect(out.credentialSecret).toBeNull();
    expect(out.password).toBeNull();
  });

  it("keeps credentialRef when the redacted target is unchanged", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "postgresql://postgres:s3cret@localhost:5432/postgres?sslmode=disable",
        password: null,
        authToken: null,
      }),
    );
    try {
      const out = await protectConnectionPayload({
        connectionString: "postgresql://postgres@localhost:5432/postgres?sslmode=disable",
        password: "",
        credentialRef: "vault:keep-me",
        credentialSecret: "v1.keep",
      });
      expect(out.credentialRef).toBe("vault:keep-me");
    } finally {
      decryptSpy.mockRestore();
    }
  });

  it("drops a stale credentialRef when the saved target changes", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "postgresql://postgres:s3cret@old-host:5432/old-db?sslmode=require",
        password: "s3cret",
        authToken: null,
      }),
    );
    try {
      const out = await protectConnectionPayload({
        connectionString: "postgresql://postgres@new-host:5432/new-db?sslmode=require",
        password: "",
        credentialRef: "vault:stale-ref",
        credentialSecret: "v1.stale",
      });
      expect(out.credentialRef).toBeNull();
      expect(out.connectionString).toContain("new-host");
    } finally {
      decryptSpy.mockRestore();
    }
  });

  it("refreshes the bundle in place when only driver settings change", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X",
        password: null,
        authToken: null,
      }),
    );
    let encryptedArgs!: [string, string];
    const encryptSpy = spyOn(localVault, "encryptVaultSecret").mockImplementation(async (ref, plaintext) => {
      encryptedArgs = [ref, plaintext];
      return "v1.refreshed-envelope";
    });
    try {
      const out = await protectConnectionPayload({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/new.jar",
        password: "",
        credentialRef: "vault:driver-ref",
        credentialSecret: "v1.old-envelope",
      });
      expect(out.credentialRef).toBe("vault:driver-ref");
      expect(out.credentialSecret).toBe("v1.refreshed-envelope");
      expect(encryptedArgs[0]).toBe("vault:driver-ref");
      const refreshed = JSON.parse(encryptedArgs[1]);
      expect(refreshed.connectionString).toContain("jarPaths=");
    } finally {
      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    }
  });

  it("keeps a URL-only password when refreshing driver settings", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/old.jar&password=s3cret",
        password: null,
        authToken: null,
      }),
    );
    let encryptedArgs!: [string, string];
    const encryptSpy = spyOn(localVault, "encryptVaultSecret").mockImplementation(async (ref, plaintext) => {
      encryptedArgs = [ref, plaintext];
      return "v1.refreshed-envelope";
    });
    try {
      const out = await protectConnectionPayload({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/new.jar",
        password: "",
        credentialRef: "vault:driver-ref",
        credentialSecret: "v1.old-envelope",
      });
      expect(out.credentialRef).toBe("vault:driver-ref");
      expect(out.credentialSecret).toBe("v1.refreshed-envelope");
      const refreshed = JSON.parse(encryptedArgs[1]);
      expect(refreshed.connectionString).toContain("password=s3cret");
      expect(refreshed.connectionString).toContain("new.jar");
      expect(refreshed.connectionString).not.toContain("old.jar");
    } finally {
      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    }
  });

  it("does not rewrite the bundle when only the presented secret is redacted", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&password=s3cret",
        password: null,
        authToken: null,
      }),
    );
    const encryptSpy = spyOn(localVault, "encryptVaultSecret").mockResolvedValue("v1.unexpected");
    try {
      const out = await protectConnectionPayload({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X",
        password: "",
        credentialRef: "vault:same-ref",
        credentialSecret: "v1.same",
      });
      expect(out.credentialRef).toBe("vault:same-ref");
      expect(out.credentialSecret).toBe("v1.same");
      expect(encryptSpy).toHaveBeenCalledTimes(0);
    } finally {
      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    }
  });

  it("does not rewrite the bundle when nothing changed", async () => {
    const bundle = JSON.stringify({
      connectionString: "postgresql://postgres:s3cret@localhost:5432/mydb",
      password: "s3cret",
      authToken: null,
    });
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(bundle);
    const encryptSpy = spyOn(localVault, "encryptVaultSecret").mockResolvedValue("v1.unexpected");
    try {
      const out = await protectConnectionPayload({
        connectionString: "postgresql://postgres@localhost:5432/mydb",
        password: "",
        credentialRef: "vault:same-ref",
        credentialSecret: "v1.same",
      });
      expect(out.credentialRef).toBe("vault:same-ref");
      expect(out.credentialSecret).toBe("v1.same");
      expect(encryptSpy).toHaveBeenCalledTimes(0);
    } finally {
      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    }
  });
});

describe("connection credential redaction", () => {
  it("removes URL passwords without changing non-secret parameters", () => {
    expect(stripConnectionSecrets("postgresql://alice:s3cret@db.example/app?sslmode=require"))
      .toBe("postgresql://alice@db.example/app?sslmode=require");
  });

  it("removes token and password query parameters", () => {
    expect(stripConnectionSecrets("https://db.example/?authToken=abc&ssl=true&password=pwd"))
      .toBe("https://db.example/?ssl=true");
  });

  it("detects secret-bearing DSNs and explicit fields", () => {
    expect(hasConnectionSecret({ connectionString: "postgres://u:p@host/db" })).toBe(true);
    expect(hasConnectionSecret({ connectionString: "postgres://u@host/db", authToken: "t" })).toBe(true);
    expect(hasConnectionSecret({ connectionString: "postgres://u@host/db" })).toBe(false);
  });

  it("handles alternate token parameter spellings and malformed URLs", () => {
    expect(stripConnectionSecrets("https://db.example/?api_token=abc&ssl=true"))
      .toBe("https://db.example/?ssl=true");
    expect(stripConnectionSecrets("legacy-dsn?token=abc&ssl=true"))
      .toBe("legacy-dsn?ssl=true");
  });

  it("redacts JDBC password properties", () => {
    expect(stripConnectionSecrets("jdbc:sqlserver://db.example;user=app;password=secret"))
      .toBe("jdbc:sqlserver://db.example;user=app");
    expect(hasConnectionSecret({ connectionString: "jdbc:postgresql://db.example/app?password=secret" })).toBe(true);
    expect(stripConnectionSecrets("jdbc:oracle:thin:app/secret@//db.example/service"))
      .toBe("jdbc:oracle:thin:app@//db.example/service");
    expect(hasConnectionSecret({ connectionString: "jdbc:oracle:thin:app/secret@//db.example/service" })).toBe(true);
  });

  it("restores explicit PostgreSQL credentials into a safe in-memory URL", () => {
    expect(restorePostgresPassword("postgresql://db.example/app", "app-user", "p@ss"))
      .toBe("postgresql://app-user:p%40ss@db.example/app");
  });

  it("compares redacted targets ignoring passwords and incidental params", () => {
    expect(
      redactedTargetForComparison("postgresql://postgres:s3cret@db.example/app?sslmode=require"),
    ).toBe(redactedTargetForComparison("postgresql://postgres@db.example/app?sslmode=require"));
    expect(
      redactedTargetForComparison("jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/a.jar"),
    ).toBe(redactedTargetForComparison("jdbc:postgresql://db.example/app?driverClass=org.X"));
    expect(
      redactedTargetForComparison("postgresql://postgres@old-host:5432/app"),
    ).not.toBe(redactedTargetForComparison("postgresql://postgres@new-host:5432/app"));
  });

  it("merges row driver settings onto the bundle URL without touching the target", () => {
    expect(
      applyRowDriverSettings(
        "jdbc:postgresql://db.example/app?driverClass=org.X",
        "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/new.jar",
      ),
    ).toBe("jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=%2Fnew.jar");
    expect(
      applyRowDriverSettings(
        "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/old.jar",
        "jdbc:postgresql://db.example/app?driverClass=org.X",
      ),
    ).toBe("jdbc:postgresql://db.example/app?driverClass=org.X");
    const unchanged = "jdbc:postgresql://db.example/app?driverClass=org.X";
    expect(applyRowDriverSettings(unchanged, unchanged)).toBe(unchanged);
    expect(applyRowDriverSettings("not-a-url", "also-not-a-url")).toBe("not-a-url");
  });
});

describe("hydrateConnection stale-bundle guard", () => {
  it("keeps the row target and flags credentialError instead of replaying the old URL", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "postgresql://postgres:s3cret@old-host:5432/old-db",
        password: "s3cret",
        authToken: null,
      }),
    );
    try {
      const out = await hydrateConnection({
        id: 9,
        connectionString: "postgresql://postgres@new-host:5432/new-db",
        password: null,
        credentialRef: "vault:stale-ref",
        credentialSecret: "v1.stale",
      } as any);
      expect(out.connectionString).toContain("new-host");
      expect(out.connectionString).not.toContain("old-host");
      expect(out.password).toBeNull();
      expect((out as any).credentialError).toBe(true);
    } finally {
      decryptSpy.mockRestore();
    }
  });

  it("hydrates normally when the bundle target matches the row", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "postgresql://postgres:s3cret@localhost:5432/mydb",
        password: "s3cret",
        authToken: null,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ success: true })) as unknown as typeof fetch;
    try {
      const out = await hydrateConnection({
        id: 10,
        connectionString: "postgresql://postgres@localhost:5432/mydb",
        password: null,
        credentialRef: "vault:good-ref",
        credentialSecret: "v1.good",
      } as any);
      expect(out.connectionString).toContain("localhost");
      expect((out as any).credentialError).toBeUndefined();
    } finally {
      decryptSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("clears a transient credentialError once unlock succeeds", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "postgresql://postgres:s3cret@localhost:5432/mydb",
        password: "s3cret",
        authToken: null,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ success: true })) as unknown as typeof fetch;
    try {
      const out = await hydrateConnection({
        id: 12,
        connectionString: "postgresql://postgres@localhost:5432/mydb",
        password: null,
        credentialRef: "vault:recovered-ref",
        credentialSecret: "v1.recovered",
        credentialError: true,
      } as any);
      expect(out.connectionString).toContain("s3cret");
      expect((out as any).credentialError).toBeUndefined();
    } finally {
      decryptSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the row driver settings instead of replaying the bundle ones", async () => {
    const decryptSpy = spyOn(localVault, "decryptVaultSecret").mockResolvedValue(
      JSON.stringify({
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/old.jar&password=s3cret",
        password: null,
        authToken: null,
      }),
    );
    const originalFetch = globalThis.fetch;
    let cachedBody!: string;
    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      cachedBody = String(init?.body ?? null);
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    try {
      const out = await hydrateConnection({
        id: 11,
        connectionString: "jdbc:postgresql://db.example/app?driverClass=org.X&jarPaths=/new.jar",
        password: null,
        credentialRef: "vault:driver-ref",
        credentialSecret: "v1.driver",
      } as any);
      expect(out.connectionString).toContain("jarPaths=");
      expect(out.connectionString).toContain("new.jar");
      expect(out.connectionString).not.toContain("old.jar");
      expect(out.connectionString).toContain("password=s3cret");
      expect((out as any).credentialError).toBeUndefined();
      expect(cachedBody).toContain("new.jar");
    } finally {
      decryptSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });
});
