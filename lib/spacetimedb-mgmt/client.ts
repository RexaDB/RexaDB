import { API_BASE } from "@/lib/api-base";

// Management API for SpacetimeDB servers, reverse-engineered from the
// open-source CLI (crates/cli/src/subcommands/list.rs, util.rs and config.rs).
// Routes through the local sidecar proxy because SpacetimeDB servers do not
// send CORS headers for browser/webview fetches.

export const DEFAULT_SPACETIMEDB_CLOUD_HOST = "maincloud.spacetimedb.com";

const PROXY = `${API_BASE}/api/spacetimedb-mgmt/proxy`;

export interface SpacetimeDbCloudDatabase {
  identity: string;
  names: string[];
}

export function normalizeHost(host: string | null | undefined): string {
  const trimmed = (host || "")
    .trim()
    .replace(/^(https?|wss?):\/\//i, "")
    .replace(/\/+$/, "");
  return trimmed || DEFAULT_SPACETIMEDB_CLOUD_HOST;
}

async function mgmt<T>(
  token: string,
  hostName: string,
  path: string,
): Promise<T> {
  const res = await fetch(
    `${PROXY}${path}?host=${encodeURIComponent(hostName)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  const text = await res.text().catch(() => res.statusText);
  if (!res.ok) {
    throw new Error(`SpacetimeDB API ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SpacetimeDB API returned non-JSON: ${text.slice(0, 300)}`);
  }
}

// Decode the identity from a SpacetimeDB auth JWT, matching the CLI's
// util::decode_identity: `hex_identity` claim, else derived from iss|sub.
import { decodeSpacetimeDbIdentity } from "./identity";
export { decodeSpacetimeDbIdentity };

// Normalize a database identity from the API (may come back as bare hex,
// `0x`-prefixed hex, or a 32-byte array) to bare lowercase hex.
function normalizeDatabaseIdentity(value: unknown): string | null {
  if (typeof value === "string") {
    const hex = value.trim().replace(/^0x/i, "");
    if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
    return null;
  }
  if (Array.isArray(value) && value.length === 32) {
    let hex = "";
    for (const b of value) {
      if (typeof b !== "number" || b < 0 || b > 255) return null;
      hex += b.toString(16).padStart(2, "0");
    }
    return hex;
  }
  return null;
}

export async function listSpacetimeDbDatabaseIdentities(
  token: string,
  identity: string,
  host?: string | null,
): Promise<string[]> {
  const result = await mgmt<{ identities?: unknown[] }>(
    token,
    normalizeHost(host),
    `/v1/identity/${encodeURIComponent(identity)}/databases`,
  );
  if (!Array.isArray(result.identities)) return [];
  const identities: string[] = [];
  for (const item of result.identities) {
    const normalized = normalizeDatabaseIdentity(item);
    if (normalized) identities.push(normalized);
  }
  return identities;
}

export async function resolveSpacetimeDbDatabaseNames(
  token: string,
  databaseIdentity: string,
  host?: string | null,
): Promise<string[]> {
  try {
    const result = await mgmt<{ names?: string[] }>(
      token,
      normalizeHost(host),
      `/v1/database/${encodeURIComponent(databaseIdentity)}/names`,
    );
    return Array.isArray(result.names) ? result.names : [];
  } catch {
    return [];
  }
}

export async function listSpacetimeDbDatabases(
  token: string,
  host?: string | null,
): Promise<SpacetimeDbCloudDatabase[]> {
  const identity = decodeSpacetimeDbIdentity(token);
  if (!identity) throw new Error("Invalid SpacetimeDB token: no identity claim");
  const dbIdentities = await listSpacetimeDbDatabaseIdentities(token, identity, host);
  const databases: SpacetimeDbCloudDatabase[] = [];
  for (const dbIdentity of dbIdentities) {
    const names = await resolveSpacetimeDbDatabaseNames(token, dbIdentity, host);
    databases.push({ identity: dbIdentity, names });
  }
  return databases;
}

export async function validateSpacetimeDbToken(
  token: string,
  host?: string | null,
): Promise<boolean> {
  const identity = decodeSpacetimeDbIdentity(token);
  if (!identity) return false;
  try {
    await listSpacetimeDbDatabaseIdentities(token, identity, host);
    return true;
  } catch {
    return false;
  }
}