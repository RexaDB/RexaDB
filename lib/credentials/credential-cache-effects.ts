/**
 * Validated credential-cache put/lock Effects used by the sidecar routes.
 */
import { Effect } from "effect";
import {
  cacheConnectionCredentialEffect,
  clearCachedConnectionCredentialsEffect,
  type SecretBundle,
} from "./connection-credential-cache";
import { CredentialValidationError } from "./effect-errors";

const REFERENCE_RE =
  /^(?:[A-Za-z0-9-]{1,80}|vault:[A-Za-z0-9-]{1,80})$/;
const ALLOWED_SECRET_FIELDS = ["connectionString", "password", "authToken"] as const;
const MAX_SECRET_BYTES = 256_000;

export function isValidCredentialCacheSecret(
  secret: unknown,
): secret is SecretBundle {
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) {
    return false;
  }
  const fields = Object.keys(secret);
  if (
    !fields.every((field) =>
      (ALLOWED_SECRET_FIELDS as readonly string[]).includes(field),
    )
  ) {
    return false;
  }
  if (
    !fields.every((field) => {
      const value = (secret as Record<string, unknown>)[field];
      return value === null || typeof value === "string";
    })
  ) {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(secret)) <= MAX_SECRET_BYTES;
  } catch {
    return false;
  }
}

export function isValidCredentialCacheReference(
  reference: unknown,
): reference is string {
  return typeof reference === "string" && REFERENCE_RE.test(reference);
}

/**
 * Validate and store a credential-cache entry.
 * Invalid payloads fail with CredentialValidationError (HTTP 400).
 */
export const putCredentialCacheEntryEffect = (
  reference: unknown,
  secret: unknown,
): Effect.Effect<{ success: true }, CredentialValidationError> =>
  Effect.gen(function* () {
    if (
      !isValidCredentialCacheReference(reference) ||
      !isValidCredentialCacheSecret(secret)
    ) {
      return yield* Effect.fail(
        new CredentialValidationError({
          message: "Invalid credential cache entry.",
          status: 400,
        }),
      );
    }
    yield* cacheConnectionCredentialEffect(reference, secret);
    return { success: true as const };
  });

/** Clear the in-memory credential cache (vault lock). */
export const lockCredentialCacheEffect = (): Effect.Effect<
  { success: true },
  never
> =>
  clearCachedConnectionCredentialsEffect().pipe(
    Effect.map(() => ({ success: true as const })),
  );
