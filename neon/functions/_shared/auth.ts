import { Pool } from "pg";

/** Module-scope pool (reused across requests in the isolate). */
export function makePool(max = 3): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max });
}

/**
 * Run a query as a specific end user: establishes identity for
 * public.auth_uid() inside SECURITY DEFINER RPCs, mirroring how Supabase
 * PostgREST sets auth.uid() from the caller JWT. Always COMMITs/ROLLBACKs.
 */
export async function callAsUser<T>(
  pool: Pool,
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [
      userId,
    ]);
    const { rows } = await client.query(text, params);
    await client.query("COMMIT");
    return rows as T[];
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Named shape for the verified caller. */
export interface VerifiedUser {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown>;
}

/**
 * Transitional caller verification: validates the caller's Supabase JWT
 * against the legacy Supabase Auth server and returns the user.
 *
 * TODO(neon-cutover): verify against Neon Auth (Better Auth session/JWKS)
 * once clients sign in via Neon, then drop LEGACY_SUPABASE_* env.
 */
export async function verifySupabaseUser(
  authHeader: string | null,
): Promise<VerifiedUser | null> {
  if (!authHeader) return null;
  const base = (process.env.LEGACY_SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.LEGACY_SUPABASE_ANON_KEY || "";
  if (!base || !anon) return null;
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: authHeader },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      id?: string;
      email?: string | null;
      user_metadata?: Record<string, unknown>;
    };
    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email ?? null,
      user_metadata: user.user_metadata,
    };
  } catch {
    return null;
  }
}
