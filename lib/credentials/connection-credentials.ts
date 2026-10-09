import { isDesktopRuntime } from "@/lib/desktop";
import { API_BASE } from "@/lib/api-base";
import {
  hasConnectionSecret,
  restorePostgresPassword,
  stripConnectionSecrets,
} from "./connection-secret-utils";
import { decryptVaultSecret, encryptVaultSecret, getCredentialStorageMode } from "./local-vault";
export { hasConnectionSecret, stripConnectionSecrets } from "./connection-secret-utils";

export type CredentialPayload = Record<string, any> & {
  credentialRef?: string | null;
  credentialSecret?: string | null;
  connectionString?: string;
  password?: string | null;
  authToken?: string | null;
  credentialStorageMode?: "keychain" | "vault" | "plaintext";
};

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isDesktopRuntime()) throw new Error("Credential keychain is available only in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function readStoredBundle(payload: CredentialPayload): Promise<Record<string, unknown> | null> {
  const ref = payload.credentialRef;
  if (typeof ref !== "string" || !ref) return null;
  try {
    const raw = ref.startsWith("vault:")
      ? await decryptVaultSecret(ref, payload.credentialSecret || "")
      : await invoke<string>("connection_credential_get", { reference: ref });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function protectConnectionPayload<T extends CredentialPayload>(payload: T): Promise<T> {
  if (!hasConnectionSecret(payload)) {
    // Explicit null clears a stored reference (caller opted to drop credentials).
    // A non-null reference must be kept: edit forms often leave password blank
    // because the secret lives in keychain/vault, and partial updates (name,
    // lastActive, color) must not orphan the stored secret.
    if (payload.credentialRef === null) {
      return {
        ...payload,
        credentialRef: null,
        credentialSecret: null,
        password: null,
        authToken: null,
        credentialStorageMode: getCredentialStorageMode(),
      } as T;
    }
    // If the caller is saving a new target alongside the old reference, the
    // stored bundle still holds the previous connectionString. Keeping the
    // reference would let hydrate replay the old URL (and old password) over
    // the new target on reload. Compare redacted targets and drop the stale
    // reference so the new passwordless target actually sticks; the caller
    // deletes the orphaned keychain entry after a successful save.
    if (typeof payload.credentialRef === "string" && typeof payload.connectionString === "string") {
      const stored = await readStoredBundle(payload);
      const storedTarget = typeof stored?.connectionString === "string" ? stored.connectionString : null;
      if (storedTarget !== null) {
        try {
          if (stripConnectionSecrets(storedTarget) !== stripConnectionSecrets(payload.connectionString)) {
            return {
              ...payload,
              credentialRef: null,
              credentialSecret: null,
              password: null,
              authToken: null,
              credentialStorageMode: getCredentialStorageMode(),
            } as T;
          }
        } catch {
          // Fall through and keep the reference on comparison failure.
        }
      }
    }
    return {
      ...payload,
      credentialStorageMode: payload.credentialStorageMode || getCredentialStorageMode(),
    } as T;
  }
  const bundle = JSON.stringify({ connectionString: payload.connectionString, password: payload.password || null, authToken: payload.authToken || null });
  const mode = getCredentialStorageMode();
  if (mode === "plaintext") {
    return { ...payload, credentialRef: null, credentialSecret: null, credentialStorageMode: mode } as T;
  }
  const ref = mode === "vault" ? `vault:${crypto.randomUUID()}` : crypto.randomUUID();
  const credentialSecret = ref.startsWith("vault:") ? await encryptVaultSecret(ref, bundle) : null;
  if (!credentialSecret) await invoke("connection_credential_set", { reference: ref, value: bundle });
  return {
    ...payload,
    connectionString: payload.connectionString ? stripConnectionSecrets(payload.connectionString) : payload.connectionString,
    password: null,
    authToken: null,
    credentialRef: ref,
    credentialSecret,
    credentialStorageMode: mode,
  } as T;
}

export async function hydrateConnection<T extends CredentialPayload>(connection: T): Promise<T> {
  if (!connection.credentialRef) return connection;
  const raw = connection.credentialRef.startsWith("vault:")
    ? await decryptVaultSecret(connection.credentialRef, connection.credentialSecret || "")
    : await invoke<string>("connection_credential_get", { reference: connection.credentialRef });
  let secret: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid credential bundle.");
    }
    secret = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Could not unlock saved credentials.");
  }
  // Only forward plain string secrets to the sidecar cache; never forward
  // objects that would make node-postgres see a non-string password.
  const cacheSecret: Record<string, string | null> = {};
  for (const field of ["connectionString", "password", "authToken"] as const) {
    const value = secret[field];
    if (value === null || typeof value === "string") cacheSecret[field] = value;
  }
  try {
    await fetch(new URL("/api/connections/credential-cache", API_BASE), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: connection.credentialRef, secret: cacheSecret }),
    });
  } catch {
    // The UI can still use its keychain-hydrated URL if the sidecar cache is unavailable.
  }
  const hydrated = { ...connection, ...secret } as T;
  const bundlePassword = typeof secret.password === "string" ? secret.password : "";
  const rowPassword =
    typeof (connection as Record<string, unknown>).password === "string"
      ? String((connection as Record<string, unknown>).password)
      : "";
  const password = bundlePassword || rowPassword;
  const connectionString =
    typeof hydrated.connectionString === "string" && password
      ? restorePostgresPassword(
          hydrated.connectionString,
          String((hydrated as Record<string, unknown>).username || ""),
          password,
        )
      : hydrated.connectionString;
  return { ...hydrated, connectionString } as T;
}

export async function deleteConnectionCredential(reference: string): Promise<void> {
  if (reference.startsWith("vault:")) return;
  await invoke("connection_credential_delete", { reference });
}
