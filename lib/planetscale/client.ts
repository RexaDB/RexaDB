import { API_BASE } from "@/lib/api-base";
import {
  getPlanetscaleAccounts,
  updatePlanetscaleAccountTokens,
  type PlanetscaleAccount,
} from "./token-store";

// Route through the sidecar proxy: PlanetScale's API does not send
// `Access-Control-Allow-Origin`, so direct browser/webview fetches are
// blocked by CORS. The sidecar just forwards the request untouched.
function apiBase(): string {
  return `${API_BASE}/api/planetscale/proxy/v1`;
}

function refreshFunctionUrl(): string {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  return `${supabaseUrl}/functions/v1/planetscale-oauth-refresh`;
}

export interface PlanetscaleOrganization {
  name: string;
  id?: string;
}

export interface PlanetscaleDatabase {
  name: string;
  kind?: string; // "mysql" | "postgresql" (field name unconfirmed — verify against a live response)
  region?: { slug?: string } | string;
  plan?: string;
  branches_count?: number;
}

export interface PlanetscaleBranch {
  name: string;
  production?: boolean;
}

export interface PlanetscalePassword {
  id: string;
  username: string;
  plain_text: string;
  access_host_url: string;
  role?: string;
}

async function refreshAccount(account: PlanetscaleAccount): Promise<PlanetscaleAccount> {
  const res = await fetch(refreshFunctionUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: account.refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`PlanetScale token refresh failed (${res.status})`);
  }
  const body = await res.json();
  updatePlanetscaleAccountTokens(account.id, {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
  });
  return { ...account, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at };
}

function mask(value: string): string {
  if (!value) return String(value);
  if (value.length <= 12) return `${value.slice(0, 2)}...(${value.length})`;
  return `${value.slice(0, 6)}...${value.slice(-4)}(${value.length})`;
}

async function request<T>(accountId: string, path: string, opts?: RequestInit): Promise<T> {
  let account = getPlanetscaleAccounts().find((a) => a.id === accountId);
  if (!account) throw new Error("PlanetScale account not found");

  const doFetch = (token: string) =>
    fetch(`${apiBase()}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(opts?.headers ?? {}),
      },
    });

  console.log("[planetscale]", "request", {
    url: `${apiBase()}${path}`,
    method: opts?.method ?? "GET",
    accountId,
    accessToken: mask(account.accessToken),
    expiresAt: account.expiresAt,
  });

  let res = await doFetch(account.accessToken);
  console.log("[planetscale]", "response", { path, status: res.status, ok: res.ok });

  if (res.status === 401) {
    console.log("[planetscale]", "got 401, refreshing token", { accountId });
    account = await refreshAccount(account);
    console.log("[planetscale]", "refreshed, retrying", {
      accessToken: mask(account.accessToken),
      expiresAt: account.expiresAt,
    });
    res = await doFetch(account.accessToken);
    console.log("[planetscale]", "retry response", { path, status: res.status, ok: res.ok });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    console.log("[planetscale]", "request failed", { path, status: res.status, body: text });
    throw new Error(`PlanetScale API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function listOrganizations(accountId: string): Promise<PlanetscaleOrganization[]> {
  const body = await request<{ data: PlanetscaleOrganization[] }>(accountId, "/organizations");
  return body.data ?? [];
}

export async function listDatabases(
  accountId: string,
  org: string,
): Promise<PlanetscaleDatabase[]> {
  const body = await request<{ data: PlanetscaleDatabase[] }>(
    accountId,
    `/organizations/${encodeURIComponent(org)}/databases`,
  );
  return body.data ?? [];
}

export async function listBranches(
  accountId: string,
  org: string,
  database: string,
): Promise<PlanetscaleBranch[]> {
  const body = await request<{ data: PlanetscaleBranch[] }>(
    accountId,
    `/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(database)}/branches`,
  );
  return body.data ?? [];
}

export async function createBranchPassword(
  accountId: string,
  org: string,
  database: string,
  branch: string,
): Promise<PlanetscalePassword> {
  return request<PlanetscalePassword>(
    accountId,
    `/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(database)}/branches/${encodeURIComponent(branch)}/passwords`,
    {
      method: "POST",
      body: JSON.stringify({ name: "rexadb", role: "admin" }),
    },
  );
}
