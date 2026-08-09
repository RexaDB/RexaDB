import { createPrivateKey, sign as nodeSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_FREE_MAX_CONNECTIONS,
  DEFAULT_FREE_MAX_WORKSPACES,
  ENTITLEMENT_CACHE_TTL_MS,
  ENTITLEMENT_OFFLINE_GRACE_MS,
} from "@/lib/billing/entitlement-constants";
import { serializeEntitlementPayload } from "@/lib/billing/entitlement-crypto";
import type {
  EntitlementPlanCode,
  SignedEntitlementEnvelope,
  SignedEntitlementPayload,
} from "@/lib/billing/entitlement-types";
import {
  computeEntitlementFields,
  normalizePem,
  normalizePlanCode,
  toTimestamp,
  resolveSubscriptionPlanRow,
  fetchLatestPaidSubscription,
  resolveEntitlementSubscriptions,
} from "./entitlement-shared";
import type { SubscriptionPlanRow } from "./entitlement-shared";

// NOTE: In production, always set REXADB_ENTITLEMENT_PRIVATE_KEY via environment variable.
// The dev key below is ONLY for local development and MUST NOT be used in production.
// If this repository is public, the dev key should be treated as compromised.
const DEV_ENTITLEMENT_PRIVATE_KEY_PEM = process.env.REXADB_DEV_PRIVATE_KEY || '';

type UserSubscriptionRow = {
  plan: string | null;
  status: string | null;
  ends_at: string | null;
  updates_until: string | null;
  created_at: string | null;
};

export type EntitlementSnapshot = {
  entitlementPlanCode: EntitlementPlanCode;
  lastPaidPlanCode: EntitlementPlanCode | null;
  status: string;
  cloudEnabled: boolean;
  maxConnections: number | null;
  maxWorkspaces: number | null;
  accessEndsAt: number | null;
  graceEndsAt: number | null;
  updatesUntil: number | null;
};

export function getEntitlementPrivateKeyPem() {
  const raw =
    process.env.REXADB_ENTITLEMENT_PRIVATE_KEY?.trim() ||
    process.env.ENTITLEMENT_ED25519_PRIVATE_KEY?.trim();

  if (raw) return normalizePem(raw);
  if (process.env.NODE_ENV !== "production")
    return DEV_ENTITLEMENT_PRIVATE_KEY_PEM;
  return null;
}

function canSignEntitlementLocally() {
  return Boolean(getEntitlementPrivateKeyPem());
}

async function resolveEntitlementSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<EntitlementSnapshot> {
  const { data: activeSubscription } = await supabase
    .from("user_subscriptions")
    .select("plan, status, ends_at, updates_until, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<UserSubscriptionRow>();

  const { data: latestSubscription } = await supabase
    .from("user_subscriptions")
    .select("plan, status, ends_at, updates_until, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<UserSubscriptionRow>();

  const latestPaidSubscription = await fetchLatestPaidSubscription(supabase, userId);

  const { subscription, entitlementPlanCode, accessEndsAt, updatesUntil } =
    resolveEntitlementSubscriptions(activeSubscription ?? null, latestSubscription ?? null);
  const planRow = await resolveSubscriptionPlanRow(
    supabase as any,
    entitlementPlanCode,
  );

  const computed = computeEntitlementFields(
    {
      entitlementPlanCode,
      latestPaidPlan: latestPaidSubscription?.plan,
      subscriptionStatus: subscription?.status,
      planRowCloudEnabled: planRow?.cloud_enabled,
      planRowMaxConnections: planRow?.max_connections,
      planRowMaxWorkspaces: planRow?.max_workspaces,
      accessEndsAt,
      updatesUntil,
    },
    {
      freeMaxConnections: DEFAULT_FREE_MAX_CONNECTIONS,
      freeMaxWorkspaces: DEFAULT_FREE_MAX_WORKSPACES,
      offlineGraceMs: ENTITLEMENT_OFFLINE_GRACE_MS,
    },
  );

  return {
    entitlementPlanCode,
    ...computed,
  };
}

export function buildSignedEntitlementPayload(
  userId: string,
  snapshot: EntitlementSnapshot,
  issuedAt = Date.now(),
): SignedEntitlementPayload {
  return {
    version: 1,
    userId,
    entitlementPlanCode: snapshot.entitlementPlanCode,
    lastPaidPlanCode: snapshot.lastPaidPlanCode,
    status: snapshot.status,
    cloudEnabled: snapshot.cloudEnabled,
    maxConnections: snapshot.maxConnections,
    maxWorkspaces: snapshot.maxWorkspaces,
    accessEndsAt: snapshot.accessEndsAt,
    graceEndsAt: snapshot.graceEndsAt,
    updatesUntil: snapshot.updatesUntil,
    issuedAt,
    refreshAfter: issuedAt + ENTITLEMENT_CACHE_TTL_MS,
  };
}

function resolveEffectiveEntitlementPlanCode(
  snapshot: EntitlementSnapshot,
  now = Date.now(),
) {
  if (snapshot.entitlementPlanCode === "otl") {
    return snapshot.entitlementPlanCode;
  }
  if (snapshot.entitlementPlanCode === "free") {
    return "free";
  }
  if (snapshot.accessEndsAt && now <= snapshot.accessEndsAt) {
    return snapshot.entitlementPlanCode;
  }
  if (snapshot.graceEndsAt && now <= snapshot.graceEndsAt) {
    return snapshot.entitlementPlanCode;
  }
  return "free";
}

export function signEntitlementPayload(
  payload: SignedEntitlementPayload,
  privateKeyPem = getEntitlementPrivateKeyPem(),
): SignedEntitlementEnvelope {
  if (!privateKeyPem) {
    throw new Error("Missing entitlement private key.");
  }

  const payloadJson = serializeEntitlementPayload(payload);
  const key = createPrivateKey({ key: privateKeyPem, format: "pem" });
  const signature = nodeSign(null, Buffer.from(payloadJson), key).toString(
    "base64",
  );

  return {
    payload,
    payloadJson,
    signature,
  };
}
