"use client";

import {
  Table2,
  Search,
  ArrowRight,
  ChevronDown,
  Plus,
  Globe,
  Unlock,
  MoreVertical,
  Tag,
  Eye,
  X,
} from "@/lib/icon-theme/lucide-react";
import { Folder, FolderOpen } from "@/lib/icon-theme/solar-icons";
import { Input } from "@/components/ui/input";
import type {
  TableActionHandler,
  ExportDataHandler,
} from "@/lib/studio-backend/types";
import { useState } from "react";
import { cn } from "@/lib/utils";
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
import {
  ConfirmDialogState,
  DEFAULT_CONFIRM_DIALOG,
  copyItemName,
  getTableDerivedValues,
} from "@/lib/studio/table-utils";
import { TableContextMenuItems } from "./table-utils";

function ExplorerTagRow({
  table,
  selectedSchema,
  tableTags,
  tags,
  colorByName,
  tableDescriptions,
  tableSecurity,
  dataApiInstalled,
  viewTableSet,
  isMongo,
  canExportSql,
  itemNoun,
  openEditorLabel,
  copyDefinitionLabel,
  onTableClick,
  onOpenSqlEditor,
  onViewSchema,
  toggleTableTag,
  copyTableSchema,
  duplicateTable,
  emptyTable,
  deleteTable,
  exportData,
  exportTableData,
  setConfirmDialog,
  handleCopyItemName,
}: {
  table: string;
  selectedSchema: string;
  tableTags: Record<string, string[]>;
  tags: Array<{ name: string; color: string }>;
  colorByName: Map<string, string>;
  tableDescriptions: Record<string, string>;
  tableSecurity?: Record<string, { rlsEnabled: boolean; policyCount: number }>;
  dataApiInstalled?: boolean;
  viewTableSet: Set<string>;
  isMongo: boolean;
  canExportSql: boolean;
  itemNoun: string;
  openEditorLabel: string;
  copyDefinitionLabel: string;
  onTableClick: (table: string) => void;
  onOpenSqlEditor?: (table: string, schema?: string) => void;
  onViewSchema?: (table: string) => void;
  toggleTableTag?: (schema: string, table: string, tag: string) => void;
  copyTableSchema?: TableActionHandler;
  duplicateTable?: TableActionHandler;
  emptyTable?: TableActionHandler;
  deleteTable?: TableActionHandler;
  exportData?: ExportDataHandler;
  exportTableData?: (table: string | undefined, schema: string | undefined, format: "csv" | "json" | "sql") => void;
  setConfirmDialog: (dialog: ConfirmDialogState) => void;
  handleCopyItemName: (name: string) => void;
}) {
  const assigned = tableTags[`${selectedSchema}.${table}`] ?? [];
  const securityInfo = tableSecurity?.[table];
  const rlsEnabled = securityInfo?.rlsEnabled;
  const showDataApi = Boolean(dataApiInstalled);
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
        <Component onClick={handleAction((t) => onTableClick(t))}>
          Open {itemNoun}
        </Component>
        <Component onClick={handleAction((t, s) => onOpenSqlEditor?.(t, s))}>
          {openEditorLabel}
        </Component>
        <Component onClick={handleAction((t) => onViewSchema?.(t))}>
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
          tags={tags}
          tableTags={tableTags}
          handleAction={handleAction}
          onToggleTag={(s, t, tagName) => toggleTableTag?.(s, t, tagName)}
          handleCopyName={(t) => void handleCopyItemName(t)}
          handleCopyDefinition={(t, s) => copyTableSchema?.(t, s)}
          handleDuplicate={(t, s) => duplicateTable?.(t, s)}
          onExport={(format, t, s) =>
            exportTableData ? exportTableData(t, s, format) : exportData?.(format)
          }
          setConfirmDialog={setConfirmDialog}
          onEmpty={(t, s) => emptyTable?.(t, s)}
          onDelete={(t, s) => deleteTable?.(t, s)}
          beforeExport={<Separator />}
        />
      </>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          onClick={() => onTableClick(table)}
          className="grid grid-cols-[120px_1fr_200px_48px] items-center py-3 px-4 hover:bg-muted/20 transition-colors group cursor-pointer"
        >
          <span className="text-xs font-medium text-muted-foreground/60 truncate">{selectedSchema}</span>
          <div className="flex items-center gap-2 min-w-0">
            <ItemIcon className="w-3.5 h-3.5 text-primary/60 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-foreground tracking-tight truncate">{table}</span>
              {tableDescriptions[table] && (
                <span className="text-[11px] text-muted-foreground/70 truncate" title={tableDescriptions[table]}>
                  {tableDescriptions[table]}
                </span>
              )}
              {assigned.length > 0 && (
                <span className="flex items-center gap-1 mt-0.5">
                  {assigned.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-1.5 py-px text-[10px] text-muted-foreground"
                    >
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: colorByName.get(name) ?? "#94a3b8" }} />
                      {name}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {(showDataApi || rlsEnabled === false) && (
              <span className="flex items-center gap-1">
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
          </div>
          <span className="text-xs tracking-wider text-muted-foreground/40">{isView ? "View" : "Base Table"}</span>
          <div className="flex justify-end items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
                >
                  <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
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
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
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

interface TablesListProps {
  dbType?: string;
  tables: string[];
  selectedSchema: string;
  schemas: string[];
  onSchemaChange: (schema: string) => void;
  onTableClick: (table: string) => void;
  onOpenCreateTableTab?: () => void;
  tableSecurity?: Record<string, { rlsEnabled: boolean; policyCount: number }>;
  dataApiInstalled?: boolean;
  onViewSchema?: (table: string) => void;
  onOpenSqlEditor?: (table: string, schema?: string) => void;
  onCopyName?: (table: string) => void;

  // Sidebar-aligned props
  tags?: Array<{ name: string; color: string }>;

  tableTags?: Record<string, string[]>;
  toggleTableTag?: (schema: string, table: string, tag: string) => void;
  copyTableSchema?: TableActionHandler;
  duplicateTable?: TableActionHandler;
  emptyTable?: TableActionHandler;
  deleteTable?: TableActionHandler;
  exportData?: ExportDataHandler;
  exportTableData?: (table: string | undefined, schema: string | undefined, format: "csv" | "json" | "sql") => void;
  viewTables?: string[];
  /** table name -> description (data dictionary). Shown as a subtitle. */
  tableDescriptions?: Record<string, string>;
  addTag?: (name: string, color: string) => void;
  removeTag?: (name: string) => void;
  renameTag?: (oldName: string, newName: string) => void;
  sortMode?: "alphabetical" | "tags";
  onSortModeChange?: (mode: "alphabetical" | "tags") => void;
}

export function TablesList({
  dbType = "postgres",
  tables,
  selectedSchema,
  schemas,
  onSchemaChange,
  onTableClick,
  onOpenCreateTableTab,
  tableSecurity,
  dataApiInstalled,
  onViewSchema,
  onOpenSqlEditor,
  onCopyName,
  tags = [],
  tableTags = {},
  toggleTableTag,
  copyTableSchema,
  duplicateTable,
  emptyTable,
  deleteTable,
  exportData,
  exportTableData,
  viewTables = [],
  tableDescriptions = {},
  addTag,
  removeTag,
  renameTag,
  sortMode,
  onSortModeChange,
}: TablesListProps) {
  const [search, setSearch] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(
    DEFAULT_CONFIRM_DIALOG,
  );
  const [localTagView, setLocalTagView] = useState(false);
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
    if (renameTagName) renameTag?.(renameTagName, renameTagDraft);
    setRenameTagName(null);
  }
  const tagView = sortMode ? sortMode === "tags" : localTagView;
  const setTagView = (next: boolean) => {
    const mode = next ? "tags" : "alphabetical";
    if (onSortModeChange) onSortModeChange(mode);
    else setLocalTagView(next);
  };

  const normalizedSchemas = Array.from(
    new Set(
      schemas.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0),
    ),
  );

  const filteredTables = tables.filter((t) =>
    t.toLowerCase().includes(search.toLowerCase()),
  );

  const { isMongo, isRedis, itemNoun, copyDefinitionLabel, canExportSql } =
    getTableDerivedValues(dbType);
  const editorLabel =
    dbType === "postgres" || dbType === "supabase-mgmt"
      ? "SQL Editor"
      : dbType === "mongodb"
        ? "Mongo Editor"
        : dbType === "redis"
          ? "Redis Editor"
          : "Editor";
  const openEditorLabel = `Open in ${editorLabel}`;
  const viewTableSet = new Set(viewTables);

  const handleCopyItemName = (name: string) => copyItemName(name, itemNoun);

  // ---- Tags-as-folders derived state ----
  const TAG_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8"];
  const tagKeyFor = (table: string) => `${selectedSchema}.${table}`;
  const tagsForTable = (table: string): string[] => tableTags[tagKeyFor(table)] ?? [];
  const colorByName = new Map(tags.map((t) => [t.name, t.color]));
  const untaggedTables = filteredTables.filter((t) => tagsForTable(t).length === 0);
  const tablesByTag = new Map<string, string[]>();
  for (const tag of tags) {
    tablesByTag.set(tag.name, filteredTables.filter((t) => tagsForTable(t).includes(tag.name)));
  }
  const isTagExpanded = (name: string) => expandedTags[name] ?? true;
  const toggleTagGroup = (name: string) =>
    setExpandedTags((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
  function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    addTag?.(name, newTagColor);
    setNewTagName("");
  }

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden min-h-0">
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

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-studio-bg/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <Table2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground tracking-tight">
                {isMongo ? "Collections" : "Tables"}
              </h2>
              <p className="text-xs text-muted-foreground font-mediumtracking-wider truncate max-w-[120px]">
                {selectedSchema}
              </p>
            </div>
          </div>
          <div className="h-4 w-px bg-border/60 mx-1" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <Input
              placeholder={
                isMongo ? "Search collections..." : "Search tables..."
              }
              className="h-8 w-[240px] pl-8 text-xs bg-muted/30 border-none focus-visible:ring-1 focus-visible:ring-primary/20 transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-2 border-border/60 bg-muted/20 hover:bg-muted/40 transition-all max-w-[180px]"
              >
                <span className="truncate">{selectedSchema}</span>
                <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 bg-popover border-border shadow-2xl"
            >
              <div className="px-2 py-1.5 text-xs tracking-wider text-muted-foreground/40">
                Select Schema
              </div>
              {normalizedSchemas.map((schema) => (
                <DropdownMenuItem
                  key={schema}
                  className="text-xs flex items-center justify-between max-w-full"
                  onClick={() => onSchemaChange(schema)}
                >
                  <span className="truncate">{schema}</span>
                  {schema === selectedSchema && (
                    <div className="w-1.5 h-1.5 rounded-lg bg-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onOpenCreateTableTab && (
            <Button
              onClick={onOpenCreateTableTab}
              size="sm"
              className="h-8 text-xs gap-2 bg-primary hover:bg-primary/90 text-white shadow-sm border-none transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Create {itemNoun}
            </Button>
          )}
        </div>
      </div>

      {/* A-Z / Tags folder toggle */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border/40 bg-muted/10">
        <div className="flex h-7 items-center rounded-lg border border-border/60 bg-muted/20 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTagView(false)}
            className={cn(
              "flex h-full items-center gap-1.5 rounded-md px-3 transition-colors",
              !tagView ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            A-Z
          </button>
          <button
            type="button"
            onClick={() => setTagView(true)}
            className={cn(
              "flex h-full items-center gap-1.5 rounded-md px-3 transition-colors",
              tagView ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Tags
          </button>
        </div>
        {tagView && (
        <button
          type="button"
          onClick={() => setTagManagerOpen(true)}
          className="ml-auto flex h-7 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Tag
        </button>
        )}
        {tagView && (
          <span className="text-[11px] text-muted-foreground">
            {tags.length} tags · {untaggedTables.length} untagged
          </span>
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
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={handleCreateTag} disabled={!newTagName.trim() || !addTag}>
                <Plus className="w-3.5 h-3.5" />
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
              {tags.length === 0 ? (
                <div className="px-1 py-2 text-xs text-muted-foreground">
                  No tags yet. Create one, then right-click a table → Tags to assign it.
                </div>
              ) : (
                tags.map((tag) => (
                  <div key={tag.name} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/40">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="min-w-0 flex-1 truncate text-xs">{tag.name}</span>
                    <span className="text-[11px] text-muted-foreground">{tablesByTag.get(tag.name)?.length ?? 0}</span>
                    {removeTag && (
                      <button
                        type="button"
                        aria-label={`Delete tag ${tag.name}`}
                        onClick={() => removeTag(tag.name)}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            {!addTag && (
              <p className="text-[11px] text-muted-foreground">Tag creation is unavailable in this view.</p>
            )}
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
            className="h-8 text-xs"
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

      <div className="flex-1 flex flex-col min-h-0">
        {/* Table Header */}
        <div className="grid grid-cols-[120px_1fr_200px_48px] items-center py-2.5 px-4 bg-muted/10 border-b border-border/40">
          <span className="text-xs tracking-wider text-muted-foreground/50 ml-1">
            Schema
          </span>
          <span className="text-xs tracking-wider text-muted-foreground/50">
            Name
          </span>
          <span className="text-xs tracking-wider text-muted-foreground/50">
            Type
          </span>
          <span className="text-xs tracking-wider text-muted-foreground/50 text-right mr-1"></span>
        </div>
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Table Body */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/60 min-h-0">
            {tagView ? (
              <div className="divide-y divide-border/40">
                {tags.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground">
                    <Tag className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">No tags yet — right-click a table → Tags to assign one.</span>
                    <button
                      type="button"
                      onClick={() => setTagManagerOpen(true)}
                      className="shrink-0 font-medium text-primary hover:underline"
                    >
                      New Tag
                    </button>
                  </div>
                )}
                {tags.map((tag) => {
                      const groupTables = tablesByTag.get(tag.name) ?? [];
                      const expanded = isTagExpanded(tag.name);
                      const FolderIcon = expanded ? FolderOpen : Folder;
                      return (
                        <div key={tag.name}>
                          <ContextMenu>
                            <ContextMenuTrigger>
                              <button
                                type="button"
                                onClick={() => toggleTagGroup(tag.name)}
                                title={tag.name}
                                className="flex w-full items-center gap-1.5 px-4 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
                              >
                                <FolderIcon className="w-4 h-4 shrink-0" style={{ color: tag.color }} />
                                <span className="text-xs font-bold truncate flex-1">{tag.name}</span>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-56">
                              <ContextMenuItem onClick={() => openRenameTagDialog(tag.name)}>
                                Rename tag
                              </ContextMenuItem>
                              {removeTag && (
                                <ContextMenuItem
                                  className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                                  onClick={() => removeTag(tag.name)}
                                >
                                  Delete tag
                                </ContextMenuItem>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                          {expanded && (
                            <div>
                              {groupTables.length === 0 ? (
                                <div className="px-11 py-2 text-[11px] text-muted-foreground/60">No tables in this folder</div>
                              ) : (
                                groupTables.map((table) => (
                                  <ExplorerTagRow
                                    key={`${selectedSchema}.${table}`}
                                    table={table}
                                    selectedSchema={selectedSchema}
                                    tableTags={tableTags}
                                    tags={tags}
                                    colorByName={colorByName}
                                    tableDescriptions={tableDescriptions}
                                    tableSecurity={tableSecurity}
                                    dataApiInstalled={dataApiInstalled}
                                    viewTableSet={viewTableSet}
                                    isMongo={isMongo}
                                    canExportSql={canExportSql}
                                    itemNoun={itemNoun}
                                    openEditorLabel={openEditorLabel}
                                    copyDefinitionLabel={copyDefinitionLabel}
                                    onTableClick={onTableClick}
                                    onOpenSqlEditor={onOpenSqlEditor}
                                    onViewSchema={onViewSchema}
                                    toggleTableTag={toggleTableTag}
                                    copyTableSchema={copyTableSchema}
                                    duplicateTable={duplicateTable}
                                    emptyTable={emptyTable}
                                    deleteTable={deleteTable}
                                    exportData={exportData}
                                    exportTableData={exportTableData}
                                    setConfirmDialog={setConfirmDialog}
                                    handleCopyItemName={handleCopyItemName}
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleTagGroup("__untagged")}
                        title="Untagged"
                        className="flex w-full items-center gap-1.5 px-4 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
                      >
                        <Folder className="w-4 h-4 shrink-0 opacity-60" />
                        <span className="text-xs font-bold truncate flex-1">Untagged</span>
                      </button>
                      {isTagExpanded("__untagged") && (
                        <div>
                          {untaggedTables.length === 0 ? (
                            <div className="px-11 py-2 text-[11px] text-muted-foreground/60">Everything is tagged</div>
                          ) : (
                            untaggedTables.map((table) => (
                              <ExplorerTagRow
                                key={`${selectedSchema}.${table}`}
                                table={table}
                                selectedSchema={selectedSchema}
                                tableTags={tableTags}
                                tags={tags}
                                colorByName={colorByName}
                                tableDescriptions={tableDescriptions}
                                tableSecurity={tableSecurity}
                                dataApiInstalled={dataApiInstalled}
                                viewTableSet={viewTableSet}
                                isMongo={isMongo}
                                canExportSql={canExportSql}
                                itemNoun={itemNoun}
                                openEditorLabel={openEditorLabel}
                                copyDefinitionLabel={copyDefinitionLabel}
                                onTableClick={onTableClick}
                                onOpenSqlEditor={onOpenSqlEditor}
                                onViewSchema={onViewSchema}
                                toggleTableTag={toggleTableTag}
                                copyTableSchema={copyTableSchema}
                                duplicateTable={duplicateTable}
                                emptyTable={emptyTable}
                                deleteTable={deleteTable}
                                exportData={exportData}
                                setConfirmDialog={setConfirmDialog}
                                handleCopyItemName={handleCopyItemName}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
              </div>
            ) : (
              <>
            {filteredTables.map((table) =>
              (() => {
                const securityInfo = tableSecurity?.[table];
                const rlsEnabled = securityInfo?.rlsEnabled;
                const showDataApi = Boolean(dataApiInstalled);
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
                        onClick={handleAction((t) => onTableClick(t))}
                      >
                        Open {itemNoun}
                      </Component>
                      <Component
                        onClick={handleAction((t, s) =>
                          onOpenSqlEditor?.(t, s),
                        )}
                      >
                        {openEditorLabel}
                      </Component>
                      <Component
                        onClick={handleAction((t) => onViewSchema?.(t))}
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
                        tags={tags}
                        tableTags={tableTags}
                        handleAction={handleAction}
                        onToggleTag={(s, t, tagName) =>
                          toggleTableTag?.(s, t, tagName)
                        }
                        handleCopyName={(t) => void handleCopyItemName(t)}
                        handleCopyDefinition={(t, s) => copyTableSchema?.(t, s)}
                        handleDuplicate={(t, s) => duplicateTable?.(t, s)}
                        onExport={(format, t, s) =>
            exportTableData ? exportTableData(t, s, format) : exportData?.(format)
          }
                        setConfirmDialog={setConfirmDialog}
                        onEmpty={(t, s) => emptyTable?.(t, s)}
                        onDelete={(t, s) => deleteTable?.(t, s)}
                        beforeExport={<Separator />}
                      />
                    </>
                  );
                };

                return (
                  <ContextMenu key={`${selectedSchema}.${table}`}>
                    <ContextMenuTrigger>
                      <div
                        onClick={() => onTableClick(table)}
                        className="grid grid-cols-[120px_1fr_200px_48px] items-center py-4 px-4 hover:bg-muted/20 transition-colors group cursor-pointer"
                      >
                        <span className="text-xs font-medium text-muted-foreground/60 truncate">
                          {selectedSchema}
                        </span>
                        <div className="flex items-center gap-2 min-w-0">
                          <ItemIcon className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-foreground tracking-tight truncate">
                              {table}
                            </span>
                            {(tableTags[`${selectedSchema}.${table}`] ?? []).length > 0 && (
                              <span className="flex items-center gap-1 mt-0.5">
                                {(tableTags[`${selectedSchema}.${table}`] ?? []).map((name) => (
                                  <span
                                    key={name}
                                    title={name}
                                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-1.5 py-px text-[10px] text-muted-foreground"
                                  >
                                    <span className="size-1.5 rounded-full" style={{ backgroundColor: colorByName.get(name) ?? "#94a3b8" }} />
                                    {name}
                                  </span>
                                ))}
                              </span>
                            )}
                            {tableDescriptions[table] && (
                              <span
                                className="text-[11px] text-muted-foreground/70 truncate"
                                title={tableDescriptions[table]}
                              >
                                {tableDescriptions[table]}
                              </span>
                            )}
                          </div>
                          {(showDataApi || rlsEnabled === false) && (
                            <span className="flex items-center gap-1">
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
                        </div>
                        <span className="text-xs tracking-wider text-muted-foreground/40">
                          {isView ? "View" : "Base Table"}
                        </span>
                        <div className="flex justify-end items-center gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              asChild
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
                              >
                                <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-56"
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
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
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
              })(),
            )}
              </>
            )}

            {!tagView && filteredTables.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Table2 className="w-10 h-10 text-muted-foreground/10 mb-4" />
                <h3 className="text-sm font-medium text-foreground">
                  No tables found
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                  {search
                    ? `No tables matching "${search}"`
                    : "This schema doesn't have any tables yet."}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="h-8" /> {/* Bottom padding */}
      </div>
    </div>
  );
}
