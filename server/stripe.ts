// Sidecar handler: create a Stripe webhook endpoint on the user's behalf.
// Mounted in server/index.ts as:
//   POST /api/stripe/create-webhook-endpoint
// The Stripe secret key arrives in the request body (never logged, never
// stored). Browser -> api.stripe.com is blocked by CORS, so the sidecar
// (localhost) proxies the call, same as the PlanetScale proxy below.

function err(message: string) {
  return { success: false as const, error: message };
}

function ok<T>(data: T) {
  return { success: true as const, data };
}

export interface CreateWebhookEndpointInput {
  secretKey?: unknown;
  url?: unknown;
  events?: unknown;
  description?: unknown;
}

export async function createStripeWebhookEndpoint(
  body: CreateWebhookEndpointInput,
) {
  const secretKey =
    typeof body.secretKey === "string" ? body.secretKey.trim() : "";
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    return err("Invalid Stripe secret key (expected sk_test_… or sk_live_…).");
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https:\/\/\S+$/.test(url)) {
    return err("Endpoint URL must be a valid https:// URL.");
  }
  const events = Array.isArray(body.events)
    ? body.events.filter(
        (e): e is string => typeof e === "string" && e.length > 0,
      )
    : [];
  if (events.length === 0) return err("No events provided.");
  if (events.length > 100) return err("Too many events requested.");
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 200)
      : "RexaDB PayKit";

  const params = new URLSearchParams();
  params.set("url", url);
  params.set("description", description);
  for (const event of events) params.append("enabled_events[]", event);

  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/webhook_endpoints", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (e) {
    return err(
      e instanceof Error
        ? `Could not reach Stripe: ${e.message}`
        : "Could not reach Stripe.",
    );
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const message =
      json?.error?.message ||
      `Stripe rejected the request (HTTP ${res.status}).`;
    return err(message);
  }
  return ok({
    id: json.id as string,
    url: json.url as string,
    secret: json.secret as string,
    livemode: Boolean(json.livemode),
    status: json.status as string,
  });
}
