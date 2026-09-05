import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSyncInvokeRequest,
  classifySyncAuthFailure,
  collectCandidateKeys,
  compareTemplateVersion,
  isSyncBlockingError,
  pickServiceRoleKey,
  pickServiceRoleKeys,
  summarizeSyncResult,
  syncAuthFailureMessage,
} from "../../../lib/supabase-paykit/sync";

test("pickServiceRoleKey handles all api-keys shapes", () => {
  const arr = [
    { name: "anon", api_key: "anon-key" },
    { name: "service_role", api_key: "service-key" },
  ];
  assert.equal(pickServiceRoleKey(arr), "service-key");
  assert.equal(pickServiceRoleKey({ api_keys: arr }), "service-key");
  assert.equal(pickServiceRoleKey({ apiKeys: arr }), "service-key");
  assert.equal(pickServiceRoleKey({ data: arr }), "service-key");
  // camelCase key field
  assert.equal(
    pickServiceRoleKey([{ name: "service_role", apiKey: "k2" }]),
    "k2",
  );
});

test("pickServiceRoleKey returns null when unusable", () => {
  assert.equal(pickServiceRoleKey(null), null);
  assert.equal(pickServiceRoleKey({}), null);
  assert.equal(pickServiceRoleKey([]), null);
  assert.equal(
    pickServiceRoleKey([{ name: "anon", api_key: "anon-key" }]),
    null,
  );
  assert.equal(
    pickServiceRoleKey([{ name: "service_role", api_key: "" }]),
    null,
  );
});

test("pickServiceRoleKeys returns every candidate, deduped", () => {
  const payload = [
    { name: "anon", api_key: "anon-key-which-is-long-enough" },
    { name: "service_role", api_key: "legacy-key-which-is-long-enough" },
    { name: "service_role", api_key: "sb-secret-key-which-is-long" },
    { name: "service_role", api_key: "legacy-key-which-is-long-enough" },
  ];
  assert.deepEqual(pickServiceRoleKeys(payload), ["legacy-key-which-is-long-enough", "sb-secret-key-which-is-long"]);
  assert.deepEqual(pickServiceRoleKeys({ api_keys: payload }), ["legacy-key-which-is-long-enough", "sb-secret-key-which-is-long"]);
  assert.deepEqual(pickServiceRoleKeys(null), []);
  assert.deepEqual(pickServiceRoleKeys([]), []);
  assert.deepEqual(pickServiceRoleKeys([{ name: "anon", api_key: "x" }]), []);
});

test("collectCandidateKeys puts service_role first, then other key-like values", () => {
  const legacy = "legacy-key-which-is-long-enough";
  const secret = "sb-secret-key-which-is-long00";
  const anon = "anon-key-which-is-long-enough";
  const payload = [
    { name: "anon", api_key: anon },
    { name: "service_role", api_key: legacy },
    { name: "secret", secret: secret },
    { name: "junk", id: "short" },
  ];
  assert.deepEqual(collectCandidateKeys(payload), [legacy, anon, secret]);
  // Short non-key values never qualify.
  assert.deepEqual(collectCandidateKeys([{ name: "x", id: "abc" }]), []);
  assert.deepEqual(collectCandidateKeys(null), []);
  // Cap respected.
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `k${i}`, api_key: `0123456789abcdef-${i}-pad-pad` }));
  assert.equal(collectCandidateKeys(many).length, 8);
});

test("buildSyncInvokeRequest targets the edge function with admin headers", () => {
  const req = buildSyncInvokeRequest("abcdefghijklmnopqrst", "service-key");
  assert.equal(
    req.url,
    "https://abcdefghijklmnopqrst.supabase.co/functions/v1/paykit-api?action=sync-products",
  );
  assert.equal(req.headers.apikey, "service-key");
  assert.equal(req.headers.Authorization, "Bearer service-key");
  assert.equal(req.headers["x-rexadb-mgmt"], undefined);
  assert.throws(() => buildSyncInvokeRequest("ref", ""), /service key/);
  assert.throws(() => buildSyncInvokeRequest("ref", "   "), /service key/);
});

test("buildSyncInvokeRequest carries the mgmt owner-proof and tolerates empty keys", () => {
  const req = buildSyncInvokeRequest("abcdefghijklmnopqrst", "", "mgmt-token");
  assert.equal(req.headers.apikey, undefined);
  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.headers["x-rexadb-mgmt"], "mgmt-token");
  const both = buildSyncInvokeRequest("abcdefghijklmnopqrst", "service-key", "mgmt-token");
  assert.equal(both.headers.apikey, "service-key");
  assert.equal(both.headers["x-rexadb-mgmt"], "mgmt-token");
});

test("summarizeSyncResult counts products and priced ones", () => {
  // Real edge-function shape is camelCase; snake_case tolerated.
  assert.deepEqual(
    summarizeSyncResult({ products: [{ stripePriceId: "p1" }, {}] }),
    { products: 2, withPrices: 1, features: 0 },
  );
  assert.deepEqual(
    summarizeSyncResult({ products: [{ stripe_price_id: "p1" }, {}] }),
    { products: 2, withPrices: 1, features: 0 },
  );
  assert.deepEqual(summarizeSyncResult({}), { products: 0, withPrices: 0, features: 0 });
  assert.deepEqual(summarizeSyncResult(null), { products: 0, withPrices: 0, features: 0 });
});

test("summarizeSyncResult totals attached marketing features", () => {
  assert.deepEqual(
    summarizeSyncResult({
      products: [
        { stripePriceId: "p1", featuresAttached: ["ent_1", "ent_2"] },
        { stripePriceId: null, featuresAttached: [] },
        {},
      ],
    }),
    { products: 3, withPrices: 1, features: 2 },
  );
});

test("classifySyncAuthFailure triages 401 bodies", () => {
  // Legacy bundle: plain Unauthorized, no code.
  assert.equal(classifySyncAuthFailure({ error: "Unauthorized." }), "stale");
  // Current bundle: distinct codes, never the key itself.
  assert.equal(
    classifySyncAuthFailure({ error: "Unauthorized.", code: "admin-key-mismatch" }),
    "env-mismatch",
  );
  assert.equal(
    classifySyncAuthFailure({ error: "Unauthorized.", code: "no-service-key-env" }),
    "no-service-key-env",
  );
  // Anything else never reached function code.
  assert.equal(classifySyncAuthFailure({ message: "Invalid JWT" }), "gateway");
  assert.equal(classifySyncAuthFailure({ error: "x", message: "y" }), "gateway");
  assert.equal(classifySyncAuthFailure(null), "gateway");
  assert.equal(classifySyncAuthFailure("Unauthorized."), "gateway");
  assert.equal(classifySyncAuthFailure({}), "gateway");
});

test("syncAuthFailureMessage covers every kind", () => {
  for (const kind of ["stale", "gateway", "env-mismatch", "no-service-key-env"] as const) {
    const msg = syncAuthFailureMessage(kind);
    assert.ok(typeof msg === "string" && msg.length > 20, kind);
    assert.ok(isSyncBlockingError(msg), `${kind} must block completion`);
  }
  assert.equal(isSyncBlockingError("Sync failed (500): boom"), false);
  assert.equal(isSyncBlockingError(null), false);
  assert.equal(isSyncBlockingError(""), false);
  // Server appends key-length diagnostics to the mismatch message — still blocking.
  assert.equal(
    isSyncBlockingError(`${syncAuthFailureMessage("env-mismatch")} (sent 40 chars, function holds 219 chars)`),
    true,
  );
});

test("compareTemplateVersion distinguishes current, stale and unknown", () => {
  assert.equal(compareTemplateVersion("3", "3"), "current");
  assert.equal(compareTemplateVersion(" 3 ", "3"), "current");
  assert.equal(compareTemplateVersion("2", "3"), "stale");
  assert.equal(compareTemplateVersion("9", "3"), "stale");
  // Unreadable is unknown — never blocks completion on unknowns.
  assert.equal(compareTemplateVersion(null, "3"), "unknown");
  assert.equal(compareTemplateVersion(undefined, "3"), "unknown");
  assert.equal(compareTemplateVersion("", "3"), "unknown");
  assert.equal(compareTemplateVersion("   ", "3"), "unknown");
  assert.equal(compareTemplateVersion("3", ""), "unknown");
});
