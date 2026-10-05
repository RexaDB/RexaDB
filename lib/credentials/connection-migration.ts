import { API_BASE } from "@/lib/api-base";
import {
  deleteConnectionCredential,
  hydrateConnection,
  protectConnectionPayload,
} from "./connection-credentials";
import { hasConnectionSecret, stripConnectionSecrets } from "./connection-secret-utils";
import { getCredentialStorageMode } from "./local-vault";

type SavedConnection = Record<string, any> & {
  id: number;
  credentialRef?: string | null;
  connectionString?: string;
  password?: string | null;
  authToken?: string | null;
  credentialError?: boolean;
  secureCleanupPending?: boolean;
};

const CLEANUP_PENDING_KEY = "rexadb:secure-migration-cleanup-pending";

function markCleanupPending() {
  try { localStorage.setItem(CLEANUP_PENDING_KEY, "1"); } catch { /* storage unavailable */ }
}

function clearCleanupPending() {
  try { localStorage.removeItem(CLEANUP_PENDING_KEY); } catch { /* storage unavailable */ }
}

function isCleanupPending() {
  try { return localStorage.getItem(CLEANUP_PENDING_KEY) === "1"; } catch { return false; }
}

async function runSecureCleanup() {
  const compacted = await fetch(new URL("/api/connections/secure-migration/complete", API_BASE), { method: "POST" });
  if (!compacted.ok) throw new Error("Secure-migration cleanup failed.");
}

async function persistMigration(connection: SavedConnection) {
  const protectedData = await protectConnectionPayload(connection);
  try {
    const response = await fetch(new URL(`/api/connections/${connection.id}`, API_BASE), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...protectedData, secureMigration: true }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("Could not migrate saved connection credentials.");
    return { ...connection, ...protectedData };
  } catch (error) {
    await deleteConnectionCredential(protectedData.credentialRef!);
    throw error;
  }
}

export async function migrateAndHydrateConnections(rows: SavedConnection[]): Promise<SavedConnection[]> {
  const desiredMode = getCredentialStorageMode();
  let migrated = 0;
  const secured: SavedConnection[] = [];
  for (const row of rows) {
    try {
      const oldReference = row.credentialRef || null;
      const inlineSecret = hasConnectionSecret(row);
      const currentMode = oldReference
        ? oldReference.startsWith("vault:") ? "vault" : "keychain"
        : inlineSecret ? "plaintext" : null;
      const needsModeChange = Boolean(currentMode && currentMode !== desiredMode);
      const source = needsModeChange && oldReference ? await hydrateConnection(row) : row;
      const safeRow = needsModeChange ? await persistMigration(source) : row;
      if (safeRow !== row) {
        migrated++;
        if (oldReference && !oldReference.startsWith("vault:") && oldReference !== safeRow.credentialRef) {
          await deleteConnectionCredential(oldReference).catch(() => undefined);
        }
      }
      secured.push(await hydrateConnection(safeRow));
    } catch {
      // Do not destroy working inline credentials when migration itself fails
      // (keychain unavailable, vault locked, user cancelled). The original row
      // still contains a usable connection string, so keep it and retry on the
      // next load instead of stripping the password (which breaks PostgreSQL
      // with "SASL: ... client password must be a string").
      if (!row.credentialRef && hasConnectionSecret(row)) {
        secured.push({ ...row });
        continue;
      }
      secured.push({
        ...row,
        connectionString: stripConnectionSecrets(row.connectionString || ""),
        password: null,
        authToken: null,
        credentialError: true,
      });
    }
  }
  if (migrated) markCleanupPending();
  let cleanupPending = isCleanupPending();
  if (migrated || cleanupPending) {
    try {
      await runSecureCleanup();
      clearCleanupPending();
      cleanupPending = false;
    } catch {
      markCleanupPending();
      cleanupPending = true;
    }
  }
  if (cleanupPending) {
    secured.forEach((connection) => { connection.secureCleanupPending = true; });
  }
  return secured;
}
