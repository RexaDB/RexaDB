import { Folder, Snippet } from "./types";

export function normalizeCloudFolders(cloudFolders: any[]): Folder[] {
  return cloudFolders.map((f: any) => ({
    id: String(f.id),
    name: f.name,
    parentId: f.parent_id ?? null,
    createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now(),
  }));
}

export function normalizeCloudSnippets(cloudSnippets: any[], validFolderIds?: Set<string>): Snippet[] {
  return cloudSnippets.map((s: any) => ({
    id: String(s.id),
    name: s.name,
    query: s.query,
    folderId: typeof s.folder_id === "string" && (!validFolderIds || validFolderIds.has(s.folder_id)) ? s.folder_id : null,
    createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
    isShared: true,
  }));
}

export function mapStudioSnippet(s: any): Snippet {
  return {
    id: s.id,
    name: s.name,
    query: s.query,
    folderId: s.folderId,
    createdAt: s.createdAt,
    isShared: Boolean(s.isShared),
  };
}
