"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useToggleHandlers } from "@/hooks/use-selection-utils";
import { STUDIO_TAB_ICONS } from "@/lib/studio/tab-registry";
import { resolvePaneForTab } from "@/lib/studio/split-layout";
import { ModernUIShell } from "@/components/app-shell/modern-ui-shell";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SettingsView } from "@/components/studio/settings-view";
import { StudioShellSidebar } from "./studio-shell-sidebar";
import type { AppTab } from "@/components/app-shell/app-shared";
import { Connection } from "@/lib/db/schema";
import { StudioMainContent } from "./studio-main-content";
import { FKSelectionSheet } from "./fk-selection-sheet";
import { AddFKSheet } from "./database/add-fk-sheet";
import { InsertRowSheet } from "./insert-row-sheet";
import { useStudio } from "@/hooks/use-studio";
import { CommandMenu } from "./command-menu";
import { UniversalSearch } from "./universal-search";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  type SearchAllResult,
} from "@/lib/api/actions-client";

import { ShortcutNavigator } from "./shortcut-navigator";
import { AiChatSheet } from "./ai/ai-chat-sheet";
import { AiThreadsSidebar } from "./ai/ai-threads-sidebar";
import { openAgentsWindow } from "@/lib/agents/open-agents-window";
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
import {
  useGlobalSqlControls,
  useStudioEditorProps,
  useStudioGridProps,
} from "@/components/studio/use-global-sql-panel-props";
import type { StudioInitialUiState } from "@/lib/studio/types";
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

  const { dbType: sqlSheetDbType, handleRunQuery: handleSheetRunQuery, handleStopQuery: handleSheetStopQuery, canStopQuery: canSheetStopQuery } =
    useGlobalSqlControls(studio, globalSqlQuery, globalSqlSheetState);
  const sqlSheetGridProps = useStudioGridProps(studio, { onFilterByCell: handleFilterByCell });
  const sqlSheetEditorProps = useStudioEditorProps(studio);

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
    openAgentsWindow(studio.connection.id);
  }, [studio.connection.id]);

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

  const splitEnabled = !!(studio.splitView?.enabled);

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
    <div className="flex flex-col text-foreground overflow-hidden h-full relative">
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
        className="flex flex-1 overflow-hidden relative"
        data-dropdown-blur-target="true"
      >
        <div className="flex-1 min-w-0 flex flex-col h-full relative">
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
            hideTabBar={!splitEnabled}
            paneTabsVariant="modern"
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
    onReorderTab: (sourceId: string, targetId: string) => {
      studio.setOpenTabs((prev: typeof studio.openTabs) => {
        const fromIndex = prev.findIndex((t) => t.id === sourceId);
        const toIndex = prev.findIndex((t) => t.id === targetId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
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
      dbType={sqlSheetDbType}
      query={globalSqlQuery}
      setQuery={setGlobalSqlQuery}
      error={globalSqlSheetState?.error ?? null}
      results={globalSqlSheetState?.results ?? null}
      loading={Boolean(globalSqlSheetState?.loading)}
      executionTime={globalSqlSheetState?.executionTime ?? 0}
      handleRunQuery={handleSheetRunQuery}
      handleStopQuery={handleSheetStopQuery}
      canStopQuery={canSheetStopQuery}
      {...sqlSheetEditorProps}
      gridProps={sqlSheetGridProps}
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
        onOpenSearch={() => studio.setIsCommandMenuOpen(true)}
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
