import { transferQuery } from "@/lib/transfer/transfer-sql";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

export async function fetchAuthProviderConfigs(connectionString: string) {
  const query = `SELECT * FROM auth.custom_oauth_providers ORDER BY name;`;
  const res = await transferQuery(connectionString, query);
  if (!res.success) {
    throw new Error(
      typeof res.error === "string" && res.error ? res.error : "Failed to load auth providers.",
    );
  }
  const rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
  return rows as unknown as AuthProviderConfig[];
}
