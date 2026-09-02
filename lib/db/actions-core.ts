// fallow-ignore-file code-duplication
import {
  detectConnectionDbType,
  getMongoDatabaseFromConnectionString,
} from "./connection-type";
import type { QueryResult } from "./client-types";
import {
  SQLITE_BUSY_RETRY_ATTEMPTS,
  SQLITE_BUSY_BASE_DELAY_MS,
  DEFAULT_SCHEMA_CACHE_MAX_AGE_MS,
  AUTO_SEED_CONNECTIONS,
} from "./actions-constants";
import type { SqlEditorRunQueryResult as SqlEditorRunQueryResult_ } from "./actions-constants";
export type SqlEditorRunQueryResult = SqlEditorRunQueryResult_;
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
import { resolvePgDumpBinary } from "./pg-dump";
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

import {
  fetchTableSecurityInfo as _fetchTableSecurityInfo,
  fetchExtensions as _fetchExtensions,
  toggleExtension as _toggleExtension,
  fetchTriggers as _fetchTriggers,
  fetchEnums as _fetchEnums,
  createEnum as _createEnum,
  deleteEnum as _deleteEnum,
  fetchIndexes as _fetchIndexes,
  fetchRlsPolicies as _fetchRlsPolicies,
  fetchPostgresRoles as _fetchPostgresRoles,
  fetchSupabaseAuthUsers as _fetchSupabaseAuthUsers,
  deleteIndex as _deleteIndex,
  fetchSessions as _fetchSessions,
  killSession as _killSession,
  cancelSessionQuery as _cancelSessionQuery,
  fetchLocks as _fetchLocks,
} from "./security-actions";
import {
  runAllChecks as _runAllChecks,
} from "./advisor/runner";
import {
  fetchViews as _fetchViews,
  fetchRedisKeys as _fetchRedisKeys,
  fetchFunctions as _fetchFunctions,
  createDatabase as _createDatabase,
  createSchema as _createSchema,
} from "./schema-introspection-actions";
import {
  readCachedSchemas as _readCachedSchemas,
  getCachedSchemasSnapshot as _getCachedSchemasSnapshot,
  writeCachedSchemas as _writeCachedSchemas,
  readCachedTables as _readCachedTables,
  getCachedTablesSnapshot as _getCachedTablesSnapshot,
  writeCachedTables as _writeCachedTables,
  readCachedColumns as _readCachedColumns,
  writeCachedColumns as _writeCachedColumns,
} from "./schema-cache-actions";
import type { CachedColumnRow } from "./schema-cache-actions";
import {
  deleteTableRows as _deleteTableRows,
  updateTableRows as _updateTableRows,
  fetchTableStructure as _fetchTableStructure,
  fetchTableForeignKeys as _fetchTableForeignKeys,
  fetchReferencedRecord as _fetchReferencedRecord,
} from "./table-row-ops";
import {
  exportDatabaseBundle as _exportDatabaseBundle,
  importDatabaseBundle as _importDatabaseBundle,
} from "./export-helpers";
import {
  getAppFontFamily as _getAppFontFamily,
  saveAppFontFamily as _saveAppFontFamily,
  getGlobalAppThemeSettings as _getGlobalAppThemeSettings,
  saveGlobalAppThemeSettings as _saveGlobalAppThemeSettings,
  getGlobalEditorThemeSettings as _getGlobalEditorThemeSettings,
  saveGlobalEditorThemeSettings as _saveGlobalEditorThemeSettings,
  getGlobalStudioSettings as _getGlobalStudioSettings,
  saveGlobalStudioSettings as _saveGlobalStudioSettings,
  getConnectionWorkspaceId as _getConnectionWorkspaceId,
  saveConnectionWorkspaceId as _saveConnectionWorkspaceId,
  ensureAppStorageTables,
} from "./app-admin-actions";
import {
  isMigrationNeeded as _isMigrationNeeded,
  migrateSettingsFromSqlite as _migrateSettingsFromSqlite,
  clearMigratedSqliteSettings as _clearMigratedSqliteSettings,
} from "./settings-migration";
import { ensureCoreTables, ensureConnectionExists } from "./ensure-core-tables";
import {
  getStudioHistory as _getStudioHistory,
  insertHistoryEntry as _insertHistoryEntry,
  clearStudioHistory as _clearStudioHistory,
  saveStudioHistory as _saveStudioHistory,
  getStudioTags as _getStudioTags,
  saveStudioTags as _saveStudioTags,
  getStudioTableTags as _getStudioTableTags,
  saveStudioTableTags as _saveStudioTableTags,
  getStudioTabs as _getStudioTabs,
  saveStudioTabs as _saveStudioTabs,
  getStudioSettings as _getStudioSettings,
  getStudioBootstrap as _getStudioBootstrap,
  getStudioDashboards as _getStudioDashboards,
  saveStudioDashboards as _saveStudioDashboards,
  saveStudioSettings as _saveStudioSettings,
  getConnectionAnalytics as _getConnectionAnalytics,
  getUserAnalytics as _getUserAnalytics,
} from "./studio-storage-crud";
export async function fetchTableSecurityInfo(
  connectionString: string,
  schema: string,
) {
  return _fetchTableSecurityInfo(connectionString, schema);
}
export async function fetchExtensions(connectionString: string) {
  return _fetchExtensions(connectionString);
}
async function toggleExtension(
  connectionString: string,
  name: string,
  install: boolean,
) {
  return _toggleExtension(connectionString, name, install);
}
export async function fetchTriggers(connectionString: string, schema?: string) {
  return _fetchTriggers(connectionString, schema);
}
export async function fetchEnums(connectionString: string) {
  return _fetchEnums(connectionString);
}
async function createEnum(
  connectionString: string,
  schema: string,
  name: string,
  values: string[],
) {
  return _createEnum(connectionString, schema, name, values);
}
async function deleteEnum(
  connectionString: string,
  schema: string,
  name: string,
) {
  return _deleteEnum(connectionString, schema, name);
}
export async function fetchIndexes(connectionString: string, schema?: string) {
  return _fetchIndexes(connectionString, schema);
}
export async function fetchRlsPolicies(
  connectionString: string,
  schema?: string | null,
  table?: string | null,
) {
  return _fetchRlsPolicies(connectionString, schema, table);
}
export async function fetchPostgresRoles(connectionString: string) {
  return _fetchPostgresRoles(connectionString);
}
export async function fetchSupabaseAuthUsers(connectionString: string) {
  return _fetchSupabaseAuthUsers(connectionString);
}
export async function fetchSessions(connectionString: string) {
  return _fetchSessions(connectionString);
}
export async function killSession(connectionString: string, pid: number) {
  return _killSession(connectionString, pid);
}
export async function cancelSessionQuery(connectionString: string, pid: number) {
  return _cancelSessionQuery(connectionString, pid);
}
export async function fetchLocks(connectionString: string) {
  return _fetchLocks(connectionString);
}
export async function runAdvisorChecks(connectionString: string) {
  return _runAllChecks(connectionString);
}
export async function fetchExplainPlan(connectionString: string, query: string) {
  if (!connectionString) return { success: false, error: "No connection string." };
  if (!query?.trim()) return { success: false, error: "No query to explain." };

  const dbType = detectConnectionDbType(connectionString);
  let explainSql = "";

  const trimmed = query.trim();
  const startsWithExplain = /^\s*EXPLAIN\b/i.test(trimmed);

  if (dbType === "postgres" || dbType === "supabase-mgmt") {
    explainSql = startsWithExplain
      ? trimmed
      : `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)\n${trimmed}`;
  } else if (dbType === "mysql") {
    explainSql = `EXPLAIN ANALYZE\n${query}`;
  } else if (dbType === "sqlite") {
    explainSql = `EXPLAIN QUERY PLAN\n${query}`;
  } else if (dbType === "clickhouse") {
    explainSql = `EXPLAIN\n${query}`;
  } else if (dbType === "mssql") {
    explainSql = `SET SHOWPLAN_XML ON;\n${query}`;
  } else {
    explainSql = `EXPLAIN\n${query}`;
  }

  try {
    const result = await runQuery(connectionString, explainSql, []);
    return { success: true, data: result.data, planQuery: explainSql };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function runDbBackup(
  connectionString: string,
  options: {
    format?: "custom" | "plain" | "tar" | "directory";
    schema?: string;
    table?: string;
    dataOnly?: boolean;
    schemaOnly?: boolean;
    compress?: number;
    outputPath?: string;
  } = {}
) {
  const dbType = detectConnectionDbType(connectionString);

  if (dbType === "postgres") {
    const { execFileSync } = await import("child_process");
    const { resolvePgDumpBinary } = await import("./pg-dump");
    const { getPgHost, getPgPort, getPgDatabase, getPgUsername, getPgPassword } = await import("./pg-connection");
    const { resolveEffectiveConnectionString } = await import("./neon-cli-client");
    connectionString = await resolveEffectiveConnectionString(connectionString);

    const pgDump = await resolvePgDumpBinary();
    if (!pgDump.binary) {
      return { success: false, error: "pg_dump not found. Install PostgreSQL tools." };
    }

    const args = [
      `--host=${getPgHost(connectionString)}`,
      `--port=${getPgPort(connectionString)}`,
      `--username=${getPgUsername(connectionString)}`,
      `--dbname=${getPgDatabase(connectionString)}`,
      `--format=${options.format || "custom"}`,
      `--file=${options.outputPath || `${getPgDatabase(connectionString)}_backup.dump`}`,
    ];

    if (options.schemaOnly) args.push("--schema-only");
    if (options.dataOnly) args.push("--data-only");
    if (options.schema) args.push(`--schema=${options.schema}`);
    if (options.table) args.push(`--table=${options.table}`);
    if (options.compress) args.push(`--compress=${options.compress}`);

    const pgPassword = getPgPassword(connectionString);

    try {
      const env = pgPassword ? { ...process.env, PGPASSWORD: pgPassword } : undefined;
      const stdout = execFileSync(pgDump.binary, args, {
        encoding: "utf-8",
        timeout: 600000,
        env,
      });
      return { success: true, data: { stdout, outputPath: options.outputPath } };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message };
    }
  }

  if (dbType === "mysql") {
    const { execFileSync } = await import("child_process");
    const { getPgHost, getPgPort, getPgDatabase, getPgUsername, getPgPassword } = await import("./pg-connection");

    const mysqldump = "mysqldump";
    const mysqlPassword = getPgPassword(connectionString);
    const args = [
      `--host=${getPgHost(connectionString)}`,
      `--port=${getPgPort(connectionString)}`,
      `--user=${getPgUsername(connectionString)}`,
      getPgDatabase(connectionString),
    ];

    if (options.dataOnly) args.unshift("--no-create-info");
    if (options.schemaOnly) args.unshift("--no-data");
    if (options.table) args.push(options.table);

    try {
      const env = mysqlPassword ? { ...process.env, MYSQL_PWD: mysqlPassword } : undefined;
      const stdout = execFileSync(mysqldump, args, {
        encoding: "utf-8",
        timeout: 600000,
        env,
      });
      return { success: true, data: { stdout } };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message };
    }
  }

  return { success: false, error: `Backup not supported for ${dbType}.` };
}

async function deleteIndex(
  connectionString: string,
  schema: string,
  name: string,
) {
  return _deleteIndex(connectionString, schema, name);
}
export async function fetchViews(connectionString: string, schema: string) {
  return _fetchViews(connectionString, schema);
}
export async function fetchRedisKeys(
  connectionString: string,
  options?: { pattern?: string; limit?: number; db?: string },
) {
  return _fetchRedisKeys(connectionString, options);
}
export async function fetchFunctions(connectionString: string, schema: string) {
  return _fetchFunctions(connectionString, schema);
}
async function createDatabase(connectionString: string, dbName: string) {
  return _createDatabase(connectionString, dbName);
}
async function createSchema(connectionString: string, schemaName: string) {
  return _createSchema(connectionString, schemaName);
}

export async function upsertUserProfile(payload: {
  id: string;
  email?: string | null;
  name?: string | null;
  createdAt?: number | string | Date | null;
  isLocal?: boolean;
  supabaseId?: string | null;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const id = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!id) return { success: false, error: "User id is required." };
  const createdAt = toTimestamp(payload?.createdAt) ?? Date.now();
  const email =
    typeof payload?.email === "string" ? payload.email.trim() : null;
  const name = typeof payload?.name === "string" ? payload.name.trim() : null;
  const isLocal = payload?.isLocal ?? false;
  const supabaseId =
    typeof payload?.supabaseId === "string" ? payload.supabaseId.trim() : null;

  await ensureCoreTables();
  await db.run(sql`
    INSERT INTO users (id, email, name, created_at, is_local, supabase_id)
    VALUES (${id}, ${email}, ${name}, ${createdAt}, ${isLocal ? 1 : 0}, ${supabaseId})
    ON CONFLICT(id) DO UPDATE SET
      email = COALESCE(excluded.email, users.email),
      name = CASE
        WHEN excluded.name IS NULL OR TRIM(excluded.name) = '' THEN users.name
        WHEN excluded.email IS NOT NULL
          AND TRIM(excluded.name) = TRIM(excluded.email)
          AND users.name IS NOT NULL
          AND TRIM(users.name) <> ''
          AND TRIM(users.name) <> TRIM(users.email)
          THEN users.name
        ELSE excluded.name
      END,
      is_local = excluded.is_local,
      supabase_id = COALESCE(excluded.supabase_id, users.supabase_id)
  `);

  return { success: true };
}

export async function deleteUserProfile(id: string) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const trimmedId = typeof id === "string" ? id.trim() : "";
  if (!trimmedId) return { success: false, error: "User id is required." };

  await ensureCoreTables();
  await db.run(sql`DELETE FROM users WHERE id = ${trimmedId}`);
  return { success: true };
}

export async function clearAllUsers() {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  await ensureCoreTables();
  await db.run(sql`DELETE FROM users`);
  return { success: true };
}

export async function logAppError(params: {
  errorType: string;
  message: string | null;
  stack: string | null;
  url: string | null;
  componentStack: string | null;
  metadata: Record<string, unknown>;
  appVersion: string | null;
  os: string | null;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  await ensureCoreTables();
  const logFile = "/tmp/rexadb-server.log";
  try {
    const line = `[${new Date().toISOString()}] [app-error] type=${params.errorType} msg=${(params.message || "").slice(0, 200)} url=${params.url || ""}\n`;
    const fs = await import("fs");
    fs.appendFileSync(logFile, line);
  } catch {}
  return { success: true };
}

export async function getAllUsers() {
  const { db } = await import("./index");
  await ensureCoreTables();
  const { users } = await import("./schema");
  const rows = await db.select().from(users);
  return { success: true, data: { count: rows.length } };
}

export async function getStoredUserProfile(id?: string | null) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const trimmedId = typeof id === "string" ? id.trim() : "";

  await ensureCoreTables();

  const { users } = await import("./schema");
  const { eq, desc, and } = await import("drizzle-orm");

  const rows = trimmedId
    ? await db.select().from(users).where(eq(users.id, trimmedId)).limit(1)
    : await db.select().from(users).orderBy(desc(users.createdAt)).limit(1);

  const row = rows[0];

  if (!row) {
    return { success: false, error: "User not found." };
  }

  return {
    success: true,
    data: {
      id: row.id,
      name: row.name?.trim() || null,
      email: row.email?.trim() || null,
      isLocal: Boolean(row.isLocal),
    },
  };
}

export async function updateUserPlan(payload: {
  id: string;
  planType: string;
  planStatus?: string | null;
  planSyncedAt?: number | string | Date | null;
  planPeriodEnd?: number | string | Date | null;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const id = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!id) return { success: false, error: "User id is required." };
  const planType =
    typeof payload?.planType === "string" ? payload.planType.trim() : "";
  if (!planType) return { success: false, error: "Plan type is required." };
  const planStatus =
    typeof payload?.planStatus === "string"
      ? payload.planStatus.trim()
      : "none";
  const planSyncedAt = toTimestamp(payload?.planSyncedAt) ?? Date.now();
  const createdAt = Date.now();
  const planPeriodEnd = toTimestamp(payload?.planPeriodEnd);

  await ensureCoreTables();
  await db.run(sql`
    INSERT INTO users (id, created_at, plan_type, plan_status, plan_synced_at, plan_period_end)
    VALUES (${id}, ${createdAt}, ${planType}, ${planStatus}, ${planSyncedAt}, ${planPeriodEnd})
    ON CONFLICT(id) DO UPDATE SET
      plan_type = excluded.plan_type,
      plan_status = excluded.plan_status,
      plan_synced_at = excluded.plan_synced_at,
      plan_period_end = excluded.plan_period_end
  `);

  return { success: true };
}

export async function getStoredUserEntitlement(id?: string | null) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const trimmedId = typeof id === "string" ? id.trim() : "";

  await ensureCoreTables();

  const rows = trimmedId
    ? await db.all<Record<string, unknown>>(sql`
        SELECT *
        FROM user_entitlements
        WHERE user_id = ${trimmedId}
        LIMIT 1
      `)
    : await db.all<Record<string, unknown>>(sql`
        SELECT ue.*
        FROM user_entitlements ue
        JOIN users u ON u.id = ue.user_id
        ORDER BY u.is_local ASC, u.created_at DESC
        LIMIT 1
      `);

  const row = rows[0];
  if (!row) {
    return { success: false, error: "Entitlement not found." };
  }

  return {
    success: true,
    data: {
      userId: String(row.user_id || ""),
      payloadJson: String(row.payload_json || ""),
      signature: String(row.signature || ""),
      entitlementPlanCode: String(row.entitlement_plan_code || "free"),
      lastPaidPlanCode: row.last_paid_plan_code
        ? String(row.last_paid_plan_code)
        : null,
      status: String(row.status || "none"),
      cloudEnabled: Boolean(row.cloud_enabled),
      maxConnections:
        row.max_connections === null ||
        typeof row.max_connections === "undefined"
          ? null
          : Number(row.max_connections),
      maxWorkspaces:
        row.max_workspaces === null || typeof row.max_workspaces === "undefined"
          ? null
          : Number(row.max_workspaces),
      accessEndsAt:
        row.access_ends_at === null || typeof row.access_ends_at === "undefined"
          ? null
          : Number(row.access_ends_at),
      graceEndsAt:
        row.grace_ends_at === null || typeof row.grace_ends_at === "undefined"
          ? null
          : Number(row.grace_ends_at),
      updatesUntil:
        row.updates_until === null || typeof row.updates_until === "undefined"
          ? null
          : Number(row.updates_until),
      issuedAt: Number(row.issued_at || 0),
      refreshAfter: Number(row.refresh_after || 0),
      lastObservedAt: Number(row.last_observed_at || 0),
      syncedAt: Number(row.synced_at || 0),
    },
  };
}

export async function upsertUserEntitlement(payload: {
  userId?: string | null;
  payload?: Record<string, unknown> | null;
  payloadJson?: string | null;
  signature?: string | null;
  lastObservedAt?: number | string | Date | null;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const userId =
    typeof payload?.userId === "string" ? payload.userId.trim() : "";
  const payloadJson =
    typeof payload?.payloadJson === "string" ? payload.payloadJson.trim() : "";
  const signature =
    typeof payload?.signature === "string" ? payload.signature.trim() : "";
  const entitlementPayload =
    payload?.payload && typeof payload.payload === "object"
      ? payload.payload
      : payloadJson
        ? JSON.parse(payloadJson)
        : null;

  if (!userId) return { success: false, error: "User id is required." };
  if (!payloadJson)
    return { success: false, error: "Payload JSON is required." };
  if (!signature) return { success: false, error: "Signature is required." };
  if (!entitlementPayload || typeof entitlementPayload !== "object") {
    return { success: false, error: "Entitlement payload is required." };
  }

  const entitlementPlanCode =
    typeof entitlementPayload.entitlementPlanCode === "string" &&
    entitlementPayload.entitlementPlanCode.trim()
      ? entitlementPayload.entitlementPlanCode.trim()
      : "free";
  const lastPaidPlanCode =
    typeof entitlementPayload.lastPaidPlanCode === "string" &&
    entitlementPayload.lastPaidPlanCode.trim()
      ? entitlementPayload.lastPaidPlanCode.trim()
      : null;
  const status =
    typeof entitlementPayload.status === "string" &&
    entitlementPayload.status.trim()
      ? entitlementPayload.status.trim()
      : "none";
  const cloudEnabled = Boolean(entitlementPayload.cloudEnabled);
  const maxConnections = toTimestamp(
    entitlementPayload.maxConnections as number | string | Date | null,
  );
  const maxWorkspaces = toTimestamp(
    entitlementPayload.maxWorkspaces as number | string | Date | null,
  );
  const accessEndsAt = toTimestamp(
    entitlementPayload.accessEndsAt as number | string | Date | null,
  );
  const graceEndsAt = toTimestamp(
    entitlementPayload.graceEndsAt as number | string | Date | null,
  );
  const updatesUntil = toTimestamp(
    entitlementPayload.updatesUntil as number | string | Date | null,
  );
  const issuedAt =
    toTimestamp(entitlementPayload.issuedAt as number | string | Date | null) ??
    Date.now();
  const refreshAfter =
    toTimestamp(
      entitlementPayload.refreshAfter as number | string | Date | null,
    ) ?? issuedAt;
  const lastObservedAt = toTimestamp(payload?.lastObservedAt) ?? Date.now();
  const syncedAt = Date.now();

  await ensureCoreTables();
  await db.run(sql`
    INSERT INTO users (id, created_at, is_local)
    VALUES (${userId}, ${Date.now()}, 0)
    ON CONFLICT(id) DO NOTHING
  `);

  await db.run(sql`
    INSERT INTO user_entitlements (
      user_id,
      payload_json,
      signature,
      entitlement_plan_code,
      last_paid_plan_code,
      status,
      cloud_enabled,
      max_connections,
      max_workspaces,
      access_ends_at,
      grace_ends_at,
      updates_until,
      issued_at,
      refresh_after,
      last_observed_at,
      synced_at
    )
    VALUES (
      ${userId},
      ${payloadJson},
      ${signature},
      ${entitlementPlanCode},
      ${lastPaidPlanCode},
      ${status},
      ${cloudEnabled ? 1 : 0},
      ${maxConnections},
      ${maxWorkspaces},
      ${accessEndsAt},
      ${graceEndsAt},
      ${updatesUntil},
      ${issuedAt},
      ${refreshAfter},
      ${lastObservedAt},
      ${syncedAt}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      signature = excluded.signature,
      entitlement_plan_code = excluded.entitlement_plan_code,
      last_paid_plan_code = excluded.last_paid_plan_code,
      status = excluded.status,
      cloud_enabled = excluded.cloud_enabled,
      max_connections = excluded.max_connections,
      max_workspaces = excluded.max_workspaces,
      access_ends_at = excluded.access_ends_at,
      grace_ends_at = excluded.grace_ends_at,
      updates_until = excluded.updates_until,
      issued_at = excluded.issued_at,
      refresh_after = excluded.refresh_after,
      last_observed_at = excluded.last_observed_at,
      synced_at = excluded.synced_at
  `);

  return { success: true };
}

/** Providers pinned in the settings UI; any other Pi-SDK provider id may also be a key of `providers`. */
export type AgentProvider =
  | "openai"
  | "google"
  | "anthropic"
  | "openrouter"
  | "kilo"
  | "ollama"
  | "external"
  | (string & {});

export type GlobalAiProviderConfig = {
  apiKey: string;
  models: string[];
  baseUrl?: string;
};

export type GlobalAiSettings = {
  permissionMode: "schema_only" | "schema_with_data";
  providers: Record<string, GlobalAiProviderConfig>;
};

type StoredAiChat = {
  id: string;
  connectionId: number;
  userId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredAiChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metaJson?: string | null;
  timestamp: number;
};

const DEFAULT_GLOBAL_AI_SETTINGS: GlobalAiSettings = {
  permissionMode: "schema_with_data",
  providers: {
    openai: { apiKey: "", models: [] },
    google: { apiKey: "", models: [] },
    anthropic: { apiKey: "", models: [] },
    openrouter: {
      apiKey: "",
      models: [],
      baseUrl: "https://openrouter.ai/api/v1",
    },
    kilo: {
      apiKey: "",
      models: [],
      baseUrl: "https://api.kilo.ai/api/gateway",
    },
    ollama: {
      apiKey: "",
      models: [],
      baseUrl: "http://localhost:11434/v1",
    },
    external: {
      apiKey: "",
      models: [],
    },
  },
};

function normalizeGlobalAiSettings(input: unknown): GlobalAiSettings {
  const source =
    input && typeof input === "object"
      ? (input as Partial<GlobalAiSettings>)
      : {};
  const providers =
    source.providers && typeof source.providers === "object"
      ? source.providers
      : {};
  const normalizeModels = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  };
  const normalizeProviderConfig = (
    provider: string,
    config: Partial<GlobalAiProviderConfig> | undefined,
  ): GlobalAiProviderConfig => {
    const defaults = DEFAULT_GLOBAL_AI_SETTINGS.providers[provider];
    return {
      ...defaults,
      ...config,
      apiKey: typeof config?.apiKey === "string" ? config.apiKey : "",
      models: normalizeModels(config?.models),
      baseUrl:
        typeof config?.baseUrl === "string"
          ? config.baseUrl
          : defaults?.baseUrl,
    };
  };

  // Pinned defaults always exist; any additional provider ids the user has
  // configured (from the Pi SDK's full provider catalog) are preserved too.
  const providerIds = new Set([
    ...Object.keys(DEFAULT_GLOBAL_AI_SETTINGS.providers),
    ...Object.keys(providers as Record<string, unknown>),
  ]);
  const normalizedProviders: Record<string, GlobalAiProviderConfig> = {};
  for (const id of providerIds) {
    normalizedProviders[id] = normalizeProviderConfig(id, (providers as any)[id]);
  }

  return {
    permissionMode:
      source.permissionMode === "schema_only"
        ? "schema_only"
        : DEFAULT_GLOBAL_AI_SETTINGS.permissionMode,
    providers: normalizedProviders,
  };
}

function buildAiChatTitle(prompt: string) {
  const singleLine = String(prompt || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return "New chat";
  return singleLine.length > 72
    ? `${singleLine.slice(0, 69).trimEnd()}...`
    : singleLine;
}

export async function getGlobalAiSettings() {
  const { db } = await import("./index");
  const { userAiSettings } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const resolvedUserId = "global";

  try {
    await ensureCoreTables();
    const rows = await db
      .select()
      .from(userAiSettings)
      .where(eq(userAiSettings.userId, resolvedUserId))
      .limit(1);
    const settings = normalizeGlobalAiSettings(
      rows[0]?.settingsJson ? JSON.parse(rows[0].settingsJson) : null,
    );
    return { success: true, data: settings };
  } catch (error) {
    console.error("Failed to load global AI settings:", error);
    return { success: false, error: "Failed to load global AI settings." };
  }
}

export async function saveGlobalAiSettings(settings: GlobalAiSettings) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const { emitGlobalAiSettingsUpdated } =
    await import("@/lib/ai/ai-settings-events");
  const resolvedUserId = "global";
  const normalized = normalizeGlobalAiSettings(settings);
  const payload = JSON.stringify(normalized);
  const updatedAt = Date.now();

  try {
    await ensureCoreTables();
    await db.run(sql`
      INSERT INTO user_ai_settings (user_id, settings_json, updated_at)
      VALUES (${resolvedUserId}, ${payload}, ${updatedAt})
      ON CONFLICT(user_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at
    `);
    emitGlobalAiSettingsUpdated();
    return { success: true, data: normalized };
  } catch (error) {
    console.error("Failed to save global AI settings:", error);
    return { success: false, error: "Failed to save global AI settings." };
  }
}

export async function listAiChats(connectionId: number) {
  const { db } = await import("./index");
  const { aiChats } = await import("./schema");
  const { eq, desc } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const rows = await db
      .select()
      .from(aiChats)
      .where(eq(aiChats.connectionId, connectionId))
      .orderBy(desc(aiChats.updatedAt));
    const chats: StoredAiChat[] = rows.map((row) => ({
      id: row.id,
      connectionId: row.connectionId,
      userId: row.userId ?? null,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return { success: true, data: chats };
  } catch (error) {
    console.error("Failed to list AI chats:", error);
    return { success: false, error: "Failed to list AI chats." };
  }
}

export async function getAiChatMessages(chatId: string) {
  const { db } = await import("./index");
  const { aiChatMessages } = await import("./schema");
  const { eq, asc } = await import("drizzle-orm");
  const resolvedChatId = String(chatId || "").trim();

  if (!resolvedChatId) {
    return { success: false, error: "Chat id is required." };
  }

  try {
    await ensureCoreTables();
    const rows = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.chatId, resolvedChatId))
      .orderBy(asc(aiChatMessages.timestamp));
    const messages: StoredAiChatMessage[] = rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      role: row.role,
      content: row.content,
      metaJson: row.metaJson ?? null,
      timestamp: row.timestamp,
    }));
    return { success: true, data: messages };
  } catch (error) {
    console.error("Failed to load AI chat messages:", error);
    return { success: false, error: "Failed to load AI chat messages." };
  }
}

export async function deleteAiChat(chatId: string) {
  const { db } = await import("./index");
  const { aiChats } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const resolvedChatId = String(chatId || "").trim();

  if (!resolvedChatId) {
    return { success: false, error: "Chat id is required." };
  }

  try {
    await ensureCoreTables();
    await db.delete(aiChats).where(eq(aiChats.id, resolvedChatId));
    return { success: true };
  } catch (error) {
    console.error("Failed to delete AI chat:", error);
    return { success: false, error: "Failed to delete AI chat." };
  }
}

export async function ensureAiChat(payload: {
  chatId: string;
  connectionId: number;
  userId?: string | null;
  title?: string;
  sourcePrompt?: string;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const chatId = String(payload.chatId || "").trim();
  if (!chatId) {
    return { success: false, error: "Chat id is required." };
  }

  const connectionId = Number(payload.connectionId);
  if (!Number.isInteger(connectionId) || connectionId <= 0) {
    return { success: false, error: "Connection id is required." };
  }

  const now = Date.now();
  const title = buildAiChatTitle(payload.title || payload.sourcePrompt || "");
  const userId =
    typeof payload.userId === "string" && payload.userId.trim()
      ? payload.userId.trim()
      : null;

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    await db.run(sql`
      INSERT INTO ai_chats (id, connection_id, user_id, title, created_at, updated_at)
      VALUES (${chatId}, ${connectionId}, ${userId}, ${title}, ${now}, ${now})
      ON CONFLICT(id) DO UPDATE SET
        title = CASE
          WHEN ai_chats.title IS NULL OR ai_chats.title = '' OR ai_chats.title = 'New chat'
          THEN excluded.title
          ELSE ai_chats.title
        END,
        updated_at = excluded.updated_at
    `);
    return { success: true, data: { id: chatId, title } };
  } catch (error) {
    console.error("Failed to ensure AI chat:", error);
    return { success: false, error: "Failed to ensure AI chat." };
  }
}

// fallow-ignore-next-line code-duplication
async function loadChatDbAndValidate(payload: {
  id: string;
  chatId: string;
  content?: string;
  timestamp?: number;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const id = String(payload.id || "").trim();
  const chatId = String(payload.chatId || "").trim();
  const content = String(payload.content || "");
  const timestamp = Number(payload.timestamp || Date.now());
  if (!id || !chatId) {
    return {
      db: null as null,
      sql: null as null,
      id: "",
      chatId: "",
      content: "",
      timestamp: 0,
      error: {
        success: false,
        error: "Message id and chat id are required.",
      } as const,
    };
  }
  return { db, sql, id, chatId, content, timestamp, error: null };
}

export async function appendAiChatMessage(payload: StoredAiChatMessage) {
  const loaded = await loadChatDbAndValidate(payload);
  if (loaded.error) return loaded.error;
  const { db, sql, id, chatId, content, timestamp } = loaded;
  const metaJson = payload.metaJson ?? null;
  try {
    await ensureCoreTables();
    await db.run(sql`
      INSERT INTO ai_chat_messages (id, chat_id, role, content, meta_json, timestamp)
      VALUES (${id}, ${chatId}, ${payload.role}, ${content}, ${metaJson}, ${timestamp})
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        content = CASE
          WHEN excluded.content IS NOT NULL AND excluded.content != '' THEN excluded.content
          ELSE ai_chat_messages.content
        END,
        meta_json = COALESCE(ai_chat_messages.meta_json, excluded.meta_json),
        timestamp = excluded.timestamp
    `);
    await db.run(
      sql`UPDATE ai_chats SET updated_at = ${timestamp} WHERE id = ${chatId}`,
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to append AI chat message:", error);
    return { success: false, error: "Failed to append AI chat message." };
  }
}

export async function updateAiChatMessageContent(payload: {
  id: string;
  chatId: string;
  content: string;
  timestamp?: number;
}) {
  const loaded = await loadChatDbAndValidate(payload);
  if (loaded.error) return loaded.error;
  const { db, sql, id, chatId, content, timestamp } = loaded;
  try {
    await ensureCoreTables();
    await db.run(sql`
      INSERT INTO ai_chat_messages (id, chat_id, role, content, timestamp)
      VALUES (${id}, ${chatId}, ${"user"}, ${content}, ${timestamp})
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        timestamp = excluded.timestamp
    `);
    return { success: true };
  } catch (error) {
    console.error("Failed to update AI chat message content:", error);
    return {
      success: false,
      error: "Failed to update AI chat message content.",
    };
  }
}

export async function deleteAiChatMessagesAfter(payload: {
  chatId: string;
  timestamp: number;
}) {
  const { db } = await import("./index");
  const { aiChatMessages } = await import("./schema");
  const { eq, gt, and } = await import("drizzle-orm");
  const chatId = String(payload.chatId || "").trim();
  const timestamp = Number(payload.timestamp || 0);
  if (!chatId || !timestamp) {
    return { success: false, error: "Chat id and timestamp are required." };
  }
  try {
    await ensureCoreTables();
    await db
      .delete(aiChatMessages)
      .where(
        and(
          eq(aiChatMessages.chatId, chatId),
          gt(aiChatMessages.timestamp, timestamp),
        ),
      );
    return { success: true };
  } catch (error) {
    console.error("Failed to delete AI chat messages:", error);
    return { success: false, error: "Failed to delete AI chat messages." };
  }
}

// fallow-ignore-next-line code-duplication
export async function updateAiChatMessageMeta(payload: {
  id: string;
  chatId: string;
  metaJson: string | null;
  timestamp?: number;
}) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const id = String(payload.id || "").trim();
  const chatId = String(payload.chatId || "").trim();
  const timestamp = Number(payload.timestamp || Date.now());
  if (!id) return { success: false, error: "Message id is required." };
  if (!chatId) return { success: false, error: "Chat id is required." };
  try {
    await ensureCoreTables();
    await db.run(sql`
      INSERT INTO ai_chat_messages (id, chat_id, role, content, meta_json, timestamp)
      VALUES (${id}, ${chatId}, ${"assistant"}, ${""}, ${payload.metaJson}, ${timestamp})
      ON CONFLICT(id) DO UPDATE SET meta_json = excluded.meta_json
    `);
    return { success: true };
  } catch (error) {
    console.error("Failed to update AI chat message meta:", error);
    return { success: false, error: "Failed to update AI chat message meta." };
  }
}

async function readCachedSchemas(
  connectionString: string,
  maxAgeMs: number,
): Promise<string[] | null> {
  return _readCachedSchemas(connectionString, maxAgeMs, ensureCoreTables);
}

async function getCachedSchemasSnapshot(
  connectionString: string,
): Promise<string[]> {
  return _getCachedSchemasSnapshot(connectionString, ensureCoreTables);
}

async function writeCachedSchemas(connectionString: string, schemas: string[]) {
  return _writeCachedSchemas(connectionString, schemas, ensureCoreTables);
}

async function readCachedTables(
  connectionString: string,
  schema: string,
  maxAgeMs: number,
): Promise<string[] | null> {
  return _readCachedTables(
    connectionString,
    schema,
    maxAgeMs,
    ensureCoreTables,
  );
}

async function getCachedTablesSnapshot(
  connectionString: string,
  schema: string,
): Promise<string[]> {
  return _getCachedTablesSnapshot(connectionString, schema, ensureCoreTables);
}

async function writeCachedTables(
  connectionString: string,
  schema: string,
  tables: string[],
) {
  return _writeCachedTables(connectionString, schema, tables, ensureCoreTables);
}

async function readCachedColumns(
  connectionString: string,
  maxAgeMs: number,
  schema?: string,
): Promise<CachedColumnRow[] | null> {
  return _readCachedColumns(
    connectionString,
    maxAgeMs,
    ensureCoreTables,
    schema,
  );
}

async function writeCachedColumns(
  connectionString: string,
  rows: CachedColumnRow[],
  schema?: string,
) {
  return _writeCachedColumns(connectionString, rows, ensureCoreTables, schema);
}

async function syncConnectionGroupMembers(connId: number, groupNames: string[]) {
  const { db } = await import("./index");
  const { connectionGroups, connectionGroupMembers } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  await db.delete(connectionGroupMembers).where(eq(connectionGroupMembers.connectionId, connId));
  if (groupNames.length === 0) return;

  const allGroups = await db.select().from(connectionGroups);
  const matching = allGroups.filter(g => groupNames.includes(g.name));
  if (matching.length > 0) {
    await db.insert(connectionGroupMembers).values(
      matching.map(g => ({ connectionId: connId, groupId: g.id }))
    );
  }
}

export async function addConnection(
  name: string,
  connectionString: string,
  connectionType?: string,
  options?: {
    environment?: string;
    color?: string;
    group?: string;
    groups?: string[];
    isFavorite?: boolean;
    host?: string;
    port?: string;
    database?: string;
    username?: string;
    password?: string;
    sslMode?: string;
    authToken?: string;
  },
) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");

  try {
    await ensureCoreTables();
    const newId = Date.now();
    await db.insert(connections).values({
      id: newId,
      name,
      connectionString,
      connectionType,
      host: options?.host,
      port: options?.port,
      database: options?.database,
      username: options?.username,
      password: options?.password,
      sslMode: options?.sslMode,
      authToken: options?.authToken,
      environment: options?.environment,
      color: options?.color,
      group: Array.isArray(options?.groups) ? options.groups[0] : (options?.group || null),
      isFavorite: options?.isFavorite,
      createdAt: new Date(),
      sortOrder: newId,
    });
    if (options?.groups && options.groups.length > 0) {
      await syncConnectionGroupMembers(newId, options.groups);
    }
    return { success: true, id: newId };
  } catch (error) {
    console.error("Failed to add connection:", error);
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to save connection",
      ),
    };
  }
}

export async function getConnections(workspaceUrl?: string) {
  const { db } = await import("./index");
  const { connections, connectionGroupMembers, connectionGroups } = await import("./schema");
  const { desc, eq, sql } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    let conns;
    if (workspaceUrl) {
      conns = await db
        .select()
        .from(connections)
        .where(sql`connection_string LIKE 'workspace:%'`)
        .orderBy(desc(connections.sortOrder), desc(connections.createdAt));
    } else {
      conns = await db
        .select()
        .from(connections)
        .orderBy(desc(connections.sortOrder), desc(connections.createdAt));
    }

    const members = await db
      .select({
        connectionId: connectionGroupMembers.connectionId,
        groupName: connectionGroups.name,
      })
      .from(connectionGroupMembers)
      .innerJoin(connectionGroups, eq(connectionGroupMembers.groupId, connectionGroups.id));

    const groupsByConnId = new Map<number, string[]>();
    for (const m of members) {
      if (!groupsByConnId.has(m.connectionId)) groupsByConnId.set(m.connectionId, []);
      if (m.groupName) groupsByConnId.get(m.connectionId)!.push(m.groupName);
    }

    return conns.map((conn) => ({
      ...conn,
      groups: groupsByConnId.get(conn.id) || [],
    }));
  } catch (error) {
    console.error("Failed to get connections:", error);
    return [];
  }
}

export async function getConnection(id: number) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    const results = await db
      .select()
      .from(connections)
      .where(eq(connections.id, id));
    return results[0] || null;
  } catch (error) {
    console.error("Failed to get connection:", error);
    return null;
  }
}

export async function deleteConnectionsByPrefix(prefix: string) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { like } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    const result = await db
      .delete(connections)
      .where(like(connections.connectionString, `${prefix}%`));
    return { success: true };
  } catch (error) {
    console.error("Failed to delete connections by prefix:", error);
    return { success: false };
  }
}

export async function deleteConnection(id: number) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await db.delete(connections).where(eq(connections.id, id));
    return { success: true };
  } catch (error) {
    console.error("Failed to delete connection:", error);
    return { success: false };
  }
}

export async function updateConnection(id: number, data: Record<string, any>) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await db
      .update(connections)
      .set({
        name: data.name,
        connectionString: data.connectionString,
        connectionType: data.connectionType,
        sortOrder: data.sortOrder,
        host: data.host,
        port: data.port,
        database: data.database,
        username: data.username,
        password: data.password,
        sslMode: data.sslMode,
        authToken: data.authToken,
        environment: data.environment,
        color: data.color,
        group: Array.isArray(data.groups) ? data.groups[0] || null : (data.group || null),
        isFavorite: data.isFavorite,
        lastActive: data.lastActive ? new Date(data.lastActive) : undefined,
      })
      .where(eq(connections.id, id));
    if (data.groups !== undefined) {
      await syncConnectionGroupMembers(id, data.groups || []);
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to update connection:", error);
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to update connection",
      ),
    };
  }
}

export async function runQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
  options: {
    queryId?: string;
    connectionType?: string;
    executionContext?: any;
  } = {},
): Promise<SqlEditorRunQueryResult> {
  try {
    const { executeDbQuery } = await import("./db-engine");
    const start = Date.now();
    const result = await executeDbQuery(
      connectionString,
      query,
      params,
      options,
    );
    const end = Date.now();

    return {
      success: true,
      data: {
        ...result,
        executionTime: end - start,
      },
    };
  } catch (error: any) {
    console.error("Query failed:", error);
    return { success: false, error: error.message };
  }
}

export async function cancelRunningQuery(
  connectionString: string,
  queryId: string,
) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType !== "postgres") {
    return {
      success: false,
      error: "Query cancellation is currently supported for PostgreSQL only.",
    };
  }

  const normalizedQueryId = String(queryId || "").trim();
  if (!normalizedQueryId) {
    return { success: false, error: "Missing query id." };
  }

  const { cancelQueryById } = await import("./pg-client");
  try {
    const cancelled = await cancelQueryById(normalizedQueryId);
    if (!cancelled) {
      return {
        success: false,
        error: "Could not cancel query. It may have already finished.",
      };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Failed to cancel running query:", error);
    return {
      success: false,
      error: error?.message || "Failed to cancel running query.",
    };
  }
}

export async function deleteTableRows(
  connectionString: string,
  schema: string,
  table: string,
  pkValues: any[],
) {
  return _deleteTableRows(connectionString, schema, table, pkValues);
}

export async function updateTableRows(
  connectionString: string,
  schema: string,
  table: string,
  updates: Array<{ where: Record<string, any>; set: Record<string, any> }>,
) {
  return _updateTableRows(connectionString, schema, table, updates);
}

export async function fetchTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  return _fetchTableStructure(connectionString, schema, table);
}

export async function fetchTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  return _fetchTableForeignKeys(connectionString, schema, table);
}

export async function fetchReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
) {
  return _fetchReferencedRecord(connectionString, schema, table, keyValues);
}

async function withCachedFetch(
  label: string,
  fetch: () => Promise<any>,
  cache: (data: any) => Promise<void>,
) {
  try {
    const data = await fetch();
    await cache(data);
    return { success: true, data };
  } catch (error: any) {
    console.error(`Failed to fetch ${label}:`, error);
    return { success: false, error: error.message };
  }
}

async function withCachedFetchIgnoringCacheError(
  label: string,
  fetch: () => Promise<any>,
  cache: (data: any) => Promise<void>,
) {
  try {
    const data = await fetch();
    try {
      await cache(data);
    } catch (cacheError: any) {
      console.error(`Failed to cache ${label}:`, cacheError);
    }
    return { success: true, data };
  } catch (error: any) {
    console.error(`Failed to fetch ${label}:`, error);
    return { success: false, error: error.message };
  }
}

export async function fetchTables(
  connectionString: string,
  schema: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number },
) {
  const dbType = detectConnectionDbType(connectionString);
  const {
    forceRefresh = false,
    cacheMaxAgeMs = DEFAULT_SCHEMA_CACHE_MAX_AGE_MS,
  } = options || {};

  if (!forceRefresh) {
    const cached = await readCachedTables(
      connectionString,
      schema,
      cacheMaxAgeMs,
    );
    if (cached) {
      return { success: true, data: cached };
    }
  }

  if (dbType === "mongodb") {
    const resolvedSchema =
      schema || getMongoDatabaseFromConnectionString(connectionString);
    return withCachedFetch(
      "Mongo collections",
      async () => {
        const { getMongoCollections } = await import("./mongo-client");
        return getMongoCollections(connectionString, resolvedSchema);
      },
      (d) => writeCachedTables(connectionString, resolvedSchema, d),
    );
  }

  if (dbType === "sqlite") {
    const resolvedSchema = schema || "main";
    return withCachedFetch(
      "SQLite tables",
      async () => {
        const { getSqlEngineTables } = await import("./sql-engine");
        return getSqlEngineTables(connectionString, resolvedSchema);
      },
      (d) => writeCachedTables(connectionString, resolvedSchema, d),
    );
  }

  if (dbType === "mysql") {
    return withCachedFetch(
      "MySQL tables",
      async () => {
        const { getSqlEngineTables } = await import("./sql-engine");
        return getSqlEngineTables(connectionString, schema);
      },
      (d) => writeCachedTables(connectionString, schema, d),
    );
  }

  if (dbType === "clickhouse" || dbType === "mssql" || dbType === "trino") {
    return withCachedFetch(
      "tables",
      async () => {
        const { getDbTables } = await import("./db-engine");
        return getDbTables(connectionString, schema);
      },
      (d) => writeCachedTables(connectionString, schema, d),
    );
  }

  return withCachedFetch(
    "tables",
    async () => {
      const { getDbTables } = await import("./db-engine");
      return getDbTables(connectionString, schema);
    },
    (d) => writeCachedTables(connectionString, schema, d),
  );
}

export async function fetchSchemas(
  connectionString: string,
  options?: {
    forceRefresh?: boolean;
    cacheMaxAgeMs?: number;
    connectionType?: string;
  },
) {
  const dbType = detectConnectionDbType(
    connectionString,
    options?.connectionType,
  );
  const {
    forceRefresh = false,
    cacheMaxAgeMs = DEFAULT_SCHEMA_CACHE_MAX_AGE_MS,
  } = options || {};

  if (!forceRefresh) {
    const cached = await readCachedSchemas(connectionString, cacheMaxAgeMs);
    if (cached) {
      return { success: true, data: cached };
    }
  }

  if (dbType === "mongodb") {
    const schemas = [
      getMongoDatabaseFromConnectionString(connectionString),
    ].filter(Boolean) as string[];
    await writeCachedSchemas(connectionString, schemas);
    return { success: true, data: schemas };
  }

  if (dbType === "sqlite") {
    return withCachedFetch(
      "SQLite schemas",
      async () => {
        const { getSqlEngineSchemas } = await import("./sql-engine");
        return getSqlEngineSchemas(connectionString);
      },
      (d) => writeCachedSchemas(connectionString, d),
    );
  }

  if (dbType === "mysql") {
    return withCachedFetch(
      "MySQL schemas",
      async () => {
        const { getSqlEngineSchemas } = await import("./sql-engine");
        return getSqlEngineSchemas(connectionString);
      },
      (d) => writeCachedSchemas(connectionString, d),
    );
  }

  if (dbType === "clickhouse" || dbType === "mssql" || dbType === "trino") {
    return withCachedFetch(
      "schemas",
      async () => {
        const { getDbSchemas } = await import("./db-engine");
        return getDbSchemas(connectionString);
      },
      (d) => writeCachedSchemas(connectionString, d),
    );
  }

  return withCachedFetch(
    "schemas",
    async () => {
      const { getDbSchemas } = await import("./db-engine");
      return getDbSchemas(connectionString);
    },
    (d) => writeCachedSchemas(connectionString, d),
  );
}

export async function fetchDatabases(connectionString: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "redis") {
    const { getRedisDatabases } = await import("./redis-client");
    try {
      const databases = await getRedisDatabases(connectionString);
      return { success: true, data: databases };
    } catch (error: any) {
      console.error("Failed to fetch Redis databases:", error);
      return { success: false, error: error.message };
    }
  }

  try {
    const { getDbDatabases } = await import("./db-engine");
    const databases = await getDbDatabases(connectionString);
    return { success: true, data: databases };
  } catch (error: any) {
    console.error("Failed to fetch databases:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchAllTablesWithColumns(
  connectionString: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number; schema?: string },
) {
  const dbType = detectConnectionDbType(connectionString);
  const {
    forceRefresh = false,
    cacheMaxAgeMs = DEFAULT_SCHEMA_CACHE_MAX_AGE_MS,
    schema,
  } = options || {};

  if (!forceRefresh) {
    const cached = await readCachedColumns(
      connectionString,
      cacheMaxAgeMs,
      schema,
    );
    if (cached) {
      return { success: true, data: cached };
    }
  }

  if (dbType === "mongodb") {
    return { success: true, data: [] as any[] };
  }

  if (dbType === "sqlite") {
    return withCachedFetchIgnoringCacheError(
      "SQLite schema graph data",
      async () => {
        const { getSqlEngineAllTablesWithColumns } =
          await import("./sql-engine");
        return getSqlEngineAllTablesWithColumns(connectionString, schema);
      },
      (d) =>
        writeCachedColumns(connectionString, d as CachedColumnRow[], schema),
    );
  }

  if (dbType === "mysql") {
    return withCachedFetchIgnoringCacheError(
      "MySQL schema graph data",
      async () => {
        const { getSqlEngineAllTablesWithColumns } =
          await import("./sql-engine");
        return getSqlEngineAllTablesWithColumns(connectionString, schema);
      },
      (d) =>
        writeCachedColumns(connectionString, d as CachedColumnRow[], schema),
    );
  }

  if (dbType === "clickhouse" || dbType === "mssql" || dbType === "trino") {
    return withCachedFetchIgnoringCacheError(
      "schema graph data",
      async () => {
        const { getDbAllTablesWithColumns } = await import("./db-engine");
        return getDbAllTablesWithColumns(connectionString);
      },
      (d) => writeCachedColumns(connectionString, d as CachedColumnRow[]),
    );
  }

  return withCachedFetchIgnoringCacheError(
    "all tables and columns",
    async () => {
      const { getDbAllTablesWithColumns } = await import("./db-engine");
      return getDbAllTablesWithColumns(connectionString);
    },
    (d) => writeCachedColumns(connectionString, d as CachedColumnRow[]),
  );
}

// Studio Storage Actions

export async function getStudioFolders(connectionId: number) {
  const { db } = await import("./index");
  const { folders } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const foldersData = await db
      .select()
      .from(folders)
      .where(eq(folders.connectionId, connectionId));
    return { success: true, data: foldersData };
  } catch (error) {
    console.error("Failed to fetch studio folders:", error);
    return { success: false, error: "Failed to fetch studio folders" };
  }
}

export async function saveStudioFolders(
  connectionId: number,
  foldersList: any[],
) {
  const { folders } = await import("./schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const normalizedFolders = Array.isArray(foldersList) ? foldersList : [];
    const cleanFolders = normalizedFolders
      .map((folder) => {
        const id = folder?.id;
        const name = folder?.name;
        const parentId = folder?.parentId;
        const createdAt = folder?.createdAt;
        return {
          id:
            typeof id === "string" || typeof id === "number" ? String(id) : "",
          connectionId,
          parentId: typeof parentId === "string" ? parentId : null,
          name: typeof name === "string" ? name : "",
          createdAt: Number.isFinite(createdAt)
            ? Number(createdAt)
            : Date.now(),
        };
      })
      .filter((folder) => folder.id && folder.name);
    const dedupedFolders = Array.from(
      new Map(cleanFolders.map((folder) => [folder.id, folder])).values(),
    );
    await runCoreTransaction("saveStudioFolders", async (tx) => {
      await tx.delete(folders).where(eq(folders.connectionId, connectionId));
      if (dedupedFolders.length > 0) {
        await tx.insert(folders).values(dedupedFolders);
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save folders:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function getStudioSnippets(connectionId: number) {
  const { db } = await import("./index");
  const { snippets } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const snippetsData = await db
      .select()
      .from(snippets)
      .where(eq(snippets.connectionId, connectionId));
    return { success: true, data: snippetsData };
  } catch (error) {
    console.error("Failed to fetch studio snippets:", error);
    return { success: false, error: "Failed to fetch studio snippets" };
  }
}

export async function saveStudioSnippets(
  connectionId: number,
  snippetsList: any[],
) {
  const { db } = await import("./index");
  const { snippets, folders, snippetVersions } = await import("./schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const normalizedSnippets = Array.isArray(snippetsList) ? snippetsList : [];
    const existingFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.connectionId, connectionId));
    const folderIdSet = new Set(existingFolders.map((folder) => folder.id));
    const cleanSnippets = normalizedSnippets
      .map((snippet) => {
        const id = snippet?.id;
        const name = snippet?.name;
        const query = snippet?.query;
        const createdAt = snippet?.createdAt;
        const folderId = snippet?.folderId;
        const isShared = snippet?.isShared;
        const sharedEntryId = snippet?.sharedEntryId;
        return {
          id:
            typeof id === "string" || typeof id === "number" ? String(id) : "",
          connectionId,
          name: typeof name === "string" ? name : "",
          query: typeof query === "string" ? query : "",
          folderId:
            typeof folderId === "string" && folderIdSet.has(folderId)
              ? folderId
              : null,
          createdAt: Number.isFinite(createdAt)
            ? Number(createdAt)
            : Date.now(),
          isShared: Boolean(isShared),
          sharedEntryId:
            typeof sharedEntryId === "string" ? sharedEntryId : null,
        };
      })
      .filter((snippet) => snippet.id && snippet.name && snippet.query);
    const dedupedSnippets = Array.from(
      new Map(cleanSnippets.map((snippet) => [snippet.id, snippet])).values(),
    );
    const keptIds = new Set(dedupedSnippets.map((s) => s.id));
    const existingRows = await db
      .select()
      .from(snippets)
      .where(eq(snippets.connectionId, connectionId));
    const existingSnippetIds = existingRows.map((r) => r.id);
    const deletedIds = existingSnippetIds.filter((id) => !keptIds.has(id));
    await runCoreTransaction("saveStudioSnippets", async (tx) => {
      await tx.delete(snippets).where(eq(snippets.connectionId, connectionId));
      if (dedupedSnippets.length > 0) {
        await tx.insert(snippets).values(dedupedSnippets);
      }
      if (deletedIds.length > 0) {
        await tx
          .delete(snippetVersions)
          .where(inArray(snippetVersions.snippetId, deletedIds));
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save snippets:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function createSnippetVersion(
  connectionId: number,
  snippetId: string,
  name: string,
  query: string,
) {
  const { db } = await import("./index");
  const { snippetVersions } = await import("./schema");
  const { eq, desc } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    const existingVersions = await db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.snippetId, snippetId))
      .orderBy(desc(snippetVersions.versionNumber))
      .limit(1);
    const nextVersion =
      existingVersions.length > 0 ? existingVersions[0].versionNumber + 1 : 1;
    const newVersion = {
      id: Math.random().toString(36).substring(2, 11),
      snippetId,
      name,
      query,
      versionNumber: nextVersion,
      createdAt: Date.now(),
    };
    await db.insert(snippetVersions).values(newVersion);
    return { success: true, data: newVersion };
  } catch (error) {
    console.error("Failed to create snippet version:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function getSnippetVersions(
  connectionId: number,
  snippetId: string,
) {
  const { db } = await import("./index");
  const { snippetVersions } = await import("./schema");
  const { eq, desc } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    const versions = await db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.snippetId, snippetId))
      .orderBy(desc(snippetVersions.versionNumber));
    return { success: true, data: versions };
  } catch (error) {
    console.error("Failed to fetch snippet versions:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function restoreSnippetVersion(
  connectionId: number,
  snippetId: string,
  versionId: string,
) {
  const { db } = await import("./index");
  const { snippets, snippetVersions } = await import("./schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    const versions = await db
      .select()
      .from(snippetVersions)
      .where(eq(snippetVersions.snippetId, snippetId));
    const version = versions.find((v) => v.id === versionId);
    if (!version) return { success: false, error: "Version not found" };
    const pruneIds = versions
      .filter((v) => v.versionNumber > version.versionNumber)
      .map((v) => v.id);
    if (pruneIds.length > 0) {
      await db
        .delete(snippetVersions)
        .where(inArray(snippetVersions.id, pruneIds));
    }
    const [snippet] = await db
      .select()
      .from(snippets)
      .where(eq(snippets.id, snippetId))
      .limit(1);
    if (!snippet) return { success: false, error: "Snippet not found" };
    await db
      .update(snippets)
      .set({ name: version.name, query: version.query })
      .where(eq(snippets.id, snippetId));
    return {
      success: true,
      data: { name: version.name, query: version.query },
    };
  } catch (error) {
    console.error("Failed to restore snippet version:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function getStudioHistory(connectionId: number) {
  return _getStudioHistory(
    connectionId,
    ensureCoreTables,
    ensureConnectionExists,
  );
}

export async function insertHistoryEntry(
  connectionId: number,
  entry: {
    id: string;
    query: string;
    executedAt: number;
    duration: number;
    status: "success" | "error";
    error?: string | null;
    rowsCount?: number | null;
    caller: "user" | "system";
    executedBy?: string | null;
    executedByName?: string | null;
  },
) {
  return _insertHistoryEntry(
    connectionId,
    entry,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function clearStudioHistory(connectionId: number) {
  return _clearStudioHistory(connectionId, ensureCoreTables);
}
export async function saveStudioHistory(
  connectionId: number,
  historyList: any[],
) {
  return _saveStudioHistory(
    connectionId,
    historyList,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioTags(connectionId: number) {
  return _getStudioTags(connectionId, ensureCoreTables, ensureConnectionExists);
}
export async function saveStudioTags(connectionId: number, tagsList: any[]) {
  return _saveStudioTags(
    connectionId,
    tagsList,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioTableTags(connectionId: number) {
  return _getStudioTableTags(
    connectionId,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function saveStudioTableTags(
  connectionId: number,
  tableTagsMap: Record<string, string[]>,
) {
  return _saveStudioTableTags(
    connectionId,
    tableTagsMap,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioTabs(connectionId: number) {
  return _getStudioTabs(connectionId, ensureCoreTables, ensureConnectionExists);
}
export async function saveStudioTabs(connectionId: number, tabsList: any[]) {
  return _saveStudioTabs(
    connectionId,
    tabsList,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioSettings(connectionId: number) {
  return _getStudioSettings(
    connectionId,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioBootstrap(
  connectionId: number,
  requestedSchema?: string | null,
) {
  return _getStudioBootstrap(
    connectionId,
    requestedSchema ?? null,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getStudioDashboards(connectionId: number) {
  return _getStudioDashboards(
    connectionId,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function saveStudioDashboards(
  connectionId: number,
  payload: { dashboards?: any[]; folders?: any[] },
) {
  return _saveStudioDashboards(
    connectionId,
    payload,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function saveStudioSettings(connectionId: number, settings: any) {
  return _saveStudioSettings(
    connectionId,
    settings,
    ensureCoreTables,
    ensureConnectionExists,
  );
}
export async function getConnectionAnalytics(connectionId: number, range?: string) {
  return _getConnectionAnalytics(
    connectionId,
    ensureCoreTables,
    ensureConnectionExists,
    range,
  );
}
export async function getUserAnalytics() {
  return _getUserAnalytics(ensureCoreTables);
}

async function exportDatabaseBundle(
  connectionString: string,
  format: "sql" | "json" | "csv",
) {
  return _exportDatabaseBundle(connectionString, format, runQuery);
}

async function importDatabaseBundle(
  connectionString: string,
  format: "sql" | "json" | "csv",
  content: string,
) {
  return _importDatabaseBundle(connectionString, format, content);
}

export async function createSnapshot(connectionString: string, name: string, description: string, connectionId: string) {
  try {
    const { createSnapshot: _createSnapshot } = await import("./snapshot-core");
    const meta = await _createSnapshot(connectionString, name, description, connectionId);
    return { success: true, data: meta };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function listSnapshots(connectionId: string) {
  try {
    const { listSnapshots: _listSnapshots } = await import("./snapshot-core");
    const metas = await _listSnapshots(connectionId);
    return { success: true, data: metas };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getSnapshot(connectionId: string, snapshotId: string) {
  try {
    const { loadSnapshot, serializeSnapshotForApi } = await import("./snapshot-core");
    const snapshot = await loadSnapshot(connectionId, snapshotId);
    return { success: true, data: serializeSnapshotForApi(snapshot) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getSnapshotFull(connectionId: string, snapshotId: string) {
  try {
    const { loadSnapshot } = await import("./snapshot-core");
    const snapshot = await loadSnapshot(connectionId, snapshotId);
    return { success: true, data: snapshot };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteSnapshot(connectionId: string, snapshotId: string) {
  try {
    const { deleteSnapshotFile } = await import("./snapshot-core");
    await deleteSnapshotFile(connectionId, snapshotId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function compareSnapshots(connectionId: string, olderId: string, newerId: string) {
  try {
    const { loadSnapshot, compareSnapshots: _compareSnapshots } = await import("./snapshot-core");
    const older = await loadSnapshot(connectionId, olderId);
    const newer = await loadSnapshot(connectionId, newerId);
    const diff = _compareSnapshots(older, newer);
    return { success: true, data: diff };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getAppFontFamily() {
  return _getAppFontFamily(ensureCoreTables);
}

export async function saveAppFontFamily(fontFamily: string | null) {
  return _saveAppFontFamily(fontFamily);
}

export async function getGlobalAppThemeSettings() {
  return _getGlobalAppThemeSettings(ensureCoreTables);
}

export async function saveGlobalAppThemeSettings(settings: {
  appThemeId: string;
  customAppThemes: string;
}) {
  return _saveGlobalAppThemeSettings(settings);
}

export async function getGlobalEditorThemeSettings() {
  return _getGlobalEditorThemeSettings(ensureCoreTables);
}

export async function saveGlobalEditorThemeSettings(settings: {
  editorThemeId: string;
  customEditorThemes: string;
}) {
  return _saveGlobalEditorThemeSettings(settings);
}

export async function getGlobalStudioSettings() {
  return _getGlobalStudioSettings(ensureCoreTables);
}

export async function saveGlobalStudioSettings(settings: Record<string, any>) {
  return _saveGlobalStudioSettings(settings);
}

export async function isMigrationNeeded() {
  return _isMigrationNeeded();
}

export async function migrateSettingsFromSqlite() {
  return _migrateSettingsFromSqlite();
}

export async function clearMigratedSqliteSettings() {
  return _clearMigratedSqliteSettings();
}

export async function getConnectionWorkspaceId(connectionId: number) {
  return _getConnectionWorkspaceId(connectionId);
}

export async function saveConnectionWorkspaceId(
  connectionId: number,
  workspaceId: string | null,
) {
  return _saveConnectionWorkspaceId(connectionId, workspaceId);
}

async function getAppSetting<T>(
  keyPrefix: string,
  connectionId: number,
  schema: string,
  table: string,
  defaultValue: T,
  errorLabel: string,
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    await ensureAppStorageTables();
    const key = `${keyPrefix}:${connectionId}:${schema}.${table}`;
    const rows = await db.all<{ value: string | null }>(sql`
      SELECT value FROM app_settings WHERE key = ${key}
    `);
    const raw = rows[0]?.value?.trim();
    if (raw) {
      try {
        return { success: true, data: JSON.parse(raw) as T };
      } catch {
        return { success: true, data: defaultValue };
      }
    }
    return { success: true, data: defaultValue };
  } catch (error: any) {
    console.error(`Failed to get ${errorLabel}:`, error);
    return { success: false, error: error.message };
  }
}

async function getTableColumnVisibility(
  connectionId: number,
  schema: string,
  table: string,
) {
  return getAppSetting<string[]>(
    "column_visibility",
    connectionId,
    schema,
    table,
    [],
    "table column visibility",
  );
}

async function saveTableColumnVisibility(
  connectionId: number,
  schema: string,
  table: string,
  hiddenColumns: string[],
) {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const key = `column_visibility:${connectionId}:${schema}.${table}`;
    const value = JSON.stringify(hiddenColumns);
    const updatedAt = Date.now();

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${value}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save table column visibility:", error);
    return { success: false, error: error.message };
  }
}

async function getTablePagination(
  connectionId: number,
  schema: string,
  table: string,
) {
  return getAppSetting<{ pageSize: number } | null>(
    "pagination",
    connectionId,
    schema,
    table,
    null,
    "table pagination",
  );
}

async function saveTablePagination(
  connectionId: number,
  schema: string,
  table: string,
  pagination: { pageSize: number },
) {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const key = `pagination:${connectionId}:${schema}.${table}`;
    const value = JSON.stringify(pagination);
    const updatedAt = Date.now();

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${value}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save table pagination:", error);
    return { success: false, error: error.message };
  }
}

export async function testConnection(
  connectionString: string,
  connectionType?: string | null,
) {
  try {
    const dbType = detectConnectionDbType(connectionString, connectionType);
    switch (dbType) {
      case "sqlite": {
        const { createSqliteDriver } = await import("./sqlite-client");
        const db = await createSqliteDriver(connectionString);
        try {
          await db.all("SELECT 1");
        } finally {
          await db.close();
        }
        return { success: true };
      }
      case "mongodb": {
        const { testMongoConnection } = await import("./mongo-client");
        await testMongoConnection(connectionString);
        return { success: true };
      }
      case "postgres": {
        const { resolveEffectiveConnectionString } = await import("./neon-cli-client");
        const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
        const pgMod = (globalThis as any).__pg || (await import("pg")).default;
        const client = new pgMod.Client({ connectionString: effectiveConnectionString });
        try {
          await client.connect();
          await client.query("SELECT 1");
        } finally {
          await client.end();
        }
        return { success: true };
      }
      case "mysql": {
        const { executeMysqlQuery } = await import("./mysql-client");
        await executeMysqlQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      case "mssql": {
        const { executeMssqlQuery } = await import("./mssql-client");
        await executeMssqlQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      case "redis": {
        const { executeRedisCommand } = await import("./redis-client");
        await executeRedisCommand(connectionString, "PING");
        return { success: true };
      }
      case "clickhouse": {
        const { executeClickhouseQuery } = await import("./clickhouse-client");
        await executeClickhouseQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      case "trino": {
        const { executeTrinoQuery } = await import("./trino-client");
        await executeTrinoQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      case "duckdb": {
        const { executeDuckdbQuery } = await import("./duckdb-client");
        await executeDuckdbQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      case "spacetimedb": {
        const { testSpacetimeDbConnection } = await import("./spacetimedb-client");
        await testSpacetimeDbConnection(connectionString);
        return { success: true };
      }
      case "jdbc": {
        const { testJdbcConnection } = await import("./jdbc-client");
        await testJdbcConnection(connectionString);
        return { success: true };
      }
      case "supabase-mgmt": {
        const { executeSupabaseMgmtQuery } = await import("./supabase-mgmt-client");
        await executeSupabaseMgmtQuery(connectionString, "SELECT 1");
        return { success: true };
      }
      default: {
        return {
          success: false,
          error: `Connection testing not implemented for type: ${dbType}`,
        };
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message || error.code || String(error) };
  }
}

export async function listConnectionGroups() {
  const { db } = await import("./index");
  const { connectionGroups } = await import("./schema");

  try {
    await ensureCoreTables();
    return await db
      .select()
      .from(connectionGroups)
      .orderBy(connectionGroups.name);
  } catch (error) {
    console.error("Failed to list connection groups:", error);
    return [];
  }
}

export async function addConnectionGroup(name: string) {
  const { db } = await import("./index");
  const { connectionGroups } = await import("./schema");

  try {
    await ensureCoreTables();
    await db.insert(connectionGroups).values({ name, createdAt: new Date() });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to add group",
      ),
    };
  }
}

export async function renameConnectionGroup(oldName: string, newName: string) {
  const { db } = await import("./index");
  const { connectionGroups, connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await db
      .update(connectionGroups)
      .set({ name: newName })
      .where(eq(connectionGroups.name, oldName));
    await db
      .update(connections)
      .set({ group: newName })
      .where(eq(connections.group, oldName));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to rename group",
      ),
    };
  }
}

export async function deleteConnectionGroup(name: string) {
  const { db } = await import("./index");
  const { connectionGroups } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await db.delete(connectionGroups).where(eq(connectionGroups.name, name));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to delete group",
      ),
    };
  }
}

export async function reorderConnections(orderedIds: number[]) {
  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(connections)
        .set({ sortOrder: orderedIds.length - i })
        .where(eq(connections.id, orderedIds[i]));
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(
        (error as Error)?.message || error || "Failed to reorder connections",
      ),
    };
  }
}
