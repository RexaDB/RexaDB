import { makePool, verifySupabaseUser } from "../_shared/auth";
import { corsHeaders, json } from "../_shared/cors";

const pool = makePool();

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

type SubscriptionPlanRow = {
  code: string;
  cloud_enabled: boolean;
  max_connections: number | null;
  max_workspaces: number | null;
};

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlanCode(plan: string | null | undefined) {
  return typeof plan === "string" && plan.trim() ? plan.trim() : "free";
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
    process.env.REXADB_ENTITLEMENT_PRIVATE_KEY ||
    process.env.ENTITLEMENT_ED25519_PRIVATE_KEY;
  return raw?.trim() || null;
}

export default {
  async fetch(req: Request): Promise<Response> {
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
      const privateKeyPem = resolvePrivateKey();
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

      const user = await verifySupabaseUser(req.headers.get("Authorization"));
      if (!user) {
        return json({ success: false, error: "Unauthorized." }, 401);
      }

      const activeRes = await pool.query<UserSubscriptionRow>(
        `SELECT plan, status, ends_at, updates_until, created_at
         FROM public.user_subscriptions WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      const latestRes = await pool.query<UserSubscriptionRow>(
        `SELECT plan, status, ends_at, updates_until, created_at
         FROM public.user_subscriptions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      const latestPaidRes = await pool.query<{ plan: string | null }>(
        `SELECT plan, created_at FROM public.user_subscriptions
         WHERE user_id = $1 AND plan <> 'free'
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      const activeSubscription = activeRes.rows[0] ?? null;
      const latestSubscription = latestRes.rows[0] ?? null;
      const latestPaidSubscription = latestPaidRes.rows[0] ?? null;

      const subscription = activeSubscription ?? latestSubscription ?? null;
      const entitlementPlanCode = normalizePlanCode(subscription?.plan);
      const accessEndsAt = toTimestamp(subscription?.ends_at);
      const updatesUntil = toTimestamp(subscription?.updates_until);

      const planRes = await pool.query<SubscriptionPlanRow>(
        `SELECT code, cloud_enabled, max_connections, max_workspaces
         FROM public.subscription_plans WHERE code = $1`,
        [entitlementPlanCode],
      );
      const planRow = planRes.rows[0] ?? null;

      const issuedAt = Date.now();
      const payload = {
        version: 1 as const,
        userId: user.id,
        entitlementPlanCode,
        lastPaidPlanCode:
          normalizePlanCode(latestPaidSubscription?.plan) !== "free"
            ? normalizePlanCode(latestPaidSubscription?.plan)
            : entitlementPlanCode !== "free"
              ? entitlementPlanCode
              : null,
        status: subscription?.status?.trim() || "none",
        cloudEnabled: planRow?.cloud_enabled ?? entitlementPlanCode !== "free",
        maxConnections:
          typeof planRow?.max_connections === "number"
            ? planRow.max_connections
            : entitlementPlanCode === "free"
              ? DEFAULT_FREE_MAX_CONNECTIONS
              : null,
        maxWorkspaces:
          typeof planRow?.max_workspaces === "number"
            ? planRow.max_workspaces
            : entitlementPlanCode === "free"
              ? DEFAULT_FREE_MAX_WORKSPACES
              : null,
        accessEndsAt,
        graceEndsAt:
          entitlementPlanCode !== "otl" && accessEndsAt
            ? accessEndsAt + ENTITLEMENT_OFFLINE_GRACE_MS
            : null,
        updatesUntil,
        issuedAt,
        refreshAfter: issuedAt + ENTITLEMENT_CACHE_TTL_MS,
      };

      const payloadJson = serializePayload(payload);
      const signature = await signPayload(payloadJson, privateKeyPem);

      return json({
        success: true,
        envelope: { payload, payloadJson, signature },
      });
    } catch (error) {
      return json(
        {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to resolve entitlement.",
        },
        500,
      );
    }
  },
};
