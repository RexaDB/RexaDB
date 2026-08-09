import test from "node:test";
import assert from "node:assert/strict";
import { loadDetectModule } from "./load-detect.mjs";

test("routes libsql urls through the sqlite engine", async () => {
  const { getSqlEngineKind } = await loadDetectModule();
  assert.equal(getSqlEngineKind("libsql://example-org.aws-us-east-1.turso.io"), "sqlite");
});

test("detects file-backed sqlite connections", async () => {
  const { getSqlEngineKind } = await loadDetectModule();
  assert.equal(getSqlEngineKind("/tmp/app.sqlite"), "sqlite");
});

test("detects mysql and postgres separately", async () => {
  const { getSqlEngineKind } = await loadDetectModule();
  assert.equal(getSqlEngineKind("mysql://root:root@127.0.0.1:3306/app"), "mysql");
  assert.equal(getSqlEngineKind("postgresql://user:pass@127.0.0.1:5432/app"), "postgres");
});
