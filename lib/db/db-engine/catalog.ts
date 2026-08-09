import { detectConnectionDbType } from "../connection-type";
import { getTrinoConnectionInfo } from "./trino-connection";

export async function getDbSchemas(connectionString: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedSchemas(connectionString);
  if (dbType === "mongodb") return [];
  if (dbType === "redis") return [];
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseDatabases(connectionString);
  if (dbType === "mssql") return (await import("../mssql-client")).getSchemas(connectionString);
  if (dbType === "trino") return (await import("../trino-client")).listSchemas(connectionString, getTrinoConnectionInfo(connectionString).catalog);
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbSchemas(connectionString);
  if (dbType === "jdbc") return (await import("../jdbc-client")).getJdbcSchemas(connectionString);
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbSchemas(connectionString);
  if (dbType === "supabase-mgmt") {
    const { executeSupabaseMgmtQuery } = await import("../supabase-mgmt-client");
    const result = await executeSupabaseMgmtQuery(
      connectionString,
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_toast', 'pg_catalog', 'information_schema') ORDER BY schema_name`
    );
    return (result.rows ?? []).map((r: any) => r.schema_name);
  }
  return (await import("../sql-engine")).getSqlEngineSchemas(connectionString);
}

export async function getDbDatabases(connectionString: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedDatabases(connectionString);
  if (dbType === "mongodb") return (await import("../mongo-client")).getMongoDatabases(connectionString);
  if (dbType === "redis") return (await import("../redis-client")).getRedisDatabases(connectionString);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseDatabases(connectionString);
  if (dbType === "mssql") return (await import("../mssql-client")).getDatabases(connectionString);
  if (dbType === "trino") return (await import("../trino-client")).listCatalogs(connectionString);
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbDatabases(connectionString);
  if (dbType === "jdbc") return (await import("../jdbc-client")).getJdbcSchemas(connectionString);
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbDatabases(connectionString);
  if (dbType === "supabase-mgmt") return [];
  return (await import("../sql-engine")).getSqlEngineDatabases(connectionString);
}

export async function getDbTables(connectionString: string, schema: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedTables(connectionString, schema);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseTables(connectionString, schema);
  if (dbType === "mssql") return (await import("../mssql-client")).getTables(connectionString, schema);
  if (dbType === "trino") return (await import("../trino-client")).listTables(connectionString, getTrinoConnectionInfo(connectionString).catalog, schema);
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbTables(connectionString, schema);
  if (dbType === "jdbc") {
    const tables = await (await import("../jdbc-client")).getJdbcTables(connectionString, schema);
    return tables.filter(t => t.type === "TABLE").map(t => t.name);
  }
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbTables(connectionString, schema);
  if (dbType === "supabase-mgmt") {
    const { executeSupabaseMgmtQuery } = await import("../supabase-mgmt-client");
    const s = schema.replace(/'/g, "''");
    const result = await executeSupabaseMgmtQuery(
      connectionString,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${s}' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    return (result.rows ?? []).map((r: any) => r.table_name);
  }
  return (await import("../sql-engine")).getSqlEngineTables(connectionString, schema);
}

export async function getDbViews(connectionString: string, schema: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedViews(connectionString, schema);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseViews(connectionString, schema);
  if (dbType === "mssql") return (await import("../mssql-client")).getViews(connectionString, schema);
  if (dbType === "trino") return [];
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbViews(connectionString, schema);
  if (dbType === "jdbc") {
    const tables = await (await import("../jdbc-client")).getJdbcTables(connectionString, schema);
    return tables.filter(t => t.type === "VIEW").map(t => t.name);
  }
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbViews(connectionString, schema);
  if (dbType === "supabase-mgmt") {
    const { executeSupabaseMgmtQuery } = await import("../supabase-mgmt-client");
    const s = schema.replace(/'/g, "''");
    const result = await executeSupabaseMgmtQuery(
      connectionString,
      `SELECT table_name FROM information_schema.views WHERE table_schema = '${s}' ORDER BY table_name`
    );
    return (result.rows ?? []).map((r: any) => r.table_name);
  }
  return (await import("../sql-engine")).getSqlEngineViews(connectionString, schema);
}
