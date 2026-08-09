import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

import { corsHeaders } from "../_shared/cors.ts";
import {
  computeEntitlementFields,
  normalizePem,
  normalizePlanCode,
  toTimestamp,
  resolveSubscriptionPlanRow,
  fetchLatestPaidSubscription,
  resolveEntitlementSubscriptions,
} from "../../../lib/billing/entitlement-shared.ts";

const ENTITLEMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENTITLEMENT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_FREE_MAX_CONNECTIONS = 3;
const DEFAULT_FREE_MAX_WORKSPACES = 0;

type UserSubscriptionRow = {
  plan: string | null;
  status: string | null;
  ends_at: string | null;
  updates_until: string | null;
  created_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

function serializePayload(payload: Record<string, unknown>) {
  return JSON.stringify({
    version: payload.version,
    userId: payload.userId,
    entitlementPlanCode: payload.entitlementPlanCode,
    lastPaidPlanCode: payload.lastPaidPlanCode,
    status: payload.status,
    cloudEnabled: payload.cloudEnabled,
    maxConnections: payload.maxConnections,
    maxWorkspaces: payload.maxWorkspaces,
    accessEndsAt: payload.accessEndsAt,
    graceEndsAt: payload.graceEndsAt,
    updatesUntil: payload.updatesUntil,
    issuedAt: payload.issuedAt,
    refreshAfter: payload.refreshAfter,
  });
}

function base64ToBytes(value: string) {
  const decoded = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

async function signPayload(payloadJson: string, privateKeyPem: string) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(
      normalizePem(privateKeyPem)
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, ""),
    ),
    "Ed25519",
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(payloadJson),
  );
  return bytesToBase64(new Uint8Array(signature));
}

function resolvePrivateKey(): string | null {
  const raw =
    Deno.env.get("REXADB_ENTITLEMENT_PRIVATE_KEY") ||
    Deno.env.get("ENTITLEMENT_ED25519_PRIVATE_KEY");

  return raw?.trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  if (req.method !== "GET") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const privateKeyPem = resolvePrivateKey();
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ success: false, error: "Missing Supabase env vars." }, 500);
    }

    if (!privateKeyPem) {
      return json(
        {
          success: false,
          error:
            "Entitlement signing key not configured. Set REXADB_ENTITLEMENT_PRIVATE_KEY secret.",
        },
        500,
      );
    }

    if (!authHeader) {
      return json(
        { success: false, error: "Missing Authorization header." },
        401,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ success: false, error: "Unauthorized." }, 401);
    }

    const { data: activeSubscription } = await admin
      .from("user_subscriptions")
      .select("plan, status, ends_at, updates_until, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<UserSubscriptionRow>();

    const { data: latestSubscription } = await admin
      .from("user_subscriptions")
      .select("plan, status, ends_at, updates_until, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<UserSubscriptionRow>();

    const latestPaidSubscription = await fetchLatestPaidSubscription(admin, user.id);

    const { subscription, entitlementPlanCode, accessEndsAt, updatesUntil } =
      resolveEntitlementSubscriptions(activeSubscription ?? null, latestSubscription ?? null);
    const planRow = await resolveSubscriptionPlanRow(
      admin,
      entitlementPlanCode,
    );

    const issuedAt = Date.now();
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
    const payload = {
      version: 1 as const,
      userId: user.id,
      entitlementPlanCode,
      ...computed,
      issuedAt,
      refreshAfter: issuedAt + ENTITLEMENT_CACHE_TTL_MS,
    };

    const payloadJson = serializePayload(payload);
    const signature = await signPayload(payloadJson, privateKeyPem);

    return json({
      success: true,
      envelope: {
        payload,
        payloadJson,
        signature,
      },
    });
  } catch (error) {
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve entitlement.",
      },
      500,
    );
  }
});
