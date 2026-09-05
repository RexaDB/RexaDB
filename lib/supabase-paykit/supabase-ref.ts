import { parseSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import { getMgmtAccounts } from "@/lib/supabase-mgmt/token-store";

export interface PaymentsConnectionInfo {
  /** supabase-mgmt connections deploy with their embedded token */
  kind: "mgmt" | "postgres";
  projectRef: string;
  /** embedded token for mgmt connections; null until resolved for postgres */
  token: string | null;
}

/**
 * Direct Postgres connections to Supabase use `db.<ref>.supabase.co`
 * (including the 6543 pooler on the same host). Returns the ref or null.
 */
export function inferSupabaseRefFromPostgresUrl(
  connectionString: string,
): string | null {
  try {
    const url = new URL(connectionString.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const match = host.match(/^db\.([a-z0-9-]{1,64})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function resolvePaymentsConnection(
  connectionType: string | undefined,
  connectionString: string | undefined,
): PaymentsConnectionInfo | null {
  if (!connectionString) return null;
  if (connectionType === "supabase-mgmt") {
    const parsed = parseSupabaseMgmtConnectionString(connectionString);
    if (!parsed) return null;
    return { kind: "mgmt", projectRef: parsed.projectRef, token: parsed.token };
  }
  if (connectionType === "postgres" || connectionType === "postgresql") {
    const ref = inferSupabaseRefFromPostgresUrl(connectionString);
    if (!ref) return null;
    return { kind: "postgres", projectRef: ref, token: null };
  }
  return null;
}

export function shouldShowPayments(
  connectionType: string | undefined,
  connectionString: string | undefined,
): boolean {
  return resolvePaymentsConnection(connectionType, connectionString) !== null;
}

const tokenCache = new Map<string, string>();

/**
 * Finds a linked Supabase Management API token that can see `ref`.
 * Tries linked accounts (usually just one) via listProjects and caches
 * the winner per ref. Returns null when no linked account has access —
 * the UI then offers plans/code/guide plus manual deploy steps.
 */
export async function resolveMgmtTokenForRef(
  ref: string,
  listProjects: (token: string) => Promise<Array<{ ref: string }>>,
): Promise<string | null> {
  const cached = tokenCache.get(ref);
  if (cached) return cached;
  let accounts: Array<{ token: string }> = [];
  try {
    accounts = getMgmtAccounts();
  } catch {
    accounts = [];
  }
  for (const account of accounts) {
    try {
      const projects = await listProjects(account.token);
      if (Array.isArray(projects) && projects.some((p) => p?.ref === ref)) {
        tokenCache.set(ref, account.token);
        return account.token;
      }
    } catch {
      // invalid/expired token or missing scope — try the next account
    }
  }
  return null;
}

export function clearMgmtTokenCache(): void {
  tokenCache.clear();
}
