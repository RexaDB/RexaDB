/**
 * Effect tagged errors for the credentials / vault domain (Wave 4).
 * Keep this module out of browser-only imports that do not already pull Effect.
 */
import { Data } from "effect";

/** Bad credential-cache payload (reference shape, secret fields, size). */
export class CredentialValidationError extends Data.TaggedError(
  "CredentialValidationError",
)<{
  readonly message: string;
  readonly status?: number;
}> {}

/** Encrypted vault config read/write failure. */
export class VaultConfigError extends Data.TaggedError("VaultConfigError")<{
  readonly message: string;
  readonly status?: number;
}> {}

/** In-memory credential cache operation failure. */
export class CredentialCacheError extends Data.TaggedError(
  "CredentialCacheError",
)<{
  readonly message: string;
}> {}

/** System keychain / desktop credential store failure. */
export class KeychainError extends Data.TaggedError("KeychainError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type CredentialError =
  | CredentialValidationError
  | VaultConfigError
  | CredentialCacheError
  | KeychainError;
