import { z } from "zod";
import { createTool } from "@mastra/core/tools";

import { ok, fail } from "./ai-shared";
import { createThemeTools } from "@/lib/ai/theme-tools";
import { createTaskTools } from "@/lib/ai/task-tools";
import { createApprovalTools } from "@/lib/ai/approval-tools";
import { detectConnectionDbType, getMongoDatabaseFromConnectionString } from "@/lib/db/connection-type";
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
import { buildDashboardRef } from "@/lib/ai/dashboard-refs";
import type { LightDashboardContext } from "@/lib/ai/types";

type AgentToolContext = {
  connectionString: string;
  defaultNamespace?: string;
  permissionMode?: "schema_only" | "schema_with_data";
  dashboardContext?: LightDashboardContext[];
  emitStep: (message: string) => void;
};

function getDbCapabilities(dbType: string) {
  return {
    supportsNamespaces: dbType !== "redis",
    supportsStructuredSchema: dbType !== "redis",
    supportsRelatedTables: !["mongodb", "redis", "clickhouse", "trino"].includes(dbType),
    supportsReadOnlyQuery: !["redis"].includes(dbType),
    supportsSampleRows: !["redis"].includes(dbType),
    querySyntax: dbType === "mongodb" ? "mongo-json-or-shell" : dbType === "redis" ? "redis-command" : "sql",
  };
}

function ensureReadOnlySql(query: string) {
  const normalized = String(query || "").trim().replace(/;+$/g, "");
  if (!normalized) {
    throw new Error("SQL is required.");
  }

  if (!/^(select|with|explain)\b/i.test(normalized)) {
    throw new Error("Only read-only SQL is allowed. Use SELECT, WITH, or EXPLAIN.");
  }

  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|refresh|reindex|call|do|copy)\b/i.test(normalized)) {
    throw new Error("Potentially mutating SQL was rejected.");
  }
}

function quoteIdentifier(dbType: string, value: string) {
  if (dbType === "mysql" || dbType === "clickhouse") return `\`${value.replace(/`/g, "``")}\``;
  if (dbType === "mssql") return `[${value.replace(/]/g, "]]")}]`;
  return `"${value.replace(/"/g, '""')}"`;
}

function tableRef(dbType: string, schema: string, table: string) {
  if (!schema || dbType === "spacetimedb") return quoteIdentifier(dbType, table);
  return `${quoteIdentifier(dbType, schema)}.${quoteIdentifier(dbType, table)}`;
}

function buildSampleQuery(dbType: string, schema: string, table: string, limit: number) {
  const ref = tableRef(dbType, schema, table);
  if (dbType === "mssql") return `SELECT TOP ${limit} * FROM ${ref};`;
  return `SELECT * FROM ${ref} LIMIT ${limit};`;
}

function normalizeDashboardRef(value: string) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function resolveDashboardRef(ref: string, dashboards: LightDashboardContext[]) {
  const normalized = normalizeDashboardRef(ref);
  if (!normalized) return null;

  const exact = dashboards.find((dashboard) => normalizeDashboardRef(dashboard.ref) === normalized);
  if (exact) return exact;

  const byId = dashboards.find((dashboard) => dashboard.id.toLowerCase() === normalized);
  if (byId) return byId;

  const suffix = normalized.split("-").at(-1) || "";
  if (suffix) {
    const bySuffix = dashboards.find((dashboard) => dashboard.id.toLowerCase().startsWith(suffix));
    if (bySuffix) return bySuffix;
  }

  const byCanonicalRef = dashboards.find((dashboard) =>
    normalizeDashboardRef(buildDashboardRef(dashboard.name, dashboard.id)) === normalized,
  );
  if (byCanonicalRef) return byCanonicalRef;

  const slugPart = normalized.startsWith("dashboard.") ? normalized.slice("dashboard.".length) : normalized;
  const bySlug = dashboards.find((dashboard) => {
    const canonical = normalizeDashboardRef(buildDashboardRef(dashboard.name, dashboard.id));
    const canonicalSlug = canonical.startsWith("dashboard.") ? canonical.slice("dashboard.".length) : canonical;
    return canonicalSlug === slugPart || canonicalSlug.startsWith(`${slugPart}-`) || slugPart.startsWith(`${canonicalSlug}-`);
  });
  return bySlug || null;
}

export function createRexaDbTools(context: AgentToolContext) {
  const dbType = detectConnectionDbType(context.connectionString);
  const isSchemaOnly = context.permissionMode === "schema_only";
  const dashboardContext = Array.isArray(context.dashboardContext) ? context.dashboardContext : [];

  return {
    ...createThemeTools(),
    ...createTaskTools({ emitStep: context.emitStep }),
    ...createApprovalTools(),
    describe_connection_capabilities: createTool({
      id: "describe_connection_capabilities",
      description: "Describe which read-only capabilities are available for the current backend.",
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async () => ok({ dbType, capabilities: getDbCapabilities(dbType) }),
    }),
    list_namespaces: createTool({
      id: "list_namespaces",
      description: "List databases or schemas available on the current connection.",
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async () => {
        context.emitStep("Inspecting namespaces");
        try {
          if (dbType === "mongodb" || dbType === "redis") {
            const result = await fetchDatabases(context.connectionString);
            return result.success ? ok({ namespaces: result.data || [] }) : fail(result.error);
          }
          const result = await fetchSchemas(context.connectionString);
          return result.success ? ok({ namespaces: result.data || [] }) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    list_tables: createTool({
      id: "list_tables",
      description: "List tables or collections for a namespace.",
      inputSchema: z.object({
        namespace: z.string().optional(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ namespace }) => {
        context.emitStep("Listing tables");
        try {
          if (dbType === "mongodb") {
            const collections = await getMongoCollections(context.connectionString, namespace || getMongoDatabaseFromConnectionString(context.connectionString));
            return ok({ tables: collections.map((name) => ({ schema: namespace || getMongoDatabaseFromConnectionString(context.connectionString), name })) });
          }
          if (dbType === "redis") {
            const keys = await fetchRedisKeys(context.connectionString, { db: namespace, limit: 100 });
            return keys.success
              ? ok({ tables: (keys.data || []).map((item: any) => ({ schema: namespace || "0", name: item.key, type: item.type })) })
              : fail(keys.error);
          }
          const result = await fetchTables(context.connectionString, namespace || context.defaultNamespace || "");
          return result.success ? ok({ tables: result.data || [] }) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    list_dashboards: createTool({
      id: "list_dashboards",
      description: "List dashboards available in the current studio session, including their reference tokens.",
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async () => {
        context.emitStep("Listing dashboards");
        return ok({
          dashboards: dashboardContext.map((dashboard) => ({
            id: dashboard.id,
            ref: dashboard.ref,
            name: dashboard.name,
            widgetCount: dashboard.widgets.length,
          })),
        });
      },
    }),
    get_dashboard_definition: createTool({
      id: "get_dashboard_definition",
      description: "Get the current widget layout and queries for a dashboard reference like dashboard.some-name-ab12cd.",
      inputSchema: z.object({
        ref: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ ref }) => {
        context.emitStep(`Inspecting dashboard ${ref}`);
        const match = resolveDashboardRef(ref, dashboardContext);
        if (!match) {
          return fail(`Dashboard reference "${ref}" was not found.`);
        }
        return ok({ dashboard: match });
      },
    }),
    get_table_schema: createTool({
      id: "get_table_schema",
      description: "Get columns and field details for a table or collection.",
      inputSchema: z.object({
        namespace: z.string().optional(),
        table: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ namespace, table }) => {
        context.emitStep(`Inspecting schema for ${table}`);
        try {
          if (dbType === "redis") {
            return fail("Redis does not expose table schemas.");
          }
          let schema = namespace || context.defaultNamespace || "";
          if (dbType === "sqlite" && !schema) schema = "main";
          const result = await fetchTableStructure(context.connectionString, schema, table);
          return result.success ? ok({ table, structure: result.data || [] }) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    get_related_tables: createTool({
      id: "get_related_tables",
      description: "Get foreign-key style relationships for a table when the backend supports it.",
      inputSchema: z.object({
        namespace: z.string().optional(),
        table: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ namespace, table }) => {
        context.emitStep(`Checking related tables for ${table}`);
        try {
          const capabilities = getDbCapabilities(dbType);
          if (!capabilities.supportsRelatedTables) {
            return fail(`Related table inspection is not supported for ${dbType}.`);
          }
          const result = await fetchTableForeignKeys(context.connectionString, namespace || context.defaultNamespace || "", table);
          return result.success ? ok({ table, relationships: result.data || [] }) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    sample_rows: createTool({
      id: "sample_rows",
      description: "Fetch a small read-only sample from a table or collection.",
      inputSchema: z.object({
        namespace: z.string().optional(),
        table: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ namespace, table, limit = 20 }) => {
        context.emitStep(`Sampling rows from ${table}`);
        try {
          if (isSchemaOnly) {
            return fail("This chat is limited to schema-only access.");
          }
          if (dbType === "mongodb") {
            const result = await executeMongoQuery(
              context.connectionString,
              JSON.stringify({
                database: namespace || getMongoDatabaseFromConnectionString(context.connectionString),
                collection: table,
                operation: "find",
                limit,
              }),
            );
            return ok({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          if (dbType === "redis") {
            const keys = await fetchRedisKeys(context.connectionString, { db: namespace, pattern: `${table}*`, limit });
            return keys.success ? ok({ rows: keys.data || [], rowCount: (keys.data || []).length }) : fail(keys.error);
          }
          const result = await runQuery(context.connectionString, buildSampleQuery(dbType, namespace || context.defaultNamespace || "", table, limit));
          return result.success ? ok(result.data || {}) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    run_readonly_query: createTool({
      id: "run_readonly_query",
      description: "Execute a read-only query against the current connection.",
      inputSchema: z.object({
        query: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ query }) => {
        context.emitStep("Running a read-only query");
        try {
          if (isSchemaOnly) {
            return fail("This chat is limited to schema-only access.");
          }
          if (dbType === "mongodb") {
            const result = await executeMongoQuery(context.connectionString, query);
            return ok({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          if (dbType === "redis") {
            const parts = String(query || "").trim().split(/\s+/);
            const command = parts[0]?.toUpperCase() || "";
            if (!["GET", "MGET", "HGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL", "PTTL", "EXISTS", "KEYS", "SCAN", "PING"].includes(command)) {
              return fail("Only read-only Redis commands are allowed.");
            }
            const result = await executeRedisCommand(context.connectionString, query);
            return ok({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          ensureReadOnlySql(query);
          const result = await runQuery(context.connectionString, query);
          return result.success ? ok(result.data || {}) : fail(result.error);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    search_schema: createTool({
      id: "search_schema",
      description: "Fuzzy-search tables and columns by keyword.",
      inputSchema: z.object({
        query: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean(), data: z.any().nullable(), error: z.string().nullable() }),
      execute: async ({ query }) => {
        context.emitStep(`Searching schema for "${query}"`);
        try {
          const needle = String(query || "").trim().toLowerCase();
          if (!needle) return ok({ matches: [] });
          const result = await fetchAllTablesWithColumns(context.connectionString);
          if (!result.success || !Array.isArray(result.data)) {
            return fail(result.error || "Failed to inspect schema.");
          }
          const matches = result.data
            .filter((row: any) =>
              String(row.table_name || "").toLowerCase().includes(needle)
              || String(row.column_name || "").toLowerCase().includes(needle)
              || String(row.table_schema || "").toLowerCase().includes(needle))
            .slice(0, 60);
          return ok({ matches });
        } catch (error) {
          return fail(error);
        }
      },
    }),
  };
}
