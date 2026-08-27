import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "@/tools/types";
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
import { parseAppThemeJson, BUILTIN_APP_THEMES, type CustomAppTheme } from "@/lib/studio/app-themes";
import { parseThemeJson, createThemeId, type CustomEditorTheme } from "@/lib/studio/editor-themes";
import {
  getGlobalAppThemeSettings,
  saveGlobalAppThemeSettings,
  getGlobalEditorThemeSettings,
  saveGlobalEditorThemeSettings,
} from "@/lib/db/actions";

export type PiToolContext = {
  connectionString: string;
  defaultNamespace?: string;
  permissionMode?: "schema_only" | "schema_with_data";
  dashboardContext?: LightDashboardContext[];
  emitStep: (message: string) => void;
};

function textResult(data: unknown): AgentToolResult<unknown> {
  const text = JSON.stringify(data ?? null);
  return { content: [{ type: "text", text }], details: (data as JsonValue) ?? null };
}

function failTool(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  throw new Error(message);
}

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

const APP_COLOR_KEYS_DESCRIPTION = [
  "YOU MUST INCLUDE ALL of the following CSS variables. Use this as a complete template:",
  "{",
  '  "--background": "<page bg>",',
  '  "--foreground": "<body text>",',
  '  "--card": "<card bg>",',
  '  "--card-foreground": "<card text>",',
  '  "--popover": "<popover bg>",',
  '  "--popover-foreground": "<popover text>",',
  '  "--primary": "<accent color>",',
  '  "--primary-foreground": "<text on primary>",',
  '  "--secondary": "<secondary bg>",',
  '  "--secondary-foreground": "<text on secondary>",',
  '  "--muted": "<muted bg>",',
  '  "--muted-foreground": "<muted text>",',
  '  "--accent": "<accent bg>",',
  '  "--accent-foreground": "<text on accent>",',
  '  "--destructive": "<danger color>",',
  '  "--border": "<dividers>",',
  '  "--input": "<input bg>",',
  '  "--ring": "<focus ring>",',
  '  "--chart-1": "<chart color>",',
  '  "--chart-2": "<chart color>",',
  '  "--chart-3": "<chart color>",',
  '  "--chart-4": "<chart color>",',
  '  "--sidebar": "<sidebar bg>",',
  '  "--sidebar-foreground": "<sidebar text>",',
  '  "--sidebar-primary": "<sidebar accent>",',
  '  "--sidebar-primary-foreground": "<text>",',
  '  "--sidebar-accent": "<sidebar hover>",',
  '  "--sidebar-accent-foreground": "<text>",',
  '  "--sidebar-border": "<dividers>",',
  '  "--sidebar-ring": "<focus ring>",',
  '  "--studio-bg": "<editor bg>",',
  '  "--studio-border": "<editor borders>",',
  '  "--studio-header-bg": "<header bg>",',
  '  "--table-header-bg": "<header bg>",',
  '  "--studio-cell-text": "<cell text>",',
  '  "--studio-cell-muted": "<muted cell text>",',
  '  "--studio-tab-active": "<active tab>",',
  '  "--studio-tab-inactive": "<inactive tab>",',
  '  "--studio-row-hover": "<row hover>",',
  '  "--studio-selection": "<selection (use rgba)>",',
  '  "--studio-accent-purple": "<purple accent>"',
  "}",
  "FAILING TO INCLUDE ALL OF THESE WILL RESULT IN AN INCOMPLETE THEME.",
].join("\n");

function readArrayFromDb<T>(data: unknown, key: string, validator: (item: unknown) => item is T): T[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>)[key];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t: unknown): t is T => validator(t));
  } catch {
    return [];
  }
}

function readAppThemesFromDb(data: unknown): CustomAppTheme[] {
  return readArrayFromDb(data, "customAppThemes", (t): t is CustomAppTheme =>
    !!t && typeof (t as CustomAppTheme).id === "string" &&
    typeof (t as CustomAppTheme).name === "string" &&
    typeof (t as CustomAppTheme).colors === "object",
  );
}

function readEditorThemesFromDb(data: unknown): CustomEditorTheme[] {
  return readArrayFromDb(data, "customEditorThemes", (t): t is CustomEditorTheme =>
    !!t && typeof (t as CustomEditorTheme).id === "string" &&
    typeof (t as CustomEditorTheme).name === "string" &&
    typeof (t as CustomEditorTheme).themeJson === "string",
  );
}

function resolveExistingAppThemeIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  for (const t of BUILTIN_APP_THEMES) ids.add(t.id);
  for (const t of readAppThemesFromDb(data)) ids.add(t.id);
  return ids;
}

function resolveExistingEditorThemeIds(data: unknown): Set<string> {
  return new Set(readEditorThemesFromDb(data).map((t) => t.id));
}

export function createPiDbTools(context: PiToolContext): ToolDefinition[] {
  const dbType = detectConnectionDbType(context.connectionString);
  const isSchemaOnly = context.permissionMode === "schema_only";
  const dashboardContext = Array.isArray(context.dashboardContext) ? context.dashboardContext : [];
  const namespace = (value?: string) => value || context.defaultNamespace || "";

  const tools: ToolDefinition[] = [
    defineTool({
      name: "describe_connection_capabilities",
      label: "Describe connection capabilities",
      description: "Describe which read-only capabilities are available for the current backend.",
      promptSnippet: "describe_connection_capabilities - check which read-only operations the current database supports",
      parameters: Type.Object({}),
      execute: async () => textResult({ dbType, capabilities: getDbCapabilities(dbType) }),
    }),
    defineTool({
      name: "list_namespaces",
      label: "List namespaces",
      description: "List databases or schemas available on the current connection.",
      promptSnippet: "list_namespaces - list databases or schemas on the current connection",
      parameters: Type.Object({}),
      execute: async () => {
        context.emitStep("Inspecting namespaces");
        try {
          if (dbType === "mongodb" || dbType === "redis") {
            const result = await fetchDatabases(context.connectionString);
            if (!result.success) failTool(result.error);
            return textResult({ namespaces: result.data || [] });
          }
          const result = await fetchSchemas(context.connectionString);
          if (!result.success) failTool(result.error);
          return textResult({ namespaces: result.data || [] });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "list_tables",
      label: "List tables",
      description: "List tables or collections for a namespace.",
      promptSnippet: "list_tables - list tables or collections, optionally scoped to a namespace",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Database or schema name" })),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep("Listing tables");
        try {
          if (dbType === "mongodb") {
            const collections = await getMongoCollections(context.connectionString, params.namespace || getMongoDatabaseFromConnectionString(context.connectionString));
            return textResult({ tables: collections.map((name) => ({ schema: params.namespace || getMongoDatabaseFromConnectionString(context.connectionString), name })) });
          }
          if (dbType === "redis") {
            const keys = await fetchRedisKeys(context.connectionString, { db: params.namespace, limit: 100 });
            if (!keys.success) failTool(keys.error);
            return textResult({ tables: (keys.data || []).map((item: any) => ({ schema: params.namespace || "0", name: item.key, type: item.type })) });
          }
          const result = await fetchTables(context.connectionString, namespace(params.namespace));
          if (!result.success) failTool(result.error);
          return textResult({ tables: result.data || [] });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "list_dashboards",
      label: "List dashboards",
      description: "List dashboards available in the current studio session, including their reference tokens.",
      promptSnippet: "list_dashboards - list dashboards available in the current studio session",
      parameters: Type.Object({}),
      execute: async () => {
        context.emitStep("Listing dashboards");
        return textResult({
          dashboards: dashboardContext.map((dashboard) => ({
            id: dashboard.id,
            ref: dashboard.ref,
            name: dashboard.name,
            widgetCount: dashboard.widgets.length,
          })),
        });
      },
    }),
    defineTool({
      name: "get_dashboard_definition",
      label: "Get dashboard definition",
      description: "Get the current widget layout and queries for a dashboard reference like dashboard.some-name-ab12cd.",
      promptSnippet: "get_dashboard_definition - inspect a dashboard's widget layout and queries by reference",
      parameters: Type.Object({
        ref: Type.String({ description: "Dashboard reference token" }),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Inspecting dashboard ${params.ref}`);
        const match = resolveDashboardRef(params.ref, dashboardContext);
        if (!match) {
          failTool(`Dashboard reference "${params.ref}" was not found.`);
        }
        return textResult({ dashboard: match });
      },
    }),
    defineTool({
      name: "get_table_schema",
      label: "Get table schema",
      description: "Get columns and field details for a table or collection.",
      promptSnippet: "get_table_schema - inspect columns and field details for a table or collection",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Database or schema name" })),
        table: Type.String({ description: "Table or collection name" }),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Inspecting schema for ${params.table}`);
        try {
          if (dbType === "redis") {
            failTool("Redis does not expose table schemas.");
          }
          let schema = namespace(params.namespace);
          if (dbType === "sqlite" && !schema) schema = "main";
          const result = await fetchTableStructure(context.connectionString, schema, params.table);
          if (!result.success) failTool(result.error);
          return textResult({ table: params.table, structure: result.data || [] });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "get_related_tables",
      label: "Get related tables",
      description: "Get foreign-key style relationships for a table when the backend supports it.",
      promptSnippet: "get_related_tables - inspect foreign-key style relationships for a table",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Database or schema name" })),
        table: Type.String({ description: "Table name" }),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Checking related tables for ${params.table}`);
        try {
          const capabilities = getDbCapabilities(dbType);
          if (!capabilities.supportsRelatedTables) {
            failTool(`Related table inspection is not supported for ${dbType}.`);
          }
          const result = await fetchTableForeignKeys(context.connectionString, namespace(params.namespace), params.table);
          if (!result.success) failTool(result.error);
          return textResult({ table: params.table, relationships: result.data || [] });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "sample_rows",
      label: "Sample rows",
      description: "Fetch a small read-only sample from a table or collection.",
      promptSnippet: "sample_rows - fetch a small read-only sample from a table or collection",
      parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Database or schema name" })),
        table: Type.String({ description: "Table or collection name" }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum number of rows (default 20)" })),
      }),
      execute: async (toolCallId, params) => {
        const limit = params.limit ?? 20;
        context.emitStep(`Sampling rows from ${params.table}`);
        try {
          if (isSchemaOnly) {
            failTool("This chat is limited to schema-only access.");
          }
          if (dbType === "mongodb") {
            const result = await executeMongoQuery(
              context.connectionString,
              JSON.stringify({
                database: params.namespace || getMongoDatabaseFromConnectionString(context.connectionString),
                collection: params.table,
                operation: "find",
                limit,
              }),
            );
            return textResult({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          if (dbType === "redis") {
            const keys = await fetchRedisKeys(context.connectionString, { db: params.namespace, pattern: `${params.table}*`, limit });
            if (!keys.success) failTool(keys.error);
            return textResult({ rows: keys.data || [], rowCount: (keys.data || []).length });
          }
          const result = await runQuery(context.connectionString, buildSampleQuery(dbType, namespace(params.namespace), params.table, limit));
          if (!result.success) failTool(result.error);
          return textResult(result.data || {});
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "run_readonly_query",
      label: "Run read-only query",
      description: "Execute a read-only query against the current connection.",
      promptSnippet: "run_readonly_query - execute a read-only SQL query, Mongo JSON query, or Redis command",
      parameters: Type.Object({
        query: Type.String({ description: "The read-only query to execute" }),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep("Running a read-only query");
        try {
          if (isSchemaOnly) {
            failTool("This chat is limited to schema-only access.");
          }
          if (dbType === "mongodb") {
            const result = await executeMongoQuery(context.connectionString, params.query);
            return textResult({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          if (dbType === "redis") {
            const parts = String(params.query || "").trim().split(/\s+/);
            const command = parts[0]?.toUpperCase() || "";
            if (!["GET", "MGET", "HGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL", "PTTL", "EXISTS", "KEYS", "SCAN", "PING"].includes(command)) {
              failTool("Only read-only Redis commands are allowed.");
            }
            const result = await executeRedisCommand(context.connectionString, params.query);
            return textResult({ columns: result.fields, rows: result.rows, rowCount: result.rowCount });
          }
          ensureReadOnlySql(params.query);
          const result = await runQuery(context.connectionString, params.query);
          if (!result.success) failTool(result.error);
          return textResult(result.data || {});
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "search_schema",
      label: "Search schema",
      description: "Fuzzy-search tables and columns by keyword.",
      promptSnippet: "search_schema - fuzzy-search tables and columns by keyword",
      parameters: Type.Object({
        query: Type.String({ description: "Search keyword" }),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Searching schema for "${params.query}"`);
        try {
          const needle = String(params.query || "").trim().toLowerCase();
          if (!needle) return textResult({ matches: [] });
          const result = await fetchAllTablesWithColumns(context.connectionString);
          if (!result.success || !Array.isArray(result.data)) {
            failTool(result.error || "Failed to inspect schema.");
          }
          const matches = result.data
            .filter((row: any) =>
              String(row.table_name || "").toLowerCase().includes(needle)
              || String(row.column_name || "").toLowerCase().includes(needle)
              || String(row.table_schema || "").toLowerCase().includes(needle))
            .slice(0, 60);
          return textResult({ matches });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "create_app_theme",
      label: "Create app theme",
      description:
        "Create and persist a custom app theme. Use this when the user asks you to create a new visual color theme for the app. " +
        "Generate appropriate colors based on the user's description, then call this tool to save them.",
      promptSnippet: "create_app_theme - create and persist a custom app color theme",
      parameters: Type.Object({
        name: Type.String({ minLength: 1, description: "Display name for the theme (e.g. 'Ocean Deep', 'Royal Purple')" }),
        base: Type.Enum({ light: "light", dark: "dark" }, { description: "Base color scheme" }),
        colors: Type.Record(Type.String(), Type.String(), { description: APP_COLOR_KEYS_DESCRIPTION }),
      }),
      execute: async (toolCallId, params) => {
        try {
          const validateJson = JSON.stringify({ name: params.name, base: params.base, colors: params.colors });
          const validated = parseAppThemeJson(validateJson);
          if (validated.error || !validated.theme) {
            failTool(validated.error || "Invalid theme definition.");
          }

          const existingResult = await getGlobalAppThemeSettings();
          if (!existingResult.success) {
            failTool(existingResult.error || "Failed to read existing themes.");
          }

          const existingIds = resolveExistingAppThemeIds(existingResult.data);
          const id = createThemeId(params.name, existingIds);

          const theme: CustomAppTheme = {
            id,
            name: validated.theme.name,
            base: validated.theme.base,
            colors: validated.theme.colors,
          };

          const existingThemes = readAppThemesFromDb(existingResult.data);
          const updatedThemes = [theme, ...existingThemes];

          const saveResult = await saveGlobalAppThemeSettings({
            appThemeId: id,
            customAppThemes: JSON.stringify(updatedThemes),
          });

          if (!saveResult.success) {
            failTool(saveResult.error || "Failed to save theme.");
          }

          return textResult({
            id: theme.id,
            name: theme.name,
            base: theme.base,
            colors: theme.colors,
            variableCount: Object.keys(theme.colors).length,
          });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "create_editor_theme",
      label: "Create editor theme",
      description:
        "Create and persist a custom editor (Monaco/VS Code) theme. " +
        "Use when the user wants a custom syntax highlighting theme for the SQL editor.",
      promptSnippet: "create_editor_theme - create and persist a custom editor (Monaco/VS Code) theme",
      parameters: Type.Object({
        name: Type.String({ minLength: 1, description: "Display name for the editor theme" }),
        themeJson: Type.String({ description: "VS Code or Monaco theme JSON" }),
      }),
      execute: async (toolCallId, params) => {
        try {
          const parsed = parseThemeJson(params.themeJson);
          if (parsed.error) {
            failTool(parsed.error);
          }

          const existingResult = await getGlobalEditorThemeSettings();
          if (!existingResult.success) {
            failTool(existingResult.error || "Failed to read existing editor themes.");
          }

          const existingIds = resolveExistingEditorThemeIds(existingResult.data);
          const id = createThemeId(params.name || parsed.name || params.name, existingIds);

          const theme: CustomEditorTheme = {
            id,
            name: parsed.name || params.name,
            themeJson: params.themeJson,
          };

          const existingThemes = readEditorThemesFromDb(existingResult.data);
          const updatedThemes = [theme, ...existingThemes];

          const saveResult = await saveGlobalEditorThemeSettings({
            editorThemeId: id,
            customEditorThemes: JSON.stringify(updatedThemes),
          });

          if (!saveResult.success) {
            failTool(saveResult.error || "Failed to save editor theme.");
          }

          return textResult({
            id: theme.id,
            name: theme.name,
            base: parsed.theme?.base || "vs-dark",
            ruleCount: (parsed.theme?.rules || []).length,
            colorCount: Object.keys(parsed.theme?.colors || {}).length,
          });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "list_themes",
      label: "List themes",
      description: "List all available app themes and editor themes, both built-in and user-created.",
      promptSnippet: "list_themes - list available app and editor themes",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const [appResult, editorResult] = await Promise.all([
            getGlobalAppThemeSettings(),
            getGlobalEditorThemeSettings(),
          ]);

          const builtinApps = BUILTIN_APP_THEMES.map((t) => ({
            id: t.id, name: t.name, base: t.base, builtin: true,
          }));
          const customApps = readAppThemesFromDb(appResult.data).map((t) => ({
            id: t.id, name: t.name, base: t.base, builtin: false,
          }));
          const customEditors = readEditorThemesFromDb(editorResult.data).map((t) => ({
            id: t.id, name: t.name, builtin: false,
          }));

          return textResult({
            appThemeId: appResult.success ? (appResult.data as Record<string, unknown>)?.appThemeId || "zinc-dark-white" : "zinc-dark-white",
            editorThemeId: editorResult.success ? (editorResult.data as Record<string, unknown>)?.editorThemeId || "auto" : "auto",
            appThemes: [...builtinApps, ...customApps],
            editorThemes: customEditors,
          });
        } catch (error) {
          failTool(error);
        }
      },
    }),
    defineTool({
      name: "create_tasks",
      label: "Create tasks",
      description: "Create a list of tasks to track multi-step work. Each task has a label, optional amount, status, and details. Tasks are shown with the TaskRows UI.",
      promptSnippet: "create_tasks - create tasks for multi-step work, e.g. create_tasks({tasks:[{label:'Verified vendor records', amount:'12 suppliers', status:'completed'}]})",
      parameters: Type.Object({
        tasks: Type.Array(
          Type.Object({
            label: Type.String({ description: "Task title, e.g. 'Verified vendor records'" }),
            amount: Type.Optional(Type.String({ description: "Amount, e.g. '12 suppliers'" })),
            status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("failed")])),
            details: Type.Optional(
              Type.Array(
                Type.Object({
                  label: Type.String(),
                  meta: Type.Optional(Type.String()),
                }),
              ),
            ),
          }),
        ),
        variant: Type.Optional(Type.Union([Type.Literal("Capsules"), Type.Literal("List")])),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Creating ${params.tasks.length} tasks`);
        const normalized = params.tasks.map((t: any, i: number) => ({
          id: `task-${Date.now()}-${i}`,
          label: t.label,
          amount: t.amount,
          status: t.status || "pending",
          details: t.details,
          createdAt: Date.now(),
        }));
        return textResult({ tasks: normalized, variant: params.variant || "Capsules", message: `Created ${normalized.length} tasks` });
      },
    }),
    defineTool({
      name: "update_task",
      label: "Update task",
      description: "Update a task's status or details.",
      promptSnippet: "update_task - update a task, e.g. update_task({taskId:'task-123', status:'completed'})",
      parameters: Type.Object({
        taskId: Type.String({ description: "ID of the task to update" }),
        status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("failed")])),
        label: Type.Optional(Type.String()),
        amount: Type.Optional(Type.String()),
        details: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String(),
              meta: Type.Optional(Type.String()),
            }),
          ),
        ),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Updating task ${params.taskId} → ${params.status || "details"}`);
        return textResult({ taskId: params.taskId, status: params.status, message: `Updated task ${params.taskId}` });
      },
    }),
    defineTool({
      name: "ask_questions",
      label: "Ask questions",
      description: "Ask the user one or more questions that require human input. The UI shows an approval card with radio/check options and a custom input. Use for clarifications, choices, or confirmations. This tool will wait for the user's answer and return it.",
      promptSnippet: "ask_questions - ask the user questions, e.g. ask_questions({questions:[{q:'How many flavors?', type:'radio', options:['Three','Five']}]})",
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            q: Type.String({ description: "Question text" }),
            type: Type.Union([Type.Literal("radio"), Type.Literal("check")], { description: "radio for single-choice, check for multi-select" }),
            options: Type.Array(Type.String(), { minItems: 1, maxItems: 6 }),
          }),
          { minItems: 1, maxItems: 5 },
        ),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Asking ${params.questions.length} question(s) — waiting for user`);
        const { createPendingApproval } = await import("@/lib/ai/pending-approvals");
        // Use toolCallId as the key so the client can resolve the correct pending approval
        const answers = await createPendingApproval(toolCallId, params.questions);
        return textResult({ answers, message: "User provided answers", questions: params.questions });
      },
    }),
    defineTool({
      name: "ask_approval",
      label: "Ask approval",
      description: "Ask for approval on a single decision (shorthand for ask_questions with one radio question). This tool will wait for the user's answer.",
      promptSnippet: "ask_approval - ask for approval, e.g. ask_approval({question:'Proceed?', options:['Yes','No']})",
      parameters: Type.Object({
        question: Type.String({ description: "Question text" }),
        options: Type.Array(Type.String(), { minItems: 1, maxItems: 6 }),
        type: Type.Optional(Type.Union([Type.Literal("radio"), Type.Literal("check")])),
      }),
      execute: async (toolCallId, params) => {
        context.emitStep(`Asking for approval: ${params.question} — waiting for user`);
        const { createPendingApproval } = await import("@/lib/ai/pending-approvals");
        const questions = [{ q: params.question, type: params.type || "radio", options: params.options }];
        const answers = await createPendingApproval(toolCallId, questions);
        return textResult({ answers, questions, message: "User provided answer" });
      },
    }),
  ];

  return tools;
}