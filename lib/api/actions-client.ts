"use client";

import type { Connection, ConnectionSettings, OpenTab } from "@/lib/db/schema";
import type {
  SignedEntitlementPayload,
  StoredUserEntitlement,
  StoredUserEntitlementInput,
} from "@/lib/billing/entitlement-types";
import type { QueryExecutionContext } from "@/lib/studio/table-permissions";
import type { HistoryEntry } from "@/lib/api/history-entry-types";
import { emitGlobalAiSettingsUpdated } from "@/lib/ai/ai-settings-events";
import { API_BASE } from "@/lib/api-base";
import { isDesktopRuntime } from "@/lib/desktop";

type ApiResult<T> = { success: boolean; data?: T; error?: string } & Record<
  string,
  unknown
>;

// Fast path for settings that also live directly in Rust (see src-tauri/src/lib.rs).
// Returns undefined when not running under Tauri, or when the Rust side reports
// it has nothing to serve yet (e.g. settings.json hasn't been migrated into
// existence) — callers fall back to the HTTP request in that case.
async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<T | null>(cmd, args);
    return result === null ? undefined : result;
  } catch {
    return undefined;
  }
}

export type { GlobalAiSettings } from "@/lib/ai/types";
export type { SqlEditorRunQueryResult } from "@/lib/db/actions-constants";

type StudioBootstrapResponse = {
  connection: Connection | null;
  tabs: OpenTab[];
  settings: ConnectionSettings | null;
  schemas: string[];
  selectedSchema: string | null;
  tables: string[];
};

function resolveApiUrl(input: RequestInfo | URL): string {
  const urlStr = input.toString();
  const url = new URL(urlStr, window.location.origin);
  return new URL(url.pathname + url.search, API_BASE).toString();
}

async function request<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const apiUrl = resolveApiUrl(input);

  let response: Response;
  try {
    response = await fetch(apiUrl, init);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Request failed",
    };
  }

  const body = await response.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return {
      success: false,
      error: response.ok ? "Empty response." : "Request failed.",
    };
  }

  if (!response.ok && typeof (body as any).success === "undefined") {
    return { success: false, error: (body as any).error || "Request failed." };
  }

  return body as ApiResult<T>;
}

function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const url = new URL(path, API_BASE);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || typeof value === "undefined") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

function callAction<T = any>(action: string, args: unknown[] = []) {
  return request<T>(buildUrl(`/api/actions/${encodeURIComponent(action)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });
}

export async function getConnections(): Promise<any[]> {
  const res = await request<any[]>(buildUrl("/api/connections"));
  return res.success && Array.isArray(res.data) ? res.data : [];
}

export function upsertUserProfile(payload: {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  createdAt?: number | string | Date | null;
  isLocal?: boolean;
  supabaseId?: string | null;
}) {
  return request(buildUrl("/api/user/profile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function clearAllUsers() {
  return request(buildUrl("/api/user/profile"), {
    method: "DELETE",
    body: JSON.stringify({ all: true }),
  });
}

function getAllUsers() {
  const url = buildUrl("/api/user/profile", { getAll: "true" });
  return request(url);
}

export function deleteUserProfile(id: string) {
  return request(buildUrl("/api/user/profile", { id }), { method: "DELETE" });
}

export function getStoredUserProfile(id?: string | null) {
  return request(buildUrl("/api/user/profile", { id: id || "" }));
}

export function updateUserPlan(payload: {
  id: string;
  planType: string;
  planStatus?: string | null;
  planSyncedAt?: number | string | Date | null;
  planPeriodEnd?: number | string | Date | null;
}) {
  return request(buildUrl("/api/user/plan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStoredUserEntitlement(id?: string | null) {
  return request<StoredUserEntitlement>(
    buildUrl("/api/user/entitlement", { id: id || "" }),
  );
}

export function upsertUserEntitlement(
  payload: StoredUserEntitlementInput & { payload: SignedEntitlementPayload },
) {
  return request(buildUrl("/api/user/entitlement"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getGlobalAiSettings() {
  return request(buildUrl("/api/ai/settings"));
}

export type AiProviderCatalogEntry = { id: string; name: string; baseUrl?: string };

export function listAiProviderCatalog() {
  return request<AiProviderCatalogEntry[]>(buildUrl("/api/ai/providers"));
}

export async function getKeybindingsFile() {
  const fast = await tauriInvoke<{ data: Record<string, any>; filePath: string }>(
    "settings_get_keybindings",
  );
  if (fast !== undefined) {
    return { success: true, data: fast.data, filePath: fast.filePath } as ApiResult<
      Record<string, any>
    > & { filePath?: string };
  }
  const result = await request<Record<string, any>>(buildUrl("/api/keybindings"));
  return result as typeof result & { filePath?: string };
}

export async function saveKeybindingsFile(keybindings: Record<string, any>) {
  const applied = await tauriInvoke<boolean>("settings_save_keybindings", { keybindings });
  if (applied) return { success: true };
  return request(buildUrl("/api/keybindings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keybindings }),
  });
}

export async function saveGlobalAiSettings(settings: unknown) {
  const result = await request(buildUrl("/api/ai/settings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  if (result.success) {
    emitGlobalAiSettingsUpdated();
  }
  return result;
}

export function listAiChats(connectionId: number) {
  return request(buildUrl("/api/ai/chats", { connectionId }));
}

export function getAiChatMessages(chatId: string) {
  return request(
    buildUrl(`/api/ai/chats/${encodeURIComponent(chatId)}/messages`),
  );
}

export function deleteAiChat(chatId: string) {
  return request(buildUrl(`/api/ai/chats/${encodeURIComponent(chatId)}`), {
    method: "DELETE",
  });
}

export async function fetchSchemas(
  connectionString: string,
  connectionType?: string,
) {
  return request(buildUrl("/api/schema"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, connectionType }),
  });
}

export async function fetchTables(
  connectionString: string,
  schema: string,
  options: {
    forceRefresh?: boolean;
    cacheMaxAgeMs?: number;
    connectionType?: string;
  } = {},
) {
  return request(buildUrl("/api/tables"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, options }),
  });
}

export async function fetchTableStructure(
  connectionString: string,
  schema: string,
  table: string,
) {
  return request(buildUrl("/api/table-structure"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, table }),
  });
}

export async function fetchTableForeignKeys(
  connectionString: string,
  schema: string,
  table: string,
) {
  return request(buildUrl("/api/table-foreign-keys"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, table }),
  });
}

export async function fetchReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
) {
  return request(buildUrl("/api/referenced-record"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, table, keyValues }),
  });
}

const tablesWithColumnsCache = new Map<string, { ts: number; data: any[] }>();
const tablesWithColumnsInflight = new Map<string, Promise<ApiResult<any[]>>>();
const TABLES_WITH_COLUMNS_TTL_MS = 5000;

export function fetchAllTablesWithColumns(
  connectionString: string,
  options?: { forceRefresh?: boolean; cacheMaxAgeMs?: number; schema?: string },
) {
  const key = JSON.stringify({
    connectionString,
    schema: options?.schema || "",
    forceRefresh: Boolean(options?.forceRefresh),
  });

  if (!options?.forceRefresh) {
    const cached = tablesWithColumnsCache.get(key);
    if (cached && Date.now() - cached.ts < TABLES_WITH_COLUMNS_TTL_MS) {
      return Promise.resolve({
        success: true,
        data: cached.data,
        error: undefined,
      });
    }
    const inflight = tablesWithColumnsInflight.get(key);
    if (inflight) return inflight;
  }

  const requestPromise = request<any[]>(buildUrl("/api/tables-with-columns"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, options: options || {} }),
  })
    .then((res) => {
      if (res.success && Array.isArray(res.data)) {
        tablesWithColumnsCache.set(key, { ts: Date.now(), data: res.data });
      }
      tablesWithColumnsInflight.delete(key);
      return res;
    })
    .catch((err) => {
      tablesWithColumnsInflight.delete(key);
      throw err;
    });

  if (!options?.forceRefresh) {
    tablesWithColumnsInflight.set(key, requestPromise);
  }

  return requestPromise;
}

export async function fetchFunctions(connectionString: string, schema: string) {
  return request(buildUrl("/api/functions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema }),
  });
}

export function runQuery(
  connectionString: string,
  query: string,
  params: unknown[] = [],
  queryId?: string,
  connectionType?: string,
  executionContext?: QueryExecutionContext | null,
) {
  return request(buildUrl("/api/sql/run"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionString,
      query,
      params,
      queryId,
      connectionType,
      executionContext,
    }),
  });
}

export function getStudioFolders(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/folders`));
}

export function saveStudioFolders(connectionId: number, payload: any[]) {
  return request(buildUrl(`/studio/${connectionId}/folders`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStudioBootstrap(
  connectionId: number,
  requestedSchema?: string | null,
) {
  return request<StudioBootstrapResponse>(
    buildUrl(`/studio/${connectionId}/bootstrap`, { s: requestedSchema || "" }),
  );
}

export function getStudioSnippets(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/snippets`));
}

export function saveStudioSnippets(connectionId: number, payload: any[]) {
  return request(buildUrl(`/studio/${connectionId}/snippets`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getSnippetVersions(connectionId: number, snippetId: string) {
  return request(
    buildUrl(`/studio/${connectionId}/snippets/${snippetId}/versions`),
  );
}

export function createSnippetVersion(
  connectionId: number,
  snippetId: string,
  name: string,
  query: string,
) {
  return request(
    buildUrl(`/studio/${connectionId}/snippets/${snippetId}/versions`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query }),
    },
  );
}

export function restoreSnippetVersion(
  connectionId: number,
  snippetId: string,
  versionId: string,
) {
  return request(
    buildUrl(`/studio/${connectionId}/snippets/${snippetId}/versions`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", versionId }),
    },
  );
}

export function getStudioHistory(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/history`));
}

export function saveStudioHistory(connectionId: number, payload: any[]) {
  return request(buildUrl(`/studio/${connectionId}/history`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function insertHistoryEntry(
  connectionId: number,
  entry: HistoryEntry,
) {
  return request(buildUrl(`/studio/${connectionId}/history/entry`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export function clearStudioHistory(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/history`), {
    method: "DELETE",
  });
}

export function getStudioTags(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/tags`));
}

export function saveStudioTags(connectionId: number, payload: any[]) {
  return request(buildUrl(`/studio/${connectionId}/tags`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStudioTableTags(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/table-tags`));
}

export function saveStudioTableTags(
  connectionId: number,
  payload: Record<string, string[]>,
) {
  return request(buildUrl(`/studio/${connectionId}/table-tags`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStudioTabs(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/tabs`));
}

export function saveStudioTabs(connectionId: number, payload: any[]) {
  return request(buildUrl(`/studio/${connectionId}/tabs`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStudioSettings(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/settings`));
}

export function saveStudioSettings(
  connectionId: number,
  payload: Record<string, any>,
) {
  return request(buildUrl(`/studio/${connectionId}/settings`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStudioDashboards(connectionId: number) {
  return request(buildUrl(`/studio/${connectionId}/dashboards`));
}

export function saveStudioDashboards(
  connectionId: number,
  payload: { dashboards?: any[]; folders?: any[] },
) {
  return request(buildUrl(`/studio/${connectionId}/dashboards`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getAppFontFamily(): Promise<ApiResult<string>> {
  const fast = await tauriInvoke<string>("settings_get_app_font_family");
  if (fast !== undefined) return { success: true, data: fast };
  return request(buildUrl("/api/app-font"));
}

export async function saveAppFontFamily(fontFamily: string | null): Promise<ApiResult<never>> {
  const applied = await tauriInvoke<boolean>("settings_save_app_font_family", { fontFamily });
  if (applied) return { success: true };
  return request(buildUrl("/api/app-font"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fontFamily }),
  });
}

export async function getGlobalAppThemeSettings(): Promise<
  ApiResult<{ appThemeId: string; customAppThemes: string }>
> {
  const fast = await tauriInvoke<{ appThemeId: string; customAppThemes: string }>(
    "settings_get_app_theme",
  );
  if (fast !== undefined) return { success: true, data: fast };
  return request(buildUrl("/api/app-theme"));
}

export async function saveGlobalAppThemeSettings(settings: {
  appThemeId: string;
  customAppThemes: string;
}): Promise<ApiResult<never>> {
  const applied = await tauriInvoke<boolean>("settings_save_app_theme", {
    appThemeId: settings.appThemeId,
    customAppThemes: settings.customAppThemes,
  });
  if (applied) return { success: true };
  return request(buildUrl("/api/app-theme"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getGlobalEditorThemeSettings(): Promise<
  ApiResult<{ editorThemeId: string; customEditorThemes: string }>
> {
  const fast = await tauriInvoke<{ editorThemeId: string; customEditorThemes: string }>(
    "settings_get_editor_theme",
  );
  if (fast !== undefined) return { success: true, data: fast };
  return request(buildUrl("/api/editor-theme"));
}

export async function saveGlobalEditorThemeSettings(settings: {
  editorThemeId: string;
  customEditorThemes: string;
}): Promise<ApiResult<never>> {
  const applied = await tauriInvoke<boolean>("settings_save_editor_theme", {
    editorThemeId: settings.editorThemeId,
    customEditorThemes: settings.customEditorThemes,
  });
  if (applied) return { success: true };
  return request(buildUrl("/api/editor-theme"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getGlobalStudioSettings(): Promise<ApiResult<Record<string, any>>> {
  const fast = await tauriInvoke<Record<string, any>>("settings_get_studio_settings");
  if (fast !== undefined) return { success: true, data: fast };
  return request(buildUrl("/api/studio-settings"));
}

export async function saveGlobalStudioSettings(
  settings: Record<string, any>,
): Promise<ApiResult<never>> {
  const applied = await tauriInvoke<boolean>("settings_save_studio_settings", { settings });
  if (applied) return { success: true };
  return request(buildUrl("/api/studio-settings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function getSettingsMigrationStatus() {
  return request<{ migrationNeeded: boolean }>(
    buildUrl("/api/settings/migration-status"),
  );
}

export function triggerSettingsMigration() {
  return request<{
    total: number;
    completed: number;
    currentStep: string;
    done: boolean;
    error?: string;
  }>(buildUrl("/api/settings/migrate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export function clearMigratedSqliteSettings() {
  return request(buildUrl("/api/settings/clear-migrated"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function fetchViews(
  connectionString: string,
  schema: string,
  connectionType?: string,
) {
  return request(buildUrl("/api/views"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, connectionType }),
  });
}

export function comparePostgresSchemas(
  sourceConnectionString: string,
  targetConnectionString: string,
) {
  return callAction("comparePostgresSchemas", [
    sourceConnectionString,
    targetConnectionString,
  ]);
}

export function applyPostgresSchemaToTarget(
  sourceConnectionString: string,
  targetConnectionString: string,
) {
  return callAction("applyPostgresSchemaToTarget", [
    sourceConnectionString,
    targetConnectionString,
  ]);
}

export async function fetchDatabases(
  connectionString: string,
  connectionType?: string,
) {
  return request(buildUrl("/api/databases"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, connectionType }),
  });
}

export function fetchRedisKeys(
  connectionString: string,
  options?: { pattern?: string; limit?: number; db?: string },
) {
  return callAction("fetchRedisKeys", [connectionString, options ?? {}]);
}

export function updateTableRows(
  connectionString: string,
  schema: string,
  table: string,
  rows: any[],
) {
  return callAction("updateTableRows", [connectionString, schema, table, rows]);
}

export function deleteTableRows(
  connectionString: string,
  schema: string,
  table: string,
  rows: any[],
) {
  return callAction("deleteTableRows", [connectionString, schema, table, rows]);
}

export function createSchema(connectionString: string, schema: string) {
  return callAction("createSchema", [connectionString, schema]);
}

export function createDatabase(connectionString: string, database: string) {
  return callAction("createDatabase", [connectionString, database]);
}

export async function fetchExtensions(connectionString: string) {
  return request(buildUrl("/api/extensions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function toggleExtension(
  connectionString: string,
  extension: string,
  enabled: boolean,
) {
  return callAction("toggleExtension", [connectionString, extension, enabled]);
}

export async function fetchTriggers(connectionString: string, schema?: string) {
  return request(buildUrl("/api/triggers"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema }),
  });
}

export async function fetchEnums(connectionString: string) {
  return request(buildUrl("/api/enums"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function createEnum(
  connectionString: string,
  schema: string,
  name: string,
  values: string[],
) {
  return callAction("createEnum", [connectionString, schema, name, values]);
}

export function deleteEnum(connectionString: string, schema: string, name: string) {
  return callAction("deleteEnum", [connectionString, schema, name]);
}

export async function fetchIndexes(connectionString: string, schema?: string) {
  return request(buildUrl("/api/indexes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema }),
  });
}

export function deleteIndex(
  connectionString: string,
  schema: string,
  name: string,
) {
  return callAction("deleteIndex", [connectionString, schema, name]);
}

export function createIndex(
  connectionString: string,
  schema: string,
  table: string,
  name: string,
  columns: string[],
  unique: boolean,
  method: string,
) {
  return callAction("createIndex", [
    connectionString,
    schema,
    table,
    name,
    columns,
    unique,
    method,
  ]);
}

export function createTrigger(
  connectionString: string,
  schema: string,
  table: string,
  name: string,
  events: string[],
  timing: string,
  orientation: string,
  functionName: string,
) {
  return callAction("createTrigger", [
    connectionString,
    schema,
    table,
    name,
    events,
    timing,
    orientation,
    functionName,
  ]);
}

export function createSnapshot(
  connectionString: string,
  name: string,
  description: string,
  connectionId: string,
) {
  return callAction("createSnapshot", [
    connectionString,
    name,
    description,
    connectionId,
  ]);
}

export function listSnapshots(connectionId: string) {
  return callAction("listSnapshots", [connectionId]);
}

export function getSnapshot(connectionId: string, snapshotId: string) {
  return callAction("getSnapshot", [connectionId, snapshotId]);
}

export function getSnapshotFull(connectionId: string, snapshotId: string) {
  return callAction("getSnapshotFull", [connectionId, snapshotId]);
}

export function deleteSnapshot(connectionId: string, snapshotId: string) {
  return callAction("deleteSnapshot", [connectionId, snapshotId]);
}

export function compareSnapshots(
  connectionId: string,
  olderId: string,
  newerId: string,
) {
  return callAction("compareSnapshots", [connectionId, olderId, newerId]);
}

export function exportDatabaseBundle(
  connectionString: string,
  format: "sql" | "json" | "csv",
) {
  return callAction("exportDatabaseBundle", [connectionString, format]);
}

export function importDatabaseBundle(
  connectionString: string,
  format: "sql" | "json" | "csv",
  bundle: string,
) {
  return callAction("importDatabaseBundle", [connectionString, format, bundle]);
}

export async function fetchRlsPolicies(
  connectionString: string,
  schema?: string | null,
  table?: string | null,
) {
  return request(buildUrl("/api/rls-policies"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionString,
      schema: schema ?? null,
      table: table ?? null,
    }),
  });
}

export async function fetchPostgresRoles(connectionString: string) {
  return request(buildUrl("/api/postgres-roles"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function fetchSupabaseAuthUsers(connectionString: string) {
  return request(buildUrl("/api/supabase-auth-users"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export async function fetchTableSecurityInfo(
  connectionString: string,
  schema: string,
) {
  return request(buildUrl("/api/table-security-info"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema }),
  });
}

export async function getCachedSchemasSnapshot(
  connectionString: string,
): Promise<string[]> {
  const res = await callAction<string[]>("getCachedSchemasSnapshot", [
    connectionString,
  ]);
  return res.success && Array.isArray(res.data) ? res.data : [];
}

export async function getCachedTablesSnapshot(
  connectionString: string,
  schema: string,
): Promise<string[]> {
  const res = await callAction<string[]>("getCachedTablesSnapshot", [
    connectionString,
    schema,
  ]);
  return res.success && Array.isArray(res.data) ? res.data : [];
}

export type SearchAllResult = {
  table_schema: string;
  table_name: string;
  column_name: string;
  value: string;
  row: Record<string, unknown>;
};

export async function searchAllTables(
  connectionString: string,
  searchTerm: string,
  options?: { schema?: string; connectionType?: string },
): Promise<ApiResult<SearchAllResult[]>> {
  return request<SearchAllResult[]>(buildUrl("/api/tables/search-all"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionString,
      searchTerm,
      schema: options?.schema,
      connectionType: options?.connectionType,
    }),
  });
}

export function getTableColumnVisibility(
  connectionId: number,
  schema: string,
  table: string,
) {
  return request<string[]>(buildUrl("/api/table-column-visibility"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, schema, table }),
  });
}

export function saveTableColumnVisibility(
  connectionId: number,
  schema: string,
  table: string,
  hiddenColumns: string[],
) {
  return request(buildUrl("/api/table-column-visibility"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, schema, table, hiddenColumns }),
  });
}

export function getTablePagination(
  connectionId: number,
  schema: string,
  table: string,
) {
  return request<{ pageSize: number } | null>(
    buildUrl("/api/table-pagination"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, schema, table }),
    },
  );
}

export function saveTablePagination(
  connectionId: number,
  schema: string,
  table: string,
  pageSize: number,
) {
  return request(buildUrl("/api/table-pagination"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, schema, table, pageSize }),
  });
}

export function searchLocalIndex(connectionString: string, term: string) {
  return request(buildUrl("/api/search-index/query"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, term }),
  });
}

export function saveSearchResultsToIndex(
  connectionString: string,
  results: SearchAllResult[],
) {
  return request(buildUrl("/api/search-index/save"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, results }),
  });
}

export function clearSearchIndex(connectionString: string) {
  return request(buildUrl("/api/search-index/clear"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function getSearchIndexStatus(connectionString: string) {
  return request<{ lastIndexedAt: number | null; totalEntries: number } | null>(
    buildUrl("/api/search-index/status"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionString }),
    },
  );
}

export function fetchSessions(connectionString: string) {
  return request(buildUrl("/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function killSession(connectionString: string, pid: number) {
  return request(buildUrl("/api/sessions/kill"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, pid }),
  });
}

export function cancelSessionQuery(connectionString: string, pid: number) {
  return request(buildUrl("/api/sessions/cancel-query"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, pid }),
  });
}

export function fetchLocks(connectionString: string) {
  return request(buildUrl("/api/locks"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function fetchExplainPlan(connectionString: string, query: string) {
  return request(buildUrl("/api/explain-plan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, query }),
  });
}

export function runAdvisorChecks(connectionString: string) {
  return request(buildUrl("/api/db-advisor"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString }),
  });
}

export function runDbBackup(
  connectionString: string,
  options: {
    format?: string;
    schema?: string;
    table?: string;
    dataOnly?: boolean;
    schemaOnly?: boolean;
    compress?: number;
    outputPath?: string;
  } = {}
) {
  return request(buildUrl("/api/backup/run"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, options }),
  });
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export function listWorkflows(connectionId: number) {
  return request<any[]>(buildUrl("/api/workflows", { connectionId }));
}

export function createWorkflow(payload: {
  name: string;
  connectionId: number;
  description?: string;
  nodes?: unknown[];
  edges?: unknown[];
  scheduleEnabled?: boolean;
  scheduleType?: "cron" | "datetime" | null;
  scheduleValue?: string | null;
}) {
  return request(buildUrl("/api/workflows"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getWorkflow(id: string) {
  return request<any>(buildUrl(`/api/workflows/${id}`));
}

export function updateWorkflow(
  id: string,
  payload: {
    name?: string;
    description?: string;
    nodes?: unknown[];
    edges?: unknown[];
    scheduleEnabled?: boolean;
    scheduleType?: "cron" | "datetime" | null;
    scheduleValue?: string | null;
  },
) {
  return request(buildUrl(`/api/workflows/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteWorkflow(id: string) {
  return request(buildUrl(`/api/workflows/${id}`), { method: "DELETE" });
}

export type WorkflowRunProgressEvent =
  | { type: "node-start"; nodeId: string }
  | { type: "node-done"; nodeId: string; output: unknown; error?: string; durationMs: number; skipped?: boolean };

// The run endpoint streams node-start/node-done events over SSE as the workflow
// executes (so the canvas can highlight nodes one at a time, in real order)
// and finishes with a run-complete event carrying the same summary a plain
// JSON response would have had.
export async function runWorkflow(
  id: string,
  initialData?: unknown,
  onProgress?: (event: WorkflowRunProgressEvent) => void,
  live?: { nodes: unknown[]; edges: unknown[] },
): Promise<ApiResult<{ runId: string; status: string; outputs: any[]; error?: string }>> {
  const apiUrl = resolveApiUrl(buildUrl(`/api/workflows/${id}/run`));

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual", initialData, nodes: live?.nodes, edges: live?.edges }),
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Request failed" };
  }

  if (!response.body) {
    const body = await response.json().catch(() => null);
    return (body as ApiResult<any>) ?? { success: false, error: "Empty response." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      let event: any;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === "run-complete") {
        final = event;
      } else {
        onProgress?.(event);
      }
    }
  }

  if (!final) return { success: false, error: "Workflow run did not complete" };
  return {
    success: final.status !== "error",
    data: { runId: final.runId, status: final.status, outputs: final.outputs, error: final.error },
    error: final.error,
  };
}

export function listWorkflowRuns(id: string, limit = 20) {
  return request<any[]>(buildUrl(`/api/workflows/${id}/runs`, { limit }));
}

