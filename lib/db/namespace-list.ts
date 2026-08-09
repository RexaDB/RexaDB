import { fetchDatabases, fetchSchemas } from "../api/actions-client";
import type { ConnectionDbType } from "./connection-type";
import { detectConnectionDbType } from "./connection-type";
import { usesDatabaseNamespaces } from "./namespace-display";

type NamespaceResult = { success: boolean; data?: string[]; error?: string };

export async function fetchNamespaceList(
  connectionString: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number }
): Promise<NamespaceResult> {
  const dbType: ConnectionDbType = detectConnectionDbType(connectionString);
  if (dbType === "sqlite") {
    return await fetchSchemas(connectionString);
  }
  if (usesDatabaseNamespaces(dbType)) {
    return await fetchDatabases(connectionString);
  }
  return await fetchSchemas(connectionString);
}
