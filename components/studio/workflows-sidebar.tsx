"use client";

import { useState, useEffect } from "react";
import { Workflow, Plus, Pencil, Copy, Download, Trash2, MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/hooks/use-confirm";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";

function downloadJson(payload: unknown, filename: string) {
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string) {
  return String(name).replace(/[^a-zA-Z0-9]/g, "_");
}

interface WorkflowsSidebarProps {
  connectionId: number;
  openWorkflowsTab: (id?: string, name?: string) => void;
  sleek?: boolean;
}

export function WorkflowsSidebar({
  connectionId,
  openWorkflowsTab,
  sleek,
}: WorkflowsSidebarProps) {
  const confirm = useConfirm();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [search, setSearch] = useState("");

  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  useEffect(() => {
    if (!connectionId) return;
    import("@/lib/api/actions-client").then(({ listWorkflows }) => {
      listWorkflows(connectionId).then((res) => {
        if (res.success && Array.isArray(res.data)) setWorkflows(res.data);
      }).catch(() => {});
    });
  }, [connectionId]);

  useEffect(() => {
    const handleSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ workflowId?: string; name?: string }>).detail;
      if (!detail?.workflowId) return;
      setWorkflows((prev) =>
        prev.map((wf) => (wf.id === detail.workflowId ? { ...wf, name: detail.name ?? wf.name } : wf)),
      );
    };
    window.addEventListener("studio:workflow-saved", handleSaved);
    return () => window.removeEventListener("studio:workflow-saved", handleSaved);
  }, []);

  const filtered = workflows.filter((wf) =>
    wf.name.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleNew() {
    if (!connectionId) return;
    setCreating(true);
    try {
      const { createWorkflow } = await import("@/lib/api/actions-client");
      const res = await createWorkflow({
        name: "New Workflow",
        connectionId,
        nodes: [{ id: `node_${Date.now()}`, type: "trigger-manual", name: "Manual Trigger", config: {} }],
      });
      if (res.success && res.data?.id) {
        const newWf = { id: res.data.id, name: "New Workflow" };
        setWorkflows((prev) => [newWf, ...prev]);
        openWorkflowsTab(res.data.id, newWf.name);
      } else {
        openWorkflowsTab();
      }
    } catch {
      openWorkflowsTab();
    } finally {
      setCreating(false);
    }
  }

  async function handleRename() {
    if (!renameTarget) return;
    setRenaming(true);
    try {
      const { updateWorkflow } = await import("@/lib/api/actions-client");
      await updateWorkflow(renameTarget.id, { name: renameDraft.trim() || renameTarget.name });
      setWorkflows((prev) =>
        prev.map((wf) => (wf.id === renameTarget.id ? { ...wf, name: renameDraft.trim() || wf.name } : wf)),
      );
      window.dispatchEvent(new CustomEvent("studio:workflow-saved", {
        detail: { workflowId: renameTarget.id, name: renameDraft.trim() || renameTarget.name },
      }));
      setRenameTarget(null);
      import("sonner").then(({ toast }) => toast.success("Workflow renamed"));
    } catch {
      import("sonner").then(({ toast }) => toast.error("Failed to rename"));
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete(wf: any) {
    const ok = await confirm({
      title: "Delete workflow",
      description: `Delete "${wf.name}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      const { deleteWorkflow } = await import("@/lib/api/actions-client");
      await deleteWorkflow(wf.id);
      setWorkflows((prev) => prev.filter((x) => x.id !== wf.id));
      import("sonner").then(({ toast }) => toast.success("Workflow deleted"));
    } catch {
      import("sonner").then(({ toast }) => toast.error("Failed to delete"));
    }
  }

  async function handleDuplicate(wf: any) {
    try {
      const { createWorkflow } = await import("@/lib/api/actions-client");
      const res = await createWorkflow({
        name: `${wf.name} (copy)`,
        connectionId,
        nodes: wf.nodesJson ? JSON.parse(wf.nodesJson) : [],
        edges: wf.edgesJson ? JSON.parse(wf.edgesJson) : [],
        scheduleEnabled: false,
        scheduleType: null,
        scheduleValue: null,
      });
      if (res.success && res.data?.id) {
        const copy = { id: res.data.id, name: `${wf.name} (copy)` };
        setWorkflows((prev) => [copy, ...prev]);
        import("sonner").then(({ toast }) => toast.success("Workflow duplicated"));
      } else {
        import("sonner").then(({ toast }) => toast.error("Failed to duplicate"));
      }
    } catch {
      import("sonner").then(({ toast }) => toast.error("Failed to duplicate"));
    }
  }

  function handleExport(wf: any) {
    downloadJson(
      {
        name: wf.name,
        nodes: wf.nodesJson ? JSON.parse(wf.nodesJson) : [],
        edges: wf.edgesJson ? JSON.parse(wf.edgesJson) : [],
      },
      `${sanitizeFilename(wf.name)}.workflow.json`,
    );
    import("sonner").then(({ toast }) => toast.success("Workflow exported"));
  }

  return (
    <div
      className={cn(
        "relative shrink-0 border-r border-studio-border bg-popover",
        sleek && "border-r-0",
      )}
      style={{ width: sidebarWidth }}
    >
      <div className="flex flex-col overflow-hidden h-full text-muted-foreground">
        <SidebarHeader
          title="Workflows"
          actions={
            <button
              onClick={handleNew}
              disabled={creating}
              className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
            >
              <Plus className="size-4" />
            </button>
          }
        />

        <div className="px-3 py-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="h-7 text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          <button
            onClick={handleNew}
            disabled={creating}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
          >
            <Plus className="size-3.5 shrink-0" />
            <span>{creating ? "Creating..." : "New Workflow"}</span>
          </button>

          {filtered.map((wf) => (
            <div
              key={wf.id}
              className="group flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
              onClick={() => openWorkflowsTab(wf.id, wf.name)}
            >
              <Workflow className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{wf.name}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-foreground transition-opacity"
                  >
                    <MoreHorizontal className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="right"
                  className="min-w-[160px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {wf.name}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-sm"
                    onClick={() => {
                      setRenameTarget(wf);
                      setRenameDraft(wf.name);
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-sm"
                    onClick={() => handleDuplicate(wf)}
                  >
                    <Copy className="size-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-sm"
                    onClick={() => handleExport(wf)}
                  >
                    <Download className="size-3.5" />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-sm text-destructive focus:text-destructive"
                    onClick={() => handleDelete(wf)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}

          {filtered.length === 0 && !search && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">
              No workflows yet
            </div>
          )}
          {filtered.length === 0 && search && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">
              No matches
            </div>
          )}
        </div>
      </div>

      <div
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize select-none bg-transparent group"
        onPointerDown={handlePointerDown}
      >
        <div className="h-full w-px mx-auto bg-studio-border/50 group-hover:bg-blue-500/60 transition-colors" />
      </div>

      <Dialog open={!!renameTarget} onOpenChange={(next) => !next && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameTarget(null)}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleRename} disabled={renaming}>
              {renaming ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Pencil className="size-3" />
              )}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
