// fallow-ignore-file code-duplication
import React, { useState, useRef, useMemo } from "react";
import {
  FolderPlus,
  Plus,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FileCode,
  MoreVertical,
  Save,
  RefreshCw,
  Cloud,
  Terminal,
  Download,
  Upload,
  ArrowRight,
} from "@/lib/icon-theme/lucide-react";
import { RenameDialog } from "./rename-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import {
  handleFolderHover,
  handleDragRootOrElse,
} from "@/lib/studio/drag-folder-common";
import {
  Snippet,
  Folder,
  SnippetExportData,
  type KVPermission,
} from "@/lib/studio/types";
import {
  shareSnippetEntry,
} from "@/lib/supabase/workspace";
import { ShareDialog } from "./share-dialog";
import { useShareCallbacks } from "./share-callbacks";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { CreateSnippetDialog, useSnippetActions } from "./snippet-common";
import {
  triggerImportFileClick,
  createImportFileHandler,
} from "@/lib/studio/import-file-utils";
import {
  buildFolderTree,
  getMoveFolderOptions,
  DragGhost,
  ResizeHandle,
  FolderNode,
  CreateFolderDialog,
  FolderRenameSubfolderItems,
  FolderMoveSubmenu,
  FolderExportDeleteItems,
  initDragMove,
  tryStartSplitDrag,
  shouldStartDrag,
} from "./sidebar-common";
import { resetAutoExpandedFolders } from "@/components/shared/use-drag-pointer-events";
import { useDragFolderSort } from "@/hooks/use-drag-folder-sort";

// fallow-ignore-next-line code-duplication
interface SqlSnippetsSidebarProps {
  snippets: Snippet[];
  folders: Folder[];
  onSelectSnippet: (snippet: Snippet) => void;
  onAddSnippet: (name: string, query: string, folderId: string | null) => void;
  onUpdateSnippet: (id: string, updates: Partial<Snippet>) => void;
  onDeleteSnippet: (id: string) => void;
  onAddFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<Folder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleShareSnippet?: (
    id: string,
    share: boolean,
    granteeType?: "studio" | "public",
  ) => void;
  onUpdateSnippetPermissions?: (
    entryId: string,
    permissions: KVPermission[],
  ) => Promise<void>;
  sharingSnippetId?: string | null;
  receivedSharedSnippets?: any[];
  workspaceMembers?: Array<{ id: string; name: string; email: string }>;
  currentQuery: string;
  onRefresh?: () => void;
  isCloudEnabled?: boolean;
  activeTabId?: string | null;
  sleek?: boolean;
  onStartSplitDrag?: (snippet: Snippet, mouseX: number, mouseY: number) => void;
  onEndSplitDrag?: () => void;
  onOpenSqlEditor?: () => void;
  onImportSnippets?: (data: SnippetExportData) => void;
}

export function SqlSnippetsSidebar({
  snippets,
  folders,
  onSelectSnippet,
  onAddSnippet,
  onUpdateSnippet,
  onDeleteSnippet,
  onAddFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleShareSnippet,
  onUpdateSnippetPermissions,
  sharingSnippetId,
  receivedSharedSnippets,
  workspaceMembers,
  currentQuery,
  onRefresh,
  isCloudEnabled = true,
  activeTabId = null,
  sleek,
  onStartSplitDrag,
  onEndSplitDrag,
  onOpenSqlEditor,
  onImportSnippets,
}: SqlSnippetsSidebarProps) {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<
    string | null
  >(null);
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false);
  const [newSnippetName, setNewSnippetName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [shareDialogSnippet, setShareDialogSnippet] = useState<Snippet | null>(
    null,
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [editingTarget, setEditingTarget] = useState<{
    type: "folder" | "snippet";
    id: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [openSnippetMenuId, setOpenSnippetMenuId] = useState<string | null>(
    null,
  );
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [draggingSnippetId, setDraggingSnippetId] = useState<string | null>(
    null,
  );
  const [isInternalDragging, setIsInternalDragging] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const [isDraggingToSplit, setIsDraggingToSplit] = useState(false);
  const draggingSnippetLabelRef = useRef<string>("");
  const draggingSnippetRef = useRef<Snippet | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);
  const dragEnterFolderTimerRef = useRef<Record<string, number>>({});
  const autoExpandedFoldersRef = useRef<Set<string>>(new Set());
  const hoverFolderIdRef = useRef<string | null>(null);

  const { toggleFolder, handleAddSnippet, startEditing, saveEdit } =
    useSnippetActions({
      newSnippetName,
      setNewSnippetName,
      selectedFolderId,
      setSelectedFolderId,
      expandedFolders,
      setExpandedFolders,
      setIsCreatingSnippet,
      editingTarget,
      setEditingTarget,
      editName,
      setEditName,
      onAddSnippet,
      onUpdateFolder,
      onUpdateSnippet,
    });

  const handleAddFolder = () => {
    if (newFolderName.trim()) {
      onAddFolder(newFolderName.trim(), creatingFolderParentId);
      setNewFolderName("");
      setCreatingFolderParentId(null);
      setIsCreatingFolder(false);
    }
  };

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const clearExpandedHover = () => {
    const prev = hoverFolderIdRef.current;
    if (prev && autoExpandedFoldersRef.current.has(prev)) {
      setExpandedFolders((prevSet) => {
        const next = new Set(prevSet);
        next.delete(prev);
        return next;
      });
      autoExpandedFoldersRef.current.delete(prev);
    }
  };

  const handleMove = (event: PointerEvent) => {
    if (
      !initDragMove(event, dragStartRef, setDragGhost, draggingSnippetLabelRef)
    )
      return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const folderEl = element?.closest(
      "[data-snippet-drop-folder]",
    ) as HTMLElement | null;
    const snippetEl = element?.closest(
      "[data-snippet-item]",
    ) as HTMLElement | null;
    const rootEl = element?.closest(
      "[data-snippet-drop-root]",
    ) as HTMLElement | null;
    if (folderEl?.dataset?.snippetDropFolder) {
      const folderId = folderEl.dataset.snippetDropFolder;
      if (hoverFolderIdRef.current && hoverFolderIdRef.current !== folderId) {
        clearExpandedHover();
      }
      hoverFolderIdRef.current = folderId;
      setDragOverFolderId(folderId);
      setDragOverRoot(false);

      if (
        !expandedFolders.has(folderId) &&
        !dragEnterFolderTimerRef.current[folderId]
      ) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(folderId);
          return next;
        });
        autoExpandedFoldersRef.current.add(folderId);
      }
    } else if (snippetEl?.dataset?.snippetFolder) {
      handleFolderHover(snippetEl.dataset.snippetFolder || null, {
        hoverFolderIdRef,
        setDragOverFolderId,
        setDragOverRoot,
        clearExpandedHover,
      });
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
        draggingSnippetRef,
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
        draggingSnippetRef,
      );
    }
  };

  const handleUp = () => {
    if (isDraggingToSplit) {
      setIsDraggingToSplit(false);
      onEndSplitDrag?.();
    } else if (dragOverFolderId) {
      onUpdateSnippet(draggingSnippetId!, { folderId: dragOverFolderId });
    } else if (dragOverRoot) {
      onUpdateSnippet(draggingSnippetId!, { folderId: null });
    }
    setDraggingSnippetId(null);
    setIsInternalDragging(false);
    setDragOverFolderId(null);
    setDragOverRoot(false);
    setDragGhost(null);
    dragStartRef.current = null;
    resetAutoExpandedFolders(
      autoExpandedFoldersRef,
      setExpandedFolders,
      "delete",
    );
    hoverFolderIdRef.current = null;
  };

  useDragFolderSort(draggingSnippetId, dragStartRef, handleMove, handleUp);

  const isSnippetActive = (snippetId: string) =>
    activeTabId === `sql-${snippetId}`;

  const startDrag = (snippet: Snippet, event: React.PointerEvent) => {
    if (!shouldStartDrag(event.target)) return;
    setDraggingSnippetId(snippet.id);
    setIsInternalDragging(true);
    draggingSnippetLabelRef.current = snippet.name;
    draggingSnippetRef.current = snippet;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const importFileRef = useRef<HTMLInputElement>(null);

  const dateStr = () => new Date().toISOString().slice(0, 10);

// fallow-ignore-next-line code-duplication
  const downloadJson = (data: SnippetExportData, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSnippet = (snippet: Snippet) => {
    const data: SnippetExportData = {
      version: 2,
      type: "snippets",
      folders: [],
      snippets: [
        {
          name: snippet.name,
          query: snippet.query,
          folderName: null,
          createdAt: snippet.createdAt,
          isShared: snippet.isShared,
        },
      ],
    };
    downloadJson(
      data,
      `snippet-${snippet.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${dateStr()}.json`,
    );
  };

  const handleExportFolder = (folder: Folder) => {
    const folderSnippets = snippets.filter((s) => s.folderId === folder.id);
    const parentFolder = folder.parentId
      ? folders.find((f) => f.id === folder.parentId)
      : null;
    const data: SnippetExportData = {
      version: 2,
      type: "snippets",
      folders: [
        {
          name: folder.name,
          parentName: parentFolder?.name ?? null,
          createdAt: folder.createdAt,
        },
      ],
      snippets: folderSnippets.map((s) => ({
        name: s.name,
        query: s.query,
        folderName: folder.name,
        createdAt: s.createdAt,
        isShared: s.isShared,
      })),
    };
    downloadJson(
      data,
      `folder-${folder.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${dateStr()}.json`,
    );
  };

  const handleExportAll = () => {
    const folderParentMap = new Map(
      folders
        .filter((f) => f.parentId)
        .map((f) => [
          f.id,
          folders.find((p) => p.id === f.parentId)?.name ?? null,
        ]),
    );
    const data: SnippetExportData = {
      version: 2,
      type: "snippets",
      folders: folders.map((f) => ({
        name: f.name,
        parentName: f.parentId ? (folderParentMap.get(f.id) ?? null) : null,
        createdAt: f.createdAt,
      })),
      snippets: snippets.map((s) => {
        const folder = s.folderId
          ? folders.find((f) => f.id === s.folderId)
          : null;
        return {
          name: s.name,
          query: s.query,
          folderName: folder?.name ?? null,
          createdAt: s.createdAt,
          isShared: s.isShared,
        };
      }),
    };
    downloadJson(data, `snippets-export-${dateStr()}.json`);
  };

  const handleImportClick = () => triggerImportFileClick(importFileRef);
  const handleImportFile = createImportFileHandler<SnippetExportData>({
    acceptedType: "snippets",
    label: "snippet",
    onImport: (data) => onImportSnippets?.(data),
  });

  const renderSnippet = (snippet: Snippet, depth = 0) => (
    <div
      key={snippet.id}
      data-snippet-item
      data-snippet-folder={snippet.folderId ?? ""}
      onPointerDown={(e) => startDrag(snippet, e)}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 cursor-pointer rounded-lg transition-colors select-none",
        (isSnippetActive(snippet.id) || openSnippetMenuId === snippet.id) &&
          "bg-accent/70 text-foreground",
        depth > 0 && "ml-4",
      )}
      onClick={() => onSelectSnippet(snippet)}
      onContextMenu={(event) => {
        event.preventDefault();
        setOpenSnippetMenuId(snippet.id);
      }}
    >
      <FileCode className="w-3.5 h-3.5 text-blue-500 shrink-0" />
      <span className="flex-1 truncate">{snippet.name}</span>
      {snippet.isShared && (
        <span
          className="w-3 h-3 shrink-0 text-sky-400/80"
          title="Shared with workspace"
        >
          <Cloud className="w-3 h-3" aria-hidden="true" />
        </span>
      )}
      <DropdownMenu
        open={openSnippetMenuId === snippet.id}
        onOpenChange={(open) => setOpenSnippetMenuId(open ? snippet.id : null)}
      >
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button
            className={cn(
              "p-1 hover:bg-accent rounded transition-all",
              openSnippetMenuId === snippet.id
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() => startEditing("snippet", snippet.id, snippet.name)}
          >
            Rename
          </DropdownMenuItem>
          {isCloudEnabled && onToggleShareSnippet && !snippet.isShared && (
            <DropdownMenuItem onClick={() => setShareDialogSnippet(snippet)}>
              <Cloud className="mr-2 h-3.5 w-3.5" />
              Share...
            </DropdownMenuItem>
          )}
          {isCloudEnabled && onToggleShareSnippet && snippet.isShared && (
            <DropdownMenuItem onClick={() => setShareDialogSnippet(snippet)}>
              <Cloud className="mr-2 h-3.5 w-3.5" />
              Sharing...
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => handleExportSnippet(snippet)}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Export Snippet
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => onDeleteSnippet(snippet.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const renderFolderTree = (nodes: FolderNode<Folder>[], depth: number) =>
    nodes.map(({ folder, children }) => {
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
              "group flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 cursor-pointer rounded-lg transition-colors select-none",
              dragOverFolderId === folder.id && "bg-blue-500/10",
              openFolderMenuId === folder.id && "bg-accent/50",
              depth > 0 && "ml-4",
            )}
            onClick={() => toggleFolder(folder.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setOpenFolderMenuId(folder.id);
            }}
            data-snippet-drop-folder={folder.id}
          >
            {expandedFolders.has(folder.id) ? (
              <FolderOpenIcon
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  dragOverFolderId === folder.id
                    ? "text-blue-400"
                    : "text-yellow-500",
                )}
              />
            ) : (
              <FolderIcon
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  dragOverFolderId === folder.id
                    ? "text-blue-400"
                    : "text-yellow-500",
                )}
              />
            )}
            <span
              className={cn(
                "flex-1 truncate",
                dragOverFolderId === folder.id && "text-blue-200",
              )}
            >
              {folder.name}
            </span>
            <div
              className={cn(
                "flex items-center transition-all",
                openFolderMenuId === folder.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            >
              <button
                className="p-1 hover:bg-accent rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreatingSnippet(true);
                  setSelectedFolderId(folder.id);
                }}
              >
                <Plus className="w-3 h-3" />
              </button>
              <DropdownMenu
                open={openFolderMenuId === folder.id}
                onOpenChange={(open) =>
                  setOpenFolderMenuId(open ? folder.id : null)
                }
              >
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="p-1 hover:bg-accent rounded">
                    <MoreVertical className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <FolderRenameSubfolderItems
                    onRename={() =>
                      startEditing("folder", folder.id, folder.name)
                    }
                    onCreateSubfolder={() => {
                      setCreatingFolderParentId(folder.id);
                      setIsCreatingFolder(true);
                    }}
                  />
                  <FolderMoveSubmenu
                    moveOptions={moveOptions}
                    onMove={(parentId) =>
                      onUpdateFolder(folder.id, { parentId })
                    }
                  />
                  <FolderExportDeleteItems
                    onExport={() => handleExportFolder(folder)}
                    onDelete={() => onDeleteFolder(folder.id)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {expandedFolders.has(folder.id) && (
            <div className="relative mt-0.5 pl-1">
              <div className="absolute left-[15px] top-0 bottom-0 border-l border-studio-border/50" />
              {renderFolderTree(children, depth + 1)}
              {snippets
                .filter((s) => s.folderId === folder.id)
                .map((s) => renderSnippet(s, depth + 1))}
            </div>
          )}
        </div>
      );
    });

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
            title="Snippets"
            actions={
              <>
                {isCloudEnabled && onRefresh && (
                  <button
                    onClick={onRefresh}
                    title="Refresh"
                    className="p-1 hover:bg-secondary/20 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title="Export / Import"
                      className="p-1 hover:bg-secondary/20 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleExportAll}>
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export All
                    </DropdownMenuItem>
                    {onImportSnippets && (
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
                  title="New Folder"
                  className="p-1 hover:bg-secondary/20 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsCreatingSnippet(true);
                    setSelectedFolderId(null);
                  }}
                  title="New Snippet"
                  className="p-1 hover:bg-secondary/20 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
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
              "flex-1 overflow-y-auto p-2 custom-scrollbar relative transition-colors",
              isInternalDragging && dragOverRoot && "bg-accent/10",
            )}
            data-snippet-drop-root
          >
            <DragGhost ghost={dragGhost} />

            <div className="space-y-0.5 select-none">
              {renderFolderTree(folderTree, 0)}

              {snippets.filter((s) => !s.folderId).map((s) => renderSnippet(s))}
            </div>

            {receivedSharedSnippets && receivedSharedSnippets.length > 0 && (
              <div className="mt-4 pt-2 border-t border-studio-border">
                <div className="px-2 mb-1 flex items-center gap-1.5">
                  <Cloud className="w-3 h-3 text-sky-400" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Shared with me
                  </span>
                </div>
                <div className="space-y-0.5">
                  {receivedSharedSnippets.map((s: any, i: number) => (
                    <div
                      key={s.id || i}
                      className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-accent/30 cursor-pointer text-xs group"
                      onClick={() => onSelectSnippet(s)}
                    >
                      <FileCode className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="flex-1 truncate">{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {folders.length === 0 &&
              snippets.length === 0 &&
              !isCreatingFolder &&
              !isCreatingSnippet && (
                <div className="mt-8 text-center px-4 space-y-4">
                  <FileCode className="w-8 h-8 mx-auto mb-2 opacity-10" />
                  <p className="text-xs text-muted-foreground">
                    No snippets yet. Save your queries for later use.
                  </p>
                  {onOpenSqlEditor && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenSqlEditor}
                      className="h-8 text-xs gap-2 bg-secondary/20 border-studio-border text-foreground hover:bg-secondary/40"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      Open SQL Editor
                    </Button>
                  )}
                </div>
              )}
          </div>

          <div className="p-3 border-t border-studio-border bg-studio-header-bg">
            <Button
              variant="secondary"
              size="sm"
              className="w-full h-9 text-xs gap-2 bg-secondary hover:bg-secondary/80 text-foreground border-studio-border"
              onClick={() => {
                if (currentQuery.trim()) {
                  onAddSnippet("New Snippet", currentQuery, null);
                }
              }}
            >
              <Save className="w-3.5 h-3.5" />
              Save Current Query
            </Button>
          </div>
        </div>
        <ResizeHandle onPointerDown={handlePointerDown} />
      </div>

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
        onCreate={handleAddFolder}
      />

      <CreateSnippetDialog
        open={isCreatingSnippet}
        onOpenChange={setIsCreatingSnippet}
        snippetName={newSnippetName}
        onSnippetNameChange={setNewSnippetName}
        onCreate={handleAddSnippet}
        selectedFolderId={selectedFolderId}
        onSelectedFolderIdChange={setSelectedFolderId}
        folders={folders}
      />

      <RenameDialog
        open={editingTarget !== null}
        onCancel={() => setEditingTarget(null)}
        editName={editName}
        onEditNameChange={setEditName}
        onSave={saveEdit}
        type={editingTarget?.type ?? "snippet"}
      />

      {shareDialogSnippet && (() => {
        const shareCallbacks = useShareCallbacks({
          item: shareDialogSnippet,
          shareEntry: shareSnippetEntry,
          buildEntryPayload: (s) => ({
            id: s.id,
            name: s.name,
            query: s.query,
            folderId: s.folderId,
            createdAt: s.createdAt,
          }),
          onUpdateItem: (id, updates) => onUpdateSnippet(id, updates),
          setItem: setShareDialogSnippet,
          onToggleShare: onToggleShareSnippet,
          onUpdatePermissions: onUpdateSnippetPermissions,
        });
        return (
          <ShareDialog
            open={shareDialogSnippet !== null}
            onOpenChange={(open) => {
              if (!open) setShareDialogSnippet(null);
            }}
            itemName={shareDialogSnippet.name}
            itemType="snippet"
            isShared={!!shareDialogSnippet.isShared}
            sharedEntryId={shareDialogSnippet.sharedEntryId}
            onShare={shareCallbacks.onShare}
            onUpdatePermissions={shareCallbacks.onUpdatePermissions}
            onUnshare={shareCallbacks.onUnshare}
            sharing={sharingSnippetId === shareDialogSnippet.id}
            workspaceMembers={workspaceMembers}
          />
        );
      })()}
    </>
  );
}
