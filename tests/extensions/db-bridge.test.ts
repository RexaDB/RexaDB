import test from "node:test";
import assert from "node:assert/strict";
import {
  isWriteQuery,
  onExtensionBridgeChange,
  registerExtensionDbBridge,
  unregisterExtensionDbBridge,
  type ExtensionDbBridge,
} from "../../lib/extensions/db-bridge";

test("isWriteQuery allows plain selects", () => {
  assert.equal(isWriteQuery("SELECT * FROM users"), false);
  assert.equal(isWriteQuery("  -- a comment\nselect 1"), false);
  assert.equal(isWriteQuery("WITH x AS (SELECT 1) SELECT * FROM x"), false);
});

test("isWriteQuery blocks writes and multi-statements", () => {
  for (const sql of [
    "INSERT INTO users VALUES (1)",
    "update users set name = 'x'",
    "DELETE FROM users",
    "DROP TABLE users",
    "CREATE TABLE t (id int)",
    "ALTER TABLE t ADD COLUMN x int",
    "SELECT 1; DROP TABLE users",
  ]) {
    assert.equal(isWriteQuery(sql), true, sql);
  }
});

test("bridge listeners fire on register/unregister and stop after unsubscribe", () => {
  const seen: boolean[] = [];
  const off = onExtensionBridgeChange((b) => void seen.push(b !== null));
  const bridge = {} as ExtensionDbBridge;
  registerExtensionDbBridge(bridge);
  unregisterExtensionDbBridge(bridge);
  // Unregistering a different bridge object must not emit.
  registerExtensionDbBridge(bridge);
  unregisterExtensionDbBridge({} as ExtensionDbBridge);
  off();
  unregisterExtensionDbBridge(bridge);
  assert.deepEqual(seen, [true, false, true]);
});
