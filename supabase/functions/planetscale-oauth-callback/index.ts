// Handles two jobs on one endpoint, both unauthenticated (no Supabase JWT —
// deploy with --no-verify-jwt):
//   1. GET ?code=...&state=<session_id>   — PlanetScale's OAuth redirect lands
//      here. Exchanges the code for a token pair and parks it in the
//      planetscale_oauth_sessions table under the session id for a few
//      minutes (Supabase's Edge Runtime doesn't support Deno.openKv(), so a
//      plain table stands in for what would otherwise be a short-TTL KV
//      entry — see supabase/migrations/20260829_planetscale_oauth_sessions.sql).
//   2. GET ?session=<session_id>          — the desktop app polls this to
//      pick up the token pair once step 1 has completed. Single-use: the row
//      is deleted the moment it's read.
//
// The client_secret never leaves this function — see lib/planetscale/auth.ts
// for the app side of this pairing flow.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

// Shows shape/length without leaking the actual secret into logs.
function mask(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return String(value);
  if (value.length <= 12) return `${value.slice(0, 2)}...(${value.length})`;
  return `${value.slice(0, 6)}...${value.slice(-4)}(${value.length})`;
}

// Must match the scope string requested at /oauth/authorize
// (lib/planetscale/auth.ts).
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

function adminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const pollSession = url.searchParams.get("session");

  const admin = adminClient();
  if (!admin) {
    log("env:missing_supabase_creds", {});
    return html("Server is misconfigured.", 500);
  }

  // Best-effort sweep of stale sessions on every hit — cheap, and keeps the
  // table from accumulating rows nobody ever polled for.
  void admin
    .from("planetscale_oauth_sessions")
    .delete()
    .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  try {
    // Poll branch: the app asking "is my login done yet?"
    if (!code && pollSession) {
      const { data, error } = await admin
        .from("planetscale_oauth_sessions")
        .select("access_token, refresh_token, expires_at")
        .eq("session_id", pollSession)
        .maybeSingle();

      if (error) {
        log("session:select_error", { message: error.message });
        return json({ status: "pending" });
      }
      if (!data) {
        return json({ status: "pending" });
      }

      await admin.from("planetscale_oauth_sessions").delete().eq("session_id", pollSession);
      return json({
        status: "complete",
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
      });
    }

    // Error branch: PlanetScale redirected back with an error instead of a code.
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      log("oauth:error", { oauthError, description: url.searchParams.get("error_description") });
      return html(`Login failed: ${oauthError}. You can close this tab and try again.`, 400);
    }

    if (!code || !state) {
      return json({ error: "Missing code or state" }, 400);
    }

    const clientId = Deno.env.get("PLANETSCALE_CLIENT_ID");
    const clientSecret = Deno.env.get("PLANETSCALE_CLIENT_SECRET");
    const redirectUri = Deno.env.get("PLANETSCALE_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      log("env:missing", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRedirectUri: !!redirectUri,
      });
      return html("Server is missing PlanetScale OAuth configuration.", 500);
    }

    // Authorize lives on app.planetscale.com, but the token API is still on
    // auth.planetscale.com. Posting to app.planetscale.com/oauth/token 307s to
    // the sign-in page; fetch follows it and PlanetScale returns 406.
    // Params go in the query string per PlanetScale's OAuth docs.
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
      tokenBody = tokenText ? JSON.parse(tokenText) : null;
    } catch {
      tokenBody = null;
    }

    log("token:exchange_result", {
      ok: tokenRes.ok,
      status: tokenRes.status,
      contentType: tokenRes.headers.get("content-type"),
      requestedScope: SCOPES,
      responseKeys: tokenBody ? Object.keys(tokenBody) : null,
      token_type: tokenBody?.token_type,
      scope: tokenBody?.scope,
      expires_in: tokenBody?.expires_in,
      access_token: mask(tokenBody?.access_token),
      refresh_token: mask(tokenBody?.refresh_token),
      error: tokenBody?.error,
      error_description: tokenBody?.error_description,
      rawSnippet: tokenRes.ok ? undefined : tokenText.slice(0, 300),
    });

    if (
      !tokenRes.ok ||
      typeof tokenBody?.access_token !== "string" ||
      typeof tokenBody?.refresh_token !== "string"
    ) {
      return html(
        `Login failed (${tokenRes.status}). You can close this tab and try again.`,
        502,
      );
    }

    const expiresAt = new Date(
      Date.now() + (Number(tokenBody.expires_in) || 3600) * 1000,
    ).toISOString();

    const { error: upsertError } = await admin.from("planetscale_oauth_sessions").upsert({
      session_id: state,
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token,
      expires_at: expiresAt,
    });

    if (upsertError) {
      log("session:upsert_error", { message: upsertError.message });
      return html("Something went wrong. You can close this tab and try again.", 500);
    }

    return html("Logged in to PlanetScale. You can close this tab and go back to RexaDB.");
  } catch (error) {
    log("request:unhandled_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return html("Something went wrong. You can close this tab and try again.", 500);
  }
});
