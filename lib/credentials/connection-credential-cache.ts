type SecretBundle = { connectionString?: string; password?: string | null; authToken?: string | null };
const credentials = new Map<string, SecretBundle>();

export function cacheConnectionCredential(reference: string, secret: SecretBundle) {
  credentials.set(reference, secret);
}

export function getCachedConnectionCredential(reference: string) {
  return credentials.get(reference);
}

export function removeCachedConnectionCredential(reference: string) {
  credentials.delete(reference);
}

export function clearCachedConnectionCredentials() {
  credentials.clear();
}
