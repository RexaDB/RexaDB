"use client";

import {
  DEFAULT_FREE_MAX_CONNECTIONS,
  DEFAULT_FREE_MAX_WORKSPACES,
  ENTITLEMENT_CHANGED_EVENT,
  ENTITLEMENT_REFRESH_PENDING_STORAGE_KEY,
} from "@/lib/billing/entitlement-constants";
import { parseEntitlementPayload, verifyEntitlementSignature } from "@/lib/billing/entitlement-crypto";
import { getStoredUserEntitlement, updateUserPlan, upsertUserEntitlement } from "@/lib/api/actions-client";
import type {
  ResolvedUserEntitlement,
  SignedEntitlementEnvelope,
  SignedEntitlementPayload,
  StoredUserEntitlement,
} from "@/lib/billing/entitlement-types";

type ResolveOptions = {
  userId: string | null;
  accessToken: string | null;
  forceRefresh?: boolean;
  reason?: string;
};

const entitlementMemory = new Map<string, ResolvedUserEntitlement>();
const entitlementInflight = new Map<string, Promise<ResolvedUserEntitlement>>();

function formatPlanLabel(planCode: string) {
  return planCode ? planCode.charAt(0).toUpperCase() + planCode.slice(1) : "Free";
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString();
}

function createFreePayload(userId: string | null): SignedEntitlementPayload {
  const issuedAt = Date.now();
  return {
    version: 1,
    userId: userId || "local",
    entitlementPlanCode: "free",
    lastPaidPlanCode: null,
    status: "none",
    cloudEnabled: false,
    maxConnections: DEFAULT_FREE_MAX_CONNECTIONS,
    maxWorkspaces: DEFAULT_FREE_MAX_WORKSPACES,
    accessEndsAt: null,
    graceEndsAt: null,
    updatesUntil: null,
    issuedAt,
    refreshAfter: issuedAt,
  };
}

export function buildDefaultResolvedEntitlement(userId: string | null): ResolvedUserEntitlement {
  const payload = createFreePayload(userId);
  return {
    userId,
    payload,
    source: "default",
    usingCached: false,
    refreshDue: false,
    premiumActive: false,
    graceActive: false,
    updatesExpired: false,
    clockRollbackDetected: false,
    revalidationRequired: false,
    effectiveNow: Date.now(),
    effectivePlanCode: "free",
    label: "Free",
    cloudEnabled: false,
    maxConnections: DEFAULT_FREE_MAX_CONNECTIONS,
    maxWorkspaces: DEFAULT_FREE_MAX_WORKSPACES,
    accessEndsAt: null,
    graceEndsAt: null,
    updatesUntil: null,
    statusNotice: null,
  };
}

export function evaluateEntitlementPayload(
  payload: SignedEntitlementPayload,
  options: {
    source: "server" | "cache" | "default";
    usingCached: boolean;
    lastObservedAt?: number | null;
  },
): ResolvedUserEntitlement {
  const rawNow = Date.now();
  const lastObservedAt = typeof options.lastObservedAt === "number" ? options.lastObservedAt : 0;
  const clockRollbackDetected = rawNow < lastObservedAt;
  const effectiveNow = clockRollbackDetected ? lastObservedAt : rawNow;
  const isOtl = payload.entitlementPlanCode === "otl";
  const isPaidRecurring = !isOtl && payload.entitlementPlanCode !== "free";

  let premiumActive = false;
  let graceActive = false;

  if (isOtl) {
    premiumActive = true;
  } else if (isPaidRecurring) {
    if (payload.accessEndsAt && effectiveNow <= payload.accessEndsAt) {
      premiumActive = true;
    } else if (payload.graceEndsAt && effectiveNow <= payload.graceEndsAt) {
      premiumActive = true;
      graceActive = true;
    }
  }

  const effectivePlanCode = premiumActive ? payload.entitlementPlanCode : "free";
  const updatesExpired = Boolean(isOtl && payload.updatesUntil && effectiveNow > payload.updatesUntil);
  const refreshDue = effectiveNow >= payload.refreshAfter;

  let statusNotice: string | null = null;
  if (clockRollbackDetected) {
    statusNotice = "System clock changed. Reconnect to revalidate subscription.";
  } else if (options.usingCached && graceActive && payload.graceEndsAt) {
    statusNotice = `Using cached subscription during grace until ${formatDate(payload.graceEndsAt)}.`;
  } else if (options.usingCached && payload.accessEndsAt && premiumActive) {
    statusNotice = `Using cached subscription until ${formatDate(payload.accessEndsAt)}.`;
  } else if (options.usingCached && isOtl) {
    statusNotice = payload.updatesUntil
      ? `Using cached subscription. Updates ${updatesExpired ? "expired" : "available"} ${updatesExpired ? "on" : "until"} ${formatDate(payload.updatesUntil)}.`
      : "Using cached subscription.";
  }

  return {
    userId: payload.userId,
    payload,
    source: options.source,
    usingCached: options.usingCached,
    refreshDue,
    premiumActive,
    graceActive,
    updatesExpired,
    clockRollbackDetected,
    revalidationRequired: clockRollbackDetected,
    effectiveNow,
    effectivePlanCode,
    label: formatPlanLabel(effectivePlanCode),
    cloudEnabled: premiumActive ? payload.cloudEnabled : false,
    maxConnections: premiumActive ? payload.maxConnections : DEFAULT_FREE_MAX_CONNECTIONS,
    maxWorkspaces: premiumActive ? payload.maxWorkspaces : DEFAULT_FREE_MAX_WORKSPACES,
    accessEndsAt: payload.accessEndsAt,
    graceEndsAt: payload.graceEndsAt,
    updatesUntil: payload.updatesUntil,
    statusNotice,
  };
}

function dispatchEntitlementChanged(userId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ENTITLEMENT_CHANGED_EVENT, { detail: { userId } }));
}

function getPendingRefreshFlag() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(ENTITLEMENT_REFRESH_PENDING_STORAGE_KEY) === "1";
}

export function markEntitlementRefreshPending() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ENTITLEMENT_REFRESH_PENDING_STORAGE_KEY, "1");
}

export function clearEntitlementRefreshPending() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ENTITLEMENT_REFRESH_PENDING_STORAGE_KEY);
}

async function loadStoredEntitlement(userId: string) {
  const result = await getStoredUserEntitlement(userId).catch(() => null);
  const row = result?.success ? (result.data as StoredUserEntitlement | undefined) : undefined;
  if (!row?.payloadJson || !row.signature) return null;

  const payload = parseEntitlementPayload(row.payloadJson);
  if (!payload || payload.userId !== userId) return null;

  const valid = await verifyEntitlementSignature(row.payloadJson, row.signature).catch(() => false);
  if (!valid) return null;

  return { row, payload };
}

async function persistEntitlement(userId: string, envelope: SignedEntitlementEnvelope, lastObservedAt: number | null) {
  await upsertUserEntitlement({
    userId,
    payload: envelope.payload,
    payloadJson: envelope.payloadJson,
    signature: envelope.signature,
    lastObservedAt,
  });

  await updateUserPlan({
    id: userId,
    planType: envelope.payload.entitlementPlanCode || "free",
    planStatus: envelope.payload.status || "none",
    planSyncedAt: envelope.payload.issuedAt,
    planPeriodEnd: envelope.payload.accessEndsAt,
  });
}

async function fetchSignedEntitlement(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  const response = await fetch(`${supabaseUrl}/functions/v1/entitlement`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; envelope?: SignedEntitlementEnvelope; error?: string }
    | null;

  if (!response.ok || !body?.success || !body.envelope) {
    throw new Error(body?.error || "Failed to refresh subscription.");
  }

  const payload = parseEntitlementPayload(body.envelope.payloadJson);
  if (!payload) {
    throw new Error("Invalid entitlement payload.");
  }

  const valid = await verifyEntitlementSignature(body.envelope.payloadJson, body.envelope.signature);
  if (!valid) {
    throw new Error("Invalid entitlement signature.");
  }

  return {
    payload,
    signature: body.envelope.signature,
    payloadJson: body.envelope.payloadJson,
  };
}

async function resolveUserEntitlementInternal({ userId, accessToken, forceRefresh = false }: ResolveOptions): Promise<ResolvedUserEntitlement> {
  if (!userId || userId === "local" || !accessToken) {
    return buildDefaultResolvedEntitlement(userId);
  }

  const cached = await loadStoredEntitlement(userId);
  const cachedResolved = cached
    ? evaluateEntitlementPayload(cached.payload, {
        source: "cache",
        usingCached: true,
        lastObservedAt: cached.row.lastObservedAt,
      })
    : null;

  const shouldRefresh = forceRefresh || !cachedResolved || cachedResolved.refreshDue;

  if (shouldRefresh) {
    try {
      const envelope = await fetchSignedEntitlement(accessToken);
      if (envelope.payload.userId !== userId) {
        throw new Error("Entitlement user mismatch.");
      }

      const resolved = evaluateEntitlementPayload(envelope.payload, {
        source: "server",
        usingCached: false,
        lastObservedAt: cached?.row.lastObservedAt,
      });

      await persistEntitlement(userId, envelope, resolved.effectiveNow);
      entitlementMemory.set(userId, resolved);
      dispatchEntitlementChanged(userId);
      return resolved;
    } catch {
      if (cachedResolved && cached) {
        await persistEntitlement(
          userId,
          {
            payload: cached.payload,
            payloadJson: cached.row.payloadJson,
            signature: cached.row.signature,
          },
          cachedResolved.effectiveNow,
        ).catch(() => undefined);
        entitlementMemory.set(userId, cachedResolved);
        return cachedResolved;
      }
      return buildDefaultResolvedEntitlement(userId);
    }
  }

  if (cachedResolved) {
    if (cachedResolved.effectiveNow > (cached?.row.lastObservedAt ?? 0)) {
      await persistEntitlement(
        userId,
        {
          payload: cached!.payload,
          payloadJson: cached!.row.payloadJson,
          signature: cached!.row.signature,
        },
        cachedResolved.effectiveNow,
      ).catch(() => undefined);
    }
    entitlementMemory.set(userId, cachedResolved);
    return cachedResolved;
  }

  return buildDefaultResolvedEntitlement(userId);
}

export async function resolveUserEntitlement(options: ResolveOptions): Promise<ResolvedUserEntitlement> {
  const { userId, accessToken, forceRefresh = false } = options;
  if (!userId || userId === "local" || !accessToken) {
    return buildDefaultResolvedEntitlement(userId);
  }

  const cachedMemory = entitlementMemory.get(userId);
  if (cachedMemory && !forceRefresh && !cachedMemory.refreshDue) {
    return cachedMemory;
  }

  const inflightKey = `${userId}:${forceRefresh ? "force" : "default"}`;
  const inflight = entitlementInflight.get(inflightKey);
  if (inflight) return inflight;

  const task = resolveUserEntitlementInternal(options).finally(() => {
    entitlementInflight.delete(inflightKey);
  });
  entitlementInflight.set(inflightKey, task);
  return task;
}

export function shouldForceRefreshOnFocus() {
  return getPendingRefreshFlag();
}
