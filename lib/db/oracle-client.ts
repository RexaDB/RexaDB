import type { QueryResult } from "./client-types";
import {
  connectionStringToBridgeConfig,
  oracleExecuteQuery,
  oracleGetForeignKeys,
  oracleGetSchemas,
  oracleGetTables,
  oracleGetTableStructure,
  oracleTestConnection,
} from "./oracle-bridge-manager";
import {
  isOracleConnectionString,
  parseOracleConnectionString,
} from "./oracle-connection";
import { quoteOracleIdentifier } from "./quote-identifier";

export { isOracleConnectionString, parseOracleConnectionString };

function log(...args: any[]) {
  try {
    console.log("[oracle-client]", ...args);
  } catch {}
}

export async function executeOracleQuery(
  connectionString: string,
  sql: string,
  params: any[] = [],
): Promise<QueryResult> {
  const config = connectionStringToBridgeConfig(connectionString);
  const result = await oracleExecuteQuery(config, sql, params);
  const fields = (result.columns || []).map((c) => ({
    name: c.name,
    dataTypeID: 0,
    dataTypeName: c.type || "unknown",
  }));
  const rows = (result.rows || []).map((row) => {
    const obj: Record<string, any> = {};
    fields.forEach((col, i) => {
      obj[col.name] = row[i];
      // Also expose lowercase keys for callers that expect PG-style names.
      const lower = col.name.toLowerCase();
      if (!(lower in obj)) obj[lower] = row[i];
    });
    return obj;
  });
  return {
    rows,
    fields,
    rowCount: Number(result.rowCount ?? rows.length),
  };
}

export async function testOracleConnection(
  connectionString: string,
): Promise<boolean> {
  log("testOracleConnection", connectionString.slice(0, 80));
  const config = connectionStringToBridgeConfig(connectionString);
  return oracleTestConnection(config);
}

export async function getSchemas(connectionString: string): Promise<string[]> {
  const config = connectionStringToBridgeConfig(connectionString);
  return oracleGetSchemas(config);
}

export async function getTables(
  connectionString: string,
  schema: string,
): Promise<string[]> {
  const config = connectionStringToBridgeConfig(connectionString);
  const tables = await oracleGetTables(config, schema);
  return tables.filter((t) => t.type === "TABLE").map((t) => t.name);
}

export async function getViews(
  connectionString: string,
  schema: string,
): Promise<string[]> {
  const config = connectionStringToBridgeConfig(connectionString);
  const tables = await oracleGetTables(config, schema);
  const views = tables.filter((t) => t.type === "VIEW").map((t) => t.name);
  // Also surface materialized views in the views list.
  try {
    const mviews = await getMaterializedViews(connectionString, schema);
    const names = new Set(views.map((v) => v.toUpperCase()));
    for (const mv of mviews) {
      if (!names.has(mv.name.toUpperCase())) views.push(mv.name);
    }
  } catch {}
  return views;
}

export async function getOracleTablesDetailed(
  connectionString: string,
  schema: string,
): Promise<Array<{ name: string; type: string; schema: string }>> {
  const config = connectionStringToBridgeConfig(connectionString);
  return oracleGetTables(config, schema);
}

export async function getTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  const config = connectionStringToBridgeConfig(connectionString);
  const cols = await oracleGetTableStructure(config, schema, table);

  // Enrich with PK / FK flags via dictionary queries.
  let pkCols = new Set<string>();
  let fkCols = new Set<string>();
  try {
    const pkSql = `
      SELECT acc.column_name
      FROM all_constraints ac
      JOIN all_cons_columns acc
        ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
      WHERE ac.constraint_type = 'P'
        AND ac.owner = '${schema.replace(/'/g, "''")}'
        AND ac.table_name = '${table.replace(/'/g, "''")}'
    `;
    const pkResult = await oracleExecuteQuery(config, pkSql);
    pkCols = new Set((pkResult.rows || []).map((r) => String(r[0]).toUpperCase()));
  } catch {}
  try {
    const fks = await oracleGetForeignKeys(config, schema, table);
    fkCols = new Set(fks.map((f) => f.fkColumn.toUpperCase()));
  } catch {}

  return cols.map((col) => ({
    column_name: col.name,
    data_type: col.type,
    is_nullable: col.nullable ? "YES" : "NO",
    column_default: col.default || null,
    is_primary_key: pkCols.has(col.name.toUpperCase()),
    is_foreign_key: fkCols.has(col.name.toUpperCase()),
    character_maximum_length: col.size || null,
  }));
}

export async function getTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const config = connectionStringToBridgeConfig(connectionString);
  const fks = await oracleGetForeignKeys(config, schema, table);
  return fks.map((fk) => ({
    column_name: fk.fkColumn,
    foreign_table_schema: fk.pkSchema,
    foreign_table_name: fk.pkTable,
    foreign_column_name: fk.pkColumn,
  }));
}

export async function getAllTablesWithColumns(connectionString: string) {
  const schemas = await getSchemas(connectionString);
  const allRows: any[] = [];
  for (const schema of schemas.slice(0, 50)) {
    const tables = await getOracleTablesDetailed(connectionString, schema);
    for (const table of tables) {
      const cols = await getTableStructure(connectionString, schema, table.name);
      for (const col of cols) {
        allRows.push({
          table_schema: schema,
          table_name: table.name,
          column_name: col.column_name,
          data_type: col.data_type,
          is_primary: col.is_primary_key,
          is_nullable: col.is_nullable,
          referenced_table_schema: null,
          referenced_table_name: null,
          referenced_column_name: null,
        });
      }
    }
  }
  return allRows;
}

export function quoteOracleName(value: string) {
  return quoteOracleIdentifier(value);
}

function esc(value: string): string {
  return String(value || "").replace(/'/g, "''");
}

function pick(row: Record<string, any>, ...names: string[]) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null) return row[n];
    const upper = n.toUpperCase();
    if (row[upper] !== undefined && row[upper] !== null) return row[upper];
    const lower = n.toLowerCase();
    if (row[lower] !== undefined && row[lower] !== null) return row[lower];
  }
  return undefined;
}

async function queryObjects(
  connectionString: string,
  sql: string,
): Promise<Record<string, any>[]> {
  const result = await executeOracleQuery(connectionString, sql, []);
  return (result.rows || []) as Record<string, any>[];
}

export type OracleIndex = {
  schema: string;
  table_name: string;
  name: string;
  columns: string[];
  definition: string;
  is_unique: boolean;
};

export async function getIndexes(
  connectionString: string,
  schema?: string,
): Promise<OracleIndex[]> {
  const ownerFilter = schema
    ? `AND i.owner = '${esc(schema.toUpperCase())}'`
    : "";
  const sql = `
    SELECT i.owner, i.index_name, i.table_name, i.uniqueness,
           c.column_name, c.column_position
    FROM all_indexes i
    JOIN all_ind_columns c
      ON i.owner = c.index_owner AND i.index_name = c.index_name
    WHERE i.index_type LIKE 'NORMAL%'
      AND i.owner NOT IN ('SYS','SYSTEM','XDB','CTXSYS','MDSYS','ORDDATA','WMSYS')
      ${ownerFilter}
    ORDER BY i.owner, i.index_name, c.column_position
  `;
  const rows = await queryObjects(connectionString, sql);
  const grouped = new Map<string, OracleIndex>();
  for (const r of rows) {
    const owner = String(pick(r, "owner") || "");
    const name = String(pick(r, "index_name") || "");
    if (!owner || !name) continue;
    const key = `${owner}.${name}`;
    const col = String(pick(r, "column_name") || "");
    const existing = grouped.get(key);
    if (existing) {
      if (col && !existing.columns.includes(col)) existing.columns.push(col);
      continue;
    }
    const isUnique = String(pick(r, "uniqueness") || "").toUpperCase() === "UNIQUE";
    const tableName = String(pick(r, "table_name") || "");
    const columns = col ? [col] : [];
    grouped.set(key, {
      schema: owner,
      table_name: tableName,
      name,
      columns,
      definition: `${isUnique ? "UNIQUE " : ""}INDEX ${owner}.${name} ON ${tableName} (${columns.join(", ")})`,
      is_unique: isUnique,
    });
  }
  // Refresh definitions with final column lists
  for (const idx of grouped.values()) {
    idx.definition = `${idx.is_unique ? "UNIQUE " : ""}INDEX ${idx.schema}.${idx.name} ON ${idx.table_name} (${idx.columns.join(", ")})`;
  }
  return [...grouped.values()];
}

export type OracleRoutine = {
  schema: string;
  name: string;
  arguments: string;
  type: "PROCEDURE" | "FUNCTION" | "PACKAGE";
  return_type: string;
  definition: string | null;
  language: string;
  package_name?: string;
};

export async function getRoutines(
  connectionString: string,
  schema: string,
): Promise<OracleRoutine[]> {
  const owner = esc(schema.toUpperCase());
  // Standalone + package members from ALL_PROCEDURES.
  const sql = `
    SELECT owner, object_name, procedure_name, object_type
    FROM all_procedures
    WHERE owner = '${owner}'
      AND object_type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE')
      AND (
        (object_type IN ('PROCEDURE', 'FUNCTION') AND procedure_name IS NULL)
        OR (object_type = 'PACKAGE' AND procedure_name IS NOT NULL)
      )
    ORDER BY object_type, object_name, procedure_name
  `;
  let rows: Record<string, any>[] = [];
  try {
    rows = await queryObjects(connectionString, sql);
  } catch {
    return [];
  }

  const routines: OracleRoutine[] = [];
  for (const r of rows) {
    const objectType = String(pick(r, "object_type") || "").toUpperCase();
    const objectName = String(pick(r, "object_name") || "");
    const procedureName = pick(r, "procedure_name");
    if (!objectName) continue;

    if (objectType === "PACKAGE" && procedureName) {
      const member = String(procedureName);
      routines.push({
        schema: schema.toUpperCase(),
        name: `${objectName}.${member}`,
        arguments: "",
        type: "FUNCTION",
        return_type: "",
        definition: null,
        language: "PL/SQL",
        package_name: objectName,
      });
      continue;
    }

    routines.push({
      schema: schema.toUpperCase(),
      name: objectName,
      arguments: "",
      type: objectType === "PROCEDURE" ? "PROCEDURE" : "FUNCTION",
      return_type: "",
      definition: null,
      language: "PL/SQL",
    });
  }

  // Attach ALL_SOURCE for standalone objects (best-effort).
  try {
    const srcSql = `
      SELECT name, type, line, text
      FROM all_source
      WHERE owner = '${owner}'
        AND type IN ('PROCEDURE', 'FUNCTION')
      ORDER BY name, type, line
    `;
    const srcRows = await queryObjects(connectionString, srcSql);
    const byKey = new Map<string, string[]>();
    for (const s of srcRows) {
      const name = String(pick(s, "name") || "");
      const type = String(pick(s, "type") || "");
      const text = String(pick(s, "text") || "");
      const key = `${type}:${name}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(text);
    }
    for (const routine of routines) {
      if (routine.package_name) continue;
      const key = `${routine.type}:${routine.name}`;
      const lines = byKey.get(key);
      if (lines?.length) routine.definition = lines.join("");
    }
  } catch {}

  return routines;
}

export type OraclePackage = {
  schema: string;
  name: string;
  status: string;
  definition: string | null;
};

export async function getPackages(
  connectionString: string,
  schema: string,
): Promise<OraclePackage[]> {
  const owner = esc(schema.toUpperCase());
  const sql = `
    SELECT object_name, status
    FROM all_objects
    WHERE owner = '${owner}' AND object_type = 'PACKAGE'
    ORDER BY object_name
  `;
  const rows = await queryObjects(connectionString, sql);
  const packages: OraclePackage[] = rows.map((r) => ({
    schema: schema.toUpperCase(),
    name: String(pick(r, "object_name") || ""),
    status: String(pick(r, "status") || "VALID"),
    definition: null,
  })).filter((p) => p.name);

  try {
    const srcSql = `
      SELECT name, line, text
      FROM all_source
      WHERE owner = '${owner}' AND type = 'PACKAGE'
      ORDER BY name, line
    `;
    const srcRows = await queryObjects(connectionString, srcSql);
    const byName = new Map<string, string[]>();
    for (const s of srcRows) {
      const name = String(pick(s, "name") || "");
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(String(pick(s, "text") || ""));
    }
    for (const pkg of packages) {
      const lines = byName.get(pkg.name);
      if (lines?.length) pkg.definition = lines.join("");
    }
  } catch {}

  return packages;
}

export type OracleTrigger = {
  schema: string;
  name: string;
  table_schema: string | null;
  table_name: string | null;
  timing: string;
  event: string;
  events: string[];
  definition: string | null;
  enabled_mode?: string;
  orientation?: string;
};

export async function getTriggers(
  connectionString: string,
  schema?: string,
): Promise<OracleTrigger[]> {
  const ownerFilter = schema
    ? `AND owner = '${esc(schema.toUpperCase())}'`
    : "";
  const sql = `
    SELECT owner, trigger_name, table_owner, table_name,
           trigger_type, triggering_event, status, trigger_body
    FROM all_triggers
    WHERE 1=1
      ${ownerFilter}
      AND owner NOT IN ('SYS','SYSTEM','XDB','CTXSYS','MDSYS')
    ORDER BY owner, trigger_name
  `;
  const rows = await queryObjects(connectionString, sql);
  return rows.map((r) => {
    const eventStr = String(pick(r, "triggering_event") || "");
    const events = eventStr
      .split(/ OR |,/i)
      .map((e) => e.trim())
      .filter(Boolean);
    const triggerType = String(pick(r, "trigger_type") || "");
    let timing = "AFTER";
    if (/BEFORE/i.test(triggerType)) timing = "BEFORE";
    else if (/INSTEAD/i.test(triggerType)) timing = "INSTEAD OF";
    const orientation = /ROW/i.test(triggerType) ? "ROW" : "STATEMENT";
    return {
      schema: String(pick(r, "owner") || ""),
      name: String(pick(r, "trigger_name") || ""),
      table_schema: (pick(r, "table_owner") as string) || null,
      table_name: (pick(r, "table_name") as string) || null,
      timing,
      event: eventStr,
      events,
      definition: (pick(r, "trigger_body") as string) || null,
      enabled_mode: String(pick(r, "status") || "ENABLED"),
      orientation,
    };
  }).filter((t) => t.name);
}

export type OracleSequence = {
  schema: string;
  name: string;
  min_value: number | null;
  max_value: number | null;
  increment_by: number | null;
  last_number: number | null;
  cycle_flag: boolean;
};

export async function getSequences(
  connectionString: string,
  schema: string,
): Promise<OracleSequence[]> {
  const sql = `
    SELECT sequence_owner, sequence_name, min_value, max_value,
           increment_by, last_number, cycle_flag
    FROM all_sequences
    WHERE sequence_owner = '${esc(schema.toUpperCase())}'
    ORDER BY sequence_name
  `;
  const rows = await queryObjects(connectionString, sql);
  return rows.map((r) => ({
    schema: String(pick(r, "sequence_owner") || schema.toUpperCase()),
    name: String(pick(r, "sequence_name") || ""),
    min_value: Number(pick(r, "min_value") ?? null),
    max_value: Number(pick(r, "max_value") ?? null),
    increment_by: Number(pick(r, "increment_by") ?? null),
    last_number: Number(pick(r, "last_number") ?? null),
    cycle_flag: String(pick(r, "cycle_flag") || "N").toUpperCase() === "Y",
  })).filter((s) => s.name);
}

export type OracleSynonym = {
  schema: string;
  name: string;
  table_owner: string;
  table_name: string;
  db_link: string | null;
};

export async function getSynonyms(
  connectionString: string,
  schema: string,
): Promise<OracleSynonym[]> {
  const sql = `
    SELECT owner, synonym_name, table_owner, table_name, db_link
    FROM all_synonyms
    WHERE owner = '${esc(schema.toUpperCase())}'
    ORDER BY synonym_name
  `;
  const rows = await queryObjects(connectionString, sql);
  return rows.map((r) => ({
    schema: String(pick(r, "owner") || schema.toUpperCase()),
    name: String(pick(r, "synonym_name") || ""),
    table_owner: String(pick(r, "table_owner") || ""),
    table_name: String(pick(r, "table_name") || ""),
    db_link: (pick(r, "db_link") as string) || null,
  })).filter((s) => s.name);
}

export type OracleDbLink = {
  owner: string;
  name: string;
  username: string | null;
  host: string | null;
};

export async function getDbLinks(
  connectionString: string,
): Promise<OracleDbLink[]> {
  // Prefer ALL_DB_LINKS; fall back to USER_DB_LINKS.
  try {
    const rows = await queryObjects(
      connectionString,
      `SELECT owner, db_link, username, host FROM all_db_links ORDER BY owner, db_link`,
    );
    if (rows.length) {
      return rows
        .map((r) => ({
          owner: String(pick(r, "owner") || ""),
          name: String(pick(r, "db_link") || ""),
          username: (pick(r, "username") as string) || null,
          host: (pick(r, "host") as string) || null,
        }))
        .filter((l) => l.name);
    }
  } catch {}
  try {
    const rows = await queryObjects(
      connectionString,
      `SELECT db_link, username, host FROM user_db_links ORDER BY db_link`,
    );
    const user =
      parseOracleConnectionString(connectionString).username.toUpperCase() ||
      "USER";
    return rows
      .map((r) => ({
        owner: user,
        name: String(pick(r, "db_link") || ""),
        username: (pick(r, "username") as string) || null,
        host: (pick(r, "host") as string) || null,
      }))
      .filter((l) => l.name);
  } catch {
    return [];
  }
}

export type OracleMaterializedView = {
  schema: string;
  name: string;
  refresh_mode: string | null;
  refresh_method: string | null;
  build_mode: string | null;
  last_refresh_date: string | null;
  staleness: string | null;
  compile_state: string | null;
  query: string | null;
};

export async function getMaterializedViews(
  connectionString: string,
  schema: string,
): Promise<OracleMaterializedView[]> {
  const sql = `
    SELECT owner, mview_name, refresh_mode, refresh_method, build_mode,
           last_refresh_date, staleness, compile_state, query
    FROM all_mviews
    WHERE owner = '${esc(schema.toUpperCase())}'
    ORDER BY mview_name
  `;
  try {
    const rows = await queryObjects(connectionString, sql);
    return rows.map((r) => ({
      schema: String(pick(r, "owner") || schema.toUpperCase()),
      name: String(pick(r, "mview_name") || ""),
      refresh_mode: (pick(r, "refresh_mode") as string) || null,
      refresh_method: (pick(r, "refresh_method") as string) || null,
      build_mode: (pick(r, "build_mode") as string) || null,
      last_refresh_date: pick(r, "last_refresh_date") != null
        ? String(pick(r, "last_refresh_date"))
        : null,
      staleness: (pick(r, "staleness") as string) || null,
      compile_state: (pick(r, "compile_state") as string) || null,
      query: (pick(r, "query") as string) || null,
    })).filter((m) => m.name);
  } catch {
    return [];
  }
}

export async function getObjectSource(
  connectionString: string,
  schema: string,
  name: string,
  type: string,
): Promise<string | null> {
  const sql = `
    SELECT text FROM all_source
    WHERE owner = '${esc(schema.toUpperCase())}'
      AND name = '${esc(name.toUpperCase())}'
      AND type = '${esc(type.toUpperCase())}'
    ORDER BY line
  `;
  try {
    const rows = await queryObjects(connectionString, sql);
    if (!rows.length) return null;
    return rows.map((r) => String(pick(r, "text") || "")).join("");
  } catch {
    return null;
  }
}
