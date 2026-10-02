import { describe, expect, it } from "bun:test";
import {
  hasConnectionSecret,
  restorePostgresPassword,
  stripConnectionSecrets,
} from "./connection-secret-utils";

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
