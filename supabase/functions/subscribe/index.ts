import { corsHeaders } from "../_shared/cors.ts";
import { resolvePolarBaseUrl, polarRequest } from "../_shared/polar-utils.ts";
import {
  handleCorsOrMethod,
  loadSupabaseEnv,
  missingEnvResponse,
  missingAuthResponse,
  unauthorizedResponse,
  createClients,
  getAuthUser,
} from "../_shared/supabase-handler.ts";

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

Deno.serve(async (req) => {
  log("request:received", {
    method: req.method,
    url: req.url,
  });

  const corsOrMethod = handleCorsOrMethod(req);
  if (corsOrMethod) return corsOrMethod;

  try {
    const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, polarAccessToken, appUrl } =
      loadSupabaseEnv();

    log("env:loaded", {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseAnonKey: !!supabaseAnonKey,
      hasSupabaseServiceRoleKey: !!supabaseServiceRoleKey,
      hasPolarAccessToken: !!polarAccessToken,
      appUrl,
      polarBaseUrl: resolvePolarBaseUrl(),
      polarEnv: Deno.env.get("POLAR_ENV") ?? "production",
    });

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return missingEnvResponse();
    }

    const authHeader = req.headers.get("Authorization");

    log("auth:header_present", { hasAuthHeader: !!authHeader });

    if (!authHeader) return missingAuthResponse();

    const { supabase, admin } = createClients(supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, authHeader);

    const user = await getAuthUser(supabase);

    log("auth:get_user_result", {
      hasUser: !!user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      userError: !user ? "User not found" : null,
    });

    if (!user) return unauthorizedResponse();

    // Ensure profile exists for FK consistency (billing_customers -> profiles).
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id,email")
      .eq("id", user.id)
      .maybeSingle();

    log("db:profile_lookup", {
      userId: user.id,
      found: !!existingProfile,
      profileLookupError: profileLookupError?.message ?? null,
    });

    if (!existingProfile) {
      const profileEmail =
        user.email ?? (user.user_metadata as { email?: string } | null)?.email ?? null;

      if (!profileEmail) {
        return new Response(JSON.stringify({ error: "Missing user email for profile creation" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: profileInsertError } = await admin.from("profiles").insert({
        id: user.id,
        email: profileEmail,
        full_name: null,
      });

      log("db:profile_insert", {
        userId: user.id,
        profileEmail,
        profileInsertError: profileInsertError?.message ?? null,
      });

      if (profileInsertError && profileInsertError.code !== "23505") {
        return new Response(JSON.stringify({ error: profileInsertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let body: SubscribeBody;
    try {
      body = (await req.json()) as SubscribeBody;
      log("request:body_parsed", body);
    } catch (parseErr) {
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

    const { data: plan, error: planError } = await admin
      .from("subscription_plans")
      .select(
        `
          code,
          name,
          is_active,
          stripe_monthly_price_id,
          stripe_yearly_price_id,
          stripe_otl_price_id,
          monthly_price_cents,
          yearly_price_cents
        `
      )
      .eq("code", planCode)
      .single();

    log("db:plan_lookup", {
      planCode,
      found: !!plan,
      planError: planError?.message ?? null,
      plan,
    });

    if (planError || !plan || !plan.is_active) {
      return new Response(JSON.stringify({ error: "Plan not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingSubscription, error: existingSubError } = await admin
      .from("user_subscriptions")
      .select("plan,status,stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    log("db:existing_subscription", {
      userId: user.id,
      existingSubscription,
      existingSubError: existingSubError?.message ?? null,
    });

    if (planCode === "free") {
      log("free_plan:subscribe_to_plan:start", {
        userId: user.id,
        planCode,
        interval,
      });

      const { data: subscription, error: subscribeError } = await admin.rpc(
        "subscribe_to_plan",
        {
          p_plan_code: "free",
          p_interval: interval,
          p_provider_subscription_id: null,
          p_provider_customer_id: null,
          p_cancel_at_period_end: false,
          p_status: "active",
          p_user_id: user.id,
        },
      );

      log("free_plan:subscribe_to_plan:result", {
        subscription,
        subscribeError: subscribeError?.message ?? null,
      });

      if (subscribeError) {
        return new Response(JSON.stringify({ error: subscribeError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ mode: "direct", plan: planCode, interval, subscription }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (planCode === "otl") {
      const productId = plan?.stripe_otl_price_id;

      if (!productId) {
        return new Response(
          JSON.stringify({ error: "Missing OTL product id for this plan" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!polarAccessToken) {
        return new Response(
          JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!polarAccessToken) {
      return new Response(JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // YES, these are named stripe_* in DB, but currently hold Polar product IDs.
    const productId =
      interval === "year"
        ? plan.stripe_yearly_price_id
        : plan.stripe_monthly_price_id;

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
        return new Response(JSON.stringify({ error: "You already have an active subscription." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (existingSubscription.stripe_subscription_id) {
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

        const customerId = (updated.customer_id as string | undefined)
          ?? ((updated.customer as Record<string, unknown> | undefined)?.id as string | undefined)
          ?? null;

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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
});
