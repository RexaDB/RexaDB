// Unauthenticated (no Supabase JWT — deploy with --no-verify-jwt). Exchanges
// a stored PlanetScale refresh_token for a fresh access/refresh token pair.
// Called by lib/planetscale/client.ts whenever a stored access token has
// expired; the client_secret never leaves this function.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

function mask(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return String(value);
  if (value.length <= 12) return `${value.slice(0, 2)}...(${value.length})`;
  return `${value.slice(0, 6)}...${value.slice(-4)}(${value.length})`;
}

// Must match the scope string in planetscale-oauth-callback/index.ts and
// lib/planetscale/auth.ts.
const SCOPES = [
  "read_user",
  "read_organizations",
  "read_organization",
  "read_databases",
  "read_branches",
  "manage_passwords",
  "manage_production_branch_passwords",
].join(" ");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    const refreshToken = body?.refresh_token;
    if (!refreshToken || typeof refreshToken !== "string") {
      return json({ error: "Missing refresh_token" }, 400);
    }

    const clientId = Deno.env.get("PLANETSCALE_CLIENT_ID");
    const clientSecret = Deno.env.get("PLANETSCALE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      log("env:missing", { hasClientId: !!clientId, hasClientSecret: !!clientSecret });
      return json({ error: "Server is missing PlanetScale OAuth configuration" }, 500);
    }

    // Token API stays on auth.planetscale.com (app.planetscale.com/oauth/token
    // is the web app and 307s to sign-in). Params in the query string.
    const tokenUrl = new URL("https://auth.planetscale.com/oauth/token");
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("refresh_token", refreshToken);
    tokenUrl.searchParams.set("grant_type", "refresh_token");

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

    log("token:refresh_result", {
      ok: tokenRes.ok,
      status: tokenRes.status,
      contentType: tokenRes.headers.get("content-type"),
      responseKeys: tokenBody ? Object.keys(tokenBody) : null,
      token_type: tokenBody?.token_type,
      scope: tokenBody?.scope,
      access_token: mask(tokenBody?.access_token),
      refresh_token: mask(tokenBody?.refresh_token),
      error: tokenBody?.error,
      error_description: tokenBody?.error_description,
      rawSnippet: tokenRes.ok ? undefined : tokenText.slice(0, 300),
      // SCOPES kept in this file only so it stays in sync with authorize/callback.
      requestedScope: SCOPES,
    });

    if (!tokenRes.ok || !tokenBody?.access_token) {
      return json({ error: `Refresh failed (${tokenRes.status})` }, 502);
    }

    const expiresAt = new Date(
      Date.now() + (Number(tokenBody.expires_in) || 3600) * 1000,
    ).toISOString();

    return json({
      access_token: String(tokenBody.access_token),
      refresh_token:
        typeof tokenBody.refresh_token === "string"
          ? tokenBody.refresh_token
          : refreshToken,
      expires_at: expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("request:unhandled_error", { message });
    return json({ error: message }, 500);
  }
});
