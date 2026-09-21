import test from "node:test";
import assert from "node:assert/strict";

// Exercises the localStorage fallback in lib/dictionary/client.ts by stubbing
// the browser globals bun doesn't provide. A single sequential test — bun
// runs top-level tests in a file concurrently, so separate tests would race
// on the shared globals.
test("dictionary client (localStorage fallback)", async () => {
  const store = new Map<string, string>();
  const prevWindow = (globalThis as any).window;
  const prevStorage = (globalThis as any).localStorage;
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  try {
    const client = await import("../../lib/dictionary/client");
    const EMPTY_SCOPE = { tables: {}, columns: {}, decorators: {}, updatedAt: {} };

    // 1. Round-trip descriptions and decorators.
    assert.deepEqual(await client.getDictionaryScope(42), EMPTY_SCOPE);

    await client.setTableDescription(42, "public", "users", "App users");
    await client.setColumnDescription(42, "public", "users", "role", "Access role");
    await client.setColumnDecorator(42, "public", "users", "role", {
      kind: "enum-map",
      mapping: { admin: "Admin" },
    });

    const scope = await client.getDictionaryScope(42);
    assert.equal(scope.tables["public.users"], "App users");
    assert.equal(scope.columns["public.users.role"], "Access role");
    assert.deepEqual(scope.decorators["public.users.role"], {
      kind: "enum-map",
      mapping: { admin: "Admin" },
    });

    // Clearing writes delete the entries.
    await client.setTableDescription(42, "public", "users", "   ");
    assert.equal((await client.getDictionaryScope(42)).tables["public.users"], undefined);
    await client.setColumnDecorator(42, "public", "users", "role", null);
    assert.equal(
      (await client.getDictionaryScope(42)).decorators["public.users.role"],
      undefined,
    );

    // Scopes are isolated per connection.
    assert.deepEqual(await client.getDictionaryScope(43), EMPTY_SCOPE);

    await client.deleteDictionaryScope(42);
    assert.deepEqual(await client.getDictionaryScope(42), EMPTY_SCOPE);

    // 2. Writes without a connection id are rejected loudly.
    await assert.rejects(
      () => client.setTableDescription(0, "public", "t", "x"),
      /No connection/,
    );
    await assert.rejects(
      () => client.setColumnDecorator(0, "public", "t", "c", { kind: "mask" }),
      /No connection/,
    );
    // Reads with a bad id stay empty instead of throwing.
    assert.deepEqual(await client.getDictionaryScope(0), EMPTY_SCOPE);

    // 3. Invalid decorators are rejected before any write.
    await assert.rejects(
      () => client.setColumnDecorator(42, "public", "t", "c", { kind: "bogus" } as never),
      /Invalid decorator/,
    );
    assert.deepEqual(await client.getDictionaryScope(42), EMPTY_SCOPE);
  } finally {
    if (prevWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = prevWindow;
    if (prevStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = prevStorage;
  }
});
