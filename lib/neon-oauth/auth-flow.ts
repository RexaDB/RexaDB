// Server-only. Public-client PKCE OAuth against oauth2.neon.tech using the
// same client_id ("neonctl") and scopes as the official Neon CLI — no neonctl
// binary required. Starts a one-shot 127.0.0.1 callback server, opens the
// authorize URL, exchanges the code, and persists credentials.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  NEON_AUTH_TIMEOUT_MS,
  NEON_OAUTH_CLIENT_ID,
  NEON_OAUTH_HOST,
  NEON_OAUTH_SCOPES,
} from "./constants";
import {
  writeCredentials,
  type NeonOAuthCredentials,
} from "./credentials";

export interface NeonOidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  userinfo_endpoint?: string;
}

export interface NeonAuthFlowHandle {
  authUrl: string;
  /** Resolves with saved credentials once the browser callback completes. */
  result: Promise<NeonOAuthCredentials>;
  /** Abort the local callback server and reject the pending promise. */
  cancel: () => void;
}

/**
 * The IdP definitively rejected the refresh token (revoked, rotated away,
 * expired grant) — the stored session is dead and the user must re-authenticate.
 */
export class NeonRefreshRejectionError extends Error {}

/**
 * The refresh request itself failed for a transient reason (no network, VPN
 * drop, timeout, 5xx). The stored refresh token is untouched and still valid;
 * callers must NOT treat this as an expired session.
 */
export class NeonRefreshUnavailableError extends Error {}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomState(): string {
  return base64Url(randomBytes(16));
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

let cachedDiscovery: NeonOidcDiscovery | null = null;

export async function discoverOidc(oauthHost = NEON_OAUTH_HOST): Promise<NeonOidcDiscovery> {
  if (cachedDiscovery && oauthHost === NEON_OAUTH_HOST) return cachedDiscovery;
  const res = await fetch(`${oauthHost.replace(/\/+$/, "")}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Neon OAuth discovery failed (${res.status})`);
  }
  const json = (await res.json()) as NeonOidcDiscovery;
  if (!json.authorization_endpoint || !json.token_endpoint) {
    throw new Error("Neon OAuth discovery response was missing endpoints");
  }
  if (oauthHost === NEON_OAUTH_HOST) cachedDiscovery = json;
  return json;
}

function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

function successHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Neon</title>
    <style>
      body, html {
        width: 100%; height: 100%; margin: 0; text-align: center;
        font-family: 'Open Sans', system-ui, sans-serif;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        background: #fff; color: #2d374c;
      }
      @media (prefers-color-scheme: dark) {
        body, html { background: #191919; color: #bfbfbf; }
      }
      h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { margin: 0; opacity: 0.8; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <h1>Signed in to Neon</h1>
    <p>You can close this tab and return to RexaDB.</p>
  </body>
</html>`;
}

function errorHtml(message: string): string {
  const safe = message.replace(/[<>&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Neon</title></head>
<body style="font-family:system-ui;padding:2rem;text-align:center">
  <h1>Sign-in failed</h1><p>${safe}</p>
</body></html>`;
}

async function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<NeonOAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: NEON_OAUTH_CLIENT_ID,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(opts.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Token exchange returned non-JSON");
  }
  const access = typeof json.access_token === "string" ? json.access_token : "";
  if (!access) throw new Error("Token exchange missing access_token");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    access_token: access,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    id_token: typeof json.id_token === "string" ? json.id_token : undefined,
    token_type: typeof json.token_type === "string" ? json.token_type : "bearer",
    scope: typeof json.scope === "string" ? json.scope : NEON_OAUTH_SCOPES.join(" "),
    expires_in: expiresIn,
    expires_at: Date.now() + expiresIn * 1000,
    type: "oauth",
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  oauthHost = NEON_OAUTH_HOST,
): Promise<NeonOAuthCredentials> {
  let discovery: NeonOidcDiscovery;
  try {
    discovery = await discoverOidc(oauthHost);
  } catch (err) {
    throw new NeonRefreshUnavailableError(
      `OIDC discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: NEON_OAUTH_CLIENT_ID,
  });
  let res: Response;
  let text: string;
  try {
    res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    text = await res.text();
  } catch (err) {
    throw new NeonRefreshUnavailableError(
      `Token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const message = `Token refresh failed (${res.status}): ${text.slice(0, 300)}`;
    // 400 invalid_grant / 401 / 403 mean the token itself is rejected forever;
    // anything else (5xx, throttling) is worth retrying later.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new NeonRefreshRejectionError(message);
    }
    throw new NeonRefreshUnavailableError(message);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new NeonRefreshUnavailableError("Token refresh returned non-JSON");
  }
  const access = typeof json.access_token === "string" ? json.access_token : "";
  if (!access) throw new NeonRefreshUnavailableError("Token refresh missing access_token");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    access_token: access,
    refresh_token:
      typeof json.refresh_token === "string" ? json.refresh_token : refreshToken,
    id_token: typeof json.id_token === "string" ? json.id_token : undefined,
    token_type: typeof json.token_type === "string" ? json.token_type : "bearer",
    scope: typeof json.scope === "string" ? json.scope : undefined,
    expires_in: expiresIn,
    expires_at: Date.now() + expiresIn * 1000,
    type: "oauth",
  };
}

/**
 * Starts a localhost PKCE login for `profile`. Resolves after the browser
 * callback writes credentials. Call `cancel()` if the UI aborts.
 */
export async function startNeonAuthFlow(opts: {
  profile: string;
  /** Force the IdP account picker (add-account / switch user). */
  forceLogin?: boolean;
}): Promise<NeonAuthFlowHandle> {
  const discovery = await discoverOidc();
  const { verifier, challenge } = pkcePair();
  const state = randomState();

  let server: Server | null = null;
  let settled = false;
  let rejectResult: ((err: Error) => void) | null = null;
  let resolveResult: ((creds: NeonOAuthCredentials) => void) | null = null;

  const result = new Promise<NeonOAuthCredentials>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const finishOk = (creds: NeonOAuthCredentials) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveResult?.(creds);
    try {
      server?.close();
    } catch {
      // ignore
    }
  };

  const finishErr = (err: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectResult?.(err);
    try {
      server?.close();
    } catch {
      // ignore
    }
  };

  const timer = setTimeout(() => {
    finishErr(new Error(`Authentication timed out after ${NEON_AUTH_TIMEOUT_MS / 1000} seconds`));
  }, NEON_AUTH_TIMEOUT_MS);

  server = createServer();

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    finishErr(new Error("Failed to bind Neon OAuth callback server"));
    throw new Error("Failed to bind Neon OAuth callback server");
  }
  const port = addr.port;
  const cbUri = redirectUri(port);

  const onRequest = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Content-Type",
        }).end();
        return;
      }

      const errParam = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      // OAuth error from the IdP itself. Only settle the flow when the state
      // matches — any same-address request without our state must be ignored,
      // not act as a kill switch for a pending sign-in.
      if (errParam && returnedState === state) {
        const desc = url.searchParams.get("error_description") || errParam;
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(errorHtml(desc));
        finishErr(new Error(desc));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code || !code.trim() || returnedState !== state) {
        // Unrelated request to the callback port: reject it for the sender but
        // leave the pending sign-in running.
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(
          errorHtml("Invalid OAuth callback (missing code or mismatched state)."),
        );
        return;
      }

      const creds = await exchangeCode({
        tokenEndpoint: discovery.token_endpoint,
        code,
        redirectUri: cbUri,
        codeVerifier: verifier,
      });
      if (settled) {
        // The login was cancelled/timed out while the code exchange was still
        // in flight. Never persist credentials for a flow the caller walked
        // away from — a newer attempt for the same profile may be in progress.
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(successHtml());
        return;
      }
      writeCredentials(opts.profile, creds);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(successHtml());
      finishOk(creds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      try {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(errorHtml(message));
      } catch {
        // response may already be closed
      }
      finishErr(err instanceof Error ? err : new Error(message));
    }
  };

  server.on("request", (req, res) => {
    void onRequest(req, res);
  });

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set("client_id", NEON_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", NEON_OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("redirect_uri", cbUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (opts.forceLogin) {
    authUrl.searchParams.set("prompt", "login");
  }

  return {
    authUrl: authUrl.toString(),
    result,
    cancel: () => finishErr(new Error("Sign-in cancelled")),
  };
}
