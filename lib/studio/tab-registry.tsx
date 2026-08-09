import type { ReactNode } from "react";
import type { StudioInitialTab } from "@/lib/studio/types";
import { QueryHistoryView } from "@/components/studio/query-history-view";
import { ConnectionAnalytics } from "@/components/connections/connection-analytics";
import { AdvisorView } from "@/components/advisor/advisor-view";
import { WorkflowView } from "@/components/workflows/workflow-view";
import { ProfileSettingsView } from "@/components/studio/profile-settings-view";
import { ConnectStudioView } from "@/components/studio/connect-studio-view";
import { DiffTableView } from "@/components/studio/snapshots/diff-table-view";
import { SnapshotTableView } from "@/components/studio/snapshots/snapshot-table-view";
import { ImportExportView } from "@/components/studio/import-export-view";
import { SettingsView } from "@/components/studio/settings-view";
import { KeybindingsView } from "@/components/studio/keybindings-view";
import { ManageWorkspacesView } from "@/components/studio/manage-workspaces-view";
import { SnapshotsView } from "@/components/studio/snapshots/snapshots-view";
import {
  BarChart3,
  BookOpen,
  Box,
  Camera,
  Clock,
  Code2,
  Database,
  Download,
  FileArchive,
  FileCode,
  FolderOpen,
  FunctionSquare,
  GitFork,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Table2,
  Terminal,
  User,
  Workflow,
  Zap,
} from "@/lib/icon-theme/lucide-react";
import type { LucideIcon } from "lucide-react";

export interface RenderTabOptions {
  tab: StudioInitialTab;
  /** The full useStudio() hook return value (passed through from studio-main-content). Typed loosely to avoid circular imports. */
  studio: unknown;
  /** Extra render context assembled by the host (connection, connectionString, dbType, etc.) */
  context?: Record<string, unknown>;
}

export interface TabTypeConfig<TMeta = Record<string, unknown>> {
  /** Unique string identifier */
  type: string;
  /** View mode used for routing in renderPaneBody */
  viewMode: string;
  /** Default tab name */
  defaultName: string | ((meta: TMeta) => string);
  /** Build a deterministic tab ID from metadata */
  buildTabId: (meta: TMeta & { paneId?: string }) => string;
  /** Create a tab object ready for openTabs[] */
  createTab: (id: string, meta: TMeta) => StudioInitialTab;
  /** If true, tab gets cloned into each pane instead of moving (sql/table/workflow) */
  shouldClone?: boolean;
  /** If true, tab can be a preview tab replaced on next click */
  supportsPreview?: boolean;
  /** If true, new tab ID gets ::pane:: suffix to track pane (only when splitView enabled) */
  trackPane?: boolean;
  /** Canonical icon key resolved to a lucide component via TAB_ICON_COMPONENTS */
  icon?: string;
  /** Optional: semantic grouping to help future code (e.g. "database", "auth", "settings", "create", "content") */
  group?: "content" | "database" | "auth" | "settings" | "create" | "special";
  /** Render the tab's view. Receives the tab and the full studio hook return value. */
  renderComponent?: (opts: RenderTabOptions) => ReactNode;
}

const uid = (): string => Math.random().toString(36).substring(2, 9);

function simpleConfig(type: string, viewMode: string, name: string, icon: string, group: TabTypeConfig["group"]): TabTypeConfig {
  return {
    type,
    viewMode,
    defaultName: name,
    buildTabId: () => type,
    createTab: (id) => ({ id, type: type as StudioInitialTab["type"], name }),
    icon,
    group,
  };
}

/** Canonical icon key → lucide component. Single source of truth for tab icons. */
export const TAB_ICON_COMPONENTS: Record<string, LucideIcon> = {
  table: Table2,
  sql: Code2,
  file: FileCode,
  dashboard: LayoutDashboard,
  workflow: Workflow,
  "create-table": Plus,
  "create-key": KeyRound,
  key: KeyRound,
  "list-tree": List,
  zap: Zap,
  "folder-tree": FolderOpen,
  database: Database,
  schema: GitFork,
  tables: LayoutGrid,
  function: FunctionSquare,
  boxes: Box,
  shield: Shield,
  clock: Clock,
  lock: Lock,
  "scan-search": Search,
  archive: FileArchive,
  terminal: Terminal,
  "book-open": BookOpen,
  download: Download,
  history: History,
  chart: BarChart3,
  settings: Settings,
  user: User,
  server: Server,
  camera: Camera,
  diff: GitFork,
};

export function getTabIcon(type: string): LucideIcon | undefined {
  return TAB_ICON_COMPONENTS[getTabConfig(type)?.icon ?? ""];
}

export const TAB_REGISTRY: {
  table: TabTypeConfig;
  sql: TabTypeConfig;
  dashboard: TabTypeConfig;
  workflow: TabTypeConfig;
  "create-table": TabTypeConfig;
  "create-key": TabTypeConfig;
  "create-enum": TabTypeConfig;
  "create-index": TabTypeConfig;
  "create-trigger": TabTypeConfig;
  "create-schema": TabTypeConfig;
  "create-database": TabTypeConfig;
  "database-schema": TabTypeConfig;
  "database-tables": TabTypeConfig;
  "database-functions": TabTypeConfig;
  "database-extensions": TabTypeConfig;
  "database-triggers": TabTypeConfig;
  "database-enums": TabTypeConfig;
  "database-indexes": TabTypeConfig;
  "database-rls-policies": TabTypeConfig;
  "database-sessions": TabTypeConfig;
  "database-locks": TabTypeConfig;
  "database-explain-plan": TabTypeConfig;
  "database-backup-restore": TabTypeConfig;
  "database-spacetimedb-reducers": TabTypeConfig;
  "database-spacetimedb-logs": TabTypeConfig;
  "database-spacetimedb-schema": TabTypeConfig;
  "import-export": TabTypeConfig;
  history: TabTypeConfig;
  analytics: TabTypeConfig;
  advisor: TabTypeConfig;
  "rls-policy-edit": TabTypeConfig;
  snapshots: TabTypeConfig;
  "snapshot-table": TabTypeConfig;
  "diff-table": TabTypeConfig;
  "connect-studio": TabTypeConfig;
  "manage-workspaces": TabTypeConfig;
  "auth-users": TabTypeConfig;
  "auth-sessions": TabTypeConfig;
  "auth-providers": TabTypeConfig;
  settings: TabTypeConfig;
  "agent-settings": TabTypeConfig;
  "profile-settings": TabTypeConfig;
  keybindings: TabTypeConfig;
} = {
  // ── content ────────────────────────────────────────────────────────────
  table: {
    type: "table",
    viewMode: "tables",
    defaultName: (meta) => String((meta as { tableName?: string }).tableName ?? "Table"),
    buildTabId: (meta) => {
      const m = meta as { schema?: string; tableName?: string };
      return `table-${m.schema}-${m.tableName}`;
    },
    createTab: (id, meta) => {
      const m = meta as { schema?: string; tableName?: string };
      return { id, baseId: id, type: "table", name: m.tableName ?? "Table", schema: m.schema };
    },
    shouldClone: true,
    supportsPreview: true,
    trackPane: true,
    icon: "table",
    group: "content",
  },

  sql: {
    type: "sql",
    viewMode: "sql",
    defaultName: (meta) => {
      const m = meta as { name?: string; dbType?: string };
      if (m.name) return m.name;
      if (m.dbType === "mongodb") return "New JSON Query";
      if (m.dbType === "redis") return "New Command";
      return "New Query";
    },
    buildTabId: (meta) => {
      const m = meta as { snippetId?: string };
      return m.snippetId ? `sql-${m.snippetId}` : `sql-new-${uid()}`;
    },
    createTab: (id, meta) => {
      const m = meta as { name?: string; query?: string; dbType?: string };
      const name =
        m.name ??
        (m.dbType === "mongodb"
          ? "New JSON Query"
          : m.dbType === "redis"
            ? "New Command"
            : "New Query");
      return { id, type: "sql", name, query: m.query };
    },
    shouldClone: true,
    supportsPreview: true,
    trackPane: true,
    icon: "sql",
    group: "content",
  },

  dashboard: {
    type: "dashboard",
    viewMode: "dashboard",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Dashboard"),
    buildTabId: (meta) => `dashboard-${(meta as { dashboardId?: string }).dashboardId}`,
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "dashboard", name: m.name ?? "Dashboard" };
    },
    supportsPreview: true,
    trackPane: true,
    icon: "dashboard",
    group: "content",
  },

  workflow: {
    type: "workflow",
    viewMode: "workflow",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Workflow"),
    buildTabId: (meta) => {
      const workflowId = (meta as { workflowId?: string }).workflowId;
      return workflowId ? `workflow-${workflowId}` : "workflow";
    },
    createTab: (id, meta) => {
      const m = meta as { workflowId?: string; name?: string };
      const tab: StudioInitialTab & { workflowId?: string } = { id, type: "workflow", name: m.name ?? "Workflow" };
      if (m.workflowId) tab.workflowId = m.workflowId;
      return tab;
    },
    shouldClone: true,
    icon: "workflow",
    group: "content",
    renderComponent: (opts) => (
      <WorkflowView
        workflowId={(() => {
          const match = opts.tab.id.match(/^workflow-(.+?)(?:::pane::.*)?$/);
          return match ? match[1] : undefined;
        })()}
      />
    ),
  },

  // ── create ─────────────────────────────────────────────────────────────
  "create-table": {
    type: "create-table",
    viewMode: "create-table",
    defaultName: "New Table",
    buildTabId: () => "create-table",
    createTab: (id) => ({ id, type: "create-table", name: "New Table" }),
    icon: "create-table",
    group: "create",
  },

  "create-key": {
    type: "create-key",
    viewMode: "create-key",
    defaultName: "New Key",
    buildTabId: () => "create-key",
    createTab: (id) => ({ id, type: "create-key", name: "New Key" }),
    icon: "create-key",
    group: "create",
  },

  "create-enum": {
    type: "create-enum",
    viewMode: "create-enum",
    defaultName: (meta) => {
      const m = meta as { editing?: boolean; enumName?: string };
      return m.editing && m.enumName ? `Edit ${m.enumName}` : "New Enum";
    },
    buildTabId: () => "create-enum",
    createTab: (id, meta) => {
      const m = meta as { editing?: boolean; enumName?: string; schema?: string };
      const tab = {
        id,
        type: "create-enum",
        name: m.editing && m.enumName ? `Edit ${m.enumName}` : "New Enum",
      } as StudioInitialTab;
      if (m.schema) tab.schema = m.schema;
      return tab;
    },
    icon: "list-tree",
    group: "create",
  },

  "create-index": {
    type: "create-index",
    viewMode: "create-index",
    defaultName: "New Index",
    buildTabId: () => "create-index",
    createTab: (id) => ({ id, type: "create-index", name: "New Index" }),
    icon: "key",
    group: "create",
  },

  "create-trigger": {
    type: "create-trigger",
    viewMode: "create-trigger",
    defaultName: "New Trigger",
    buildTabId: () => "create-trigger",
    createTab: (id) => ({ id, type: "create-trigger", name: "New Trigger" }),
    icon: "zap",
    group: "create",
  },

  "create-schema": {
    type: "create-schema",
    viewMode: "create-schema",
    defaultName: "New Schema",
    buildTabId: () => "create-schema",
    createTab: (id) => ({ id, type: "create-schema", name: "New Schema" }),
    icon: "folder-tree",
    group: "create",
  },

  "create-database": {
    type: "create-database",
    viewMode: "create-database",
    defaultName: "New Database",
    buildTabId: () => "create-database",
    createTab: (id) => ({ id, type: "create-database", name: "New Database" }),
    icon: "database",
    group: "create",
  },

  // ── database ───────────────────────────────────────────────────────────
  "database-schema": {
    type: "database-schema",
    viewMode: "database",
    defaultName: "Schema Diagram",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "schema"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-schema", name: "Schema Diagram" };
    },
    icon: "schema",
    group: "database",
  },

  "database-tables": {
    type: "database-tables",
    viewMode: "database",
    defaultName: (meta) =>
      (meta as { dbType?: string }).dbType === "mongodb" ? "Collections List" : "Tables List",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "tables"}`,
    createTab: (id, meta) => {
      const m = meta as { dbType?: string };
      return { id, type: "database-tables", name: m.dbType === "mongodb" ? "Collections List" : "Tables List" };
    },
    icon: "tables",
    group: "database",
  },

  "database-functions": {
    type: "database-functions",
    viewMode: "database",
    defaultName: "Functions",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "functions"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-functions", name: "Functions" };
    },
    icon: "function",
    group: "database",
  },

  "database-extensions": {
    type: "database-extensions",
    viewMode: "database",
    defaultName: "Extensions",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "extensions"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-extensions", name: "Extensions" };
    },
    icon: "boxes",
    group: "database",
  },

  "database-triggers": {
    type: "database-triggers",
    viewMode: "database",
    defaultName: "Triggers",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "triggers"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-triggers", name: "Triggers" };
    },
    icon: "zap",
    group: "database",
  },

  "database-enums": {
    type: "database-enums",
    viewMode: "database",
    defaultName: "Enumerated Types",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "enums"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-enums", name: "Enumerated Types" };
    },
    icon: "list-tree",
    group: "database",
  },

  "database-indexes": {
    type: "database-indexes",
    viewMode: "database",
    defaultName: "Indexes",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "indexes"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-indexes", name: "Indexes" };
    },
    icon: "key",
    group: "database",
  },

  "database-rls-policies": {
    type: "database-rls-policies",
    viewMode: "database",
    defaultName: "RLS Policies",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "rls-policies"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-rls-policies", name: "RLS Policies" };
    },
    icon: "shield",
    group: "database",
  },

  "database-sessions": {
    type: "database-sessions",
    viewMode: "database",
    defaultName: "Sessions",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "sessions"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-sessions", name: "Sessions" };
    },
    icon: "clock",
    group: "database",
  },

  "database-locks": {
    type: "database-locks",
    viewMode: "database",
    defaultName: "Locks",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "locks"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-locks", name: "Locks" };
    },
    icon: "lock",
    group: "database",
  },

  "database-explain-plan": {
    type: "database-explain-plan",
    viewMode: "database",
    defaultName: "Explain Plan",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "explain-plan"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-explain-plan", name: "Explain Plan" };
    },
    icon: "scan-search",
    group: "database",
  },

  "database-backup-restore": {
    type: "database-backup-restore",
    viewMode: "database",
    defaultName: "Backup & Restore",
    buildTabId: (meta) => `database-${(meta as { view?: string }).view ?? "backup-restore"}`,
    createTab: (id, meta) => {
      const m = meta as { view?: string };
      return { id, type: "database-backup-restore", name: "Backup & Restore" };
    },
    icon: "archive",
    group: "database",
  },

  "database-spacetimedb-reducers": {
    type: "database-spacetimedb-reducers",
    viewMode: "database",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Reducers"),
    buildTabId: (meta) => String((meta as { tabId?: string }).tabId ?? "database-spacetimedb-reducers"),
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "database-spacetimedb-reducers", name: m.name ?? "Reducers" };
    },
    icon: "zap",
    group: "database",
  },

  "database-spacetimedb-logs": {
    type: "database-spacetimedb-logs",
    viewMode: "database",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Logs"),
    buildTabId: (meta) => String((meta as { tabId?: string }).tabId ?? "database-spacetimedb-logs"),
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "database-spacetimedb-logs", name: m.name ?? "Logs" };
    },
    icon: "terminal",
    group: "database",
  },

  "database-spacetimedb-schema": {
    type: "database-spacetimedb-schema",
    viewMode: "database",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Raw Schema"),
    buildTabId: (meta) => String((meta as { tabId?: string }).tabId ?? "database-spacetimedb-schema"),
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "database-spacetimedb-schema", name: m.name ?? "Raw Schema" };
    },
    icon: "book-open",
    group: "database",
  },

  // ── special ────────────────────────────────────────────────────────────
  "import-export": {
    ...simpleConfig("import-export", "import-export", "Export", "download", "special"),
    renderComponent: (opts) => <ImportExportView studio={opts.studio as any} />,
  },
  history: {
    ...simpleConfig("history", "history", "Query History", "history", "special"),
    renderComponent: (opts) => {
      const s = opts.studio as any;
      const connection = opts.context?.connection as any;
      return (
        <QueryHistoryView
          connectionId={connection?.id}
          connectionName={connection?.name}
          onRunQuery={(query) => {
            s.openSqlEditor();
            setTimeout(() => {
              s.setQuery(query);
              s.handleRunQuery(query);
            }, 50);
          }}
        />
      );
    },
  },
  analytics: {
    ...simpleConfig("analytics", "analytics", "Analytics", "chart", "special"),
    renderComponent: (opts) => (
      <ConnectionAnalytics
        connectionId={(opts.context?.connection as any)?.id}
        connection={opts.context?.connection as any}
      />
    ),
  },
  advisor: {
    ...simpleConfig("advisor", "advisor", "Advisor", "chart", "special"),
    renderComponent: (opts) => (
      <AdvisorView
        connectionString={opts.context?.connectionString as any}
        dbType={opts.context?.dbType as any}
      />
    ),
  },

  "rls-policy-edit": {
    type: "rls-policy-edit",
    viewMode: "rls-policy-edit",
    defaultName: (meta) => {
      const m = meta as { mode?: "edit" | "create"; name?: string };
      return m.mode === "create" ? "New RLS Policy" : `Policy: ${m.name}`;
    },
    buildTabId: (meta) => {
      const m = meta as { mode?: "edit" | "create"; schema?: string; table?: string; name?: string };
      if (m.mode === "create") {
        return `rls-policy-create-${m.schema}-${m.table || "new"}-${Date.now()}`;
      }
      return `rls-policy-edit-${m.schema}-${m.table}-${m.name}`;
    },
    createTab: (id, meta) => {
      const m = meta as { mode?: "edit" | "create"; schema?: string; table?: string; name?: string };
      const name = m.mode === "create" ? "New RLS Policy" : `Policy: ${m.name}`;
      return { id, type: "rls-policy-edit", name };
    },
    icon: "shield",
    group: "special",
  },

  snapshots: {
    ...simpleConfig("snapshots", "snapshots", "Snapshots", "camera", "special"),
    renderComponent: (opts) => {
      const s = opts.studio as any;
      const connection = opts.context?.connection as any;
      const connectionString = opts.context?.connectionString as any;
      return (
        <SnapshotsView
          connectionId={connection?.id}
          connectionString={connectionString}
          onOpenSnapshotTable={(tabId, tabName) => {
            const newTab = {
              id: tabId,
              type: "snapshot-table" as const,
              name: tabName,
            };
            const next = [...(s.openTabs || []), newTab];
            s.setOpenTabs(next);
            s.switchTab(tabId, next);
          }}
          onOpenDiffTable={(tabId, tabName) => {
            const newTab = {
              id: tabId,
              type: "diff-table" as const,
              name: tabName,
            };
            const next = [...(s.openTabs || []), newTab];
            s.setOpenTabs(next);
            s.switchTab(tabId, next);
          }}
        />
      );
    },
  },
  "snapshot-table": {
    type: "snapshot-table",
    viewMode: "snapshot-table",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Snapshot Table"),
    buildTabId: (meta) => {
      const m = meta as { tabId?: string };
      return m.tabId ?? "snapshot-table";
    },
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "snapshot-table", name: m.name ?? "Snapshot Table" };
    },
    icon: "table",
    group: "special",
    renderComponent: (opts) => <SnapshotTableView tabId={opts.tab.id} />,
  },
  "diff-table": {
    type: "diff-table",
    viewMode: "diff-table",
    defaultName: (meta) => String((meta as { name?: string }).name ?? "Diff Table"),
    buildTabId: (meta) => {
      const m = meta as { tabId?: string };
      return m.tabId ?? "diff-table";
    },
    createTab: (id, meta) => {
      const m = meta as { name?: string };
      return { id, type: "diff-table", name: m.name ?? "Diff Table" };
    },
    icon: "diff",
    group: "special",
    renderComponent: (opts) => <DiffTableView tabId={opts.tab.id} />,
  },

  "connect-studio": {
    ...simpleConfig("connect-studio", "connect-studio", "Workspace Studio", "server", "special"),
    renderComponent: () => <ConnectStudioView />,
  },
  "manage-workspaces": {
    ...simpleConfig("manage-workspaces", "manage-workspaces", "Workspaces", "settings", "special"),
    renderComponent: (opts) => <ManageWorkspacesView studio={opts.studio as any} />,
  },

  // ── auth ───────────────────────────────────────────────────────────────
  "auth-users": simpleConfig("auth-users", "auth", "Users", "user", "auth"),
  "auth-sessions": simpleConfig("auth-sessions", "auth", "Sessions", "clock", "auth"),
  "auth-providers": simpleConfig("auth-providers", "auth", "Providers", "shield", "auth"),

  // ── settings ───────────────────────────────────────────────────────────
  settings: {
    ...simpleConfig("settings", "settings", "Settings", "settings", "settings"),
    renderComponent: (opts) => (
      <SettingsView
        studio={opts.studio as any}
        onOpenThemeCreator={opts.context?.onOpenThemeCreator as (() => void) | undefined}
        onOpenIconThemeCreator={opts.context?.onOpenIconThemeCreator as (() => void) | undefined}
      />
    ),
  },
  "agent-settings": simpleConfig("agent-settings", "settings", "Agent Settings", "settings", "settings"),
  "profile-settings": {
    ...simpleConfig("profile-settings", "profile-settings", "Profile Settings", "user", "settings"),
    renderComponent: () => <ProfileSettingsView />,
  },
  keybindings: {
    ...simpleConfig("keybindings", "keybindings", "Keybindings", "key", "settings"),
    renderComponent: (opts) => <KeybindingsView studio={opts.studio as any} />,
  },
} satisfies Record<string, TabTypeConfig>;

export type StudioTabType = keyof typeof TAB_REGISTRY;

export function getTabConfig(type: string): TabTypeConfig | undefined {
  return TAB_REGISTRY[type as StudioTabType];
}

export function getViewMode(type: string): string | undefined {
  return TAB_REGISTRY[type as StudioTabType]?.viewMode;
}

export function getConfigsByViewMode(viewMode: string): TabTypeConfig[] {
  return Object.values(TAB_REGISTRY).filter((config) => config.viewMode === viewMode);
}

export function getTabConfigByViewMode(viewMode: string): TabTypeConfig | undefined {
  return Object.values(TAB_REGISTRY).find((config) => config.viewMode === viewMode);
}

export function getAllTabTypes(): string[] {
  return Object.keys(TAB_REGISTRY);
}

export function getAllViewModes(): string[] {
  return Array.from(new Set(Object.values(TAB_REGISTRY).map((config) => config.viewMode)));
}
