import { argon2idAsync } from "@noble/hashes/argon2.js";
import { API_BASE } from "@/lib/api-base";

export type VaultPrompt = {
  setup: boolean;
  error?: string;
  resolve: (passphrase: string) => void;
  reject: () => void;
};

export type CredentialStorageMode = "keychain" | "vault" | "plaintext";
const MODE_KEY = "rexadb:credential-storage-mode";
const CHECK_TEXT = "RexaDB local credential vault v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let unlockedKey: CryptoKey | null = null;
let unlocking: Promise<void> | null = null;
let promptHandler: ((prompt: VaultPrompt) => void) | null = null;
const queuedPrompts: VaultPrompt[] = [];

export function getCredentialStorageMode(): CredentialStorageMode {
  if (typeof localStorage === "undefined") return "keychain";
  const mode = localStorage.getItem(MODE_KEY);
  return mode === "vault" || mode === "plaintext" ? mode : "keychain";
}

export function setCredentialStorageMode(mode: CredentialStorageMode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function attachVaultPrompt(handler: (prompt: VaultPrompt) => void) {
  promptHandler = handler;
  queuedPrompts.splice(0).forEach(handler);
  return () => { if (promptHandler === handler) promptHandler = null; };
}

function requestPassphrase(setup: boolean, error?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const prompt = { setup, error, resolve, reject: () => reject(new Error("Vault unlock cancelled.")) };
    if (promptHandler) promptHandler(prompt);
    else queuedPrompts.push(prompt);
  });
}

async function readConfig() {
  const response = await fetch(new URL("/api/connections/vault/config", API_BASE));
  if (!response.ok) throw new Error("Could not read encrypted-vault settings.");
  const result = await response.json();
  if (!result.success) throw new Error(result.error || "Could not read encrypted-vault settings.");
  return result.data as { salt: string; verifier: string } | null;
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const raw = await argon2idAsync(passphrase, salt, { t: 3, m: 65_536, p: 1, dkLen: 32, asyncTick: 10 });
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encryptWithKey(key: CryptoKey, reference: string, plaintext: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(reference) },
    key,
    encoder.encode(plaintext),
  );
  return `v1.${toBase64(nonce)}.${toBase64(new Uint8Array(ciphertext))}`;
}

async function decryptWithKey(key: CryptoKey, reference: string, envelope: string) {
  const [version, nonce, ciphertext] = envelope.split(".");
  if (version !== "v1" || !nonce || !ciphertext) throw new Error("Unsupported vault entry.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(nonce), additionalData: encoder.encode(reference) },
    key,
    fromBase64(ciphertext),
  );
  return decoder.decode(plaintext);
}

async function saveConfig(salt: string, verifier: string) {
  const response = await fetch(new URL("/api/connections/vault/config", API_BASE), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ salt, verifier }),
  });
  if (!response.ok) throw new Error("Could not initialize the encrypted credential vault.");
  const result = await response.json();
  if (!result.success) throw new Error(result.error || "Could not initialize the encrypted credential vault.");
}

async function ensureUnlocked() {
  if (unlockedKey) return;
  if (unlocking) return unlocking;
  unlocking = (async () => {
    const config = await readConfig();
    if (!config) {
      const passphrase = await requestPassphrase(true);
      if (passphrase.length < 12) throw new Error("Use at least 12 characters for the vault passphrase.");
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, saltBytes);
      const verifier = await encryptWithKey(key, "vault-check", CHECK_TEXT);
      await saveConfig(toBase64(saltBytes), verifier);
      unlockedKey = key;
      return;
    }
    let message: string | undefined;
    for (;;) {
      const passphrase = await requestPassphrase(false, message);
      try {
        const key = await deriveKey(passphrase, fromBase64(config.salt));
        if (await decryptWithKey(key, "vault-check", config.verifier) !== CHECK_TEXT) throw new Error();
        unlockedKey = key;
        return;
      } catch {
        message = "That passphrase did not unlock this vault. Try again.";
      }
    }
  })();
  try { await unlocking; } finally { unlocking = null; }
}

export async function encryptVaultSecret(reference: string, plaintext: string) {
  await ensureUnlocked();
  return encryptWithKey(unlockedKey!, reference, plaintext);
}

export async function decryptVaultSecret(reference: string, envelope: string) {
  await ensureUnlocked();
  return decryptWithKey(unlockedKey!, reference, envelope);
}

export function lockCredentialVault() {
  unlockedKey = null;
  if (typeof fetch !== "undefined") {
    void fetch(new URL("/api/connections/credential-cache/lock", API_BASE), {
      method: "POST", keepalive: true,
    }).catch(() => undefined);
  }
}
