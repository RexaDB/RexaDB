import { callAsUser, makePool, verifySupabaseUser } from "../_shared/auth";
import { corsHeaders } from "../_shared/cors";
import { polarRequest, resolvePolarBaseUrl } from "../_shared/polar";

const pool = makePool();

type SubscribeBody = {
  planCode: "free" | "pro" | "team" | "enterprise" | "otl";
  interval?: "month" | "year";
};

const log = (step: string, data?: unknown) => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      step,
      data,
    }),
  );
};

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

    try {
      const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
      const appUrl =
        process.env.APP_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

      log("env:loaded", {
        hasPolarAccessToken: !!polarAccessToken,
        appUrl,
        polarBaseUrl: resolvePolarBaseUrl(),
        polarEnv: process.env.POLAR_ENV ?? "production",
      });

      const user = await verifySupabaseUser(req.headers.get("Authorization"));

      log("auth:get_user_result", {
        hasUser: !!user,
        userId: user?.id ?? null,
        email: user?.email ?? null,
      });

      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const profileRes = await pool.query<{ id: string; email: string }>(
        `SELECT id, email FROM public.profiles WHERE id = $1 LIMIT 1`,
        [user.id],
      );
      const existingProfile = profileRes.rows[0] ?? null;
      log("db:profile_lookup", { userId: user.id, found: !!existingProfile });

      if (!existingProfile) {
        const profileEmail =
          user.email ??
          (user.user_metadata as { email?: string } | null)?.email ??
          null;

        if (!profileEmail) {
          return new Response(
            JSON.stringify({ error: "Missing user email for profile creation" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        try {
          await pool.query(
            `INSERT INTO public.profiles (id, email, full_name) VALUES ($1, $2, NULL)`,
            [user.id, profileEmail],
          );
          log("db:profile_insert", { userId: user.id, profileEmail });
        } catch (profileInsertError) {
          const code = (profileInsertError as { code?: string })?.code;
          log("db:profile_insert", {
            userId: user.id,
            profileEmail,
            profileInsertError:
              profileInsertError instanceof Error
                ? profileInsertError.message
                : String(profileInsertError),
          });
          if (code !== "23505") {
            return new Response(
              JSON.stringify({
                error:
                  profileInsertError instanceof Error
                    ? profileInsertError.message
                    : String(profileInsertError),
              }),
              {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
        }
      }

      let body: SubscribeBody;
      try {
        body = (await req.json()) as SubscribeBody;
        log("request:body_parsed", body);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const planCode = body?.planCode;
      const interval = body?.interval ?? "month";

      log("request:validated_input", { planCode, interval });

      if (!planCode || !["free", "pro", "team", "enterprise", "otl"].includes(planCode)) {
        return new Response(JSON.stringify({ error: "Invalid planCode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (planCode !== "otl" && !["month", "year"].includes(interval)) {
        return new Response(JSON.stringify({ error: "Invalid interval" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const planRes = await pool.query<{
        code: string;
        name: string;
        is_active: boolean;
        stripe_monthly_price_id: string | null;
        stripe_yearly_price_id: string | null;
        stripe_otl_price_id: string | null;
        monthly_price_cents: number;
        yearly_price_cents: number | null;
      }>(
        `SELECT code, name, is_active, stripe_monthly_price_id, stripe_yearly_price_id,
                stripe_otl_price_id, monthly_price_cents, yearly_price_cents
         FROM public.subscription_plans WHERE code = $1 LIMIT 1`,
        [planCode],
      );
      const plan = planRes.rows[0] ?? null;
      log("db:plan_lookup", { planCode, found: !!plan, plan });

      if (!plan || !plan.is_active) {
        return new Response(JSON.stringify({ error: "Plan not found or inactive" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const existingRes = await pool.query<{
        plan: string;
        status: string;
        stripe_subscription_id: string | null;
      }>(
        `SELECT plan, status, stripe_subscription_id FROM public.user_subscriptions
         WHERE user_id = $1 LIMIT 1`,
        [user.id],
      );
      const existingSubscription = existingRes.rows[0] ?? null;
      log("db:existing_subscription", { userId: user.id, existingSubscription });

      const uid: string = user.id;

      async function callSubscribeRpc(args: {
        p_plan_code: string;
        p_interval: string;
        p_provider_subscription_id: string | null;
        p_provider_customer_id: string | null;
        p_cancel_at_period_end: boolean;
        p_status: string;
        p_user_id: string;
      }) {
        const rows = await callAsUser<Record<string, unknown>>(
          pool,
          uid,
          `SELECT * FROM public.subscribe_to_plan($1,$2,$3,$4,$5,$6,$7)`,
          [
            args.p_plan_code,
            args.p_interval,
            args.p_provider_subscription_id,
            args.p_provider_customer_id,
            args.p_cancel_at_period_end,
            args.p_status,
            args.p_user_id,
          ],
        );
        return rows[0] ?? null;
      }

      if (planCode === "free") {
        log("free_plan:subscribe_to_plan:start", { userId: user.id, planCode, interval });
        let subscription: unknown = null;
        try {
          subscription = await callSubscribeRpc({
            p_plan_code: "free",
            p_interval: interval,
            p_provider_subscription_id: null,
            p_provider_customer_id: null,
            p_cancel_at_period_end: false,
            p_status: "active",
            p_user_id: user.id,
          });
        } catch (subscribeError) {
          const message =
            subscribeError instanceof Error ? subscribeError.message : String(subscribeError);
          log("free_plan:subscribe_to_plan:result", { subscription, subscribeError: message });
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        log("free_plan:subscribe_to_plan:result", { subscription, subscribeError: null });
        return new Response(
          JSON.stringify({ mode: "direct", plan: planCode, interval, subscription }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (planCode === "otl") {
        const productId = plan?.stripe_otl_price_id;

        if (!productId) {
          return new Response(
            JSON.stringify({ error: "Missing OTL product id for this plan" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (!polarAccessToken) {
          return new Response(
            JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const checkoutPayload = {
          products: [productId],
          success_url: `${appUrl}/billing/success?checkout_id={CHECKOUT_ID}`,
          return_url: `${appUrl}/billing`,
          allow_discount_codes: true,
          external_customer_id: user.id,
          metadata: {
            supabase_user_id: user.id,
            plan_code: "otl",
            type: "otl",
            updates_months: 12,
          },
        };

        log("polar:otl_checkout_payload", checkoutPayload);

        const checkout = await polarRequest<{ id: string; url: string }>(
          polarAccessToken,
          "/checkouts",
          "POST",
          checkoutPayload,
        );

        log("polar:otl_checkout_created", checkout);

        return new Response(
          JSON.stringify({
            mode: "checkout",
            plan: "otl",
            interval: null,
            checkoutUrl: checkout.url,
            checkoutSessionId: checkout.id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!polarAccessToken) {
        return new Response(JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productId =
        interval === "year" ? plan.stripe_yearly_price_id : plan.stripe_monthly_price_id;

      log("polar:product_resolution", {
        planCode,
        interval,
        productId,
        stripeMonthlyPriceId: plan.stripe_monthly_price_id ?? null,
        stripeYearlyPriceId: plan.stripe_yearly_price_id ?? null,
      });

      if (!productId) {
        return new Response(
          JSON.stringify({ error: `Missing product id for ${planCode}/${interval}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (existingSubscription && ["active", "past_due"].includes(existingSubscription.status)) {
        if (existingSubscription.plan === planCode) {
          return new Response(
            JSON.stringify({ error: "You already have an active subscription." }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        if (existingSubscription.stripe_subscription_id && existingSubscription.plan !== "otl") {
          log("polar:subscription_upgrade", {
            fromPlan: existingSubscription.plan,
            toPlan: planCode,
            subscriptionId: existingSubscription.stripe_subscription_id,
            productId,
          });

          const updated = await polarRequest<Record<string, unknown>>(
            polarAccessToken,
            `/subscriptions/${existingSubscription.stripe_subscription_id}`,
            "PATCH",
            { product_id: productId },
          );

          const customerId =
            (updated.customer_id as string | undefined) ??
            ((updated.customer as Record<string, unknown> | undefined)?.id as
              | string
              | undefined) ??
            null;

          let portalUrl: string | null = null;
          if (customerId) {
            try {
              const session = await polarRequest<{ customer_portal_url: string }>(
                polarAccessToken,
                "/customer-sessions",
                "POST",
                { customer_id: customerId, return_url: `${appUrl}/billing` },
              );
              portalUrl = session.customer_portal_url ?? null;
            } catch (portalErr) {
              log("polar:portal_session_failed", {
                customerId,
                error: portalErr instanceof Error ? portalErr.message : String(portalErr),
              });
            }
          }

          return new Response(
            JSON.stringify({
              mode: "upgrade",
              plan: planCode,
              interval,
              subscription: updated,
              portalUrl,
              checkoutUrl: portalUrl ?? null,
              checkoutSessionId: (updated.id as string | undefined) ?? null,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const checkoutPayload = {
        products: [productId],
        success_url: `${appUrl}/billing/success?checkout_id={CHECKOUT_ID}`,
        return_url: `${appUrl}/billing`,
        allow_discount_codes: true,
        external_customer_id: user.id,
        metadata: {
          supabase_user_id: user.id,
          plan_code: planCode,
          interval,
        },
      };

      log("polar:checkout_payload", checkoutPayload);

      const checkout = await polarRequest<{ id: string; url: string }>(
        polarAccessToken,
        "/checkouts",
        "POST",
        checkoutPayload,
      );

      log("polar:checkout_created", checkout);

      return new Response(
        JSON.stringify({
          mode: "checkout",
          plan: planCode,
          interval,
          checkoutUrl: checkout.url,
          checkoutSessionId: checkout.id,
        }),
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
