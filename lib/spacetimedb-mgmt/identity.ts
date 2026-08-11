// Identity decoding for SpacetimeDB auth JWTs.
//
// Mirrors the open-source CLI byte-for-byte:
//   - crates/cli/src/util.rs  `decode_identity`
//   - crates/lib/src/identity.rs `Identity::from_claims`
//
// The identity is either carried in the `hex_identity` claim (cloud-issued
// tokens) or derived from the `iss` + `sub` claims with a blake3-based
// checksum construction (server-issued tokens). There is no `identity` claim.
import { blake3 } from "@noble/hashes/blake3.js";

const TEXT_ENCODER = new TextEncoder();

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function normalizeIdentityHex(value: string): string | null {
  const hex = value.trim().replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(hex) ? hex.toLowerCase() : null;
}

// `Identity::from_claims`: derive a 256-bit identity from JWT `iss`/`sub`.
//
//     input       = "{issuer}|{subject}"
//     id_hash     = blake3(input)[0..26]
//     checksum    = blake3([0xc2, 0x00, ...id_hash])[0..4]
//     final_bytes = [0xc2, 0x00, ...checksum, ...id_hash]  (big-endian)
export function identityFromClaims(issuer: string, subject: string): string {
  const first = blake3(TEXT_ENCODER.encode(`${issuer}|${subject}`));
  const idHash = first.slice(0, 26);

  const checksumInput = new Uint8Array(28);
  checksumInput[0] = 0xc2;
  checksumInput[1] = 0x00;
  checksumInput.set(idHash, 2);
  const checksum = blake3(checksumInput);

  const finalBytes = new Uint8Array(32);
  finalBytes[0] = 0xc2;
  finalBytes[1] = 0x00;
  finalBytes.set(checksum.subarray(0, 4), 2);
  finalBytes.set(idHash, 6);

  return bytesToHex(finalBytes);
}

export function decodeSpacetimeDbIdentity(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const hexIdentity =
    typeof payload.hex_identity === "string" ? payload.hex_identity : null;
  if (hexIdentity) return normalizeIdentityHex(hexIdentity);

  const issuer = typeof payload.iss === "string" ? payload.iss : null;
  const subject = typeof payload.sub === "string" ? payload.sub : null;
  if (issuer && subject) return identityFromClaims(issuer, subject);

  return null;
}