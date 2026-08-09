import { corsHeaders } from "../_shared/cors.ts";
import { polarRequest } from "../_shared/polar-utils.ts";
import {
  handleCorsOrMethod,
  loadSupabaseEnv,
  missingEnvResponse,
  missingAuthResponse,
  unauthorizedResponse,
  createClients,
  getAuthUser,
} from "../_shared/supabase-handler.ts";

Deno.serve(async (req) => {
  const corsOrMethod = handleCorsOrMethod(req);
  if (corsOrMethod) return corsOrMethod;

  try {
    const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, polarAccessToken, appUrl } =
      loadSupabaseEnv();

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return missingEnvResponse();
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return missingAuthResponse();

    const { supabase, admin } = createClients(supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, authHeader);

    const user = await getAuthUser(supabase);
    if (!user) return unauthorizedResponse();

    if (!polarAccessToken) {
      return new Response(JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: customerRow } = await admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("provider", "polar")
      .eq("user_id", user.id)
      .maybeSingle();

    const customerId = customerRow?.provider_customer_id ?? null;

    if (!customerId) {
      return new Response(JSON.stringify({ error: "Polar customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await polarRequest<{ customer_portal_url: string }>(
      polarAccessToken,
      "/customer-sessions",
      "POST",
      {
        customer_id: customerId,
        return_url: `${appUrl}/billing`,
      },
    );

    return new Response(
      JSON.stringify({ portalUrl: session.customer_portal_url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
