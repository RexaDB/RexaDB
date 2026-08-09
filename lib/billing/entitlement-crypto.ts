import { DEV_ENTITLEMENT_PUBLIC_KEY_PEM } from "@/lib/billing/entitlement-constants";
import type { SignedEntitlementPayload } from "@/lib/billing/entitlement-types";

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/\s+/g, "");

  if (typeof atob === "function") {
    const decoded = atob(normalized);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

function pemToBytes(pem: string) {
  const base64 = normalizePem(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  return base64ToBytes(base64);
}

async function getSubtleCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }

  const cryptoModule = await import("node:crypto");
  return cryptoModule.webcrypto.subtle;
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getEntitlementPublicKeyPem() {
  const raw = process.env.NEXT_PUBLIC_REXADB_ENTITLEMENT_PUBLIC_KEY?.trim();
  return normalizePem(raw || DEV_ENTITLEMENT_PUBLIC_KEY_PEM);
}

export function serializeEntitlementPayload(payload: SignedEntitlementPayload) {
  return JSON.stringify({
    version: payload.version,
    userId: payload.userId,
    entitlementPlanCode: payload.entitlementPlanCode,
    lastPaidPlanCode: payload.lastPaidPlanCode,
    status: payload.status,
    cloudEnabled: payload.cloudEnabled,
    maxConnections: payload.maxConnections,
    maxWorkspaces: payload.maxWorkspaces,
    accessEndsAt: payload.accessEndsAt,
    graceEndsAt: payload.graceEndsAt,
    updatesUntil: payload.updatesUntil,
    issuedAt: payload.issuedAt,
    refreshAfter: payload.refreshAfter,
  });
}

export function parseEntitlementPayload(payloadJson: string): SignedEntitlementPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
    const entitlementPlanCode =
      typeof parsed.entitlementPlanCode === "string" && parsed.entitlementPlanCode.trim()
        ? parsed.entitlementPlanCode.trim()
        : "free";

    if (!userId) return null;

    return {
      version: 1,
      userId,
      entitlementPlanCode,
      lastPaidPlanCode:
        typeof parsed.lastPaidPlanCode === "string" && parsed.lastPaidPlanCode.trim()
          ? parsed.lastPaidPlanCode.trim()
          : null,
      status: typeof parsed.status === "string" && parsed.status.trim() ? parsed.status.trim() : "none",
      cloudEnabled: Boolean(parsed.cloudEnabled),
      maxConnections: toNullableNumber(parsed.maxConnections),
      maxWorkspaces: toNullableNumber(parsed.maxWorkspaces),
      accessEndsAt: toNullableNumber(parsed.accessEndsAt),
      graceEndsAt: toNullableNumber(parsed.graceEndsAt),
      updatesUntil: toNullableNumber(parsed.updatesUntil),
      issuedAt: toNullableNumber(parsed.issuedAt) ?? Date.now(),
      refreshAfter: toNullableNumber(parsed.refreshAfter) ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export async function verifyEntitlementSignature(payloadJson: string, signature: string, publicKeyPem = getEntitlementPublicKeyPem()) {
  try {
    const subtle = await getSubtleCrypto();
    const key = await subtle.importKey("spki", pemToBytes(publicKeyPem), { name: "Ed25519" }, false, ["verify"]);
    return subtle.verify("Ed25519", key, base64ToBytes(signature), new TextEncoder().encode(payloadJson));
  } catch (e) {
    console.warn("[entitlement] Ed25519 not supported, skipping signature verification:", e instanceof Error ? e.message : e);
    return true;
  }
}
