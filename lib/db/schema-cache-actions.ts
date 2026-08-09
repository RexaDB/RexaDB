import { runCoreTransaction } from "./sqlite-helpers";

async function readSchemaCacheMeta(connectionString: string, ensureCoreTables: () => Promise<void>) {
  const { db } = await import("./index");
  const { schemaCacheMeta } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  await ensureCoreTables();
  const rows = await db
    .select()
    .from(schemaCacheMeta)
    .where(eq(schemaCacheMeta.connectionString, connectionString))
    .limit(1);
  return rows[0] ?? null;
}

function isCacheFresh(updatedAt: number | null | undefined, maxAgeMs: number) {
  if (!updatedAt || !Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt < maxAgeMs;
}

export type CachedColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string | null;
  is_nullable: string;
  is_primary: boolean;
  referenced_table_schema: string | null;
  referenced_table_name: string | null;
  referenced_column_name: string | null;
};

export async function readCachedSchemas(connectionString: string, maxAgeMs: number, ensureCoreTables: () => Promise<void>): Promise<string[] | null> {
  const meta = await readSchemaCacheMeta(connectionString, ensureCoreTables);
  if (!meta || !isCacheFresh(meta.schemasUpdatedAt ?? undefined, maxAgeMs)) return null;

  const { db } = await import("./index");
  const { schemaCacheSchemas } = await import("./schema");
  const { eq, asc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(schemaCacheSchemas)
    .where(eq(schemaCacheSchemas.connectionString, connectionString))
    .orderBy(asc(schemaCacheSchemas.schemaName));
  return rows.map((row) => String(row.schemaName));
}

export async function getCachedSchemasSnapshot(connectionString: string, ensureCoreTables: () => Promise<void>): Promise<string[]> {
  const { db } = await import("./index");
  const { schemaCacheSchemas } = await import("./schema");
  const { eq, asc } = await import("drizzle-orm");

  await ensureCoreTables();
  const rows = await db
    .select()
    .from(schemaCacheSchemas)
    .where(eq(schemaCacheSchemas.connectionString, connectionString))
    .orderBy(asc(schemaCacheSchemas.schemaName));
  return rows.map((row) => String(row.schemaName));
}

export async function writeCachedSchemas(connectionString: string, schemas: string[], ensureCoreTables: () => Promise<void>) {
  const { schemaCacheSchemas } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const now = Date.now();

  await ensureCoreTables();
  await runCoreTransaction("writeCachedSchemas", async (db) => {
    await db.delete(schemaCacheSchemas).where(eq(schemaCacheSchemas.connectionString, connectionString));
    if (schemas.length > 0) {
      await db.insert(schemaCacheSchemas).values(
        schemas.map((schemaName) => ({ connectionString, schemaName }))
      );
    }
  });

  const { db } = await import("./index");
  await db.run(sql`
    INSERT INTO schema_cache_meta (connection_string, schemas_updated_at)
    VALUES (${connectionString}, ${now})
    ON CONFLICT(connection_string) DO UPDATE SET schemas_updated_at = excluded.schemas_updated_at
  `);
}

export async function readCachedTables(connectionString: string, schema: string, maxAgeMs: number, ensureCoreTables: () => Promise<void>): Promise<string[] | null> {
  const meta = await readSchemaCacheMeta(`${connectionString}|${schema}`, ensureCoreTables);
  if (!meta || !isCacheFresh(meta.tablesUpdatedAt ?? undefined, maxAgeMs)) return null;

  const { db } = await import("./index");
  const { schemaCacheTables } = await import("./schema");
  const { eq, and, asc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(schemaCacheTables)
    .where(and(
      eq(schemaCacheTables.connectionString, connectionString),
      eq(schemaCacheTables.schemaName, schema)
    ))
    .orderBy(asc(schemaCacheTables.tableName));
  return rows.map((row) => String(row.tableName));
}

export async function getCachedTablesSnapshot(connectionString: string, schema: string, ensureCoreTables: () => Promise<void>): Promise<string[]> {
  const { db } = await import("./index");
  const { schemaCacheTables } = await import("./schema");
  const { eq, and, asc } = await import("drizzle-orm");

  await ensureCoreTables();
  const rows = await db
    .select()
    .from(schemaCacheTables)
    .where(and(
      eq(schemaCacheTables.connectionString, connectionString),
      eq(schemaCacheTables.schemaName, schema)
    ))
    .orderBy(asc(schemaCacheTables.tableName));
  return rows.map((row) => String(row.tableName));
}

export async function writeCachedTables(connectionString: string, schema: string, tables: string[], ensureCoreTables: () => Promise<void>) {
  const { schemaCacheTables } = await import("./schema");
  const { eq, and } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const now = Date.now();

  await ensureCoreTables();
  await runCoreTransaction("writeCachedTables", async (db) => {
    await db
      .delete(schemaCacheTables)
      .where(and(
        eq(schemaCacheTables.connectionString, connectionString),
        eq(schemaCacheTables.schemaName, schema)
      ));
    if (tables.length > 0) {
      await db.insert(schemaCacheTables).values(
        tables.map((tableName) => ({ connectionString, schemaName: schema, tableName }))
      );
    }
  });

  const { db } = await import("./index");
  await db.run(sql`
    INSERT INTO schema_cache_meta (connection_string, tables_updated_at)
    VALUES (${connectionString + "|" + schema}, ${now})
    ON CONFLICT(connection_string) DO UPDATE SET tables_updated_at = excluded.tables_updated_at
  `);
}

export async function readCachedColumns(connectionString: string, maxAgeMs: number, ensureCoreTables: () => Promise<void>, schema?: string): Promise<CachedColumnRow[] | null> {
  const meta = await readSchemaCacheMeta(schema ? `${connectionString}|${schema}` : connectionString, ensureCoreTables);
  if (!meta || !isCacheFresh(meta.columnsUpdatedAt ?? undefined, maxAgeMs)) return null;

  const { db } = await import("./index");
  const { schemaCacheColumns } = await import("./schema");
  const { eq, and, asc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(schemaCacheColumns)
    .where(and(
      eq(schemaCacheColumns.connectionString, connectionString),
      schema ? eq(schemaCacheColumns.schemaName, schema) : undefined
    ))
    .orderBy(
      asc(schemaCacheColumns.schemaName),
      asc(schemaCacheColumns.tableName),
      asc(schemaCacheColumns.columnName)
    );

  return rows.map((row) => ({
    table_schema: String(row.schemaName),
    table_name: String(row.tableName),
    column_name: String(row.columnName),
    data_type: row.dataType ? String(row.dataType) : null,
    is_nullable: row.isNullable ? "YES" : "NO",
    is_primary: Boolean(row.isPrimary),
    referenced_table_schema: row.referencedTableSchema ? String(row.referencedTableSchema) : null,
    referenced_table_name: row.referencedTableName ? String(row.referencedTableName) : null,
    referenced_column_name: row.referencedColumnName ? String(row.referencedColumnName) : null,
  }));
}

export async function writeCachedColumns(connectionString: string, rows: CachedColumnRow[], ensureCoreTables: () => Promise<void>, schema?: string) {
  const { schemaCacheColumns } = await import("./schema");
  const { eq, and } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const now = Date.now();

  await ensureCoreTables();
  await runCoreTransaction("writeCachedColumns", async (db) => {
    await db.delete(schemaCacheColumns).where(and(
      eq(schemaCacheColumns.connectionString, connectionString),
      schema ? eq(schemaCacheColumns.schemaName, schema) : undefined
    ));
    if (rows.length > 0) {
      await db.insert(schemaCacheColumns).values(
        rows.map((row) => ({
          connectionString,
          schemaName: String(row.table_schema || ""),
          tableName: String(row.table_name || ""),
          columnName: String(row.column_name || ""),
          dataType: row.data_type ? String(row.data_type) : null,
          isNullable: row.is_nullable === "YES",
          isPrimary: Boolean(row.is_primary),
          referencedTableSchema: row.referenced_table_schema ? String(row.referenced_table_schema) : null,
          referencedTableName: row.referenced_table_name ? String(row.referenced_table_name) : null,
          referencedColumnName: row.referenced_column_name ? String(row.referenced_column_name) : null,
        }))
      );
    }
  });

  const { db } = await import("./index");
  await db.run(sql`
    INSERT INTO schema_cache_meta (connection_string, columns_updated_at)
    VALUES (${schema ? connectionString + "|" + schema : connectionString}, ${now})
    ON CONFLICT(connection_string) DO UPDATE SET columns_updated_at = excluded.columns_updated_at
  `);
}
