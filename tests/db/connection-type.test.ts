import test from "node:test";
import assert from "node:assert/strict";
import { detectConnectionDbType, getMongoDatabaseFromConnectionString } from "../../lib/db/connection-type";

test("detectConnectionDbType identifies dbs", () => {
  assert.equal(detectConnectionDbType("postgres://localhost/db"), "postgres");
  assert.equal(detectConnectionDbType("mysql://localhost:3306/db"), "mysql");
  assert.equal(detectConnectionDbType("redis://localhost:6379/0"), "redis");
  assert.equal(detectConnectionDbType("mongodb://localhost:27017/db"), "mongodb");
  assert.equal(detectConnectionDbType("file:/tmp/app.db"), "sqlite");
  assert.equal(detectConnectionDbType("federated://test"), "federated");
});

test("detectConnectionDbType routes planetscale by connection string scheme", () => {
  assert.equal(
    detectConnectionDbType("mysql://user:pass@aws.connect.psdb.cloud:3306/db?ssl=true", "planetscale"),
    "mysql",
  );
  assert.equal(
    detectConnectionDbType("postgresql://user:pass@aws.connect.psdb.cloud:5432/db?sslmode=require", "planetscale"),
    "postgres",
  );
});

test("getMongoDatabaseFromConnectionString extracts db", () => {
  assert.equal(getMongoDatabaseFromConnectionString("mongodb://localhost:27017/mydb"), "mydb");
  assert.equal(getMongoDatabaseFromConnectionString("not-a-url"), "admin");
});
