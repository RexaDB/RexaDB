import { makePool, verifySupabaseUser } from "../_shared/auth";
import { corsHeaders } from "../_shared/cors";

const pool = makePool();

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      log("options:handled");
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      log("method:not_allowed", { method: req.method });
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("request:received", { url: req.url });

    try {
      const user = await verifySupabaseUser(req.headers.get("Authorization"));
      log("auth:get_user_result", {
        hasUser: !!user,
        userId: user?.id ?? null,
      });

      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let body: { code: string };
      try {
        body = (await req.json()) as { code: string };
        log("request:body_parsed", { hasCode: !!body.code });
      } catch {
        log("request:invalid_json", { body: await req.text().catch(() => null) });
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!body.code || typeof body.code !== "string" || !body.code.trim()) {
        log("request:missing_code", { code: body.code });
        return new Response(JSON.stringify({ error: "Missing gift code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const normalized = body.code.trim().toUpperCase();
      log("rpc:calling", { code: normalized });

      // NOTE: gift_codes tables do not exist upstream either; this RPC fails
      // identically on Supabase. Kept for parity.
      let subscription: { plan?: string } | null = null;
      try {
        const { rows } = await pool.query(
          `SELECT * FROM public.redeem_gift_code($1)`,
          [normalized],
        );
        subscription = (rows[0] as { plan?: string } | undefined) ?? null;
      } catch (rpcError) {
        const message =
          rpcError instanceof Error ? rpcError.message : String(rpcError);
        log("rpc:result", { hasData: false, plan: null, redeemError: message });
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log("rpc:result", {
        hasData: !!subscription,
        plan: subscription?.plan ?? null,
      });

      return new Response(
        JSON.stringify({ plan: subscription?.plan, subscription }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
