"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Cloud,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  MoreVertical,
  Plus,
  RefreshCw,
  Download,
  Upload,
  ArrowRight,
} from "@/lib/icon-theme/lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import {
  handleFolderHover,
  handleDragRootOrElse,
  handleDropFolderExpand,
} from "@/lib/studio/drag-folder-common";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import type {
  DashboardExportData,
  KVPermission,
} from "@/lib/studio/types";
import {
  shareDashboardEntry,
} from "@/lib/supabase/workspace";
import { ShareDialog } from "./share-dialog";
import { useShareCallbacks } from "./share-callbacks";
import {
  triggerImportFileClick,
  createImportFileHandler,
} from "@/lib/studio/import-file-utils";
import {
  buildFolderTree,
  getMoveFolderOptions,
  DragGhost,
  ResizeHandle,
  CreateFolderDialog,
  FolderRenameSubfolderItems,
  FolderMoveSubmenu,
  FolderExportDeleteItems,
  FolderSelectField,
  initDragMove,
  tryStartSplitDrag,
  shouldStartDrag,
} from "./sidebar-common";
import { resetAutoExpandedFolders } from "@/components/shared/use-drag-pointer-events";
import { useDragFolderSort } from "@/hooks/use-drag-folder-sort";

interface DashboardItem {
  id: string;
  name: string;
  folderId: string | null;
  isShared?: boolean;
  sharedEntryId?: string;
}

interface DashboardFolderItem {
  id: string;
  name: string;
  parentId: string | null;
}

interface DashboardSidebarProps {
  dashboards: DashboardItem[];
  folders: DashboardFolderItem[];
  activeTabId: string | null;
  openDashboardTab: (dashboardId: string) => void;
  createDashboard: (name: string, folderId?: string | null) => void;
  updateDashboard: (
    dashboardId: string,
    updates: Partial<
      Pick<DashboardItem, "name" | "folderId" | "isShared" | "sharedEntryId">
    >,
  ) => void;
  onToggleShareDashboard?: (
    dashboardId: string,
    share: boolean,
    granteeType?: "studio" | "public",
  ) => void;
  onUpdateDashboardPermissions?: (
    entryId: string,
    permissions: KVPermission[],
  ) => Promise<void>;
  sharingDashboardId?: string | null;
  receivedSharedDashboards?: any[];
  workspaceMembers?: Array<{ id: string; name: string; email: string }>;
  deleteDashboard: (dashboardId: string) => void;
  addFolder: (name: string, parentId?: string | null) => void;
  updateFolder: (
    folderId: string,
    updates: Partial<DashboardFolderItem>,
  ) => void;
  deleteFolder: (folderId: string) => void;
  isCloudEnabled?: boolean;
  onRefresh?: () => void;
  sleek?: boolean;
  onStartSplitDrag?: (
    dashboard: DashboardItem,
    mouseX: number,
    mouseY: number,
  ) => void;
  onEndSplitDrag?: () => void;
  quickCreateDashboard?: () => void;
  onExportDashboards?: (dashboardIds: string[]) => void;
  onImportDashboards?: (data: DashboardExportData) => void;
}

export function DashboardSidebar({
  dashboards,
  folders,
  activeTabId,
  openDashboardTab,
  createDashboard,
  updateDashboard,
  onToggleShareDashboard,
  onUpdateDashboardPermissions,
  sharingDashboardId,
  receivedSharedDashboards,
  workspaceMembers,
  deleteDashboard,
  addFolder,
  updateFolder,
  deleteFolder,
  isCloudEnabled = false,
  onRefresh,
  sleek,
  onStartSplitDrag,
  onEndSplitDrag,
  quickCreateDashboard,
  onExportDashboards,
  onImportDashboards,
}: DashboardSidebarProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFolderId, setCreateFolderId] = useState<string>("__root__");
  const [newDashboardName, setNewDashboardName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<
    string | null
  >(null);
  const [shareDialogDashboard, setShareDialogDashboard] =
    useState<DashboardItem | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [editing, setEditing] = useState<{
    type: "dashboard" | "folder";
    id: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [draggingDashboardId, setDraggingDashboardId] = useState<string | null>(
    null,
  );
  const [isInternalDragging, setIsInternalDragging] = useState(false);
  const [isDraggingToSplit, setIsDraggingToSplit] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const draggingDashboardLabelRef = useRef<string>("");
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragEnterFolderTimerRef = useRef<Record<string, number>>({});
  const autoExpandedFoldersRef = useRef<Set<string>>(new Set());
  const hoverFolderIdRef = useRef<string | null>(null);
  const [openDashboardMenuId, setOpenDashboardMenuId] = useState<string | null>(
    null,
  );
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const draggingDashboardRef = useRef<DashboardItem | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const clearExpandedHover = () => {
    const prev = hoverFolderIdRef.current;
    if (prev && autoExpandedFoldersRef.current.has(prev)) {
      setCollapsedFolders((prevSet) => {
        const next = new Set(prevSet);
        next.add(prev);
        return next;
      });
      autoExpandedFoldersRef.current.delete(prev);
    }
  };
  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  useEffect(() => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      let changed = false;
      folders.forEach((folder) => {
        if (!next.has(folder.id)) {
          next.add(folder.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [folders]);

  const handleCreateDashboard = () => {
    const name = newDashboardName.trim();
    if (!name) return;
    createDashboard(
      name,
      createFolderId === "__root__" ? null : createFolderId,
    );
    setNewDashboardName("");
    setCreateFolderId("__root__");
    setIsCreateOpen(false);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    addFolder(name, creatingFolderParentId);
    setNewFolderName("");
    setCreatingFolderParentId(null);
    setIsCreatingFolder(false);
  };

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const startEdit = (
    type: "dashboard" | "folder",
    id: string,
    name: string,
  ) => {
    setEditing({ type, id });
    setEditName(name);
  };

  const saveEdit = () => {
    const nextName = editName.trim();
    if (!editing || !nextName) {
      setEditing(null);
      return;
    }
    if (editing.type === "dashboard") {
      updateDashboard(editing.id, { name: nextName });
    } else {
      updateFolder(editing.id, { name: nextName });
    }
    setEditing(null);
  };

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const openCreateDashboardDialog = (folderId: string | null = null) => {
    setCreateFolderId(folderId ?? "__root__");
    setIsCreateOpen(true);
  };

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.resolve(onRefresh());
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMove = (event: PointerEvent) => {
    if (
      !initDragMove(
        event,
        dragStartRef,
        setDragGhost,
        draggingDashboardLabelRef,
      )
    )
      return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const itemEl = element?.closest(
      "[data-dashboard-item]",
    ) as HTMLElement | null;
    const folderEl = element?.closest(
      "[data-dashboard-drop-folder]",
    ) as HTMLElement | null;
    const rootEl = element?.closest(
      "[data-dashboard-drop-root]",
    ) as HTMLElement | null;

    if (itemEl?.dataset?.dashboardFolder) {
      handleFolderHover(itemEl.dataset.dashboardFolder || null, {
        hoverFolderIdRef,
        setDragOverFolderId,
        setDragOverRoot,
        clearExpandedHover,
      });
    } else if (folderEl?.dataset?.dashboardDropFolder) {
      const folderId = folderEl.dataset.dashboardDropFolder;
      handleDropFolderExpand(
        folderId,
        collapsedFolders.has(folderId),
        {
          hoverFolderIdRef,
          setDragOverFolderId,
          setDragOverRoot,
          dragEnterFolderTimerRef,
          autoExpandedFoldersRef,
          clearExpandedHover,
        },
        setCollapsedFolders,
      );
    } else if (rootEl) {
      handleDragRootOrElse(
        true,
        {
          hoverFolderIdRef,
          setDragOverFolderId,
          setDragOverRoot,
          sidebarRef,
          setIsDraggingToSplit,
          onStartSplitDrag,
          clearExpandedHover,
        },
        tryStartSplitDrag,
        event,
        draggingDashboardRef,
      );
    } else {
      handleDragRootOrElse(
        false,
        {
          hoverFolderIdRef,
          setDragOverFolderId,
          setDragOverRoot,
          sidebarRef,
          setIsDraggingToSplit,
          onStartSplitDrag,
          clearExpandedHover,
        },
        tryStartSplitDrag,
        event,
        draggingDashboardRef,
      );
    }
  };

  const handleUp = () => {
    if (isDraggingToSplit) {
      setIsDraggingToSplit(false);
      onEndSplitDrag?.();
    } else if (dragOverFolderId) {
      updateDashboard(draggingDashboardId!, { folderId: dragOverFolderId });
    } else if (dragOverRoot) {
      updateDashboard(draggingDashboardId!, { folderId: null });
    }
    setDraggingDashboardId(null);
    setIsInternalDragging(false);
    setDragOverFolderId(null);
    setDragOverRoot(false);
    setDragGhost(null);
    dragStartRef.current = null;
    resetAutoExpandedFolders(
      autoExpandedFoldersRef,
      setCollapsedFolders,
      "add",
    );
    hoverFolderIdRef.current = null;
  };

  useDragFolderSort(draggingDashboardId, dragStartRef, handleMove, handleUp);

  const startDrag = (dashboard: DashboardItem, event: React.PointerEvent) => {
    if (!shouldStartDrag(event.target)) return;
    setDraggingDashboardId(dashboard.id);
    setIsInternalDragging(true);
    draggingDashboardLabelRef.current = dashboard.name;
    draggingDashboardRef.current = dashboard;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const importFileRef = useRef<HTMLInputElement>(null);

  const handleExportDashboard = (dashboard: DashboardItem) => {
    onExportDashboards?.([dashboard.id]);
  };

  const handleExportFolder = (folder: DashboardFolderItem) => {
    const ids = dashboards
      .filter((d) => d.folderId === folder.id)
      .map((d) => d.id);
    onExportDashboards?.(ids);
  };

  const handleExportAll = () => {
    onExportDashboards?.(dashboards.map((d) => d.id));
  };

  const getFolderDepth = (folderId: string | null): number => {
    if (!folderId) return 0;
    const f = folders.find((f) => f.id === folderId);
    return f ? 1 + getFolderDepth(f.parentId) : 0;
  };

  const handleImportClick = () => triggerImportFileClick(importFileRef);
  const handleImportFile = createImportFileHandler<DashboardExportData>({
    acceptedType: "dashboards",
    label: "dashboard",
    onImport: (data) => onImportDashboards?.(data),
  });

  const renderFolderTree = (
    nodes: Array<{
      folder: DashboardFolderItem;
      children: Array<{ folder: DashboardFolderItem; children: any }>;
    }>,
    depth: number,
  ): React.ReactNode =>
    nodes.map(({ folder, children }) => {
      const isExpanded = !collapsedFolders.has(folder.id);
      const folderDashboards = dashboards.filter(
        (d) => d.folderId === folder.id,
      );
      const moveOptions = getMoveFolderOptions(folders, folder.id);

      return (
        <div
          key={folder.id}
          className={cn(
            "rounded-lg transition-colors",
            dragOverFolderId === folder.id && "bg-blue-500/8",
          )}
        >
          <div
            className={cn(
              "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/10 select-none",
              dragOverFolderId === folder.id && "bg-blue-500/10",
              openFolderMenuId === folder.id &&
                "bg-muted/10 text-foreground",
              depth > 0 && "ml-4",
            )}
            onClick={() => toggleFolder(folder.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setOpenFolderMenuId(folder.id);
            }}
            data-dashboard-drop-folder={folder.id}
          >
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
            )}
            <span className="truncate flex-1">{folder.name}</span>
            <button
              onClick={() => openCreateDashboardDialog(folder.id)}
              className={cn(
                "rounded p-1 hover:bg-muted/10 text-muted-foreground hover:text-foreground transition-opacity",
                openFolderMenuId === folder.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
              title="New Dashboard"
            >
              <Plus className="w-3 h-3" />
            </button>
            <DropdownMenu
              open={openFolderMenuId === folder.id}
              onOpenChange={(open) =>
                setOpenFolderMenuId(open ? folder.id : null)
              }
            >
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "rounded p-1 hover:bg-muted/10 text-muted-foreground hover:text-foreground transition-opacity",
                    openFolderMenuId === folder.id
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <MoreVertical className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <FolderRenameSubfolderItems
                  onRename={() => startEdit("folder", folder.id, folder.name)}
                  onCreateSubfolder={() => {
                    setCreatingFolderParentId(folder.id);
                    setIsCreatingFolder(true);
                  }}
                />
                <FolderMoveSubmenu
                  moveOptions={moveOptions}
                  onMove={(parentId) => updateFolder(folder.id, { parentId })}
                />
                <FolderExportDeleteItems
                  onExport={() => handleExportFolder(folder)}
                  onDelete={() => deleteFolder(folder.id)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isExpanded && (
            <div className="relative mt-0.5 pl-1">
              <div className="absolute left-[15px] top-0 bottom-0 border-l border-studio-border/50" />
              <div className="space-y-0.5">
                {renderFolderTree(children, depth + 1)}
                {folderDashboards.map((dashboard) =>
                  renderDashboardItem(dashboard, depth + 1),
                )}
                {folderDashboards.length === 0 && children.length === 0 && (
                  <div className="ml-6 px-2 py-1 text-xs text-muted-foreground/70">
                    No dashboards
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    });

  const renderDashboardItem = (dashboard: DashboardItem, depth = 0) => {
    const isActive = activeTabId === `dashboard-${dashboard.id}`;
    const isEditing =
      editing?.type === "dashboard" && editing.id === dashboard.id;

    return (
      <div
        key={dashboard.id}
        data-dashboard-item
        data-dashboard-folder={dashboard.folderId ?? ""}
        className={cn(
          "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs select-none",
          depth > 0 ? "ml-6" : "ml-0",
          isActive || openDashboardMenuId === dashboard.id
            ? "bg-accent/70 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/10",
        )}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpenDashboardMenuId(dashboard.id);
        }}
        onPointerDown={(e) => startDrag(dashboard, e)}
      >
        <button
          data-allow-drag
          onClick={() => openDashboardTab(dashboard.id)}
          className="flex flex-1 items-center gap-2 min-w-0 text-left"
        >
          <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{dashboard.name}</span>
          {dashboard.isShared && (
            <span
              className="w-3 h-3 shrink-0 text-sky-400/80"
              title="Shared with workspace"
            >
              <Cloud className="w-3 h-3" aria-hidden="true" />
            </span>
          )}
        </button>
        <DropdownMenu
          open={openDashboardMenuId === dashboard.id}
          onOpenChange={(open) =>
            setOpenDashboardMenuId(open ? dashboard.id : null)
          }
        >
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "rounded p-1 hover:bg-muted/10 text-muted-foreground hover:text-foreground transition-opacity",
                openDashboardMenuId === dashboard.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => openDashboardTab(dashboard.id)}>
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                startEdit("dashboard", dashboard.id, dashboard.name)
              }
            >
              Rename
            </DropdownMenuItem>
            {isCloudEnabled &&
              onToggleShareDashboard &&
              !dashboard.isShared && (
                <DropdownMenuItem
                  onClick={() => setShareDialogDashboard(dashboard)}
                >
                  <Cloud className="mr-2 h-3.5 w-3.5" />
                  Share...
                </DropdownMenuItem>
              )}
            {isCloudEnabled && onToggleShareDashboard && dashboard.isShared && (
              <DropdownMenuItem
                onClick={() => setShareDialogDashboard(dashboard)}
              >
                <Cloud className="mr-2 h-3.5 w-3.5" />
                Sharing...
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(() => {
                  const renderFolderOptions = (
                    parentId: string | null,
                    depth: number,
                  ): React.ReactNode[] => [
                    <DropdownMenuItem
                      key={String(parentId)}
                      onClick={() =>
                        updateDashboard(dashboard.id, { folderId: parentId })
                      }
                      style={{ paddingLeft: 8 + depth * 12 }}
                    >
                      {depth === 0 ? (
                        <span className="truncate">Ungrouped</span>
                      ) : (
                        <>
                          <Folder className="w-3 h-3 mr-2 text-yellow-500 shrink-0" />
                          <span className="truncate">
                            {folders.find((f) => f.id === parentId)?.name}
                          </span>
                        </>
                      )}
                    </DropdownMenuItem>,
                    ...folders
                      .filter((f) => f.parentId === parentId)
                      .flatMap((f) => renderFolderOptions(f.id, depth + 1)),
                  ];
                  return renderFolderOptions(null, 0);
                })()}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => handleExportDashboard(dashboard)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Dashboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteDashboard(dashboard.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <>
      <div
        ref={sidebarRef}
        className={cn(
          "relative shrink-0 border-r border-studio-border bg-popover",
          sleek && "border-r-0",
        )}
        style={{ width: sidebarWidth }}
      >
        <div className="flex flex-col overflow-hidden h-full text-muted-foreground">
          <SidebarHeader
            title="Dashboards"
            actions={
              <>
                {isCloudEnabled && onRefresh && (
                  <button
                    onClick={handleRefresh}
                    title="Refresh"
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
                    disabled={isRefreshing}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                    />
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title="Export / Import"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleExportAll}>
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export All
                    </DropdownMenuItem>
                    {onImportDashboards && (
                      <DropdownMenuItem onClick={handleImportClick}>
                        <Upload className="mr-2 h-3.5 w-3.5" />
                        Import
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => {
                    setCreatingFolderParentId(null);
                    setIsCreatingFolder(true);
                  }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
                  title="New Folder"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => openCreateDashboardDialog()}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
                  title="New Dashboard"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </>
            }
          />

          <div
            className={cn(
              "flex-1 overflow-y-auto py-2 px-2 space-y-1 transition-colors",
              isInternalDragging && dragOverRoot && "bg-accent/10",
            )}
            data-dashboard-drop-root
          >
            <DragGhost ghost={dragGhost} />
            {renderFolderTree(folderTree, 0)}

            <div className="pt-1">
              {dashboards
                .filter((dashboard) => !dashboard.folderId)
                .map((dashboard) => renderDashboardItem(dashboard))}
            </div>

            {dashboards.length === 0 && folders.length === 0 && (
              <div className="px-3 py-4 text-center space-y-3">
                <p className="text-xs text-muted-foreground">
                  Create a dashboard or folder to get started.
                </p>
                {quickCreateDashboard && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={quickCreateDashboard}
                    className="h-8 text-xs gap-2 bg-secondary/20 border-studio-border text-foreground hover:bg-secondary/40"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    New Dashboard
                  </Button>
                )}
              </div>
            )}

            {receivedSharedDashboards &&
              receivedSharedDashboards.length > 0 && (
                <div className="mt-4 pt-2 border-t border-studio-border mx-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Cloud className="w-3 h-3 text-sky-400" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Shared with me
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {receivedSharedDashboards.map((d: any, i: number) => (
                      <div
                        key={d.id || i}
                        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-accent/30 cursor-pointer text-xs group"
                        onClick={() => openDashboardTab(d.id)}
                      >
                        <LayoutDashboard className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="flex-1 truncate">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
        <ResizeHandle onPointerDown={handlePointerDown} />
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.type === "dashboard"
                ? "Rename Dashboard"
                : "Rename Folder"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateFolderDialog
        open={isCreatingFolder}
        onOpenChange={(open) => {
          if (!open) setCreatingFolderParentId(null);
          setIsCreatingFolder(open);
        }}
        folderName={newFolderName}
        onFolderNameChange={setNewFolderName}
        parentId={creatingFolderParentId}
        onParentIdChange={setCreatingFolderParentId}
        folders={folders}
        onCreate={handleCreateFolder}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Dashboard</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Dashboard name"
              value={newDashboardName}
              onChange={(e) => setNewDashboardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateDashboard();
                }
              }}
            />
            <div className="mt-3">
              <FolderSelectField
                value={createFolderId}
                onValueChange={setCreateFolderId}
                folders={folders}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDashboard}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shareDialogDashboard && (() => {
        const shareCallbacks = useShareCallbacks({
          item: shareDialogDashboard,
          shareEntry: shareDashboardEntry,
          buildEntryPayload: (d) => {
            const fullDash = dashboards.find((dd) => dd.id === d.id) as any;
            return {
              id: d.id,
              name: d.name,
              folderId: d.folderId,
              widgets: fullDash?.widgets || [],
            };
          },
          onUpdateItem: (id, updates) => updateDashboard(id, updates),
          setItem: setShareDialogDashboard,
          onToggleShare: onToggleShareDashboard,
          onUpdatePermissions: onUpdateDashboardPermissions,
        });
        return (
          <ShareDialog
            open={shareDialogDashboard !== null}
            onOpenChange={(open) => {
              if (!open) setShareDialogDashboard(null);
            }}
            itemName={shareDialogDashboard.name}
            itemType="dashboard"
            isShared={!!shareDialogDashboard.isShared}
            sharedEntryId={shareDialogDashboard.sharedEntryId}
            onShare={shareCallbacks.onShare}
            onUpdatePermissions={shareCallbacks.onUpdatePermissions}
            onUnshare={shareCallbacks.onUnshare}
            sharing={sharingDashboardId === shareDialogDashboard.id}
            workspaceMembers={workspaceMembers}
          />
        );
      })()}
    </>
  );
}
