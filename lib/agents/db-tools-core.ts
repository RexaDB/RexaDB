/**
 * Shared DB tool handlers for the built-in pi-agent AND the RexaDB MCP server.
 * Keep this free of pi-coding-agent / MCP SDK types so both sides can wrap it.
 */
import {
  detectConnectionDbType,
  getMongoDatabaseFromConnectionString,
} from "@/lib/db/connection-type";
import {
  fetchAllTablesWithColumns,
  fetchDatabases,
  fetchRedisKeys,
  fetchSchemas,
  fetchTableForeignKeys,
  fetchTableStructure,
  fetchTables,
  runQuery,
} from "@/lib/db/actions";
import { executeMongoQuery, getMongoCollections } from "@/lib/db/mongo-client";
import { executeRedisCommand } from "@/lib/db/redis-client";

export type DbToolsPermissions = {
  allowSqlRead: boolean;
  allowSqlWrite: boolean;
};

export type DbToolsContext = {
  connectionString: string;
  dbType?: string;
  connectionName?: string;
  defaultNamespace?: string;
  permissions: DbToolsPermissions;
};

export type DbToolResult = {
  ok: true;
  data: unknown;
} | {
  ok: false;
  error: string;
};

function ok(data: unknown): DbToolResult {
  return { ok: true, data };
}

function err(error: unknown): DbToolResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error || "Unknown error"),
  };
}

function resolveDbType(ctx: DbToolsContext) {
  return ctx.dbType || detectConnectionDbType(ctx.connectionString);
}

export { getDbCapabilities, ensureReadOnlySql, quoteIdentifier, tableRef, buildSampleQuery } from "@/lib/db/sql-guards";
import { getDbCapabilities, ensureReadOnlySql, tableRef, buildSampleQuery } from "@/lib/db/sql-guards";

function ns(ctx: DbToolsContext, value?: string) {
  return value || ctx.defaultNamespace || "";
}

export async function describeConnection(ctx: DbToolsContext): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    return ok({
      connectionName: ctx.connectionName || null,
      dbType,
      capabilities: getDbCapabilities(dbType),
      permissions: ctx.permissions,
    });
  } catch (e) {
    return err(e);
  }
}

export async function listNamespaces(ctx: DbToolsContext): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    if (dbType === "mongodb" || dbType === "redis") {
      const result = await fetchDatabases(ctx.connectionString);
      if (!result.success) return err(result.error);
      return ok({ namespaces: result.data || [] });
    }
    const result = await fetchSchemas(ctx.connectionString);
    if (!result.success) return err(result.error);
    return ok({ namespaces: result.data || [] });
  } catch (e) {
    return err(e);
  }
}

export async function listTables(
  ctx: DbToolsContext,
  params: { namespace?: string },
): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    if (dbType === "mongodb") {
      const database =
        params.namespace || getMongoDatabaseFromConnectionString(ctx.connectionString);
      const collections = await getMongoCollections(ctx.connectionString, database);
      return ok({
        tables: collections.map((name) => ({ schema: database, name })),
      });
    }
    if (dbType === "redis") {
      const keys = await fetchRedisKeys(ctx.connectionString, {
        db: params.namespace,
        limit: 100,
      });
      if (!keys.success) return err(keys.error);
      return ok({
        tables: (keys.data || []).map((item: any) => ({
          schema: params.namespace || "0",
          name: item.key,
          type: item.type,
        })),
      });
    }
    let schema = ns(ctx, params.namespace);
    if (dbType === "sqlite" && !schema) schema = "main";
    const result = await fetchTables(ctx.connectionString, schema);
    if (!result.success) return err(result.error);
    return ok({ tables: result.data || [] });
  } catch (e) {
    return err(e);
  }
}

export async function getTableSchema(
  ctx: DbToolsContext,
  params: { namespace?: string; table: string },
): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    if (dbType === "redis") return err("Redis does not expose table schemas.");
    let schema = ns(ctx, params.namespace);
    // SQLite uses "main" as default schema — empty quotes fail in PRAGMA
    if (dbType === "sqlite" && !schema) schema = "main";
    const result = await fetchTableStructure(
      ctx.connectionString,
      schema,
      params.table,
    );
    if (!result.success) return err(result.error);
    return ok({ table: params.table, structure: result.data || [] });
  } catch (e) {
    return err(e);
  }
}

export async function getRelatedTables(
  ctx: DbToolsContext,
  params: { namespace?: string; table: string },
): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    const capabilities = getDbCapabilities(dbType);
    if (!capabilities.supportsRelatedTables) {
      return err(`Related table inspection is not supported for ${dbType}.`);
    }
    let schema = ns(ctx, params.namespace);
    if (dbType === "sqlite" && !schema) schema = "main";
    const result = await fetchTableForeignKeys(
      ctx.connectionString,
      schema,
      params.table,
    );
    if (!result.success) return err(result.error);
    return ok({ table: params.table, relationships: result.data || [] });
  } catch (e) {
    return err(e);
  }
}

export async function sampleRows(
  ctx: DbToolsContext,
  params: { namespace?: string; table: string; limit?: number },
): Promise<DbToolResult> {
  try {
    if (!ctx.permissions.allowSqlRead) {
      return err("This agent mode does not allow reading table data.");
    }
    const dbType = resolveDbType(ctx);
    const limit = params.limit ?? 20;
    if (dbType === "mongodb") {
      const result = await executeMongoQuery(
        ctx.connectionString,
        JSON.stringify({
          database:
            params.namespace ||
            getMongoDatabaseFromConnectionString(ctx.connectionString),
          collection: params.table,
          operation: "find",
          limit,
        }),
      );
      return ok({
        columns: result.fields,
        rows: result.rows,
        rowCount: result.rowCount,
      });
    }
    if (dbType === "redis") {
      const keys = await fetchRedisKeys(ctx.connectionString, {
        db: params.namespace,
        pattern: `${params.table}*`,
        limit,
      });
      if (!keys.success) return err(keys.error);
      return ok({ rows: keys.data || [], rowCount: (keys.data || []).length });
    }
    const result = await runQuery(
      ctx.connectionString,
      buildSampleQuery(dbType, ns(ctx, params.namespace), params.table, limit),
    );
    if (!result.success) return err(result.error);
    return ok(result.data || {});
  } catch (e) {
    return err(e);
  }
}

export async function runSql(
  ctx: DbToolsContext,
  params: { query: string },
): Promise<DbToolResult> {
  try {
    const dbType = resolveDbType(ctx);
    const query = String(params.query || "");

    if (dbType === "mongodb") {
      if (!ctx.permissions.allowSqlRead) {
        return err("This agent mode does not allow running queries.");
      }
      // Writes in mongo JSON are hard to gate — require write permission for non-find ops.
      const looksWrite = /\b(insert|update|delete|drop|create|replace)\b/i.test(query);
      if (looksWrite && !ctx.permissions.allowSqlWrite) {
        return err("This agent mode is plan/read-only — mutating Mongo operations are blocked.");
      }
      if (!looksWrite && !ctx.permissions.allowSqlRead) {
        return err("This agent mode does not allow reading data.");
      }
      const result = await executeMongoQuery(ctx.connectionString, query);
      return ok({
        columns: result.fields,
        rows: result.rows,
        rowCount: result.rowCount,
      });
    }

    if (dbType === "redis") {
      if (!ctx.permissions.allowSqlRead) {
        return err("This agent mode does not allow running commands.");
      }
      const parts = query.trim().split(/\s+/);
      const command = parts[0]?.toUpperCase() || "";
      const readOnly = [
        "GET", "MGET", "HGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE",
        "XRANGE", "TYPE", "TTL", "PTTL", "EXISTS", "KEYS", "SCAN", "PING",
      ];
      if (!readOnly.includes(command) && !ctx.permissions.allowSqlWrite) {
        return err("This agent mode is plan/read-only — only read Redis commands are allowed.");
      }
      const result = await executeRedisCommand(ctx.connectionString, query);
      return ok({
        columns: result.fields,
        rows: result.rows,
        rowCount: result.rowCount,
      });
    }

    // SQL engines
    const isRead = /^(select|with|explain)\b/i.test(query.trim());
    if (isRead) {
      if (!ctx.permissions.allowSqlRead) {
        return err("This agent mode does not allow running SQL.");
      }
      ensureReadOnlySql(query);
    } else {
      if (!ctx.permissions.allowSqlWrite) {
        return err(
          "This agent mode is plan/read-only — mutating SQL is blocked. Emit a ```schema-plan or ```sql proposal instead.",
        );
      }
    }

    const result = await runQuery(ctx.connectionString, query);
    if (!result.success) return err(result.error);
    return ok(result.data || {});
  } catch (e) {
    return err(e);
  }
}

export async function searchSchema(
  ctx: DbToolsContext,
  params: { query: string },
): Promise<DbToolResult> {
  try {
    const needle = String(params.query || "").trim().toLowerCase();
    if (!needle) return ok({ matches: [] });
    const result = await fetchAllTablesWithColumns(ctx.connectionString);
    if (!result.success || !Array.isArray(result.data)) {
      return err(result.error || "Failed to inspect schema.");
    }
    const matches = result.data
      .filter(
        (row: any) =>
          String(row.table_name || "").toLowerCase().includes(needle) ||
          String(row.column_name || "").toLowerCase().includes(needle) ||
          String(row.table_schema || "").toLowerCase().includes(needle),
      )
      .slice(0, 60);
    return ok({ matches });
  } catch (e) {
    return err(e);
  }
}

export type DbToolName =
  | "describe_connection"
  | "list_namespaces"
  | "list_tables"
  | "get_table_schema"
  | "get_related_tables"
  | "sample_rows"
  | "run_sql"
  | "search_schema";

export async function executeDbTool(
  name: DbToolName,
  ctx: DbToolsContext,
  args: Record<string, unknown>,
): Promise<DbToolResult> {
  switch (name) {
    case "describe_connection":
      return describeConnection(ctx);
    case "list_namespaces":
      return listNamespaces(ctx);
    case "list_tables":
      return listTables(ctx, {
        namespace: typeof args.namespace === "string" ? args.namespace : undefined,
      });
    case "get_table_schema":
      return getTableSchema(ctx, {
        namespace: typeof args.namespace === "string" ? args.namespace : undefined,
        table: String(args.table || ""),
      });
    case "get_related_tables":
      return getRelatedTables(ctx, {
        namespace: typeof args.namespace === "string" ? args.namespace : undefined,
        table: String(args.table || ""),
      });
    case "sample_rows":
      return sampleRows(ctx, {
        namespace: typeof args.namespace === "string" ? args.namespace : undefined,
        table: String(args.table || ""),
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "run_sql":
      return runSql(ctx, { query: String(args.query || "") });
    case "search_schema":
      return searchSchema(ctx, { query: String(args.query || "") });
    default:
      return err(`Unknown tool: ${name}`);
  }
}
