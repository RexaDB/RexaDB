import { detectConnectionDbType } from "../connection-type";
import type { QueryExecutionContext } from "@/lib/studio/table-permissions";

export async function executeDbQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
  options: { queryId?: string; connectionType?: string; executionContext?: QueryExecutionContext | null } = {}
): Promise<any> {
  const dbType = detectConnectionDbType(connectionString, options.connectionType);
  if (dbType === "supabase-mgmt") return (await import("../supabase-mgmt-client")).executeSupabaseMgmtQuery(connectionString, query);
  if (dbType === "federated") return (await import("../federated")).executeFederatedQuery(connectionString, query, params);
  if (dbType === "mongodb") return (await import("../mongo-client")).executeMongoQuery(connectionString, query);
  if (dbType === "redis") return (await import("../redis-client")).executeRedisCommand(connectionString, query);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).executeClickhouseQuery(connectionString, query, params);
  if (dbType === "mssql") return (await import("../mssql-client")).executeMssqlQuery(connectionString, query, params);
  if (dbType === "trino") return (await import("../trino-client")).executeTrinoQuery(connectionString, query);
  if (dbType === "duckdb") return (await import("../duckdb-client")).executeDuckdbQuery(connectionString, query, params);
  if (dbType === "jdbc") return (await import("../jdbc-client")).executeJdbcQuery(connectionString, query, params);
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).executeSpacetimeDbQuery(connectionString, query);
  if ((await import("../sql-engine")).isSupportedSqlEngine(connectionString)) {
    return (await import("../sql-engine")).executeSqlEngineQuery(connectionString, query, params, options);
  }
  throw new Error(`Unsupported engine: ${dbType}`);
}
