import { afterEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import {
  getCachedConnectionCredential,
  resetCredentialCacheForTests,
} from "@/lib/credentials/connection-credential-cache";
import {
  isValidCredentialCacheReference,
  isValidCredentialCacheSecret,
  lockCredentialCacheEffect,
  putCredentialCacheEntryEffect,
} from "@/lib/credentials/credential-cache-effects";
import { CredentialValidationError } from "@/lib/credentials/effect-errors";
import { fromVaultConfigPromise } from "@/lib/credentials/vault-config-effects";

describe("credential-cache validation helpers", () => {
  test("accepts keychain and vault references", () => {
    expect(isValidCredentialCacheReference("abc-123")).toBe(true);
    expect(isValidCredentialCacheReference("vault:abc-123")).toBe(true);
    expect(isValidCredentialCacheReference("bad name")).toBe(false);
    expect(isValidCredentialCacheReference(null)).toBe(false);
  });

  test("accepts only allowed secret fields", () => {
    expect(
      isValidCredentialCacheSecret({
        connectionString: "postgres://x",
        password: null,
      }),
    ).toBe(true);
    expect(isValidCredentialCacheSecret({ extra: "nope" })).toBe(false);
    expect(isValidCredentialCacheSecret(null)).toBe(false);
  });
});

describe("putCredentialCacheEntryEffect", () => {
  afterEach(() => {
    resetCredentialCacheForTests();
  });

  test("stores a valid entry", async () => {
    const result = await Effect.runPromise(
      putCredentialCacheEntryEffect("ref-1", {
        connectionString: "postgres://local",
        password: "secret",
      }),
    );
    expect(result).toEqual({ success: true });
    expect(getCachedConnectionCredential("ref-1")).toEqual({
      connectionString: "postgres://local",
      password: "secret",
    });
  });

  test("fails with CredentialValidationError for bad payloads", async () => {
    const exit = await Effect.runPromiseExit(
      putCredentialCacheEntryEffect("bad ref", { connectionString: "x" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err)).toBe(true);
      if (Option.isSome(err)) {
        expect(err.value).toBeInstanceOf(CredentialValidationError);
        expect((err.value as CredentialValidationError).status).toBe(400);
      }
    }
  });

  test("lockCredentialCacheEffect clears entries", async () => {
    await Effect.runPromise(
      putCredentialCacheEntryEffect("ref-2", { password: "x" }),
    );
    await Effect.runPromise(lockCredentialCacheEffect());
    expect(getCachedConnectionCredential("ref-2")).toBeUndefined();
  });
});

describe("fromVaultConfigPromise", () => {
  test("passes through success envelopes", async () => {
    const result = await Effect.runPromise(
      fromVaultConfigPromise(async () => ({
        success: true,
        data: { salt: "s", verifier: "v1.a.b" },
      })),
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ salt: "s", verifier: "v1.a.b" });
  });

  test("maps thrown errors to VaultConfigError", async () => {
    const { VaultConfigError } = await import(
      "@/lib/credentials/effect-errors"
    );
    const exit = await Effect.runPromiseExit(
      fromVaultConfigPromise(async () => {
        throw new Error("disk full");
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err)).toBe(true);
      if (Option.isSome(err)) {
        expect(err.value).toBeInstanceOf(VaultConfigError);
        expect(err.value.message).toBe("disk full");
      }
    }
  });
});
