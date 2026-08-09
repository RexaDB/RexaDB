import test from "node:test";
import assert from "node:assert/strict";
import {
  getMgmtAccounts,
  getFirstMgmtToken,
  getMgmtToken,
  addMgmtAccount,
  removeMgmtAccount,
  clearMgmtTokens,
  saveMgmtToken,
  clearMgmtToken,
  type SupabaseMgmtAccount,
} from "../../../lib/supabase-mgmt/token-store";

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  return { storage, store };
}

const b64url = (s: string) =>
  Buffer.from(s, "utf8").toString("base64url");

function jwtWith(payload: Record<string, unknown>): string {
  return `header.${b64url(JSON.stringify(payload))}.sig`;
}

test("token store: empty when nothing stored", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  assert.deepEqual(getMgmtAccounts(), []);
  assert.equal(getFirstMgmtToken(), null);
  assert.equal(getMgmtToken(), null);
});

test("token store: add + read + sort by createdAt asc", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  clearMgmtTokens();
  const first = addMgmtAccount("token-A");
  const second = addMgmtAccount("token-B");
  const accounts = getMgmtAccounts();
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].id, first.id);
  assert.equal(accounts[1].id, second.id);
  assert.equal(getFirstMgmtToken(), "token-A");
  assert.equal(getMgmtToken(), "token-A");
});

test("token store: addMgmtAccount dedupes the same token", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  clearMgmtTokens();
  const first = addMgmtAccount("token-same");
  const second = addMgmtAccount("token-same");
  assert.equal(first.id, second.id);
  assert.equal(getMgmtAccounts().length, 1);
});

test("token store: decodes email and name from JWT payload", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  clearMgmtTokens();
  const account = addMgmtAccount(
    jwtWith({ email: "dev@example.com", name: "Dev User" }),
  );
  assert.equal(account.email, "dev@example.com");
  assert.equal(account.name, "Dev User");
  const read = getMgmtAccounts()[0];
  assert.equal(read.email, "dev@example.com");
  assert.equal(read.name, "Dev User");
});

test("token store: removeMgmtAccount by id", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  clearMgmtTokens();
  const a = addMgmtAccount("token-a");
  addMgmtAccount("token-b");
  removeMgmtAccount(a.id);
  const accounts = getMgmtAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].token, "token-b");
  assert.equal(getFirstMgmtToken(), "token-b");
});

test("token store: clearMgmtTokens empties the list", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  addMgmtAccount("token-a");
  clearMgmtTokens();
  assert.deepEqual(getMgmtAccounts(), []);
  assert.equal(getFirstMgmtToken(), null);
});

test("token store: corrupt storage never throws", () => {
  const { storage } = makeStorage({ "rexadb-supabase-mgmt-accounts": "{oops" });
  (globalThis as any).window = { localStorage: storage };
  assert.deepEqual(getMgmtAccounts(), []);
  assert.equal(getFirstMgmtToken(), null);
});

test("token store: legacy single-token key migrates and is removed", () => {
  const legacyToken = jwtWith({ email: "legacy@example.com" });
  const { storage, store } = makeStorage({
    "rexadb-supabase-mgmt-token": legacyToken,
  });
  (globalThis as any).window = { localStorage: storage };
  const accounts = getMgmtAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].token, legacyToken);
  assert.equal(accounts[0].email, "legacy@example.com");
  assert.equal(store.has("rexadb-supabase-mgmt-token"), false);
  assert.equal(getFirstMgmtToken(), legacyToken);
});

test("token store: legacy migration does not run when accounts exist", () => {
  const legacyToken = "legacy-token";
  const existing: SupabaseMgmtAccount[] = [
    {
      id: "existing-id",
      token: "fresh-token",
      createdAt: 1,
    },
  ];
  const { storage, store } = makeStorage({
    "rexadb-supabase-mgmt-token": legacyToken,
    "rexadb-supabase-mgmt-accounts": JSON.stringify(existing),
  });
  (globalThis as any).window = { localStorage: storage };
  const accounts = getMgmtAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].token, "fresh-token");
  assert.equal(store.get("rexadb-supabase-mgmt-token"), legacyToken);
});

test("token store: saveMgmtToken/clearMgmtToken aliases work", () => {
  const { storage } = makeStorage();
  (globalThis as any).window = { localStorage: storage };
  clearMgmtToken();
  saveMgmtToken("alias-token");
  assert.equal(getMgmtToken(), "alias-token");
  clearMgmtToken();
  assert.equal(getMgmtToken(), null);
});
