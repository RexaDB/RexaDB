import { detectConnectionDbType } from "./connection-type";
import { isPostgresConnection } from "./pg-connection";

export async function fetchViews(connectionString: string, schema: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    return { success: true, data: [] as any[] };
  }

  if (dbType === "sqlite") {
    const { getSqlEngineViews } = await import("./sql-engine");
    try {
      const views = await getSqlEngineViews(connectionString, schema || "main");
      return { success: true, data: views };
    } catch (error: any) {
      console.error("Failed to fetch SQLite views:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "mysql") {
    const { getSqlEngineViews } = await import("./sql-engine");
    try {
      const views = await getSqlEngineViews(connectionString, schema);
      return { success: true, data: views };
    } catch (error: any) {
      console.error("Failed to fetch MySQL views:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "clickhouse" || dbType === "mssql" || dbType === "trino") {
    const { getDbViews } = await import("./db-engine");
    try {
      const views = await getDbViews(connectionString, schema);
      return { success: true, data: views };
    } catch (error: any) {
      console.error("Failed to fetch views:", error);
      return { success: false, error: error.message };
    }
  }

  try {
    const { getDbViews } = await import("./db-engine");
    const views = await getDbViews(connectionString, schema);
    return { success: true, data: views };
  } catch (error: any) {
    console.error("Failed to fetch views:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchRedisKeys(
  connectionString: string,
  options?: { pattern?: string; limit?: number; db?: string }
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType !== "redis") {
    return { success: false, error: "Redis connection required." };
  }

  const { getRedisKeysWithMeta } = await import("./redis-client");
  try {
    const keys = await getRedisKeysWithMeta(connectionString, options);
    return { success: true, data: keys };
  } catch (error: any) {
    console.error("Failed to fetch Redis keys:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchFunctions(connectionString: string, schema: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mssql" || dbType === "mysql" || dbType === "oracle") {
    const { getDbFunctions } = await import("./db-engine");
    try {
      const fallback = dbType === "mssql" ? schema || "dbo" : schema;
      const routines = await getDbFunctions(connectionString, fallback);
      return { success: true, data: routines };
    } catch (error: any) {
      console.error(`Failed to fetch ${dbType} routines:`, error);
      return { success: false, error: error.message };
    }
  }
  if (!isPostgresConnection(connectionString) && dbType !== "supabase-mgmt") {
    return { success: true, data: [] as any[] };
  }

  const schemaFilter = `'${schema.replace(/'/g, "''")}'`;
  const { executeDbQuery } = await import("./db-engine/query");
  try {
    const res = await executeDbQuery(connectionString, buildPostgresRoutinesSql(schemaFilter));
    return { success: true, data: res.rows };
  } catch (detailedError) {
    // Postgres-compatible engines may lack pg_get_functiondef or the
    // volatility/owner columns; the plain listing still works there.
    try {
      const res = await executeDbQuery(connectionString, buildBasicPostgresRoutinesSql(schemaFilter));
      return { success: true, data: res.rows };
    } catch (error: any) {
      console.error("Failed to fetch functions:", detailedError, error);
      return { success: false, error: error.message };
    }
  }
}

function buildPostgresRoutinesSql(schemaFilter: string) {
  return `
      SELECT
        n.nspname as schema,
        p.proname as name,
        pg_get_function_arguments(p.oid) as arguments,
        t.typname as return_type,
        l.lanname as language,
        CASE WHEN p.prokind = 'a' THEN '' ELSE pg_get_functiondef(p.oid) END as definition,
        CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END as type,
        CASE p.provolatile
          WHEN 'i' THEN 'IMMUTABLE'
          WHEN 's' THEN 'STABLE'
          ELSE 'VOLATILE'
        END as volatility,
        p.prosecdef as security_definer,
        pg_get_userbyid(p.proowner) as owner
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_type t ON p.prorettype = t.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = ${schemaFilter}
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY p.proname;
    `;
}

function buildBasicPostgresRoutinesSql(schemaFilter: string) {
  return `
      SELECT
        n.nspname as schema,
        p.proname as name,
        pg_get_function_arguments(p.oid) as arguments,
        t.typname as return_type,
        l.lanname as language,
        p.prosrc as definition,
        CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END as type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_type t ON p.prorettype = t.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = ${schemaFilter}
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY p.proname;
    `;
}

export async function createDatabase(connectionString: string, dbName: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    const { createMongoDatabase } = await import("./mongo-client");
    try {
      await createMongoDatabase(connectionString, dbName);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to create Mongo database:", error);
      return { success: false, error: error.message };
    }
  }

  if (dbType === "sqlite") {
    return { success: false, error: "SQLite uses a single database file. Create a new SQLite connection instead." };
  }

  if (dbType === "supabase-mgmt") {
    const { executeDbQuery } = await import("./db-engine/query");
    try {
      await executeDbQuery(connectionString, `CREATE DATABASE "${dbName}"`);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to create database:", error);
      return { success: false, error: error.message };
    }
  }

  const { executeQuery } = await import("./pg-client");

  try {
    const sql = `CREATE DATABASE "${dbName}"`;
    await executeQuery(connectionString, sql);
    return { success: true };
  } catch (error: any) {
    console.error("Failed to create database:", error);
    return { success: false, error: error.message };
  }
}

export async function createSchema(connectionString: string, schemaName: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    return { success: false, error: "MongoDB does not support SQL schemas." };
  }

  if (dbType === "sqlite") {
    return { success: false, error: "SQLite does not support PostgreSQL-style schemas." };
  }

  if (dbType === "supabase-mgmt") {
    const { executeDbQuery } = await import("./db-engine/query");
    try {
      await executeDbQuery(connectionString, `CREATE SCHEMA "${schemaName}";`);
      return { success: true };
    } catch (error: any) {
      console.error("Failed to create schema:", error);
      return { success: false, error: error.message };
    }
  }

  const { executeQuery } = await import("./pg-client");

  try {
    const sql = `CREATE SCHEMA "${schemaName}";`;
    await executeQuery(connectionString, sql);
    return { success: true };
  } catch (error: any) {
    console.error("Failed to create schema:", error);
    return { success: false, error: error.message };
  }
}
