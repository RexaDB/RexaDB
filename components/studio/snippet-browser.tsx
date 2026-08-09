"use client";

import { useState } from "react";
import {
  FolderPlus,
  Plus,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FileCode,
  Search,
  Save,
  Cloud,
  MoreVertical,
} from "@/lib/icon-theme/lucide-react";
import { RenameDialog } from "./rename-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { Snippet, Folder } from "@/lib/studio/types";
import { CreateSnippetDialog, useSnippetActions } from "./snippet-common";
import { CreateFolderDialog } from "./sidebar-common";

// fallow-ignore-next-line code-duplication
interface SnippetBrowserProps {
  snippets: Snippet[];
  folders: Folder[];
  onSelectSnippet: (snippet: Snippet) => void;
  onAddSnippet: (name: string, query: string, folderId: string | null) => void;
  onUpdateSnippet: (id: string, updates: Partial<Snippet>) => void;
  onDeleteSnippet: (id: string) => void;
  onAddFolder: (name: string) => void;
  onUpdateFolder: (id: string, updates: Partial<Folder>) => void;
  onDeleteFolder: (id: string) => void;
  currentQuery: string;
}

export function SnippetBrowser({
  snippets,
  folders,
  onSelectSnippet,
  onAddSnippet,
  onUpdateSnippet,
  onDeleteSnippet,
  onAddFolder,
  onUpdateFolder,
  onDeleteFolder,
  currentQuery,
}: SnippetBrowserProps) {
  const [search, setSearch] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false);
  const [newSnippetName, setNewSnippetName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [editingTarget, setEditingTarget] = useState<{
    type: "folder" | "snippet";
    id: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const handleAddFolder = () => {
    if (newFolderName.trim()) {
      onAddFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

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

  const filteredSnippets = snippets.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  const renderSnippet = (snippet: Snippet, depth = 0) => (
    <div key={snippet.id} className={depth > 0 ? "ml-3" : ""}>
      <div
        className={cn(
          "group flex items-center gap-2 px-2 py-1 text-xs hover:bg-accent/50 cursor-pointer rounded-lg transition-colors select-none",
          openMenuId === snippet.id && "bg-accent/50",
        )}
        onClick={() => onSelectSnippet(snippet)}
      >
        <FileCode className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span className="flex-1 truncate">{snippet.name}</span>
        {snippet.isShared && (
          <Cloud className="w-3 h-3 shrink-0 text-sky-400/80" />
        )}
        <DropdownMenu
          open={openMenuId === snippet.id}
          onOpenChange={(open) => setOpenMenuId(open ? snippet.id : null)}
        >
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button
              className={cn(
                "p-0.5 hover:bg-accent rounded transition-all",
                openMenuId === snippet.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              className="text-xs"
              onClick={() => startEditing("snippet", snippet.id, snippet.name)}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs text-destructive"
              onClick={() => onDeleteSnippet(snippet.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Search + Action bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
            <Input
              placeholder="Find snippets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs pl-7 pr-2 bg-secondary/20 border-studio-border focus-visible:ring-0 placeholder:text-muted-foreground/30"
            />
          </div>
          <button
            onClick={() => {
              setIsCreatingFolder(true);
              setIsCreatingSnippet(false);
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
              setIsCreatingFolder(false);
            }}
            title="New Snippet"
            className="p-1 hover:bg-secondary/20 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Snippet / Folder list */}
        <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-0.5 custom-scrollbar">
          {/* Folders */}
          {folders.map((folder) => {
            const folderSnippets = filteredSnippets.filter(
              (s) => s.folderId === folder.id,
            );
            const isExpanded = expandedFolders.has(folder.id);
            return (
              <div key={folder.id}>
                <div
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1 text-xs hover:bg-accent/50 cursor-pointer rounded-lg transition-colors select-none",
                    openMenuId === `folder:${folder.id}` && "bg-accent/50",
                  )}
                  onClick={() => toggleFolder(folder.id)}
                >
                  {isExpanded ? (
                    <FolderOpenIcon className="w-3.5 h-3.5 shrink-0 text-yellow-500" />
                  ) : (
                    <FolderIcon className="w-3.5 h-3.5 shrink-0 text-yellow-500" />
                  )}
                  <span className="flex-1 truncate">{folder.name}</span>
                  <div
                    className={cn(
                      "flex items-center transition-all",
                      openMenuId === `folder:${folder.id}`
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <button
                      className="p-0.5 hover:bg-accent rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCreatingSnippet(true);
                        setSelectedFolderId(folder.id);
                        setIsCreatingFolder(false);
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <DropdownMenu
                      open={openMenuId === `folder:${folder.id}`}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? `folder:${folder.id}` : null)
                      }
                    >
                      <DropdownMenuTrigger
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button className="p-0.5 hover:bg-accent rounded">
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-28">
                        <DropdownMenuItem
                          className="text-xs"
                          onClick={() =>
                            startEditing("folder", folder.id, folder.name)
                          }
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-destructive"
                          onClick={() => onDeleteFolder(folder.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    {folderSnippets.map((s) => renderSnippet(s, 1))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Root-level snippets (no folder) */}
          {filteredSnippets
            .filter((s) => !s.folderId)
            .map((s) => renderSnippet(s))}

          {filteredSnippets.length === 0 &&
            !isCreatingFolder &&
            !isCreatingSnippet && (
              <div className="mt-12 text-center px-4">
                <FileCode className="w-8 h-8 mx-auto mb-2 opacity-10" />
                <p className="text-xs text-muted-foreground">
                  {search
                    ? "No snippets match your search."
                    : "No snippets yet. Save your queries for later use."}
                </p>
              </div>
            )}
        </div>

        {/* Save Current Query */}
        <div className="p-2 border-t border-border/50">
          <Button
            variant="secondary"
            size="sm"
            className="w-full h-8 text-xs gap-2 bg-secondary hover:bg-secondary/80 text-foreground border-studio-border"
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

      <CreateFolderDialog
        open={isCreatingFolder}
        onOpenChange={setIsCreatingFolder}
        folderName={newFolderName}
        onFolderNameChange={setNewFolderName}
        parentId={null}
        onParentIdChange={() => {}}
        folders={[]}
        onCreate={handleAddFolder}
        hideParentSelect
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
    </>
  );
}
