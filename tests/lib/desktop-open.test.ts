import test from "node:test";
import assert from "node:assert/strict";
import {
  dbTypeToProvider,
  deriveOpenConnectionName,
  shouldUpdateStoredCredentials,
} from "../../lib/desktop-open";

test("dbTypeToProvider maps UI provider ids", () => {
  assert.equal(dbTypeToProvider("postgres"), "postgresql");
  assert.equal(dbTypeToProvider("sqlite"), "sqlite");
  assert.equal(dbTypeToProvider("mysql"), "mysql");
  assert.equal(dbTypeToProvider("mongodb"), "mongodb");
  assert.equal(dbTypeToProvider("redis"), "redis");
  assert.equal(dbTypeToProvider("duckdb"), "duckdb");
  assert.equal(dbTypeToProvider("mssql"), "mssql");
  assert.equal(dbTypeToProvider("trino"), "trino");
});

test("deriveOpenConnectionName handles database URLs", () => {
  assert.equal(
    deriveOpenConnectionName("postgres://u:p@localhost:5432/mydb"),
    "mydb @ localhost:5432",
  );
  assert.equal(
    deriveOpenConnectionName("mysql://root@db.internal/shop"),
    "shop @ db.internal",
  );
  assert.equal(deriveOpenConnectionName("redis://localhost:6379"), "localhost:6379");
  assert.equal(
    deriveOpenConnectionName("mongodb+srv://u:p@cluster.net/admin"),
    "admin @ cluster.net",
  );
});

test("deriveOpenConnectionName handles file paths", () => {
  assert.equal(deriveOpenConnectionName("/tmp/data.sqlite"), "data");
  assert.equal(deriveOpenConnectionName("./relative/my.db"), "my");
  assert.equal(deriveOpenConnectionName("~/notes.duckdb"), "notes");
  assert.equal(deriveOpenConnectionName("file:///tmp/export.sqlite3"), "export");
  assert.equal(deriveOpenConnectionName(":memory:"), "In-memory database");
});

test("deriveOpenConnectionName never leaks credentials or blanks", () => {
  const named = deriveOpenConnectionName("postgres://admin:s3cret@host/db");
  assert.ok(!named.includes("s3cret"), named);
  assert.ok(!named.includes("admin"), named);
  assert.ok(deriveOpenConnectionName("   ").length > 0);
});

test("shouldUpdateStoredCredentials only updates on new secrets", () => {
  // Identical strings → reuse.
  assert.equal(
    shouldUpdateStoredCredentials(
      "postgres://u:p@host/db",
      "postgres://u:p@host/db",
    ),
    false,
  );
  // Rotated password → update before reusing the id.
  assert.equal(
    shouldUpdateStoredCredentials(
      "postgres://u:old@host/db",
      "postgres://u:new@host/db",
    ),
    true,
  );
  // Passwordless open of a saved password connection → reuse unchanged,
  // otherwise the saved password would be wiped.
  assert.equal(
    shouldUpdateStoredCredentials(
      "postgres://u:old@host/db",
      "postgres://u@host/db",
    ),
    false,
  );
  // Different target entirely → not an update (handled as a new connection).
  assert.equal(
    shouldUpdateStoredCredentials(
      "postgres://u:p@host/db1",
      "postgres://u:p@host/db2",
    ),
    false,
  );
});
