// Backend client abstraction: Supabase today, Neon Data API when configured.
//
// When NEXT_PUBLIC_NEON_URL is set (Neon project "RexaDB Backend"), this module
// returns a Neon client built with @neondatabase/neon-js + SupabaseAuthAdapter,
// so existing `client.from()` / `client.rpc()` / `client.auth.*` call sites keep
// working. Otherwise it falls back to the Supabase client in ./client.
//
// Migration notes (see docs/neon-migration.md):
// - Password-based auth.users cannot transfer (different hashing). Users sign
//   up again or use OAuth on Neon Managed Better Auth.
// - pg_dump/pg_restore uses --no-owner --no-acl; RLS is re-applied by
//   neon/migrations/20261014_backend_schema.sql.

let cached: unknown = null;
let cachedKind: "neon" | "supabase" | null = null;

export function isNeonBackend(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_NEON_URL?.trim(),
  );
}

export function getFunctionsBaseUrl(): string | null {
  if (typeof process === "undefined") return null;
  const neonUrl = process.env.NEXT_PUBLIC_NEON_URL?.trim();
  if (neonUrl) return neonUrl.replace(/\/+$/, "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  return supabaseUrl || null;
}

/** Edge-function style URL for entitlement / OAuth callbacks. */
export function getEdgeFunctionUrl(slug: string): string | null {
  const base = getFunctionsBaseUrl();
  if (!base) return null;
  if (isNeonBackend()) return `${base}/functions/v1/${slug}`;
  return `${base}/functions/v1/${slug}`;
}

export async function getBackendClient(): Promise<any> {
  if (cached && cachedKind) return cached;
  if (isNeonBackend()) {
    const { createClient, SupabaseAuthAdapter } = await import(
      "@neondatabase/neon-js"
    );
    const url = process.env.NEXT_PUBLIC_NEON_URL!.trim();
    // neon-js@0.8.0-beta types disagree between the string-URL overload
    // (expects an adapter *instance*) and the factory's actual return (a
    // builder the client invokes with the URL). Cast at the boundary; at
    // runtime the builder form is what createClient consumes.
    const adapter = SupabaseAuthAdapter() as unknown as never;
    cached = createClient(url, { auth: { adapter } });
    cachedKind = "neon";
    return cached;
  }
  const { supabase } = await import("@/lib/supabase/client");
  cached = supabase;
  cachedKind = "supabase";
  return cached;
}

/** Synchronous accessor for already-initialized call sites. Falls back async. */
export async function backendFrom(table: string): Promise<any> {
  const client = await getBackendClient();
  return client.from(table);
}

export async function backendRpc(fn: string, args?: Record<string, unknown>): Promise<any> {
  const client = await getBackendClient();
  return client.rpc(fn, args);
}
