import { SelectItem } from "@/components/ui/select";

export interface FlatFolder {
  id: string;
  parentId: string | null;
  name: string;
}

export function renderFolderSelectItems(
  folders: FlatFolder[],
): React.ReactNode[] {
  const renderOptions = (
    parentId: string | null,
    depth: number,
  ): React.ReactNode[] =>
    folders
      .filter((f) => f.parentId === parentId)
      .flatMap((folder) => [
        <SelectItem key={folder.id} value={folder.id}>
          <span style={{ paddingLeft: depth * 12 }}>{folder.name}</span>
        </SelectItem>,
        ...renderOptions(folder.id, depth + 1),
      ]);
  return renderOptions(null, 0);
}
