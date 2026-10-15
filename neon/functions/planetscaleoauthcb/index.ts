import { makePool } from "../_shared/auth";

const pool = makePool();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

function mask(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return String(value);
  if (value.length <= 12) return `${value.slice(0, 2)}...(${value.length})`;
  return `${value.slice(0, 6)}...${value.slice(-4)}(${value.length})`;
}

const SCOPES = [
  "read_user",
  "read_organizations",
  "read_organization",
  "read_databases",
  "read_branches",
  "manage_passwords",
  "manage_production_branch_passwords",
].join(" ");

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>PlanetScale</title>
<style>body{font:15px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0b0c;color:#eee}</style>
</head><body><p>${body}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const pollSession = url.searchParams.get("session");

    // Best-effort sweep of stale sessions on every hit.
    try {
      await pool.query(
        `DELETE FROM public.planetscale_oauth_sessions WHERE created_at < now() - interval '10 minutes'`,
      );
    } catch {
      /* ignore sweep failures */
    }

    try {
      if (!code && pollSession) {
        const { rows } = await pool.query<{
          access_token: string;
          refresh_token: string;
          expires_at: string;
        }>(
          `SELECT access_token, refresh_token, expires_at
           FROM public.planetscale_oauth_sessions WHERE session_id = $1 LIMIT 1`,
          [pollSession],
        );
        const data = rows[0] ?? null;
        if (!data) {
          return json({ status: "pending" });
        }
        await pool.query(
          `DELETE FROM public.planetscale_oauth_sessions WHERE session_id = $1`,
          [pollSession],
        );
        return json({
          status: "complete",
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
        });
      }

      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        log("oauth:error", {
          oauthError,
          description: url.searchParams.get("error_description"),
        });
        return html(
          "Login failed. You can close this tab and try again.",
          400,
        );
      }

      if (!code || !state) {
        return json({ error: "Missing code or state" }, 400);
      }

      const clientId = process.env.PLANETSCALE_CLIENT_ID;
      const clientSecret = process.env.PLANETSCALE_CLIENT_SECRET;
      const redirectUri = process.env.PLANETSCALE_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        log("env:missing", {
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          hasRedirectUri: !!redirectUri,
        });
        return html("Server is missing PlanetScale OAuth configuration.", 500);
      }

      const tokenUrl = new URL("https://auth.planetscale.com/oauth/token");
      tokenUrl.searchParams.set("client_id", clientId);
      tokenUrl.searchParams.set("client_secret", clientSecret);
      tokenUrl.searchParams.set("code", code);
      tokenUrl.searchParams.set("grant_type", "authorization_code");
      tokenUrl.searchParams.set("redirect_uri", redirectUri);

      const tokenRes = await fetch(tokenUrl.toString(), {
        method: "POST",
        redirect: "manual",
      });

      const tokenText = await tokenRes.text();
      let tokenBody: Record<string, unknown> | null = null;
      try {
        tokenBody = tokenText ? (JSON.parse(tokenText) as Record<string, unknown>) : null;
      } catch {
        tokenBody = null;
      }

      log("token:exchange_result", {
        ok: tokenRes.ok,
        status: tokenRes.status,
        contentType: tokenRes.headers.get("content-type"),
        requestedScope: SCOPES,
        access_token: mask(tokenBody?.access_token),
        refresh_token: mask(tokenBody?.refresh_token),
        error: tokenBody?.error,
        error_description: tokenBody?.error_description,
      });

      if (!tokenRes.ok || !tokenBody?.access_token) {
        return html(
          `Login failed (${tokenRes.status}). You can close this tab and try again.`,
          502,
        );
      }

      const expiresAt = new Date(
        Date.now() + (Number(tokenBody.expires_in) || 3600) * 1000,
      ).toISOString();

      try {
        await pool.query(
          `INSERT INTO public.planetscale_oauth_sessions
             (session_id, access_token, refresh_token, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id) DO UPDATE SET
             access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at`,
          [
            state,
            String(tokenBody.access_token),
            String(tokenBody.refresh_token ?? ""),
            expiresAt,
          ],
        );
      } catch (upsertError) {
        log("session:upsert_error", {
          message: upsertError instanceof Error ? upsertError.message : String(upsertError),
        });
        return html("Something went wrong. You can close this tab and try again.", 500);
      }

      return html("Logged in to PlanetScale. You can close this tab and go back to RexaDB.");
    } catch (error) {
      log("request:unhandled_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return html("Something went wrong. You can close this tab and try again.", 500);
    }
  },
};
