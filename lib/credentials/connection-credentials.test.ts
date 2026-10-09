import { describe, expect, it, spyOn } from "bun:test";
import { hydrateConnection, protectConnectionPayload } from "./connection-credentials";
import * as localVault from "./local-vault";
import {
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
});
