import { detectConnectionDbType } from "../connection-type";

export async function getDbTableForeignKeys(connectionString: string, schema: string, table: string): Promise<any[]> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") {
    return (await import("../federated")).getFederatedTableForeignKeys(connectionString, schema, table);
  }
  if (dbType === "jdbc") return (await import("../jdbc-client")).getJdbcForeignKeys(connectionString, schema, table);
  if (dbType === "clickhouse" || dbType === "trino" || dbType === "duckdb" || dbType === "spacetimedb") {
    return [];
  }
  if (dbType === "mssql") {
    return (await import("../mssql-client")).getTableForeignKeys(connectionString, schema, table);
  }
  if (dbType === "supabase-mgmt") {
    const { executeSupabaseMgmtQuery } = await import("../supabase-mgmt-client");
    const s = schema.replace(/'/g, "''");
    const t = table.replace(/'/g, "''");
    const result = await executeSupabaseMgmtQuery(
      connectionString,
      `SELECT
         a.attname AS column_name,
         ref_n.nspname AS referenced_schema,
         ref_c.relname AS referenced_table,
         ref_a.attname AS referenced_column
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) AND NOT a.attisdropped
       JOIN pg_catalog.pg_class ref_c ON ref_c.oid = con.confrelid
       JOIN pg_catalog.pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
       JOIN pg_catalog.pg_attribute ref_a ON ref_a.attrelid = con.confrelid AND ref_a.attnum = ANY(con.confkey) AND NOT ref_a.attisdropped
       JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'f'
         AND n.nspname = '${s}'
         AND c.relname = '${t}'
       ORDER BY array_position(con.conkey, a.attnum)`
    );
    return (result.rows ?? []).map((r: any) => ({
      column_name: r.column_name,
      referenced_schema: r.referenced_schema,
      referenced_table: r.referenced_table,
      referenced_column: r.referenced_column,
    }));
  }
  return (await import("../sql-engine")).getSqlEngineTableForeignKeys(connectionString, schema, table);
}
