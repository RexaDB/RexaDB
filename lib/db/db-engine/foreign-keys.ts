import { detectConnectionDbType } from "../connection-type";
import { normalizeStudioForeignKeys } from "../foreign-key-utils";

export async function getDbTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
): Promise<any[]> {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "federated") {
    return (await import("../federated")).getFederatedTableForeignKeys(
      connectionString,
      schema,
      table,
    );
  }
  if (dbType === "jdbc") {
    return (await import("../jdbc-client")).getJdbcForeignKeys(
      connectionString,
      schema,
      table,
    );
  }
  if (
    dbType === "clickhouse" ||
    dbType === "trino" ||
    dbType === "duckdb" ||
    dbType === "spacetimedb"
  ) {
    return [];
  }
  if (dbType === "mssql") {
    return (await import("../mssql-client")).getTableForeignKeys(
      connectionString,
      schema,
      table,
    );
  }
  if (dbType === "supabase-mgmt") {
    const { executeSupabaseMgmtQuery } = await import("../supabase-mgmt-client");
    const s = schema.replace(/'/g, "''");
    const t = table.replace(/'/g, "''");

    // Same generate_subscripts pairing used by getDbAllTablesWithColumns —
    // that path already works for SMGT schema explorer FK targets.
    try {
      const result = await executeSupabaseMgmtQuery(
        connectionString,
        `SELECT
           a.attname AS column_name,
           ref_n.nspname AS foreign_table_schema,
           ref_c.relname AS foreign_table_name,
           ref_a.attname AS foreign_column_name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         JOIN (
           SELECT conrelid, conkey[i] AS conkey, confrelid, confkey[i] AS confkey
           FROM pg_catalog.pg_constraint, generate_subscripts(conkey, 1) i
           WHERE contype = 'f'
         ) fk ON fk.conrelid = c.oid AND fk.conkey = a.attnum
         JOIN pg_catalog.pg_class ref_c ON ref_c.oid = fk.confrelid
         JOIN pg_catalog.pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
         JOIN pg_catalog.pg_attribute ref_a
           ON ref_a.attrelid = fk.confrelid
           AND ref_a.attnum = fk.confkey
           AND NOT ref_a.attisdropped
         WHERE n.nspname = '${s}'
           AND c.relname = '${t}'
           AND c.relkind = 'r'
         ORDER BY a.attnum`,
      );
      const mapped = normalizeStudioForeignKeys(result.rows ?? []);
      if (mapped.length > 0) return mapped;
    } catch {
      // try information_schema below
    }

    // Fallback for environments where generate_subscripts is restricted.
    const fallback = await executeSupabaseMgmtQuery(
      connectionString,
      `SELECT
         kcu.column_name AS column_name,
         ccu.table_schema AS foreign_table_schema,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_catalog = kcu.constraint_catalog
         AND tc.constraint_schema = kcu.constraint_schema
         AND tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_catalog = tc.constraint_catalog
         AND ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = '${s}'
         AND tc.table_name = '${t}'
       ORDER BY kcu.ordinal_position`,
    );
    return normalizeStudioForeignKeys(fallback.rows ?? []);
  }
  return (await import("../sql-engine")).getSqlEngineTableForeignKeys(
    connectionString,
    schema,
    table,
  );
}
