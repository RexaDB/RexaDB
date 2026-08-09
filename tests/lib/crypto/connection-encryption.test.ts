import test from "node:test";
import assert from "node:assert/strict";
import { encryptConnectionString, decryptConnectionString } from "../../../lib/crypto/connection-encryption";

test("encrypt/decrypt round-trip", async () => {
  const passphrase = "super-secret";
  const plaintext = "postgres://user:pass@localhost:5432/app";
  const encrypted = await encryptConnectionString(passphrase, plaintext);

  assert.ok(encrypted.encrypted);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.salt);

  const decrypted = await decryptConnectionString(passphrase, encrypted.encrypted, encrypted.iv, encrypted.salt);
  assert.equal(decrypted, plaintext);
});

test("decrypt fails with wrong passphrase", async () => {
  const encrypted = await encryptConnectionString("one", "hello");
  await assert.rejects(() => decryptConnectionString("two", encrypted.encrypted, encrypted.iv, encrypted.salt));
});
