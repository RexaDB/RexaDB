import test from "node:test";
import assert from "node:assert/strict";
import { buildIntegrationPrompt } from "../../../lib/supabase-paykit/integration-prompt";
import type { PaykitDraftState } from "../../../lib/supabase-paykit/types";

const REF = "abcdefghijklmnopqrst";

function drafts(): PaykitDraftState {
  return {
    version: 1,
    updatedAt: 0,
    features: [{ id: "messages", type: "metered", description: "AI messages" }],
    plans: [
      {
        id: "pro",
        name: "Pro",
        group: "base",
        default: false,
        priceAmount: 20,
        priceInterval: "month",
        priceCurrency: "usd",
        includes: [{ featureId: "messages", limit: 1000, reset: "month" }],
      },
      {
        id: "free",
        name: "Free",
        group: "base",
        default: true,
        priceAmount: null,
        priceInterval: "month",
        includes: [],
      },
    ],
  };
}

test("combined brief carries live project facts, not placeholders", () => {
  const md = buildIntegrationPrompt(drafts(), REF);
  // Project block with real URLs.
  assert.ok(md.includes(`https://${REF}.supabase.co/functions/v1/paykit-api`));
  assert.ok(md.includes(`https://${REF}.supabase.co/functions/v1/paykit-webhook`));
  // Real ids from drafts fill the snippet — no "pro"/"messages" fallbacks needed here.
  assert.ok(md.includes('planId: "pro"'));
  assert.ok(md.includes('featureId: "messages"'));
  // Free-plan branch references the real default plan id.
  assert.ok(md.includes("`free`"));
  // Auth + gotcha rules present.
  assert.ok(md.includes("signed-in user's Supabase access token"));
  assert.ok(md.includes("successUrl"));
  assert.ok(md.includes("never invent ids"));
});

test("snippet falls back gracefully on empty drafts", () => {
  const md = buildIntegrationPrompt(
    { version: 1, updatedAt: 0, features: [], plans: [] },
    REF,
  );
  assert.ok(md.includes('planId: "pro"'));
  assert.ok(md.includes('featureId: "messages"'));
  assert.ok(md.includes("?action=subscribe"));
  assert.ok(md.includes("?action=check"));
  assert.ok(md.includes("?action=report"));
});

test("brief never contains secret-looking material", () => {
  const md = buildIntegrationPrompt(drafts(), REF);
  assert.ok(!md.includes("sk_test_") && !md.includes("sk_live_"));
  assert.ok(!md.includes("whsec_"));
  assert.ok(!md.includes("sb_secret_"));
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(md), "no JWT-shaped strings");
});

test("brief documents the plan lookup call", () => {
  const md = buildIntegrationPrompt(drafts(), REF);
  assert.ok(md.includes("?action=plan"), "plan action documented");
  assert.ok(md.includes("planId"), "response shape documented");
  assert.ok(md.includes("entitlements"), "balances documented");
  assert.ok(
    md.includes("no subscription-list parsing") || md.includes("never invent ids"),
    "steers away from client-side derivation",
  );
});
