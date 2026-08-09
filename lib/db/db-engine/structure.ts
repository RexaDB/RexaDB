import { detectConnectionDbType } from "../connection-type";
import { getTrinoConnectionInfo } from "./trino-connection";

export async function getDbTableStructure(connectionString: string, schema: string, table: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedTableStructure(connectionString, schema, table);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseTableStructure(connectionString, schema, table);
  if (dbType === "mssql") return (await import("../mssql-client")).getTableStructure(connectionString, schema, table);
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbTableStructure(connectionString, schema, table);
  if (dbType === "jdbc") return (await import("../jdbc-client")).getJdbcTableStructure(connectionString, schema, table);
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbTableStructure(connectionString, schema, table);
  if (dbType === "trino") {
    const info = getTrinoConnectionInfo(connectionString);
    return (await import("../trino-client")).describeTable(connectionString, info.catalog, schema, table);
  }
  if (dbType === "supabase-mgmt") {
    const s = schema.replace(/'/g, "''");
    const t = table.replace(/'/g, "''");
    return (await import("../supabase-mgmt-client")).executeSupabaseMgmtQuery(
      connectionString,
      `SELECT
         a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         nt.nspname AS udt_schema,
         t.typname AS udt_name,
         CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
         CASE WHEN a.atttypmod > 0 THEN a.atttypmod - 4 ELSE NULL END::bigint AS character_maximum_length,
         (a.attnum = ANY(pk.conkey)) AS is_primary_key,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_constraint con
           WHERE con.conrelid = c.oid AND con.contype = 'f' AND a.attnum = ANY(con.conkey)
         ) AS is_foreign_key
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_catalog.pg_namespace nt ON nt.oid = t.typnamespace
       LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
       LEFT JOIN (
         SELECT conrelid, conkey
         FROM pg_catalog.pg_constraint
         WHERE contype = 'p'
       ) pk ON pk.conrelid = c.oid
       WHERE n.nspname = '${s}'
         AND c.relname = '${t}'
         AND c.relkind = 'r'
         AND a.attnum > 0
         AND NOT a.attisdropped
       ORDER BY a.attnum`
    ).then((result: any) => result.rows);
  }
  return (await import("../sql-engine")).getSqlEngineTableStructure(connectionString, schema, table);
}

export async function getDbAllTablesWithColumns(connectionString: string): Promise<any> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") return (await import("../federated")).getFederatedAllTablesWithColumns(connectionString);
  if (dbType === "clickhouse") return (await import("../clickhouse-client")).getClickhouseAllTablesWithColumns(connectionString);
  if (dbType === "mssql") return (await import("../mssql-client")).getAllTablesWithColumns(connectionString);
  if (dbType === "duckdb") return (await import("../duckdb-client")).getDuckdbAllTablesWithColumns(connectionString);
  if (dbType === "spacetimedb") return (await import("../spacetimedb-client")).getSpacetimeDbAllTablesWithColumns(connectionString);
  if (dbType === "trino") return [];
  if (dbType === "supabase-mgmt") {
    const result = await (await import("../supabase-mgmt-client")).executeSupabaseMgmtQuery(
      connectionString,
      `SELECT
         n.nspname AS table_schema,
         c.relname AS table_name,
         a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         (a.attnum = ANY(pk.conkey)) AS is_primary,
         CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
         ref_n.nspname AS referenced_table_schema,
         ref_c.relname AS referenced_table_name,
         ref_a.attname AS referenced_column_name
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN (
         SELECT conrelid, conkey
         FROM pg_catalog.pg_constraint
         WHERE contype = 'p'
       ) pk ON pk.conrelid = c.oid
       LEFT JOIN (
         SELECT conrelid, conkey[i] AS conkey, confrelid, confkey[i] AS confkey
         FROM pg_catalog.pg_constraint, generate_subscripts(conkey, 1) i
         WHERE contype = 'f'
       ) fk ON fk.conrelid = c.oid AND fk.conkey = a.attnum
       LEFT JOIN pg_catalog.pg_class ref_c ON ref_c.oid = fk.confrelid
       LEFT JOIN pg_catalog.pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
       LEFT JOIN pg_catalog.pg_attribute ref_a ON ref_a.attrelid = fk.confrelid AND ref_a.attnum = fk.confkey AND NOT ref_a.attisdropped
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND c.relkind = 'r'
       ORDER BY n.nspname, c.relname, a.attnum`
    );
    return (result as any).rows;
  }
  if (dbType === "jdbc") {
    const jdbc = await import("../jdbc-client");
    const schemas = await jdbc.getJdbcSchemas(connectionString);
    const allRows: any[] = [];
    for (const schema of schemas) {
      const tables = await jdbc.getJdbcTables(connectionString, schema);
      for (const table of tables) {
        const cols = await jdbc.getJdbcTableStructure(connectionString, schema, table.name);
        for (const col of cols) {
          allRows.push({
            table_schema: schema,
            table_name: table.name,
            column_name: col.name,
            data_type: col.type,
            is_primary: false,
            is_nullable: col.nullable ? "YES" : "NO",
            referenced_table_schema: null,
            referenced_table_name: null,
            referenced_column_name: null,
          });
        }
      }
    }
    return allRows;
  }
  return (await import("../sql-engine")).getSqlEngineAllTablesWithColumns(connectionString);
}
