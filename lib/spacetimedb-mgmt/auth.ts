import { API_BASE } from "@/lib/api-base";

// Reverse-engineered from the open-source SpacetimeDB CLI
// (crates/cli/src/subcommands/login.rs in clockworklabs/SpacetimeDB).
// The CLI logs in against spacetimedb.com; the resulting SpacetimeDB JWT is
// validated by any SpacetimeDB server (local, maincloud, or self-hosted).
export const SPACETIMEDB_AUTH_HOST = "spacetimedb.com";

const PROXY = `${API_BASE}/api/spacetimedb-mgmt/proxy`;

export interface SpacetimeDbLoginSession {
  requestToken: string;
  loginUrl: string;
  pollStatus: (timeoutMs?: number, signal?: AbortSignal) => Promise<string>;
}

interface RequestTokenResponse {
  success: boolean;
  data?: { token?: string } | null;
  error?: string | Record<string, unknown> | null;
}

interface StatusResponse {
  success: boolean;
  error?: string | Record<string, unknown> | null;
  data?: {
    approved?: boolean;
    sessionToken?: string | null;
  } | null;
}

interface SpacetimeTokenResponse {
  success: boolean;
  data?: { token?: string } | null;
  error?: string | Record<string, unknown> | null;
}

function fmtError(error: string | Record<string, unknown> | null | undefined): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") return JSON.stringify(error);
  return "Unknown error";
}

class LoginRejectedError extends Error {}

async function proxyFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`SpacetimeDB request failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function createSpacetimeDbLoginSession(): Promise<SpacetimeDbLoginSession> {
  const response = await proxyFetch<RequestTokenResponse>(
    `/api/auth/cli/login/request-token?host=${SPACETIMEDB_AUTH_HOST}`,
    { method: "POST" },
  );
  if (!response.success || !response.data?.token) {
    throw new Error(fmtError(response.error) || "Failed to request SpacetimeDB login token");
  }
  const requestToken = response.data.token;
  const loginUrl = `https://${SPACETIMEDB_AUTH_HOST}/login/cli?token=${encodeURIComponent(requestToken)}`;

  const pollStatus = async (
    timeoutMs = 180000,
    signal?: AbortSignal,
  ): Promise<string> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const status = await proxyFetch<StatusResponse>(
          `/api/auth/cli/status?host=${SPACETIMEDB_AUTH_HOST}&token=${encodeURIComponent(requestToken)}`,
        );
        if (!status.success) {
          throw new LoginRejectedError(
            fmtError(status.error) || "SpacetimeDB login failed",
          );
        }
        if (status.data?.approved && status.data.sessionToken) {
          return await exchangeForSpacetimeToken(status.data.sessionToken);
        }
      } catch (err) {
        if (err instanceof LoginRejectedError) throw err;
        // Transient network hiccup — keep polling like the CLI does.
      }
    }
    throw new Error("Login timed out. Please try again.");
  };

  return { requestToken, loginUrl, pollStatus };
}

async function exchangeForSpacetimeToken(
  sessionToken: string,
): Promise<string> {
  const response = await proxyFetch<SpacetimeTokenResponse>(
    `/api/spacetimedb-token?host=${SPACETIMEDB_AUTH_HOST}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    },
  );
  if (!response.success || !response.data?.token) {
    throw new Error(fmtError(response.error) || "SpacetimeDB token exchange failed");
  }
  return response.data.token;
}