import { makePool, verifySupabaseUser } from "../_shared/auth";
import { corsHeaders } from "../_shared/cors";
import { polarRequest } from "../_shared/polar";

const pool = makePool();

export default {
  async fetch(req: Request): Promise<Response> {
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
      const appUrl =
        process.env.APP_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
      const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;

      const user = await verifySupabaseUser(req.headers.get("Authorization"));
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!polarAccessToken) {
        return new Response(
          JSON.stringify({ error: "Missing POLAR_ACCESS_TOKEN" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { rows } = await pool.query<{ provider_customer_id: string | null }>(
        `SELECT provider_customer_id FROM public.billing_customers
         WHERE provider = 'polar' AND user_id = $1 LIMIT 1`,
        [user.id],
      );
      const customerId = rows[0]?.provider_customer_id ?? null;

      if (!customerId) {
        return new Response(
          JSON.stringify({ error: "Polar customer not found" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const session = await polarRequest<{ customer_portal_url: string }>(
        polarAccessToken,
        "/customer-sessions",
        "POST",
        { customer_id: customerId, return_url: `${appUrl}/billing` },
      );

      return new Response(JSON.stringify({ portalUrl: session.customer_portal_url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
