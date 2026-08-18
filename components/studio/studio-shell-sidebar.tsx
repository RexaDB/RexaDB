// fallow-ignore-file code-duplication
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
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
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/shared/provider-logo";
import { getConnections } from "@/lib/api/actions-client";
import type { Connection } from "@/lib/db/schema";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Search,
  Plus,
  SquarePen,
  Table2,
  Code2,
  LayoutDashboard,
  Database as DbIcon,
  Shield,
  Settings,
  Workflow,
} from "@/lib/icon-theme/solar-icons";
import {
  MoreHorizontal,
  Pencil,
  Copy,
  Download,
  Trash2,
  Loader2,
} from "lucide-react";

type Section = "dashboard" | "tables" | "sql" | "database" | "auth" | "workflows" | "import-export" | "themes" | null;

const ROW =
  "flex h-8 w-full select-none items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

/** Row chrome that keeps the hover surface while a nested menu is open. */
const ROW_MENU_OPEN = "bg-white/5 text-foreground";

type SidebarMenuActionItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
};

/**
 * List row with the action label + three-dot menu *inside* the same hover surface.
 * While the menu is open, the row stays in its hover style and the dots remain visible.
 */
function SidebarItemWithMenu({
  icon,
  label,
  onClick,
  isActive,
  menuLabel,
  actions,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  menuLabel?: string;
  actions: SidebarMenuActionItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        ROW,
        "group/item",
        (menuOpen || isActive) && ROW_MENU_OPEN,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${label} actions`}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/item:opacity-100",
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
            {menuLabel ?? label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map((action) => (
            <div key={action.label}>
              {action.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={cn(
                  "gap-2 text-sm",
                  action.destructive &&
                    "text-destructive focus:text-destructive",
                )}
                onClick={action.onClick}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RenameDialog({
  open,
  title,
  value,
  onChange,
  onClose,
  onConfirm,
  confirming,
}: {
  open: boolean;
  title: string;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
            }}
            autoFocus
            className="h-9 text-sm"
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Pencil className="size-3" />
            )}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A fresh, AppShell-styled sidebar for the studio's "New Layout". It does NOT
 * reuse the normal-mode explorer components — it renders its own Linear-style
 * nav list that drills into each section (with a Back button).
 */
export function StudioShellSidebar({
  studio,
  hideBack = false,
}: {
  studio: any;
  /** Hide the drill-in back row (Modern UI: the rail handles navigation). */
  hideBack?: boolean;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);

  // Sync local section state with the external sidebarView state
  useEffect(() => {
    const externalView = studio.sidebarView;
    if (externalView && externalView !== section) {
      setSection(externalView as Section);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.sidebarView]);

  useEffect(() => {
    let active = true;
    getConnections()
      .then((rows) => {
        if (active) setConnections(rows || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const navItems: Array<{
    id: Section;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    show?: boolean;
  }> = [
    { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
    {
      id: "tables",
      label: studio.databaseExplorer ? "Database Explorer" : "Tables",
      Icon: Table2,
    },
    { id: "sql", label: "SQL Editor", Icon: Code2 },
    {
      id: "database",
      label: "Database",
      Icon: DbIcon,
      show: studio.dbType !== "sqlite" && studio.dbType !== "redis",
    },
    {
      id: "auth",
      label: "Authentication",
      Icon: Shield,
      show: Boolean(studio.schemas?.includes?.("auth")),
    },
    { id: "workflows", label: "Workflows", Icon: Workflow },
  ];

  const title = section
    ? (navItems.find((i) => i.id === section)?.label ?? "")
    : "";

  return (
    <div className="flex h-full flex-col">
      {!section && <ConnectionSwitcher studio={studio} connections={connections} />}
      {!section ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-0.5 pb-1">
          {navItems
            .filter((i) => i.show !== false)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  studio.setSidebarView?.(item.id);
                  setSection(item.id);
                }}
                className={ROW}
              >
                <item.Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-40" />
              </button>
            ))}
          <button
            type="button"
            onClick={() => studio.openSettingsTab?.()}
            className={cn(ROW, "mt-auto")}
          >
            <Settings className="size-4 shrink-0" />
            <span>Settings</span>
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {!hideBack && (
          <button
            type="button"
            onClick={() => setSection(null)}
            className={cn(ROW, "shrink-0")}
          >
            <ChevronLeft className="size-4" />
            <span className="font-medium">{title}</span>
          </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-2 scrollbar-hide">
            {section === "tables" && <TablesPanel studio={studio} />}
            {section === "sql" && <SqlPanel studio={studio} />}
            {section === "dashboard" && <DashboardPanel studio={studio} />}
            {section === "database" && <DatabasePanel studio={studio} />}
            {section === "auth" && <AuthPanel studio={studio} />}
            {section === "workflows" && <WorkflowsPanel studio={studio} />}
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_BTN =
  "flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground";

function ConnectionSwitcher({
  studio,
  connections,
}: {
  studio: any;
  connections: Connection[];
}) {
  const router = useRouter();
  const current = studio.connection;
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingToId, setSwitchingToId] = useState<number | null>(null);

  function handleOpenChange(open: boolean) {
    // Keep the menu open while a connection switch is in progress.
    if (!open && switchingToId !== null) return;
    setMenuOpen(open);
  }

  function switchTo(id: number) {
    if (id === current?.id || switchingToId !== null) return;
    setSwitchingToId(id);
    setMenuOpen(true);
    router.push(`/studio/${id}`);
  }

  return (
    <div className="flex items-center gap-1 px-0.5 pt-1.5 pb-1 select-none">
      <div className="min-w-0 flex-1 pr-6">
      <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-1 text-sm transition-colors hover:bg-white/5 data-[state=open]:bg-white/5 outline-none focus:outline-none"
          >
            <ProviderLogo
              type={current?.connectionType}
              className="size-5 shrink-0"
            />
            <span className="truncate font-medium text-foreground">
              {current?.name ?? "Connection"}
            </span>
            {switchingToId !== null ? (
              <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[13.5rem] border-border bg-[var(--shell-history-bg)] ring-0"
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Connections
          </DropdownMenuLabel>
          {connections.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No connections
            </div>
          ) : (
            connections.map((c) => (
              <DropdownMenuItem
                key={c.id}
                className="gap-2"
                disabled={switchingToId !== null && switchingToId !== c.id}
                onSelect={(e) => {
                  // Prevent Radix from auto-closing while we navigate / load.
                  if (c.id !== current?.id) e.preventDefault();
                  switchTo(c.id);
                }}
              >
                <ProviderLogo
                  type={c.connectionType}
                  className="size-4 shrink-0"
                />
                <span className="truncate">{c.name}</span>
                {switchingToId === c.id ? (
                  <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : current?.id === c.id ? (
                  <Check className="ml-auto size-4 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            disabled={switchingToId !== null}
            onSelect={() => router.push("/")}
          >
            <Plus className="size-4" />
            <span>New connection</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <button
        type="button"
        aria-label="Search"
        onClick={() => studio.setIsCommandMenuOpen(true)}
        className={ACTION_BTN}
      >
        <Search className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="New table"
        onClick={() => studio.openCreateTableTab?.()}
        className={ACTION_BTN}
      >
        <SquarePen className="size-3.5" />
      </button>
    </div>
  );
}

function TablesPanel({ studio }: { studio: any }) {
  const [q, setQ] = useState("");
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false);
  const schemas: string[] = (studio.schemas ?? []).filter(
    (s: string) => !String(s).startsWith("pg_"),
  );
  const selectedSchema: string = studio.selectedSchema || "";
  const tables: string[] = (studio.tables ?? []).map((t: any) =>
    typeof t === "string" ? t : (t?.name ?? String(t)),
  );
  const filtered = tables.filter((t) =>
    t.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative my-1">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tables..."
          className="h-8 pl-7 text-sm"
        />
      </div>
      {/* Schema picker + new-table action under the search bar. */}
      <div className="mb-1 flex items-center gap-1">
        <DropdownMenu open={schemaMenuOpen} onOpenChange={setSchemaMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border/70 bg-white/[0.04] px-2 text-left text-xs text-muted-foreground transition-colors",
                "hover:bg-white/[0.06] hover:text-foreground",
                "outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "data-[state=open]:bg-white/[0.06] data-[state=open]:text-foreground",
              )}
            >
              <span className="shrink-0 text-muted-foreground/70">schema</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {selectedSchema || "Select…"}
              </span>
              <ChevronDown className="size-3.5 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto border-border bg-[var(--shell-content-bg)]"
          >
            {schemas.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No schemas
              </div>
            ) : (
              schemas.map((s) => (
                <DropdownMenuItem
                  key={s}
                  className="gap-2 text-xs"
                  onSelect={() => studio.setSelectedSchema?.(s)}
                >
                  <span className="min-w-0 flex-1 truncate">{s}</span>
                  {selectedSchema === s ? (
                    <Check className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="New table"
          title="New table"
          onClick={() => studio.openCreateTableTab?.()}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-white/[0.04] text-muted-foreground transition-colors",
            "hover:bg-white/[0.06] hover:text-foreground",
          )}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground">
          {q ? "No matches" : "No tables"}
        </div>
      ) : (
        filtered.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => studio.handleTableClick?.(t, studio.selectedSchema)}
            className={cn(
              ROW,
              studio.selectedTable === t && "bg-white/10 text-foreground",
            )}
          >
            <Table2 className="size-4 shrink-0" />
            <span className="truncate">{t}</span>
          </button>
        ))
      )}
    </div>
  );
}

// fallow-ignore-next-line code-duplication
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

function useRenameHandler(updateFn: (id: string, updates: { name: string }) => void) {
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const handleRename = useCallback(() => {
    if (!renameTarget) return;
    const name = renameDraft.trim() || renameTarget.name;
    updateFn(renameTarget.id, { name });
    setRenameTarget(null);
  }, [renameTarget, renameDraft, updateFn]);

  return { renameTarget, setRenameTarget, renameDraft, setRenameDraft, handleRename };
}

function SqlPanel({ studio }: { studio: any }) {
  const confirm = useConfirm();
  const snippets: any[] = studio.snippets ?? [];
  const { renameTarget, setRenameTarget, renameDraft, setRenameDraft, handleRename } = useRenameHandler(
    (id, updates) => studio.updateSnippet?.(id, updates),
  );

  function handleDuplicate(snippet: any) {
    studio.addSnippet?.(
      `${snippet.name} (copy)`,
      snippet.query ?? "",
      snippet.folderId ?? null,
    );
  }

  function handleExport(snippet: any) {
    downloadJson(
      { name: snippet.name, query: snippet.query ?? "" },
      `${sanitizeFilename(snippet.name)}.sql.json`,
    );
  }

  async function handleDelete(snippet: any) {
    const ok = await confirm({
      title: "Delete snippet",
      description: `Delete "${snippet.name}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    studio.deleteSnippet?.(snippet.id);
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <button
        type="button"
        onClick={() => studio.openSqlEditor?.()}
        className={ROW}
      >
        <Plus className="size-4 shrink-0" />
        <span>New query</span>
      </button>
      {snippets.map((s) => (
        <SidebarItemWithMenu
          key={s.id}
          icon={<Code2 className="size-4 shrink-0" />}
          label={s.name}
          onClick={() => studio.openSnippet?.(s)}
          actions={[
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onClick: () => {
                setRenameTarget(s);
                setRenameDraft(s.name);
              },
            },
            {
              label: "Duplicate",
              icon: <Copy className="size-3.5" />,
              onClick: () => handleDuplicate(s),
            },
            {
              label: "Export",
              icon: <Download className="size-3.5" />,
              onClick: () => handleExport(s),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              onClick: () => handleDelete(s),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ))}
      <RenameDialog
        open={!!renameTarget}
        title="Rename snippet"
        value={renameDraft}
        onChange={setRenameDraft}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRename}
      />
    </div>
  );
}

function DashboardPanel({ studio }: { studio: any }) {
  const confirm = useConfirm();
  const dashboards: any[] = studio.dashboards ?? [];
  const { renameTarget, setRenameTarget, renameDraft, setRenameDraft, handleRename } = useRenameHandler(
    (id, updates) => studio.updateDashboard?.(id, updates),
  );

  function handleExport(dashboard: any) {
    downloadJson(
      { name: dashboard.name, widgets: dashboard.widgets ?? [] },
      `${sanitizeFilename(dashboard.name)}.dashboard.json`,
    );
  }

  async function handleDelete(dashboard: any) {
    const ok = await confirm({
      title: "Delete dashboard",
      description: `Delete "${dashboard.name}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    studio.deleteDashboard?.(dashboard.id);
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <button
        type="button"
        onClick={() => studio.createDashboard?.("New Dashboard")}
        className={ROW}
      >
        <Plus className="size-4 shrink-0" />
        <span>New dashboard</span>
      </button>
      {dashboards.map((d) => (
        <SidebarItemWithMenu
          key={d.id}
          icon={<LayoutDashboard className="size-4 shrink-0" />}
          label={d.name}
          onClick={() => studio.openDashboardTab?.(d.id)}
          actions={[
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onClick: () => {
                setRenameTarget(d);
                setRenameDraft(d.name);
              },
            },
            {
              label: "Export",
              icon: <Download className="size-3.5" />,
              onClick: () => handleExport(d),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              onClick: () => handleDelete(d),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ))}
      <RenameDialog
        open={!!renameTarget}
        title="Rename dashboard"
        value={renameDraft}
        onChange={setRenameDraft}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRename}
      />
    </div>
  );
}

function DatabasePanel({ studio }: { studio: any }) {
  const items: Array<{ label: string; view: string }> = [
    { label: "Schema Diagram", view: "schema" },
    { label: "Tables", view: "tables" },
    { label: "Functions", view: "functions" },
    { label: "Triggers", view: "triggers" },
    { label: "Enums", view: "enums" },
    { label: "Indexes", view: "indexes" },
  ];
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {items.map((i) => (
        <button
          key={i.view}
          type="button"
          onClick={() => studio.openDatabaseTab?.(i.view)}
          className={ROW}
        >
          <DbIcon className="size-4 shrink-0" />
          <span>{i.label}</span>
        </button>
      ))}
    </div>
  );
}

function AuthPanel({ studio }: { studio: any }) {
  const items: Array<{ label: string; fn?: () => void }> = [
    { label: "Users", fn: studio.openAuthUsersTab },
    { label: "Sessions", fn: studio.openAuthSessionsTab },
    { label: "Providers", fn: studio.openAuthProvidersTab },
  ];
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          onClick={() => i.fn?.()}
          className={ROW}
        >
          <Shield className="size-4 shrink-0" />
          <span>{i.label}</span>
        </button>
      ))}
    </div>
  );
}

function WorkflowsPanel({ studio }: { studio: any }) {
  const confirm = useConfirm();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const connectionId = studio.connection?.id;

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
        studio.openWorkflowsTab?.(res.data.id, newWf.name);
      } else {
        studio.openWorkflowsTab?.();
      }
    } catch {
      studio.openWorkflowsTab?.();
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

      // Close any open tab(s) for this workflow (including split-pane variants).
      const baseId = `workflow-${wf.id}`;
      const openTabs: Array<{ id: string; baseId?: string }> =
        studio.openTabs ?? [];
      const idsToClose = openTabs
        .filter((tab) => {
          const base =
            tab.baseId ?? String(tab.id).split("::pane::")[0];
          return base === baseId;
        })
        .map((tab) => tab.id);
      if (idsToClose.length > 0) {
        if (studio.closeTabsByIds) studio.closeTabsByIds(idsToClose);
        else idsToClose.forEach((id) => studio.closeTabById?.(id));
      }

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
        connectionId: connectionId ?? 0,
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
    <div className="flex flex-col gap-0.5 pt-1">
      <button
        type="button"
        onClick={handleNew}
        disabled={creating}
        className={ROW}
      >
        <Plus className="size-4 shrink-0" />
        <span>{creating ? "Creating..." : "New Workflow"}</span>
      </button>
      {workflows.map((wf) => (
        <SidebarItemWithMenu
          key={wf.id}
          icon={<Workflow className="size-4 shrink-0" />}
          label={wf.name}
          onClick={() => studio.openWorkflowsTab?.(wf.id, wf.name)}
          actions={[
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onClick: () => {
                setRenameTarget(wf);
                setRenameDraft(wf.name);
              },
            },
            {
              label: "Duplicate",
              icon: <Copy className="size-3.5" />,
              onClick: () => handleDuplicate(wf),
            },
            {
              label: "Export",
              icon: <Download className="size-3.5" />,
              onClick: () => handleExport(wf),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              onClick: () => handleDelete(wf),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ))}
      {workflows.length === 0 && (
        <div className="px-1 py-2 text-xs text-muted-foreground">No workflows yet</div>
      )}

      <RenameDialog
        open={!!renameTarget}
        title="Rename workflow"
        value={renameDraft}
        onChange={setRenameDraft}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRename}
        confirming={renaming}
      />
    </div>
  );
}
