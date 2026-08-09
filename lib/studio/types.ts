import { Connection } from "@/lib/db/schema";
import type { StudioTabType } from "./tab-registry";

export interface Snippet {
  id: string;
  name: string;
  query: string;
  folderId: string | null;
  createdAt: number;
  isShared?: boolean;
  sharedEntryId?: string;
}

export interface SnippetVersion {
  id: string;
  snippetId: string;
  name: string;
  query: string;
  versionNumber: number;
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface SnippetExportData {
  version: 2;
  type: "snippets";
  folders: Array<{ name: string; parentName?: string | null; createdAt: number }>;
  snippets: Array<{ name: string; query: string; folderName: string | null; createdAt: number; isShared?: boolean }>;
}

export interface DashboardExportData {
  version: 2;
  type: "dashboards";
  folders: Array<{ name: string; parentName?: string | null; createdAt: number }>;
  dashboards: Array<{
    name: string;
    folderName: string | null;
    isShared?: boolean;
    isLocked?: boolean;
    widgets: Dashboard["widgets"];
  }>;
}

export interface QueryHistory {
  id: string;
  query: string;
  executedAt: number;
  duration: number;
  status: 'success' | 'error';
  error?: string;
  rowsCount?: number;
  caller: 'user' | 'system';
  executedBy?: string;
  executedByName?: string;
  connectionName?: string;
}

export interface UseStudioProps {
  connection: Connection;
  initialUiState?: StudioInitialUiState;
}

export interface StudioInitialTab {
  id: string;
  baseId?: string;
  type: StudioTabType;
  name: string;
  schema?: string;
  query?: string;
  dirty?: boolean;
  pinned?: boolean;
  /** VS Code-style preview tab — temporary until confirmed by double-click, edit, or pin */
  isPreview?: boolean;
}

export interface StudioInitialUiState {
  openTabs: StudioInitialTab[];
  activeTabId: string | null;
  schemas?: string[];
  selectedSchema?: string | null;
  tables?: string[];
}

export interface SqlFormatSettingsRequired {
  sqlFormatTabWidth: number;
  sqlFormatUseTabs: boolean;
  sqlFormatKeywordCase: "preserve" | "upper" | "lower";
  sqlFormatDataTypeCase: "preserve" | "upper" | "lower";
  sqlFormatFunctionCase: "preserve" | "upper" | "lower";
  sqlFormatIdentifierCase: "preserve" | "upper" | "lower";
  sqlFormatLogicalOperatorNewline: "before" | "after";
  sqlFormatExpressionWidth: number;
  sqlFormatLinesBetweenQueries: number;
  sqlFormatDenseOperators: boolean;
  sqlFormatNewlineBeforeSemicolon: boolean;
}

export interface SqlEditorSettingsProps extends Partial<SqlFormatSettingsRequired> {
  sqlEditorEngine?: SqlEditorEngine;
  editorFontSize?: number | string;
  editorFontFamily?: string;
  vimMode?: boolean;
  slashAiTrigger?: boolean;
  resultTabsEnabled?: boolean;
}

export interface SqlEditorCommonProps {
  dbType?:
    | "postgres"
    | "mongodb"
    | "sqlite"
    | "mysql"
    | "clickhouse"
    | "mssql"
    | "redis"
    | "trino"
    | "duckdb"
    | "federated"
    | "spacetimedb";
  query: string;
  setQuery: (query: string) => void;
  error: string | null;
  results: any;
  loading: boolean;
  executionTime?: number;
  handleRunQuery: (queryOverride?: string) => void;
  handleStopQuery: () => void;
  canStopQuery: boolean;
  toggleAllSelection: () => void;
  selectedRows: Set<number>;
  tableStructure: any[];
  toggleRowSelection: (index: number) => void;
  setSelectedCell: (
    cell: { rowIndex: number; columnName: string } | null,
  ) => void;
  selectedCell: { rowIndex: number; columnName: string } | null;
  snippets: Snippet[];
  folders: Folder[];
  addSnippet: (name: string, query: string, folderId: string | null) => void;
  updateSnippet: (id: string, updates: Partial<any>) => void;
  deleteSnippet: (id: string) => void;
  createSnippetVersion?: (
    snippetId: string,
    name: string,
    query: string,
  ) => Promise<any>;
  getSnippetVersions?: (
    snippetId: string,
  ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  restoreSnippetVersion?: (
    snippetId: string,
    versionId: string,
  ) => Promise<{
    success: boolean;
    data?: { name: string; query: string };
    error?: string;
  }>;
  addFolder: (name: string) => void;
  updateFolder: (id: string, updates: Partial<any>) => void;
  deleteFolder: (id: string) => void;
  activeTabId?: string | null;
  schemaData?: Record<string, any>;
  gridProps?: Record<string, any>;
  onOpenAiSettings?: () => void;
  selectedNamespace?: string;
}

export const GLOBAL_SQL_CONTEXT_ID = "__global_sql_context__";
export const DASHBOARD_GRID_SIZE = 40;
export const DASHBOARD_MIN_SIZE = DASHBOARD_GRID_SIZE * 4;
export type SqlEditorEngine = "custom" | "monaco";
export type {
  StudioSplitViewState,
} from "@/lib/studio/split-layout";

export type DashboardWidgetType =
  | "empty"
  | "area-chart"
  | "bar-chart"
  | "p-chart-1"
  | "p-chart-2"
  | "p-chart-3"
  | "p-chart-4"
  | "p-chart-12"
  | "p-chart-13"
  | "p-chart-14"
  | "p-chart-15"
  | "p-chart-17"
  | "p-chart-18"
  | "p-chart-19"
  | "p-chart-20"
  | "p-chart-21"
  | "pie-chart"
  | "table"
  | "metric"
  | "sparkline"
  | "map"
  | "progress"
  | "text"
  | "image"
  | "gif";

export type DashboardConditionOperator =
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_null"
  | "is_not_null";

export type DashboardConditionActionType = "text" | "image" | "gif";

export interface DashboardFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface DashboardWidget {
  id: string;
  widgetType: DashboardWidgetType;
  title: string;
  query?: string;
  tableName?: string;
  schema?: string;
  content?: string;
  conditions?: Array<{
    id: string;
    operator: DashboardConditionOperator;
    value?: string;
    actionType: DashboardConditionActionType;
    actionValue: string;
  }>;
  x: number;
  y: number;
    width: number;
    height: number;
}

export interface Dashboard {
  id: string;
  name: string;
  folderId: string | null;
  isShared?: boolean;
  isLocked?: boolean;
  sharedEntryId?: string;
  widgets: DashboardWidget[];
}

export type AgentGeneratedWidgetType =
  | "area-chart"
  | "bar-chart"
  | "p-chart-1"
  | "p-chart-2"
  | "p-chart-3"
  | "p-chart-4"
  | "p-chart-12"
  | "p-chart-13"
  | "p-chart-14"
  | "p-chart-15"
  | "p-chart-17"
  | "p-chart-18"
  | "p-chart-19"
  | "p-chart-20"
  | "p-chart-21"
  | "pie-chart"
  | "table"
  | "metric"
  | "sparkline"
  | "map"
  | "progress"
  | "text";

export interface AgentGeneratedWidgetPlan {
  title?: string;
  widgetType?: AgentGeneratedWidgetType;
  query?: string;
  tableName?: string;
  schema?: string;
  content?: string;
}

export interface AgentDashboardPlan {
  name?: string;
  widgets?: AgentGeneratedWidgetPlan[];
  assistantMessage?: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface AgentChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SchemaContextTable {
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string }>;
}

export interface QueryValidationShapeResult {
  ok: boolean;
  reason?: string;
}

export type PermissionAction = "read" | "write_value" | "manage_permissions" | "delete";
export type GranteeType = "user" | "role" | "team" | "studio" | "public";

export interface KVPermission {
  action: PermissionAction;
  granteeType: GranteeType;
  granteeId: string | null;
}

export const PERMISSION_LABELS: Record<PermissionAction, string> = {
  read: "Can view",
  write_value: "Can edit",
  manage_permissions: "Can manage",
  delete: "Can delete",
};

export const PERMISSION_LEVELS = [
  { value: "view", label: "Can view", actions: ["read"] as PermissionAction[] },
  { value: "edit", label: "Can edit", actions: ["read", "write_value"] as PermissionAction[] },
  { value: "manage", label: "Can manage", actions: ["read", "write_value", "manage_permissions"] as PermissionAction[] },
  { value: "full", label: "Full control", actions: ["read", "write_value", "manage_permissions", "delete"] as PermissionAction[] },
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]["value"];

export function actionsToLevel(actions: PermissionAction[]): PermissionLevel {
  const sorted = [...new Set(actions)].sort();
  for (const level of PERMISSION_LEVELS) {
    if (sorted.join(",") === [...level.actions].sort().join(",")) return level.value;
  }
  return "view";
}

export function levelToActions(level: PermissionLevel): PermissionAction[] {
  return PERMISSION_LEVELS.find((l) => l.value === level)?.actions ?? ["read"];
}
