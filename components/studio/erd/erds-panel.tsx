"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Copy,
  Download,
  GitFork,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import { useConfirm } from "@/hooks/use-confirm";
import {
  createErdProject,
  deleteErdProject,
  duplicateErdProject,
  importErdFromSchemaData,
  listErdProjects,
  markErdFeature,
  renameErdProject,
  type ErdProject,
} from "@/lib/studio/erd-storage";
import type { ConnectionDbType } from "@/lib/db/connection-type";

const ROW =
  "flex h-8 w-full select-none items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";
const ROW_MENU_OPEN = "bg-white/5 text-foreground";

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.-]+/g, "_");
}

export function ErdsPanel({ studio }: { studio: any }) {
  const confirm = useConfirm();
  const connectionId = studio.connection?.id as number | undefined;
  const dbType = (studio.dbType || "postgres") as ConnectionDbType;
  const [projects, setProjects] = useState<ErdProject[]>([]);
  const [renameTarget, setRenameTarget] = useState<ErdProject | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const refresh = useCallback(() => {
    if (!connectionId) {
      setProjects([]);
      return;
    }
    setProjects(listErdProjects(connectionId));
  }, [connectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onSaved = () => refresh();
    window.addEventListener("studio:erd-saved", onSaved);
    return () => window.removeEventListener("studio:erd-saved", onSaved);
  }, [refresh]);

  function handleNew() {
    if (!connectionId) return;
    const project = createErdProject({
      connectionId,
      name: "New ERD",
      schemaName: studio.selectedSchema || "public",
      dbType,
    });
    markErdFeature("create");
    refresh();
    studio.openErdTab?.(project.id, project.name);
    toast.success("ERD project created");
  }

  function handleImportFromDb() {
    if (!connectionId) return;
    const schemaName = studio.selectedSchema || "public";
    const schemaData = studio.schemaData || {};
    const project = importErdFromSchemaData({
      connectionId,
      name: `${schemaName} ERD`,
      schemaName,
      dbType,
      schemaData,
    });
    markErdFeature("create");
    markErdFeature("import-db");
    if (Object.keys(project.tables).length > 0) {
      markErdFeature("add-tables");
      markErdFeature("define-columns");
    }
    refresh();
    studio.openErdTab?.(project.id, project.name);
    toast.success(
      Object.keys(project.tables).length > 0
        ? `Imported ${Object.keys(project.tables).length} tables`
        : "Created empty ERD (no tables in current schema)",
    );
  }

  async function handleRename() {
    if (!connectionId || !renameTarget) return;
    const name = renameDraft.trim() || renameTarget.name;
    const updated = renameErdProject(connectionId, renameTarget.id, name);
    if (updated) {
      window.dispatchEvent(
        new CustomEvent("studio:erd-saved", {
          detail: { erdId: updated.id, name: updated.name },
        }),
      );
      refresh();
      toast.success("ERD renamed");
    }
    setRenameTarget(null);
  }

  async function handleDelete(project: ErdProject) {
    if (!connectionId) return;
    const ok = await confirm({
      title: "Delete ERD",
      description: `Delete "${project.name}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    deleteErdProject(connectionId, project.id);

    const baseId = `erd-${project.id}`;
    const openTabs: Array<{ id: string; baseId?: string }> =
      studio.openTabs ?? [];
    const idsToClose = openTabs
      .filter((tab) => {
        const base = tab.baseId ?? String(tab.id).split("::pane::")[0];
        return base === baseId;
      })
      .map((tab) => tab.id);
    if (idsToClose.length > 0) {
      if (studio.closeTabsByIds) studio.closeTabsByIds(idsToClose);
      else idsToClose.forEach((id) => studio.closeTabById?.(id));
    }

    refresh();
    toast.success("ERD deleted");
  }

  function handleDuplicate(project: ErdProject) {
    if (!connectionId) return;
    const copy = duplicateErdProject(connectionId, project.id);
    if (!copy) return;
    refresh();
    toast.success("ERD duplicated");
  }

  function handleExport(project: ErdProject) {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilename(project.name)}.erd.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("ERD exported");
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <button type="button" onClick={handleNew} className={ROW}>
        <Plus className="size-4 shrink-0" />
        <span>New ERD</span>
      </button>
      <button type="button" onClick={handleImportFromDb} className={ROW}>
        <Download className="size-4 shrink-0 rotate-180" />
        <span>Import from database</span>
      </button>

      {projects.map((project) => (
        <ErdSidebarItem
          key={project.id}
          project={project}
          isActive={studio.openTabs?.some(
            (tab: { id: string }) =>
              tab.id === `erd-${project.id}` ||
              String(tab.id).startsWith(`erd-${project.id}::pane::`),
          )}
          onOpen={() => studio.openErdTab?.(project.id, project.name)}
          onRename={() => {
            setRenameTarget(project);
            setRenameDraft(project.name);
          }}
          onDuplicate={() => handleDuplicate(project)}
          onExport={() => handleExport(project)}
          onDelete={() => handleDelete(project)}
        />
      ))}

      {projects.length === 0 && (
        <div className="px-1 py-2 text-xs text-muted-foreground">
          No ERD projects yet
        </div>
      )}

      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename ERD</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
            }}
            autoFocus
            className="h-9 text-sm"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameTarget(null)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleRename()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErdSidebarItem({
  project,
  isActive,
  onOpen,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: {
  project: ErdProject;
  isActive?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={cn(ROW, "group/item", (menuOpen || isActive) && ROW_MENU_OPEN)}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <GitFork className="size-4 shrink-0" />
        <span className="truncate">{project.name}</span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${project.name} actions`}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
              menuOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="right"
          className="min-w-[160px] border-border bg-[var(--shell-history-bg)] ring-0"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {project.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 text-sm" onClick={onRename}>
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-sm" onClick={onDuplicate}>
            <Copy className="size-3.5" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-sm" onClick={onExport}>
            <Download className="size-3.5" />
            Export JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-sm text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
