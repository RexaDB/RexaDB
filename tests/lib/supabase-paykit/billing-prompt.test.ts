import test from "node:test";
import assert from "node:assert/strict";
import { buildBillingPrompt } from "../../../lib/supabase-paykit/billing-prompt";
import type { PaykitDraftState } from "../../../lib/supabase-paykit/types";

function drafts(): PaykitDraftState {
  return {
    version: 1,
    updatedAt: 0,
    features: [
      { id: "messages", type: "metered", description: "AI messages" },
      { id: "support", type: "boolean" },
    ],
    plans: [
      {
        id: "pro",
        name: "Pro",
        group: "base",
        default: false,
        priceAmount: 20,
        priceInterval: "month",
        priceCurrency: "usd",
        includes: [
          { featureId: "messages", limit: 1000, reset: "month" },
          { featureId: "support" },
        ],
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

test("buildBillingPrompt renders products and features as markdown", () => {
  const md = buildBillingPrompt(drafts());
  assert.ok(md.includes("# Billing setup"));
  assert.ok(md.includes("## Products"));
  assert.ok(md.includes("## Features"));
  assert.ok(md.includes("**Pro** (`pro`)"));
  assert.ok(md.includes("$20.00 USD per month"));
  assert.ok(md.includes("messages (limit 1000/month)"));
  assert.ok(md.includes("`messages` (metered) — AI messages"));
  assert.ok(md.includes("**Free** (`free`)"));
  assert.ok(md.includes("Free, group `base`, default. Features: no features."));
});

test("buildBillingPrompt handles empty drafts", () => {
  const md = buildBillingPrompt({ version: 1, updatedAt: 0, features: [], plans: [] });
  assert.ok(md.includes("(none yet)"));
});
