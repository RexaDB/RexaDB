import type { Dispatch, SetStateAction } from "react";

export interface SnippetActionsState {
  newSnippetName: string;
  setNewSnippetName: Dispatch<SetStateAction<string>>;

  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  setIsCreatingSnippet: Dispatch<SetStateAction<boolean>>;
  editingTarget: { type: "folder" | "snippet"; id: string } | null;
  setEditingTarget: Dispatch<
    SetStateAction<{ type: "folder" | "snippet"; id: string } | null>
  >;
  editName: string;
  setEditName: Dispatch<SetStateAction<string>>;
  onAddSnippet: (name: string, query: string, folderId: string | null) => void;
  onUpdateFolder: (id: string, data: any) => void;
  onUpdateSnippet: (id: string, data: any) => void;
}

export function handleAddSnippetAction(state: SnippetActionsState) {
  const {
    newSnippetName,
    setNewSnippetName,
    selectedFolderId,
    expandedFolders,
    setExpandedFolders,
    setIsCreatingSnippet,
    onAddSnippet,
  } = state;
  if (newSnippetName.trim()) {
    onAddSnippet(
      newSnippetName.trim(),
      "-- " + newSnippetName.trim() + "\n",
      selectedFolderId,
    );
    setNewSnippetName("");
    setIsCreatingSnippet(false);
    if (selectedFolderId) {
      const next = new Set(expandedFolders);
      next.add(selectedFolderId);
      setExpandedFolders(next);
    }
  }
}

export function toggleFolderAction(
  expandedFolders: Set<string>,
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>,
  folderId: string,
) {
  const next = new Set(expandedFolders);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  setExpandedFolders(next);
}

export function startEditingAction(
  setEditingTarget: Dispatch<
    SetStateAction<{ type: "folder" | "snippet"; id: string } | null>
  >,
  setEditName: Dispatch<SetStateAction<string>>,
  type: "folder" | "snippet",
  id: string,
  name: string,
) {
  setEditingTarget({ type, id });
  setEditName(name);
}

export function saveEditAction(state: SnippetActionsState) {
  const {
    editingTarget,
    editName,
    setEditingTarget,
    onUpdateFolder,
    onUpdateSnippet,
  } = state;
  if (!editingTarget || !editName.trim()) {
    setEditingTarget(null);
    return;
  }
  if (editingTarget.type === "folder") {
    onUpdateFolder(editingTarget.id, { name: editName.trim() });
  } else {
    onUpdateSnippet(editingTarget.id, { name: editName.trim() });
  }
  setEditingTarget(null);
}
