/**
 * Effect helpers for encrypted-vault config results returned by actions-core.
 * Expected failures stay in the `{ success: false }` envelope so existing
 * HTTP status mapping (200/500, 201/409) can keep reading `result.success`.
 */
import { Effect } from "effect";
import { VaultConfigError } from "./effect-errors";

export type VaultConfigResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * Lift a Promise vault-config call into an Effect. Thrown errors become
 * VaultConfigError; `{ success: false }` envelopes pass through unchanged.
 */
export const fromVaultConfigPromise = <T>(
  evaluate: () => PromiseLike<VaultConfigResult<T>>,
): Effect.Effect<VaultConfigResult<T>, VaultConfigError> =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) =>
      new VaultConfigError({
        message:
          cause instanceof Error
            ? cause.message
            : "Could not read encrypted-vault settings.",
        status: 500,
      }),
  });

/**
 * Lift a Promise migration/cleanup call. Throws become VaultConfigError so
 * the route can use fallbackStatus: 500.
 */
export const fromVaultMigrationPromise = <A>(
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, VaultConfigError> =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) =>
      new VaultConfigError({
        message:
          cause instanceof Error
            ? cause.message
            : "SQLite cleanup could not finish.",
        status: 500,
      }),
  });
