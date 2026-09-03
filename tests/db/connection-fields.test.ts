import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectionStringFromFields,
  parseFieldsFromConnectionString,
  emptyFieldValues,
  isFieldBasedProvider,
  sslModeOptionsForProvider,
} from "../../lib/db/connection-fields";

test("builds postgres family connection strings", () => {
  const ds = buildConnectionStringFromFields("supabase", {
    host: "db.example.supabase.co",
    port: "5432",
    database: "postgres",
    username: "postgres",
    password: "p@ss",
    sslMode: "require",
  });
  assert.equal(
    ds,
    "postgresql://postgres:p%40ss@db.example.supabase.co:5432/postgres?sslmode=require",
  );
});

test("builds mysql connection strings", () => {
  const ds = buildConnectionStringFromFields("mysql", {
    host: "db.local",
    port: "3306",
    database: "app",
    username: "root",
    password: "pw",
    sslMode: "require",
  });
  assert.equal(ds, "mysql://root:pw@db.local:3306/app?sslmode=require");
});

test("builds mssql connection strings with ssl params", () => {
  const ds = buildConnectionStringFromFields("mssql", {
    host: "sql.local",
    port: "1433",
    database: "master",
    username: "sa",
    sslMode: "require",
  });
  assert.ok(ds.startsWith("mssql://sa@sql.local:1433/master?"));
  assert.ok(ds.includes("encrypt=true"));
});

test("builds clickhouse http/https", () => {
  const http = buildConnectionStringFromFields("clickhouse", {
    host: "ch.local",
    database: "default",
    username: "default",
    sslMode: "disable",
  });
  assert.equal(http, "clickhouse://default@ch.local:8123/default");

  const https = buildConnectionStringFromFields("clickhouse", {
    host: "ch.local",
    database: "default",
    username: "default",
    sslMode: "require",
  });
  assert.equal(https, "clickhouses://default@ch.local:8123/default");
});

test("builds mongodb with srv for Atlas hosts", () => {
  const srv = buildConnectionStringFromFields("mongodb", {
    host: "cluster0.example.mongodb.net",
    database: "app",
    username: "user",
    password: "pw",
    sslMode: "require",
  });
  assert.equal(srv, "mongodb+srv://user:pw@cluster0.example.mongodb.net/app");

  const plain = buildConnectionStringFromFields("mongodb", {
    host: "mongo.local",
    database: "app",
    username: "user",
    sslMode: "disable",
  });
  assert.equal(plain, "mongodb://user@mongo.local:27017/app");
});

test("builds redis with db index over tls scheme", () => {
  const ds = buildConnectionStringFromFields("redis", {
    host: "cache.local",
    port: "6379",
    database: "3",
    username: "",
    sslMode: "require",
  });
  assert.equal(ds, "rediss://cache.local:6379/3");
});

test("parse round-trips postgres fields", () => {
  const parsed = parseFieldsFromConnectionString(
    "neon",
    "postgresql://user:pw@ep-1.aws.neon.tech:5432/db?sslmode=require",
  );
  assert.equal(parsed.host, "ep-1.aws.neon.tech");
  assert.equal(parsed.port, "5432");
  assert.equal(parsed.database, "db");
  assert.equal(parsed.username, "user");
  assert.equal(parsed.password, "pw");
  assert.equal(parsed.sslMode, "require");
});

test("parse round-trips mssql/clickhouse/redis", () => {
  const mssql = parseFieldsFromConnectionString(
    "mssql",
    "mssql://sa:pw@sql.local:1433/master?encrypt=true",
  );
  assert.equal(mssql.sslMode, "require");

  const ch = parseFieldsFromConnectionString(
    "clickhouse",
    "clickhouses://default@ch.local:8123/default",
  );
  assert.equal(ch.sslMode, "require");

  const redis = parseFieldsFromConnectionString(
    "redis",
    "rediss://cache.local:6379/2",
  );
  assert.equal(redis.sslMode, "require");
  assert.equal(redis.database, "2");
});

test("planetscale builds mysql vs postgres protocol urls", () => {
  const mysql = buildConnectionStringFromFields("planetscale", {
    host: "aws.connect.psdb.cloud",
    port: "3306",
    database: "mydb",
    username: "root",
    sslMode: "require",
    protocol: "mysql",
  });
  assert.equal(mysql, "mysql://root@aws.connect.psdb.cloud:3306/mydb?sslmode=require");

  const postgres = buildConnectionStringFromFields("planetscale", {
    host: "aws.connect.psdb.cloud",
    database: "mydb",
    username: "root",
    sslMode: "require",
    protocol: "postgresql",
  });
  assert.equal(
    postgres,
    "postgresql://root@aws.connect.psdb.cloud:5432/mydb?sslmode=require",
  );
});

test("planetscale parse detects protocol from scheme", () => {
  const mysql = parseFieldsFromConnectionString(
    "planetscale",
    "mysql://root@aws.connect.psdb.cloud/mydb?sslmode=require",
  );
  assert.equal(mysql.protocol, "mysql");
  assert.equal(mysql.port, "3306");
  assert.equal(mysql.sslMode, "require");

  const postgres = parseFieldsFromConnectionString(
    "planetscale",
    "postgresql://root@aws.connect.psdb.cloud:5432/mydb?sslmode=require",
  );
  assert.equal(postgres.protocol, "postgresql");
  assert.equal(postgres.port, "5432");
  assert.equal(postgres.host, "aws.connect.psdb.cloud");
});

test("build then parse is stable per provider", () => {
  for (const provider of [
    "mysql",
    "mariadb",
    "mssql",
    "clickhouse",
    "mongodb",
    "supabase",
    "planetscale",
  ] as const) {
    const built = buildConnectionStringFromFields(provider, {
      host: "h.example.test",
      port: "1234",
      database: "app",
      username: "u",
      password: "secret",
      sslMode: "require",
    });
    const reparsed = parseFieldsFromConnectionString(provider, built);
    assert.equal(reparsed.host, "h.example.test", provider);
    assert.equal(reparsed.database, "app", provider);
    assert.equal(reparsed.username, "u", provider);
    assert.equal(reparsed.password, "secret", provider);
    assert.equal(reparsed.sslMode, "require", provider);
  }
});

test("empty defaults are reasonable", () => {
  const defaults = emptyFieldValues("mysql");
  assert.equal(defaults.host, "localhost");
  assert.equal(defaults.port, "3306");
  assert.equal(defaults.username, "root");
});

test("field-based provider helpers", () => {
  assert.equal(isFieldBasedProvider("mysql"), true);
  assert.equal(isFieldBasedProvider("mssql"), true);
  assert.equal(isFieldBasedProvider("supabase"), true);
  assert.equal(isFieldBasedProvider("federated"), false);
  assert.equal(isFieldBasedProvider("postgresql"), false);
  assert.ok(sslModeOptionsForProvider("supabase").length >= 3);
});