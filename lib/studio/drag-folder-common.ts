export function handleFolderHover(
  folderId: string | null,
  deps: {
    hoverFolderIdRef: { current: string | null };
    setDragOverFolderId: (id: string | null) => void;
    setDragOverRoot: (v: boolean) => void;
    clearExpandedHover: () => void;
  },
) {
  if (folderId) {
    if (deps.hoverFolderIdRef.current && deps.hoverFolderIdRef.current !== folderId) {
      deps.clearExpandedHover();
    }
    deps.hoverFolderIdRef.current = folderId;
    deps.setDragOverFolderId(folderId);
    deps.setDragOverRoot(false);
  } else {
    deps.clearExpandedHover();
    deps.hoverFolderIdRef.current = null;
    deps.setDragOverFolderId(null);
    deps.setDragOverRoot(true);
  }
}

export function handleDragRootOrElse(
  isRoot: boolean,
  deps: {
    hoverFolderIdRef: { current: string | null };
    setDragOverFolderId: (id: string | null) => void;
    setDragOverRoot: (v: boolean) => void;
    sidebarRef: React.RefObject<HTMLDivElement | null>;
    setIsDraggingToSplit: (v: boolean) => void;
    onStartSplitDrag: any;
    clearExpandedHover: () => void;
  },
  tryStartSplitDrag: any,
  event: React.PointerEvent | PointerEvent,
  draggingRef: any,
) {
  if (isRoot) {
    deps.clearExpandedHover();
    deps.hoverFolderIdRef.current = null;
    deps.setDragOverFolderId(null);
    deps.setDragOverRoot(true);
  } else {
    deps.clearExpandedHover();
    deps.hoverFolderIdRef.current = null;
    deps.setDragOverFolderId(null);
    deps.setDragOverRoot(false);
    tryStartSplitDrag(event, deps.sidebarRef, deps.setIsDraggingToSplit, deps.onStartSplitDrag, draggingRef);
  }
}

export function handleDropFolderExpand(
  folderId: string,
  shouldExpand: boolean,
  deps: {
    hoverFolderIdRef: { current: string | null };
    setDragOverFolderId: (id: string | null) => void;
    setDragOverRoot: (v: boolean) => void;
    dragEnterFolderTimerRef: { current: Record<string, any> };
    autoExpandedFoldersRef: { current: Set<string> };
    clearExpandedHover: () => void;
  },
  setFolders: (updater: (prev: Set<string>) => Set<string>) => void,
) {
  if (deps.hoverFolderIdRef.current && deps.hoverFolderIdRef.current !== folderId) {
    deps.clearExpandedHover();
  }
  deps.hoverFolderIdRef.current = folderId;
  deps.setDragOverFolderId(folderId);
  deps.setDragOverRoot(false);

  if (shouldExpand && !deps.dragEnterFolderTimerRef.current[folderId]) {
    setFolders((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
    deps.autoExpandedFoldersRef.current.add(folderId);
  }
}
