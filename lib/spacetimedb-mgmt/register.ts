import type { SpacetimeDbCloudDatabase } from "./client";
import { normalizeHost } from "./client";

// Build a connection string for a SpacetimeDB cloud/self-hosted database.
// `spacetimedbs://` = wss/https (used for maincloud and other TLS hosts).
// An explicit https:// / http:// prefix on the host wins over the default.
export function buildSpacetimeDbConnectionString(
  host: string,
  database: string,
  token: string,
): string {
  const raw = String(host || "").trim();
  const wantsHttps = /^https:\/\//i.test(raw);
  const wantsHttp = /^http:\/\//i.test(raw);
  const cleanHost = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^wss?:\/\//i, "")
    .replace(/\/+$/, "");
  const protocol =
    wantsHttps ||
    (!wantsHttp && /\.spacetimedb\.com$/i.test(cleanHost))
      ? "spacetimedbs"
      : "spacetimedb";
  const name = database.trim().replace(/^\/+/, "");
  return `${protocol}://${cleanHost}/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
}

export interface RegisterSpacetimeDbDatabasesDeps {
  listDatabases: (
    token: string,
    host?: string | null,
  ) => Promise<SpacetimeDbCloudDatabase[]>;
  createConnection: (payload: {
    name: string;
    connectionString: string;
    connectionType: string;
  }) => Promise<{ success: boolean }>;
}

export interface SpacetimeDbDatabaseImportResult {
  imported: number;
  alreadyRegistered: number;
  skippedLimit: number;
  skippedNameless: number;
  failed: number;
}

export function parseSpacetimeDbConnection(
  connectionString: string,
): { host: string; database: string } | null {
  const trimmed = String(connectionString || "").trim();
  const match = trimmed.match(
    /^spacetimedbs?:\/\/([^\/?]+)\/([^\/?]+)(?:\?|$)/i,
  );
  if (!match?.[1] || !match?.[2]) return null;
  return {
    host: match[1],
    database: decodeURIComponent(match[2]),
  };
}

export async function registerSpacetimeDbDatabases(
  token: string,
  serviceHost: string,
  existingConnectionStrings: string[],
  maxConnections: number | null,
  deps: RegisterSpacetimeDbDatabasesDeps,
): Promise<SpacetimeDbDatabaseImportResult> {
  const result: SpacetimeDbDatabaseImportResult = {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    skippedNameless: 0,
    failed: 0,
  };

  let databases: SpacetimeDbCloudDatabase[];
  try {
    databases = await deps.listDatabases(token, serviceHost);
  } catch {
    return { ...result, failed: 1 };
  }
  if (!Array.isArray(databases)) return result;

  const existingKeys = new Set<string>();
  for (const conn of existingConnectionStrings) {
    const parsed = parseSpacetimeDbConnection(conn);
    if (parsed) existingKeys.add(`${parsed.host}/${parsed.database}`.toLowerCase());
  }

  const cleanServiceHost = normalizeHost(serviceHost);
  const seen = new Set<string>();
  for (const database of databases) {
    const primaryName = database.names[0];
    if (!primaryName) {
      result.skippedNameless += 1;
      continue;
    }
    const key = `${cleanServiceHost}/${primaryName}`.toLowerCase();
    if (existingKeys.has(key) || seen.has(key)) {
      result.alreadyRegistered += 1;
      continue;
    }
    seen.add(key);
    if (maxConnections !== null && result.imported >= maxConnections) {
      result.skippedLimit += 1;
      continue;
    }
    try {
      const res = await deps.createConnection({
        name: primaryName,
        connectionString: buildSpacetimeDbConnectionString(
          serviceHost,
          primaryName,
          token,
        ),
        connectionType: "spacetimedb",
      });
      if (res.success) {
        result.imported += 1;
      } else {
        result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}