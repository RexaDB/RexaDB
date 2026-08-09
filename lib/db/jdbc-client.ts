import {
  jdbcExecuteQuery,
  jdbcGetSchemas,
  jdbcGetTables,
  jdbcGetTableStructure,
  jdbcGetForeignKeys,
  jdbcTestConnection,
  type JdbcConfig,
} from "./jdbc-bridge-manager";
import type { QueryResult } from "./client-types";

function log(...args: any[]) {
  try { console.log("[jdbc-client]", ...args); } catch {}
}

function parseJdbcConnectionString(connectionString: string): JdbcConfig {
  log("parseJdbcConnectionString input:", connectionString.slice(0, 120));
  let url: URL;
  try {
    url = new URL(connectionString);
    log("URL parsed: protocol=" + url.protocol + " searchParams keys=" + Array.from(url.searchParams.keys()).join(","));
  } catch (e: any) {
    log("URL parse FAILED:", e.message);
    throw new Error(`Invalid JDBC connection string: ${e.message}`);
  }
  const jdbcUrl = decodeURIComponent(url.searchParams.get("jdbcUrl") || "");
  const driverClass = url.searchParams.get("driverClass") || "";
  const jarPaths = (url.searchParams.get("jarPaths") || "").split(",").filter(Boolean);
  const username = url.searchParams.get("username") || "";
  const password = url.searchParams.get("password") || "";

  log("parsed config:", { jdbcUrl, driverClass, jarPaths, username });

  if (!jdbcUrl || !driverClass) {
    throw new Error("JDBC connection string must include jdbcUrl and driverClass parameters. Format: jdbc://?jdbcUrl=...&driverClass=...&jarPaths=...");
  }

  return { jdbcUrl, driverClass, jarPaths, username, password };
}

export function buildJdbcConfig(opts: {
  jdbcUrl: string;
  driverClass: string;
  jarPaths: string[];
  username?: string;
  password?: string;
}): string {
  const params = new URLSearchParams({
    jdbcUrl: opts.jdbcUrl,
    driverClass: opts.driverClass,
    jarPaths: opts.jarPaths.join(","),
    username: opts.username || "",
    password: opts.password || "",
  });
  return `jdbc://?${params.toString()}`;
}

function unparseConfig(config: JdbcConfig): string {
  return buildJdbcConfig(config);
}

export function parseJdbcConfig(connectionString: string): JdbcConfig {
  return parseJdbcConnectionString(connectionString);
}

export async function executeJdbcQuery(
  connectionString: string,
  sql: string,
  params: any[] = []
): Promise<QueryResult> {
  const config = parseJdbcConnectionString(connectionString);
  const result = await jdbcExecuteQuery(config, sql);
  const fields = result.columns.map((c) => ({
    name: c.name,
    dataTypeID: 0,
    dataTypeName: c.type,
  }));
  return {
    rows: result.rows.map((row) => {
      const obj: Record<string, any> = {};
      result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    }),
    fields,
    rowCount: result.rows.length,
  };
}

export async function getJdbcSchemas(connectionString: string): Promise<string[]> {
  const config = parseJdbcConnectionString(connectionString);
  return jdbcGetSchemas(config);
}

export async function getJdbcTables(
  connectionString: string,
  schema: string
): Promise<Array<{ name: string; type: string; schema: string }>> {
  const config = parseJdbcConnectionString(connectionString);
  return jdbcGetTables(config, schema);
}

export async function getJdbcTableStructure(
  connectionString: string,
  schema: string,
  table: string
): Promise<Array<{ name: string; type: string; size: number; nullable: boolean; default: string; ordinal: number }>> {
  const config = parseJdbcConnectionString(connectionString);
  return jdbcGetTableStructure(config, schema, table);
}

export async function getJdbcForeignKeys(
  connectionString: string,
  schema: string,
  table: string
): Promise<Array<{ fkColumn: string; pkTable: string; pkColumn: string }>> {
  const config = parseJdbcConnectionString(connectionString);
  return jdbcGetForeignKeys(config, schema, table);
}

export async function testJdbcConnection(connectionString: string): Promise<boolean> {
  log("testJdbcConnection called with:", connectionString);
  const config = parseJdbcConnectionString(connectionString);
  log("parsed JdbcConfig:", {
    jdbcUrl: config.jdbcUrl,
    driverClass: config.driverClass,
    jarPaths: config.jarPaths,
    username: config.username,
  });
  try {
    const result = await jdbcTestConnection(config);
    log("jdbcTestConnection result:", result);
    return result;
  } catch (e: any) {
    log("jdbcTestConnection threw:", e.message);
    throw e;
  }
}
