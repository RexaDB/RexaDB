import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";

export const connectionGroups = sqliteTable("connection_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  connectionString: text("connection_string").notNull(),
  connectionType: text("connection_type"),
  host: text("host"),
  port: text("port"),
  database: text("database"),
  username: text("username"),
  password: text("password"),
  sslMode: text("ssl_mode"),
  authToken: text("auth_token"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  sortOrder: integer("sort_order"),
  environment: text("environment"),
  color: text("color"),
  group: text("group"),
  isFavorite: integer("is_favorite", { mode: "boolean" }).default(false),
  lastActive: integer("last_active", { mode: "timestamp" }),
});

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const snippets = sqliteTable("snippets", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: integer("created_at").notNull(),
  isShared: integer("is_shared", { mode: "boolean" }).default(false),
  sharedEntryId: text("shared_entry_id"),
});

export const queryHistory = sqliteTable("query_history", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  executedAt: integer("executed_at").notNull(),
  duration: integer("duration").notNull(),
  status: text("status").$type<"success" | "error">().notNull(),
  error: text("error"),
  rowsCount: integer("rows_count"),
  caller: text("caller").$type<"user" | "system">().notNull(),
  executedBy: text("executed_by"),
  executedByName: text("executed_by_name"),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const tableTags = sqliteTable("table_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(), // format: "schema.table"
  tagName: text("tag_name").notNull(),
});

export const openTabs = sqliteTable("open_tabs", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  schema: text("schema"),
  query: text("query"),
  order: integer("order").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).default(false),
});

export const connectionSettings = sqliteTable("connection_settings", {
  connectionId: integer("connection_id").primaryKey().references(() => connections.id, { onDelete: "cascade" }),
  activeTabId: text("active_tab_id"),
  sidebarSortMode: text("sidebar_sort_mode").$type<"alphabetical" | "tags">().default("alphabetical"),
  sidebarView: text("sidebar_view").$type<"tables" | "sql" | "database" | "dashboard" | "import-export" | "auth" | "themes">().default("tables"),
  sidebarBehavior: text("sidebar_behavior").$type<SidebarBehavior>().default("expandable"),
  keybindings: text("keybindings"), // JSON string
  searchSettings: text("search_settings"), // JSON string
  executionMode: text("execution_mode").$type<"direct" | "review">().default("review"),
  rowSpacing: text("row_spacing").$type<"compact" | "standard" | "relaxed">().default("relaxed"),
  alternatingRowColors: integer("alternating_row_colors", { mode: "boolean" }).default(false),
  editorFontSize: text("editor_font_size").default("12px"),
  sqlEditorEngine: text("sql_editor_engine").$type<"custom" | "monaco">().default("custom"),
  editorThemeId: text("editor_theme_id").default("auto"),
  customEditorThemes: text("custom_editor_themes"),
  appThemeId: text("app_theme_id").default("zinc-dark-white"),
  customAppThemes: text("custom_app_themes"),
  tuiMode: integer("tui_mode", { mode: "boolean" }).default(false),
  tuiTheme: text("tui_theme").$type<"auto" | "light" | "dark">().default("auto"),
  commandMenuSections: text("command_menu_sections"), // JSON string
  splitView: text("split_view"), // JSON string
  agentProvider: text("agent_provider").$type<"openai" | "gemini">().default("openai"),
  agentModel: text("agent_model"),
  agentApiKey: text("agent_api_key"),
  vimMode: integer("vim_mode", { mode: "boolean" }).default(false),
});

export const dashboardState = sqliteTable("dashboard_state", {
  connectionId: integer("connection_id").primaryKey().references(() => connections.id, { onDelete: "cascade" }),
  dashboardsJson: text("dashboards_json").notNull(),
  foldersJson: text("folders_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiChats = sqliteTable("ai_chats", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiChatMessages = sqliteTable("ai_chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull().references(() => aiChats.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
  content: text("content").notNull(),
  metaJson: text("meta_json"),
  timestamp: integer("timestamp").notNull(),
});

export const userAiSettings = sqliteTable("user_ai_settings", {
  userId: text("user_id").primaryKey(),
  settingsJson: text("settings_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// External MCP server config (single row, id always 1). Stores the
// user-facing MCP server settings: enabled flag, transports, auth token,
// selected permission mode, exposed connection ids, and custom modes.
export const mcpServerConfig = sqliteTable("mcp_server_config", {
  id: integer("id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});


export const schemaCacheMeta = sqliteTable("schema_cache_meta", {
  connectionString: text("connection_string").primaryKey(),
  schemasUpdatedAt: integer("schemas_updated_at"),
  tablesUpdatedAt: integer("tables_updated_at"),
  columnsUpdatedAt: integer("columns_updated_at"),
});

export const schemaCacheSchemas = sqliteTable("schema_cache_schemas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionString: text("connection_string").notNull(),
  schemaName: text("schema_name").notNull(),
});

export const schemaCacheTables = sqliteTable("schema_cache_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionString: text("connection_string").notNull(),
  schemaName: text("schema_name").notNull(),
  tableName: text("table_name").notNull(),
});

export const schemaCacheColumns = sqliteTable("schema_cache_columns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionString: text("connection_string").notNull(),
  schemaName: text("schema_name").notNull(),
  tableName: text("table_name").notNull(),
  columnName: text("column_name").notNull(),
  dataType: text("data_type"),
  isNullable: integer("is_nullable", { mode: "boolean" }).default(false),
  isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  referencedTableSchema: text("referenced_table_schema"),
  referencedTableName: text("referenced_table_name"),
  referencedColumnName: text("referenced_column_name"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  isLocal: integer("is_local", { mode: "boolean" }).default(true).notNull(),
  supabaseId: text("supabase_id"),
  planType: text("plan_type").default("free").notNull(),
  planStatus: text("plan_status").default("none").notNull(),
  planSyncedAt: integer("plan_synced_at", { mode: "timestamp" }),
  planPeriodEnd: integer("plan_period_end", { mode: "timestamp" }),
});

export const userEntitlements = sqliteTable("user_entitlements", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  signature: text("signature").notNull(),
  entitlementPlanCode: text("entitlement_plan_code").notNull(),
  lastPaidPlanCode: text("last_paid_plan_code"),
  status: text("status").notNull(),
  cloudEnabled: integer("cloud_enabled", { mode: "boolean" }).default(false).notNull(),
  maxConnections: integer("max_connections"),
  maxWorkspaces: integer("max_workspaces"),
  accessEndsAt: integer("access_ends_at", { mode: "timestamp" }),
  graceEndsAt: integer("grace_ends_at", { mode: "timestamp" }),
  updatesUntil: integer("updates_until", { mode: "timestamp" }),
  issuedAt: integer("issued_at", { mode: "timestamp" }).notNull(),
  refreshAfter: integer("refresh_after", { mode: "timestamp" }).notNull(),
  lastObservedAt: integer("last_observed_at", { mode: "timestamp" }).default(new Date(0)).notNull(),
  syncedAt: integer("synced_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const connectionGroupMembers = sqliteTable("connection_group_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectionId: integer("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => connectionGroups.id, { onDelete: "cascade" }),
});

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionGroupMember = typeof connectionGroupMembers.$inferSelect;

export type Folder = typeof folders.$inferSelect;
export type Snippet = typeof snippets.$inferSelect;

export const snippetVersions = sqliteTable("snippet_versions", {
  id: text("id").primaryKey(),
  snippetId: text("snippet_id").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  versionNumber: integer("version_number").notNull(),
  createdAt: integer("created_at").notNull(),
});
export type SnippetVersion = typeof snippetVersions.$inferSelect;

export type QueryHistoryEntry = typeof queryHistory.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TableTag = typeof tableTags.$inferSelect;
export type OpenTab = typeof openTabs.$inferSelect;
export type ConnectionSettings = typeof connectionSettings.$inferSelect;
export type DashboardState = typeof dashboardState.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserEntitlement = typeof userEntitlements.$inferSelect;
export type AiChat = typeof aiChats.$inferSelect;
export type AiChatMessageRow = typeof aiChatMessages.$inferSelect;
export type UserAiSettingsRow = typeof userAiSettings.$inferSelect;
export type McpServerConfigRow = typeof mcpServerConfig.$inferSelect;

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  nodesJson: text("nodes_json").notNull().default("[]"),
  edgesJson: text("edges_json").notNull().default("[]"),
  scheduleEnabled: integer("schedule_enabled", { mode: "boolean" }).default(false),
  scheduleType: text("schedule_type").$type<"cron" | "datetime">(),
  scheduleValue: text("schedule_value"),
  lastRunAt: integer("last_run_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  status: text("status").$type<"running" | "success" | "error">().notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  nodesOutputJson: text("nodes_output_json"),
  error: text("error"),
  trigger: text("trigger").$type<"manual" | "schedule">().notNull(),
});

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
