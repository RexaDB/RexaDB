import type { PlanetscalePassword } from "@/lib/planetscale/client";

export interface PlanetscaleConnectionResult {
  connectionString: string;
  /** Always "planetscale" — lib/db/connection-type.ts infers mysql vs
   *  postgres from the connection string's own scheme at query time. */
  connectionType: "planetscale";
}

/**
 * Builds a plain mysql:// or postgresql:// connection string from a freshly
 * minted branch password. From here on this is a completely standard
 * connection — no PlanetScale-specific code runs at query time, and the
 * linked OAuth account plays no further part.
 */
export function buildPlanetscaleConnectionString(
  password: PlanetscalePassword,
  database: string,
  databaseKind: string | undefined,
): PlanetscaleConnectionResult {
  const isPostgres = (databaseKind || "").toLowerCase().includes("postgres");
  const host = password.access_host_url;
  const user = encodeURIComponent(password.username);
  const pass = encodeURIComponent(password.plain_text);

  const connectionString = isPostgres
    ? `postgresql://${user}:${pass}@${host}:5432/${database}?sslmode=require`
    : `mysql://${user}:${pass}@${host}:3306/${database}?ssl=true`;

  return { connectionString, connectionType: "planetscale" };
}
