import { describe, expect, it } from "bun:test";
import {
  buildOracleConnectionString,
  buildOracleNetConnectString,
  parseOracleConnectionString,
} from "./oracle-connection";

describe("oracle-connection", () => {
  it("builds service name URLs", () => {
    const url = buildOracleConnectionString({
      host: "db.example.com",
      port: "1521",
      username: "hr",
      password: "secret",
      connectMode: "service",
      target: "ORCLPDB1",
      sslMode: "disable",
    });
    expect(url).toBe(
      "oracle://hr:secret@db.example.com:1521/ORCLPDB1?sslmode=disable",
    );
  });

  it("builds SID URLs without a path service", () => {
    const url = buildOracleConnectionString({
      host: "localhost",
      port: "1521",
      username: "system",
      password: "oracle",
      connectMode: "sid",
      target: "ORCL",
      sslMode: "disable",
    });
    expect(url).toBe(
      "oracle://system:oracle@localhost:1521/?sslmode=disable&sid=ORCL",
    );
    expect(url.includes("/ORCL?")).toBe(false);
    expect(url).toContain("sid=ORCL");
  });

  it("parses service name and SID mutually exclusively", () => {
    const service = parseOracleConnectionString(
      "oracle://hr:x@host:1521/XEPDB1?sslmode=disable",
    );
    expect(service.connectMode).toBe("service");
    expect(service.target).toBe("XEPDB1");

    const sid = parseOracleConnectionString(
      "oracle://hr:x@host:1521/?sid=ORCL&sslmode=disable",
    );
    expect(sid.connectMode).toBe("sid");
    expect(sid.target).toBe("ORCL");
  });

  it("round-trips service and SID forms", () => {
    for (const mode of ["service", "sid"] as const) {
      const built = buildOracleConnectionString({
        host: "db",
        port: "1521",
        username: "u",
        password: "p",
        connectMode: mode,
        target: mode === "service" ? "SVC" : "SID1",
        sslMode: "require",
      });
      const parsed = parseOracleConnectionString(built);
      expect(parsed.connectMode).toBe(mode);
      expect(parsed.target).toBe(mode === "service" ? "SVC" : "SID1");
      expect(parsed.sslMode).toBe("require");
    }
  });

  it("renders Easy Connect for service and descriptor for SID", () => {
    expect(
      buildOracleNetConnectString({
        host: "db.example.com",
        port: "1521",
        username: "hr",
        password: "x",
        connectMode: "service",
        target: "ORCLPDB1",
        sslMode: "disable",
      }),
    ).toBe("db.example.com:1521/ORCLPDB1");

    expect(
      buildOracleNetConnectString({
        host: "db.example.com",
        port: "1521",
        username: "hr",
        password: "x",
        connectMode: "sid",
        target: "ORCL",
        sslMode: "disable",
      }),
    ).toBe(
      "(DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=db.example.com)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))",
    );
  });

  it("rejects missing target", () => {
    expect(() =>
      buildOracleNetConnectString({
        host: "localhost",
        port: "1521",
        username: "u",
        password: "p",
        connectMode: "service",
        target: "",
        sslMode: "disable",
      }),
    ).toThrow(/service name/i);
  });
});
