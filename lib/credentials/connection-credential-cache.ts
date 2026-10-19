/**
 * In-memory credential cache for the sidecar process.
 * Effect APIs are preferred for new server code; sync helpers remain for
 * existing call sites.
 */
import { Effect } from "effect";

export type SecretBundle = {
  connectionString?: string;
  password?: string | null;
  authToken?: string | null;
};

const credentials = new Map<string, SecretBundle>();

export const cacheConnectionCredentialEffect = (
  reference: string,
  secret: SecretBundle,
): Effect.Effect<void, never> =>
  Effect.sync(() => {
    credentials.set(reference, secret);
  });

export function cacheConnectionCredential(
  reference: string,
  secret: SecretBundle,
) {
  Effect.runSync(cacheConnectionCredentialEffect(reference, secret));
}

export const getCachedConnectionCredentialEffect = (
  reference: string,
): Effect.Effect<SecretBundle | undefined, never> =>
  Effect.sync(() => credentials.get(reference));

export function getCachedConnectionCredential(reference: string) {
  return Effect.runSync(getCachedConnectionCredentialEffect(reference));
}

export const removeCachedConnectionCredentialEffect = (
  reference: string,
): Effect.Effect<boolean, never> =>
  Effect.sync(() => credentials.delete(reference));

export function removeCachedConnectionCredential(reference: string) {
  return Effect.runSync(removeCachedConnectionCredentialEffect(reference));
}

export const clearCachedConnectionCredentialsEffect = (): Effect.Effect<
  void,
  never
> =>
  Effect.sync(() => {
    credentials.clear();
  });

export function clearCachedConnectionCredentials() {
  Effect.runSync(clearCachedConnectionCredentialsEffect());
}

/** Test-only: wipe cache between cases. */
export function resetCredentialCacheForTests() {
  credentials.clear();
}
