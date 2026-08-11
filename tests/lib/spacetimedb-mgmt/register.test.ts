import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpacetimeDbConnectionString,
  parseSpacetimeDbConnection,
  registerSpacetimeDbDatabases,
  type RegisterSpacetimeDbDatabasesDeps,
} from "../../../lib/spacetimedb-mgmt/register";
import type { SpacetimeDbCloudDatabase } from "../../../lib/spacetimedb-mgmt/client";

function makeDatabase(identity: string, names: string[]): SpacetimeDbCloudDatabase {
  return { identity, names };
}

function makeDeps(
  databases: SpacetimeDbCloudDatabase[],
): { deps: RegisterSpacetimeDbDatabasesDeps; created: any[] } {
  const created: any[] = [];
  return {
    deps: {
      listDatabases: async () => databases,
      createConnection: async (payload) => {
        created.push(payload);
        return { success: true };
      },
    },
    created,
  };
}

test("parseSpacetimeDbConnection extracts bare host and database", () => {
  assert.deepEqual(
    parseSpacetimeDbConnection(
      "spacetimedbs://maincloud.spacetimedb.com/db-one?token=xyz",
    ),
    { host: "maincloud.spacetimedb.com", database: "db-one" },
  );
  assert.deepEqual(
    parseSpacetimeDbConnection("spacetimedb://localhost:8080/mydb?token=x"),
    { host: "localhost:8080", database: "mydb" },
  );
  assert.equal(parseSpacetimeDbConnection(""), null);
  assert.equal(parseSpacetimeDbConnection("postgresql://host/db"), null);
});

test("buildSpacetimeDbConnectionString strips http(s) and wss prefixes", () => {
  assert.equal(
    buildSpacetimeDbConnectionString("http://localhost:8080", "mydb", "tok"),
    "spacetimedb://localhost:8080/mydb?token=tok",
  );
  assert.equal(
    buildSpacetimeDbConnectionString(
      "https://maincloud.spacetimedb.com",
      "db-one",
      "tok",
    ),
    "spacetimedbs://maincloud.spacetimedb.com/db-one?token=tok",
  );
});

test("registerSpacetimeDbDatabases imports all databases", async () => {
  const { deps, created } = makeDeps([
    makeDatabase("id-1", ["db-one"]),
    makeDatabase("id-2", ["db-two"]),
  ]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 2,
    alreadyRegistered: 0,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 0,
  });
  assert.equal(created.length, 2);
  assert.equal(created[0].connectionType, "spacetimedb");
  assert.ok(created[0].connectionString.startsWith("spacetimedbs://"));
});

test("registerSpacetimeDbDatabases skips nameless databases", async () => {
  const { deps, created } = makeDeps([
    makeDatabase("id-1", ["db-one"]),
    makeDatabase("id-2", []),
  ]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 1,
    alreadyRegistered: 0,
    skippedLimit: 0,
    skippedNameless: 1,
    failed: 0,
  });
  assert.equal(created.length, 1);
});

test("registerSpacetimeDbDatabases dedupes against existing connections", async () => {
  const { deps, created } = makeDeps([
    makeDatabase("id-1", ["db-one"]),
    makeDatabase("id-2", ["db-two"]),
  ]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    ["spacetimedbs://maincloud.spacetimedb.com/db-one?token=old"],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 1,
    alreadyRegistered: 1,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 0,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "db-two");
});

test("registerSpacetimeDbDatabases dedupes with protocol-prefixed service host", async () => {
  const { deps, created } = makeDeps([
    makeDatabase("id-1", ["db-one"]),
    makeDatabase("id-2", ["db-two"]),
  ]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "https://MainCloud.SpacetimeDB.com/",
    ["spacetimedbs://maincloud.spacetimedb.com/db-one?token=old"],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 1,
    alreadyRegistered: 1,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 0,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "db-two");
});

test("registerSpacetimeDbDatabases dedupes http-prefixed self-hosted host", async () => {
  const { deps, created } = makeDeps([makeDatabase("id-1", ["mydb"])]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "http://localhost:8080",
    ["spacetimedb://localhost:8080/mydb?token=old"],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 1,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 0,
  });
  assert.equal(created.length, 0);
});

test("registerSpacetimeDbDatabases caps at maxConnections", async () => {
  const { deps, created } = makeDeps([
    makeDatabase("id-1", ["db-one"]),
    makeDatabase("id-2", ["db-two"]),
    makeDatabase("id-3", ["db-three"]),
  ]);
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    [],
    2,
    deps,
  );
  assert.deepEqual(result, {
    imported: 2,
    alreadyRegistered: 0,
    skippedLimit: 1,
    skippedNameless: 0,
    failed: 0,
  });
  assert.equal(created.length, 2);
});

test("registerSpacetimeDbDatabases counts create failures", async () => {
  let calls = 0;
  const deps: RegisterSpacetimeDbDatabasesDeps = {
    listDatabases: async () => [
      makeDatabase("id-1", ["db-one"]),
      makeDatabase("id-2", ["db-two"]),
    ],
    createConnection: async () => {
      calls += 1;
      if (calls % 2 === 1) throw new Error("boom");
      return { success: false };
    },
  };
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 2,
  });
});

test("registerSpacetimeDbDatabases never throws on list error", async () => {
  const deps: RegisterSpacetimeDbDatabasesDeps = {
    listDatabases: async () => {
      throw new Error("network down");
    },
    createConnection: async () => ({ success: true }),
  };
  const result = await registerSpacetimeDbDatabases(
    "token",
    "maincloud.spacetimedb.com",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 1,
  });
});
