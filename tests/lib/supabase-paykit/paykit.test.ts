import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualInstructions,
  buildProductsTs,
  hashPaykitDrafts,
} from "../../../lib/supabase-paykit/codegen";
import {
  PAYKIT_SCHEMA,
  PAYKIT_SCHEMA_SETUP_COUNT,
  PAYKIT_SCHEMA_STATEMENTS,
  PAYKIT_TABLE_NAMES,
  PAYKIT_GRANT_STATEMENTS,
  PAYKIT_REQUIRED_PRIVILEGES,
  buildPaykitGrantsStatusQuery,
  buildPaykitRlsStatements,
  buildPaykitRlsStatusQuery,
  buildPaykitTablesPresenceQuery,
  getPaykitSchemaStatements,
  mergeExposedSchemas,
  paykitRlsStatement,
  paykitTable,
} from "../../../lib/supabase-paykit/paykit-sql";
import {
  PAYKIT_TEMPLATE_VERSION,
  buildApiSource,
  buildWebhookSource,
} from "../../../lib/supabase-paykit/function-templates";
import { createEmptyDraftState } from "../../../lib/supabase-paykit/types";

test("products.ts mirrors paykit.sh shape", () => {
  const drafts = createEmptyDraftState();
  drafts.features = [{ id: "messages", type: "metered" }];
  drafts.plans = [
    {
      id: "free",
      name: "Free",
      group: "base",
      default: true,
      includes: [{ featureId: "messages", limit: 100, reset: "month" }],
    },
    {
      id: "pro",
      name: "Pro",
      group: "base",
      priceAmount: 29,
      priceInterval: "month",
      includes: [{ featureId: "messages", limit: 5000, reset: "month" }],
    },
  ];
  const ts = buildProductsTs(drafts);
  assert.ok(ts.includes('import { feature, plan } from "paykitjs"'));
  assert.ok(ts.includes('feature({ id: "messages", type: "metered" })'));
  assert.ok(ts.includes('id: "pro"'));
  assert.ok(ts.includes("price: { amount: 29"));
  assert.ok(ts.includes("messages({ limit: 5000, reset: \"month\" })"));
});

test("draft hash is stable and changes with edits", () => {
  const a = createEmptyDraftState();
  const b = createEmptyDraftState();
  assert.equal(hashPaykitDrafts(a), hashPaykitDrafts(b));
  b.plans.push({ id: "pro", name: "Pro", group: "base", includes: [] });
  assert.notEqual(hashPaykitDrafts(a), hashPaykitDrafts(b));
});

test("manual instructions cover no-verify-jwt + webhook URL", () => {
  const md = buildManualInstructions("abcdefghijklmnopqrst");
  assert.ok(md.includes("--no-verify-jwt"));
  assert.ok(
    md.includes(
      "https://abcdefghijklmnopqrst.supabase.co/functions/v1/paykit-webhook",
    ),
  );
  assert.ok(md.includes("supabase secrets set"));
  assert.ok(md.includes("verify_jwt = false"));
  assert.ok(md.includes("Exposed schemas"));
  assert.ok(md.includes("paykitjs push"));
});

test("gateway verification stays off on both functions (auth is in-function)", () => {
  const md = buildManualInstructions("abcdefghijklmnopqrst");
  // Both deploy commands skip gateway JWT verification...
  const noVerifyCount = md.split("--no-verify-jwt").length - 1;
  assert.ok(noVerifyCount >= 2, `expected --no-verify-jwt twice, found ${noVerifyCount}`);
  // ...and both config.toml blocks set it false (never true).
  assert.ok(!md.includes("verify_jwt = true"), "no gateway verification anywhere");
});

test("vendored schema lives in paykit schema with short names", () => {
  assert.equal(PAYKIT_SCHEMA, "paykit");
  assert.equal(PAYKIT_TABLE_NAMES.length, 10);
  assert.equal(paykitTable("customer"), "paykit.customer");
  const joined = PAYKIT_SCHEMA_STATEMENTS.join("\n");
  assert.ok(joined.includes('CREATE SCHEMA IF NOT EXISTS "paykit"'));
  assert.ok(joined.includes("TO service_role"));
  assert.ok(!joined.includes(" TO anon"), "no anon grants");
  assert.ok(!joined.includes(" TO authenticated"), "no authenticated grants");
  assert.ok(!joined.includes("CREATE POLICY"), "no policies — deny by default");
  for (const t of PAYKIT_TABLE_NAMES) {
    assert.ok(joined.includes(`"paykit"."${t}"`), `missing paykit.${t}`);
  }
  assert.ok(!joined.includes('"public"."paykit_'), "no public tables");
  assert.ok(joined.includes("IF NOT EXISTS"));
  const presence = buildPaykitTablesPresenceQuery();
  assert.ok(presence.includes("schemaname = 'paykit'"));
  for (const t of PAYKIT_TABLE_NAMES) {
    assert.ok(presence.includes(t));
  }
});

test("schema phase split is exact and truthful", () => {
  const schema = getPaykitSchemaStatements("schema");
  const tables = getPaykitSchemaStatements("tables");
  const all = getPaykitSchemaStatements("all");
  assert.equal(schema.length, PAYKIT_SCHEMA_SETUP_COUNT);
  assert.equal(schema.length + tables.length, all.length);
  assert.ok(schema[0].includes("CREATE SCHEMA"));
  assert.ok(!schema.join("\n").includes("CREATE TABLE"), "schema phase creates no tables");
  assert.ok(tables[0].includes("CREATE TABLE"), "tables phase starts with table DDL");
});

test("every paykit table gets deny-by-default RLS", () => {
  const tables = getPaykitSchemaStatements("tables");
  for (const t of PAYKIT_TABLE_NAMES) {
    const stmt = tables.find((s) => s.includes(`"${t}" ENABLE ROW LEVEL SECURITY`));
    assert.ok(stmt, `missing ENABLE RLS for paykit.${t}`);
  }
  const rlsCount = tables.filter((s) => s.includes("ENABLE ROW LEVEL SECURITY")).length;
  assert.equal(rlsCount, PAYKIT_TABLE_NAMES.length);
  // RLS must not leak into the schema phase (phase split stays truthful).
  const schema = getPaykitSchemaStatements("schema");
  assert.ok(!schema.join("\n").includes("ROW LEVEL SECURITY"));
});

test("rls status query reads pg_class.relrowsecurity per table", () => {
  const q = buildPaykitRlsStatusQuery();
  assert.ok(q.includes("relrowsecurity"), "reads relrowsecurity");
  assert.ok(q.includes("schemaname") || q.includes("nspname"), "scoped to paykit schema");
  assert.ok(q.includes("'paykit'"));
  for (const t of PAYKIT_TABLE_NAMES) {
    assert.ok(q.includes(`'${t}'`), `rls query missing ${t}`);
  }
});

test("repair builders target only known tables", () => {
  const subset = buildPaykitRlsStatements(["customer", "invoice"]);
  assert.equal(subset.length, 2);
  assert.ok(subset[0].includes('"customer" ENABLE ROW LEVEL SECURITY'));
  // Unknown names are dropped — status-derived gaps can't inject SQL.
  assert.deepEqual(
    buildPaykitRlsStatements(["customer", "pg_authid", "customer'; DROP TABLE x;--", "customer"]),
    buildPaykitRlsStatements(["customer"]),
  );
  assert.throws(() => paykitRlsStatement("pg_authid"), /Unknown paykit table/);
  assert.equal(buildPaykitRlsStatements().length, PAYKIT_TABLE_NAMES.length);
});

test("grant repair list matches the setup grants exactly", () => {
  const joined = PAYKIT_SCHEMA_STATEMENTS.join("\n");
  assert.ok(PAYKIT_GRANT_STATEMENTS.length > 0);
  for (const s of PAYKIT_GRANT_STATEMENTS) {
    assert.ok(joined.includes(s), `setup must contain grant: ${s.slice(0, 40)}`);
  }
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.ok((PAYKIT_REQUIRED_PRIVILEGES as readonly string[]).includes(p));
  }
});

test("grants status query scopes to service_role on paykit tables", () => {
  const q = buildPaykitGrantsStatusQuery();
  assert.ok(q.includes("role_table_grants"));
  assert.ok(q.includes("service_role"));
  assert.ok(q.includes("'paykit'"));
  for (const t of PAYKIT_TABLE_NAMES) {
    assert.ok(q.includes(`'${t}'`), `grants query missing ${t}`);
  }
});

test("mergeExposedSchemas appends paykit idempotently", () => {
  assert.equal(mergeExposedSchemas(null), "paykit");
  assert.equal(mergeExposedSchemas(""), "paykit");
  assert.equal(
    mergeExposedSchemas("public,graphql_public"),
    "public,graphql_public,paykit",
  );
  assert.equal(mergeExposedSchemas("public,paykit"), null);
  assert.equal(mergeExposedSchemas("public, paykit "), null);
});

test("edge function sources are single-file deployable", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [{ id: "messages", type: "metered" }],
    plans: [],
  };
  const webhook = buildWebhookSource(data);
  const api = buildApiSource(data);
  assert.equal(webhook.slug, "paykit-webhook");
  assert.equal(api.slug, "paykit-api");
  for (const built of [webhook, api]) {
    assert.ok(built.source.includes("Deno.serve"));
    assert.ok(built.source.includes("abc123"));
    assert.ok(!built.source.includes("`"), "no backticks allowed in template");
    assert.ok(!built.source.includes("${"), "no ${} allowed in template");
    assert.ok(built.source.includes("Accept-Profile"), "profile headers");
    assert.ok(built.source.includes("Content-Profile"), "profile headers");
    assert.ok(!built.source.includes("'paykit_"), "no legacy table names");
  }
  assert.ok(webhook.source.includes("stripe-signature"));
  assert.ok(webhook.source.includes("checkout.session.completed"));
  assert.ok(webhook.source.includes("'subscription'"));
  assert.ok(api.source.includes("sync-products"));
  assert.ok(api.source.includes("actionSubscribe"));
  assert.ok(api.source.includes("'product'"));
});

test("sync-products allows the service_role admin path without a user session", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  // Admin exemption: apikey === service_role key bypasses the user-JWT gate
  // for sync-products only.
  assert.ok(api.source.includes("isAdmin"), "admin flag present");
  assert.ok(
    api.source.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "compares against the service key",
  );
  assert.ok(
    api.source.includes("isAdmin && action === 'sync-products'"),
    "exemption scoped to sync-products",
  );
  // No template-literal or backtick leakage into the Deno bundle.
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("template version is baked into the bundle and reported by status", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  for (const built of [buildWebhookSource(data), buildApiSource(data)]) {
    assert.ok(
      built.source.includes(`var PAYKIT_TEMPLATE_VERSION = '${PAYKIT_TEMPLATE_VERSION}'`),
      `${built.slug} declares the current template version`,
    );
  }
  const api = buildApiSource(data);
  assert.ok(
    api.source.includes("templateVersion: PAYKIT_TEMPLATE_VERSION"),
    "open status action reports the template version",
  );
  // No template-literal or backtick leakage into the Deno bundle.
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("sync 401s carry distinct codes, never key material", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  assert.ok(api.source.includes("safeEqual(reqKey, adminKey)"), "constant-time key compare");
  assert.ok(api.source.includes("code: 'admin-key-mismatch'"), "mismatch code");
  assert.ok(api.source.includes("code: 'no-service-key-env'"), "missing-env code");
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("key helpers prefer new sb_ names with legacy fallback", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  assert.ok(
    api.source.includes("function svcKey() { return env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'); }"),
    "secret-first service key helper",
  );
  assert.ok(
    api.source.includes("function pubKey() { return env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY'); }"),
    "publishable-first anon key helper",
  );
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("sync creates Stripe entitlement features and attaches them to products", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [{ id: "messages", type: "metered", description: "Messages" }],
    plans: [],
  };
  const api = buildApiSource(data);
  // Find-or-create by lookup key (singular first, plural fallback across
  // Stripe API versions), attach per plan, skip already-attached.
  assert.ok(api.source.includes("findEntitlementFeature"), "lookup helper");
  assert.ok(api.source.includes("lookup_key="), "singular lookup filter");
  assert.ok(api.source.includes("lookup_keys[]="), "plural lookup fallback");
  assert.ok(api.source.includes("parameter_unknown"), "falls back on unknown-parameter");
  assert.ok(api.source.includes("POST /v1/entitlements/features") || api.source.includes("'/v1/entitlements/features'"), "create entitlement feature");
  assert.ok(api.source.includes("lookup_key: feat.id"), "lookup key from draft id");
  assert.ok(api.source.includes("/features?limit=100"), "list attached features");
  assert.ok(api.source.includes("entitlement_feature: eid"), "attach by entitlement id");
  assert.ok(api.source.includes("featuresAttached"), "reports attached features");
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("sync exposes full errors to admin callers, masked to end users", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  // Admin (sidecar) sync failures return the real Stripe/DB message so the
  // UI can show it; everyone else still gets the masked outer-catch error.
  assert.ok(api.source.includes("log('sync.failed'"), "sync failures are logged");
  assert.ok(
    api.source.includes("if (isAdmin) return json({ ok: false, error: syncErr }, 500);"),
    "admin callers receive the real error",
  );
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("every metadata upsert sets created_at (NOT NULL column)", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  const webhook = buildWebhookSource(data);
  for (const built of [webhook, api]) {
    const upserts = built.source.split("sbUpsert('metadata'").slice(1);
    assert.ok(upserts.length > 0, `${built.slug} writes metadata rows`);
    for (const u of upserts) {
      const payload = u.slice(0, u.indexOf("], 'id'"));
      assert.ok(
        payload.includes("created_at"),
        `${built.slug}: metadata upsert missing created_at`,
      );
    }
  }
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("plan action resolves current plan plus live balances, read-only", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [{ id: "messages", type: "metered" }],
    plans: [{ id: "pro", name: "Pro", group: "base", includes: [] }],
  };
  const api = buildApiSource(data);
  assert.ok(api.source.includes("async function actionPlan(authId, body)"), "resolver present");
  assert.ok(
    api.source.includes("if (action === 'plan') return json(Object.assign({ ok: true }, await actionPlan(authId, body)));"),
    "router branch present",
  );
  assert.ok(api.source.includes("status|upsert-customer|subscribe|check|report|plan|sync-products"), "action listed");
  // Same active-pick rule as recompute, default fallback, entitlement rows with balances.
  assert.ok(api.source.includes("internalId(PAYKIT_DATA.plans[p].id) === chosen.product_internal_id"), "maps subscription to plan");
  assert.ok(api.source.includes("planId: plan.id, planName: plan.name, isDefault:"), "returns plan identity");
  assert.ok(api.source.includes("featureId: r.feature_id"), "returns entitlement rows");
  // Read-only: no inserts, updates, or deletes in the resolver.
  const body = api.source.slice(
    api.source.indexOf("async function actionPlan"),
    api.source.indexOf("async function sbCount"),
  );
  assert.ok(!body.includes("sbInsert"), "no inserts in plan resolver");
  assert.ok(!body.includes("sbPatch"), "no updates in plan resolver");
  assert.ok(!body.includes("sbDelete"), "no deletes in plan resolver");
  assert.ok(!body.includes("sbUpsert"), "no upserts in plan resolver");
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});

test("mismatch diagnostics expose lengths, never key material", () => {
  const data = {
    hash: "abc123",
    schemaVersion: "test",
    features: [],
    plans: [],
  };
  const api = buildApiSource(data);
  // Lengths go to the caller (zero secret leakage, exposes JWT vs new-format
  // divergence); prefixes go to owner-only dashboard logs.
  assert.ok(api.source.includes("reqLen: reqKey.length"), "request length reported");
  assert.ok(api.source.includes("envLen: adminKey.length"), "env length reported");
  assert.ok(api.source.includes("reqPrefix"), "request prefix logged");
  assert.ok(api.source.includes("envPrefix"), "env prefix logged");
  assert.ok(api.source.includes("sync.auth"), "diagnostic log step");
  assert.ok(!api.source.includes("`"), "no backticks allowed in template");
  assert.ok(!api.source.includes("${"), "no ${} allowed in template");
});
