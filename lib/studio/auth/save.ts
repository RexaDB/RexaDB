import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { insertAuthProviderConfig } from "@/lib/studio/auth/save-insert";
import { updateAuthProviderConfig } from "@/lib/studio/auth/save-update";

export async function saveAuthProviderConfig(
  connectionString: string,
  payload: AuthProviderConfig,
  exists: boolean
) {
  const now = new Date().toISOString();
  return exists
    ? updateAuthProviderConfig(connectionString, payload, now)
    : insertAuthProviderConfig(connectionString, payload, now);
}
