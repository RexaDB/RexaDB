import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDrafts,
  validatePaykitId,
} from "../../../lib/supabase-paykit/validation";
import type { PaykitDraftState } from "../../../lib/supabase-paykit/types";

function base(): PaykitDraftState {
  return {
    version: 1,
    features: [{ id: "messages", type: "metered" }],
    plans: [
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
    ],
    updatedAt: 0,
  };
}

test("valid ids pass", () => {
  assert.equal(validatePaykitId("pro"), null);
  assert.equal(validatePaykitId("my-plan_2"), null);
});

test("invalid ids fail", () => {
  assert.ok(validatePaykitId(""));
  assert.ok(validatePaykitId("Pro"));
  assert.ok(validatePaykitId("has space"));
  assert.ok(validatePaykitId("x".repeat(65)));
});

test("usage-based draft validates clean", () => {
  assert.deepEqual(validateDrafts(base()), []);
});

test("duplicate feature ids rejected", () => {
  const d = base();
  d.features.push({ id: "messages", type: "boolean" });
  assert.ok(validateDrafts(d).some((e) => e.includes("Duplicate feature")));
});

test("metered include needs limit + reset", () => {
  const d = base();
  d.plans[1].includes = [{ featureId: "messages" }];
  const errors = validateDrafts(d);
  assert.ok(errors.some((e) => e.includes("positive integer limit")));
  assert.ok(errors.some((e) => e.includes("needs reset")));
});

test("boolean include rejects limit", () => {
  const d = base();
  d.features.push({ id: "pro_models", type: "boolean" });
  d.plans[1].includes.push({ featureId: "pro_models", limit: 5, reset: "month" });
  assert.ok(validateDrafts(d).some((e) => e.includes("takes no limit")));
});

test("unknown feature rejected", () => {
  const d = base();
  d.plans[0].includes = [{ featureId: "nope", limit: 1, reset: "day" }];
  assert.ok(validateDrafts(d).some((e) => e.includes("unknown feature")));
});

test("two defaults in one group rejected", () => {
  const d = base();
  d.plans[1].default = true;
  assert.ok(validateDrafts(d).some((e) => e.includes("only one plan may be default")));
});

test("price bounds enforced", () => {
  const d = base();
  d.plans[1].priceAmount = 0;
  assert.ok(validateDrafts(d).some((e) => e.includes("price must be between")));
  d.plans[1].priceAmount = 2000000;
  assert.ok(validateDrafts(d).some((e) => e.includes("price must be between")));
});
