const AUTHORIZE_URL = "https://app.planetscale.com/oauth/authorize";

// PlanetScale OAuth login isn't ready to ship — keep it visible in dev only
// so it can keep being built against without exposing it in prod builds.
export const PLANETSCALE_LOGIN_ENABLED = process.env.NODE_ENV !== "production";

// Bare scope names — matches PlanetScale docs and what oauth/token/info
// returns. Namespaced forms (user:/organization:) are accepted at authorize
// but only the bare user scopes actually land on the token; org API calls
// then 403. Must stay in sync with the edge functions.
const SCOPES = [
  "read_user",
  "read_organizations",
  "read_organization",
  "read_databases",
  "read_branches",
  "manage_passwords",
  "manage_production_branch_passwords",
].join(" ");

function callbackFunctionUrl(): string {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  return `${supabaseUrl}/functions/v1/planetscale-oauth-callback`;
}

export interface PlanetscaleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export interface LoginSession {
  sessionId: string;
  url: string;
  /** Polls until the browser step completes, or throws after ~3 minutes. */
  waitForCompletion: () => Promise<PlanetscaleTokens>;
}

export async function createLoginSession(): Promise<LoginSession> {
  const clientId = process.env.NEXT_PUBLIC_PLANETSCALE_CLIENT_ID || "";
  const sessionId = crypto.randomUUID();

  const url =
    `${AUTHORIZE_URL}?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(callbackFunctionUrl())}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(sessionId)}`;

  const waitForCompletion = async (): Promise<PlanetscaleTokens> => {
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      const res = await fetch(`${callbackFunctionUrl()}?session=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const body = await res.json();
        if (body?.status === "complete") {
          return {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expires_at: body.expires_at,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Timed out waiting for PlanetScale login. Please try again.");
  };

  return { sessionId, url, waitForCompletion };
}
