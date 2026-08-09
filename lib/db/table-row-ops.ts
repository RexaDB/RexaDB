import { detectConnectionDbType } from "./connection-type";
import { buildSelectByKeyValuesQuery } from "./pg-query-utils";

export async function deleteTableRows(
  connectionString: string,
  schema: string,
  table: string,
  pkValues: any[],
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    const { deleteMongoRows } = await import("./mongo-client");
    try {
      await deleteMongoRows(connectionString, schema, table, pkValues);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to delete Mongo rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "sqlite" || dbType === "mysql") {
    const { deleteSqlEngineRows, getSqlEnginePrimaryKey } =
      await import("./sql-engine");
    const label = dbType === "sqlite" ? "SQLite" : "MySQL";
    try {
      const pkColumn = await getSqlEnginePrimaryKey(
        connectionString,
        schema,
        table,
      );
      if (!pkColumn) {
        return {
          success: false,
          error:
            "No primary key found for this table. Deletion is only supported for tables with a primary key.",
        };
      }
      const values = pkValues.map(w => w[pkColumn]);
      await deleteSqlEngineRows(
        connectionString,
        schema,
        table,
        pkColumn,
        values,
      );
      return { success: true };
    } catch (error: any) {
      console.error(`Failed to delete ${label} rows:`, error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "spacetimedb") {
    const { deleteSpacetimeDbRows, getSpacetimeDbPrimaryKey } =
      await import("./spacetimedb-client");
    try {
      const pkColumn = await getSpacetimeDbPrimaryKey(
        connectionString,
        table,
      );
      if (!pkColumn) {
        return {
          success: false,
          error:
            "No primary key found for this table. Deletion is only supported for tables with a primary key.",
        };
      }
      const values = pkValues.map(w => w[pkColumn]);
      await deleteSpacetimeDbRows(
        connectionString,
        schema,
        table,
        pkColumn,
        values,
      );
      return { success: true };
    } catch (error: any) {
      console.error("Failed to delete SpacetimeDB rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "jdbc") {
    const { executeJdbcQuery, getJdbcTableStructure } = await import("./jdbc-client");
    try {
      const cols = await getJdbcTableStructure(connectionString, schema, table);
      const pkCol = cols.find((c) => c.name.toLowerCase() === "id" || c.ordinal === 1);
      if (!pkCol) {
        return { success: false, error: "No primary key column identified for deletion." };
      }
      for (const row of pkValues) {
        const val = row[pkCol.name];
        if (val === undefined) continue;
        const sql = `DELETE FROM ${schema ? `"${schema}".` : ""}"${table}" WHERE "${pkCol.name}" = ?`;
        await executeJdbcQuery(connectionString, sql, [val]);
      }
      return { success: true };
    } catch (error: any) {
      console.error("Failed to delete JDBC rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "supabase-mgmt") {
    const { executeDbQuery } = await import("./db-engine/query");
    try {
      for (const row of pkValues) {
        const pkCol = Object.keys(row)[0];
        const pkVal = row[pkCol];
        if (pkVal === undefined) continue;
        const escaped = typeof pkVal === "string" ? `'${pkVal.replace(/'/g, "''")}'` : String(pkVal);
        const sql = `DELETE FROM ${schema ? `"${schema}".` : ""}"${table}" WHERE "${pkCol}" = ${escaped}`;
        await executeDbQuery(connectionString, sql);
      }
      return { success: true };
    } catch (error: any) {
      console.error("Failed to delete supabase-mgmt rows:", error);
      return { success: false, error: error.message };
    }
  }

  const { deleteRows, getTablePrimaryKey } = await import("./pg-client");

  try {
    const pkColumn = await getTablePrimaryKey(connectionString, schema, table);
    if (!pkColumn) {
      return {
        success: false,
        error:
          "No primary key found for this table. Deletion is only supported for tables with a primary key.",
      };
    }

    const values = pkValues.map(w => w[pkColumn]);
    await deleteRows(connectionString, schema, table, pkColumn, values);
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete rows:", error);
    return { success: false, error: error.message };
  }
}

export async function updateTableRows(
  connectionString: string,
  schema: string,
  table: string,
  updates: Array<{ where: Record<string, any>; set: Record<string, any> }>,
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    const { updateMongoRows } = await import("./mongo-client");
    try {
      await updateMongoRows(connectionString, schema, table, updates);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update Mongo rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "sqlite") {
    const { updateSqlEngineRows } = await import("./sql-engine");
    try {
      await updateSqlEngineRows(connectionString, schema, table, updates);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update SQLite rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "mysql") {
    const { updateSqlEngineRows } = await import("./sql-engine");
    try {
      await updateSqlEngineRows(connectionString, schema, table, updates);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update MySQL rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "spacetimedb") {
    const { updateSpacetimeDbRows } = await import("./spacetimedb-client");
    try {
      await updateSpacetimeDbRows(connectionString, schema, table, updates);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update SpacetimeDB rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "jdbc") {
    const { executeJdbcQuery } = await import("./jdbc-client");
    try {
      for (const u of updates) {
        const setClauses = Object.entries(u.set).map(([k]) => `${k} = ?`).join(", ");
        const whereClauses = Object.entries(u.where).map(([k]) => `${k} = ?`).join(" AND ");
        const values = [...Object.values(u.set), ...Object.values(u.where)];
        const sql = `UPDATE ${schema ? `"${schema}".` : ""}"${table}" SET ${setClauses} WHERE ${whereClauses}`;
        await executeJdbcQuery(connectionString, sql, values);
      }
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update JDBC rows:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "supabase-mgmt") {
    const { executeDbQuery } = await import("./db-engine/query");
    try {
      for (const u of updates) {
        const setClauses = Object.entries(u.set)
          .map(([k, v]) => {
            const escaped = typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);
            return `"${k}" = ${escaped}`;
          })
          .join(", ");
        const whereClauses = Object.entries(u.where)
          .map(([k, v]) => {
            const escaped = typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);
            return `"${k}" = ${escaped}`;
          })
          .join(" AND ");
        const sql = `UPDATE ${schema ? `"${schema}".` : ""}"${table}" SET ${setClauses} WHERE ${whereClauses}`;
        await executeDbQuery(connectionString, sql);
      }
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update supabase-mgmt rows:", error);
      return { success: false, error: error.message };
    }
  }

  const { updateRows } = await import("./pg-client");

  try {
    await updateRows(connectionString, schema, table, updates);
    return { success: true };
  } catch (error: any) {
    console.error("Failed to update rows:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    const { getMongoCollectionStructure } = await import("./mongo-client");
    try {
      const structure = await getMongoCollectionStructure(
        connectionString,
        schema,
        table,
      );
      return { success: true, data: structure };
    } catch (error: any) {
      console.error("Failed to fetch Mongo collection structure:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "sqlite") {
    const { getSqlEngineTableStructure } = await import("./sql-engine");
    try {
      const structure = await getSqlEngineTableStructure(
        connectionString,
        schema,
        table,
      );
      return { success: true, data: structure };
    } catch (error: any) {
      console.error("Failed to fetch SQLite table structure:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "mysql") {
    const { getSqlEngineTableStructure } = await import("./sql-engine");
    try {
      const structure = await getSqlEngineTableStructure(
        connectionString,
        schema,
        table,
      );
      return { success: true, data: structure };
    } catch (error: any) {
      console.error("Failed to fetch MySQL table structure:", error);
      return { success: false, error: error.message };
    }
  }

  if (
    dbType === "federated" ||
    dbType === "clickhouse" ||
    dbType === "mssql" ||
    dbType === "trino" ||
    dbType === "spacetimedb" ||
    dbType === "jdbc" ||
    dbType === "supabase-mgmt"
  ) {
    const { getDbTableStructure } = await import("./db-engine");
    try {
      const structure = await getDbTableStructure(
        connectionString,
        schema,
        table,
      );
      return { success: true, data: structure };
    } catch (error: any) {
      console.error("Failed to fetch table structure:", error);
      return { success: false, error: error.message };
    }
  }

  const { getTableStructure } = await import("./pg-client");

  try {
    const structure = await getTableStructure(connectionString, schema, table);
    return { success: true, data: structure };
  } catch (error: any) {
    console.error("Failed to fetch table structure:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    return { success: true, data: [] as any[] };
  }

  if (dbType === "sqlite") {
    const { getSqlEngineTableForeignKeys } = await import("./sql-engine");
    try {
      const data = await getSqlEngineTableForeignKeys(
        connectionString,
        schema,
        table,
      );
      return { success: true, data };
    } catch (error: any) {
      console.error("Failed to fetch SQLite foreign keys:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "mysql") {
    const { getSqlEngineTableForeignKeys } = await import("./sql-engine");
    try {
      const data = await getSqlEngineTableForeignKeys(
        connectionString,
        schema,
        table,
      );
      return { success: true, data };
    } catch (error: any) {
      console.error("Failed to fetch MySQL foreign keys:", error);
      return { success: false, error: error.message };
    }
  }

  if (
    dbType === "federated" ||
    dbType === "clickhouse" ||
    dbType === "mssql" ||
    dbType === "trino" ||
    dbType === "spacetimedb" ||
    dbType === "jdbc" ||
    dbType === "supabase-mgmt"
  ) {
    const { getDbTableForeignKeys } = await import("./db-engine");
    try {
      const data = await getDbTableForeignKeys(connectionString, schema, table);
      return { success: true, data };
    } catch (error: any) {
      console.error("Failed to fetch foreign keys:", error);
      return { success: false, error: error.message };
    }
  }

  const { getTableForeignKeys } = await import("./pg-client");

  try {
    const data = await getTableForeignKeys(connectionString, schema, table);
    return { success: true, data };
  } catch (error: any) {
    console.error("Failed to fetch foreign keys:", error);
    return { success: false, error: error.message };
  }
}

async function fetchSqlEngineRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
  dbLabel: string,
) {
  const { getSqlEngineReferencedRecord } = await import("./sql-engine");
  try {
    const result = await getSqlEngineReferencedRecord(connectionString, schema, table, keyValues);
    return { success: true, data: result.row, fields: result.fields };
  } catch (error: any) {
    console.error(`Failed to fetch ${dbLabel} referenced record:`, error);
    return { success: false, error: error.message };
  }
}

export async function fetchReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    return { success: true, data: null, fields: [] as any[] };
  }

  if (dbType === "sqlite" || dbType === "mysql") {
    return fetchSqlEngineRecord(connectionString, schema, table, keyValues, dbType === "sqlite" ? "SQLite" : "MySQL");
  }

  if (dbType === "federated") {
    const { getFederatedReferencedRecord } = await import("./federated");
    try {
      const result = await getFederatedReferencedRecord(
        connectionString,
        schema,
        table,
        keyValues,
      );
      return { success: true, data: result.row, fields: result.fields };
    } catch (error: any) {
      console.error("Failed to fetch federated referenced record:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "jdbc") {
    const { executeJdbcQuery } = await import("./jdbc-client");
    try {
      const whereClauses = Object.entries(keyValues).map(([k]) => `"${k}" = ?`).join(" AND ");
      const values = Object.values(keyValues);
      const sql = `SELECT * FROM ${schema ? `"${schema}".` : ""}"${table}" WHERE ${whereClauses} LIMIT 1`;
      const result = await executeJdbcQuery(connectionString, sql, values);
      return { success: true, data: result.rows[0], fields: result.fields };
    } catch (error: any) {
      console.error("Failed to fetch JDBC referenced record:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "supabase-mgmt") {
    const { executeDbQuery } = await import("./db-engine/query");
    try {
      const whereClauses = Object.entries(keyValues)
        .map(([k, v]) => {
          const escaped = typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);
          return `"${k}" = ${escaped}`;
        })
        .join(" AND ");
      const sql = `SELECT * FROM ${schema ? `"${schema}".` : ""}"${table}" WHERE ${whereClauses} LIMIT 1`;
      const result = await executeDbQuery(connectionString, sql);
      return { success: true, data: result.rows[0], fields: result.fields };
    } catch (error: any) {
      console.error("Failed to fetch supabase-mgmt referenced record:", error);
      return { success: false, error: error.message };
    }
  }

  const { executeQuery } = await import("./pg-client");

  try {
    const built = buildSelectByKeyValuesQuery(schema, table, keyValues);
    if (!built) {
      return { success: false, error: "Missing key values." };
    }
    const result = await executeQuery(
      connectionString,
      built.query,
      built.values,
    );
    return { success: true, data: result.rows[0], fields: result.fields };
  } catch (error: any) {
    console.error("Failed to fetch referenced record:", error);
    return { success: false, error: error.message };
  }
}
