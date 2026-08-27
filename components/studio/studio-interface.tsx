"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useToggleHandlers } from "@/hooks/use-selection-utils";
import { STUDIO_TAB_ICONS } from "@/lib/studio/tab-registry";
import { resolvePaneForTab } from "@/lib/studio/split-layout";
import { AppShell } from "@/components/app-shell/app-shell";
import { ModernUIShell } from "@/components/app-shell/modern-ui-shell";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SettingsView } from "@/components/studio/settings-view";
import { StudioShellSidebar } from "./studio-shell-sidebar";
import type { AppTab } from "@/components/app-shell/app-shared";
import { Connection } from "@/lib/db/schema";
import { NavigationRail } from "./navigation-rail";
import { ExplorerSidebar } from "./explorer-sidebar";
import { DatabaseExplorerSidebar } from "./database-explorer-sidebar";
import { StudioMainContent } from "./studio-main-content";
import { FKSelectionSheet } from "./fk-selection-sheet";
import { AddFKSheet } from "./database/add-fk-sheet";
import { InsertRowSheet } from "./insert-row-sheet";
import { GlobalHeader } from "./global-header";
import { useStudio } from "@/hooks/use-studio";
import { SqlSnippetsSidebar } from "./sql-snippets-sidebar";
import { DatabaseSidebar } from "./database-sidebar";
import { AuthSidebar } from "./auth-sidebar";
import { CommandMenu } from "./command-menu";
import { UniversalSearch } from "./universal-search";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  type SearchAllResult,
} from "@/lib/api/actions-client";

import { DashboardSidebar } from "./dashboard-sidebar";
import { WorkflowsSidebar } from "./workflows-sidebar";
import { ShortcutNavigator } from "./shortcut-navigator";
import { AiChatSheet } from "./ai/ai-chat-sheet";
import { AiThreadsSidebar } from "./ai/ai-threads-sidebar";
import { AgentsPanel } from "./agents/agents-panel";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { normalizeWorkflowPlan } from "@/lib/workflows/agent-plan";
import type {
  AgentWorkflowContext,
  AgentWorkflowPlan,
  LightWorkflowRef,
} from "@/lib/ai/types";
import { buildDashboardRef } from "@/lib/ai/dashboard-refs";
import {
  buildDashboardWidgetsFromBlock,
  mergeDashboardWidgetsFromBlock,
} from "@/lib/ai/dashboard-plan";
import { useStudioPanelShortcuts } from "@/hooks/use-studio-panel-shortcuts";
import { SqlEditorPanel } from "./sql-editor-panel";
import type { StudioInitialUiState } from "@/lib/studio/types";
import type { Snippet } from "@/lib/studio/types";
import { ThemeCreatorPanel } from "./theme-creator/theme-creator-panel";
import { IconThemeCreatorPanel } from "./theme-creator/icon-theme-creator-panel";
import {
  BUILTIN_APP_THEMES,
  type CustomAppTheme,
} from "@/lib/studio/app-themes";
import type { CustomIconTheme } from "@/lib/icon-theme/types";
import { useAuthState } from "@/hooks/use-auth-state";

interface StudioInterfaceProps {
  connection: Connection;
  initialUiState?: StudioInitialUiState;
}

export function StudioInterface({
  connection,
  initialUiState,
}: StudioInterfaceProps) {
  const studio = useStudio({ connection, initialUiState });
  const { displayName, user: authUser } = useAuthState();
  const [isGlobalSqlSheetOpen, setIsGlobalSqlSheetOpen] = useState(false);
  const [isUniversalSearchOpen, setIsUniversalSearchOpen] = useState(false);
  const [isAiSheetOpen, setIsAiSheetOpen] = useState(false);
  const [isAgentsPanelOpen, setIsAgentsPanelOpen] = useState(false);
  const [isThreadsOpen, setIsThreadsOpen] = useState(false);
  const [aiInitialChatId, setAiInitialChatId] = useState<string | null>(null);
  const [aiActiveChatId, setAiActiveChatId] = useState<string | null>(null);
  const [aiSelectChatToken, setAiSelectChatToken] = useState(0);
  const [isThemeCreatorOpen, setIsThemeCreatorOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | null>(null);
  const [aiStartNewChatToken, setAiStartNewChatToken] = useState(0);
  const [workflowContext, setWorkflowContext] = useState<AgentWorkflowContext>({
    existing: [],
    current: null,
  });
  const [workflowApplying, setWorkflowApplying] = useState(false);
  const [aiDashboardTarget, setAiDashboardTarget] = useState<{
    mode: "create" | "edit";
    dashboardId?: string;
  }>({ mode: "create" });
  const [globalSqlQuery, setGlobalSqlQuery] = useState("");
  const globalSqlSheetState =
    studio.sqlTabStates?.[studio.globalSqlContextId] ?? null;
  const activeAuthTab = studio.openTabs.find(
    (tab: any) => tab.id === studio.activeTabId,
  );
  const activeAuthView =
    activeAuthTab?.type === "auth-users"
      ? "users"
      : activeAuthTab?.type === "auth-sessions"
        ? "sessions"
        : activeAuthTab?.type === "auth-providers"
          ? "providers"
          : null;

  const [handleOpenThemeCreator, handleCloseThemeCreator] = useToggleHandlers(setIsThemeCreatorOpen);

  const handleSaveTheme = useCallback(
    (theme: CustomAppTheme) => {
      studio.setCustomAppThemes([...studio.customAppThemes, theme]);
      studio.setAppThemeId(theme.id);
    },
    [studio],
  );

  const [isIconThemeCreatorOpen, setIsIconThemeCreatorOpen] = useState(false);

  const [handleOpenIconThemeCreator, handleCloseIconThemeCreator] = useToggleHandlers(setIsIconThemeCreatorOpen);

  const handleSaveIconTheme = useCallback(
    (theme: CustomIconTheme) => {
      studio.setCustomIconThemes([...studio.customIconThemes, theme]);
      studio.setIconThemeId(theme.id);
    },
    [studio],
  );

  const selectedAppTheme = useMemo(() => {
    if (studio.appThemeId === "system") return null;
    return (
      studio.customAppThemes.find(
        (t: CustomAppTheme) => t.id === studio.appThemeId,
      ) ||
      BUILTIN_APP_THEMES.find(
        (t: CustomAppTheme) => t.id === studio.appThemeId,
      ) ||
      null
    );
  }, [studio.appThemeId, studio.customAppThemes]);

  useEffect(() => {
    if (!selectedAppTheme && isThemeCreatorOpen) {
      setIsThemeCreatorOpen(false);
    }
  }, [selectedAppTheme, isThemeCreatorOpen]);

  const handleSnippetStartSplitDrag = useCallback(
    (snippet: Snippet, mouseX: number, mouseY: number) => {
      studio.startSnippetSplitDrag(snippet, mouseX, mouseY);
    },
    [studio],
  );

  const handleSnippetEndSplitDrag = useCallback(() => {
    studio.endSnippetSplitDrag();
  }, [studio]);

  const handleDashboardStartSplitDrag = useCallback(
    (
      dashboard: { id: string; name: string },
      mouseX: number,
      mouseY: number,
    ) => {
      studio.startDashboardSplitDrag(dashboard, mouseX, mouseY);
    },
    [studio],
  );

  const handleDashboardEndSplitDrag = useCallback(() => {
    studio.endDashboardSplitDrag();
  }, [studio]);

  const openManageConnections = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  const handleFilterByCell = useCallback(
    (columnName: string, value: any) => {
      if (!studio.selectedTable || !studio.selectedSchema) return;

      const quotedColumn = `"${String(columnName).replace(/"/g, '""')}"`;
      let filter = "";

      if (value === null || value === undefined) {
        filter = `${quotedColumn} IS NULL`;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        filter = `${quotedColumn} = ${value}`;
      } else if (typeof value === "boolean") {
        filter = `${quotedColumn} = ${value ? "TRUE" : "FALSE"}`;
      } else {
        const serialized =
          typeof value === "object" ? JSON.stringify(value) : String(value);
        const escaped = serialized.replace(/'/g, "''");
        filter = `${quotedColumn} = '${escaped}'`;
      }

      studio.setFilterQuery(filter);
      studio.refreshTableData(
        studio.selectedTable,
        studio.selectedSchema,
        filter,
        studio.sortConfig,
      );
    },
    [studio],
  );

  const handleToggleGlobalSqlSheet = useCallback(() => {
    setIsGlobalSqlSheetOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && !globalSqlQuery.trim()) {
        const defaultQuery =
          studio.dbType === "mongodb"
            ? "db.collection.find({}).limit(100)"
            : studio.dbType === "redis"
              ? "PING"
              : "";
        setGlobalSqlQuery(defaultQuery);
      }
      if (nextOpen) {
        setIsAiSheetOpen(false);
      }
      return nextOpen;
    });
  }, [globalSqlQuery, studio.dbType]);

  const handleToggleAiSheet = useCallback(() => {
    setIsAiSheetOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setIsGlobalSqlSheetOpen(false);
        setAiInitialPrompt(null);
        setAiDashboardTarget({ mode: "create" });
      } else {
        setAiInitialPrompt(null);
        setAiDashboardTarget({ mode: "create" });
      }
      return nextOpen;
    });
  }, []);

  const handleToggleAgentsPanel = useCallback(() => {
    setIsAgentsPanelOpen((open) => !open);
  }, []);

  const handleEditDashboardWithAi = useCallback((dashboard: any) => {
    setAiDashboardTarget({ mode: "edit", dashboardId: dashboard?.id });
    setAiInitialPrompt(
      `@${buildDashboardRef(String(dashboard?.name || "dashboard"), String(dashboard?.id || ""))} `,
    );
    setAiStartNewChatToken((current) => current + 1);
    setIsGlobalSqlSheetOpen(false);
    setIsAiSheetOpen(true);
  }, []);

  const handleTogglePendingChanges = useCallback(() => {
    studio.setIsReviewSheetOpen(!studio.isReviewSheetOpen);
  }, [studio]);

  useStudioPanelShortcuts({
    onToggleAi: handleToggleAiSheet,
    onToggleSql: handleToggleGlobalSqlSheet,
    onTogglePendingChanges: handleTogglePendingChanges,
    keybindings: studio.keybindings,
  });

  const handleSendAiSqlToEditor = useCallback((nextQuery: string) => {
    setGlobalSqlQuery(nextQuery);
    setIsAiSheetOpen(false);
    setIsGlobalSqlSheetOpen(true);
  }, []);

  const handleRunAiSql = useCallback(
    (nextQuery: string) => {
      setGlobalSqlQuery(nextQuery);
      setIsAiSheetOpen(false);
      setIsGlobalSqlSheetOpen(true);
      void studio.runSqlContextQuery(studio.globalSqlContextId, nextQuery);
    },
    [studio],
  );

  const handleApplyAiDashboard = useCallback(
    (dashboard: any) => {
      if (aiDashboardTarget.mode === "edit" && aiDashboardTarget.dashboardId) {
        const nextName = String(
          dashboard?.title || dashboard?.name || "",
        ).trim();
        const currentDashboard = studio.dashboards.find(
          (item: any) => item.id === aiDashboardTarget.dashboardId,
        );
        if (!currentDashboard) return;
        if (nextName) {
          studio.updateDashboard(aiDashboardTarget.dashboardId, {
            name: nextName,
          });
        }
        studio.applyDashboardWidgetLayout(
          aiDashboardTarget.dashboardId,
          mergeDashboardWidgetsFromBlock(
            currentDashboard.widgets || [],
            dashboard,
          ),
        );
        return;
      }

      const dashboardId = studio.createDashboard(
        String(dashboard?.name || "AI Dashboard"),
      );
      if (!dashboardId) return;
      studio.applyDashboardWidgetLayout(
        dashboardId,
        buildDashboardWidgetsFromBlock(dashboard),
      );
    },
    [aiDashboardTarget, studio],
  );

  useEffect(() => {
    if (!isAiSheetOpen) return;
    let cancelled = false;
    void (async () => {
      let existing: LightWorkflowRef[] = [];
      try {
        const res = await listWorkflows(studio.connection.id);
        if (res.success && Array.isArray(res.data)) {
          existing = res.data.map((row: any) => {
            let nodeCount = 0;
            let nodeTypes: string[] = [];
            try {
              const parsed = JSON.parse(row?.nodesJson || "[]");
              if (Array.isArray(parsed)) {
                nodeCount = parsed.length;
                nodeTypes = parsed
                  .map((n: any) => (typeof n?.type === "string" ? n.type : ""))
                  .filter((t: string) => t !== "");
              }
            } catch {
              nodeCount = 0;
              nodeTypes = [];
            }
            return {
              id: String(row?.id ?? ""),
              name: String(row?.name ?? ""),
              nodeCount,
              nodeTypes,
            };
          });
        }
      } catch {
        existing = [];
      }

      let current: AgentWorkflowContext["current"] = null;
      if (studio.activeTabId?.startsWith("workflow-")) {
        const id = studio.activeTabId
          .replace(/^workflow-/, "")
          .replace(/::pane::.*$/, "");
        try {
          const wfRes = await getWorkflow(id);
          if (wfRes.success && wfRes.data) {
            let nodes: unknown[] = [];
            let edges: unknown[] = [];
            try {
              nodes = JSON.parse(wfRes.data.nodesJson || "[]");
            } catch {
              nodes = [];
            }
            try {
              edges = JSON.parse(wfRes.data.edgesJson || "[]");
            } catch {
              edges = [];
            }
            current = {
              id,
              name: String(wfRes.data.name || ""),
              nodes: nodes as any,
              edges: edges as any,
            };
          }
        } catch {
          current = null;
        }
      }

      if (!cancelled) {
        setWorkflowContext({ existing, current });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAiSheetOpen, studio.activeTabId, studio.connection.id]);

  const handleApplyAiWorkflow = useCallback(
    async (plan: AgentWorkflowPlan) => {
      if (workflowApplying) return;
      setWorkflowApplying(true);
      try {
        if (plan.workflowId) {
          let isExisting = false;
          try {
            const res = await listWorkflows(studio.connection.id);
            if (res.success && Array.isArray(res.data)) {
              isExisting = res.data.some(
                (row: any) => String(row?.id) === String(plan.workflowId),
              );
            }
          } catch {
            isExisting = false;
          }
          if (isExisting) {
            const { nodes, edges } = normalizeWorkflowPlan(plan, {
              mode: "update",
            });
            await updateWorkflow(plan.workflowId, {
              name: plan.name?.trim() || undefined,
              nodes,
              edges,
            });
            window.dispatchEvent(
              new CustomEvent("studio:workflow-saved", {
                detail: {
                  workflowId: plan.workflowId,
                  name: plan.name?.trim(),
                },
              }),
            );
            toast.success("Workflow updated");
            return;
          }
          toast.warning("Workflow id not found — created a new workflow");
        }

        const { nodes, edges } = normalizeWorkflowPlan(plan, {
          mode: "create",
        });
        const res = await createWorkflow({
          name: plan.name?.trim() || "AI Workflow",
          connectionId: studio.connection.id,
          nodes,
          edges,
        });
        if (res.success && res.data?.id) {
          studio.openWorkflowsTab(res.data.id, res.data.name || "AI Workflow");
          toast.success("Workflow created");
        } else if (res.error) {
          throw new Error(res.error);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to apply workflow",
        );
      } finally {
        setWorkflowApplying(false);
      }
    },
    [studio, workflowApplying],
  );

  useEffect(() => {
    const handleRefresh = () => {
      studio.refreshCurrentTab();
    };
    window.addEventListener("studio:refresh-current-tab", handleRefresh);
    return () =>
      window.removeEventListener("studio:refresh-current-tab", handleRefresh);
  }, [studio.refreshCurrentTab]);

  useEffect(() => {
    const handleUniversalSearchEvent = () =>
      setIsUniversalSearchOpen((prev) => !prev);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "f" || e.key === "F")
      ) {
        e.preventDefault();
        handleUniversalSearchEvent();
      }
    };
    window.addEventListener(
      "studio:open-universal-search",
      handleUniversalSearchEvent,
    );
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(
        "studio:open-universal-search",
        handleUniversalSearchEvent,
      );
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleUniversalSearchResult = useCallback(
    (result: SearchAllResult) => {
      studio.handleTableClick(result.table_name);
      if (
        result.table_schema &&
        result.table_schema !== studio.selectedSchema
      ) {
        studio.setSelectedSchema(result.table_schema);
      }
      studio.setPendingSearchValue(result.value);
    },
    [studio],
  );

  // "New Layout": render the studio inside the shared <AppShell> (like the
  // connections/analytics screens). The studio's own GlobalHeader, sidebars and
  // per-pane tab bars are hidden; AppShell provides the chrome and the studio
  // editor tabs are routed into AppShell's tab strip. "Modern UI" is a separate
  // copy of the New Layout (its own shell with a navigation rail).
  const appShellLayout = studio.appShellLayout;
  const modernUiLayout = studio.modernUiLayout;
  const shellLayout = appShellLayout || modernUiLayout;
  const splitEnabled = !!(studio.splitView?.enabled);
  const sleekChrome = studio.activeSleekLayout && !shellLayout;

  const appShellTabs: AppTab[] = (studio.openTabs || []).map((t: any) => {
    const Icon = STUDIO_TAB_ICONS[t.type] ?? STUDIO_TAB_ICONS["table"];
    return {
      id: t.id,
      kind: "connections" as const,
      title: t.name,
      icon: <Icon className="size-4" />,
      paneId:
        studio.splitView?.enabled && studio.splitView.root
          ? resolvePaneForTab(studio.splitView, t.id)
          : undefined,
    };
  });

  // The contextual explorer panel for the active sidebar section, reused by both
  // the normal sidebar (beside the rail) and the New Layout's drill-in sidebar.
  const studioExplorers = (
    <>
      {studio.sidebarView === "dashboard" && (
        <DashboardSidebar
          dashboards={studio.dashboards}
          folders={studio.dashboardFolders}
          activeTabId={studio.activeTabId}
          openDashboardTab={studio.openDashboardTab}
          createDashboard={studio.createDashboard}
          updateDashboard={studio.updateDashboard}
          onToggleShareDashboard={studio.toggleDashboardShare}
          onUpdateDashboardPermissions={studio.updateDashboardPermissions}
          sharingDashboardId={studio.sharingDashboardId}
          receivedSharedDashboards={studio.receivedSharedDashboards}
          deleteDashboard={studio.deleteDashboard}
          addFolder={studio.addDashboardFolder}
          updateFolder={studio.updateDashboardFolder}
          deleteFolder={studio.deleteDashboardFolder}
          isCloudEnabled={studio.canUseCloudDashboards}
          onRefresh={studio.refreshDashboards}
          sleek={studio.activeSleekLayout}
          onStartSplitDrag={handleDashboardStartSplitDrag}
          onEndSplitDrag={handleDashboardEndSplitDrag}
          quickCreateDashboard={() => studio.createDashboard("New Dashboard")}
          onExportDashboards={studio.handleExportDashboards}
          onImportDashboards={studio.handleImportDashboards}
        />
      )}

      {studio.sidebarView === "database" && (
        <DatabaseSidebar
          dbType={studio.dbType}
          setDatabaseView={studio.openDatabaseTab}
          openCreateDatabaseTab={studio.openCreateDatabaseTab}
          onOpenSpacetimeDbReducers={studio.openSpacetimeDbReducers}
          onOpenSpacetimeDbLogs={studio.openSpacetimeDbLogs}
          onOpenSpacetimeDbSchema={studio.openSpacetimeDbSchema}
          activeTabId={studio.activeTabId}
          sleek={studio.activeSleekLayout}
        />
      )}

      {studio.sidebarView === "auth" && (
        <AuthSidebar
          hasAuthSchema={studio.schemas.includes("auth")}
          activeView={activeAuthView}
          onOpenUsers={studio.openAuthUsersTab}
          onOpenSessions={studio.openAuthSessionsTab}
          onOpenProviders={studio.openAuthProvidersTab}
          sleek={studio.activeSleekLayout}
        />
      )}

      {studio.sidebarView === "tables" && studio.databaseExplorer && (
        <DatabaseExplorerSidebar
          dbType={studio.dbType}
          schemas={studio.schemas}
          selectedSchema={studio.selectedSchema}
          setSelectedSchema={studio.setSelectedSchema}
          allSchemaTables={studio.allSchemaTables}
          fetchingAllSchema={studio.fetchingAllSchema}
          loadAllSchemaData={studio.loadAllSchemaData}
          handleTableClick={studio.handleTableClick}
          openCreateTableTab={studio.openCreateTableTab}
          openSqlEditor={studio.openSqlEditor}
          copyTableSchema={studio.copyTableSchema}
          duplicateTable={studio.duplicateTable}
          emptyTable={studio.emptyTable}
          deleteTable={studio.deleteTable}
          viewTableSchema={studio.viewTableSchema}
          sleek={studio.activeSleekLayout}
        />
      )}

      {studio.sidebarView === "tables" && !studio.databaseExplorer && (
        <ExplorerSidebar
          dbType={studio.dbType}
          schemas={studio.schemas}
          selectedSchema={studio.selectedSchema}
          setSelectedSchema={studio.setSelectedSchema}
          fetchingSchemas={studio.fetchingSchemas}
          tables={studio.tables}
          selectedTable={studio.selectedTable}
          fetchingTables={studio.fetchingTables}
          tableSearch={studio.tableSearch}
          setTableSearch={studio.setTableSearch}
          viewTables={studio.viewTables}
          openTabs={studio.openTabs}
          activeTabId={studio.activeTabId}
          handleTableClick={studio.handleTableClick}
          schemaData={studio.schemaData}
          openCreateTableTab={studio.openCreateTableTab}
          openCreateKeyTab={studio.openCreateKeyTab}
          refreshTablesSidebar={studio.refreshTablesSidebar}
          openCreateSchemaTab={studio.openCreateSchemaTab}
          tags={studio.tags}
          tableTags={studio.tableTags}
          sidebarSortMode={studio.sidebarSortMode}
          setSidebarSortMode={studio.setSidebarSortMode}
          addTag={studio.addTag}
          toggleTableTag={studio.toggleTableTag}
          openSqlEditor={studio.openSqlEditor}
          copyTableSchema={studio.copyTableSchema}
          duplicateTable={studio.duplicateTable}
          emptyTable={studio.emptyTable}
          deleteTable={studio.deleteTable}
          exportData={studio.exportData}
          sleek={studio.activeSleekLayout}
          schemaExplorer={studio.schemaExplorer}
          tableExpansion={studio.tableExpansion}
          functions={studio.functions}
          triggers={studio.triggers}
          indexes={studio.indexes}
          onCopyFunction={studio.copyFunctionSchema}
          onCopyTrigger={studio.copyTriggerSchema}
          onCopyIndex={studio.copyIndexSchema}
          viewTableSchema={studio.viewTableSchema}
          enums={studio.enums}
          fetchingEnums={studio.fetchingEnums}
          onCopyEnum={studio.copyEnumSchema}
          onEditEnum={studio.openEditEnumTab}
          onDeleteEnum={studio.handleDeleteEnum}
          openCreateEnumTab={studio.openCreateEnumTab}
        />
      )}

      {studio.sidebarView === "sql" && (
        <SqlSnippetsSidebar
          snippets={studio.snippets}
          folders={studio.folders}
          onSelectSnippet={studio.openSnippet}
          onAddSnippet={studio.addSnippet}
          onUpdateSnippet={studio.updateSnippet}
          onDeleteSnippet={studio.deleteSnippet}
          onAddFolder={studio.addFolder}
          onUpdateFolder={studio.updateFolder}
          onDeleteFolder={studio.deleteFolder}
          onToggleShareSnippet={studio.toggleSnippetShare}
          onUpdateSnippetPermissions={studio.updateSnippetPermissions}
          sharingSnippetId={studio.sharingSnippetId}
          receivedSharedSnippets={studio.receivedSharedSnippets}
          currentQuery={studio.query}
          onRefresh={studio.refreshCloudSnippets}
          isCloudEnabled={studio.canUseCloudSnippets}
          activeTabId={studio.activeTabId}
          sleek={studio.activeSleekLayout}
          onStartSplitDrag={handleSnippetStartSplitDrag}
          onEndSplitDrag={handleSnippetEndSplitDrag}
          onOpenSqlEditor={studio.openSqlEditor}
          onImportSnippets={studio.handleImportSnippets}
        />
      )}

      {studio.sidebarView === "workflows" && (
        <WorkflowsSidebar
          connectionId={studio.connection.id}
          openWorkflowsTab={studio.openWorkflowsTab}
          sleek={studio.activeSleekLayout}
        />
      )}
    </>
  );

  const agentSchemaContext = Object.values(studio.schemaData || {})
    .map((entry: any) => ({
      schema: String(entry?.schema || studio.selectedSchema || ""),
      table: String(entry?.name || ""),
      columns: Array.isArray(entry?.columns)
        ? entry.columns.slice(0, 20).map((column: any) => ({
            name: String(column?.name || ""),
            type: String(column?.type || "text"),
          }))
        : [],
    }))
    .filter((entry: any) => entry.table);

  const aiChatSheetProps = {
    dashboardApplyLabel:
      aiDashboardTarget.mode === "edit" ? "Apply Changes" : "Create Dashboard",
    dashboards: studio.dashboards,
    isOpen: isAiSheetOpen,
    initialPrompt: aiInitialPrompt,
    initialChatId: aiInitialChatId,
    startNewChatToken: aiStartNewChatToken,
    initialChatSelectToken: aiSelectChatToken,
    onActiveChatChange: (chatId: string | null) => setAiActiveChatId(chatId),
    onOpenChange: (nextOpen: boolean) => {
      if (nextOpen) {
        setIsGlobalSqlSheetOpen(false);
      } else {
        setAiInitialPrompt(null);
        setAiDashboardTarget({ mode: "create" });
      }
      setIsAiSheetOpen(nextOpen);
    },
    connectionId: studio.connection.id,
    connectionString: studio.currentConnectionString,
    dbType: studio.dbType,
    selectedNamespace: studio.selectedSchema,
    schemaContext: agentSchemaContext,
    onOpenSettings: () => studio.openSettingsTab("ai"),
    onRunSql: handleRunAiSql,
    onSendToSql: handleSendAiSqlToEditor,
    onApplyDashboard: handleApplyAiDashboard,
    workflowContext,
    onApplyWorkflow: handleApplyAiWorkflow,
    workflowApplyBusy: workflowApplying,
    sleek: studio.activeSleekLayout,
    customAppThemes: studio.customAppThemes,
    setCustomAppThemes: studio.setCustomAppThemes,
    setAppThemeId: studio.setAppThemeId,
    customEditorThemes: studio.customEditorThemes,
    setCustomEditorThemes: studio.setCustomEditorThemes,
    setEditorThemeId: studio.setEditorThemeId,
  };

  const layout = (
    <div
      className={cn(
        "flex flex-col text-foreground overflow-hidden",
        shellLayout
          ? "h-full relative"
          : cn(
              "h-screen bg-background",
              studio.activeSleekLayout &&
                "px-2.5 pb-2.5 pt-0 gap-2.5 bg-muted/20",
            ),
      )}
    >
      {!shellLayout && (
      <div
        className={cn(
          "shrink-0",
          sleekChrome &&
            "rounded-b-xl rounded-t-none border border-studio-border/80 bg-background overflow-hidden shadow-sm",
        )}
      >
        <GlobalHeader
          connection={studio.connection}
          dbType={studio.dbType}
          selectedSchema={studio.selectedSchema}
          selectedTable={studio.selectedTable}
          onHistoryClick={studio.openHistoryTab}
          onAnalyticsClick={studio.openAnalyticsTab}
          onAdvisorClick={studio.openAdvisorTab}
          onSearchClick={() => setIsUniversalSearchOpen(true)}
          databases={studio.databases}
          currentDatabase={studio.currentDatabase}
          onDatabaseChange={studio.handleDatabaseChange}
          onSqlEditorSheetClick={handleToggleGlobalSqlSheet}
          isSqlEditorOpen={isGlobalSqlSheetOpen}
          onAiAssistantClick={handleToggleAiSheet}
          isAiAssistantOpen={isAiSheetOpen}
          onAgentsClick={handleToggleAgentsPanel}
          onProfileSettingsClick={studio.openProfileSettingsTab}
          onKeybindingsClick={studio.openKeybindingsTab}
          onToggleNavigator={() =>
            studio.setIsSidebarVisible(!studio.isSidebarVisible)
          }
          isNavigatorVisible={studio.isSidebarVisible}
          searchSettings={studio.searchSettings}
          studio={studio}
        />
      </div>
      )}

      <CommandMenu
        dbType={studio.dbType}
        isOpen={studio.isCommandMenuOpen}
        onOpenChange={studio.setIsCommandMenuOpen}
        tables={studio.tables}
        functions={studio.functions}
        schemas={studio.schemas}
        onSelectTable={studio.handleTableClick}
        onSelectFunction={() => {
          studio.openDatabaseTab("functions");
        }}
        onSelectSchema={(schema) => studio.setSelectedSchema(schema)}
        onNewQuery={studio.openSqlEditor}
        onRefresh={studio.refreshCurrentTab}
        onCreateDatabase={studio.openCreateDatabaseTab}
        onCreateSchema={studio.openCreateSchemaTab}
        onCreateTable={studio.openCreateTableTab}
        onCreateEnum={studio.openCreateEnumTab}
        onCreateIndex={studio.openCreateIndexTab}
        onCreateTrigger={studio.openCreateTriggerTab}
        onNewConnection={openManageConnections}
        onToggleSidebar={() => studio.toggleSidebar?.()}
        onOpenHistory={studio.openHistoryTab}
        onOpenSnapshots={studio.openSnapshotsTab}
        onOpenDiagram={() => {
          studio.openDatabaseTab("schema");
        }}
        onOpenExportTab={studio.openImportExportTab}
        onUniversalSearch={() => {
          studio.setIsCommandMenuOpen(false);
          setIsUniversalSearchOpen(true);
        }}
        onOpenSpacetimeDbReducers={studio.openSpacetimeDbReducers}
        onOpenSpacetimeDbLogs={studio.openSpacetimeDbLogs}
        onOpenSpacetimeDbSchema={studio.openSpacetimeDbSchema}
        commandMenuSections={studio.commandMenuSections}
        keybindings={studio.keybindings}
      />

      <UniversalSearch
        isOpen={isUniversalSearchOpen}
        onOpenChange={setIsUniversalSearchOpen}
        connectionString={studio.currentConnectionString}
        connectionType={undefined}
        onSelectResult={handleUniversalSearchResult}
        localIndexEnabled={studio.searchSettings?.localIndexEnabled === true}
      />

      <ShortcutNavigator
        isOpen={studio.isShortcutNavigatorOpen}
        onOpenChange={studio.setIsShortcutNavigatorOpen}
        keybindings={studio.keybindings}
        onRunBinding={studio.executeKeybindingAction}
        onOpenKeybindings={studio.openKeybindingsTab}
        onOpenCommandMenu={() => studio.setIsCommandMenuOpen(true)}
      />

      <div
        className={cn(
          "flex flex-1 overflow-hidden relative",
          sleekChrome && "gap-2.5",
        )}
        data-dropdown-blur-target="true"
      >
        {!shellLayout && studio.isSidebarVisible && (
          <div
            className={cn(
              "flex shrink-0 h-full",
              sleekChrome &&
                "rounded-lg border border-studio-border/80 bg-background overflow-hidden shadow-sm",
            )}
          >
            <div
              className={cn(
                "relative shrink-0",
                studio.sidebarBehavior === "open" ? "w-56" : "w-12",
              )}
              onMouseEnter={() => {
                if (studio.sidebarBehavior === "expandable") {
                  studio.setSidebarHoverOpen(true);
                }
              }}
              onMouseLeave={() => {
                if (studio.sidebarBehavior === "expandable") {
                  studio.setSidebarHoverOpen(false);
                }
              }}
            >
              <NavigationRail
                sidebarView={studio.sidebarView}
                setSidebarView={studio.setSidebarView}
                onDashboardClick={() => {
                  studio.setSidebarView("dashboard");
                }}
                onTableClick={() => {
                  studio.setSidebarView("tables");
                }}
                onSqlClick={() => {
                  studio.setSidebarView("sql");
                }}
                onDatabaseClick={() => {
                  studio.setSidebarView("database");
                }}
                onSettingsClick={studio.openSettingsTab}
                onAgentsClick={handleToggleAgentsPanel}
                onConnectStudioClick={studio.openConnectStudioTab}
                dbType={studio.dbType}
                connectionType={studio.connection?.connectionType ?? undefined}
                sidebarBehavior={studio.sidebarBehavior}
                setSidebarBehavior={studio.setSidebarBehavior}
                railExpanded={studio.isNavigationRailExpanded}
                hasAuth={studio.schemas.includes("auth")}
                schemaExplorer={studio.schemaExplorer}
                databaseExplorer={studio.databaseExplorer}
                tableExpansion={studio.tableExpansion}
              />
            </div>

            {studioExplorers}
          </div>
        )}

        <div
          className={cn(
            "flex-1 min-w-0 flex flex-col h-full relative",
            sleekChrome &&
              "rounded-lg border border-studio-border/80 bg-background overflow-hidden shadow-sm",
          )}
        >
          <StudioMainContent
            connection={studio.connection}
            onEditDashboardWithAi={handleEditDashboardWithAi}
            onOpenThemeCreator={handleOpenThemeCreator}
            onOpenIconThemeCreator={handleOpenIconThemeCreator}
            onAskAI={handleToggleAiSheet}
            studio={studio}
            snippetSplitDrag={studio.snippetSplitDrag}
            dashboardSplitDrag={studio.dashboardSplitDrag}
            tabSplitDrag={studio.tabSplitDrag}
            hideTabBar={shellLayout && !splitEnabled}
            paneTabsVariant={shellLayout ? "modern" : "classic"}
          />
        </div>

        <div
          className={cn(
            "shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
            isThemeCreatorOpen ? "w-[340px]" : "w-0",
          )}
        >
          <ThemeCreatorPanel
            isOpen={isThemeCreatorOpen}
            onClose={handleCloseThemeCreator}
            activeTheme={selectedAppTheme}
            customAppThemes={studio.customAppThemes}
            builtInAppThemes={BUILTIN_APP_THEMES}
            onSaveTheme={handleSaveTheme}
          />
        </div>

        <div
          className={cn(
            "shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
            isIconThemeCreatorOpen ? "w-[340px]" : "w-0",
          )}
        >
          <IconThemeCreatorPanel
            isOpen={isIconThemeCreatorOpen}
            onClose={handleCloseIconThemeCreator}
            iconThemeId={studio.iconThemeId}
            customIconThemes={studio.customIconThemes}
            onSaveIconTheme={handleSaveIconTheme}
          />
        </div>

        {!modernUiLayout && (
          <AiChatSheet {...aiChatSheetProps} floating={appShellLayout} />
        )}

        {/* Classic / non-Modern: SQL editor as a side sheet. Modern UI mounts
            the same panel in-flow next to the content (like AI chat). */}
        {!modernUiLayout && (
          <SqlEditorPanel
            isOpen={isGlobalSqlSheetOpen}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setIsAiSheetOpen(false);
              }
              setIsGlobalSqlSheetOpen(nextOpen);
            }}
            sleek={studio.activeSleekLayout}
            connectionId={studio.connection.id}
            connectionString={studio.currentConnectionString}
            dbType={
              studio.dbType === "federated" || studio.dbType === "jdbc" || studio.dbType === "supabase-mgmt"
                ? "postgres"
                : studio.dbType
            }
            query={globalSqlQuery}
            setQuery={setGlobalSqlQuery}
            error={globalSqlSheetState?.error ?? null}
            results={globalSqlSheetState?.results ?? null}
            loading={Boolean(globalSqlSheetState?.loading)}
            executionTime={globalSqlSheetState?.executionTime ?? 0}
            handleRunQuery={(nextQuery) =>
              studio.runSqlContextQuery(
                studio.globalSqlContextId,
                nextQuery ?? globalSqlQuery,
              )
            }
            handleStopQuery={() =>
              studio.stopSqlContextQuery(studio.globalSqlContextId)
            }
            canStopQuery={Boolean(
              globalSqlSheetState?.loading && globalSqlSheetState?.activeQueryId,
            )}
            toggleAllSelection={studio.toggleAllSelection}
            selectedRows={studio.selectedRows}
            tableStructure={studio.tableStructure}
            toggleRowSelection={studio.toggleRowSelection}
            setSelectedCell={studio.setSelectedCell}
            selectedCell={studio.selectedCell}
            snippets={studio.snippets}
            folders={studio.folders}
            addSnippet={studio.addSnippet}
            updateSnippet={studio.updateSnippet}
            deleteSnippet={studio.deleteSnippet}
            createSnippetVersion={studio.createSnippetVersion}
            getSnippetVersions={studio.getSnippetVersions}
            restoreSnippetVersion={studio.restoreSnippetVersion}
            addFolder={studio.addFolder}
            updateFolder={studio.updateFolder}
            deleteFolder={studio.deleteFolder}
            activeTabId={studio.activeTabId}
            vimMode={studio.vimMode}
            sqlEditorEngine={studio.sqlEditorEngine}
            editorFontSize={studio.editorFontSize}
            editorFontFamily={studio.editorFontFamily}
            editorThemeId={studio.effectiveEditorThemeId}
            customEditorThemes={studio.customEditorThemes}
            appEditorTheme={studio.appEditorTheme}
            sqlFormatTabWidth={studio.sqlFormatTabWidth}
            sqlFormatUseTabs={studio.sqlFormatUseTabs}
            sqlFormatKeywordCase={studio.sqlFormatKeywordCase}
            sqlFormatDataTypeCase={studio.sqlFormatDataTypeCase}
            sqlFormatFunctionCase={studio.sqlFormatFunctionCase}
            sqlFormatIdentifierCase={studio.sqlFormatIdentifierCase}
            sqlFormatLogicalOperatorNewline={
              studio.sqlFormatLogicalOperatorNewline
            }
            sqlFormatExpressionWidth={studio.sqlFormatExpressionWidth}
            sqlFormatLinesBetweenQueries={studio.sqlFormatLinesBetweenQueries}
            sqlFormatDenseOperators={studio.sqlFormatDenseOperators}
            sqlFormatNewlineBeforeSemicolon={
              studio.sqlFormatNewlineBeforeSemicolon
            }
            onOpenAiSettings={() => studio.openSettingsTab("ai")}
            selectedNamespace={studio.selectedSchema}
            schemaData={studio.schemaData}
            gridProps={{
              pendingActions: studio.pendingActions,
              setSelectedRows: studio.setSelectedRows,
              toggleAllSelection: studio.toggleAllSelection,
              toggleRowSelection: studio.toggleRowSelection,
              getRowId: studio.getRowId,
              pendingChanges: studio.pendingChanges,
              setPendingChanges: studio.setPendingChanges,
              editingCell: studio.editingCell,
              setEditingCell: studio.setEditingCell,
              selectedColumn: studio.selectedColumn,
              setSelectedColumn: studio.setSelectedColumn,
              hasChanges: studio.hasChanges,
              getChangedValue: studio.getChangedValue,
              handleUpdateRow: studio.handleUpdateRow,
              handleFKSelection: studio.handleFKSelection,
              handleFKPreview: studio.handleFKPreview,
              fetchingStructure: studio.fetchingStructure,
              isAddColumnSheetOpen: studio.isAddColumnSheetOpen,
              setIsAddColumnSheetOpen: studio.setIsAddColumnSheetOpen,
              isAddingColumn: studio.isAddingColumn,
              handleAddColumn: studio.handleAddColumn,
              handleDeleteColumn: studio.handleDeleteColumn,
              columnToDelete: studio.columnToDelete,
              setColumnToDelete: studio.setColumnToDelete,
              selectedTable: studio.selectedTable,
              selectedSchema: studio.selectedSchema,
              sortConfig: studio.sortConfig ?? null,
              setSortConfig: (
                config: { column: string; direction: "ASC" | "DESC" } | null,
              ) => studio.setSortConfig(config),
              pageSize: studio.pageSize,
              page: studio.page,
              totalCount: studio.totalCount,
              onPageChange: studio.handlePageChange,
              onPageSizeChange: studio.handlePageSizeChange,
              onDuplicateRow: studio.handleDuplicateRow,
              onCopyRowJSON: studio.onCopyRowJSON,
              onCopyRowCSV: studio.onCopyRowCSV,
              onFilterByCell: handleFilterByCell,
              onOpenInsertSheet: () => studio.setIsInsertSheetOpen(true),
              rowSpacing: studio.rowSpacing,
              alternatingRowColors: studio.alternatingRowColors,
              connectionString: studio.currentConnectionString,
              foreignKeys: studio.foreignKeys,
              enums: studio.enums,
              showPaginationFooter: true,
              isKeyboardInputSuspended:
                studio.isCommandMenuOpen || studio.isShortcutNavigatorOpen,
            }}
          />
        )}
      </div>

      <FKSelectionSheet
        isFKSelectionSheetOpen={studio.isFKSelectionSheetOpen}
        setIsFKSelectionSheetOpen={studio.setIsFKSelectionSheetOpen}
        fkSelectionTarget={studio.fkSelectionTarget}
        fkSelectionSearch={studio.fkSelectionSearch}
        setFKSelectionSearch={studio.setFKSelectionSearch}
        fkSelectionData={studio.fkSelectionData}
        fkSelectionLoading={studio.fkSelectionLoading}
        selectFKRecord={studio.selectFKRecord}
        rowSpacing={studio.rowSpacing}
        alternatingRowColors={studio.alternatingRowColors}
      />

      <AddFKSheet
        isOpen={studio.isAddFKSheetOpen}
        onOpenChange={studio.setIsAddFKSheetOpen}
        data={studio.newFKData}
        onConfirm={studio.handleAddForeignKey}
      />

      <InsertRowSheet
        isInsertSheetOpen={studio.isInsertSheetOpen}
        setIsInsertSheetOpen={studio.setIsInsertSheetOpen}
        selectedTable={studio.selectedTable}
        tableStructure={studio.tableStructure}
        insertData={studio.insertData}
        setInsertData={studio.setInsertData}
        handleInsertRow={studio.handleInsertRow}
        handleInsertFKSelection={studio.handleInsertFKSelection}
        loading={studio.mutationLoading}
        isFKSelectionSheetOpen={studio.isFKSelectionSheetOpen}
      />

      <Sheet
        open={isAgentsPanelOpen}
        onOpenChange={setIsAgentsPanelOpen}
        modal={!shellLayout}
      >
        <SheetContent
          side="right"
          contained={shellLayout}
          showCloseButton={false}
          className="p-0 gap-0 flex flex-col"
          style={{ width: "min(420px, 92vw)" }}
          minResizeWidth={320}
          maxResizeWidth={700}
          resizeHandleLabel="Resize agents panel"
        >
          <SheetTitle className="sr-only">Agents</SheetTitle>
          <AgentsPanel
            isOpen={isAgentsPanelOpen}
            onOpenChange={setIsAgentsPanelOpen}
            connectionId={studio.connection.id}
            connectionString={studio.currentConnectionString}
            dbType={studio.dbType}
            selectedNamespace={studio.selectedSchema}
            schemaContext={agentSchemaContext}
          />
        </SheetContent>
      </Sheet>

      {studio.tabSplitDrag && (
        <div
          className="fixed pointer-events-none select-none z-[99999] h-10 flex items-center gap-2 px-3 text-xs border border-studio-border bg-studio-tab-active text-foreground shadow-lg"
          style={{
            left: studio.tabSplitDrag.mouseX - 70,
            top: studio.tabSplitDrag.mouseY - 20,
            minWidth: 140,
            maxWidth: 220,
          }}
        >
          <span className="truncate flex-1 text-left font-medium">
            {studio.tabSplitDrag.tab.name}
          </span>
        </div>
      )}
    </div>
  );

  const appShellProps = {
    tabs: appShellTabs,
    activeTabId: studio.activeTabId ?? undefined,
    onActivateTab: (id: string) => studio.switchTab(id),
    onCloseTab: (id: string) => studio.closeTabById?.(id),
    onNewTab: () => studio.openSqlEditor(),
    sidebarContent: <StudioShellSidebar studio={studio} />,
    sidebarOpen: studio.isSidebarVisible,
    onSidebarOpenChange: studio.setIsSidebarVisible,
    onAskAI: handleToggleAiSheet,
    isAskAIOpen: isAiSheetOpen,
    onAgentsClick: handleToggleAgentsPanel,
    onQueryHistory: studio.openHistoryTab,
    user: { name: displayName, email: authUser?.email },
    noiseBgEnabled: studio.noiseBgEnabled,
    noiseBgOpacity: studio.noiseBgOpacity,
    noiseBgSize: studio.noiseBgSize,
    noiseBgBlendMode: studio.noiseBgBlendMode,
    noiseBgColor: studio.noiseBgColor,
    noiseBgTranslucent: studio.noiseBgTranslucent,
  };

  // Rendered as a stable sibling in every branch below (same position in the
  // tree each time) so switching shells — Modern UI / New Layout / plain —
  // never unmounts/remounts the dialog while it's open. It used to live
  // inside ModernUIShell's own branch only, so flipping the layout toggle
  // while Modern UI's dialog was open swapped it for a structurally
  // different tree (AppShell + a sibling Dialog vs. a Dialog nested deep
  // inside ModernUIShell) — React tore the whole thing down and remounted a
  // fresh SettingsView, which just looked like the modal "re-rendering"
  // without the shell underneath ever visibly changing.
  const settingsDialog = (
    <Dialog open={studio.settingsModalOpen} onOpenChange={studio.setSettingsModalOpen}>
      <DialogContent
        hideCloseButton
        className="h-[80vh] w-[80vw] !max-w-[80vw] flex flex-col overflow-hidden p-0 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        overlayClassName="bg-black/40"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SettingsView studio={studio} />
      </DialogContent>
    </Dialog>
  );

  if (modernUiLayout) {
    const threadsPanel = (
      <AiThreadsSidebar
        connectionId={studio.connection.id}
        activeChatId={aiActiveChatId ?? aiInitialChatId}
        onSelectChat={(chatId) => {
          setAiInitialChatId(chatId);
          setAiSelectChatToken((t) => t + 1);
          setAiDashboardTarget({ mode: "create" });
          setIsAiSheetOpen(true);
        }}
        onNewChat={() => {
          setAiInitialChatId(null);
          setAiInitialPrompt(null);
          setAiDashboardTarget({ mode: "create" });
          setAiStartNewChatToken((token) => token + 1);
          setIsAiSheetOpen(true);
        }}
        onClose={() => setIsThreadsOpen(false)}
      />
    );
    // Cmd+E SQL sheet: same in-flow column pattern as AI chat (not the bottom panel).
    const sqlSheetPanel = (
      <SqlEditorPanel
        embedded
        isOpen={isGlobalSqlSheetOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setIsAiSheetOpen(false);
          setIsGlobalSqlSheetOpen(nextOpen);
        }}
        sleek={studio.activeSleekLayout}
        connectionId={studio.connection.id}
        connectionString={studio.currentConnectionString}
        dbType={
          studio.dbType === "federated" || studio.dbType === "jdbc" || studio.dbType === "supabase-mgmt"
            ? "postgres"
            : studio.dbType
        }
        query={globalSqlQuery}
        setQuery={setGlobalSqlQuery}
        error={globalSqlSheetState?.error ?? null}
        results={globalSqlSheetState?.results ?? null}
        loading={Boolean(globalSqlSheetState?.loading)}
        executionTime={globalSqlSheetState?.executionTime ?? 0}
        handleRunQuery={(nextQuery) =>
          studio.runSqlContextQuery(
            studio.globalSqlContextId,
            nextQuery ?? globalSqlQuery,
          )
        }
        handleStopQuery={() =>
          studio.stopSqlContextQuery(studio.globalSqlContextId)
        }
        canStopQuery={Boolean(
          globalSqlSheetState?.loading && globalSqlSheetState?.activeQueryId,
        )}
        toggleAllSelection={studio.toggleAllSelection}
        selectedRows={studio.selectedRows}
        tableStructure={studio.tableStructure}
        toggleRowSelection={studio.toggleRowSelection}
        setSelectedCell={studio.setSelectedCell}
        selectedCell={studio.selectedCell}
        snippets={studio.snippets}
        folders={studio.folders}
        addSnippet={studio.addSnippet}
        updateSnippet={studio.updateSnippet}
        deleteSnippet={studio.deleteSnippet}
        createSnippetVersion={studio.createSnippetVersion}
        getSnippetVersions={studio.getSnippetVersions}
        restoreSnippetVersion={studio.restoreSnippetVersion}
        addFolder={studio.addFolder}
        updateFolder={studio.updateFolder}
        deleteFolder={studio.deleteFolder}
        activeTabId={studio.activeTabId}
        vimMode={studio.vimMode}
        sqlEditorEngine={studio.sqlEditorEngine}
        editorFontSize={studio.editorFontSize}
        editorFontFamily={studio.editorFontFamily}
        editorThemeId={studio.effectiveEditorThemeId}
        customEditorThemes={studio.customEditorThemes}
        appEditorTheme={studio.appEditorTheme}
        sqlFormatTabWidth={studio.sqlFormatTabWidth}
        sqlFormatUseTabs={studio.sqlFormatUseTabs}
        sqlFormatKeywordCase={studio.sqlFormatKeywordCase}
        sqlFormatDataTypeCase={studio.sqlFormatDataTypeCase}
        sqlFormatFunctionCase={studio.sqlFormatFunctionCase}
        sqlFormatIdentifierCase={studio.sqlFormatIdentifierCase}
        sqlFormatLogicalOperatorNewline={studio.sqlFormatLogicalOperatorNewline}
        sqlFormatExpressionWidth={studio.sqlFormatExpressionWidth}
        sqlFormatLinesBetweenQueries={studio.sqlFormatLinesBetweenQueries}
        sqlFormatDenseOperators={studio.sqlFormatDenseOperators}
        sqlFormatNewlineBeforeSemicolon={studio.sqlFormatNewlineBeforeSemicolon}
        onOpenAiSettings={() => studio.openSettingsTab("ai")}
        selectedNamespace={studio.selectedSchema}
        schemaData={studio.schemaData}
        gridProps={{
          pendingActions: studio.pendingActions,
          setSelectedRows: studio.setSelectedRows,
          toggleAllSelection: studio.toggleAllSelection,
          toggleRowSelection: studio.toggleRowSelection,
          getRowId: studio.getRowId,
          pendingChanges: studio.pendingChanges,
          setPendingChanges: studio.setPendingChanges,
          editingCell: studio.editingCell,
          setEditingCell: studio.setEditingCell,
          selectedColumn: studio.selectedColumn,
          setSelectedColumn: studio.setSelectedColumn,
          hasChanges: studio.hasChanges,
          getChangedValue: studio.getChangedValue,
          handleUpdateRow: studio.handleUpdateRow,
          handleFKSelection: studio.handleFKSelection,
          handleFKPreview: studio.handleFKPreview,
          fetchingStructure: studio.fetchingStructure,
          isAddColumnSheetOpen: studio.isAddColumnSheetOpen,
          setIsAddColumnSheetOpen: studio.setIsAddColumnSheetOpen,
          isAddingColumn: studio.isAddingColumn,
          handleAddColumn: studio.handleAddColumn,
          handleDeleteColumn: studio.handleDeleteColumn,
          columnToDelete: studio.columnToDelete,
          setColumnToDelete: studio.setColumnToDelete,
          selectedTable: studio.selectedTable,
          selectedSchema: studio.selectedSchema,
          sortConfig: studio.sortConfig ?? null,
          setSortConfig: (
            config: { column: string; direction: "ASC" | "DESC" } | null,
          ) => studio.setSortConfig(config),
          pageSize: studio.pageSize,
          page: studio.page,
          totalCount: studio.totalCount,
          onPageChange: studio.handlePageChange,
          onPageSizeChange: studio.handlePageSizeChange,
          onDuplicateRow: studio.handleDuplicateRow,
          onCopyRowJSON: studio.onCopyRowJSON,
          onCopyRowCSV: studio.onCopyRowCSV,
          onFilterByCell: handleFilterByCell,
          onOpenInsertSheet: () => studio.setIsInsertSheetOpen(true),
          rowSpacing: studio.rowSpacing,
          alternatingRowColors: studio.alternatingRowColors,
          connectionString: studio.currentConnectionString,
          foreignKeys: studio.foreignKeys,
          enums: studio.enums,
          showPaginationFooter: true,
          isKeyboardInputSuspended:
            studio.isCommandMenuOpen || studio.isShortcutNavigatorOpen,
        }}
      />
    );
    return (
      <>
        <ModernUIShell
          studio={studio}
          {...appShellProps}
          aiChatPanel={<AiChatSheet {...aiChatSheetProps} embedded />}
          sqlSheetPanel={sqlSheetPanel}
          isSqlSheetOpen={isGlobalSqlSheetOpen}
          threadsPanel={threadsPanel}
          threadsOpen={isThreadsOpen}
          onToggleThreads={() => setIsThreadsOpen((open) => !open)}
          sidebarContent={<StudioShellSidebar studio={studio} hideBack />}
          sidebarOpen={studio.sidebarView !== null && studio.isSidebarVisible}
          onOpenSearch={() => setIsUniversalSearchOpen(true)}
          keybindings={studio.keybindings}
          onSidebarOpenChange={(open) => {
            studio.setIsSidebarVisible(open);
            if (!open) studio.setSidebarView(null);
            else studio.setSidebarView((current: typeof studio.sidebarView) => current ?? "tables");
          }}
          hideSettingsDialog
        >
          {layout}
        </ModernUIShell>
        {settingsDialog}
      </>
    );
  }

  if (!appShellLayout) {
    return (
      <>
        {layout}
        {settingsDialog}
      </>
    );
  }

  return (
    <>
      <AppShell {...appShellProps}>{layout}</AppShell>
      {settingsDialog}
    </>
  );
}
