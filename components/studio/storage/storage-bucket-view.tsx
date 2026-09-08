"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  ImageIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
  X,
} from "@/lib/icon-theme/lucide-react";
import { Move as MoveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { runQuery } from "@/lib/api/actions-client";
import { useConfirm } from "@/hooks/use-confirm";
import {
  fetchStorageBucket,
  fetchStorageObjects,
  formatBytes,
  joinPath,
  listFolderEntries,
  objectMimeType,
  objectSize,
  parentPath,
  pathSegments,
  type StorageBucket,
  type StorageObject,
} from "@/lib/studio/storage-utils";
import { resolvePaymentsConnection } from "@/lib/supabase-paykit/supabase-ref";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export function StorageBucketView({
  studio,
  bucketName,
}: {
  studio: any;
  bucketName: string;
}) {
  const connectionString: string =
    studio.currentConnectionString || studio.connection?.connectionString || "";
  const connectionType: string | undefined =
    studio.connection?.connectionType ?? studio.dbType;
  const confirm = useConfirm();

  const [bucket, setBucket] = useState<StorageBucket | null>(null);
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<{
    fullPath: string;
    object: StorageObject;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [policyCount, setPolicyCount] = useState<number | null>(null);

  // Create folder dialog
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Rename folder dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Rename file dialog
  const [fileRenameOpen, setFileRenameOpen] = useState(false);
  const [fileRenameTarget, setFileRenameTarget] = useState<string | null>(null);
  const [fileRenameDraft, setFileRenameDraft] = useState("");
  const [fileRenaming, setFileRenaming] = useState(false);

  // Move file dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moveDraft, setMoveDraft] = useState("");
  const [moving, setMoving] = useState(false);

  // Bucket settings dialog (opened from "Edit bucket")
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [sizeLimitMb, setSizeLimitMb] = useState<number | "">("");
  const [mimeTypes, setMimeTypes] = useState<string[]>([]);
  const [mimeDraft, setMimeDraft] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Public URL base for previews / downloads (public buckets only).
  const publicUrlBase = useMemo(() => {
    const info = resolvePaymentsConnection(connectionType, connectionString);
    if (!info) return null;
    return `https://${info.projectRef}.supabase.co/storage/v1/object/public/${bucketName}`;
  }, [connectionType, connectionString, bucketName]);

  const load = useCallback(async () => {
    if (!connectionString || !bucketName) return;
    setLoading(true);
    const [
      { bucket: b, error: bucketError },
      { objects: objs, error: objectsError },
    ] = await Promise.all([
      fetchStorageBucket(connectionString, bucketName),
      fetchStorageObjects(connectionString, bucketName),
    ]);
    const firstError = bucketError ?? objectsError;
    if (firstError) toast.error(firstError);
    if (b) {
      setBucket(b);
      setIsPublic(!!b.public);
      setSizeLimitMb(
        b.file_size_limit != null
          ? Math.round(b.file_size_limit / (1024 * 1024))
          : "",
      );
      setMimeTypes(
        Array.isArray(b.allowed_mime_types)
          ? b.allowed_mime_types
          : b.allowed_mime_types
            ? [String(b.allowed_mime_types)]
            : [],
      );
    } else if (bucketError) {
      setBucket(null);
    }
    if (!objectsError) setObjects(objs);
    else setObjects([]);
    setLoading(false);
  }, [connectionString, bucketName]);

  const loadPolicyCount = useCallback(async () => {
    if (!connectionString) return;
    try {
      const res: any = await runQuery(
        connectionString,
        `SELECT count(*) AS count
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'storage' AND c.relname = 'objects'`,
      );
      if (res?.success === false || res?.error) return;
      const rows = res?.data?.rows ?? res?.rows ?? [];
      const count = Number(rows?.[0]?.count);
      if (Number.isFinite(count)) setPolicyCount(count);
    } catch {
      // count is decorative — hide it on failure
    }
  }, [connectionString]);

  useEffect(() => {
    void load();
    void loadPolicyCount();
  }, [load, loadPolicyCount]);

  const crumbs = useMemo(() => pathSegments(path), [path]);

  // Miller columns: the left column lists the folders at the PARENT of the
  // current path (at the bucket root that's the root itself), so the open
  // folder is always visible — and highlighted — on the left. The middle
  // column shows the full contents of the current path (at the root only
  // files, so folders are never duplicated across both columns).
  const parentPathStr = useMemo(() => parentPath(path), [path]);
  const currentFolderName = crumbs[crumbs.length - 1] ?? null;

  const foldersAtParent = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listFolderEntries(objects, parentPathStr)
      .filter((e) => e.kind === "folder")
      .filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [objects, parentPathStr, search]);

  const entriesAtSelection = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = listFolderEntries(objects, path);
    const list =
      path === "" ? all.filter((e) => e.kind === "file") : all;
    return list.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [objects, path, search]);

  const searchScope = currentFolderName ?? bucketName;

  function navigateTo(target: string) {
    setPath(target);
    setSelectedFile(null);
  }

  async function handleCreateFolder() {
    const base = path;
    const name = folderName.trim().replace(/^\/+|\/+$/g, "");
    if (!name) {
      toast.error("Folder name is required.");
      return;
    }
    if (name.includes("/")) {
      toast.error("Folder name cannot contain slashes.");
      return;
    }
    const fullPath = joinPath(base, name, ".emptyFolderPlaceholder");
    setCreatingFolder(true);
    try {
      const safeBucket = bucketName.replace(/'/g, "''");
      const safePath = fullPath.replace(/'/g, "''");
      const res: any = await runQuery(
        connectionString,
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('${safeBucket}', '${safePath}', null, '{"mimetype":"application/x-directory"}'::jsonb)
         ON CONFLICT DO NOTHING`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to create folder");
      toast.success(`Folder "${name}" created.`);
      setFolderOpen(false);
      setFolderName("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  function handleUploadClick() {
    toast.message(
      "File upload requires the Storage API (service role). Use the Supabase client or dashboard to upload binary files.",
    );
  }

  async function handleRenameFolder() {
    if (!renameTarget) return;
    const base = pathSegments(renameTarget).slice(0, -1).join("/");
    const name = renameDraft.trim().replace(/^\/+|\/+$/g, "");
    if (!name) {
      toast.error("Folder name is required.");
      return;
    }
    if (name.includes("/")) {
      toast.error("Folder name cannot contain slashes.");
      return;
    }
    const newPath = joinPath(base, name);
    if (newPath === renameTarget) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      const safeBucket = bucketName.replace(/'/g, "''");
      const safeOld = renameTarget.replace(/'/g, "''").replace(/[%_]/g, "\\$&");
      const oldPrefix = renameTarget.replace(/'/g, "''");
      const newPrefix = newPath.replace(/'/g, "''");
      const oldLen = renameTarget.length + 1;
      const res: any = await runQuery(
        connectionString,
        `UPDATE storage.objects
         SET name = '${newPrefix}/' || substring(name from ${oldLen + 1}),
             updated_at = now()
         WHERE bucket_id = '${safeBucket}'
           AND (name = '${oldPrefix}' OR name LIKE '${safeOld}/%' ESCAPE '\\')`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to rename folder");
      toast.success(`Folder renamed to "${name}".`);
      setRenameOpen(false);
      setRenameTarget(null);
      if (path === renameTarget || path.startsWith(`${renameTarget}/`)) {
        navigateTo(newPath + path.slice(renameTarget.length));
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename folder");
    } finally {
      setRenaming(false);
    }
  }

  async function handleDownloadFolder(folderPath: string) {
    const files = listFolderEntries(objects, folderPath).filter(
      (e) => e.kind === "file",
    );
    if (files.length === 0) {
      toast.message("Folder is empty — nothing to download.");
      return;
    }
    if (!bucket?.public || !publicUrlBase) {
      toast.message(
        "Folder download requires a public bucket. Make the bucket public or download files individually from the preview panel.",
      );
      return;
    }
    const limited = files.slice(0, 25);
    if (files.length > limited.length) {
      toast.message(
        `Downloading the first ${limited.length} of ${files.length} files.`,
      );
    }
    for (const entry of limited) {
      const fullPath = joinPath(folderPath, entry.name);
      const a = document.createElement("a");
      a.href = `${publicUrlBase}/${encodeStoragePath(fullPath)}`;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  function handleCopyFolderPath(folderPath: string) {
    const text = `${bucketName}/${folderPath}`;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success("Folder path copied."))
      .catch(() => toast.error("Failed to copy path."));
  }

  async function handleDeleteFolder(folderPath: string) {
    const ok = await confirm({
      title: "Delete folder",
      description: `Delete "${folderPath}" and all of its contents? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      const safeBucket = bucketName.replace(/'/g, "''");
      const safePrefix = folderPath
        .replace(/'/g, "''")
        .replace(/[%_]/g, "\\$&");
      const exact = folderPath.replace(/'/g, "''");
      const res: any = await runQuery(
        connectionString,
        `DELETE FROM storage.objects
         WHERE bucket_id = '${safeBucket}'
           AND (name = '${exact}' OR name LIKE '${safePrefix}/%' ESCAPE '\\')`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to delete folder");
      toast.success("Folder deleted.");
      if (path === folderPath || path.startsWith(`${folderPath}/`)) {
        navigateTo(parentPath(folderPath));
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete folder");
    }
  }

  function filePublicUrl(fullPath: string): string | null {
    if (!publicUrlBase || !bucket?.public) return null;
    return `${publicUrlBase}/${encodeStoragePath(fullPath)}`;
  }

  async function handleDeleteFile(fullPath?: string) {
    const target = fullPath ?? selectedFile?.fullPath;
    if (!target) return;
    const ok = await confirm({
      title: "Delete file",
      description: `Delete "${target}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      const safeBucket = bucketName.replace(/'/g, "''");
      const safePath = target.replace(/'/g, "''");
      const res: any = await runQuery(
        connectionString,
        `DELETE FROM storage.objects WHERE bucket_id = '${safeBucket}' AND name = '${safePath}'`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to delete file");
      toast.success("File deleted.");
      if (selectedFile?.fullPath === target) setSelectedFile(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete file");
    }
  }

  function handleGetUrl(fullPath: string) {
    const url = filePublicUrl(fullPath);
    if (!url) {
      toast.message("Public URL is only available for public buckets.");
      return;
    }
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Public URL copied."))
      .catch(() => toast.error("Failed to copy URL."));
  }

  function handleDownloadFile(fullPath: string) {
    const url = filePublicUrl(fullPath);
    if (!url) {
      toast.message(
        "Download requires a public bucket URL or the Storage API.",
      );
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = fullPath.split("/").pop() || fullPath;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function renameObjectPath(oldPath: string, newPath: string) {
    const safeBucket = bucketName.replace(/'/g, "''");
    const safeOld = oldPath.replace(/'/g, "''");
    const safeNew = newPath.replace(/'/g, "''");
    const exists: any = await runQuery(
      connectionString,
      `SELECT 1 AS one FROM storage.objects WHERE bucket_id = '${safeBucket}' AND name = '${safeNew}' LIMIT 1`,
    );
    if (exists?.success === false || exists?.error) {
      throw new Error(exists?.error ?? "Failed to check destination.");
    }
    const rows = exists?.data?.rows ?? exists?.rows ?? [];
    if (rows.length > 0) {
      throw new Error("A file already exists at the destination path.");
    }
    const res: any = await runQuery(
      connectionString,
      `UPDATE storage.objects SET name = '${safeNew}', updated_at = now()
       WHERE bucket_id = '${safeBucket}' AND name = '${safeOld}'`,
    );
    if (res?.success === false || res?.error)
      throw new Error(res?.error ?? "Failed to move file");
  }

  async function handleRenameFile() {
    if (!fileRenameTarget) return;
    const dir = pathSegments(fileRenameTarget).slice(0, -1).join("/");
    const name = fileRenameDraft.trim();
    if (!name) {
      toast.error("File name is required.");
      return;
    }
    if (name.includes("/")) {
      toast.error("File name cannot contain slashes — use Move to change folders.");
      return;
    }
    const newPath = joinPath(dir, name);
    if (newPath === fileRenameTarget) {
      setFileRenameOpen(false);
      return;
    }
    setFileRenaming(true);
    try {
      await renameObjectPath(fileRenameTarget, newPath);
      toast.success("File renamed.");
      setFileRenameOpen(false);
      setFileRenameTarget(null);
      if (selectedFile?.fullPath === fileRenameTarget) setSelectedFile(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename file");
    } finally {
      setFileRenaming(false);
    }
  }

  async function handleMoveFile() {
    if (!moveTarget) return;
    const fileName = moveTarget.split("/").pop() || moveTarget;
    const dir = moveDraft.trim().replace(/^\/+|\/+$/g, "");
    if (dir.includes("//")) {
      toast.error("Invalid directory path.");
      return;
    }
    const newPath = joinPath(dir, fileName);
    if (newPath === moveTarget) {
      setMoveOpen(false);
      return;
    }
    setMoving(true);
    try {
      await renameObjectPath(moveTarget, newPath);
      toast.success(`Moved to ${newPath}.`);
      setMoveOpen(false);
      setMoveTarget(null);
      setMoveDraft("");
      if (selectedFile?.fullPath === moveTarget) setSelectedFile(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move file");
    } finally {
      setMoving(false);
    }
  }

  async function handleTogglePublic() {
    if (!bucket) return;
    try {
      const safe = bucketName.replace(/'/g, "''");
      const res: any = await runQuery(
        connectionString,
        `UPDATE storage.buckets SET public = ${!bucket.public}, updated_at = now()
         WHERE id = '${safe}' OR name = '${safe}'`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to update bucket");
      toast.success(
        bucket.public ? "Bucket is now private." : "Bucket is now public.",
      );
      window.dispatchEvent(new Event("studio:storage-buckets-changed"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update bucket");
    }
  }

  async function handleDeleteBucket() {
    const ok = await confirm({
      title: "Delete bucket",
      description: `Delete bucket "${bucketName}" and all of its objects? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const safe = bucketName.replace(/'/g, "''");
      const delObjects: any = await runQuery(
        connectionString,
        `DELETE FROM storage.objects WHERE bucket_id = '${safe}'`,
      );
      if (delObjects?.success === false || delObjects?.error)
        throw new Error(delObjects?.error ?? "Failed to delete objects");
      const delBucket: any = await runQuery(
        connectionString,
        `DELETE FROM storage.buckets WHERE id = '${safe}' OR name = '${safe}'`,
      );
      if (delBucket?.success === false || delBucket?.error)
        throw new Error(delBucket?.error ?? "Failed to delete bucket");
      toast.success(`Bucket "${bucketName}" deleted.`);
      window.dispatchEvent(new Event("studio:storage-buckets-changed"));
      studio.openStorageFilesTab?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete bucket");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveConfiguration() {
    if (!bucket) return;
    setSavingConfig(true);
    try {
      const safe = bucketName.replace(/'/g, "''");
      const limitSql =
        sizeLimitMb === "" || sizeLimitMb == null
          ? "NULL"
          : String(Math.max(0, Number(sizeLimitMb)) * 1024 * 1024);
      const mimeSql =
        mimeTypes.length === 0
          ? "NULL"
          : `ARRAY[${mimeTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]::text[]`;
      const res: any = await runQuery(
        connectionString,
        `UPDATE storage.buckets
         SET public = ${isPublic},
             file_size_limit = ${limitSql},
             allowed_mime_types = ${mimeSql},
             updated_at = now()
         WHERE id = '${safe}' OR name = '${safe}'`,
      );
      if (res?.success === false || res?.error)
        throw new Error(res?.error ?? "Failed to save configuration");
      toast.success("Bucket configuration saved.");
      setSettingsOpen(false);
      window.dispatchEvent(new Event("studio:storage-buckets-changed"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  }

  function addMime() {
    const v = mimeDraft.trim().toLowerCase();
    if (!v || mimeTypes.includes(v)) {
      setMimeDraft("");
      return;
    }
    setMimeTypes((prev) => [...prev, v]);
    setMimeDraft("");
  }

  function FolderActionsMenu({
    folderPath,
    folderName,
  }: {
    folderPath: string;
    folderName: string;
  }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${folderName} actions`}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
              "opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={() => {
              setRenameTarget(folderPath);
              setRenameDraft(folderName);
              setRenameOpen(true);
            }}
          >
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleDownloadFolder(folderPath)}>
            <Download className="size-3.5" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleCopyFolderPath(folderPath)}>
            <Copy className="size-3.5" />
            Copy path to folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => void handleDeleteFolder(folderPath)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const previewMime = selectedFile
    ? objectMimeType(selectedFile.object.metadata)
    : null;
  const previewIsImage = !!previewMime && previewMime.startsWith("image/");
  const previewUrl = selectedFile ? filePublicUrl(selectedFile.fullPath) : null;
  const previewSize = selectedFile
    ? formatBytes(objectSize(selectedFile.object.metadata))
    : null;
  const previewName = selectedFile
    ? selectedFile.fullPath.split("/").pop() || selectedFile.fullPath
    : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => studio.openStorageFilesTab?.()}
          >
            Files
          </button>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => studio.openStorageFilesTab?.()}
          >
            Buckets
          </button>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
          <button
            type="button"
            className="truncate font-medium text-foreground hover:text-foreground"
            onClick={() => navigateTo("")}
            title={bucketName}
          >
            {bucketName}
          </button>
          {crumbs.map((seg, i) => {
            const target = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={target} className="flex min-w-0 items-center gap-1.5">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                <button
                  type="button"
                  className="truncate text-muted-foreground hover:text-foreground"
                  onClick={() => navigateTo(target)}
                >
                  {seg}
                </button>
              </span>
            );
          })}
          {bucket?.public ? (
            <span className="ml-1 shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-300">
              PUBLIC
            </span>
          ) : (
            <span className="ml-1 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
              PRIVATE
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => studio.openStoragePoliciesTab?.()}
          >
            <Shield className="mr-1.5 size-3.5" />
            Policies
            {policyCount != null && (
              <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {policyCount}
              </span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1.5 size-3.5" />
                Edit bucket
                <ChevronDown className="ml-1.5 size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                Bucket settings…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleTogglePublic()}>
                {bucket?.public ? "Make private" : "Make public"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => void handleDeleteBucket()}
                disabled={deleting}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                {deleting ? "Deleting…" : "Delete bucket…"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search in ${searchScope}…`}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => {
              void load();
              void loadPolicyCount();
            }}
            className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
          <Button variant="outline" size="sm" onClick={() => setFolderOpen(true)}>
            <FolderPlus className="mr-1.5 size-3.5" />
            Create folder
          </Button>
          <Button size="sm" onClick={handleUploadClick}>
            <Upload className="mr-1.5 size-3.5" />
            Upload files
          </Button>
        </div>
      </div>

      {/* Explorer columns + preview */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
        {/* Folders column */}
        <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && objects.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading…
              </div>
            ) : foldersAtParent.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {search ? "No matching folders" : "No folders"}
              </div>
            ) : (
              foldersAtParent.map((entry) => {
                const folderPath = joinPath(parentPathStr, entry.name);
                const active = folderPath === path;
                return (
                  <div
                    key={`folder-${entry.name}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigateTo(folderPath)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigateTo(folderPath);
                    }}
                    title={active ? "Current folder" : "Open folder"}
                    className={cn(
                      "group/row flex h-10 w-full cursor-pointer items-center gap-2 border-b border-border px-4 text-left text-xs transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    <Folder
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-amber-400" : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {entry.name}
                    </span>
                    <FolderActionsMenu
                      folderPath={folderPath}
                      folderName={entry.name}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Files column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && objects.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading…
              </div>
            ) : entriesAtSelection.length === 0 ? (
              <div className="p-6">
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <Folder className="mx-auto size-8 text-muted-foreground/50" />
                  <div className="mt-3 text-sm font-medium text-foreground">
                    {search
                      ? "No matching files"
                      : path
                        ? "This folder is empty"
                        : "No files in this bucket"}
                  </div>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    {search
                      ? "Try a different search term."
                      : "This bucket is empty. Upload a file or create a folder to get started."}
                  </p>
                  {!search && (
                    <div className="mt-4 flex justify-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setFolderOpen(true)}
                      >
                        <FolderPlus className="mr-1.5 size-3.5" />
                        Create folder
                      </Button>
                      <Button size="sm" onClick={handleUploadClick}>
                        <Upload className="mr-1.5 size-3.5" />
                        Upload files
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              entriesAtSelection.map((entry) => {
                const fullPath = joinPath(path, entry.name);
                if (entry.kind === "folder") {
                  return (
                    <div
                      key={`subfolder-${fullPath}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigateTo(fullPath)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") navigateTo(fullPath);
                      }}
                      title="Open folder"
                      className="group/row flex h-10 w-full cursor-pointer items-center gap-2 border-b border-border px-4 text-left text-xs transition-colors hover:bg-muted/60"
                    >
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {entry.name}
                      </span>
                      <FolderActionsMenu
                        folderPath={fullPath}
                        folderName={entry.name}
                      />
                    </div>
                  );
                }
                const active = selectedFile?.fullPath === fullPath;
                const mime = objectMimeType(entry.object?.metadata);
                const isImg = mime.startsWith("image/");
                return (
                  <div
                    key={`file-${fullPath}`}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setSelectedFile({ fullPath, object: entry.object! })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        setSelectedFile({ fullPath, object: entry.object! });
                    }}
                    className={cn(
                      "group/row flex h-10 w-full cursor-pointer items-center gap-2 border-b border-border px-4 text-left text-xs transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    {isImg ? (
                      <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {entry.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="file actions"
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
                            "opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100",
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => handleGetUrl(fullPath)}>
                          <Copy className="size-3.5" />
                          Get URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDownloadFile(fullPath)}
                        >
                          <Download className="size-3.5" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setFileRenameTarget(fullPath);
                            setFileRenameDraft(entry.name);
                            setFileRenameOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setMoveTarget(fullPath);
                            setMoveDraft("");
                            setMoveOpen(true);
                          }}
                        >
                          <MoveIcon className="size-3.5" />
                          Move
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => void handleDeleteFile(fullPath)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Preview sheet — docks into the ModernUIShell sheet container,
            same as the Insert Row / Add Column sheets. */}
        <Sheet
          open={!!selectedFile}
          onOpenChange={(open) => {
            if (!open) setSelectedFile(null);
          }}
          modal={false}
        >
          <SheetContent
            side="right"
            contained
            className="bg-background text-foreground flex flex-col p-0 gap-0"
          >
            {selectedFile ? (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 pr-12">
                  <SheetTitle
                    className="truncate text-sm font-medium text-foreground"
                    title={selectedFile.fullPath}
                  >
                    {selectedFile.fullPath.split("/").pop() ||
                      selectedFile.fullPath}
                  </SheetTitle>
                </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20">
                {previewIsImage && previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={previewName}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <FileIcon className="size-12 text-muted-foreground/50" />
                )}
              </div>

              <div className="mt-4 break-words text-sm font-medium leading-snug text-foreground">
                {selectedFile.fullPath}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {previewMime ?? "—"}
                {previewSize ? ` - ${previewSize}` : ""}
              </div>

              <div className="mt-5 space-y-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Added on</div>
                  <div className="mt-0.5 text-foreground">
                    {selectedFile.object.created_at
                      ? new Date(
                          selectedFile.object.created_at,
                        ).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last modified</div>
                  <div className="mt-0.5 text-foreground">
                    {selectedFile.object.updated_at
                      ? new Date(
                          selectedFile.object.updated_at,
                        ).toLocaleString()
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    handleDownloadFile(selectedFile.fullPath)
                  }
                >
                  <Download className="mr-1.5 size-3.5" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGetUrl(selectedFile.fullPath)}
                >
                  <Copy className="mr-1.5 size-3.5" />
                  Get URL
                </Button>
              </div>

              <div className="my-4 h-px bg-border" />

              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void handleDeleteFile()}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Delete file
              </Button>
            </div>
              </div>
            ) : (
              <SheetTitle className="sr-only">File preview</SheetTitle>
            )}
          </SheetContent>
        </Sheet>
      </div>

      {/* Create folder dialog */}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="folder-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateFolder();
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFolderOpen(false)}
              disabled={creatingFolder}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreateFolder()}
              disabled={creatingFolder}
            >
              {creatingFolder ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename file dialog */}
      <Dialog
        open={fileRenameOpen}
        onOpenChange={(next) => {
          setFileRenameOpen(next);
          if (!next) setFileRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
          </DialogHeader>
          <Input
            value={fileRenameDraft}
            onChange={(e) => setFileRenameDraft(e.target.value)}
            placeholder="file-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameFile();
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFileRenameOpen(false)}
              disabled={fileRenaming}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRenameFile()}
              disabled={fileRenaming}
            >
              {fileRenaming ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move file dialog */}
      <Dialog
        open={moveOpen}
        onOpenChange={(next) => {
          setMoveOpen(next);
          if (!next) setMoveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Moving {moveTarget?.split("/").pop() ?? "file"} within{" "}
              {bucketName}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Enter the path to where you&apos;d like to move the file to.
            </p>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Path to new directory in {bucketName}
            </div>
            <Input
              value={moveDraft}
              onChange={(e) => setMoveDraft(e.target.value)}
              placeholder="e.g folder1/subfolder2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleMoveFile();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to move items to the root of the bucket
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMoveOpen(false)}
              disabled={moving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleMoveFile()}
              disabled={moving}
            >
              {moving ? "Moving…" : "Move files"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog
        open={renameOpen}
        onOpenChange={(next) => {
          setRenameOpen(next);
          if (!next) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            placeholder="folder-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameFolder();
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameOpen(false)}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRenameFolder()}
              disabled={renaming}
            >
              {renaming ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bucket settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bucket settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Public bucket</div>
                <p className="text-xs text-muted-foreground">
                  Anyone can access objects without a signed URL when public.
                </p>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">File size limit (MB)</div>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  value={sizeLimitMb}
                  onChange={(e) =>
                    setSizeLimitMb(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  className="h-9 pr-12"
                  placeholder="No limit"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  MB
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Allowed MIME types</div>
              <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
                {mimeTypes.map((type) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                  >
                    {type}
                    <button
                      type="button"
                      aria-label={`Remove ${type}`}
                      onClick={() =>
                        setMimeTypes((prev) => prev.filter((t) => t !== type))
                      }
                    >
                      <X className="size-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </span>
                ))}
                <input
                  value={mimeDraft}
                  onChange={(e) => setMimeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addMime();
                    }
                  }}
                  onBlur={addMime}
                  placeholder={mimeTypes.length === 0 ? "e.g. image/png" : ""}
                  className="min-w-[100px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(false)}
              disabled={savingConfig}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveConfiguration()}
              disabled={savingConfig}
            >
              {savingConfig ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

