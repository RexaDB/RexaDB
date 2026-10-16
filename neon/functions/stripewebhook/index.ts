import { makePool } from "../_shared/auth";
import { json } from "../_shared/cors";

const pool = makePool();

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

const mapPolarStatus = (status: string) => {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete")
    return "past_due";
  return "canceled";
};

const parseMetadataBool = (value: unknown) => {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
};

const parseAmountCents = (payload: Record<string, unknown>) => {
  const candidates = [
    payload.total_amount,
    payload.net_amount,
    payload.subtotal_amount,
    payload.amount,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 0;
};

const resolveSponsorOrderId = (
  eventType: string,
  payload: Record<string, unknown>,
): string | null => {
  const direct = payload.id;
  const directId = typeof direct === "string" && direct.trim() ? direct.trim() : null;

  const nested = payload.order as Record<string, unknown> | undefined;
  const candidates = [payload.order_id, payload.created_order_id, nested?.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  if (eventType.startsWith("checkout.")) {
    if (directId) return `checkout:${directId}`;
    return null;
  }

  return directId;
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

const verifyPolarSignature = async (
  rawBody: string,
  headers: Headers,
  secret: string,
) => {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const toleranceSeconds = Number(
    process.env.POLAR_WEBHOOK_TOLERANCE_SECONDS ?? "300",
  );
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
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const expected = new Uint8Array(signatureBuffer);

  const signatures = webhookSignature.split(" ").map((e) => e.trim()).filter(Boolean);
  for (const entry of signatures) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    try {
      const provided = decodeBase64(value);
      if (timingSafeEqual(expected, provided)) return true;
    } catch {
      /* ignore malformed entries */
    }
  }
  return false;
};

async function upsertBillingCustomer(args: {
  userId?: string | null;
  providerCustomerId?: string | null;
  email?: string | null;
}) {
  const { userId, providerCustomerId, email } = args;
  if (!providerCustomerId || !userId) {
    log("billing_customer:skip_missing_ids", { userId, providerCustomerId });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO public.billing_customers (user_id, provider, provider_customer_id, email)
       VALUES ($1, 'polar', $2, $3)
       ON CONFLICT (provider, provider_customer_id) DO UPDATE SET
         user_id = EXCLUDED.user_id, email = EXCLUDED.email`,
      [userId, providerCustomerId, email ?? null],
    );
    log("billing_customer:upsert_result", { userId, providerCustomerId, error: null });
  } catch (e) {
    log("billing_customer:upsert_result", {
      userId,
      providerCustomerId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;
    if (!polarWebhookSecret) return json({ error: "Missing required env vars" }, 500);

    const rawBody = await req.text();

    const verified = await verifyPolarSignature(rawBody, req.headers, polarWebhookSecret);
    if (!verified) return json({ error: "Invalid signature" }, 400);

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    const eventId =
      (event.id as string | undefined) ??
      (event.event_id as string | undefined) ??
      crypto.randomUUID();
    const eventType = (event.type as string | undefined) ?? "unknown";

    try {
      await pool.query(
        `INSERT INTO public.billing_webhook_events
           (provider, provider_event_id, event_type, payload)
         VALUES ('polar', $1, $2, $3)`,
        [eventId, eventType, JSON.stringify(event)],
      );
    } catch (insertError) {
      if ((insertError as { code?: string })?.code === "23505") {
        const { rows } = await pool.query<{ processed_at: string | null; error: string | null }>(
          `SELECT processed_at, error FROM public.billing_webhook_events
           WHERE provider = 'polar' AND provider_event_id = $1 LIMIT 1`,
          [eventId],
        );
        if (rows[0]?.processed_at) return json({ ok: true, duplicate: true });
      } else {
        const message =
          insertError instanceof Error ? insertError.message : String(insertError);
        return json({ error: message }, 500);
      }
    }

    async function markEvent() {
      await pool.query(
        `UPDATE public.billing_webhook_events
         SET processed_at = now(), error = NULL
         WHERE provider = 'polar' AND provider_event_id = $1`,
        [eventId],
      );
    }

    try {
      const data = (event.data as Record<string, unknown> | undefined) ?? {};
      const resolvedData =
        (data?.object as Record<string, unknown> | undefined) ?? data;

      if (eventType.startsWith("customer.")) {
        const customer = resolvedData as Record<string, unknown>;
        const customerId = (customer.id as string | undefined) ?? null;
        const userId =
          (customer.external_id as string | undefined) ??
          (customer.user_id as string | undefined) ??
          ((customer.metadata as Record<string, unknown> | undefined)
            ?.supabase_user_id as string | undefined) ??
          null;
        const email = (customer.email as string | undefined) ?? null;

        await upsertBillingCustomer({ userId, providerCustomerId: customerId, email });
      }

      if (
        eventType.startsWith("subscription.") ||
        eventType.startsWith("checkout.") ||
        eventType.startsWith("order.")
      ) {
        const payload = resolvedData as Record<string, unknown>;

        const customerObj =
          (payload.customer as Record<string, unknown> | undefined) ??
          (payload.data as Record<string, unknown> | undefined)?.customer ??
          {};
        const providerCustomerId =
          (payload.customer_id as string | undefined) ??
          ((customerObj as Record<string, unknown>).id as string | undefined) ??
          null;
        const userId =
          ((customerObj as Record<string, unknown>).external_id as string | undefined) ??
          (payload.user_id as string | undefined) ??
          ((payload.metadata as Record<string, unknown> | undefined)?.supabase_user_id as
            | string
            | undefined) ??
          null;
        const email =
          (payload.customer_email as string | undefined) ??
          ((customerObj as Record<string, unknown>).email as string | undefined) ??
          null;

        if (providerCustomerId) {
          await upsertBillingCustomer({ userId, providerCustomerId, email });
        } else {
          log("skipping_upsert_no_customer_id", { eventType, payload });
        }

        const metadata = (payload.metadata as Record<string, unknown> | undefined) ?? {};
        const orderType = String(metadata.type ?? "").trim().toLowerCase();
        const orderPlanCode = (metadata.plan_code as string | undefined) ?? "";

        if (orderType === "sponsorship") {
          const billingReason = (payload.billing_reason as string | undefined) ?? "";
          const isRenewalCharge = billingReason === "subscription_cycle";
          const isPaidOrder =
            eventType === "order.paid" ||
            ((eventType === "order.created" || eventType === "order.updated") &&
              (payload.paid === true ||
                String(payload.status ?? "").trim().toLowerCase() === "paid"));
          const checkoutStatus = String(payload.status ?? "").trim().toLowerCase();
          const isCheckoutSuccess =
            (eventType === "checkout.updated" || eventType === "checkout.succeeded") &&
            (checkoutStatus === "succeeded" || checkoutStatus === "confirmed");

          const amountCents = parseAmountCents(payload);
          const isAnonymous = parseMetadataBool(metadata.is_anonymous);
          const isRecurring = parseMetadataBool(metadata.is_recurring);
          const sponsorName = isAnonymous
            ? "Anonymous"
            : ((metadata.sponsor_name as string | undefined)?.trim() || "Anonymous");
          const sponsorMessage =
            (metadata.sponsor_message as string | undefined)?.trim() || null;
          const sponsorAvatarUrl =
            (metadata.sponsor_avatar_url as string | undefined)?.trim() || null;
          const providerOrderId = resolveSponsorOrderId(eventType, payload);

          if (isRenewalCharge) {
            log("sponsorship:skip_renewal", {
              providerOrderId,
              billingReason,
              eventType,
              userId,
            });
          } else if (!isPaidOrder && !isCheckoutSuccess) {
            log("sponsorship:ignored_event", {
              eventType,
              providerOrderId,
              billingReason,
              userId,
              checkoutStatus: eventType.startsWith("checkout.") ? checkoutStatus : undefined,
            });
          } else if (amountCents > 0 && providerOrderId) {
            try {
              await pool.query(
                `INSERT INTO public.sponsors
                   (display_name, message, amount_cents, is_anonymous, is_recurring, avatar_url, provider_order_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  sponsorName,
                  sponsorMessage,
                  amountCents,
                  isAnonymous,
                  isRecurring,
                  isAnonymous ? null : sponsorAvatarUrl,
                  providerOrderId,
                ],
              );
              log("sponsorship:recorded", {
                providerOrderId,
                amountCents,
                isAnonymous,
                isRecurring,
                eventType,
                userId,
              });
            } catch (sponsorInsertError) {
              if ((sponsorInsertError as { code?: string })?.code !== "23505") {
                const message =
                  sponsorInsertError instanceof Error
                    ? sponsorInsertError.message
                    : String(sponsorInsertError);
                log("sponsorship:insert_failed", {
                  error: message,
                  eventType,
                  providerOrderId,
                  amountCents,
                  userId,
                });
                await pool.query(
                  `UPDATE public.billing_webhook_events SET error = $3
                   WHERE provider = 'polar' AND provider_event_id = $1`,
                  [eventId, eventType, `sponsorship insert failed: ${message}`],
                );
              }
            }
          } else {
            log("sponsorship:skip_invalid", { amountCents, providerOrderId, eventType, userId });
          }
        }

        if (orderType === "otl" || orderPlanCode === "otl") {
          const customerObj2 =
            (payload.customer as Record<string, unknown> | undefined) ?? {};
          const otlUserId =
            (metadata.supabase_user_id as string | undefined) ??
            (customerObj2.external_id as string | undefined) ??
            (payload.user_id as string | undefined) ??
            null;

          if (!otlUserId) {
            log("otl:skip_no_user_id", { eventType });
          } else if (eventType === "order.paid") {
            log("otl:extending_updates", { userId: otlUserId });
            await pool.query(`SELECT public.extend_otl_updates($1)`, [otlUserId]);
          } else if (eventType === "order.refunded") {
            log("otl:revoking_on_refund", { userId: otlUserId });
            await pool.query(
              `UPDATE public.user_subscriptions SET status = 'canceled',
                 updates_until = NULL, updated_at = now()
               WHERE user_id = $1 AND plan = 'otl'`,
              [otlUserId],
            );
          }
        }
      }

      if (eventType.startsWith("subscription.")) {
        const payload = resolvedData as Record<string, unknown>;
        const metadata =
          (payload.metadata as Record<string, unknown> | undefined) ?? {};
        const customerObj =
          (payload.customer as Record<string, unknown> | undefined) ?? {};
        const userId =
          (metadata.supabase_user_id as string | undefined) ??
          (customerObj.external_id as string | undefined) ??
          (payload.user_id as string | undefined) ??
          null;
        const planCode = (metadata.plan_code as string | undefined) ?? null;
        const interval =
          (metadata.interval as string | undefined) ??
          (payload.recurring_interval as string | undefined) ??
          ((payload.price as Record<string, unknown> | undefined)?.recurring_interval as
            | string
            | undefined) ??
          ((payload.product as Record<string, unknown> | undefined)?.recurring_interval as
            | string
            | undefined) ??
          "month";
        const status =
          (payload.status as string | undefined) ?? eventType.split(".")[1] ?? "active";

        if (userId && planCode && ["free", "pro", "team", "enterprise", "otl"].includes(planCode)) {
          await pool.query(
            `SELECT * FROM public.subscribe_to_plan($1,$2,$3,$4,$5,$6,$7)`,
            [
              planCode,
              interval === "year" ? "year" : "month",
              (payload.id as string | undefined) ?? null,
              null,
              Boolean(payload.cancel_at_period_end),
              mapPolarStatus(status),
              userId,
            ],
          );
        } else {
          log("skipping_subscription_sync", { eventType, userId, planCode });
        }
      }

      await markEvent();
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      await pool
        .query(
          `UPDATE public.billing_webhook_events SET error = $3
           WHERE provider = 'polar' AND provider_event_id = $1`,
          [eventId, eventType, message],
        )
        .catch(() => undefined);
      return json({ error: message }, 500);
    }
  },
};
