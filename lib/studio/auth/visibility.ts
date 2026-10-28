import { isNeonDatabaseConnection } from "@/lib/studio/neon-management";
import { resolvePaymentsConnection } from "@/lib/supabase-paykit/supabase-ref";

/** Supabase projects (supabase-mgmt pointers and direct db.<ref>.supabase.co
 *  connections) always ship GoTrue's `auth` schema, so Authentication is
 *  available before the schema list has loaded. */
export function isSupabaseAuthConnection(
  connectionType: string | undefined,
  connectionString: string | undefined,
): boolean {
  return resolvePaymentsConnection(connectionType, connectionString) !== null;
}

/** Authentication is shown for Supabase projects, Neon (Managed Auth), and
 *  any connection exposing an `auth` / `neon_auth` schema. */
export function shouldShowAuth(
  connectionType: string | undefined,
  connectionString: string | undefined,
  schemas?: string[] | null,
): boolean {
  if (schemas?.includes("auth") || schemas?.includes("neon_auth")) return true;
  return isSupabaseAuthConnection(connectionType, connectionString) ||
    isNeonDatabaseConnection(connectionType, connectionString, schemas);
}
