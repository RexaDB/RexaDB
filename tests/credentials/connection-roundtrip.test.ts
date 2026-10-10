import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import pg from "pg";

// services
import { hydrateConnection, protectConnectionPayload } from "@/lib/credentials/connection-credentials";
import { getStudioBootstrap } from "@/lib/api/actions-client";
import { getPgClientConfig } from "@/lib/db/pg-tls";

let originalWindow: PropertyDescriptor | undefined;
let originalStorage: PropertyDescriptor | undefined;
const originalFetch = globalThis.fetch;
let entries: Map<string, string>;
let failReads: boolean;
let cachedSecret: Record<string, unknown> | null;

beforeEach(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");  entries = new Map();
  failReads = false;
  cachedSecret = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === "rexadb:credential-storage-mode" ? "keychain" : null,
    setItem: () => {},
    removeItem: () => {},
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { origin: "http://localhost" },
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { reference: string; value?: string }) => {
        if (command === "connection_credential_set") { entries.set(args.reference, args.value!); return; }
        if (command === "connection_credential_delete") { entries.delete(args.reference); return; }
        if (command === "connection_credential_get") {
          if (failReads || !entries.has(args.reference)) throw new Error("Keychain entry unavailable");
          return entries.get(args.reference);
        }
        throw new Error("Unsupported command");
      },
    },
  } });
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) cachedSecret = JSON.parse(String(init.body)).secret;
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

const target = "postgresql://postgres@localhost:5432/mydb?sslmode=disable";

function driverPassword(connectionString: string) {
  return new pg.Client(getPgClientConfig(connectionString)).password;
}

describe("saved PostgreSQL credential round trip", () => {
  it("restores the tested password after save, reload, and sidecar caching", async () => {
    const draft = { connectionString: target, password: "12345" };
    const saved = await protectConnectionPayload(draft);
    expect(saved.password).toBeNull();
    expect(saved.connectionString).not.toContain("12345");
    const reloaded = await hydrateConnection(JSON.parse(JSON.stringify(saved)));
    expect(driverPassword(reloaded.connectionString!)).toBe("12345");
    expect(driverPassword(String(cachedSecret?.connectionString))).toBe("12345");
  });

  it("retains passwords supplied only in the original connection URL", async () => {
    const connectionString = "postgresql://postgres:12345@localhost:5432/mydb?sslmode=disable";
    expect(driverPassword(connectionString)).toBe("12345");
    const saved = await protectConnectionPayload({ connectionString });
    const reopened = await hydrateConnection(saved);
    expect(driverPassword(reopened.connectionString!)).toBe("12345");
  });

  it("restores separately saved plaintext passwords without requiring a keychain", async () => {
    const reopened = await hydrateConnection({ connectionString: target, password: "12345" });
    expect(driverPassword(reopened.connectionString)).toBe("12345");
  });

  it("never strips a password if the new keychain entry cannot be read back", async () => {
    failReads = true;
    await expect(protectConnectionPayload({ connectionString: target, password: "12345" })).rejects.toThrow();
    expect(entries.size).toBe(0);
  });

  it("preserves literal percent escapes in separately stored passwords", async () => {
    const saved = await protectConnectionPayload({ connectionString: target, password: "%41%40:p@ss/#?" });
    const reloaded = await hydrateConnection(saved);
    expect(driverPassword(reloaded.connectionString!)).toBe("%41%40:p@ss/#?");
  });

  it("rejects an empty stored bundle before attempting passwordless authentication", async () => {
    entries.set("empty-reference", JSON.stringify({ connectionString: target, password: null, authToken: null }));
    await expect(hydrateConnection({ connectionString: target, credentialRef: "empty-reference" })).rejects.toThrow();
  });

  it("rejects non-string stored secrets", async () => {
    entries.set("invalid-reference", JSON.stringify({ connectionString: target, password: { value: "12345" } }));
    await expect(hydrateConnection({ connectionString: target, credentialRef: "invalid-reference" })).rejects.toThrow();
  });

  it("blocks direct studio startup when saved credentials cannot be unlocked", async () => {
    failReads = true;
    globalThis.fetch = (async () => Response.json({ success: true, data: {
      connection: { id: 1, name: "Saved PostgreSQL", connectionString: target, credentialRef: "missing-reference" },
      tabs: [], settings: null, schemas: [], tables: [],
    } })) as unknown as typeof fetch;
    const result = await getStudioBootstrap(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain("credentials");
  });
});
