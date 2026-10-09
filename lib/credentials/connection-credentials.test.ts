import { describe, expect, it } from "bun:test";
import { protectConnectionPayload } from "./connection-credentials";
import {
  hasConnectionSecret,
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
});
