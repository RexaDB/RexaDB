// Server-only. Resolves a `neon-cli://` pointer (saved in the connections
// table for a CLI-linked Neon database) into a real, live `postgresql://`
// URI by shelling out to the genuine `neon` CLI, then lets the normal
// Postgres driver (lib/db/pg-client.ts) take it from there — no parallel
// SQL-over-HTTP execution path is needed, since neonctl hands back a real DSN.
import { neonConnectionString } from "@/lib/neon-cli/cli-runner";
import {
  isNeonCliConnectionString,
  parseNeonCliConnectionString,
} from "@/lib/neon-cli/pointer";

export { isNeonCliConnectionString, buildNeonCliConnectionString, parseNeonCliConnectionString } from "@/lib/neon-cli/pointer";

const DSN_CACHE_TTL_MS = 5 * 60 * 1000;
const dsnCache = new Map<string, { dsn: string; expiresAt: number }>();

/**
 * Resolves any connection string to what the Postgres driver should actually
 * dial. A `neon-cli://` pointer is exchanged for a live DSN (short-TTL
 * cached, since a rotated role password must never be served stale); every
 * other connection string passes through unchanged.
 */
export async function resolveEffectiveConnectionString(connectionString: string): Promise<string> {
  if (!isNeonCliConnectionString(connectionString)) return connectionString;

  const cached = dsnCache.get(connectionString);
  if (cached && cached.expiresAt > Date.now()) return cached.dsn;

  const pointer = parseNeonCliConnectionString(connectionString);
  if (!pointer) {
    throw new Error("Invalid Neon CLI connection string.");
  }

  const dsn = await neonConnectionString(
    pointer.profile,
    pointer.projectId,
    pointer.branchId,
    pointer.database,
    pointer.role,
  );
  dsnCache.set(connectionString, { dsn, expiresAt: Date.now() + DSN_CACHE_TTL_MS });
  return dsn;
}
