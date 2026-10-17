// Server-only. Neon Management API client backed by OAuth credentials stored
// under ~/.config/neon — same shape neonctl uses, without spawning neonctl.
import { NEON_API_HOST } from "./constants";
import {
  NEON_AUTH_UNAVAILABLE_MESSAGE,
  NEON_SESSION_EXPIRED_MESSAGE,
} from "@/lib/neon-cli/errors";
import {
  deleteCredentials,
  listProfiles,
  readCredentials,
  updateProfileMeta,
  writeCredentials,
  type NeonOAuthCredentials,
  type NeonProfileMeta,
} from "./credentials";
import {
  refreshAccessToken,
  NeonRefreshRejectionError,
  NeonRefreshUnavailableError,
} from "./auth-flow";

const REFRESH_SKEW_MS = 60_000;

export interface NeonProject {
  id: string;
  name: string;
  region_id?: string;
  created_at?: string;
  org_id?: string;
}

export interface NeonOrg {
  id: string;
  name: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  default?: boolean;
  current_state?: string;
  created_at?: string;
}

export interface NeonDatabase {
  name: string;
  owner_name?: string;
  created_at?: string;
}

export interface NeonRole {
  name: string;
  created_at?: string;
}

export interface NeonUser {
  id?: string;
  email?: string;
}

async function ensureAccessToken(profile: string): Promise<string> {
  let creds = readCredentials(profile);
  if (!creds) {
    throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
  }

  const needsRefresh = creds.expires_at <= Date.now() + REFRESH_SKEW_MS;
  if (needsRefresh) {
    if (!creds.refresh_token) {
      throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
    }
    const refreshToken: string = creds.refresh_token;
    // One retry so a single blip (VPN reconnecting, flaky Wi-Fi) does not
    // surface an error to the user.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const refreshed = await refreshAccessToken(refreshToken);
        const next: NeonOAuthCredentials = {
          ...creds,
          ...refreshed,
          user_id: refreshed.user_id ?? creds.user_id,
        };
        writeCredentials(profile, next);
        creds = next;
        break;
      } catch (err) {
        if (err instanceof NeonRefreshRejectionError) {
          // The IdP refused the refresh token — the session is truly gone.
          throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
        }
        const isLast = attempt === 1;
        if (isLast) {
          if (err instanceof NeonRefreshUnavailableError) {
            // Network-level problem; the stored session is untouched.
            throw new Error(NEON_AUTH_UNAVAILABLE_MESSAGE);
          }
          // Unexpected — fail loudly without mislabeling it as expired.
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
  }

  return creds.access_token;
}

async function neonFetch<T>(
  profile: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await ensureAccessToken(profile);
  const url = `${NEON_API_HOST.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

  if (res.status === 401 || res.status === 403) {
    // One refresh retry on auth failure.
    const creds = readCredentials(profile);
    if (creds?.refresh_token) {
      try {
        const refreshed = await refreshAccessToken(creds.refresh_token);
        writeCredentials(profile, { ...creds, ...refreshed });
        const retry = await fetch(url, {
          ...init,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${refreshed.access_token}`,
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...(init?.headers ?? {}),
          },
          signal: init?.signal ?? AbortSignal.timeout(30_000),
        });
        if (retry.status === 401 || retry.status === 403) {
          throw new NeonRefreshRejectionError("Neon API still unauthorized after refresh");
        }
        if (retry.ok) {
          if (retry.status === 204) return undefined as T;
          return (await retry.json()) as T;
        }
        const text = await retry.text().catch(() => retry.statusText);
        throw new Error(`Neon API ${retry.status}: ${text.slice(0, 300)}`);
      } catch (err) {
        if (err instanceof NeonRefreshRejectionError) {
          throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
        }
        if (err instanceof NeonRefreshUnavailableError) {
          throw new Error(NEON_AUTH_UNAVAILABLE_MESSAGE);
        }
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Neon API ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getCurrentUser(profile: string): Promise<NeonUser> {
  const data = await neonFetch<{ id?: string; email?: string }>(profile, "users/me");
  return { id: data.id, email: data.email };
}

export async function listOrgs(profile: string): Promise<NeonOrg[]> {
  const data = await neonFetch<{ organizations?: NeonOrg[] } | NeonOrg[]>(
    profile,
    "users/me/organizations",
  );
  if (Array.isArray(data)) return data;
  return data.organizations ?? [];
}

export async function listProjects(profile: string, orgId?: string): Promise<NeonProject[]> {
  // Neon requires org_id for projects list on org-scoped accounts.
  let resolvedOrgId = orgId;
  if (!resolvedOrgId) {
    const orgs = await listOrgs(profile);
    resolvedOrgId = orgs[0]?.id;
  }
  if (!resolvedOrgId) return [];
  const qs = `?org_id=${encodeURIComponent(resolvedOrgId)}`;
  const data = await neonFetch<{ projects?: NeonProject[] } | NeonProject[]>(
    profile,
    `projects${qs}`,
  );
  if (Array.isArray(data)) return data;
  return data.projects ?? [];
}

export async function listBranches(profile: string, projectId: string): Promise<NeonBranch[]> {
  const data = await neonFetch<{ branches?: NeonBranch[] }>(
    profile,
    `projects/${encodeURIComponent(projectId)}/branches`,
  );
  return data.branches ?? [];
}

export async function listDatabases(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonDatabase[]> {
  const data = await neonFetch<{ databases?: NeonDatabase[] }>(
    profile,
    `projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/databases`,
  );
  return data.databases ?? [];
}

export async function listRoles(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonRole[]> {
  const data = await neonFetch<{ roles?: NeonRole[] }>(
    profile,
    `projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/roles`,
  );
  return data.roles ?? [];
}

export async function getConnectionUri(
  profile: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
  pooled = true,
): Promise<string> {
  const params = new URLSearchParams({
    database_name: database,
    role_name: role,
    branch_id: branchId,
  });
  if (pooled) params.set("pooled", "true");
  const data = await neonFetch<{ uri?: string; connection_uri?: string }>(
    profile,
    `projects/${encodeURIComponent(projectId)}/connection_uri?${params.toString()}`,
  );
  const uri = data.uri || data.connection_uri || "";
  if (!uri.startsWith("postgres")) {
    throw new Error("Neon API did not return a valid connection string.");
  }
  return uri;
}

export interface NeonAuthStatus {
  profile: string;
  valid: boolean;
  email?: string;
  userId?: string;
  error?: string;
}

export async function authStatus(profiles: string[]): Promise<NeonAuthStatus[]> {
  const deduped = [...new Set(profiles.map((p) => String(p || "").trim()).filter(Boolean))];
  const unique = deduped.includes("DEFAULT")
    ? ["DEFAULT", ...deduped.filter((p) => p !== "DEFAULT").slice(0, 9)]
    : deduped.slice(0, 10);

  return Promise.all(
    unique.map(async (profile) => {
      try {
        const creds = readCredentials(profile);
        if (!creds) {
          return { profile, valid: false, error: "no credentials" };
        }
        const user = await getCurrentUser(profile);
        if (user.email || user.id) {
          updateProfileMeta(profile, {
            label: user.email ?? null,
            userId: user.id ?? null,
          });
        }
        return {
          profile,
          valid: true,
          email: user.email,
          userId: user.id,
        };
      } catch (err) {
        return {
          profile,
          valid: false,
          error: err instanceof Error ? err.message.slice(0, 300) : "invalid",
        };
      }
    }),
  );
}

export function profileList(): NeonProfileMeta[] {
  return listProfiles();
}

export function profileRemove(profile: string): { success: true } {
  deleteCredentials(profile);
  return { success: true };
}

export { updateProfileMeta, writeCredentials };
