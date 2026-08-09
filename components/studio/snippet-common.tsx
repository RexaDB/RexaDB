"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderSelectField } from "./sidebar-common";
import {
  handleAddSnippetAction,
  toggleFolderAction,
  startEditingAction,
  saveEditAction,
  type SnippetActionsState,
} from "@/lib/studio/snippet-actions-utils";
import type { Dispatch, SetStateAction } from "react";

export function useSnippetActions({
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
}: SnippetActionsState & {
  setSelectedFolderId: Dispatch<SetStateAction<string | null>>;
}) {
  const toggleFolder = (folderId: string) =>
    toggleFolderAction(expandedFolders, setExpandedFolders, folderId);
  const handleAddSnippet = () =>
    handleAddSnippetAction({
      newSnippetName,
      setNewSnippetName,
      selectedFolderId,
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
  const startEditing = (type: "folder" | "snippet", id: string, name: string) =>
    startEditingAction(setEditingTarget, setEditName, type, id, name);
  const saveEdit = () =>
    saveEditAction({
      newSnippetName,
      setNewSnippetName,
      selectedFolderId,
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
  return { toggleFolder, handleAddSnippet, startEditing, saveEdit };
}

interface CreateSnippetFolderItem {
  id: string;
  name: string;
  parentId: string | null;
}

interface CreateSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippetName: string;
  onSnippetNameChange: (value: string) => void;
  onCreate: () => void;
  selectedFolderId: string | null;
  onSelectedFolderIdChange: (folderId: string | null) => void;
  folders: CreateSnippetFolderItem[];
}

export function CreateSnippetDialog({
  open,
  onOpenChange,
  snippetName,
  onSnippetNameChange,
  onCreate,
  selectedFolderId,
  onSelectedFolderIdChange,
  folders,
}: CreateSnippetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Snippet</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            placeholder="Snippet name"
            value={snippetName}
            onChange={(e) => onSnippetNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreate();
              }
            }}
          />
          <div className="mt-3">
            <FolderSelectField
              value={selectedFolderId ?? "__root__"}
              onValueChange={(v) =>
                onSelectedFolderIdChange(v === "__root__" ? null : v)
              }
              folders={folders}
            />
          </div>
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
