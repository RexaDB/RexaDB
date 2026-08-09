import test from "node:test";
import assert from "node:assert/strict";

import { serializeEntitlementPayload, verifyEntitlementSignature } from "../../../lib/billing/entitlement-crypto";
import { evaluateEntitlementPayload } from "../../../lib/billing/entitlement-resolver";
import { buildSignedEntitlementPayload, signEntitlementPayload } from "../../../lib/billing/entitlement-server";

test("entitlement signatures verify and fail on tampering", async () => {
  const payload = buildSignedEntitlementPayload("user-1", {
    entitlementPlanCode: "pro",
    lastPaidPlanCode: "pro",
    status: "active",
    cloudEnabled: true,
    maxConnections: 10,
    maxWorkspaces: 5,
    accessEndsAt: Date.now() + 60_000,
    graceEndsAt: Date.now() + 120_000,
    updatesUntil: null,
  });
  const envelope = signEntitlementPayload(payload);

  assert.equal(await verifyEntitlementSignature(envelope.payloadJson, envelope.signature), true);

  const tamperedJson = serializeEntitlementPayload({
    ...payload,
    userId: "user-2",
  });
  assert.equal(await verifyEntitlementSignature(tamperedJson, envelope.signature), false);
});

test("recurring entitlement stays active before access end", () => {
  const now = Date.now();
  const result = evaluateEntitlementPayload(
    {
      version: 1,
      userId: "user-1",
      entitlementPlanCode: "pro",
      lastPaidPlanCode: "pro",
      status: "active",
      cloudEnabled: true,
      maxConnections: 10,
      maxWorkspaces: 5,
      accessEndsAt: now + 60_000,
      graceEndsAt: now + 180_000,
      updatesUntil: null,
      issuedAt: now,
      refreshAfter: now + 10_000,
    },
    { source: "cache", usingCached: true, lastObservedAt: now },
  );

  assert.equal(result.premiumActive, true);
  assert.equal(result.graceActive, false);
  assert.equal(result.effectivePlanCode, "pro");
});

test("recurring entitlement stays active during grace and downgrades after grace", () => {
  const now = Date.now();
  const payload = {
    version: 1 as const,
    userId: "user-1",
    entitlementPlanCode: "pro",
    lastPaidPlanCode: "pro",
    status: "canceled",
    cloudEnabled: true,
    maxConnections: 10,
    maxWorkspaces: 5,
    accessEndsAt: now - 60_000,
    graceEndsAt: now + 60_000,
    updatesUntil: null,
    issuedAt: now - 120_000,
    refreshAfter: now - 30_000,
  };

  const graceResult = evaluateEntitlementPayload(payload, {
    source: "cache",
    usingCached: true,
    lastObservedAt: now,
  });
  assert.equal(graceResult.premiumActive, true);
  assert.equal(graceResult.graceActive, true);
  assert.equal(graceResult.effectivePlanCode, "pro");

  const expiredResult = evaluateEntitlementPayload(payload, {
    source: "cache",
    usingCached: true,
    lastObservedAt: now + 120_000,
  });
  assert.equal(expiredResult.clockRollbackDetected, true);

  const downgraded = evaluateEntitlementPayload(
    {
      ...payload,
      graceEndsAt: now - 1,
    },
    { source: "cache", usingCached: true, lastObservedAt: now },
  );
  assert.equal(downgraded.premiumActive, false);
  assert.equal(downgraded.effectivePlanCode, "free");
});

test("otl stays active after updates expire but blocks updates", () => {
  const now = Date.now();
  const result = evaluateEntitlementPayload(
    {
      version: 1,
      userId: "user-1",
      entitlementPlanCode: "otl",
      lastPaidPlanCode: "otl",
      status: "active",
      cloudEnabled: false,
      maxConnections: 3,
      maxWorkspaces: 0,
      accessEndsAt: null,
      graceEndsAt: null,
      updatesUntil: now - 60_000,
      issuedAt: now - 120_000,
      refreshAfter: now - 30_000,
    },
    { source: "cache", usingCached: true, lastObservedAt: now },
  );

  assert.equal(result.premiumActive, true);
  assert.equal(result.effectivePlanCode, "otl");
  assert.equal(result.updatesExpired, true);
});
