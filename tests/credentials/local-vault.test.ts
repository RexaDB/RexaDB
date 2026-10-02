import { afterEach, describe, expect, it } from "bun:test";
import {
  attachVaultPrompt,
  decryptVaultSecret,
  encryptVaultSecret,
  lockCredentialVault,
} from "@/lib/credentials/local-vault";

const originalFetch = globalThis.fetch;

afterEach(() => {
  lockCredentialVault();
  globalThis.fetch = originalFetch;
});

describe("encrypted local credential vault", () => {
  it("round-trips secrets and binds ciphertext to its credential reference", async () => {
    let config: { salt: string; verifier: string } | null = null;
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === "POST") {
        config = JSON.parse(String(init.body));
        return Response.json({ success: true }, { status: 201 });
      }
      return Response.json({ success: true, data: config });
    }) as typeof fetch;
    const detach = attachVaultPrompt((prompt) => prompt.resolve("a long test-only passphrase"));
    try {
      const envelope = await encryptVaultSecret("vault:fixture", "test database password");
      expect(envelope).not.toContain("test database password");
      expect(await decryptVaultSecret("vault:fixture", envelope)).toBe("test database password");
      await expect(decryptVaultSecret("vault:other", envelope)).rejects.toThrow();
    } finally {
      detach();
    }
  });
});
