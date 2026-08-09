import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRedisConnectionString,
  getRedisDbIndex,
  getRedisDbLabel,
  updateRedisConnectionStringDatabase,
  buildRedisDatabaseList,
  getRedisKeyCommand,
} from "../../../lib/db/redis-utils";

test("redis utils normalize and parse db index", () => {
  assert.equal(normalizeRedisConnectionString("localhost:6379/2"), "redis://localhost:6379/2");
  assert.equal(getRedisDbIndex("redis://localhost:6379/5"), 5);
  assert.equal(getRedisDbIndex("redis://localhost:6379/not-a-number"), 0);
  assert.equal(getRedisDbLabel("redis://localhost:6379/3"), "db3");
});

test("redis utils update database in connection string", () => {
  const updated = updateRedisConnectionStringDatabase("redis://localhost:6379/0", "db9");
  assert.equal(updated, "redis://localhost:6379/9");

  const updatedNoScheme = updateRedisConnectionStringDatabase("localhost:6379", "7");
  assert.equal(updatedNoScheme, "redis://localhost:6379/7");
});

test("redis utils build database list", () => {
  assert.deepEqual(buildRedisDatabaseList(3), ["db0", "db1", "db2"]);
  assert.equal(buildRedisDatabaseList(0).length, 16);
});

test("redis utils key commands", () => {
  assert.equal(getRedisKeyCommand("foo", "string"), "GET foo");
  assert.equal(getRedisKeyCommand("my key", "hash"), "HGETALL \"my key\"");
  assert.equal(getRedisKeyCommand("foo", "unknown"), "TYPE foo");
});
