import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

const mapPolarStatus = (status: string) => {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "past_due";
  return "canceled";
};

const decodeBase64 = (input: string) => {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

const verifyPolarSignature = async (rawBody: string, headers: Headers, secret: string) => {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const toleranceSeconds = Number(Deno.env.get("POLAR_WEBHOOK_TOLERANCE_SECONDS") ?? "300");
  const timestampMs = Number(webhookTimestamp) * 1000;
  if (!Number.isNaN(timestampMs)) {
    const ageMs = Math.abs(Date.now() - timestampMs);
    if (ageMs > toleranceSeconds * 1000) return false;
  }

  const payload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = new Uint8Array(signatureBuffer);

  const signatures = webhookSignature.split(" ").map(e => e.trim()).filter(Boolean);
  for (const entry of signatures) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    try {
      const provided = decodeBase64(value);
      if (timingSafeEqual(expected, provided)) return true;
    } catch {}
  }
  return false;
};

// ✅ Upsert customer into billing_customers
const upsertBillingCustomer = async ({
  admin,
  userId,
  providerCustomerId,
  email,
}: {
  admin: ReturnType<typeof createClient>;
  userId?: string | null;
  providerCustomerId?: string | null;
  email?: string | null;
}) => {
  if (!providerCustomerId || !userId) {
    log("billing_customer:skip_missing_ids", { userId, providerCustomerId });
    return;
  }

  const { error } = await admin.from("billing_customers").upsert(
    {
      user_id: userId,
      provider: "polar",
      provider_customer_id: providerCustomerId,
      email: email ?? null,
    },
    { onConflict: "provider,provider_customer_id" }
  );

  log("billing_customer:upsert_result", { userId, providerCustomerId, error: error?.message ?? null });
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const polarWebhookSecret = Deno.env.get("POLAR_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !polarWebhookSecret)
    return json({ error: "Missing required env vars" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const rawBody = await req.text();

  const verified = await verifyPolarSignature(rawBody, req.headers, polarWebhookSecret);
  if (!verified) return json({ error: "Invalid signature" }, 400);

  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const eventId = event.id ?? event.event_id ?? crypto.randomUUID();
  const eventType = event.type ?? "unknown";

  // insert raw webhook event (proper JSONB storage)
  const { error: insertError } = await admin.from("billing_webhook_events").insert({
    provider: "polar",
    provider_event_id: eventId,
    event_type: eventType,
    payload: event, // store actual object
  });

  if (insertError?.code === "23505") return json({ ok: true, duplicate: true });
  if (insertError) return json({ error: insertError.message }, 500);

  try {
    const data = event.data ?? {};
    const resolvedData = (data?.object as Record<string, unknown> | undefined) ?? data;

    // handle customer events
    if (eventType.startsWith("customer.")) {
      const customer = resolvedData as Record<string, unknown>;
      const customerId = customer.id ?? null;
      const userId = customer.external_id
        ?? customer.user_id
        ?? customer.metadata?.supabase_user_id
        ?? null;
      const email = customer.email ?? null;

      await upsertBillingCustomer({ admin, userId, providerCustomerId: customerId, email });
    }

    // handle subscription / checkout / order events
    if (eventType.startsWith("subscription.") || eventType.startsWith("checkout.") || eventType.startsWith("order.")) {
      const payload = resolvedData as Record<string, unknown>;

      // Polar nests customer differently depending on event type
      const customerObj = (payload.customer as Record<string, unknown> | undefined)
        ?? (payload.data as Record<string, unknown> | undefined)?.customer
        ?? {};
      const providerCustomerId = (payload.customer_id as string | undefined)
        ?? (customerObj as Record<string, unknown>).id as string | undefined
        ?? null;
      const userId = (customerObj as Record<string, unknown>).external_id as string | undefined
        ?? (payload.user_id as string | undefined)
        ?? (payload.metadata as Record<string, unknown> | undefined)?.supabase_user_id as string | undefined
        ?? null;
      const email = (payload.customer_email as string | undefined)
        ?? (customerObj as Record<string, unknown>).email as string | undefined
        ?? null;

      if (providerCustomerId) {
        await upsertBillingCustomer({ admin, userId, providerCustomerId, email });
      } else {
        log("skipping_upsert_no_customer_id", { eventType, payload });
      }

      // --- OTL one-time license handling ---
      const metadata = (payload.metadata as Record<string, unknown>) ?? {};
      const orderType = (metadata.type as string | undefined) ?? "";
      const orderPlanCode = (metadata.plan_code as string | undefined) ?? "";

      if (orderType === "otl" || orderPlanCode === "otl") {
        const otlUserId = (metadata.supabase_user_id as string | undefined)
          ?? (customerObj.external_id as string | undefined)
          ?? (payload.user_id as string | undefined)
          ?? null;

        if (!otlUserId) {
          log("otl:skip_no_user_id", { eventType });
        } else if (eventType === "order.paid") {
          log("otl:extending_updates", { userId: otlUserId });
          await admin.rpc("extend_otl_updates", { p_user_id: otlUserId });
        } else if (eventType === "order.refunded") {
          log("otl:revoking_on_refund", { userId: otlUserId });
          await admin
            .from("user_subscriptions")
            .update({
              status: "canceled",
              updates_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", otlUserId)
            .eq("plan", "otl");
        }
      }
    }

    if (eventType.startsWith("subscription.")) {
      const payload = resolvedData as Record<string, unknown>;
      const metadata = (payload.metadata as Record<string, unknown> | undefined) ?? {};
      const customerObj = (payload.customer as Record<string, unknown> | undefined) ?? {};
      const userId = (metadata.supabase_user_id as string | undefined)
        ?? (customerObj.external_id as string | undefined)
        ?? (payload.user_id as string | undefined)
        ?? null;
      const planCode = (metadata.plan_code as string | undefined) ?? null;
      const interval = (metadata.interval as string | undefined)
        ?? (payload.recurring_interval as string | undefined)
        ?? ((payload.price as Record<string, unknown> | undefined)?.recurring_interval as string | undefined)
        ?? ((payload.product as Record<string, unknown> | undefined)?.recurring_interval as string | undefined)
        ?? "month";
      const status = (payload.status as string | undefined) ?? eventType.split(".")[1] ?? "active";

      if (userId && planCode && ["free", "pro", "team", "enterprise", "otl"].includes(planCode)) {
        await admin.rpc("subscribe_to_plan", {
          p_plan_code: planCode,
          p_interval: interval === "year" ? "year" : "month",
          p_provider_subscription_id: payload.id ?? null,
          p_provider_customer_id: null,
          p_cancel_at_period_end: Boolean(payload.cancel_at_period_end),
          p_status: mapPolarStatus(status),
          p_user_id: userId,
        });
      } else {
        log("skipping_subscription_sync", { eventType, userId, planCode });
      }
    }

    // mark webhook event processed
    await admin.from("billing_webhook_events").update({
      processed_at: new Date().toISOString(),
      error: null,
    }).eq("provider", "polar").eq("provider_event_id", eventId);

    return json({ ok: true });
  } catch (error: any) {
    await admin.from("billing_webhook_events").update({
      error: error.message ?? "Webhook processing failed",
    }).eq("provider", "polar").eq("provider_event_id", eventId);

    return json({ error: error.message ?? "Webhook processing failed" }, 500);
  }
});
