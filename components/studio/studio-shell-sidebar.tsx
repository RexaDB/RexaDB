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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProviderLogo } from "@/components/shared/provider-logo";
import { getTabIcon } from "@/lib/studio/tab-registry";
import { isPostgresCatalogDbType } from "@/lib/db/connection-type";
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
  Layers,
  Folder,
  FolderOpen,
} from "@/lib/icon-theme/solar-icons";
import {
  MoreHorizontal,
  Pencil,
  Copy,
  Download,
  Trash2,
  Loader2,
  FunctionSquare,
  Gauge,
  Braces,
  CreditCard,
  Globe,
  Unlock,
  MoreVertical,
  Eye,
  Tag,
  X,
} from "lucide-react";
import { PaymentsPanel } from "./payments/payments-panel";
import { StoragePanel } from "./storage/storage-panel";
import { EdgeFunctionsPanel } from "./edge-functions/edge-functions-panel";
import { ErdsPanel } from "./erd/erds-panel";
import { shouldShowPayments } from "@/lib/supabase-paykit/supabase-ref";
import { shouldShowStorage } from "@/lib/studio/storage-utils";
import { shouldShowEdgeFunctions } from "@/lib/studio/edge-functions-utils";
import { GitFork } from "@/lib/icon-theme/lucide-react";
import { HardDrive } from "@/lib/icon-theme/lucide-react";
import { EdgeFunctionsIcon } from "@/lib/icon-theme/lucide-react";
import { Puzzle } from "@/lib/icon-theme/lucide-react";
import { ExtensionSidebarSection } from "./extension-sidebar-section";
import { ExtensionManagerSection } from "./extension-manager-section";
import { parseExtensionsSidebarView } from "@/lib/extensions/sidebar-view";
import { useExtensions } from "@/lib/extensions/react";
import { TableContextMenuItems } from "./database/table-utils";
import {
  ConfirmDialogState,
  DEFAULT_CONFIRM_DIALOG,
  copyItemName,
  getTableDerivedValues,
} from "@/lib/studio/table-utils";

type Section = "dashboard" | "notes" | "tables" | "sql" | "database" | "auth" | "workflows" | "payments" | "storage" | "edge-functions" | "import-export" | "themes" | "erd" | "extensions" | null;

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
          className="min-w-[160px] border border-border bg-[var(--shell-history-bg)] ring-0"
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
  // Extension sidebars address as `extensions` (all) or
  // `extensions:<containerId>` (one container, rail target).
  const extensionsView = parseExtensionsSidebarView(section as string | null);
  // Per-container sidebar title (rail target `extensions:<containerId>` shows
  // the container's title, not a generic "Extensions"). The hook falls back
  // to empty lists outside the provider, so this is always safe.
  const { containers: extensionContainers } = useExtensions();
  const extensionContainerTitle =
    extensionsView.active && extensionsView.containerId
      ? extensionContainers.find((c) => c.containerId === extensionsView.containerId)?.title
      : undefined;

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
    { id: "notes", label: "Notes", Icon: SquarePen },
    {
      id: "tables",
      label: studio.databaseExplorer
        ? "Database Explorer"
        : studio.schemaExplorer
          ? "Schema Explorer"
          : "Tables",
      Icon: studio.databaseExplorer
        ? DbIcon
        : studio.schemaExplorer
          ? Layers
          : Table2,
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
    {
      id: "payments",
      label: "Payments",
      Icon: CreditCard,
      // supabase-mgmt connections + direct Postgres connections to Supabase
      // (db.<ref>.supabase.co). Other engines have no Edge Functions target.
      show: shouldShowPayments(
        studio.connection?.connectionType ?? studio.dbType,
        studio.connection?.connectionString,
      ),
    },
    {
      id: "storage",
      label: "Storage",
      Icon: HardDrive,
      // supabase-mgmt + direct Postgres-to-Supabase connections (or any
      // connection exposing a `storage` schema). Hidden elsewhere.
      show: shouldShowStorage(
        studio.connection?.connectionType ?? studio.dbType,
        studio.connection?.connectionString,
        studio.schemas,
      ),
    },
    {
      id: "edge-functions",
      label: "Edge Functions",
      Icon: EdgeFunctionsIcon,
      // Supabase projects only (mgmt API): supabase-mgmt + direct
      // Postgres-to-Supabase connections.
      show: shouldShowEdgeFunctions(
        studio.connection?.connectionType ?? studio.dbType,
        studio.connection?.connectionString,
      ),
    },
    { id: "workflows", label: "Workflows", Icon: Workflow },
    { id: "erd", label: "ERD Designer", Icon: GitFork },
    { id: "extensions", label: "Extensions", Icon: Puzzle },
  ];

  const title = section
    ? (extensionsView.active
        ? (extensionContainerTitle ?? "Extensions")
        : (navItems.find((i) => i.id === section)?.label ?? ""))
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
            {section === "notes" && <NotesPanel studio={studio} />}
            {section === "database" && <DatabasePanel studio={studio} />}
            {section === "auth" && <AuthPanel studio={studio} />}
            {section === "payments" && <PaymentsPanel studio={studio} />}
            {section === "storage" && <StoragePanel studio={studio} />}
            {section === "edge-functions" && <EdgeFunctionsPanel studio={studio} />}
            {section === "workflows" && <WorkflowsPanel studio={studio} />}
            {section === "erd" && <ErdsPanel studio={studio} />}
            {extensionsView.active && extensionsView.containerId ? (
              // Standalone container sidebar: ONLY that container's views.
              <ExtensionSidebarSection studio={studio} activeContainer={extensionsView.containerId} />
            ) : (
              // Extensions manager sidebar: management only, never content views.
              extensionsView.active && <ExtensionManagerSection studio={studio} />
            )}
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
          className="w-[13.5rem] border border-border bg-[var(--shell-history-bg)] ring-0"
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

/** Collapsible section header used by Schema Explorer mode (Tables / Functions / Triggers / Indexes / Enums). */
function SchemaSectionHeader({
  label,
  icon: Icon,
  count,
  expanded,
  onToggle,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
    >
      <ChevronRight
        className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
      />
      <Icon className="size-3.5 shrink-0" />
      <span>{label}</span>
      <span className="text-muted-foreground/50">({count})</span>
    </button>
  );
}

/** Expandable row for a schema object (function/trigger/index/enum) with inline detail lines. */
function SchemaItemRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: Array<{ term: string; value: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={ROW}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
        {detail && detail.length > 0 && (
          <ChevronRight
            className={cn(
              "ml-auto size-3 shrink-0 opacity-40 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && detail && detail.length > 0 && (
        <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-border/40 pl-2 text-xs">
          {detail.map((d) => (
            <div key={d.term} className="flex items-start gap-1.5">
              <span className="shrink-0 text-muted-foreground/60">{d.term}:</span>
              <span className="min-w-0 truncate text-foreground/80">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single table row shared by flat + tags-folder views (with menus). */
function SidebarTableRow({
  table,
  selectedSchema,
  studio,
  viewTableSet,
  itemNoun,
  openEditorLabel,
  copyDefinitionLabel,
  canExportSql,
  isMongo,
  tagsList,
  tableTagsMap,
  tagsForTable,
  setConfirmDialog,
  handleCopyItemName,
}: {
  table: string;
  selectedSchema: string;
  studio: any;
  viewTableSet: Set<any>;
  itemNoun: string;
  openEditorLabel: string;
  copyDefinitionLabel: string;
  canExportSql: boolean;
  isMongo: boolean;
  tagsList: Array<{ name: string; color: string }>;
  tableTagsMap: Record<string, string[]>;
  tagsForTable: (table: string) => string[];
  confirmDialog?: unknown;
  setConfirmDialog: (d: any) => void;
  handleCopyItemName: (name: string) => void;
}) {
  const securityInfo = studio.tableSecurity?.[table];
  const rlsEnabled = securityInfo?.rlsEnabled;
  const showDataApi = Boolean(studio.dataApiInstalled);
  const isView = viewTableSet.has(table);
  const ItemIcon = isView ? Eye : Table2;

  const renderMenuItems = (
    Component: any,
    Sub: any,
    SubTrigger: any,
    SubContent: any,
    Separator: any,
    isDropdown = false,
  ) => {
    const handleAction =
      (fn?: (t: string, s: string) => void) =>
      (e: React.MouseEvent) => {
        if (isDropdown) e.stopPropagation();
        fn?.(table, selectedSchema);
      };
    return (
      <>
        <Component
          onClick={handleAction((t) => studio.handleTableClick?.(t, selectedSchema))}
        >
          Open {itemNoun}
        </Component>
        <Component
          onClick={handleAction((t, s) => studio.openSqlEditor?.(t, s))}
        >
          {openEditorLabel}
        </Component>
        <Component
          onClick={handleAction((t) => studio.viewTableSchema?.(t))}
        >
          View Schema
        </Component>
        <TableContextMenuItems
          Component={Component}
          Sub={Sub}
          SubTrigger={SubTrigger}
          SubContent={SubContent}
          Separator={Separator}
          itemNoun={itemNoun}
          copyDefinitionLabel={copyDefinitionLabel}
          duplicateLabel={`Duplicate ${itemNoun}`}
          isMongo={isMongo}
          canExportSql={canExportSql}
          isDropdown={isDropdown}
          table={table}
          selectedSchema={selectedSchema}
          tags={tagsList}
          tableTags={tableTagsMap}
          handleAction={handleAction}
          onToggleTag={(s, t, tagName) => studio.toggleTableTag?.(s, t, tagName)}
          handleCopyName={(t) => void handleCopyItemName(t)}
          handleCopyDefinition={(t, s) => studio.copyTableSchema?.(t, s)}
          handleDuplicate={(t, s) => studio.duplicateTable?.(t, s)}
          onExport={(format) => studio.exportData?.(format)}
          setConfirmDialog={setConfirmDialog}
          onEmpty={(t, s) => studio.emptyTable?.(t, s)}
          onDelete={(t, s) => studio.deleteTable?.(t, s)}
          beforeExport={<Separator />}
        />
      </>
    );
  };

  return (
    <ContextMenu key={`${selectedSchema}.${table}`}>
      <ContextMenuTrigger>
        <div className="relative group">
          <button
            type="button"
            onClick={() => studio.handleTableClick?.(table, selectedSchema)}
            className={cn(
              ROW,
              studio.selectedTable === table && "bg-white/10 text-foreground",
              "w-full",
            )}
          >
            <ItemIcon className="size-4 shrink-0" />
            <span className="truncate flex-1">{table}</span>
            {(showDataApi || rlsEnabled === false) && (
              <span className="flex items-center gap-1 shrink-0">
                {showDataApi && (
                  <span title="Accessible via Data API">
                    <Globe className="w-3.5 h-3.5 text-primary/70" />
                  </span>
                )}
                {rlsEnabled === false && (
                  <span title="RLS disabled">
                    <Unlock className="w-3.5 h-3.5 text-red-500/80" />
                  </span>
                )}
              </span>
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={cn(
                  "absolute right-1 top-1/2 -translate-y-1/2 size-6 shrink-0 flex items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
                  "opacity-0 group-hover:opacity-100",
                )}
              >
                <MoreVertical className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[160px]"
              onClick={(e) => e.stopPropagation()}
            >
              {renderMenuItems(
                DropdownMenuItem,
                DropdownMenuSub,
                DropdownMenuSubTrigger,
                DropdownMenuSubContent,
                DropdownMenuSeparator,
                true,
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px]">
        {renderMenuItems(
          ContextMenuItem,
          ContextMenuSub,
          ContextMenuSubTrigger,
          ContextMenuSubContent,
          ContextMenuSeparator,
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Collapsible tag folders + untagged group, styled like a file tree
 *  (disclosure chevron, themed folder icon, indent guides, compact rows). */
function TagFoldersList({
  tagsList,
  tablesByTag,
  untaggedTables,
  isTagExpanded,
  toggleTag,
  onManageTags,
  onRenameTag,
  onDeleteTag,
  renderTable,
}: {
  tagsList: Array<{ name: string; color: string }>;
  tablesByTag: Map<string, string[]>;
  untaggedTables: string[];
  isTagExpanded: (name: string) => boolean;
  toggleTag: (name: string) => void;
  onManageTags: () => void;
  onRenameTag: (name: string) => void;
  onDeleteTag: (name: string) => void;
  renderTable: (table: string) => React.ReactNode;
}) {
  // No early return on empty tags: the Untagged group below always
  // renders, so tables never disappear from Tags view.
  const renderFolderRow = (
    name: string,
    expanded: boolean,
    folderColor: string | null,
    onToggle: () => void,
  ) => {
    const FolderIcon = expanded ? FolderOpen : Folder;
    return (
      <button
        type="button"
        onClick={onToggle}
        title={name}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors select-none hover:bg-white/5 hover:text-foreground"
      >
        <FolderIcon
          className="size-4 shrink-0"
          style={folderColor ? { color: folderColor } : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-left font-normal">{name}</span>
      </button>
    );
  };
  const renderChildren = (tables: string[], emptyLabel: string) => (
    <div className="relative ml-[15px] space-y-px border-l border-border/50 pl-1">
      {tables.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground/60">{emptyLabel}</div>
      ) : (
        tables.map((t) => renderTable(t))
      )}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-px py-0.5">
      {tagsList.length === 0 && (
        <button
          type="button"
          onClick={onManageTags}
          title="Create your first tag"
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors select-none hover:bg-white/5 hover:text-foreground"
        >
          <Tag className="size-4 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate text-left font-normal">No tags yet — create one</span>
        </button>
      )}
      {tagsList.map((tag) => {
        const tables = tablesByTag.get(tag.name) ?? [];
        const expanded = isTagExpanded(tag.name);
        return (
          <div key={tag.name} className="min-w-0">
            <ContextMenu>
              <ContextMenuTrigger>
                {renderFolderRow(tag.name, expanded, tag.color, () =>
                  toggleTag(tag.name),
                )}
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-[160px]">
                <ContextMenuItem onClick={() => onRenameTag(tag.name)}>
                  Rename tag
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                  onClick={() => onDeleteTag(tag.name)}
                >
                  Delete tag
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {expanded && renderChildren(tables, "No tables")}
          </div>
        );
      })}
      <div className="min-w-0">
        {renderFolderRow(
          "Untagged",
          isTagExpanded("__untagged"),
          null,
          () => toggleTag("__untagged"),
        )}
        {isTagExpanded("__untagged") &&
          renderChildren(untaggedTables, "Everything is tagged")}
      </div>
    </div>
  );
}

function TablesPanel({ studio }: { studio: any }) {
  const [q, setQ] = useState("");
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tables: true,
    functions: true,
    triggers: true,
    indexes: true,
    enums: true,
  });
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(
    DEFAULT_CONFIRM_DIALOG,
  );
  // Tags-as-folders view state (persisted via studio.sidebarSortMode).
  const tagView = (studio.sidebarSortMode ?? "alphabetical") === "tags";
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#38bdf8");
  const [renameTagName, setRenameTagName] = useState<string | null>(null);
  const [renameTagDraft, setRenameTagDraft] = useState("");
  function openRenameTagDialog(name: string) {
    setRenameTagName(name);
    setRenameTagDraft(name);
  }
  function handleRenameTag() {
    if (renameTagName) studio.renameTag?.(renameTagName, renameTagDraft);
    setRenameTagName(null);
  }
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

  const schemaExplorer = Boolean(studio.schemaExplorer);
  const isPostgres = isPostgresCatalogDbType(studio.dbType);
  const isRoutineDb = isPostgres || studio.dbType === "mssql";
  const qLower = q.toLowerCase();

  const functions: any[] = schemaExplorer && isRoutineDb ? (studio.functions ?? []) : [];
  const triggers: any[] = schemaExplorer && isRoutineDb ? (studio.triggers ?? []) : [];
  const indexes: any[] = schemaExplorer && isPostgres ? (studio.indexes ?? []) : [];
  const enums: any[] = schemaExplorer && isPostgres ? (studio.enums ?? []) : [];

  const filteredFunctions = qLower
    ? functions.filter((f) => f.name?.toLowerCase().includes(qLower))
    : functions;
  const filteredTriggers = qLower
    ? triggers.filter((t) => t.name?.toLowerCase().includes(qLower))
    : triggers;
  const filteredIndexes = qLower
    ? indexes.filter((i) => i.name?.toLowerCase().includes(qLower))
    : indexes;
  const filteredEnums = (
    qLower
      ? enums.filter(
          (e) => e.schema === selectedSchema && e.name?.toLowerCase().includes(qLower),
        )
      : enums.filter((e) => e.schema === selectedSchema)
  );

  const { isMongo, itemNoun, copyDefinitionLabel, canExportSql } =
    getTableDerivedValues(studio.dbType);
  const editorLabel =
    studio.dbType === "postgres" || studio.dbType === "supabase-mgmt"
      ? "SQL Editor"
      : studio.dbType === "mongodb"
        ? "Mongo Editor"
        : studio.dbType === "redis"
          ? "Redis Editor"
          : "Editor";
  const openEditorLabel = `Open in ${editorLabel}`;
  const viewTableSet = new Set(studio.viewTables ?? []);

  const handleCopyItemName = (name: string) => copyItemName(name, itemNoun);

  function toggleSection(section: string) {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  // ---- Tags-as-folders derived state ----
  const tagsList: Array<{ name: string; color: string }> = studio.tags ?? [];
  const tableTagsMap: Record<string, string[]> = studio.tableTags ?? {};
  const tagKeyFor = (table: string) => `${selectedSchema}.${table}`;
  const tagsForTable = (table: string): string[] =>
    tableTagsMap[tagKeyFor(table)] ?? [];
  const TAG_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8"];
  const isTagExpanded = (name: string) => expandedTags[name] ?? true;
  function toggleTag(name: string) {
    setExpandedTags((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
  }
  const untaggedTables = filtered.filter((t) => tagsForTable(t).length === 0);
  const tablesByTag = new Map<string, string[]>();
  for (const tag of tagsList) {
    tablesByTag.set(
      tag.name,
      filtered.filter((t) => tagsForTable(t).includes(tag.name)),
    );
  }
  function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    studio.addTag?.(name, newTagColor);
    setNewTagName("");
  }

  return (
    <div className="flex flex-col gap-0.5">
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent className="bg-popover border-border text-foreground shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold">
              {confirmDialog.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 text-xs border-border bg-transparent hover:bg-muted transition-colors">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              }}
              className={
                confirmDialog.variant === "destructive"
                  ? "bg-red-500 hover:bg-red-600 text-white border-none h-9 text-xs"
                  : "bg-primary hover:bg-primary/90 text-white border-none h-9 text-xs"
              }
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="relative my-1">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={schemaExplorer ? "Search..." : "Search tables..."}
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
      {/* A-Z / Tags view toggle + new-tag entry — under the schema picker. */}
      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-7 w-auto shrink-0 items-center rounded-lg border border-border/70 bg-white/[0.04] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => studio.setSidebarSortMode?.("alphabetical")}
            className={cn(
              "flex h-full items-center justify-center rounded-md px-3 transition-colors",
              !tagView ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">A-Z</span>
          </button>
        <button
          type="button"
          onClick={() => studio.setSidebarSortMode?.("tags")}
          className={cn(
            "flex h-full items-center justify-center rounded-md px-3 transition-colors",
            tagView ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="truncate">Tags</span>
        </button>
        </div>
        {tagView && (
        <button
          type="button"
          onClick={() => setTagManagerOpen(true)}
          className="ml-auto flex h-7 shrink-0 items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" />
          <span>New Tag</span>
        </button>
        )}
      </div>

      <Dialog open={tagManagerOpen} onOpenChange={setTagManagerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tags as folders</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateTag();
                }}
                placeholder="New tag name…"
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use color ${c}`}
                  onClick={() => setNewTagColor(c)}
                  className={cn(
                    "size-5 rounded-full border transition-transform",
                    newTagColor === c ? "scale-110 border-foreground" : "border-border",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {tagsList.length === 0 ? (
                <div className="px-1 py-2 text-xs text-muted-foreground">
                  No tags yet. Create one, then right-click a table → Tags to assign it.
                </div>
              ) : (
                tagsList.map((tag) => (
                  <div
                    key={tag.name}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/5"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{tag.name}</span>
                    <button
                      type="button"
                      aria-label={`Delete tag ${tag.name}`}
                      onClick={() => studio.removeTag?.(tag.name)}
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Tip: use Tags view to browse tables grouped in tag folders. A table with several tags appears in each folder.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTagManagerOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTagName !== null} onOpenChange={(open) => !open && setRenameTagName(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename tag</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTagDraft}
            onChange={(e) => setRenameTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameTag();
            }}
            autoFocus
            className="h-9 text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRenameTagName(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleRenameTag} disabled={!renameTagDraft.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!schemaExplorer || !isPostgres ? (
        tagView ? (
          <TagFoldersList
            tagsList={tagsList}
            tablesByTag={tablesByTag}
            untaggedTables={untaggedTables}
            isTagExpanded={isTagExpanded}
            toggleTag={toggleTag}
            onManageTags={() => setTagManagerOpen(true)}
            onRenameTag={openRenameTagDialog}
            onDeleteTag={(name) => studio.removeTag?.(name)}
            renderTable={(table) => (
              <SidebarTableRow
                key={`${selectedSchema}.${table}`}
                table={table}
                selectedSchema={selectedSchema}
                studio={studio}
                viewTableSet={viewTableSet}
                itemNoun={itemNoun}
                openEditorLabel={openEditorLabel}
                copyDefinitionLabel={copyDefinitionLabel}
                canExportSql={canExportSql}
                isMongo={isMongo}
                tagsList={tagsList}
                tableTagsMap={tableTagsMap}
                tagsForTable={tagsForTable}
                confirmDialog={confirmDialog}
                setConfirmDialog={setConfirmDialog}
                handleCopyItemName={handleCopyItemName}
              />
            )}
          />
        ) : filtered.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {q ? "No matches" : "No tables"}
          </div>
        ) : (
          filtered.map((table) => {
            const securityInfo = studio.tableSecurity?.[table];
            const rlsEnabled = securityInfo?.rlsEnabled;
            const showDataApi = Boolean(studio.dataApiInstalled);
            const isView = viewTableSet.has(table);
            const ItemIcon = isView ? Eye : Table2;

            const renderMenuItems = (
              Component: any,
              Sub: any,
              SubTrigger: any,
              SubContent: any,
              Separator: any,
              isDropdown = false,
            ) => {
              const handleAction =
                (fn?: (t: string, s: string) => void) =>
                (e: React.MouseEvent) => {
                  if (isDropdown) e.stopPropagation();
                  fn?.(table, selectedSchema);
                };

              return (
                <>
                  <Component
                    onClick={handleAction((t) => studio.handleTableClick?.(t, selectedSchema))}
                  >
                    Open {itemNoun}
                  </Component>
                  <Component
                    onClick={handleAction((t, s) =>
                      studio.openSqlEditor?.(t, s),
                    )}
                  >
                    {openEditorLabel}
                  </Component>
                  <Component
                    onClick={handleAction((t) => studio.viewTableSchema?.(t))}
                  >
                    View Schema
                  </Component>
                  <TableContextMenuItems
                    Component={Component}
                    Sub={Sub}
                    SubTrigger={SubTrigger}
                    SubContent={SubContent}
                    Separator={Separator}
                    itemNoun={itemNoun}
                    copyDefinitionLabel={copyDefinitionLabel}
                    duplicateLabel={`Duplicate ${itemNoun}`}
                    isMongo={isMongo}
                    canExportSql={canExportSql}
                    isDropdown={isDropdown}
                    table={table}
                    selectedSchema={selectedSchema}
                    tags={studio.tags ?? []}
                    tableTags={studio.tableTags ?? {}}
                    handleAction={handleAction}
                    onToggleTag={(s, t, tagName) =>
                      studio.toggleTableTag?.(s, t, tagName)
                    }
                    handleCopyName={(t) => void handleCopyItemName(t)}
                    handleCopyDefinition={(t, s) => studio.copyTableSchema?.(t, s)}
                    handleDuplicate={(t, s) => studio.duplicateTable?.(t, s)}
                    onExport={(format) => studio.exportData?.(format)}
                    setConfirmDialog={setConfirmDialog}
                    onEmpty={(t, s) => studio.emptyTable?.(t, s)}
                    onDelete={(t, s) => studio.deleteTable?.(t, s)}
                    beforeExport={<Separator />}
                  />
                </>
              );
            };

            return (
              <ContextMenu key={`${selectedSchema}.${table}`}>
                <ContextMenuTrigger>
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={() => studio.handleTableClick?.(table, selectedSchema)}
                      className={cn(
                        ROW,
                        studio.selectedTable === table && "bg-white/10 text-foreground",
                        "w-full",
                      )}
                    >
                      <ItemIcon className="size-4 shrink-0" />
                      <span className="truncate flex-1">{table}</span>
                      {(showDataApi || rlsEnabled === false) && (
                        <span className="flex items-center gap-1 shrink-0">
                          {showDataApi && (
                            <span title="Accessible via Data API">
                              <Globe className="w-3.5 h-3.5 text-primary/70" />
                            </span>
                          )}
                          {rlsEnabled === false && (
                            <span title="RLS disabled">
                              <Unlock className="w-3.5 h-3.5 text-red-500/80" />
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={cn(
                            "absolute right-1 top-1/2 -translate-y-1/2 size-6 shrink-0 flex items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
                            "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <MoreVertical className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-[160px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderMenuItems(
                          DropdownMenuItem,
                          DropdownMenuSub,
                          DropdownMenuSubTrigger,
                          DropdownMenuSubContent,
                          DropdownMenuSeparator,
                          true,
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[160px]">
                  {renderMenuItems(
                    ContextMenuItem,
                    ContextMenuSub,
                    ContextMenuSubTrigger,
                    ContextMenuSubContent,
                    ContextMenuSeparator,
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )
      ) : (
        <div className="flex flex-col gap-2">
          {/* Tables */}
          <div>
            <SchemaSectionHeader
              label="Tables"
              icon={Table2}
              count={filtered.length}
              expanded={expandedSections.tables}
              onToggle={() => toggleSection("tables")}
            />
            {expandedSections.tables && (
              <div className="space-y-0.5">
                {tagView ? (
                  <TagFoldersList
                    tagsList={tagsList}
                    tablesByTag={tablesByTag}
                    untaggedTables={untaggedTables}
                    isTagExpanded={isTagExpanded}
                    toggleTag={toggleTag}
                    onManageTags={() => setTagManagerOpen(true)}
                    onRenameTag={openRenameTagDialog}
                    onDeleteTag={(name) => studio.removeTag?.(name)}
                    renderTable={(table) => (
                      <SidebarTableRow
                        key={`${selectedSchema}.${table}`}
                        table={table}
                        selectedSchema={selectedSchema}
                        studio={studio}
                        viewTableSet={viewTableSet}
                        itemNoun={itemNoun}
                        openEditorLabel={openEditorLabel}
                        copyDefinitionLabel={copyDefinitionLabel}
                        canExportSql={canExportSql}
                        isMongo={isMongo}
                        tagsList={tagsList}
                        tableTagsMap={tableTagsMap}
                        tagsForTable={tagsForTable}
                        setConfirmDialog={setConfirmDialog}
                        handleCopyItemName={handleCopyItemName}
                      />
                    )}
                  />
                ) : filtered.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No tables found
                  </div>
                ) : (
                  filtered.map((table) => {
                    const securityInfo = studio.tableSecurity?.[table];
                    const rlsEnabled = securityInfo?.rlsEnabled;
                    const showDataApi = Boolean(studio.dataApiInstalled);
                    const isView = viewTableSet.has(table);
                    const ItemIcon = isView ? Eye : Table2;

                    const renderMenuItems = (
                      Component: any,
                      Sub: any,
                      SubTrigger: any,
                      SubContent: any,
                      Separator: any,
                      isDropdown = false,
                    ) => {
                      const handleAction =
                        (fn?: (t: string, s: string) => void) =>
                        (e: React.MouseEvent) => {
                          if (isDropdown) e.stopPropagation();
                          fn?.(table, selectedSchema);
                        };

                      return (
                        <>
                          <Component
                            onClick={handleAction((t) => studio.handleTableClick?.(t, selectedSchema))}
                          >
                            Open {itemNoun}
                          </Component>
                          <Component
                            onClick={handleAction((t, s) =>
                              studio.openSqlEditor?.(t, s),
                            )}
                          >
                            {openEditorLabel}
                          </Component>
                          <Component
                            onClick={handleAction((t) => studio.viewTableSchema?.(t))}
                          >
                            View Schema
                          </Component>
                          <TableContextMenuItems
                            Component={Component}
                            Sub={Sub}
                            SubTrigger={SubTrigger}
                            SubContent={SubContent}
                            Separator={Separator}
                            itemNoun={itemNoun}
                            copyDefinitionLabel={copyDefinitionLabel}
                            duplicateLabel={`Duplicate ${itemNoun}`}
                            isMongo={isMongo}
                            canExportSql={canExportSql}
                            isDropdown={isDropdown}
                            table={table}
                            selectedSchema={selectedSchema}
                            tags={studio.tags ?? []}
                            tableTags={studio.tableTags ?? {}}
                            handleAction={handleAction}
                            onToggleTag={(s, t, tagName) =>
                              studio.toggleTableTag?.(s, t, tagName)
                            }
                            handleCopyName={(t) => void handleCopyItemName(t)}
                            handleCopyDefinition={(t, s) => studio.copyTableSchema?.(t, s)}
                            handleDuplicate={(t, s) => studio.duplicateTable?.(t, s)}
                            onExport={(format) => studio.exportData?.(format)}
                            setConfirmDialog={setConfirmDialog}
                            onEmpty={(t, s) => studio.emptyTable?.(t, s)}
                            onDelete={(t, s) => studio.deleteTable?.(t, s)}
                            beforeExport={<Separator />}
                          />
                        </>
                      );
                    };

                    return (
                      <ContextMenu key={`${selectedSchema}.${table}`}>
                        <ContextMenuTrigger>
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => studio.handleTableClick?.(table, selectedSchema)}
                              className={cn(
                                ROW,
                                studio.selectedTable === table && "bg-white/10 text-foreground",
                                "w-full",
                              )}
                            >
                              <ItemIcon className="size-4 shrink-0" />
                              <span className="truncate flex-1">{table}</span>
                              {(showDataApi || rlsEnabled === false) && (
                                <span className="flex items-center gap-1 shrink-0">
                                  {showDataApi && (
                                    <span title="Accessible via Data API">
                                      <Globe className="w-3.5 h-3.5 text-primary/70" />
                                    </span>
                                  )}
                                  {rlsEnabled === false && (
                                    <span title="RLS disabled">
                                      <Unlock className="w-3.5 h-3.5 text-red-500/80" />
                                    </span>
                                  )}
                                </span>
                              )}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                asChild
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className={cn(
                                    "absolute right-1 top-1/2 -translate-y-1/2 size-6 shrink-0 flex items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-white/10 hover:text-foreground focus:opacity-100 focus-visible:outline-none",
                                    "opacity-0 group-hover:opacity-100",
                                  )}
                                >
                                  <MoreVertical className="size-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="min-w-[160px] border border-border bg-popover shadow-2xl"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {renderMenuItems(
                                  DropdownMenuItem,
                                  DropdownMenuSub,
                                  DropdownMenuSubTrigger,
                                  DropdownMenuSubContent,
                                  DropdownMenuSeparator,
                                  true,
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-[160px]">
                          {renderMenuItems(
                            ContextMenuItem,
                            ContextMenuSub,
                            ContextMenuSubTrigger,
                            ContextMenuSubContent,
                            ContextMenuSeparator,
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Functions */}
          <div>
            <SchemaSectionHeader
              label="Functions"
              icon={FunctionSquare}
              count={filteredFunctions.length}
              expanded={expandedSections.functions}
              onToggle={() => toggleSection("functions")}
            />
            {expandedSections.functions && (
              <div className="space-y-0.5">
                {filteredFunctions.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No functions found
                  </div>
                ) : (
                  filteredFunctions.map((f, idx) => (
                    <SchemaItemRow
                      key={`func-${f.name}-${idx}`}
                      icon={FunctionSquare}
                      label={f.name}
                      detail={[
                        ...(f.return_type ? [{ term: "Returns", value: f.return_type }] : []),
                        ...(f.language ? [{ term: "Language", value: f.language }] : []),
                      ]}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Triggers */}
          <div>
            <SchemaSectionHeader
              label="Triggers"
              icon={Workflow}
              count={filteredTriggers.length}
              expanded={expandedSections.triggers}
              onToggle={() => toggleSection("triggers")}
            />
            {expandedSections.triggers && (
              <div className="space-y-0.5">
                {filteredTriggers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No triggers found
                  </div>
                ) : (
                  filteredTriggers.map((t, idx) => (
                    <SchemaItemRow
                      key={`trig-${t.name}-${idx}`}
                      icon={Workflow}
                      label={t.name}
                      detail={[
                        ...(t.table_name ? [{ term: "On", value: t.table_name }] : []),
                        ...(t.timing || t.event
                          ? [{ term: "Event", value: `${t.timing ?? ""} ${t.event ?? ""}`.trim() }]
                          : []),
                      ]}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Indexes */}
          <div>
            <SchemaSectionHeader
              label="Indexes"
              icon={Gauge}
              count={filteredIndexes.length}
              expanded={expandedSections.indexes}
              onToggle={() => toggleSection("indexes")}
            />
            {expandedSections.indexes && (
              <div className="space-y-0.5">
                {filteredIndexes.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No indexes found
                  </div>
                ) : (
                  filteredIndexes.map((i, idx) => (
                    <SchemaItemRow
                      key={`idx-${i.name}-${idx}`}
                      icon={Gauge}
                      label={i.name}
                      detail={[
                        ...(i.table_name ? [{ term: "On", value: i.table_name }] : []),
                        { term: "Type", value: i.is_unique ? "UNIQUE" : "INDEX" },
                        ...(i.columns?.length
                          ? [{ term: "Columns", value: i.columns.join(", ") }]
                          : []),
                      ]}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Enums */}
          <div>
            <SchemaSectionHeader
              label="Enums"
              icon={Braces}
              count={filteredEnums.length}
              expanded={expandedSections.enums}
              onToggle={() => toggleSection("enums")}
            />
            {expandedSections.enums && (
              <div className="space-y-0.5">
                {filteredEnums.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No enums found
                  </div>
                ) : (
                  filteredEnums.map((e, idx) => (
                    <SchemaItemRow
                      key={`enum-${e.name}-${idx}`}
                      icon={Braces}
                      label={e.name}
                      detail={
                        e.values?.length
                          ? [{ term: "Values", value: e.values.join(", ") }]
                          : []
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
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

function NotesPanel({ studio }: { studio: any }) {
  const confirm = useConfirm();
  const notes: any[] = studio.notes ?? [];
  const { renameTarget, setRenameTarget, renameDraft, setRenameDraft, handleRename } = useRenameHandler(
    (id, updates) => studio.updateNote?.(id, updates),
  );

  function handleExport(note: any) {
    downloadJson(
      { name: note.name, content: note.content ?? "", widgets: note.widgets ?? [] },
      `${sanitizeFilename(note.name)}.note.json`,
    );
  }

  async function handleDelete(note: any) {
    const ok = await confirm({
      title: "Delete note",
      description: `Delete "${note.name}"? This cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    studio.deleteNote?.(note.id);
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <button
        type="button"
        onClick={() => studio.createNote?.("New Note")}
        className={ROW}
      >
        <Plus className="size-4 shrink-0" />
        <span>New note</span>
      </button>
      {notes.map((n) => (
        <SidebarItemWithMenu
          key={n.id}
          icon={<SquarePen className="size-4 shrink-0" />}
          label={n.name}
          onClick={() => studio.openNoteTab?.(n.id)}
          actions={[
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onClick: () => {
                setRenameTarget(n);
                setRenameDraft(n.name);
              },
            },
            {
              label: "Export",
              icon: <Download className="size-3.5" />,
              onClick: () => handleExport(n),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              onClick: () => handleDelete(n),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ))}
      <RenameDialog
        open={!!renameTarget}
        title="Rename note"
        value={renameDraft}
        onChange={setRenameDraft}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRename}
      />
    </div>
  );
}

function DatabasePanel({ studio }: { studio: any }) {
  const dbType: string = studio.dbType;
  // Functions / triggers load against Postgres catalogs and MSSQL (sys.*);
  // enums / indexes stay Postgres-only. Hide unsupported views instead of
  // showing empty states.
  const pgCatalog = isPostgresCatalogDbType(dbType);
  const routineCatalog = pgCatalog || dbType === "mssql";
  const items: Array<{ label: string; view: string; tabType: string; show?: boolean }> = [
    { label: "Schema Diagram", view: "schema", tabType: "database-schema" },
    { label: "Data Catalog", view: "catalog", tabType: "database-catalog" },
    {
      label: dbType === "mongodb" ? "Collections" : "Tables",
      view: "tables",
      tabType: "database-tables",
    },
    { label: "Functions", view: "functions", tabType: "database-functions", show: routineCatalog },
    { label: "Triggers", view: "triggers", tabType: "database-triggers", show: routineCatalog },
    { label: "Enums", view: "enums", tabType: "database-enums", show: pgCatalog },
    { label: "Indexes", view: "indexes", tabType: "database-indexes", show: pgCatalog },
  ];
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {items
        .filter((i) => i.show !== false)
        .map((i) => {
          const Icon = getTabIcon(i.tabType) ?? DbIcon;
          return (
            <button
              key={i.view}
              type="button"
              onClick={() => studio.openDatabaseTab?.(i.view)}
              className={cn(
                ROW,
                studio.databaseView === i.view && "bg-white/10 text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{i.label}</span>
            </button>
          );
        })}
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
