"use client";

import React from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ArrowRight, Download, Folder, FolderPlus } from "@/lib/icon-theme/lucide-react";
import { renderFolderSelectItems } from "@/lib/studio/folder-tree-utils";

// --- Folder tree utilities ---

export interface FolderNode<T> {
  folder: T;
  children: FolderNode<T>[];
}

export function buildFolderTree<
  T extends { id: string; parentId: string | null },
>(folders: T[], parentId: string | null = null): FolderNode<T>[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .map((folder) => ({
      folder,
      children: buildFolderTree(folders, folder.id),
    }));
}

export function getMoveFolderOptions<
  T extends { id: string; name: string; parentId: string | null },
>(
  folders: T[],
  excludeId: string,
  parentId: string | null = null,
  depth = 0,
): Array<{ id: string | null; name: string; depth: number }> {
  const options: Array<{ id: string | null; name: string; depth: number }> = [];
  if (depth === 0) {
    options.push({ id: null, name: "Ungrouped", depth: 0 });
  }
  const children = folders.filter(
    (f) => f.parentId === parentId && f.id !== excludeId,
  );
  for (const child of children) {
    options.push({ id: child.id, name: child.name, depth: depth + 1 });
    options.push(
      ...getMoveFolderOptions(folders, excludeId, child.id, depth + 1),
    );
  }
  return options;
}

// --- Drag utilities ---

export function initDragMove(
  event: PointerEvent,
  dragStartRef: React.MutableRefObject<{ x: number; y: number } | null>,
  setDragGhost: (ghost: { x: number; y: number; label: string } | null) => void,
  labelRef: React.MutableRefObject<string>,
): boolean {
  if (!dragStartRef.current) return false;
  const dx = Math.abs(event.clientX - dragStartRef.current.x);
  const dy = Math.abs(event.clientY - dragStartRef.current.y);
  if (dx < 2 && dy < 2) return false;
  setDragGhost({
    x: event.clientX,
    y: event.clientY,
    label: labelRef.current,
  });
  return true;
}

export function tryStartSplitDrag<T>(
  event: PointerEvent,
  sidebarRef: React.RefObject<HTMLDivElement | null>,
  setIsDraggingToSplit: (v: boolean) => void,
  onStartSplitDrag: ((item: T, x: number, y: number) => void) | undefined,
  draggingItemRef: React.MutableRefObject<T | null>,
): void {
  const sidebarEl = sidebarRef.current;
  if (sidebarEl && onStartSplitDrag && draggingItemRef.current) {
    const sidebarRect = sidebarEl.getBoundingClientRect();
    if (
      event.clientX < sidebarRect.left - 10 ||
      event.clientX > sidebarRect.right + 10 ||
      event.clientY < sidebarRect.top - 10 ||
      event.clientY > sidebarRect.bottom + 10
    ) {
      setIsDraggingToSplit(true);
      onStartSplitDrag(draggingItemRef.current, event.clientX, event.clientY);
    }
  }
}

// --- Shared UI components ---

export function DragGhost({
  ghost,
}: {
  ghost: { x: number; y: number; label: string } | null;
}) {
  if (!ghost) return null;
  return (
    <div
      className="fixed z-[200] pointer-events-none rounded-lg border border-studio-border bg-studio-bg/90 px-2 py-1 text-xs text-foreground shadow-lg"
      style={{ left: ghost.x + 12, top: ghost.y + 12 }}
    >
      {ghost.label}
    </div>
  );
}

// --- Shared Create Folder Dialog ---

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  onFolderNameChange: (name: string) => void;
  parentId: string | null;
  onParentIdChange: (id: string | null) => void;
  folders: Array<{ id: string; parentId: string | null; name: string }>;
  onCreate: () => void;
  hideParentSelect?: boolean;
}

// --- Shared Folder Select Field ---

interface FolderSelectFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  folders: Array<{ id: string; parentId: string | null; name: string }>;
  placeholder?: string;
  rootLabel?: string;
}

export function FolderSelectField({
  value,
  onValueChange,
  folders,
  placeholder = "Folder (optional)",
  rootLabel = "Ungrouped",
}: FolderSelectFieldProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__root__">{rootLabel}</SelectItem>
        {renderFolderSelectItems(folders)}
      </SelectContent>
    </Select>
  );
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  folderName,
  onFolderNameChange,
  parentId,
  onParentIdChange,
  folders,
  onCreate,
  hideParentSelect,
}: CreateFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <Input
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => onFolderNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreate();
              }
            }}
          />
          {!hideParentSelect && (
            <Select
              value={parentId ?? "__root__"}
              onValueChange={(v) =>
                onParentIdChange(v === "__root__" ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Parent folder (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">Root (no parent)</SelectItem>
                {renderFolderSelectItems(folders)}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Shared Folder Move Submenu ---

interface FolderMoveSubmenuProps {
  moveOptions: Array<{ id: string | null; name: string; depth: number }>;
  onMove: (parentId: string | null) => void;
}

export function FolderMoveSubmenu({
  moveOptions,
  onMove,
}: FolderMoveSubmenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ArrowRight className="mr-2 h-3 w-3" />
        Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {moveOptions.map((opt) => (
          <DropdownMenuItem
            key={String(opt.id)}
            onClick={() => onMove(opt.id)}
            style={{ paddingLeft: 8 + opt.depth * 12 }}
          >
            {opt.depth > 0 && (
              <Folder className="w-3 h-3 mr-2 text-yellow-500 shrink-0" />
            )}
            <span className="truncate">{opt.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface FolderRenameSubfolderItemsProps {
  onRename: () => void;
  onCreateSubfolder: () => void;
}

export function FolderRenameSubfolderItems({
  onRename,
  onCreateSubfolder,
}: FolderRenameSubfolderItemsProps) {
  return (
    <>
      <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
      <DropdownMenuItem onClick={onCreateSubfolder}>
        <FolderPlus className="mr-2 h-3 w-3" />
        Create Subfolder
      </DropdownMenuItem>
    </>
  );
}

interface ExportDeleteMenuItemsProps {
  onExport: () => void;
  onDelete: () => void;
}

export function shouldStartDrag(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return true;
  return !target.closest(
    "button, a, input, textarea, select, [role='button'], [role='menuitem'], [data-no-drag]",
  );
}

export function FolderExportDeleteItems({
  onExport,
  onDelete,
}: ExportDeleteMenuItemsProps) {
  return (
    <>
      <DropdownMenuItem onClick={onExport}>
        <Download className="mr-2 h-3.5 w-3.5" />
        Export Folder
      </DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={onDelete}>
        Delete
      </DropdownMenuItem>
    </>
  );
}
