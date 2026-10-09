#!/usr/bin/env bun
/**
 * End-to-end smoke test against a local Oracle Free container via the
 * native rexadb-oracle-bridge (no JDBC).
 *
 * Expects:
 *   docker compose -f docker/oracle/docker-compose.yml up -d
 *   bridge binary at src-tauri/binaries/rexadb-oracle-bridge
 *
 * Env overrides:
 *   ORACLE_HOST, ORACLE_PORT, ORACLE_SERVICE, ORACLE_SID,
 *   ORACLE_USER, ORACLE_PASSWORD, REXADB_ORACLE_BRIDGE
 */

import { spawn } from "bun";
import path from "path";

const host = process.env.ORACLE_HOST || "localhost";
const port = process.env.ORACLE_PORT || "1521";
const service = process.env.ORACLE_SERVICE || "FREEPDB1";
const sid = process.env.ORACLE_SID || "FREE";
const username = process.env.ORACLE_USER || "rexadb";
const password = process.env.ORACLE_PASSWORD || "rexadb";
const preferredSchema = (
  process.env.ORACLE_SCHEMA ||
  username ||
  "REXADB"
).toUpperCase();

const bridge =
  process.env.REXADB_ORACLE_BRIDGE ||
  path.join(process.cwd(), "src-tauri/binaries/rexadb-oracle-bridge");

function log(...args) {
  console.log("[oracle-e2e]", ...args);
}

async function withBridge(fn) {
  const proc = spawn([bridge], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let buffer = "";
  const pending = new Map();
  let reqId = 0;

  const reader = proc.stdout.getReader();
  const pump = (async () => {
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          const p = pending.get(String(resp.reqId));
          if (p) {
            pending.delete(String(resp.reqId));
            if (resp.ok) p.resolve(resp);
            else p.reject(new Error(resp.data?.error || "bridge error"));
          }
        } catch (e) {
          log("bad json:", line, e);
        }
      }
    }
  })();

  const send = (cmd) =>
    new Promise((resolve, reject) => {
      const id = String(++reqId);
      cmd.reqId = id;
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify(cmd) + "\n");
    });

  try {
    return await fn(send);
  } finally {
    try {
      proc.stdin.end();
    } catch {}
    try {
      proc.kill();
    } catch {}
    await Promise.race([pump, new Promise((r) => setTimeout(r, 500))]);
  }
}

async function exercise(
  label,
  connectString,
  { expectSeed = false, user = username, pass = password } = {},
) {
  log(`--- ${label}: ${connectString} (user=${user})`);
  await withBridge(async (send) => {
    const connect = await send({
      action: "connect",
      config: { connectString, username: user, password: pass },
    });
    const session = connect.session;
    log("connected session", session);

    const schemas = await send({ action: "schemas", session });
    const schemaNames = (schemas.data.rows || []).map((r) => String(r[0]));
    log("schemas sample:", schemaNames.slice(0, 8));

    const query = await send({
      action: "query",
      session,
      sql: "SELECT banner FROM v$version WHERE banner LIKE 'Oracle%'",
      params: [],
    });
    log("version:", (query.data.rows || [])[0]?.[0]);

    if (expectSeed) {
      const owner = schemaNames.includes(preferredSchema)
        ? preferredSchema
        : schemaNames.includes(username.toUpperCase())
          ? username.toUpperCase()
          : schemaNames[0];

      const tables = await send({ action: "tables", session, schema: owner });
      const tableRows = tables.data.rows || [];
      log(
        "tables:",
        tableRows.slice(0, 10).map((r) => `${r[2]}.${r[0]} (${r[1]})`),
      );

      const hasEmployees = tableRows.some(
        (r) => String(r[0]).toUpperCase() === "EMPLOYEES",
      );
      if (!hasEmployees) {
        throw new Error(
          `Expected EMPLOYEES in schema ${owner}; got ${
            tableRows.map((r) => r[0]).join(", ") || "(none)"
          }`,
        );
      }

      const emp = await send({
        action: "query",
        session,
        sql: `SELECT id, first_name, last_name, salary FROM ${owner}.employees ORDER BY id`,
        params: [],
      });
      log("employees rows:", emp.data.rows);
      if (!(emp.data.rows || []).length) {
        throw new Error("EMPLOYEES query returned no rows");
      }

      const structure = await send({
        action: "structure",
        session,
        schema: owner,
        table: "EMPLOYEES",
      });
      log(
        "employees columns:",
        (structure.data.rows || []).map((r) => `${r[0]}:${r[1]}`),
      );

      const fks = await send({
        action: "foreign-keys",
        session,
        schema: owner,
        table: "EMPLOYEES",
      });
      log("employees fks:", fks.data.rows);
      if (!(fks.data.rows || []).length) {
        throw new Error("Expected FK from EMPLOYEES.DEPARTMENT_ID");
      }
    } else {
      // SID connects to CDB$ROOT on Oracle Free (SID=FREE); seed lives in FREEPDB1.
      const dual = await send({
        action: "query",
        session,
        sql: "SELECT 1 AS n, USER AS u FROM dual",
        params: [],
      });
      log("dual:", dual.data.rows);
    }

    await send({ action: "disconnect", session });
    log(`${label} OK`);
  });
}

function isListenerNotReady(err) {
  const msg = String(err?.message || err || "");
  return (
    /ORA-12514/i.test(msg) ||
    /not registered with the listener/i.test(msg) ||
    /ORA-12541/i.test(msg) ||
    /ORA-12505/i.test(msg) ||
    /Connection refused/i.test(msg) ||
    /temporarily unavailable/i.test(msg)
  );
}

async function waitUntilServiceReady({
  connectString = `${host}:${port}/${service}`,
  user = username,
  pass = password,
  attempts = Number(process.env.ORACLE_READY_ATTEMPTS || 60),
  delayMs = Number(process.env.ORACLE_READY_DELAY_MS || 5000),
} = {}) {
  log(
    `waiting for Oracle listener service ${service} (up to ~${Math.round(
      (attempts * delayMs) / 1000,
    )}s)...`,
  );
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      await withBridge(async (send) => {
        const connect = await send({
          action: "connect",
          config: { connectString, username: user, password: pass },
        });
        await send({ action: "disconnect", session: connect.session });
      });
      log(`listener ready on attempt ${i}`);
      return;
    } catch (err) {
      lastErr = err;
      if (!isListenerNotReady(err) && i > 3) {
        // Credential / permanent errors shouldn't spin forever after a few tries.
        throw err;
      }
      log(
        `attempt ${i}/${attempts}: ${String(err?.message || err).slice(0, 140)}`,
      );
      await Bun.sleep(delayMs);
    }
  }
  throw lastErr || new Error("Oracle listener did not become ready in time");
}

async function main() {
  log("bridge:", bridge);
  await waitUntilServiceReady();
  // Service Name opens FREEPDB1 where APP_USER + seed tables live.
  await exercise("service-name", `${host}:${port}/${service}`, {
    expectSeed: true,
  });
  // SID=FREE is the CDB on Oracle Free. APP_USER lives only in FREEPDB1,
  // so use SYSTEM here to verify the SID connect-descriptor path.
  await exercise(
    "sid",
    `(DESCRIPTION=(ADDRESS=(PROTOCOL=tcp)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`,
    { expectSeed: false, user: "system", pass: password },
  );
  log("all smoke checks passed");
}

main().catch((err) => {
  console.error("[oracle-e2e] FAILED:", err?.message || err);
  process.exit(1);
});
