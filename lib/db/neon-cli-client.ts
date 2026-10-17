// Server-only. Resolves a `neon-cli://` pointer (saved in the connections
// table for a Neon-linked database) into a real, live `postgresql://` URI
// via the Neon Management API + stored OAuth credentials (lib/neon-oauth),
// then lets the normal Postgres driver layer (lib/db/pg-client.ts) take it
// from there. That layer swaps in Neon's serverless driver for *.neon.tech
// hosts (lib/db/pg-driver.ts) so queries travel over HTTPS/WSS on 443 instead
// of raw Postgres on 5432 — networks that drop Postgres but allow HTTPS still
// work.
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
