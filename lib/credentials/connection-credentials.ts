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

export async function protectConnectionPayload<T extends CredentialPayload>(payload: T): Promise<T> {
  if (!hasConnectionSecret(payload)) {
    return payload.credentialRef
      ? { ...payload, credentialRef: null, credentialSecret: null, password: null, authToken: null, credentialStorageMode: getCredentialStorageMode() } as T
      : payload;
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
