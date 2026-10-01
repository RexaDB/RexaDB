import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadModule(file, dependencies) {
  const source = readFileSync(new URL(`../../lib/db/${file}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function("require", "exports", "setInterval", outputText)(
    (name) => dependencies[name] ?? {},
    exports,
    () => ({ unref() {} }),
  );
  return exports;
}

const connection = loadModule("pg-connection", {
  "./connection-type": { detectConnectionDbType: () => "postgres" },
});
const tls = loadModule("pg-tls", {
  "./pg-connection": connection,
  "node:fs": { readFileSync: (path) => `contents of ${path}` },
});
const unsupported = () => new Error("The server does not support SSL connections");

function createHarness({ plaintextError, tlsError = unsupported(), tunnelUrl } = {}) {
  const pools = [];
  const cancellations = [];
  let closedTunnels = 0;
  let finishQuery;
  let queryStarted;
  const started = new Promise((resolve) => { queryStarted = resolve; });
  class Pool {
    ended = false;
    constructor(config) { this.config = config; pools.push(this); }
    async connect() {
      if (this.config.ssl) throw tlsError;
      if (plaintextError) throw plaintextError;
      return {
        processID: 42,
        release() {},
        async query(sql) {
          if (sql === "WAIT") {
            queryStarted();
            await new Promise((resolve) => { finishQuery = resolve; });
          }
          return { rows: [], fields: [] };
        },
      };
    }
    async end() { this.ended = true; }
    on() {}
  }
  class Client {
    constructor(config) { this.config = config; cancellations.push(config); }
    async connect() { if (this.config.ssl) throw unsupported(); }
    async query() { finishQuery(); return { rows: [{ cancelled: true }] }; }
    async end() {}
  }
  const api = loadModule("pg-client", {
    pg: { Pool, Client },
    "./pg-connection": connection,
    "./pg-tls": tls,
    "./neon-cli-client": { resolveEffectiveConnectionString: async (url) => url },
    "./ssh-tunnel": {
      startSshTunnelIfNeeded: async (url) => ({
        connectionString: tunnelUrl ?? url,
        close: async () => { closedTunnels++; },
      }),
    },
  });
  return { api, pools, cancellations, started, closedTunnels: () => closedTunnels };
}

const url = "postgres://user:password@localhost/database";

test("strict ssl modes never reuse a plaintext fallback pool", async () => {
  const { api, pools } = createHarness();
  await api.executeQuery(`${url}?sslmode=prefer`, "SELECT 1");
  await api.executeQuery(`${url}?sslmode=prefer`, "SELECT 1");
  assert.equal(pools.length, 2);
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    await assert.rejects(api.executeQuery(`${url}?sslmode=${mode}`, "SELECT 1"), /does not support SSL/);
    assert.ok(pools.at(-1).config.ssl);
    assert.equal(pools.at(-1).ended, true);
  }
});

test("cancellation uses the fallback transport and tunnel endpoint", async () => {
  const harness = createHarness({ tunnelUrl: "postgres://user:password@127.0.0.1:4567/database?sslmode=prefer" });
  const running = harness.api.executeQuery(url, "WAIT", [], { queryId: "query" });
  await harness.started;
  assert.equal(await harness.api.cancelQueryById("query"), true);
  await running;
  assert.equal(harness.cancellations[0].ssl, false);
  assert.equal(harness.cancellations[0].port, 4567);
  assert.equal(harness.pools[1].config.port, 4567);
});

for (const [label, options] of [
  ["initial probe", { tlsError: new Error("authentication failed") }],
  ["plaintext probe", { plaintextError: new Error("authentication failed") }],
]) {
  test(`${label} failure closes pools and tunnels and permits retry`, async () => {
    const harness = createHarness(options);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await assert.rejects(harness.api.executeQuery(url, "SELECT 1"), /authentication failed/);
      assert.equal(harness.closedTunnels(), attempt);
      assert.ok(harness.pools.every((pool) => pool.ended));
    }
  });
}

test("connection test preserves startup options and closes both clients", async () => {
  const clients = [];
  class Client {
    ended = false;
    constructor(config) { this.config = config; clients.push(this); }
    async connect() { if (clients.length === 1) throw unsupported(); }
    async query() { return { rows: [] }; }
    async end() { this.ended = true; }
  }
  const savedPg = globalThis.__pg;
  globalThis.__pg = { Client };
  try {
    const api = loadModule("actions-core", {
      "./pg-connection": connection,
      "./pg-tls": tls,
      "./connection-type": { detectConnectionDbType: () => "postgres" },
      "./neon-cli-client": { resolveEffectiveConnectionString: async (value) => value },
    });
    const original = `${url}?sslmode=prefer&dbname=other&application_name=studio&options=-c%20statement_timeout%3D5000&sslcert=missing&ssl=1`;
    assert.deepEqual(await api.testConnection(original), { success: true });
    const initial = new URL(clients[0].config.connectionString);
    assert.equal(clients[0].config.ssl.cert, "contents of missing");
    assert.equal(initial.searchParams.has("sslmode"), false);
    const retry = new URL(clients[1].config.connectionString);
    for (const key of ["dbname", "application_name", "options"]) {
      assert.equal(retry.searchParams.get(key), new URL(original).searchParams.get(key));
      assert.equal(initial.searchParams.get(key), new URL(original).searchParams.get(key));
    }
    const parsedClient = new (require("pg").Client)(clients[1].config);
    assert.equal(parsedClient.connectionParameters.ssl, false);
    assert.ok(clients.every((client) => client.ended));
  } finally {
    globalThis.__pg = savedPg;
  }
});

for (const mode of ["disable", "prefer", "allow", "require", "verify-ca", "verify-full"]) {
  test(`test clients and query pools share tls settings for ${mode}`, async () => {
    const connectionString = `${url}?sslmode=${mode}&sslrootcert=private-ca&sslcert=client-cert&sslkey=client-key`;
    const { api, pools } = createHarness();
    try {
      await api.executeQuery(connectionString, "SELECT 1");
    } catch (error) {
      assert.match(error.message, /does not support SSL/);
    }
    const client = new (require("pg").Client)(tls.getPgClientConfig(connectionString));
    const poolSsl = pools[0].config.ssl;
    const clientSsl = client.connectionParameters.ssl;
    if (mode === "disable") {
      assert.equal(poolSsl, false);
      assert.equal(clientSsl, false);
      return;
    }
    assert.equal(poolSsl.rejectUnauthorized, mode.startsWith("verify-"));
    for (const key of ["ca", "cert", "key", "rejectUnauthorized"]) {
      assert.equal(clientSsl[key], poolSsl[key]);
    }
    assert.equal(poolSsl.ca, "contents of private-ca");
    assert.equal(typeof poolSsl.checkServerIdentity, mode === "verify-ca" ? "function" : "undefined");
    assert.equal(typeof clientSsl.checkServerIdentity, typeof poolSsl.checkServerIdentity);
  });
}
