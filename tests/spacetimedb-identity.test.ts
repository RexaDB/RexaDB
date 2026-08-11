import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSpacetimeDbIdentity,
  identityFromClaims,
} from "../lib/spacetimedb-mgmt/identity";

function makeToken(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${b64}.signature`;
}

test("identityFromClaims matches the Rust Identity::from_claims reference vector", () => {
  // Reference computed with the official b3sum (RustCrypto/blake3) CLI:
  //   input       = "https://spacetimedb.com/auth|0123456789abcdef0123456789abcdef"
  //   id_hash     = blake3(input)[0..26]
  //   checksum    = blake3([0xc2, 0x00, ...id_hash])[0..4]
  //   final       = [0xc2, 0x00, ...checksum, ...id_hash]
  assert.equal(
    identityFromClaims(
      "https://spacetimedb.com/auth",
      "0123456789abcdef0123456789abcdef",
    ),
    "c200ca1eea8d8cb38e26ffd12ee43878aecf8c99eaf2b62d994fad6a471b5a01",
  );
});

test("identityFromClaims always produces a c200-prefixed, 64-char identity", () => {
  const id = identityFromClaims("issuer", "subject");
  assert.match(id, /^c200[0-9a-f]{60}$/);
});

test("decodeSpacetimeDbIdentity uses the hex_identity claim when present", () => {
  const token = makeToken({
    hex_identity: "0xc2000000000000000000000000000000000000000000000000000000000000ab",
    sub: "0123456789abcdef0123456789abcdef",
    iss: "https://spacetimedb.com/auth",
  });
  assert.equal(
    decodeSpacetimeDbIdentity(token),
    "c2000000000000000000000000000000000000000000000000000000000000ab",
  );
});

test("decodeSpacetimeDbIdentity derives identity from iss|sub when hex_identity is absent", () => {
  const token = makeToken({
    sub: "0123456789abcdef0123456789abcdef",
    iss: "https://spacetimedb.com/auth",
    aud: "spacetimedb",
    exp: 4102444800,
  });
  assert.equal(
    decodeSpacetimeDbIdentity(token),
    "c200ca1eea8d8cb38e26ffd12ee43878aecf8c99eaf2b62d994fad6a471b5a01",
  );
});

test("decodeSpacetimeDbIdentity returns null for malformed tokens", () => {
  assert.equal(decodeSpacetimeDbIdentity(""), null);
  assert.equal(decodeSpacetimeDbIdentity("not-a-jwt"), null);
  assert.equal(decodeSpacetimeDbIdentity("a.b.c"), null);
  assert.equal(decodeSpacetimeDbIdentity(makeToken({ sub: "no-issuer" })), null);
  assert.equal(decodeSpacetimeDbIdentity(makeToken({ iss: "no-subject" })), null);
});