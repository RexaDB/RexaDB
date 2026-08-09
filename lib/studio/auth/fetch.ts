import { runQuery } from "@/lib/api/actions-client";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

export async function fetchAuthProviderConfigs(connectionString: string) {
  const query = `SELECT * FROM auth.custom_oauth_providers ORDER BY name;`;
  const res = await runQuery(connectionString, query);
  if (!res.success) throw new Error(res.error || "Failed to load auth providers.");
  const rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
  return rows as AuthProviderConfig[];
}
