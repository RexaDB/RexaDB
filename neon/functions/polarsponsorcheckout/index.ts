import { corsHeaders } from "../_shared/cors";
import { polarRequest } from "../_shared/polar";

const MIN_AMOUNT_CENTS = 100; // $1
const MAX_AMOUNT_CENTS = 100_000_00; // $100,000

type SponsorBody = {
  amount: number; // cents
  email?: string;
  name?: string;
  message?: string;
  avatarUrl?: string;
  interval?: "one_time" | "month";
};

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

/** Public prefix avatar URLs must stay under. Transitional: Neon storage
 * prefix via AVATAR_BASE_URL, else the legacy Supabase public path. */
function avatarPrefix(): string | null {
  const configured = (process.env.AVATAR_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  const legacy = (process.env.LEGACY_SUPABASE_URL || "").replace(/\/+$/, "");
  return legacy
    ? `${legacy}/storage/v1/object/public/avatars/sponsors/`
    : null;
}

export default {
  async fetch(req: Request): Promise<Response> {
    log("request:received", { method: req.method, url: req.url });

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
    const appUrl =
      process.env.APP_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
    const sponsorProductId = process.env.POLAR_SPONSOR_PRODUCT_ID;
    const monthlySponsorProductId = process.env.POLAR_MONTHLY_SPONSOR_PRODUCT_ID;

    if (!polarAccessToken) {
      return new Response(JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sponsorProductId) {
      return new Response(
        JSON.stringify({ error: "Missing POLAR_SPONSOR_PRODUCT_ID" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let body: SponsorBody;
    try {
      body = (await req.json()) as SponsorBody;
      log("request:body_parsed", body);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isRecurring = body?.interval === "month";

    if (isRecurring && !monthlySponsorProductId) {
      return new Response(
        JSON.stringify({ error: "Missing POLAR_MONTHLY_SPONSOR_PRODUCT_ID" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const productId = isRecurring ? monthlySponsorProductId! : sponsorProductId;
    const amount = Math.round(Number(body?.amount));

    if (!Number.isFinite(amount) || amount < MIN_AMOUNT_CENTS || amount > MAX_AMOUNT_CENTS) {
      return new Response(
        JSON.stringify({
          error: `Amount must be between $${MIN_AMOUNT_CENTS / 100} and $${MAX_AMOUNT_CENTS / 100}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const email =
      typeof body?.email === "string" && body.email.trim() ? body.email.trim() : undefined;
    const name =
      typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
    const message =
      typeof body?.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 240)
        : undefined;
    const isAnonymous = !name;

    const prefix = avatarPrefix();
    const avatarUrl =
      typeof body?.avatarUrl === "string" &&
      body.avatarUrl.length <= 2048 &&
      (!prefix || body.avatarUrl.startsWith(prefix))
        ? body.avatarUrl
        : undefined;

    const checkoutPayload = {
      products: [productId],
      amount,
      success_url: `${appUrl}/sponsor/success?checkout_id={CHECKOUT_ID}`,
      return_url: `${appUrl}/sponsor`,
      allow_discount_codes: false,
      customer_email: email,
      customer_name: name,
      metadata: {
        type: "sponsorship",
        source: "sponsor_page",
        sponsor_name: name ?? "Anonymous",
        is_anonymous: isAnonymous ? "true" : "false",
        is_recurring: isRecurring ? "true" : "false",
        ...(message ? { sponsor_message: message } : {}),
        ...(avatarUrl ? { sponsor_avatar_url: avatarUrl } : {}),
      },
    };

    log("polar:sponsor_checkout_payload", checkoutPayload);

    try {
      const checkout = await polarRequest<{ id: string; url: string }>(
        polarAccessToken,
        "/checkouts",
        "POST",
        checkoutPayload,
      );

      log("polar:sponsor_checkout_created", checkout);

      return new Response(
        JSON.stringify({ checkoutUrl: checkout.url, checkoutSessionId: checkout.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      log("request:unhandled_error", {
        message,
        stack: error instanceof Error ? error.stack : null,
      });
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
