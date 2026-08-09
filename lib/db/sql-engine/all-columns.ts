import { getSqlEngineKind } from "./detect";

export async function getSqlEngineAllTablesWithColumns(connectionString: string, schema?: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteAllTablesWithColumns(connectionString);
  if (engine === "mysql") return (await import("../mysql-client")).getAllTablesWithColumns(connectionString, schema);
  if (engine === "postgres") return await getPostgresAllTablesWithColumns(connectionString);
  throw new Error("Unsupported SQL engine.");
}

async function getPostgresAllTablesWithColumns(connectionString: string) {
  const { executeQuery } = await import("../pg-client");
  const sql = `
    SELECT cols.table_schema, cols.table_name, cols.column_name, cols.data_type, cols.is_nullable, cols.column_default,
      (SELECT count(*) FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu2 ON tc.constraint_name = kcu2.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND kcu2.table_schema = cols.table_schema
          AND kcu2.table_name = cols.table_name AND kcu2.column_name = cols.column_name) > 0 as is_primary,
      kcu.referenced_table_schema, kcu.referenced_table_name, kcu.referenced_column_name
    FROM information_schema.columns cols
    LEFT JOIN (
      SELECT kcu1.table_schema, kcu1.table_name, kcu1.column_name, kcu2.table_schema AS referenced_table_schema,
        kcu2.table_name AS referenced_table_name, kcu2.column_name AS referenced_column_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu1 ON rc.constraint_name = kcu1.constraint_name AND rc.constraint_schema = kcu1.constraint_schema
      JOIN information_schema.key_column_usage kcu2 ON rc.unique_constraint_name = kcu2.constraint_name AND rc.unique_constraint_schema = kcu2.constraint_schema AND kcu1.ordinal_position = kcu2.ordinal_position
    ) kcu ON cols.table_schema = kcu.table_schema AND cols.table_name = kcu.table_name AND cols.column_name = kcu.column_name
    WHERE cols.table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position;
  `;
  const result = await executeQuery(connectionString, sql);
  return Array.isArray(result?.rows) ? result.rows : [];
}
