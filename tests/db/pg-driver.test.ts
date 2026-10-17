import { describe, it, expect } from "bun:test";
import {
  buildConnectionString,
  connectionStringHost,
  isNeonServerlessHost,
} from "@/lib/db/pg-driver";

describe("isNeonServerlessHost", () => {
  it("matches Neon-hosted databases", () => {
    expect(
      isNeonServerlessHost("ep-damp-meadow-b4s8rj1o-pooler.c-6.us-east-2.aws.neon.tech"),
    ).toBe(true);
    expect(isNeonServerlessHost("ep-foo.bar.neon.tech")).toBe(true);
    expect(isNeonServerlessHost("project.branch.neon.build")).toBe(true);
    expect(isNeonServerlessHost("EP-FOO.NEON.TECH")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isNeonServerlessHost("db.example.com")).toBe(false);
    expect(isNeonServerlessHost("localhost")).toBe(false);
    expect(isNeonServerlessHost("notneon.tech")).toBe(false);
    expect(isNeonServerlessHost("neon.tech.evil.com")).toBe(false);
    expect(isNeonServerlessHost("")).toBe(false);
    expect(isNeonServerlessHost(undefined)).toBe(false);
    expect(isNeonServerlessHost(null)).toBe(false);
  });
});

describe("connectionStringHost", () => {
  it("extracts the hostname from a libpq URL", () => {
    expect(
      connectionStringHost(
        "postgresql://user:pass@ep-x-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require",
      ),
    ).toBe("ep-x-pooler.us-east-2.aws.neon.tech");
  });

  it("returns an empty string for non-URL input", () => {
    expect(connectionStringHost("host=localhost port=5432")).toBe("");
  });
});

describe("buildConnectionString", () => {
  it("url-encodes credentials and defaults the port", () => {
    const built = buildConnectionString({
      host: "ep-x-pooler.us-east-2.aws.neon.tech",
      database: "neondb",
      username: "neondb_owner",
      password: "p@ss/word",
    });
    expect(built).toContain("@ep-x-pooler.us-east-2.aws.neon.tech:5432/neondb");
    expect(built).toContain("sslmode=require");
    expect(built).toContain("p%40ss%2Fword");
    // Round-trips to the same host so driver selection stays correct.
    expect(connectionStringHost(built)).toBe("ep-x-pooler.us-east-2.aws.neon.tech");
  });

  it("omits the auth section when there is no username", () => {
    const built = buildConnectionString({ host: "example.com", port: 6543, database: "db" });
    expect(built).toBe("postgresql://example.com:6543/db?sslmode=require");
  });
});
