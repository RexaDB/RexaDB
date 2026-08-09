import {
  detectConnectionDbType,
  getMongoDatabaseFromConnectionString,
} from "./connection-type";
import type { QueryResult } from "./client-types";
import { computeBasicStats, computeQueriesByDay, computeTopQueries } from "./analytics-utils";

import {
  SQLITE_BUSY_RETRY_ATTEMPTS,
  SQLITE_BUSY_BASE_DELAY_MS,
  DEFAULT_SCHEMA_CACHE_MAX_AGE_MS,
  AUTO_SEED_CONNECTIONS,
} from "./actions-constants";

import {
  normalizePgConnectionString,
  getPgPassword,
  getPgUsername,
  getPgDatabase,
  getPgHost,
  getPgPort,
  getPgSslConfig,
  isPostgresConnection,
} from "./pg-connection";
import {
  SUPABASE_DUMP_EXCLUDED_SCHEMA_PATTERNS,
  isLikelySupabaseConnection,
  schemaMatchesPattern,
  isSupabaseExcludedSchema,
} from "./supabase-helpers";
import {
  isSqliteBusyError,
  formatDbError,
  toTimestamp,
  withSqliteBusyRetry,
  runCoreTransaction,
} from "./sqlite-helpers";

import type { CachedColumnRow } from "./schema-cache-actions";
import { runPgDumpSchemaOnly as _runPgDumpSchemaOnly } from "./export-helpers";
import { ensureAppStorageTables } from "./app-admin-actions";
import { ensureCoreTables, ensureConnectionExists } from "./ensure-core-tables";
import { splitSqlStatements as rawSplitSql } from "@/lib/studio/split-sql";
import {
  runQuery,
  fetchAllTablesWithColumns as _fetchAllTablesWithColumns,
  getConnections as _getConnections,
  getConnection as _getConnection,
  fetchSchemas as _fetchSchemas,
  fetchTables as _fetchTables,
  cancelRunningQuery as _cancelRunningQuery,
  upsertUserProfile as _upsertUserProfile,
  getStoredUserProfile as _getStoredUserProfile,
  deleteUserProfile as _deleteUserProfile,
  clearAllUsers as _clearAllUsers,
  getAllUsers as _getAllUsers,
  updateUserPlan as _updateUserPlan,
  getStoredUserEntitlement as _getStoredUserEntitlement,
  upsertUserEntitlement as _upsertUserEntitlement,
  getStudioFolders as _getStudioFolders,
  saveStudioFolders as _saveStudioFolders,
  getStudioSnippets as _getStudioSnippets,
  saveStudioSnippets as _saveStudioSnippets,
  createSnippetVersion as _createSnippetVersion,
  getSnippetVersions as _getSnippetVersions,
  restoreSnippetVersion as _restoreSnippetVersion,
  deleteAiChat as _deleteAiChat,
  listAiChats as _listAiChats,
  saveGlobalAiSettings as _saveGlobalAiSettings,
} from "./actions-core";

export { runQuery };
export async function fetchAllTablesWithColumns(
  connectionString: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number; schema?: string },
) {
  return _fetchAllTablesWithColumns(connectionString, options);
}

export {
  fetchRedisKeys,
  fetchTableStructure,
  fetchTableForeignKeys,
} from "./actions-core";

async function getConnections() {
  return _getConnections();
}
export async function getConnection(id: number) {
  return _getConnection(id);
}
export async function fetchSchemas(
  connectionString: string,
  options?: {
    forceRefresh?: boolean;
    cacheMaxAgeMs?: number;
    connectionType?: string;
  },
) {
  return _fetchSchemas(connectionString, options);
}
export async function fetchTables(
  connectionString: string,
  schema: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number },
) {
  return _fetchTables(connectionString, schema, options);
}
async function cancelRunningQuery(connectionString: string, queryId: string) {
  return _cancelRunningQuery(connectionString, queryId);
}
async function upsertUserProfile(payload: {
  id: string;
  email?: string | null;
  name?: string | null;
  createdAt?: number | string | Date | null;
  isLocal?: boolean;
  supabaseId?: string | null;
}) {
  return _upsertUserProfile(payload);
}
async function getStoredUserProfile(id?: string | null) {
  return _getStoredUserProfile(id);
}
async function deleteUserProfile(id: string) {
  return _deleteUserProfile(id);
}
async function clearAllUsers() {
  return _clearAllUsers();
}
async function getAllUsers() {
  return _getAllUsers();
}
async function updateUserPlan(payload: {
  id: string;
  planType: string;
  planStatus?: string | null;
  planSyncedAt?: number | string | Date | null;
  planPeriodEnd?: number | string | Date | null;
}) {
  return _updateUserPlan(payload);
}
async function getStoredUserEntitlement(id?: string | null) {
  return _getStoredUserEntitlement(id);
}
async function upsertUserEntitlement(payload: {
  userId?: string | null;
  payload?: Record<string, unknown> | null;
  payloadJson?: string | null;
  signature?: string | null;
  lastObservedAt?: number | string | Date | null;
}) {
  return _upsertUserEntitlement(payload);
}
async function getStudioFolders(connectionId: number) {
  return _getStudioFolders(connectionId);
}
async function saveStudioFolders(connectionId: number, foldersList: any[]) {
  return _saveStudioFolders(connectionId, foldersList);
}
async function getStudioSnippets(connectionId: number) {
  return _getStudioSnippets(connectionId);
}
async function saveStudioSnippets(connectionId: number, snippetsList: any[]) {
  return _saveStudioSnippets(connectionId, snippetsList);
}
async function createSnippetVersion(
  connectionId: number,
  snippetId: string,
  name: string,
  query: string,
) {
  return _createSnippetVersion(connectionId, snippetId, name, query);
}
async function getSnippetVersions(connectionId: number, snippetId: string) {
  return _getSnippetVersions(connectionId, snippetId);
}
async function restoreSnippetVersion(
  connectionId: number,
  snippetId: string,
  versionId: string,
) {
  return _restoreSnippetVersion(connectionId, snippetId, versionId);
}
async function deleteAiChat(chatId: string) {
  return _deleteAiChat(chatId);
}
async function listAiChats(connectionId: number) {
  return _listAiChats(connectionId);
}
async function saveGlobalAiSettings(settings: any) {
  return _saveGlobalAiSettings(settings);
}

async function getGlobalAiSettings() {
  const { getGlobalAiSettings: _getGlobalAiSettings } =
    await import("./ai-actions");
  return _getGlobalAiSettings(ensureCoreTables);
}
async function ensureAiChat(payload: {
  chatId: string;
  connectionId: number;
  userId?: string | null;
  title?: string;
  sourcePrompt?: string;
}) {
  const { ensureAiChat: _ensureAiChat } = await import("./ai-actions");
  return _ensureAiChat(
    payload as any,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
async function appendAiChatMessage(payload: any) {
  const { appendAiChatMessage: _appendAiChatMessage } =
    await import("./ai-actions");
  return _appendAiChatMessage(payload, ensureCoreTables);
}
async function getAiChatMessages(chatId: string) {
  const { getAiChatMessages: _getAiChatMessages } =
    await import("./ai-actions");
  return _getAiChatMessages(chatId, ensureCoreTables);
}
async function updateAiChatMessageContent(payload: {
  id: string;
  chatId: string;
  content: string;
  timestamp?: number;
}) {
  const { updateAiChatMessageContent: _updateAiChatMessageContent } =
    await import("./ai-actions");
  return _updateAiChatMessageContent(payload, ensureCoreTables);
}
async function deleteAiChatMessagesAfter(payload: {
  chatId: string;
  timestamp: number;
}) {
  const { deleteAiChatMessagesAfter: _deleteAiChatMessagesAfter } =
    await import("./ai-actions");
  return _deleteAiChatMessagesAfter(payload, ensureCoreTables);
}

async function runPgDumpSchemaOnly(connectionString: string) {
  return _runPgDumpSchemaOnly(connectionString, runQuery);
}

function normalizeSchemaSqlForCompare(schemaSql: string) {
  const lines = schemaSql.replace(/\r\n/g, "\n").split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("--")) return false;
    if (/^SET\b/i.test(trimmed)) return false;
    if (/^SELECT pg_catalog\\.set_config/i.test(trimmed)) return false;
    return true;
  });
  return filtered.join("\n");
}

function splitSqlStatements(sql: string) {
  return rawSplitSql(normalizeSchemaSqlForCompare(sql));
}

function normalizeStatement(statement: string) {
  return statement.replace(/\\s+/g, " ").trim();
}

function extractComparableStatements(schemaSql: string) {
  const statements = splitSqlStatements(schemaSql);
  return statements
    .map((stmt) => ({ raw: stmt, normalized: normalizeStatement(stmt) }))
    .filter((stmt) => stmt.normalized.length > 0);
}

async function comparePostgresSchemas(
  sourceConnectionString: string,
  targetConnectionString: string,
) {
  if (
    !isPostgresConnection(sourceConnectionString) ||
    !isPostgresConnection(targetConnectionString)
  ) {
    return {
      success: false,
      error: "Schema comparison is supported only for PostgreSQL connections.",
    };
  }

  try {
    const [sourceSchemaSql, targetSchemaSql] = await Promise.all([
      runPgDumpSchemaOnly(sourceConnectionString),
      runPgDumpSchemaOnly(targetConnectionString),
    ]);

    const sourceStatements = extractComparableStatements(sourceSchemaSql);
    const targetStatements = extractComparableStatements(targetSchemaSql);
    const targetSet = new Set(targetStatements.map((stmt) => stmt.normalized));
    const sourceSet = new Set(sourceStatements.map((stmt) => stmt.normalized));
    const missingInTarget = sourceStatements
      .filter((stmt) => !targetSet.has(stmt.normalized))
      .map((stmt) => stmt.raw);
    const extraInTarget = targetStatements
      .filter((stmt) => !sourceSet.has(stmt.normalized))
      .map((stmt) => stmt.raw);

    return {
      success: true,
      data: {
        isEqual: missingInTarget.length === 0 && extraInTarget.length === 0,
        missingInTarget,
        extraInTarget,
        sourceCount: sourceStatements.length,
        targetCount: targetStatements.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to compare schemas.",
    };
  }
}

async function applyPostgresSchemaToTarget(
  sourceConnectionString: string,
  targetConnectionString: string,
) {
  if (
    !isPostgresConnection(sourceConnectionString) ||
    !isPostgresConnection(targetConnectionString)
  ) {
    return {
      success: false,
      error: "Schema apply is supported only for PostgreSQL connections.",
    };
  }

  try {
    const sourceSchemaSql = await runPgDumpSchemaOnly(sourceConnectionString);
    const targetSchemaSql = await runPgDumpSchemaOnly(targetConnectionString);
    const sourceStatements = extractComparableStatements(sourceSchemaSql);
    const targetSet = new Set(
      extractComparableStatements(targetSchemaSql).map(
        (stmt) => stmt.normalized,
      ),
    );
    const toApply = sourceStatements.filter(
      (stmt) => !targetSet.has(stmt.normalized),
    );

    if (toApply.length === 0) {
      return { success: true, data: { appliedCount: 0 } };
    }

    const { Client } = (globalThis as any).__pg || (await import("pg")).default;
    const client = new Client({
      host: getPgHost(targetConnectionString),
      port: getPgPort(targetConnectionString),
      database: getPgDatabase(targetConnectionString),
      user: getPgUsername(targetConnectionString),
      password: getPgPassword(targetConnectionString),
      connectionTimeoutMillis: 15000,
      ssl: getPgSslConfig(targetConnectionString),
    });

    await client.connect();
    const errors: string[] = [];
    try {
      for (const stmt of toApply) {
        try {
          await client.query(stmt.raw);
        } catch (error: any) {
          const message = String(
            error?.message || "Failed to apply statement.",
          );
          const isAlreadyExists =
            /already exists|duplicate key|duplicate_object|duplicate_table|duplicate_column/i.test(
              message,
            );
          if (!isAlreadyExists) {
            errors.push(`${message} | ${stmt.raw.slice(0, 200)}`);
          }
        }
      }
    } finally {
      await client.end().catch(() => {});
    }

    if (errors.length) {
      return { success: false, error: `Applied with errors: ${errors[0]}` };
    }

    return { success: true, data: { appliedCount: toApply.length } };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to apply schema changes.",
    };
  }
}

export {
  getGlobalAppThemeSettings,
  saveGlobalAppThemeSettings,
  getGlobalEditorThemeSettings,
  saveGlobalEditorThemeSettings,
  fetchDatabases,
} from "./actions-core";

export type ConnectionAnalytics = {
  totalQueries: number;
  successRate: number;
  queriesByDay: Array<{ date: string; count: number; successCount: number; errorCount: number; avgDuration: number }>;
  statusDistribution: { success: number; error: number };
  topQueries: Array<{ query: string; count: number }>;
  contributors: Array<{ id: string; name: string; queryCount: number }>;
  avgDuration: number;
  mostQueriedTables: Array<{ table: string; count: number }>;
  connectionActivity: {
    lastActive: number | null;
    totalSessions: number;
  };
  recentQueries?: Array<{
    id: string;
    query: string;
    executedAt: number;
    duration: number;
    status: string;
    error?: string;
    executedBy?: string;
    executedByName?: string;
  }>;
  errorsByDay?: Array<{ date: string; errors: number }>;
};

function parseTableNamesFromQuery(query: string): string[] {
  const tables: string[] = [];
  const normalized = query.trim().replace(/\s+/g, " ");

  extractTableNamesFromKeyword(
    normalized.match(/\bFROM\s+["`]?(\w+)["`]?/gi),
    "FROM",
    tables,
  );
  extractTableNamesFromKeyword(
    normalized.match(/\bJOIN\s+["`]?(\w+)["`]?/gi),
    "JOIN",
    tables,
  );

  const updateMatch = normalized.match(/\bUPDATE\s+["`]?(\w+)["`]?/i);
  if (updateMatch) {
    const name = updateMatch[1].replace(/["`]/g, "").trim();
    if (name) tables.push(name.toLowerCase());
  }

  const insertMatch = normalized.match(/\bINSERT\s+INTO\s+["`]?(\w+)["`]?/i);
  if (insertMatch) {
    const name = insertMatch[1].replace(/["`]/g, "").trim();
    if (name) tables.push(name.toLowerCase());
  }

  const deleteMatch = normalized.match(/\bDELETE\s+FROM\s+["`]?(\w+)["`]?/i);
  if (deleteMatch) {
    const name = deleteMatch[1].replace(/["`]/g, "").trim();
    if (name) tables.push(name.toLowerCase());
  }

  return tables;
}

async function getConnectionAnalytics(connectionId: number): Promise<{
  success: boolean;
  data?: ConnectionAnalytics;
  error?: string;
}> {
  if (!Number.isInteger(connectionId) || connectionId <= 0) {
    return { success: false, error: "Invalid connection id" };
  }

  const { db } = await import("./index");

  const { queryHistory, connections } = await import("./schema");

  // fallow-ignore-next-line code-duplication
  const { eq, desc, asc, sql, count, and, gte } = await import("drizzle-orm");

  try {
    await ensureCoreTables();

    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

    const allHistory = await db
      .select()
      .from(queryHistory)
      .where(
        and(
          eq(queryHistory.connectionId, connectionId),
          gte(queryHistory.executedAt, oneYearAgo),
        ),
      );

    const { totalQueries, successCount, errorCount, successRate } =
      computeBasicStats(allHistory);

    const queriesByDay = computeQueriesByDay(allHistory);
    const statusDistribution = { success: successCount, error: errorCount };
    const topQueries = computeTopQueries(allHistory);

    const contributorMap = new Map<string, { name: string; count: number }>();
    allHistory.forEach((h) => {
      const id = h.executedBy || "unknown";
      const name = h.executedByName || "Unknown";
      const existing = contributorMap.get(id) || { name, count: 0 };
      existing.count++;
      contributorMap.set(id, existing);
    });
    const contributors = Array.from(contributorMap.entries())
      .map(([id, { name, count }]) => ({ id, name, queryCount: count }))
      .sort((a, b) => b.queryCount - a.queryCount);

    const { durations, avgDuration } =
      computeAnalyticsDurationStats(allHistory);

    const tableCountMap = new Map<string, number>();
    allHistory.forEach((h) => {
      const tables = parseTableNamesFromQuery(h.query);
      tables.forEach((t) => {
        tableCountMap.set(t, (tableCountMap.get(t) || 0) + 1);
      });
    });
    const mostQueriedTables = Array.from(tableCountMap.entries())
      .map(([table, count]) => ({ table, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const connectionRows = await db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId))
      .limit(1);
    const connection = connectionRows[0];

    const connectionActivity = {
      lastActive: connection?.lastActive
        ? Number(connection.lastActive)
        : allHistory.length > 0
          ? Math.max(...allHistory.map((h) => h.executedAt))
          : null,
      totalSessions:
        new Set(allHistory.map((h) => h.executedBy).filter(Boolean)).size || 1,
    };

    return {
      success: true,
      data: {
        totalQueries,
        successRate,
        queriesByDay,
        statusDistribution,
        topQueries,
        contributors,
        avgDuration,
        mostQueriedTables,
        connectionActivity,
      },
    };
  } catch (error: any) {
    console.error("Failed to get connection analytics:", error);
    return {
      success: false,
      error: error.message || "Failed to get connection analytics",
    };
  }
}

export type SearchAllResult = {
  table_schema: string;
  table_name: string;
  column_name: string;
  value: string;
  row: Record<string, unknown>;
};

function isSearchableColumn(dataType: string | null): boolean {
  if (!dataType) return true;
  const t = dataType.toLowerCase();
  if (t.includes("text") || t.includes("char") || t.includes("string"))
    return true;
  if (t === "uuid" || t === "json" || t === "jsonb" || t === "xml") return true;
  return false;
}

function quoteIdent(value: string, dbType: string): string {
  if (dbType === "mysql" || dbType === "clickhouse") return `\`${value}\``;
  if (dbType === "mssql") return `[${value}]`;
  return `"${value}"`;
}

function quoteRef(schema: string, table: string, dbType: string): string {
  if (dbType === "mssql" && schema.includes(".")) {
    const [catalog, schemaName] = schema.split(".");
    return `${quoteIdent(catalog, dbType)}.${quoteIdent(schemaName, dbType)}.${quoteIdent(table, dbType)}`;
  }
  return `${quoteIdent(schema, dbType)}.${quoteIdent(table, dbType)}`;
}

function extractTableNamesFromKeyword(
  matches: RegExpMatchArray | null,
  keyword: string,
  tables: string[],
) {
  if (matches) {
    matches.forEach((m) => {
      const name = m
        .replace(new RegExp(`\\b${keyword}\\s+`, "i"), "")
        .replace(/["`]/g, "")
        .trim();
      if (name) tables.push(name.toLowerCase());
    });
  }
}


function computeAnalyticsDurationStats(history: any[]) {
  const durations = history
    .filter((h) => typeof h.duration === "number" && h.duration > 0)
    .map((h) => h.duration);
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
  return { durations, avgDuration };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  async function next(): Promise<void> {
    if (i >= tasks.length) return;
    const idx = i++;
    try {
      results[idx] = await tasks[idx]();
    } catch {}
    await next();
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    next,
  );
  await Promise.all(workers);
  return results;
}

type UserAnalytics = {
  totalQueries: number;
  totalConnections: number;
  successRate: number;
  avgDuration: number;
  totalSnippets: number;
  totalDuration: number;
  peakDay?: { date: string; count: number };
  statusDistribution: { success: number; error: number };
    queriesByDay: { date: string; count: number; successCount: number; errorCount: number; avgDuration: number }[];
  queriesByConnection: { connectionName: string; count: number }[];
  topQueries: { query: string; count: number }[];
  connectionsOverview: {
    id: string;
    name: string;
    type?: string;
    totalQueries: number;
    lastActive?: string;
  }[];
  queriesByDayByConnection: {
    connectionId: number;
    connectionName: string;
  queriesByDay: { date: string; count: number; successCount: number; errorCount: number; avgDuration: number }[];
  }[];
};

export async function searchAllTables(
  connectionString: string,
  searchTerm: string,
  options?: { schema?: string; connectionType?: string },
): Promise<{ success: boolean; data?: SearchAllResult[]; error?: string }> {
  const dbType = detectConnectionDbType(
    connectionString,
    options?.connectionType,
  );
  const { executeDbQuery } = await import("./db-engine");
  const escapedSearch = searchTerm
    .replace(/'/g, "''")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

  if (dbType === "mongodb" || dbType === "redis" || dbType === "federated") {
    const msg =
      dbType === "mongodb"
        ? "MongoDB universal search is not yet supported."
        : dbType === "redis"
          ? "Redis universal search is not yet supported."
          : "Federated universal search is not yet supported.";
    return { success: false, error: msg };
  }

  let allColumns: CachedColumnRow[] = [];
  try {
    const tablesResult = await _fetchAllTablesWithColumns(connectionString, {
      schema: options?.schema,
    });
    if (tablesResult.success && Array.isArray(tablesResult.data)) {
      allColumns = tablesResult.data as CachedColumnRow[];
    } else {
      return {
        success: false,
        error: "Failed to retrieve tables and columns.",
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to retrieve schema.",
    };
  }

  if (allColumns.length === 0) {
    return { success: true, data: [] };
  }

  const textColumnsByTable = new Map<string, CachedColumnRow[]>();
  for (const col of allColumns) {
    if (!isSearchableColumn(col.data_type)) {
      continue;
    }
    const key = `${col.table_schema}|${col.table_name}`;
    const existing = textColumnsByTable.get(key);
    if (existing) {
      existing.push(col);
    } else {
      textColumnsByTable.set(key, [col]);
    }
  }

  if (textColumnsByTable.size === 0) {
    return { success: true, data: [] };
  }

  const SEARCH_CONCURRENCY = 5;
  const MAX_RESULTS_PER_TABLE = 10;
  const TIMEOUT_MS = 5000;

  const results: SearchAllResult[] = [];

  const tableEntries = Array.from(textColumnsByTable.entries());

  const tasks = tableEntries.map(([key, cols]) => async () => {
    const schema = cols[0].table_schema;
    const table = cols[0].table_name;

    if (!schema || !table) return;

    const quotedTable = quoteRef(schema, table, dbType);
    const quotedCols = cols.map((c) => quoteIdent(c.column_name, dbType));

    let whereClause: string;
    let limitClause: string;

    if (dbType === "postgres" || dbType === "trino") {
      const op = dbType === "postgres" ? "ILIKE" : "LIKE";
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS TEXT) ${op} '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = `LIMIT ${MAX_RESULTS_PER_TABLE}`;
    } else if (dbType === "sqlite") {
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS TEXT) LIKE '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = `LIMIT ${MAX_RESULTS_PER_TABLE}`;
    } else if (dbType === "mysql") {
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS CHAR) LIKE '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = `LIMIT ${MAX_RESULTS_PER_TABLE}`;
    } else if (dbType === "mssql") {
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS NVARCHAR(MAX)) LIKE '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = "";
    } else if (dbType === "clickhouse") {
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS String) LIKE '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = `LIMIT ${MAX_RESULTS_PER_TABLE}`;
    } else {
      whereClause = quotedCols
        .map((c) => `CAST(${c} AS TEXT) LIKE '%${escapedSearch}%'`)
        .join(" OR ");
      limitClause = `LIMIT ${MAX_RESULTS_PER_TABLE}`;
    }

    let sql: string;
    if (dbType === "mssql") {
      sql = `SELECT TOP ${MAX_RESULTS_PER_TABLE} * FROM ${quotedTable} WHERE ${whereClause}`;
    } else {
      sql = `SELECT * FROM ${quotedTable} WHERE ${whereClause} ${limitClause}`;
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout searching ${schema}.${table}`)),
        TIMEOUT_MS,
      ),
    );

    try {
      const queryResult = await Promise.race([
        executeDbQuery(connectionString, sql, [], {
          connectionType: options?.connectionType,
        }),
        timeoutPromise,
      ]);

      if (!queryResult || !Array.isArray(queryResult.rows)) return;

      for (const row of queryResult.rows) {
        for (const col of cols) {
          const rawValue = row[col.column_name];
          if (rawValue === null || rawValue === undefined) continue;
          const strVal = String(rawValue);
          if (strVal.toLowerCase().includes(searchTerm.toLowerCase())) {
            results.push({
              table_schema: schema,
              table_name: table,
              column_name: col.column_name,
              value:
                strVal.length > 200 ? strVal.slice(0, 200) + "..." : strVal,
              row: row as Record<string, unknown>,
            });
            break;
          }
        }
      }
    } catch (error) {
      console.error(
        `[searchAllTables] Error searching ${schema}.${table}:`,
        error,
      );
    }
  });

  await runWithConcurrency(tasks, SEARCH_CONCURRENCY);

  return { success: true, data: results };
}

async function getUserAnalytics(): Promise<{
  success: boolean;
  data?: UserAnalytics;
  error?: string;
}> {
  const { db } = await import("./index");
  const { queryHistory, connections, snippets } = await import("./schema");

  // fallow-ignore-next-line code-duplication
  const { gte } = await import("drizzle-orm");

  try {
    await ensureCoreTables();

    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

    const allHistory = await db
      .select()
      .from(queryHistory)
      .where(gte(queryHistory.executedAt, oneYearAgo));

    const totalQueries = allHistory.length;
    const successCount = allHistory.filter(
      (h) => h.status === "success",
    ).length;
    const errorCount = totalQueries - successCount;
    const successRate = totalQueries > 0 ? successCount / totalQueries : 0;

    const topQueries = computeTopQueries(allHistory);
    const queriesByDay = computeQueriesByDay(allHistory);

    const queryConnMap = new Map<string, number>();
    allHistory.forEach((h) => {
      const cid = String(h.connectionId ?? "unknown");
      queryConnMap.set(cid, (queryConnMap.get(cid) || 0) + 1);
    });

    const allConnections = await db.select().from(connections);
    const queriesByConnection = Array.from(queryConnMap.entries())
      .map(([cid, count]) => {
        const conn = allConnections.find((c) => String(c.id) === cid);
        return { connectionName: conn?.name ?? `Connection #${cid}`, count };
      })
      .sort((a, b) => b.count - a.count);

    const connectionsOverview = allConnections
      .map((c) => {
        const cid = String(c.id);
        const connQueryCount = queryConnMap.get(cid) ?? 0;
        return {
          id: String(c.id),
          name: c.name,
          type: (c as any).connectionType ?? undefined,
          totalQueries: connQueryCount,
          lastActive: c.lastActive
            ? new Date(Number(c.lastActive)).toISOString()
            : undefined,
        };
      })
      .sort((a, b) => b.totalQueries - a.totalQueries);

    const { durations, avgDuration } =
      computeAnalyticsDurationStats(allHistory);
    const totalDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : 0;

    const allSnippets = await db.select().from(snippets);
    const totalSnippets = allSnippets.length;

    let peakDay: { date: string; count: number } | undefined;
    if (queriesByDay.length > 0) {
      const peak = queriesByDay.reduce(
        (max, d) => (d.count > max.count ? d : max),
        queriesByDay[0],
      );
      peakDay = peak;
    }

    const queriesByDayByConnection = allConnections
      .map((c) => {
        const cid = String(c.id);
        const connHistory = allHistory.filter(
          (h) => String(h.connectionId) === cid,
        );
        const connQueriesByDay = computeQueriesByDay(connHistory);
        return {
          connectionId: c.id,
          connectionName: c.name,
          queriesByDay: connQueriesByDay,
        };
      })
      .filter((c) => c.queriesByDay.length > 0);

    return {
      success: true,
      data: {
        totalQueries,
        totalConnections: allConnections.length,
        successRate,
        avgDuration,
        totalSnippets,
        totalDuration,
        peakDay,
        statusDistribution: { success: successCount, error: errorCount },
        queriesByDay,
        queriesByConnection,
        topQueries,
        connectionsOverview,
        queriesByDayByConnection,
      },
    };
  } catch (error: any) {
    console.error("Failed to get user analytics:", error);
    return {
      success: false,
      error: error.message || "Failed to get user analytics",
    };
  }
}

const STUDIO_BACKEND_CONFIG_KEY = "studio_backend_config";

export async function getStudioBackendConfig() {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const rows = await db.all<{ value: string | null }>(sql`
      SELECT value
      FROM app_settings
      WHERE key = ${STUDIO_BACKEND_CONFIG_KEY}
      LIMIT 1
    `);

    const savedValue = rows[0]?.value?.trim();
    if (!savedValue) {
      return {
        success: true,
        data: null as {
          studioUrl: string;
          studioToken: string;
          userId: string;
        } | null,
      };
    }

    return { success: true, data: JSON.parse(savedValue) };
  } catch (error: any) {
    console.error("Failed to fetch studio backend config:", error);
    return { success: false, error: error.message };
  }
}

export async function saveStudioBackendConfig(config: {
  studioUrl: string;
  studioToken: string;
  userId: string;
}) {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${STUDIO_BACKEND_CONFIG_KEY}, ${JSON.stringify(config)}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save studio backend config:", error);
    return { success: false, error: error.message };
  }
}

export async function clearStudioBackendConfig() {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    await db.run(sql`
      DELETE FROM app_settings WHERE key = ${STUDIO_BACKEND_CONFIG_KEY}
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to clear studio backend config:", error);
    return { success: false, error: error.message };
  }
}

const WORKSPACE_LIST_KEY = "workspace_list";

export interface WorkspaceEntry {
  studioUrl: string;
  studioToken: string;
  userId: string;
  name: string;
}

export async function getWorkspaceList(): Promise<{
  success: boolean;
  data: WorkspaceEntry[];
  error?: string;
}> {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    await ensureAppStorageTables();
    const rows = await db.all<{ value: string | null }>(sql`
      SELECT value FROM app_settings WHERE key = ${WORKSPACE_LIST_KEY} LIMIT 1
    `);
    const saved = rows[0]?.value?.trim();
    return { success: true, data: saved ? JSON.parse(saved) : [] };
  } catch (error: any) {
    return { success: false, data: [], error: error.message };
  }
}

export async function saveWorkspaceList(
  list: WorkspaceEntry[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${WORKSPACE_LIST_KEY}, ${JSON.stringify(list)}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
