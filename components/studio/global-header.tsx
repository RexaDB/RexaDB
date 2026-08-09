"use client";

import React, { useEffect, useState, useCallback } from "react";

import Link from "next/link";
import {
  Search,
  History,
  ChevronsUpDown,
  Check,
  LogOut,
  User as UserIcon,
  Database,
  Keyboard,
  PanelLeft,
  Terminal,
  Bell,
  Loader2,
  CloudOff,
  BarChart3,
  Settings,
  Plus,
  Activity,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Connection } from "@/lib/db/schema";
import { PendingChangesSheet } from "./pending-changes-sheet";
import { StudioTooltip } from "./studio-tooltip";
import { WindowControls } from "@/components/shared/window-controls";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { supabase } from "@/lib/supabase/client";
import { deleteUserProfile } from "@/lib/api/actions-client";
import { apiFetch } from "@/lib/api-base";
import {
  detectConnectionDbType,
  type ConnectionDbType,
} from "@/lib/db/connection-type";
import { usesDatabaseNamespaces } from "@/lib/db/namespace-display";
import { getEditorLabel } from "@/lib/studio/db-labels";
import { useAuthState } from "@/hooks/use-auth-state";
import {
  initStudioAuth,
  loadStudioAuth,
  getStudioUrl,
  listWorkspaces,
  switchWorkspace,
  disconnectStudioWorkspace,
  type WorkspaceInfo,
} from "@/lib/studio-backend/auth-store";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: any;
  read_at: string | null;
  created_at: string;
}

interface HeaderPendingAction {
  id: string;
  type:
    | "add_column"
    | "delete_column"
    | "rename_column"
    | "edit_column"
    | "create_table"
    | "delete_table"
    | "create_enum"
    | "delete_enum"
    | "create_index"
    | "delete_index"
    | "create_trigger"
    | "delete_trigger"
    | "create_schema"
    | "delete_schema"
    | "create_database"
    | "delete_database"
    | "delete_row"
    | "insert_row"
    | "duplicate_row"
    | "duplicate_table"
    | "empty_table"
    | "delete_function"
    | "update_function"
    | "redis_command"
    | "create_rls_policy"
    | "update_rls_policy"
    | "delete_rls_policy"
    | "add_fk";
  description: string;
  sql: string;
  params?: unknown[];
  metadata: unknown;
}

interface HeaderStudioModel {
  pendingChanges: Record<
    string,
    Record<string, { old: unknown; new: unknown }>
  >;
  setPendingChanges: React.Dispatch<
    React.SetStateAction<
      Record<string, Record<string, { old: unknown; new: unknown }>>
    >
  >;
  pendingActions: HeaderPendingAction[];
  setPendingActions: React.Dispatch<
    React.SetStateAction<HeaderPendingAction[]>
  >;
  isReviewSheetOpen: boolean;
  setIsReviewSheetOpen: (isOpen: boolean) => void;
  handleCommitChanges: () => void | Promise<void>;
  isDeleting: boolean;
  planCode?: string;
  activeSleekLayout?: boolean;
  hideWindowActions?: boolean;
  editorFontSize?: string;
  editorFontFamily?: string;
  editorThemeId?: string;
  customEditorThemes?: Array<{ id: string; name: string; themeJson: string }>;
  appEditorTheme?: { id: string } | null;
  sidebarToggleBeforeConnection?: boolean;
  openConnectStudioTab?: () => void;
  openManageWorkspacesTab?: () => void;
}

interface GlobalHeaderProps {
  connection: Connection;
  dbType: ConnectionDbType;
  selectedSchema: string;
  selectedTable: string | null;
  onHistoryClick: () => void;
  onAnalyticsClick: () => void;
  onAdvisorClick: () => void;
  onSearchClick: () => void;
  databases: string[];
  currentDatabase: string;
  onDatabaseChange: (db: string) => void;
  onSqlEditorSheetClick: () => void;
  isSqlEditorOpen: boolean;
  onAiAssistantClick: () => void;
  isAiAssistantOpen: boolean;
  onProfileSettingsClick: () => void;
  onKeybindingsClick: () => void;
  onToggleNavigator: () => void;
  isNavigatorVisible: boolean;
  searchSettings: {
    placeholder: string;
    showShortcut: boolean;
  };
  studio: HeaderStudioModel;
}

export function GlobalHeader({
  connection,
  dbType,
  selectedSchema,
  selectedTable,
  onHistoryClick,
  onAnalyticsClick,
  onAdvisorClick,
  onSearchClick,
  databases,
  currentDatabase,
  onDatabaseChange,
  onSqlEditorSheetClick,
  isSqlEditorOpen,
  onAiAssistantClick,
  isAiAssistantOpen,
  onProfileSettingsClick,
  onKeybindingsClick,
  onToggleNavigator,
  isNavigatorVisible,
  searchSettings,
  studio,
}: GlobalHeaderProps) {
  const router = useRouter();
  const openManageConnections = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
      return;
    }
    router.push("/");
  };

  const openEditConnection = (connectionId: number) => {
    if (typeof window !== "undefined") {
      window.location.href = `/?edit=${connectionId}`;
      return;
    }
    router.push(`/?edit=${connectionId}`);
  };
  const { accessToken, displayName, isSessionActive, localMode, user, userId } =
    useAuthState();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [allConnections, setAllConnections] = useState<Connection[]>([]);
  const showDatabaseDropdown = !usesDatabaseNamespaces(dbType);
  const [testingConnectionId, setTestingConnectionId] = useState<number | null>(
    null,
  );
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const openCountRef = React.useRef(0);
  const [isAnyDropdownOpen, setIsAnyDropdownOpen] = React.useState(false);
  const [activeDropdown, setActiveDropdown] = React.useState<string | null>(
    null,
  );
  const handleMenuOpenChange = React.useCallback((open: boolean) => {
    openCountRef.current += open ? 1 : -1;
    if (openCountRef.current < 0) openCountRef.current = 0;
    setIsAnyDropdownOpen(openCountRef.current > 0);
  }, []);
  const {
    isMaximized,
    sendWindowAction,
    canUseDesktop: isDesktopApp,
    isMac: isMacDesktopApp,
    isWindows: isWindowsDesktopApp,
    isLinuxCloseOnly,
  } = useDesktopWindow();
  const macLeftControlsInset = isMacDesktopApp ? 56 : 0;
  const windowsFrameInset = isWindowsDesktopApp ? "var(--tauri-frame-controls-width, 138px)" : undefined;
  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const editorLabel = getEditorLabel(dbType);
  const [studioConnected, setStudioConnected] = useState(false);
  const [studioUrlLabel, setStudioUrlLabel] = useState("");
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);
  const [currentWsName, setCurrentWsName] = useState("Studio");

  const refreshWorkspaceList = useCallback(async () => {
    const list = await listWorkspaces();
    setWorkspaceList(list);
    const auth = loadStudioAuth();
    if (auth) {
      const active = list.find((w) => w.studioUrl === getStudioUrl());
      setCurrentWsName(active?.name || "Studio");
    } else {
      setCurrentWsName("Studio");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    initStudioAuth().then(async () => {
      if (!mounted) return;
      setStudioConnected(loadStudioAuth() !== null);
      setStudioUrlLabel(getStudioUrl());
      await refreshWorkspaceList();
    });
    return () => {
      mounted = false;
    };
  }, [refreshWorkspaceList]);

  useEffect(() => {
    const handler = () => {
      setStudioConnected(loadStudioAuth() !== null);
      refreshWorkspaceList();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("workspace:changed", handler);
      return () => window.removeEventListener("workspace:changed", handler);
    }
  }, [refreshWorkspaceList]);

  const testConnection = React.useCallback(async (connectionString: string) => {
    try {
      const res = await apiFetch(`/api/connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString }),
      });
      return await res.json();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error || "Connection check failed.");
      return { success: false, error: message };
    }
  }, []);

  const shouldTestConnection = React.useCallback((conn: Connection) => {
    const type = detectConnectionDbType(conn.connectionString);
    return (
      type !== "sqlite" &&
      type !== "redis" &&
      type !== "mssql" &&
      type !== "federated"
    );
  }, []);

  const handleConnectionSwitch = React.useCallback(
    async (conn: Connection) => {
      if (conn.id === connection.id) return;
      if (testingConnectionId != null) return;
      setConnectionMenuOpen(true);
      setActiveDropdown("connection");
      if (!shouldTestConnection(conn)) {
        setTestingConnectionId(conn.id);
        router.push(`/studio/${conn.id}`);
        return;
      }
      setTestingConnectionId(conn.id);
      const res = await testConnection(conn.connectionString);
      if (!res.success) {
        setTestingConnectionId(null);
        toast.error(res.error ?? "Connection failed.");
        return;
      }
      toast.success("Connection successful.");
      // Keep spinner until navigation unmounts this header.
      router.push(`/studio/${conn.id}`);
    },
    [
      connection.id,
      router,
      shouldTestConnection,
      testConnection,
      testingConnectionId,
    ],
  );

  const loadNotifications = React.useCallback(
    async (tokenOverride?: string | null) => {
      const token = tokenOverride ?? accessToken;
      if (!token) {
        setNotifications([]);
        return;
      }
      setNotificationsLoading(true);
      try {
        const response = await apiFetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
          throw new Error(body?.error || "Failed to load notifications");
        }
        setNotifications(
          Array.isArray(body?.notifications) ? body.notifications : [],
        );
      } catch (error) {
        console.error("Failed to load notifications:", error);
      } finally {
        setNotificationsLoading(false);
      }
    },
    [accessToken],
  );

  const markNotificationsRead = React.useCallback(
    async (options: { ids?: string[]; all?: boolean }) => {
      const token = accessToken;
      if (!token) return;
      const response = await apiFetch("/api/notifications/mark-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(options),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        console.error("Failed to mark notifications read", body?.error);
        return;
      }
      await loadNotifications(token);
    },
    [accessToken, loadNotifications],
  );

  useEffect(() => {
    async function fetchConnections() {
      try {
        const studioUrl = getStudioUrl();
        const url =
          studioConnected && studioUrl
            ? `/api/connections?workspace=${encodeURIComponent(studioUrl)}`
            : "/api/connections";
        const res = await apiFetch(url);
        const body = await res.json().catch(() => null);
        if (body?.success && Array.isArray(body.data)) {
          setAllConnections(body.data);
        }
      } catch {
        setAllConnections([]);
      }
    }
    void fetchConnections();
  }, [studioConnected]);

  useEffect(() => {
    if (!accessToken) {
      setNotifications([]);
      return;
    }

    void loadNotifications(accessToken);
  }, [accessToken, loadNotifications]);

  React.useEffect(() => {
    let contentArea: HTMLElement | null = null;
    if (typeof window !== "undefined") {
      contentArea = document.querySelector("[data-dropdown-blur-target]");
    }
    if (isAnyDropdownOpen && contentArea) {
      contentArea.style.filter = "blur(4px)";
      contentArea.style.pointerEvents = "none";
      contentArea.style.transition = "filter 0.2s ease";
    } else if (contentArea) {
      contentArea.style.filter = "";
      contentArea.style.pointerEvents = "";
    }
    return () => {
      if (contentArea) {
        contentArea.style.filter = "";
        contentArea.style.pointerEvents = "";
      }
    };
  }, [isAnyDropdownOpen]);

  const handleLogout = async () => {
    if (!isSessionActive) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("rexa-db-local-mode");
        window.localStorage.removeItem("rexa-db-local-name");
      }
      await deleteUserProfile("local");
      localStorage.removeItem("Rexa DB_user");
      localStorage.removeItem("Rexa DB_user");
      router.push("/");
      return;
    }

    const sessionUserId = userId;
    if (sessionUserId) {
      await deleteUserProfile(sessionUserId);
    }
    await supabase.auth.signOut();
    localStorage.removeItem("Rexa DB_user");
    localStorage.removeItem("Rexa DB_user");
    router.push("/");
  };

  const visibleConnections = localMode
    ? allConnections.slice(0, 3)
    : allConnections;
  const sleekHeaderContentLiftClass = studio.activeSleekLayout
    ? "-translate-y-0.5"
    : "";

  const sidebarToggleEl = (
    <StudioTooltip label="Toggle Navigator">
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "w-8 h-8 hover:text-foreground/60 transition-all duration-200",
          isNavigatorVisible
            ? "text-foreground/70"
            : "text-muted-foreground/40",
          activeDropdown && "blur-[4px] pointer-events-none opacity-50",
        )}
        onClick={onToggleNavigator}
      >
        <PanelLeft className="w-3.5 h-3.5" />
      </Button>
    </StudioTooltip>
  );

  return (
    <div
      className={cn(
        "app-drag-region relative flex items-center justify-between px-4 bg-popover backdrop-blur-xl shrink-0 z-50 transition-all duration-300",
        studio.activeSleekLayout
          ? isMacDesktopApp
            ? "h-14"
            : "h-12"
          : "h-14 border-b border-studio-border",
        isMacDesktopApp ? "mac-header" : "",
      )}
      data-tauri-drag-region="deep"
      style={windowsFrameInset ? { paddingRight: windowsFrameInset } : undefined}
    >
      {/* Left */}
      <div
        className={cn(
          "flex items-center flex-1 min-w-0 transition-transform duration-300",
          studio.activeSleekLayout ? "gap-1.5 sm:gap-2" : "gap-2 sm:gap-4",
          sleekHeaderContentLiftClass,
        )}
      >
        <div
          className={cn(
            "flex items-center min-w-0",
            studio.activeSleekLayout ? "gap-1.5 sm:gap-2" : "gap-1.5 sm:gap-3",
          )}
          style={
            isMacDesktopApp
              ? { paddingLeft: `${macLeftControlsInset}px` }
              : undefined
          }
        >
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          ></Link>

          <div
            className={cn(
              "hidden sm:block w-[1px] h-4 bg-studio-border transition-all duration-200",
              activeDropdown && "blur-[4px] opacity-50",
            )}
          />

          {studio.sidebarToggleBeforeConnection && sidebarToggleEl}

          <DropdownMenu
            open={connectionMenuOpen}
            onOpenChange={(open) => {
              // Stay open while a connection is testing / navigating.
              if (!open && testingConnectionId != null) return;
              setConnectionMenuOpen(open);
              handleMenuOpenChange(open);
              setActiveDropdown(open ? "connection" : null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 sm:h-8 gap-1.5 px-1.5 sm:px-2 text-muted-foreground hover:text-foreground border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 min-w-0 transition-all duration-200",
                  activeDropdown &&
                    activeDropdown !== "connection" &&
                    "blur-[4px] pointer-events-none opacity-50",
                )}
              >
                <span className="text-[11px] sm:text-[12px] font-medium truncate max-w-[80px] sm:max-w-[100px] md:max-w-[120px]">
                  {connection.name}
                </span>
                {testingConnectionId != null ? (
                  <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin opacity-70 shrink-0" />
                ) : (
                  <ChevronsUpDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-50 shrink-0" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56 z-[70] bg-popover border-studio-border [.tui-mode_&]:border"
            >
              <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground/50 px-2 py-1.5">
                Connections
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-studio-border" />
              {studioConnected && (
                <>
                  <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate font-medium text-foreground">
                        {currentWsName}
                      </span>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await apiFetch("/api/connections/workspace", {
                          method: "DELETE",
                        });
                        disconnectStudioWorkspace();
                        window.location.href = "/";
                      }}
                      className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors shrink-0 ml-2"
                    >
                      Disconnect
                    </button>
                  </div>
                  <DropdownMenuSeparator className="bg-studio-border" />
                </>
              )}
              {visibleConnections.map((conn) => (
                <DropdownMenuItem
                  key={conn.id}
                  disabled={
                    testingConnectionId != null && testingConnectionId !== conn.id
                  }
                  onSelect={(e) => {
                    if (conn.id !== connection.id) e.preventDefault();
                    void handleConnectionSwitch(conn);
                  }}
                  className="flex items-center justify-between text-[12px] cursor-pointer group"
                >
                  <span
                    className={cn(
                      conn.id === connection.id ? "font-bold text-primary" : "",
                      "flex-1 truncate",
                    )}
                  >
                    {conn.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditConnection(conn.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-foreground"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    {testingConnectionId === conn.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    ) : conn.id === connection.id ? (
                      <Check className="w-3.5 h-3.5 text-primary" />
                    ) : null}
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-studio-border" />
              <DropdownMenuItem
                disabled={testingConnectionId != null}
                onSelect={() => {
                  openManageConnections();
                }}
                className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Manage Connections...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div
            className={cn(
              "hidden sm:block w-[1px] h-4 bg-studio-border transition-all duration-200",
              activeDropdown && "blur-[4px] opacity-50",
            )}
          />

          <div className="hidden lg:flex">
            <DropdownMenu
              onOpenChange={(open) => {
                handleMenuOpenChange(open);
                setActiveDropdown(open ? "workspace" : null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 sm:h-8 gap-1.5 px-1.5 sm:px-2 text-muted-foreground hover:text-foreground border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 min-w-0 transition-all duration-200",
                    activeDropdown &&
                      activeDropdown !== "workspace" &&
                      "blur-[4px] pointer-events-none opacity-50",
                  )}
                >
                  <Settings className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-50 shrink-0" />
                  <span className="text-[11px] sm:text-[12px] font-medium truncate max-w-[80px] lg:max-w-[120px]">
                    {studioConnected ? currentWsName : "Local"}
                  </span>
                  <ChevronsUpDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-56 z-[70] bg-popover border-studio-border [.tui-mode_&]:border"
              >
                <DropdownMenuLabel className="text-[10px] font-bold tracking-wider text-muted-foreground/50 px-2 py-1.5">
                  Workspaces
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-studio-border" />
                {workspaceList.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    {studioConnected ? (
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="font-medium text-foreground">
                          {currentWsName}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                        Local mode
                      </div>
                    )}
                  </div>
                ) : (
                  workspaceList.map((ws) => {
                    const isActive =
                      studioConnected && ws.studioUrl === getStudioUrl();
                    return (
                      <DropdownMenuItem
                        key={ws.studioUrl}
                        onClick={() => {
                          if (!isActive) {
                            switchWorkspace(ws.studioUrl).then((ok) => {
                              if (ok && typeof window !== "undefined")
                                window.location.href = "/";
                            });
                          }
                        }}
                        className="flex items-center justify-between text-[12px] cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                          />
                          <span
                            className={`truncate ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}
                          >
                            {ws.name}
                          </span>
                        </div>
                        {isActive && (
                          <Check className="w-3 h-3 text-primary shrink-0 ml-2" />
                        )}
                      </DropdownMenuItem>
                    );
                  })
                )}
                <DropdownMenuSeparator className="bg-studio-border" />
                <DropdownMenuItem
                  onClick={() => studio.openManageWorkspacesTab?.()}
                  className="text-[12px] cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 mr-2" />
                  Manage Workspaces...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => studio.openManageWorkspacesTab?.()}
                  className="text-[12px] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 mr-2" />
                  Connect Workspace
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div
            className={cn(
              "hidden lg:block w-[1px] h-4 bg-studio-border transition-all duration-200",
              activeDropdown && "blur-[4px] opacity-50",
            )}
          />

          {showDatabaseDropdown && (
            <div className="hidden xl:flex">
              <DropdownMenu
                onOpenChange={(open) => {
                  handleMenuOpenChange(open);
                  setActiveDropdown(open ? "database" : null);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 sm:h-8 gap-1.5 px-1.5 sm:px-2 text-muted-foreground hover:text-foreground border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 min-w-0 transition-all duration-200",
                      activeDropdown &&
                        activeDropdown !== "database" &&
                        "blur-[4px] pointer-events-none opacity-50",
                    )}
                  >
                    <Database className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-50 shrink-0" />
                    <span className="text-[11px] sm:text-[12px] font-medium truncate max-w-[80px] sm:max-w-[100px] md:max-w-[120px]">
                      {currentDatabase}
                    </span>
                    <ChevronsUpDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56 z-[70] bg-popover border-studio-border [.tui-mode_&]:border"
                >
                  <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground/50 px-2 py-1.5">
                    Databases
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-studio-border" />
                  {(() => {
                    const normalized = Array.from(
                      new Set(
                        databases
                          .map((db) => String(db ?? "").trim())
                          .filter((db) => db.length > 0),
                      ),
                    );
                    if (normalized.length === 0) {
                      return (
                        <DropdownMenuItem className="text-[12px] text-muted-foreground">
                          No databases
                        </DropdownMenuItem>
                      );
                    }
                    return normalized.map((db) => (
                      <DropdownMenuItem
                        key={db}
                        onClick={() => onDatabaseChange(db)}
                        className="flex items-center justify-between text-[12px] cursor-pointer"
                      >
                        <span
                          className={
                            db === currentDatabase
                              ? "font-bold text-primary"
                              : ""
                          }
                        >
                          {db}
                        </span>
                        {db === currentDatabase && (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ));
                  })()}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {!studio.sidebarToggleBeforeConnection && sidebarToggleEl}
        </div>
      </div>

      {/* Right */}
      <div
        className={cn(
          "flex items-center justify-end relative z-10 transition-transform duration-300 min-w-0",
          studio.activeSleekLayout ? "gap-1" : "gap-1.5",
          sleekHeaderContentLiftClass,
        )}
      >
        <div
          className={cn(
            "relative group hidden lg:block shrink-0 transition-all duration-200 no-drag",
            studio.activeSleekLayout
              ? "w-[140px] xl:w-[170px]"
              : "w-[160px] xl:w-[190px]",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
          data-tauri-drag-region="false"
          onClick={onSearchClick}
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-foreground/50 transition-colors" />

          <div
            className={cn(
              "w-full bg-background/15 border border-studio-border rounded-lg flex items-center px-3 pl-8 text-[11px] text-muted-foreground/60 cursor-pointer hover:bg-background/25 transition-colors select-none",
              studio.activeSleekLayout ? "h-8" : "h-9",
            )}
          >
            <span className="truncate">Search...</span>
          </div>
        </div>

        {/* Pending Changes */}
        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <PendingChangesSheet
            selectedSchema={selectedSchema}
            selectedTable={selectedTable}
            pendingChanges={studio.pendingChanges}
            setPendingChanges={studio.setPendingChanges}
            pendingActions={studio.pendingActions}
            setPendingActions={studio.setPendingActions}
            isReviewSheetOpen={studio.isReviewSheetOpen}
            setIsReviewSheetOpen={studio.setIsReviewSheetOpen}
            handleCommitChanges={studio.handleCommitChanges}
            loading={studio.isDeleting}
            editorFontSize={studio.editorFontSize}
            editorFontFamily={studio.editorFontFamily}
            editorThemeId={studio.editorThemeId}
            customEditorThemes={studio.customEditorThemes}
            appEditorTheme={studio.appEditorTheme}
          />
        </div>

        <div className="shrink-0">
          <DropdownMenu
            onOpenChange={(open) => {
              handleMenuOpenChange(open);
              setActiveDropdown(open ? "notifications" : null);
            }}
          >
            <StudioTooltip label="Notifications">
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "relative inline-flex items-center justify-center text-muted-foreground/40 hover:text-foreground/60 border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 transition-all duration-200",
                    studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
                    activeDropdown &&
                      activeDropdown !== "notifications" &&
                      "blur-[4px] pointer-events-none opacity-50",
                  )}
                >
                  <Bell className="w-3.5 h-3.5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-lg bg-destructive text-[9px] font-semibold text-destructive-foreground flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
            </StudioTooltip>
            <DropdownMenuContent
              align="end"
              className="w-80 z-[70] bg-popover border-studio-border p-0"
            >
              <DropdownMenuLabel className="text-[11px]tracking-wider text-muted-foreground px-3 py-2">
                Notifications
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-studio-border" />
              <div className="max-h-72 overflow-y-auto px-2 py-2 space-y-2">
                {notificationsLoading ? (
                  <div className="text-[11px] text-muted-foreground px-2 py-2">
                    Loading...
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground px-2 py-2">
                    No notifications
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`rounded-lg border px-3 py-2 text-[11px] ${notification.read_at ? "border-studio-border/60 text-muted-foreground" : "border-primary/30 bg-primary/5 text-foreground"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-[12px] truncate">
                            {notification.title}
                          </p>
                          {notification.body && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {notification.body}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/70 mt-1">
                            {new Date(notification.created_at).toLocaleString()}
                          </p>
                        </div>
                        {!notification.read_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void markNotificationsRead({
                                ids: [notification.id],
                              });
                            }}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <>
                  <DropdownMenuSeparator className="bg-studio-border" />
                  <DropdownMenuItem
                    className="text-[11px] cursor-pointer"
                    onSelect={(event) => {
                      event.preventDefault();
                      void markNotificationsRead({ all: true });
                    }}
                  >
                    Mark all as read
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className={cn(
            "shrink-0 hidden lg:block transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label="AI Assistant">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "border rounded-lg",
                isAiAssistantOpen
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary/80"
                  : "border-studio-border bg-background/15 text-muted-foreground/40 hover:bg-background/25 hover:text-foreground/60",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onAiAssistantClick}
            >
              <span
                aria-hidden="true"
                className="h-5 w-5 bg-current"
                style={{
                  WebkitMaskImage: "url(/AI.svg)",
                  maskImage: "url(/AI.svg)",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                }}
              />
            </Button>
          </StudioTooltip>
        </div>

        <div
          className={cn(
            "shrink-0 hidden lg:block transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label="History">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground/40 hover:text-foreground/60 border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onHistoryClick}
            >
              <History className="w-3.5 h-3.5" />
            </Button>
          </StudioTooltip>
        </div>

        <div
          className={cn(
            "shrink-0 hidden lg:block transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label="Keybindings">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground/40 hover:text-foreground/60 border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onKeybindingsClick}
            >
              <Keyboard className="w-3.5 h-3.5" />
            </Button>
          </StudioTooltip>
        </div>

        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label="Analytics">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground/40 hover:text-foreground/60 border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onAnalyticsClick}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </Button>
          </StudioTooltip>
        </div>

        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label="Advisor">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground/40 hover:text-foreground/60 border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onAdvisorClick}
            >
              <Activity className="w-3.5 h-3.5" />
            </Button>
          </StudioTooltip>
        </div>

        <div
          className={cn(
            "shrink-0 transition-all duration-200",
            activeDropdown && "blur-[4px] pointer-events-none opacity-50",
          )}
        >
          <StudioTooltip label={editorLabel}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "border rounded-lg",
                isSqlEditorOpen
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary/80"
                  : "border-studio-border bg-background/15 text-muted-foreground/40 hover:bg-background/25 hover:text-foreground/60",
                studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
              )}
              onClick={onSqlEditorSheetClick}
            >
              <Terminal className="w-3.5 h-3.5" />
            </Button>
          </StudioTooltip>
        </div>

        <div className="shrink-0">
          <DropdownMenu
            onOpenChange={(open) => {
              handleMenuOpenChange(open);
              setActiveDropdown(open ? "profile" : null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 transition-all duration-200 no-drag",
                  studio.activeSleekLayout ? "w-7 h-7" : "w-8 h-8",
                  activeDropdown &&
                    activeDropdown !== "profile" &&
                    "blur-[4px] pointer-events-none opacity-50",
                )}
              >
                <div className="w-4 h-4 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 z-[70] bg-popover border-studio-border [.tui-mode_&]:border"
            >
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{displayName}</p>
                    {user && userId !== "local" && !isSessionActive && (
                      <span title="Not synced to cloud">
                        <CloudOff className="w-3.5 h-3.5 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 w-fit">
                      {(studio.planCode || "free").charAt(0).toUpperCase() +
                        (studio.planCode || "free").slice(1)}{" "}
                      Plan
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-1">
                    {user?.email || ""}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-studio-border" />
              {!isSessionActive && userId !== "local" && (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        const redirectUrl = encodeURIComponent(
                          window.location.pathname + window.location.search,
                        );
                        window.location.href = `/auth?redirect_to=${redirectUrl}`;
                      }
                    }}
                    className="gap-2 text-[12px] cursor-pointer"
                  >
                    Sign In Again
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-studio-border" />
                </>
              )}
              {studio.planCode === "free" && user && (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.open(
                          "https://rexadb.com/pro",
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    }}
                    className="gap-2 text-[12px] cursor-pointer"
                  >
                    Upgrade to Pro
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-studio-border" />
                </>
              )}
              <DropdownMenuItem
                onClick={onProfileSettingsClick}
                className="text-[12px] cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5 mr-2" />
                Profile Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-[12px] cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-500/5"
              >
                <LogOut className="w-3.5 h-3.5 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isDesktopApp && !isMacDesktopApp && !isWindowsDesktopApp && (!studio.hideWindowActions || isLinuxCloseOnly) && (
          <div
            className={cn(
              "flex items-center gap-1 ml-1 border-l border-studio-border transition-all duration-200",
              activeDropdown && "blur-[4px] pointer-events-none opacity-50",
            )}
          >
            <WindowControls
              isMaximized={isMaximized}
              onMinimize={() => sendWindowAction("minimize")}
              onMaximizeToggle={() => sendWindowAction("maximize-toggle")}
              onClose={() => sendWindowAction("close")}
              wayland={isLinuxCloseOnly}
            />
          </div>
        )}
      </div>
    </div>
  );
}
