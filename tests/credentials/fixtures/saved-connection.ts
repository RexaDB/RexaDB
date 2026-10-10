import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";

// services
import { cacheConnectionCredential } from "@/lib/credentials/connection-credential-cache";
import { hydrateConnection, protectConnectionPayload } from "@/lib/credentials/connection-credentials";
import { getPgClientConfig } from "@/lib/db/pg-tls";

// types
import type { CredentialPayload } from "@/lib/credentials/connection-credentials";

assert.ok(process.env.REXADB_USER_DATA_DIR?.includes("rexadb-credential-test-"));
const { addConnection, getConnection } = await import("@/lib/db/actions-core");
const { client, db } = await import("@/lib/db/index");
const { ensureCoreTables } = await import("@/lib/db/ensure-core-tables");

const entries = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => "keychain" } });
Object.defineProperty(globalThis, "window", { value: { __TAURI_INTERNALS__: {
  invoke: async (command: string, args: { reference: string; value?: string }) => {
    if (command === "connection_credential_set") { entries.set(args.reference, args.value!); return; }
    if (command === "connection_credential_get") return entries.get(args.reference);
    if (command === "connection_credential_delete") { entries.delete(args.reference); return; }
    throw new Error("Unsupported command");
  },
} } });
globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
  const { reference, secret } = JSON.parse(String(init?.body));
  cacheConnectionCredential(reference, secret);
  return Response.json({ success: true });
}) as unknown as typeof fetch;

if (process.argv.some((arg) => arg.startsWith("legacy"))) {
  await db.run(sql.raw("CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT NOT NULL, connection_string TEXT NOT NULL, created_at INTEGER NOT NULL)"));
}

if (process.argv.includes("legacy-concurrent")) {
  await Promise.all(Array.from({ length: 5 }, () => ensureCoreTables()));
}

const target = "postgresql://postgres@localhost:5432/mydb?sslmode=disable";
const protectedPayload = await protectConnectionPayload<CredentialPayload>({ connectionString: target, password: "12345" });
const saved = await addConnection("Credential regression", protectedPayload.connectionString!, "postgresql", {
  password: protectedPayload.password,
  credentialRef: protectedPayload.credentialRef!,
  credentialStorageMode: protectedPayload.credentialStorageMode,
});
assert.equal(saved.success, true);
assert.ok(saved.id);
const row = await client.connections.findFirst({ where: { id: saved.id } });
assert.ok(row);
assert.equal(row.password, null);
assert.ok(!row.connectionString.includes("12345"));
await hydrateConnection(row);
const reopened = await getConnection(saved.id);
assert.ok(reopened);
assert.equal(new pg.Client(getPgClientConfig(reopened.connectionString)).password, "12345");
const storedAfterUnlock = await client.connections.findFirst({ where: { id: saved.id } });
assert.equal(storedAfterUnlock?.password, null);
assert.ok(!storedAfterUnlock?.connectionString.includes("12345"));
console.log("Saved connection credentials survive SQLite reload and sidecar resolution.");
