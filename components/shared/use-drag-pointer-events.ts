type FolderAction = "add" | "delete";

export function resetAutoExpandedFolders(
  autoExpandedFoldersRef: React.MutableRefObject<Set<string>>,
  setter: (updater: (prev: Set<string>) => Set<string>) => void,
  action: FolderAction,
) {
  if (autoExpandedFoldersRef.current.size) {
    setter((prevSet) => {
      const next = new Set(prevSet);
      autoExpandedFoldersRef.current.forEach((id) => {
        if (action === "add") next.add(id);
        else next.delete(id);
      });
      return next;
    });
    autoExpandedFoldersRef.current.clear();
  }
}
