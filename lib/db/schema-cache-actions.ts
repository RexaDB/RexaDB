import { runCoreTransaction } from "./sqlite-helpers";

async function readSchemaCacheMeta(connectionString: string, ensureCoreTables: () => Promise<void>) {
  const { client } = await import("./index");

  await ensureCoreTables();
  return await client.schemaCacheMeta.findFirst({
    where: { connectionString },
  });
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

  const { client } = await import("./index");
  const rows = await client.schemaCacheSchemas.findMany({
    where: { connectionString },
    orderBy: { schemaName: "asc" },
  });
  return rows.map((row) => String(row.schemaName));
}

export async function getCachedSchemasSnapshot(connectionString: string, ensureCoreTables: () => Promise<void>): Promise<string[]> {
  const { client } = await import("./index");

  await ensureCoreTables();
  const rows = await client.schemaCacheSchemas.findMany({
    where: { connectionString },
    orderBy: { schemaName: "asc" },
  });
  return rows.map((row) => String(row.schemaName));
}

export async function writeCachedSchemas(connectionString: string, schemas: string[], ensureCoreTables: () => Promise<void>) {
  const { schemaCacheSchemas } = await import("./schema");
  const { eq } = await import("drizzle-orm");
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

  const { client } = await import("./index");
  await client.schemaCacheMeta.upsert({
    where: { connectionString },
    create: { connectionString, schemasUpdatedAt: now },
    update: { schemasUpdatedAt: now },
  });
}

export async function readCachedTables(connectionString: string, schema: string, maxAgeMs: number, ensureCoreTables: () => Promise<void>): Promise<string[] | null> {
  const meta = await readSchemaCacheMeta(`${connectionString}|${schema}`, ensureCoreTables);
  if (!meta || !isCacheFresh(meta.tablesUpdatedAt ?? undefined, maxAgeMs)) return null;

  const { client } = await import("./index");
  const rows = await client.schemaCacheTables.findMany({
    where: { connectionString, schemaName: schema },
    orderBy: { tableName: "asc" },
  });
  return rows.map((row) => String(row.tableName));
}

export async function getCachedTablesSnapshot(connectionString: string, schema: string, ensureCoreTables: () => Promise<void>): Promise<string[]> {
  const { client } = await import("./index");

  await ensureCoreTables();
  const rows = await client.schemaCacheTables.findMany({
    where: { connectionString, schemaName: schema },
    orderBy: { tableName: "asc" },
  });
  return rows.map((row) => String(row.tableName));
}

export async function writeCachedTables(connectionString: string, schema: string, tables: string[], ensureCoreTables: () => Promise<void>) {
  const { schemaCacheTables } = await import("./schema");
  const { eq, and } = await import("drizzle-orm");
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

  const { client } = await import("./index");
  await client.schemaCacheMeta.upsert({
    where: { connectionString: connectionString + "|" + schema },
    create: { connectionString: connectionString + "|" + schema, tablesUpdatedAt: now },
    update: { tablesUpdatedAt: now },
  });
}

export async function readCachedColumns(connectionString: string, maxAgeMs: number, ensureCoreTables: () => Promise<void>, schema?: string): Promise<CachedColumnRow[] | null> {
  const meta = await readSchemaCacheMeta(schema ? `${connectionString}|${schema}` : connectionString, ensureCoreTables);
  if (!meta || !isCacheFresh(meta.columnsUpdatedAt ?? undefined, maxAgeMs)) return null;

  const { client } = await import("./index");
  const rows = await client.schemaCacheColumns.findMany({
    where: {
      connectionString,
      ...(schema ? { schemaName: schema } : {}),
    },
    orderBy: [{ schemaName: "asc" }, { tableName: "asc" }, { columnName: "asc" }],
  });

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

  const metaKey = schema ? connectionString + "|" + schema : connectionString;
  const { client } = await import("./index");
  await client.schemaCacheMeta.upsert({
    where: { connectionString: metaKey },
    create: { connectionString: metaKey, columnsUpdatedAt: now },
    update: { columnsUpdatedAt: now },
  });
}
