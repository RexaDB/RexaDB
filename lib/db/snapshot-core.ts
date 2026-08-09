import { detectConnectionDbType } from "./connection-type";
import { hashSchema, sanitizeSnapshotName, generateSnapshotId, escapeSqlString, quoteIdent } from "./snapshot-types";
import type {
  DatabaseSnapshot, SnapshotMeta, SchemaDef, TableDef, ColumnDef, ViewDef, EnumDef,
  IndexDef, ForeignKeyDef, SnapshotDiff, SchemaChange, DataChange,
  SnapshotProgressEvent,
} from "./snapshot-types";
import { mapPgIndexRow, mapSqliteIndexRow } from "./index-def-helpers";
import { getSqlEngineKind } from "./sql-engine/detect";
import type { WriteStream } from "fs";

type Engine = "postgres" | "mysql" | "sqlite";

const MAX_SNAPSHOT_ROWS_PER_TABLE = 500;

function groupForeignKeys<Key extends string | number>(
  rows: any[],
  keyFn: (r: any) => Key,
  nameFn: (r: any, key: Key) => string,
  colFn: (r: any) => string,
  foreignColFn: (r: any) => string,
  schemaFn: (r: any) => string,
  tableFn: (r: any) => string,
): ForeignKeyDef[] {
  const fkMap = new Map<Key, ForeignKeyDef>();
  for (const r of rows) {
    const key = keyFn(r);
    if (!fkMap.has(key)) {
      fkMap.set(key, {
        name: nameFn(r, key),
        columns: [],
        foreignSchema: schemaFn(r),
        foreignTable: tableFn(r),
        foreignColumns: [],
      });
    }
    const fk = fkMap.get(key)!;
    fk.columns.push(colFn(r));
    fk.foreignColumns.push(foreignColFn(r));
  }
  return Array.from(fkMap.values());
}

function mapColumnDef(
  name: string,
  dataType: string,
  isNullable: boolean,
  defaultValue: string | null,
  isPrimary: boolean,
): ColumnDef {
  return { name, dataType, isNullable, defaultValue, isPrimary };
}

function buildOrderClause(engine: Engine, table: TableDef): string {
  if (engine === "sqlite") return " ORDER BY rowid";
  const orderCols = table.primaryKey.length > 0 ? table.primaryKey : [table.columns[0]?.name].filter(Boolean);
  if (orderCols.length === 0) return "";
  return " ORDER BY " + orderCols.map(c => quoteIdent(engine, c)).join(", ");
}

function diffMapKeys<T>(
  oldMap: Map<string, T>,
  newMap: Map<string, T>,
  entityType: string,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const [key] of newMap) {
    if (!oldMap.has(key)) changes.push({ type: entityType as any, action: "added", entityName: key });
  }
  for (const [key] of oldMap) {
    if (!newMap.has(key)) changes.push({ type: entityType as any, action: "removed", entityName: key });
  }
  return changes;
}

function buildSnapshotMeta(
  name: string, description: string, engine: Engine, connStr: string,
  schema: SchemaDef,
): { id: string; meta: SnapshotMeta; schemaSQL: string } {
  const schemaSQL = generateSchemaSQL(schema, engine);
  const id = generateSnapshotId() + "-" + sanitizeSnapshotName(name);
  const meta: SnapshotMeta = {
    id, name, description,
    createdAt: new Date().toISOString(),
    engine, connectionString: connStr,
    tableCount: schema.tables.length, rowCount: 0,
    schemaHash: hashSchema(schema),
  };
  return { id, meta, schemaSQL };
}

async function prepareSnapshotDir(connectionId: string, id: string) {
  const fs = await import("fs");
  const fsp = await import("fs/promises");
  const pathMod = await import("path");
  const dir = getSnapshotDir(connectionId);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = pathMod.join(dir, `${id}.json`);
  return { filePath, fs, fsp, pathMod, dir };
}

function getEngine(connStr: string): Engine {
  const dbType = detectConnectionDbType(connStr);
  if (dbType === "postgres" || dbType === "supabase-mgmt") return "postgres";
  if (dbType === "mysql") return "mysql";
  if (dbType === "sqlite") return "sqlite";
  throw new Error("Snapshots only support PostgreSQL, MySQL, and SQLite");
}

function isSqlEngine(connStr: string): boolean {
  return getSqlEngineKind(connStr) !== null;
}

function quoteTableRef(engine: Engine, schema: string, table: string): string {
  const q = (n: string) => quoteIdent(engine, n);
  return `${q(schema)}.${q(table)}`;
}

async function runEngineQuery(
  connStr: string,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[] }> {
  const engine = getEngine(connStr);
  if (engine === "postgres") {
    const { executeQuery } = await import("./pg-client");
    return executeQuery(connStr, sql, params);
  }
  if (engine === "mysql") {
    const { executeMysqlQuery } = await import("./mysql-client");
    return executeMysqlQuery(connStr, sql, params);
  }
  const { executeSqliteQuery } = await import("./sqlite-client");
  return executeSqliteQuery(connStr, sql, params);
}

export async function extractSchema(connStr: string): Promise<SchemaDef> {
  const engine = getEngine(connStr);
  if (engine === "postgres") return extractPgSchema(connStr);
  if (engine === "mysql") return extractMysqlSchema(connStr);
  return extractSqliteSchema(connStr);
}

async function extractPgSchema(connStr: string): Promise<SchemaDef> {
  const { executeQuery } = await import("./pg-client");

  const schemasRes = await executeQuery(
    connStr,
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
       AND schema_name NOT LIKE 'pg_toast%'
       AND schema_name NOT LIKE 'pg_temp%'
     ORDER BY schema_name`,
  );
  const schemas = schemasRes.rows.map((r: any) => r.schema_name as string);

  const allTables: TableDef[] = [];
  const allViews: ViewDef[] = [];
  const allEnums: EnumDef[] = [];

  for (const schema of schemas) {
    const tablesRes = await executeQuery(
      connStr,
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    );
    const tableNames = tablesRes.rows.map((r: any) => r.table_name as string);

    for (const table of tableNames) {
      const colsRes = await executeQuery(
        connStr,
        `SELECT
          c.column_name, c.data_type, c.is_nullable, c.column_default,
          (SELECT count(*) FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name) > 0 AS is_primary
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table],
      );

      const columns: ColumnDef[] = colsRes.rows.map((r: any) =>
        mapColumnDef(r.column_name, r.data_type, r.is_nullable === "YES", r.column_default ?? null, r.is_primary === true || r.is_primary === "true" || r.is_primary === 1),
      );

      const pkCols = columns.filter(c => c.isPrimary).map(c => c.name);

      // fallow-ignore-next-line code-duplication
      let indexes: IndexDef[] = [];
      try {
        const idxRes = await executeQuery(
          connStr,
          `SELECT i.indexname, i.indexdef FROM pg_indexes i
           WHERE i.schemaname = $1 AND i.tablename = $2
             AND i.indexname NOT LIKE '%_pkey'
           ORDER BY i.indexname`,
          [schema, table],
        );
        indexes = idxRes.rows.map(mapPgIndexRow);
      } catch {}

      let foreignKeys: ForeignKeyDef[] = [];
      try {
        const fkRes = await executeQuery(
          connStr,
          `SELECT
            tc.constraint_name,
            kcu.column_name,
            ccu.table_schema AS foreign_schema,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
           WHERE tc.constraint_type = 'FOREIGN KEY'
             AND tc.table_schema = $1
             AND tc.table_name = $2
           ORDER BY tc.constraint_name, kcu.ordinal_position`,
          [schema, table],
        );
        foreignKeys = groupForeignKeys(
          fkRes.rows,
          (r) => r.constraint_name as string,
          (_r, key) => key as string,
          (r) => r.column_name as string,
          (r) => r.foreign_column as string,
          (r) => r.foreign_schema as string,
          (r) => r.foreign_table as string,
        );
      } catch {}

      allTables.push({ schema, name: table, columns, primaryKey: pkCols, indexes, foreignKeys });
    }

    const viewsRes = await executeQuery(
      connStr,
      `SELECT table_name, view_definition FROM information_schema.views
       WHERE table_schema = $1 ORDER BY table_name`,
      [schema],
    );
    for (const r of viewsRes.rows) {
      allViews.push({ schema, name: r.table_name as string, definition: (r.view_definition as string) || "" });
    }
  }

  try {
    const enumRes = await executeQuery(
      connStr,
      `SELECT n.nspname AS schema, t.typname AS name,
              array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_namespace n ON t.typnamespace = n.oid
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       GROUP BY n.nspname, t.typname
       ORDER BY t.typname`,
    );
    for (const r of enumRes.rows) {
      allEnums.push({ schema: r.schema as string, name: r.name as string, values: (r.values as string[]) || [] });
    }
  } catch {}

  return { tables: allTables, views: allViews, enums: allEnums };
}

async function extractMysqlSchema(connStr: string): Promise<SchemaDef> {
  const { executeMysqlQuery } = await import("./mysql-client");

  const schemasRes = await executeMysqlQuery(
    connStr,
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
     ORDER BY schema_name`,
  );
  const schemas = schemasRes.rows.map((r: any) => String(r.schema_name || ""));

  const allTables: TableDef[] = [];
  const allViews: ViewDef[] = [];

  for (const schema of schemas) {
    const tablesRes = await executeMysqlQuery(
      connStr,
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    );
    const tableNames = tablesRes.rows.map((r: any) => String(r.table_name || ""));

    for (const table of tableNames) {
      const colsRes = await executeMysqlQuery(
        connStr,
        `SELECT column_name, data_type, is_nullable, column_default,
                CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary
         FROM information_schema.columns c
         LEFT JOIN information_schema.key_column_usage pk
           ON c.table_schema = pk.table_schema AND c.table_name = pk.table_name
           AND c.column_name = pk.column_name AND pk.constraint_name = 'PRIMARY'
         WHERE c.table_schema = ? AND c.table_name = ?
         ORDER BY c.ordinal_position`,
        [schema, table],
      );

      const columns: ColumnDef[] = colsRes.rows.map((r: any) =>
        mapColumnDef(String(r.column_name || ""), String(r.data_type || ""), String(r.is_nullable || "") === "YES", r.column_default != null ? String(r.column_default) : null, Number(r.is_primary || 0) > 0),
      );

      const pkCols = columns.filter(c => c.isPrimary).map(c => c.name);

      const fkRes = await executeMysqlQuery(
        connStr,
        `SELECT kcu.constraint_name, kcu.column_name,
                kcu.referenced_table_schema AS foreign_schema,
                kcu.referenced_table_name AS foreign_table,
                kcu.referenced_column_name AS foreign_column
         FROM information_schema.key_column_usage kcu
         WHERE kcu.table_schema = ? AND kcu.table_name = ?
           AND kcu.referenced_table_name IS NOT NULL
         ORDER BY kcu.constraint_name, kcu.ordinal_position`,
        [schema, table],
      );
      const foreignKeys = groupForeignKeys(
        fkRes.rows,
        (r) => String(r.constraint_name || ""),
        (_r, key) => key as string,
        (r) => String(r.column_name || ""),
        (r) => String(r.foreign_column || ""),
        (r) => String(r.foreign_schema || ""),
        (r) => String(r.foreign_table || ""),
      );

      allTables.push({ schema, name: table, columns, primaryKey: pkCols, indexes: [], foreignKeys });
    }

    const viewsRes = await executeMysqlQuery(
      connStr,
      `SELECT table_name AS name, view_definition AS definition
       FROM information_schema.views
       WHERE table_schema = ?
       ORDER BY table_name`,
      [schema],
    );
    for (const r of viewsRes.rows) {
      allViews.push({
        schema,
        name: String(r.name || ""),
        definition: String(r.definition || ""),
      });
    }
  }

  return { tables: allTables, views: allViews, enums: [] };
}

async function extractSqliteSchema(connStr: string): Promise<SchemaDef> {
  const { executeSqliteQuery } = await import("./sqlite-client");

  const schemasRes = await executeSqliteQuery(connStr, "PRAGMA database_list;");
  const schemas = schemasRes.rows.map((r: any) => String(r.name || "main"));

  const allTables: TableDef[] = [];
  const allViews: ViewDef[] = [];

  for (const schema of schemas) {
    const q = (n: string) => `"${n.replace(/"/g, '""')}"`;

    const tablesRes = await executeSqliteQuery(
      connStr,
      `SELECT name FROM ${q(schema)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const tableNames = tablesRes.rows.map((r: any) => String(r.name || ""));

    for (const table of tableNames) {
      const colsRes = await executeSqliteQuery(
        connStr,
        `PRAGMA ${q(schema)}.table_info(${q(table)})`,
      );
      const columns: ColumnDef[] = colsRes.rows.map((r: any) =>
        mapColumnDef(String(r.name || ""), String(r.type || "TEXT"), Number(r.notnull || 0) === 0, r.dflt_value != null ? String(r.dflt_value) : null, Number(r.pk || 0) > 0),
      );
      const pkCols = columns.filter(c => c.isPrimary).map(c => c.name);

      // fallow-ignore-next-line code-duplication
      let indexes: IndexDef[] = [];
      try {
        const idxRes = await executeSqliteQuery(connStr, `PRAGMA ${q(schema)}.index_list(${q(table)})`);
        for (const idxRow of idxRes.rows) {
          const idxName = String(idxRow.name || "");
          if (idxName.startsWith("sqlite_autoindex")) continue;
          const infoRes = await executeSqliteQuery(connStr, `PRAGMA ${q(schema)}.index_info(${q(idxName)})`);
          const idxCols = infoRes.rows.map((r: any) => String(r.name || ""));
          indexes.push(mapSqliteIndexRow(idxRow, idxCols));
        }
      } catch {}

      let foreignKeys: ForeignKeyDef[] = [];
      try {
        const fkRes = await executeSqliteQuery(connStr, `PRAGMA ${q(schema)}.foreign_key_list(${q(table)})`);
        foreignKeys = groupForeignKeys(
          fkRes.rows,
          (r) => Number(r.id || 0),
          (_r, key) => `fk_${table}_${key}`,
          (r) => String(r.from || ""),
          (r) => String(r.to || ""),
          () => schema,
          (r) => String(r.table || ""),
        );
      } catch {}

      allTables.push({ schema, name: table, columns, primaryKey: pkCols, indexes, foreignKeys });
    }

    const viewsRes = await executeSqliteQuery(
      connStr,
      `SELECT name, sql FROM ${q(schema)}.sqlite_master WHERE type = 'view' ORDER BY name`,
    );
    for (const r of viewsRes.rows) {
      allViews.push({
        schema,
        name: String(r.name || ""),
        definition: (r.sql as string) || "",
      });
    }
  }

  return { tables: allTables, views: allViews, enums: [] };
}

export async function createSnapshot(
  connStr: string,
  name: string,
  description: string,
  connectionId: string,
): Promise<SnapshotMeta> {
  const engine = getEngine(connStr);
  const schema = await extractSchema(connStr);
  const { id, meta, schemaSQL } = buildSnapshotMeta(name, description, engine, connStr, schema);

  const { filePath, fs: fsMod } = await prepareSnapshotDir(connectionId, id);
  const stream = fsMod.createWriteStream(filePath, "utf-8");

  const write = (chunk: string) => new Promise<void>((resolve, reject) => {
    stream.write(chunk, (err) => err ? reject(err) : resolve());
  });

  let totalRows = 0;
  const dataSQLBuilder: string[] = [];

  await write(`{`);
  await write(`"schemaSQL":${JSON.stringify(schemaSQL)},`);
  await write(`"schemaStructured":${JSON.stringify(schema)},`);
  await write(`"dataTables":{`);

  let firstTable = true;

  for (const table of schema.tables) {
    const ref = `${table.schema}.${table.name}`;
    const tableRef = quoteTableRef(engine, table.schema, table.name);

    try {
      const orderClause = buildOrderClause(engine, table);
      const limit = MAX_SNAPSHOT_ROWS_PER_TABLE + 1;
      const res = await runEngineQuery(connStr, `SELECT * FROM ${tableRef}${orderClause} LIMIT ${limit}`);
      const rawRows = res.rows;
      const truncated = rawRows.length > MAX_SNAPSHOT_ROWS_PER_TABLE;
      const rows = truncated ? rawRows.slice(0, MAX_SNAPSHOT_ROWS_PER_TABLE).map(r => serializeRow(r)) : rawRows.map(r => serializeRow(r));

      totalRows += rows.length;

      if (!firstTable) await write(`,`);
      firstTable = false;
      await write(`${JSON.stringify(ref)}:${JSON.stringify(rows)}`);

      if (rows.length > 0) {
        const colNames = table.columns.map(c => quoteIdent(engine, c.name));
        const label = truncated
          ? `-- ${ref} (showing ${rows.length} of ${rows.length}+ rows)`
          : `-- ${ref} (${rows.length} rows)`;
        dataSQLBuilder.push(label);
        for (const row of rows) {
          const vals = table.columns.map(c => serializeValueForSQL(row[c.name], engine));
          dataSQLBuilder.push(`INSERT INTO ${tableRef} (${colNames.join(", ")}) VALUES (${vals.join(", ")});`);
        }
      }
    } catch (err: any) {
      if (!firstTable) await write(`,`);
      firstTable = false;
      await write(`${JSON.stringify(ref)}:[]`);
      dataSQLBuilder.push(`-- ${ref}: ERROR - ${err.message}`);
    }
  }

  meta.rowCount = totalRows;

  await write(`},`);
  await write(`"dataSQL":${JSON.stringify(dataSQLBuilder.join("\n\n"))},`);
  await write(`"meta":${JSON.stringify(meta)}`);
  await write(`}`);

  await new Promise<void>((resolve, reject) => {
    stream.end((err: Error | null | undefined) => err ? reject(err) : resolve());
  });

  return meta;
}

const STREAM_BATCH_SIZE = 50;

function logMem(label: string) {
  const used = process.memoryUsage();
  console.log(`[snapshot:mem] ${label} — rss=${Math.round(used.rss / 1024 / 1024)}MB heap=${Math.round(used.heapUsed / 1024 / 1024)}/${Math.round(used.heapTotal / 1024 / 1024)}MB ext=${Math.round(used.external / 1024 / 1024)}MB`);
}

function logBigObj(label: string, val: unknown) {
  try {
    const s = JSON.stringify(val);
    console.log(`[snapshot:debug] ${label} size=${(s.length / 1024 / 1024).toFixed(2)}MB first200=${s.slice(0, 200)}`);
  } catch (e) {
    console.log(`[snapshot:debug] ${label} JSON.stringify failed: ${e}`);
  }
}

export async function createSnapshotStream(
  connStr: string,
  name: string,
  description: string,
  connectionId: string,
  tableNames: string[],
  onProgress: (event: SnapshotProgressEvent) => void,
): Promise<SnapshotMeta> {
  const engine = getEngine(connStr);
  console.log("[snapshot] engine =", engine, "connStr =", connStr);
  logMem("before extractSchema");
  const fullSchema = await extractSchema(connStr);
  console.log("[snapshot] after extractSchema — tables:", fullSchema.tables.length, "views:", fullSchema.views.length);
  console.log("[snapshot] schema table names:", fullSchema.tables.map(t => `${t.schema}.${t.name}`));
  const selectedTables = fullSchema.tables.filter(t =>
    tableNames.includes(`${t.schema}.${t.name}`) || tableNames.includes(t.name),
  );
  if (selectedTables.length === 0) throw new Error("No matching tables found");

  const schema: SchemaDef = { ...fullSchema, tables: selectedTables };
  const { id, meta, schemaSQL } = buildSnapshotMeta(name, description, engine, connStr, schema);

  const { filePath, fs: fsMod, fsp, pathMod, dir } = await prepareSnapshotDir(connectionId, id);
  console.log("[snapshots] createSnapshotStream writing to", filePath, "tables:", selectedTables.length);

  const CHUNK_SIZE = 500;
  const safeRef = (r: string) => r.replace(/[^a-zA-Z0-9_]/g, "_");
  const writer = (s: WriteStream) => (chunk: string) =>
    new Promise<void>((resolve, reject) => {
      s.write(chunk, (err: Error | null | undefined) => err ? reject(err) : resolve());
    });
  const endStream = (s: WriteStream) =>
    new Promise<void>((resolve) => s.end(resolve));

  const tempFiles: string[] = [];
  const tableChunks: { ref: string; chunks: number }[] = [];

  // ── Phase 1: write per-table chunk files ──
  let totalRows = 0;

  for (let ti = 0; ti < selectedTables.length; ti++) {
    const table = selectedTables[ti];
    const ref = `${table.schema}.${table.name}`;
    const tableRef = quoteTableRef(engine, table.schema, table.name);
    const safe = safeRef(ref);
    const orderClause = buildOrderClause(engine, table);

    onProgress({ type: "table-start", table: ref, current: ti + 1, total: selectedTables.length });

    let dataStream: WriteStream | null = null;
    let sqlStream: WriteStream | null = null;
    let writeData = (_s: string) => Promise.resolve();
    let writeSql = (_s: string) => Promise.resolve();
    let sqlNeedsSep = false;
    let rowsInChunk = 0;
    let chunkIdx = 0;
    let fetched = 0;
    let truncated = false;

    const openChunk = () => {
      const dp = pathMod.join(dir, `${id}.d.${safe}.${chunkIdx}.json`);
      const sp = pathMod.join(dir, `${id}.s.${safe}.${chunkIdx}.sql`);
      tempFiles.push(dp, sp);
      dataStream = fsMod.createWriteStream(dp, "utf-8");
      sqlStream = fsMod.createWriteStream(sp, "utf-8");
      writeData = writer(dataStream);
      writeSql = writer(sqlStream);
      rowsInChunk = 0;
    };

    try {
      logMem(`before COUNT(*) for ${ref}`);
      const countRes = await runEngineQuery(connStr, `SELECT COUNT(*) as cnt FROM ${tableRef}`);
      const totalTableRows = Number(countRes.rows[0]?.cnt || 0);
      const actualMax = Math.min(totalTableRows, MAX_SNAPSHOT_ROWS_PER_TABLE);
      truncated = totalTableRows > MAX_SNAPSHOT_ROWS_PER_TABLE;
      console.log(`[snapshot] COUNT(*) for ${ref} = ${totalTableRows}, actualMax=${actualMax}, truncated=${truncated}`);
      logMem(`after COUNT(*) for ${ref}`);

      const colNames = table.columns.map(c => quoteIdent(engine, c.name));
      const colNamesStr = colNames.join(", ");

      if (actualMax > 0) {
        const label = truncated
          ? `-- ${ref} (showing ${actualMax} of ${totalTableRows}+ rows)`
          : `-- ${ref} (${actualMax} rows)`;
        openChunk();
        await writeSql(label);
        sqlNeedsSep = true;
      }

      for (let offset = 0; offset < actualMax; offset += STREAM_BATCH_SIZE) {
        const limit = Math.min(STREAM_BATCH_SIZE, actualMax - offset);
        const sql = `SELECT * FROM ${tableRef}${orderClause} LIMIT ${limit} OFFSET ${offset}`;
        console.log(`[snapshot] query[${ref}] offset=${offset} limit=${limit} sql=${sql}`);
        logMem(`before SELECT * for ${ref} offset=${offset}`);
        const res = await runEngineQuery(connStr, sql);
        console.log(`[snapshot] query[${ref}] returned ${res.rows.length} rows`);
        logMem(`after SELECT * for ${ref} offset=${offset}`);

        let rowIdx = 0;
        for (const rawRow of res.rows) {
          if (rowIdx === 0) {
            try {
              const sample = JSON.stringify(rawRow).slice(0, 500);
              console.log(`[snapshot] first row sample for ${ref}: ${sample}`);
              const keyLen = Object.keys(rawRow).length;
              console.log(`[snapshot] row[${ref}] keys=${keyLen}, approxSize=${(JSON.stringify(rawRow).length / 1024).toFixed(1)}KB`);
            } catch (e) {
              console.log(`[snapshot] first row sample FAILED: ${e}`);
            }
          }
          rowIdx++;
          if (!dataStream) openChunk();

          logMem(`before serializeRow[${ref}] row=${fetched}`);
          const row = serializeRow(rawRow);
          const rowJSON = JSON.stringify(row);
          if (fetched === 0) {
            console.log(`[snapshot] serialized row size: ${(rowJSON.length / 1024).toFixed(1)}KB`);
          }

          if (rowsInChunk > 0) await writeData(",");
          await writeData(rowJSON);

          if (sqlNeedsSep) await writeSql("\n\n");
          sqlNeedsSep = true;

          await writeSql(`INSERT INTO ${tableRef} (`);
          await writeSql(colNamesStr);
          await writeSql(`) VALUES (`);
          for (let ci = 0; ci < table.columns.length; ci++) {
            if (ci > 0) await writeSql(", ");
            await writeSQLValue(row[table.columns[ci].name], engine, writeSql);
          }
          await writeSql(`);`);

          rowsInChunk++;
          fetched++;

          if (rowsInChunk >= CHUNK_SIZE && fetched < actualMax) {
            console.log(`[snapshot] closing chunk ${chunkIdx} for ${ref} at row ${fetched}`);
            logMem(`before endStream chunk ${chunkIdx}`);
            await endStream(dataStream!);
            await endStream(sqlStream!);
            logMem(`after endStream chunk ${chunkIdx}`);
            dataStream = null;
            sqlStream = null;
            chunkIdx++;
            onProgress({ type: "table-chunk", table: ref, current: ti + 1, total: selectedTables.length, rows: fetched, chunk: chunkIdx });
          }
        }

        logMem(`after batch offset=${offset} for ${ref}`);
        onProgress({ type: "table-progress", table: ref, current: ti + 1, total: selectedTables.length, rows: fetched });
      }
      console.log(`[snapshot] done fetching rows for ${ref}, total=${fetched}`);
      logMem(`end of Phase 1 for ${ref}`);

      if (dataStream) await endStream(dataStream);
      if (sqlStream) await endStream(sqlStream);

      totalRows += fetched;
      tableChunks.push({ ref, chunks: chunkIdx + (actualMax > 0 ? 1 : 0) });
      onProgress({ type: "table-done", table: ref, current: ti + 1, total: selectedTables.length, rows: fetched, truncated });
    } catch (err: any) {
      console.log("[snapshots] createSnapshotStream error for", ref, err.message);
      console.log("[snapshots] error stack:", err.stack);
      console.log("[snapshots] error constructor:", err.constructor?.name);
      console.log("[snapshots] error code:", err.code);
      logMem(`at error for ${ref}`);
      if (err.message?.includes("out of memory") || err.message === "Out of memory") {
        console.log("[snapshots] THIS IS A SQLITE_NOMEM — SQLite ran out of C heap memory");
        try {
          const cp = await import("child_process");
          const mem = cp.execSync("vm_stat 2>/dev/null || echo 'no vm_stat'").toString();
          console.log("[snapshots] vm_stat:", mem.slice(0, 1000));
        } catch {}
      }
      if (dataStream) endStream(dataStream).catch(() => {});
      if (sqlStream) endStream(sqlStream).catch(() => {});
      onProgress({ type: "table-error", table: ref, current: ti + 1, total: selectedTables.length, error: err.message });
    }
  }

  meta.rowCount = totalRows;

  // ── Phase 2: merge chunk files into final snapshot ──
  console.log("[snapshot] Phase 2 merge start, tableChunks:", JSON.stringify(tableChunks));
  logMem("before Phase 2 merge");
  const finalStream = fsMod.createWriteStream(filePath, "utf-8");
  const write = (chunk: string) => new Promise<void>((resolve, reject) => {
    if (!finalStream.write(chunk, (err) => err ? reject(err) : resolve())) {
      finalStream.once("drain", () => resolve());
    }
  });

  await write(`{`);
  await write(`"schemaSQL":${JSON.stringify(schemaSQL)},`);
  await write(`"schemaStructured":${JSON.stringify(schema)},`);
  await write(`"dataTables":{`);

  for (let ti = 0; ti < tableChunks.length; ti++) {
    const { ref, chunks } = tableChunks[ti];
    const safe = safeRef(ref);

    if (ti > 0) await write(`,`);
    await write(`${JSON.stringify(ref)}:[`);

    for (let ci = 0; ci < chunks; ci++) {
      const dp = pathMod.join(dir, `${id}.d.${safe}.${ci}.json`);
      if (ci > 0) await write(`,`);
      const rs = fsMod.createReadStream(dp, "utf-8");
      for await (const chunk of rs) {
        await write(chunk);
      }
    }

    await write(`]`);
  }

  await write(`},`);

  // Merge SQL chunks (streamed, 64KB at a time)
  await write(`"dataSQL":"`);
  for (const { ref, chunks } of tableChunks) {
    const safe = safeRef(ref);
    for (let ci = 0; ci < chunks; ci++) {
      const sp = pathMod.join(dir, `${id}.s.${safe}.${ci}.sql`);
      const rs = fsMod.createReadStream(sp, "utf-8");
      for await (const chunk of rs) {
        await write(
          chunk
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t")
        );
      }
    }
  }
  await write(`",`);

  await write(`"meta":${JSON.stringify(meta)}`);
  await write(`}`);

  await new Promise<void>((resolve) => finalStream.end(resolve));

  // Clean up all temp files
  for (const f of tempFiles) {
    fsp.unlink(f).catch(() => {});
  }

  console.log("[snapshots] createSnapshotStream done", filePath, "rows:", totalRows);
  return meta;
}


function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = serializeCell(v);
  }
  return out;
}

function serializeCell(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "bigint") return Number.isSafeInteger(Number(val)) ? Number(val) : val.toString();
  if (Buffer.isBuffer(val)) return val.toString("hex");
  if (val instanceof Uint8Array) return Buffer.from(val).toString("hex");
  return val;
}

function serializeValueForSQL(val: unknown, engine: Engine): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number" || typeof val === "bigint") return String(val);
  const str = String(val);
  if (engine === "mysql") return "'" + str.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return "'" + str.replace(/'/g, "''") + "'";
}

type StreamWrite = (chunk: string) => Promise<void>;

async function writeSQLValue(val: unknown, engine: Engine, write: StreamWrite): Promise<void> {
  if (val === null || val === undefined) { await write("NULL"); return; }
  if (typeof val === "boolean") { await write(val ? "TRUE" : "FALSE"); return; }
  if (typeof val === "number" || typeof val === "bigint") { await write(String(val)); return; }
  const str = String(val);
  await write("'");
  if (engine === "mysql") {
    let last = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" || ch === "\\") {
        if (i > last) await write(str.slice(last, i));
        await write("\\" + ch);
        last = i + 1;
      }
    }
    if (last < str.length) await write(str.slice(last));
  } else {
    let last = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === "'") {
        if (i > last) await write(str.slice(last, i));
        await write("''");
        last = i + 1;
      }
    }
    if (last < str.length) await write(str.slice(last));
  }
  await write("'");
}

export function generateSchemaSQL(schema: SchemaDef, engine: Engine): string {
  const stmts: string[] = [];

  for (const enumDef of schema.enums) {
    const vals = enumDef.values.map(v => `'${v}'`).join(", ");
    stmts.push(`CREATE TYPE ${quoteIdent(engine, enumDef.schema)}.${quoteIdent(engine, enumDef.name)} AS ENUM (${vals});`);
  }

  for (const table of schema.tables) {
    const lines: string[] = [];
    const tableRef = quoteTableRef(engine, table.schema, table.name);

    for (const col of table.columns) {
      let line = `  ${quoteIdent(engine, col.name)} ${col.dataType}`;
      if (!col.isNullable) line += " NOT NULL";
      if (col.defaultValue != null) line += ` DEFAULT ${col.defaultValue}`;
      lines.push(line);
    }

    const pk = table.primaryKey;
    if (pk.length > 0) {
      lines.push(`  PRIMARY KEY (${pk.map(c => quoteIdent(engine, c)).join(", ")})`);
    }

    stmts.push(`CREATE TABLE ${tableRef} (\n${lines.join(",\n")}\n);`);

    for (const fk of table.foreignKeys) {
      const ref = quoteTableRef(engine, fk.foreignSchema, fk.foreignTable);
      stmts.push(
        `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteIdent(engine, fk.name)} ` +
        `FOREIGN KEY (${fk.columns.map(c => quoteIdent(engine, c)).join(", ")}) ` +
        `REFERENCES ${ref} (${fk.foreignColumns.map(c => quoteIdent(engine, c)).join(", ")});`,
      );
    }

    for (const idx of table.indexes) {
      const unique = idx.isUnique ? "UNIQUE " : "";
      stmts.push(
        `CREATE ${unique}INDEX ${quoteIdent(engine, idx.name)} ON ${tableRef} ` +
        `(${idx.columns.map(c => quoteIdent(engine, c)).join(", ")});`,
      );
    }
  }

  for (const view of schema.views) {
    stmts.push(
      `CREATE VIEW ${quoteTableRef(engine, view.schema, view.name)} AS\n${view.definition};`,
    );
  }

  return stmts.join("\n\n");
}

export function compareSnapshots(older: DatabaseSnapshot, newer: DatabaseSnapshot): SnapshotDiff {
  const schemaChanges: SchemaChange[] = [];
  const dataChanges: DataChange[] = [];
  const oldTables = new Map(older.schemaStructured.tables.map(t => [`${t.schema}.${t.name}`, t]));
  const newTables = new Map(newer.schemaStructured.tables.map(t => [`${t.schema}.${t.name}`, t]));

  schemaChanges.push(...diffMapKeys(oldTables, newTables, "table"));

  for (const [key, newTable] of newTables) {
    const oldTable = oldTables.get(key);
    if (oldTable) {
      const oldCols = new Map(oldTable.columns.map(c => [c.name, c]));
      const newCols = new Map(newTable.columns.map(c => [c.name, c]));

      schemaChanges.push(...diffMapKeys(oldCols, newCols, "column"));

      for (const [colName, newCol] of newCols) {
        const oldCol = oldCols.get(colName);
        if (oldCol && (oldCol.dataType !== newCol.dataType || oldCol.isNullable !== newCol.isNullable)) {
          schemaChanges.push({ type: "column", action: "modified", entityName: `${key}.${colName}`, details: `${oldCol.dataType} → ${newCol.dataType}` });
        }
      }
    }
  }

  const oldViews = new Map(older.schemaStructured.views.map(v => [`${v.schema}.${v.name}`, v]));
  const newViews = new Map(newer.schemaStructured.views.map(v => [`${v.schema}.${v.name}`, v]));

  schemaChanges.push(...diffMapKeys(oldViews, newViews, "view"));

  const allTableKeys = new Set([...oldTables.keys(), ...newTables.keys()]);

  for (const key of allTableKeys) {
    const oldRows = older.dataTables[key] || [];
    const newRows = newer.dataTables[key] || [];
    const oldTable = oldTables.get(key);
    const newTable = newTables.get(key);

    if (!oldTable || !newTable) {
      if (oldRows.length === 0 && newRows.length === 0) continue;
      dataChanges.push({
        table: key,
        rowCount: Math.abs(newRows.length - oldRows.length),
        rowsAdded: oldTable ? 0 : newRows.length,
        rowsRemoved: newTable ? 0 : oldRows.length,
        rowsModified: 0,
        sampleAdded: oldTable ? [] : newRows.slice(0, 5),
        sampleRemoved: newTable ? [] : oldRows.slice(0, 5),
        sampleModified: [],
        allAdded: oldTable ? [] : newRows,
        allRemoved: newTable ? [] : oldRows,
        allModified: [],
      });
      continue;
    }

    const pkCols = newTable.primaryKey.length > 0 ? newTable.primaryKey : newTable.columns.map(c => c.name);
    const rowKey = (row: Record<string, unknown>) => pkCols.map(c => String(row[c] ?? "NULL")).join("|");

    const oldMap = new Map<string, Record<string, unknown>>();
    for (const row of oldRows) oldMap.set(rowKey(row), row);

    const added: Record<string, unknown>[] = [];
    const removed: Record<string, unknown>[] = [];
    const modified: { old: Record<string, unknown>; new: Record<string, unknown> }[] = [];

    for (const row of newRows) {
      const k = rowKey(row);
      if (!oldMap.has(k)) {
        added.push(row);
      } else {
        const oldRow = oldMap.get(k)!;
        const nonPkCols = newTable.columns.filter(c => !newTable.primaryKey.includes(c.name));
        const hasChanges = nonPkCols.some(c => {
          const a = JSON.stringify(row[c.name]);
          const b = JSON.stringify(oldRow[c.name]);
          return a !== b;
        });
        if (hasChanges) {
          modified.push({ old: oldRow, new: row });
        }
        oldMap.delete(k);
      }
    }

    for (const row of oldMap.values()) {
      removed.push(row);
    }

    if (added.length > 0 || removed.length > 0 || modified.length > 0) {
      dataChanges.push({
        table: key,
        rowCount: Math.max(oldRows.length, newRows.length),
        rowsAdded: added.length,
        rowsRemoved: removed.length,
        rowsModified: modified.length,
        sampleAdded: added.slice(0, 5),
        sampleRemoved: removed.slice(0, 5),
        sampleModified: modified.slice(0, 5),
        allAdded: added,
        allRemoved: removed,
        allModified: modified,
      });
    }
  }

  const summary = {
    tablesAdded: schemaChanges.filter(c => c.type === "table" && c.action === "added").length,
    tablesRemoved: schemaChanges.filter(c => c.type === "table" && c.action === "removed").length,
    tablesModified: schemaChanges.filter(c => c.type === "column" && c.action !== "removed").length > 0 ? 1 : 0,
    rowsAdded: dataChanges.reduce((s, d) => s + d.rowsAdded, 0),
    rowsRemoved: dataChanges.reduce((s, d) => s + d.rowsRemoved, 0),
    rowsModified: dataChanges.reduce((s, d) => s + d.rowsModified, 0),
  };

  return {
    id: `diff-${older.meta.id}-vs-${newer.meta.id}`,
    olderId: older.meta.id,
    newerId: newer.meta.id,
    olderName: older.meta.name,
    newerName: newer.meta.name,
    schemaChanges,
    dataChanges,
    summary,
  };
}

function getAppDataDir(): string {
  const home = process.env.HOME || "";
  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env.APPDATA || `${home}\\AppData\\Roaming`;
    return `${appData}\\Rexa DB`;
  }
  if (platform === "darwin") return `${home}/Library/Application Support/Rexa DB`;
  const xdg = process.env.XDG_CONFIG_HOME || `${home}/.config`;
  return `${xdg}/Rexa DB`;
}

export function getSnapshotDir(connectionId: string): string {
  return `${getAppDataDir()}/snapshots/${connectionId}`;
}

export function getSnapshotPath(connectionId: string, snapshotId: string): string {
  return `${getSnapshotDir(connectionId)}/${snapshotId}.json`;
}

export async function loadSnapshot(connectionId: string, snapshotId: string): Promise<DatabaseSnapshot> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const content = await fs.readFile(path.join(getSnapshotDir(connectionId), `${snapshotId}.json`), "utf-8");
  return JSON.parse(content) as DatabaseSnapshot;
}

export async function listSnapshots(connectionId: string): Promise<DatabaseSnapshot["meta"][]> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = getSnapshotDir(connectionId);
  try {
    await fs.access(dir);
  } catch {
    console.log("[snapshots] listSnapshots: dir not found", dir);
    return [];
  }
  const files = await fs.readdir(dir);
  console.log("[snapshots] listSnapshots: dir", dir, "files", files);
  const jsonFiles = files.filter(f => f.endsWith(".json")).sort();
  const metas: DatabaseSnapshot["meta"][] = [];
  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const snapshot = JSON.parse(content) as DatabaseSnapshot;
      metas.push(snapshot.meta);
    } catch (e) {
      console.log("[snapshots] listSnapshots: failed to parse", file, e);
    }
  }
  return metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function deleteSnapshotFile(connectionId: string, snapshotId: string): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  await fs.unlink(path.join(getSnapshotDir(connectionId), `${snapshotId}.json`));
}

export function serializeSnapshotForApi(snapshot: DatabaseSnapshot): SnapshotMeta {
  return snapshot.meta;
}
