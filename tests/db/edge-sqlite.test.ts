import test from "node:test";
import assert from "node:assert/strict";
import {
  detectEdgeSqliteKind,
  parseEdgeSqliteTarget,
  createEdgeSqliteDriver,
  getEdgeDatabaseLabel,
} from "../../lib/db/edge-sqlite";
import { detectConnectionDbType } from "../../lib/db/connection-type";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init: any) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  let calls = 0;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls++;
    return handler(String(url), init);
  };
  return {
    calls: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("detectEdgeSqliteKind identifies edge schemes", () => {
  assert.equal(detectEdgeSqliteKind("rqlite://host:4001"), "rqlite");
  assert.equal(detectEdgeSqliteKind("rqlites://host:4001"), "rqlite");
  assert.equal(detectEdgeSqliteKind("d1://acct/db123?token=x"), "d1");
  assert.equal(detectEdgeSqliteKind("starbase://host:8787?token=x"), "starbase");
  assert.equal(detectEdgeSqliteKind("starbasedb://host:8787?token=x"), "starbase");
  assert.equal(detectEdgeSqliteKind("valtown://?token=x"), "valtown");
  assert.equal(detectEdgeSqliteKind("postgres://localhost/db"), null);
  assert.equal(detectEdgeSqliteKind("libsql://foo.turso.io?authToken=x"), null);
  assert.equal(detectEdgeSqliteKind("/tmp/app.db"), null);
});

test("parseEdgeSqliteTarget parses rqlite auth and base", () => {
  const target = parseEdgeSqliteTarget("rqlite://admin:secret@db.internal:4001");
  assert.equal(target?.kind, "rqlite");
  if (target?.kind === "rqlite") {
    assert.equal(target.baseUrl, "http://db.internal:4001");
    assert.equal(target.username, "admin");
    assert.equal(target.password, "secret");
  }
  const tls = parseEdgeSqliteTarget("rqlites://db.internal:4001");
  assert.equal(tls?.kind, "rqlite");
  if (tls?.kind === "rqlite") {
    assert.equal(tls.baseUrl, "https://db.internal:4001");
  }
});

test("parseEdgeSqliteTarget parses d1 account/database/token", () => {
  const target = parseEdgeSqliteTarget("d1://myaccount/mydb123?token=CF_TOKEN");
  assert.equal(target?.kind, "d1");
  if (target?.kind === "d1") {
    assert.equal(target.accountId, "myaccount");
    assert.equal(target.databaseId, "mydb123");
    assert.equal(target.token, "CF_TOKEN");
  }
  assert.throws(() => parseEdgeSqliteTarget("d1://myaccount/mydb123"), /token/);
  assert.throws(() => parseEdgeSqliteTarget("d1://onlyone"), /Invalid/);
});

test("parseEdgeSqliteTarget parses starbase and valtown", () => {
  const starbase = parseEdgeSqliteTarget("starbases://my-db.workers.dev?token=abc");
  assert.equal(starbase?.kind, "starbase");
  if (starbase?.kind === "starbase") {
    assert.equal(starbase.baseUrl, "https://my-db.workers.dev");
    assert.equal(starbase.token, "abc");
  }
  assert.throws(() => parseEdgeSqliteTarget("starbase://host:8787"), /token/);
  const valtown = parseEdgeSqliteTarget("valtown://?token=vt_123");
  assert.equal(valtown?.kind, "valtown");
  if (valtown?.kind === "valtown") {
    assert.equal(valtown.token, "vt_123");
  }
  assert.throws(() => parseEdgeSqliteTarget("valtown://"), /token/);
});

test("getEdgeDatabaseLabel returns friendly labels", () => {
  assert.equal(
    getEdgeDatabaseLabel({ kind: "rqlite", baseUrl: "http://db.internal:4001" }),
    "db.internal",
  );
  assert.equal(
    getEdgeDatabaseLabel({ kind: "d1", accountId: "a", databaseId: "dbid123456", token: "t" }),
    "d1:dbid1234",
  );
  assert.equal(getEdgeDatabaseLabel({ kind: "valtown", token: "t" }), "valtown");
});

test("detectConnectionDbType routes edge schemes to sqlite", () => {
  assert.equal(detectConnectionDbType("rqlite://host:4001"), "sqlite");
  assert.equal(detectConnectionDbType("d1://acct/db?token=x"), "sqlite");
  assert.equal(detectConnectionDbType("starbase://host:8787?token=x"), "sqlite");
  assert.equal(detectConnectionDbType("valtown://?token=x"), "sqlite");
  assert.equal(detectConnectionDbType("d1://acct/db?token=x", "d1"), "sqlite");
  assert.equal(detectConnectionDbType("rqlite://host:4001", "rqlite"), "sqlite");
  assert.equal(detectConnectionDbType("starbase://h?token=x", "starbase"), "sqlite");
  assert.equal(detectConnectionDbType("valtown://?token=x", "valtown"), "sqlite");
});

test("rqlite driver maps unified response to rows", async () => {
  const m = mockFetch((url) => {
    assert.match(url, /\/db\/request\?timings/);
    return jsonResponse({
      results: [
        {
          columns: ["id", "name"],
          types: ["integer", "text"],
          values: [[1, "a"], [2, "b"]],
          rows_affected: 0,
          time: 1,
        },
      ],
    });
  });
  try {
    const target = parseEdgeSqliteTarget("rqlite://host:4001")!;
    const driver = createEdgeSqliteDriver(target);
    const rows = await driver.all("SELECT * FROM t");
    assert.deepEqual(rows, [{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const one = await driver.get("SELECT * FROM t WHERE id = ?", [1]);
    assert.deepEqual(one, { id: 1, name: "a" });
    // Transaction control statements are no-ops (no HTTP call).
    const before = m.calls();
    const tx = await driver.run("BEGIN");
    assert.deepEqual(tx, { changes: 0 });
    assert.equal(m.calls(), before);
  } finally {
    m.restore();
  }
});

test("rqlite driver surfaces row errors and write counts", async () => {
  const m = mockFetch(() =>
    jsonResponse({ results: [{ error: "no such table: missing" }] }),
  );
  try {
    const driver = createEdgeSqliteDriver(parseEdgeSqliteTarget("rqlite://h:4001")!);
    await assert.rejects(() => driver.all("SELECT * FROM missing"), /no such table/);
  } finally {
    m.restore();
  }

  const m2 = mockFetch(() =>
    jsonResponse({ results: [{ rows_affected: 3, time: 0 }] }),
  );
  try {
    const driver = createEdgeSqliteDriver(parseEdgeSqliteTarget("rqlite://h:4001")!);
    assert.deepEqual(await driver.run("DELETE FROM t"), { changes: 3 });
  } finally {
    m2.restore();
  }
});

test("d1 driver maps object rows and changes", async () => {
  const m = mockFetch((url, init) => {
    assert.match(url, /api\.cloudflare\.com\/client\/v4\/accounts\/a\/d1\/database\/d\/query/);
    assert.match(String(init?.headers?.Authorization || ""), /Bearer tok/);
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.sql, "SELECT * FROM t");
    return jsonResponse({
      success: true,
      errors: [],
      result: [
        {
          results: [{ id: 1, name: "a" }],
          meta: { changes: 0, duration: 2 },
        },
      ],
    });
  });
  try {
    const driver = createEdgeSqliteDriver(parseEdgeSqliteTarget("d1://a/d?token=tok")!);
    assert.deepEqual(await driver.all("SELECT * FROM t"), [{ id: 1, name: "a" }]);
  } finally {
    m.restore();
  }

  const m2 = mockFetch(() =>
    jsonResponse({
      success: false,
      errors: [{ message: "D1_ERROR: no such table" }],
      result: [],
    }),
  );
  try {
    const driver = createEdgeSqliteDriver(parseEdgeSqliteTarget("d1://a/d?token=tok")!);
    await assert.rejects(() => driver.all("SELECT 1"), /D1_ERROR/);
  } finally {
    m2.restore();
  }
});

test("starbase driver maps column/row arrays", async () => {
  const m = mockFetch((url, init) => {
    assert.match(url, /\/query\/raw$/);
    assert.match(String(init?.headers?.Authorization || ""), /Bearer tok/);
    return jsonResponse({
      result: {
        columns: ["id", "name"],
        rows: [[1, "a"]],
        meta: { rows_read: 1, rows_written: 0 },
      },
    });
  });
  try {
    const driver = createEdgeSqliteDriver(
      parseEdgeSqliteTarget("starbase://h:8787?token=tok")!,
    );
    assert.deepEqual(await driver.all("SELECT * FROM t"), [{ id: 1, name: "a" }]);
  } finally {
    m.restore();
  }
});

test("valtown driver maps libsql-shaped result sets", async () => {
  const m = mockFetch((url) => {
    assert.match(url, /api\.val\.town\/v1\/sqlite\/execute/);
    return jsonResponse({
      columns: ["id", "name"],
      columnTypes: ["INTEGER", "TEXT"],
      rows: [[1, "a"], [2, "b"]],
      rowsAffected: 0,
    });
  });
  try {
    const driver = createEdgeSqliteDriver(parseEdgeSqliteTarget("valtown://?token=vt")!);
    const rows = await driver.all("SELECT * FROM t");
    assert.deepEqual(rows, [{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    assert.deepEqual(await driver.get("SELECT * FROM t"), { id: 1, name: "a" });
  } finally {
    m.restore();
  }
});
