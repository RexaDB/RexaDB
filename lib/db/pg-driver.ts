// Driver selection for Postgres-family connections.
//
// Some networks (corporate VPNs, ISP middleboxes, hotel/airport Wi-Fi) accept a
// TCP connection to :5432 and then silently drop the Postgres startup packet.
// Neon speaks the same SQL over HTTPS/WSS on :443 via its serverless driver, so
// for Neon-hosted databases we transparently swap node-postgres for
// `@neondatabase/serverless`. Every other host keeps using `pg`.
//
// The serverless Pool/Client are API-compatible with node-postgres for the
// call shapes used here (connect/query/release/end, transactions, params).
import type { Pool as PoolType, Client as ClientType, PoolConfig, ClientConfig } from "pg";

/** Hosts that should be reached through Neon's HTTPS/WSS driver. */
export function isNeonServerlessHost(host: string | undefined | null): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return false;
  return h.endsWith(".neon.tech") || h.endsWith(".neon.build");
}

function encodePart(value: string): string {
  return encodeURIComponent(value ?? "");
}

/**
 * Builds a libpq-style URL from discrete fields, since the Neon driver wants a
 * connection string rather than host/port/user/password pieces.
 */
export function buildConnectionString(config: {
  host: string;
  port?: number;
  // Accept pg's resolver form (`() => string`) for database/user/password and
  // coerce: we only ever pass literal strings here.
  database?: unknown;
  username?: unknown;
  password?: unknown;
}): string {
  const port = config.port || 5432;
  const username = typeof config.username === "string" ? config.username : "";
  const password = typeof config.password === "string" ? config.password : "";
  const database = typeof config.database === "string" ? config.database : "";
  const auth =
    username !== ""
      ? `${encodePart(username)}${password !== "" ? `:${encodePart(password)}` : ""}@`
      : "";
  const db = encodePart(database);
  return `postgresql://${auth}${config.host}:${port}/${db}?sslmode=require`;
}

let neonModulePromise: Promise<any> | null = null;

/** Loads `@neondatabase/serverless`, wiring a WebSocket constructor when needed. */
async function loadNeonDriver(): Promise<any> {
  if (!neonModulePromise) {
    neonModulePromise = (async () => {
      const mod = await import("@neondatabase/serverless");
      const { neonConfig } = mod as any;
      if (!neonConfig?.webSocketConstructor) {
        const globalWs = (globalThis as any).WebSocket;
        if (globalWs) {
          neonConfig.webSocketConstructor = globalWs;
        } else {
          try {
            const ws = (await import("ws")).default;
            neonConfig.webSocketConstructor = ws;
          } catch {
            // Fetch-only queries still work without a WebSocket constructor.
          }
        }
      }
      return mod;
    })();
  }
  return neonModulePromise;
}

export type AnyPgPool = PoolType;
export type AnyPgClient = ClientType;

/**
 * Creates a pool for `config`. Returns a Neon serverless pool when the host is
 * Neon-hosted, otherwise a regular node-postgres pool. `connectionString`, when
 * supplied, takes precedence (the Neon driver prefers it).
 */
export async function createPgPool(
  config: PoolConfig & { host?: string; connectionString?: string },
  fallbackPoolFactory: () => PoolType,
): Promise<PoolType> {
  const explicit = typeof config.connectionString === "string" ? config.connectionString : "";
  const host = config.host || (explicit ? safeHost(explicit) : "");
  if (!isNeonServerlessHost(host)) {
    return fallbackPoolFactory();
  }
  const { Pool: NeonPool } = await loadNeonDriver();
  const connectionString =
    explicit ||
    buildConnectionString({
      host,
      port: typeof config.port === "number" ? config.port : 5432,
      database: config.database,
      username: config.user,
      password: config.password,
    });
  return new NeonPool({
    connectionString,
    max: config.max ?? 6,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 15_000,
  }) as unknown as PoolType;
}

/** Creates a single client, using the Neon serverless driver for Neon hosts. */
export async function createPgClient(
  config: ClientConfig & { host?: string; connectionString?: string },
  fallbackClientFactory: () => ClientType,
): Promise<ClientType> {
  const explicit = typeof config.connectionString === "string" ? config.connectionString : "";
  const host = config.host || (explicit ? safeHost(explicit) : "");
  if (!isNeonServerlessHost(host)) {
    return fallbackClientFactory();
  }
  const { Client: NeonClient } = await loadNeonDriver();
  const connectionString =
    explicit ||
    buildConnectionString({
      host,
      port: typeof config.port === "number" ? config.port : 5432,
      database: config.database,
      username: config.user,
      password: config.password,
    });
  return new NeonClient({
    connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 15_000,
  }) as unknown as ClientType;
}

function safeHost(connectionString: string): string {
  return connectionStringHost(connectionString);
}

/** Extracts the hostname from a libpq URL, or "" when it is not a URL. */
export function connectionStringHost(connectionString: string): string {
  try {
    return new URL(connectionString.replace(/^postgres(ql)?:/, "postgresql:")).hostname;
  } catch {
    return "";
  }
}
