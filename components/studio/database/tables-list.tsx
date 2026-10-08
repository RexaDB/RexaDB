"use client";

import {
  Table2,
  Plus,
  MoreVertical,
  Tag,
  Pencil,
  X,
  Filter,
  RefreshCw,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import type {
  TableActionHandler,
  ExportDataHandler,
} from "@/lib/studio-backend/types";
import { useEffect, useState, useMemo } from "react";
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
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  copyItemName,
  getTableDerivedValues,
} from "@/lib/studio/table-utils";
import { TableContextMenuItems } from "./table-utils";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
import {
  DbCreateButton,
  DbListHeader,
  DbListPage,
  DbListToolbar,
  DbSchemaFilter,
  DbToolbarFilters,
} from "./db-list-layout";
import { SelectFilter } from "./select-filter";
import { TablesFilterMenu } from "./tables-filter-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  filterTablesByNameAndType,
  mergeTablesAndViews,
  type TableTypeFilter,
} from "@/lib/studio/table-filter";

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
  onRefreshTables?: () => void;
  isRefreshingTables?: boolean;
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
  addTag,
  removeTag,
  renameTag,
  onRefreshTables,
  isRefreshingTables = false,
}: TablesListProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<TableTypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wildcardsEnabled, setWildcardsEnabled] = useState(true);
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

  const normalizedSchemas = Array.from(
    new Set(
      schemas.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0),
    ),
  );

  const { isMongo, itemNoun, copyDefinitionLabel, canExportSql } =
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

  // Union base tables + views: Oracle/MSSQL/JDBC backends split them across
  // getTables/getViews, so iterating `tables` alone hides every view.
  const allTables = useMemo(
    () => mergeTablesAndViews(tables, viewTables),
    [tables, viewTables],
  );

  // ---- Tags derived state ----
  const TAG_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8"];
  const tagKeyFor = (table: string) => `${selectedSchema}.${table}`;
  const tagsForTable = (table: string): string[] => tableTags[tagKeyFor(table)] ?? [];
  const colorByName = new Map(tags.map((t) => [t.name, t.color]));
  const tablesByTag = new Map<string, string[]>();
  for (const tag of tags) {
    tablesByTag.set(tag.name, allTables.filter((t) => tagsForTable(t).includes(tag.name)));
  }
  function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    addTag?.(name, newTagColor);
    setNewTagName("");
  }

  const filteredTables = useMemo(() => {
    const nameFiltered = filterTablesByNameAndType(allTables, (t) => t, {
      query: search,
      mode: "auto",
      caseSensitive,
      wildcardsEnabled,
      typeFilter,
      viewSet: viewTableSet,
    });
    if (tagFilter.length === 0) return nameFiltered;
    return nameFiltered.filter((t) => tagsForTable(t).some((tag) => tagFilter.includes(tag)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTables, search, tagFilter, tableTags, selectedSchema, typeFilter, caseSensitive, wildcardsEnabled, viewTables]);

  const filtersActive =
    typeFilter !== "all" || caseSensitive || !wildcardsEnabled;

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema, tagFilter, typeFilter, caseSensitive, wildcardsEnabled]);

  const renderMenuItems = (
    table: string,
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
          onEmpty={(t, s) => emptyTable?.(t, s)}
          onDelete={(t, s) => deleteTable?.(t, s)}
          beforeExport={<Separator />}
        />
      </>
    );
  };

  const columns: TableColumn<string>[] = useMemo(
    () => [
      {
        key: "table",
        header: isMongo ? "Collection" : "Table",
        sortable: true,
        sortValue: (table) => table,
        width: "1.4fr",
        cell: (table) => (
          <span className="block truncate font-medium" title={table}>
            {table}
          </span>
        ),
      },
      {
        key: "tags",
        header: "Tags",
        width: "1.2fr",
        cell: (table) => {
          const assigned = tagsForTable(table);
          if (assigned.length === 0) {
            return <span className="text-xs text-muted-foreground/40">–</span>;
          }
          return (
            <span
              className="flex items-center gap-1.5 flex-nowrap overflow-hidden"
              title={assigned.join(", ")}
            >
              {assigned.map((name) => (
                <Badge key={name} variant="outline" className="shrink-0">
                  <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: colorByName.get(name) ?? "#94a3b8" }} />
                  {name}
                </Badge>
              ))}
            </span>
          );
        },
        sortValue: (table) => tagsForTable(table).join(", "),
      },
      {
        key: "type",
        header: "Type",
        sortable: true,
        width: "1fr",
        cell: (table) => {
          const rlsEnabled = tableSecurity?.[table]?.rlsEnabled;
          return (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">
                {viewTableSet.has(table) ? "View" : "Base Table"}
              </span>
              {dataApiInstalled ? (
                <Badge variant="info" title="Accessible via Data API">
                  API
                </Badge>
              ) : null}
              {rlsEnabled === false ? (
                <Badge variant="destructive" title="Row Level Security is disabled on this table">
                  RLS off
                </Badge>
              ) : null}
            </span>
          );
        },
        sortValue: (table) => (viewTableSet.has(table) ? "View" : "Base Table"),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "3rem",
        cell: (table) => (
          <div className="flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon-sm" aria-label={`${table} actions`}>
                  <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {renderMenuItems(
                  table,
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
        ),
      },
    ],
    // Menu handlers close over stable setters + props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isMongo,
      itemNoun,
      openEditorLabel,
      copyDefinitionLabel,
      canExportSql,
      viewTables,
      tableSecurity,
      dataApiInstalled,
      tags,
      tableTags,
    ],
  );

  return (
    <DbListPage>
      <DbListHeader
        title={isMongo ? "Collections" : "Tables"}
        description={`Browse and manage ${isMongo ? "collections" : "tables"} in the "${selectedSchema}" schema`}
      />

      <DbListToolbar>
        <DbToolbarFilters>
          <DbSchemaFilter schemas={normalizedSchemas} selectedSchema={selectedSchema} onSchemaChange={onSchemaChange} />
          <div className="relative w-full lg:w-60">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isMongo ? "Search collections..." : "Search tables..."}
              className="h-7 bg-background border-border pl-3 pr-8 text-xs"
            />
            {!isMongo && (
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Table filter options"
                    title="Filter options"
                    className={
                      filtersActive
                        ? "absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary"
                        : "absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                    }
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {filtersActive && (
                      <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <TablesFilterMenu
                    typeFilter={typeFilter}
                    onTypeFilterChange={setTypeFilter}
                    caseSensitive={caseSensitive}
                    onCaseSensitiveChange={setCaseSensitive}
                    wildcardsEnabled={wildcardsEnabled}
                    onWildcardsEnabledChange={setWildcardsEnabled}
                    onRefresh={onRefreshTables ? () => { onRefreshTables(); setFilterOpen(false); } : undefined}
                    isRefreshing={isRefreshingTables}
                    tablesCount={allTables.filter((t) => !viewTableSet.has(t)).length}
                    viewsCount={allTables.filter((t) => viewTableSet.has(t)).length}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
          {tags.length > 0 && (
            <SelectFilter
              label="Tag"
              options={tags.map((tag) => ({ label: tag.name, value: tag.name }))}
              value={tagFilter}
              onChange={setTagFilter}
              showSearch
            />
          )}
        </DbToolbarFilters>
        <div className="flex items-center gap-2">
          {onRefreshTables && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={onRefreshTables}
                    disabled={isRefreshingTables}
                    aria-label="Refresh tables and views"
                  >
                    <RefreshCw className={isRefreshingTables ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh tables and views</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" onClick={() => setTagManagerOpen(true)} aria-label="Manage tags">
                  <Tag className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Manage tags</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onOpenCreateTableTab && (
            <DbCreateButton onClick={onOpenCreateTableTab}>Create {itemNoun}</DbCreateButton>
          )}
        </div>
      </DbListToolbar>

      <div className="px-8 flex-1 min-h-0 overflow-y-auto">
        {filteredTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Table2 className="w-10 h-10 text-muted-foreground/10 mb-4" />
            <h3 className="text-sm font-medium text-foreground">
              No tables found
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
              {search || tagFilter.length > 0 || typeFilter !== "all"
                ? `No tables matching your filters`
                : "This schema doesn't have any tables yet."}
            </p>
            {onOpenCreateTableTab && !search && tagFilter.length === 0 && typeFilter === "all" && (
              <div className="mt-4">
                <DbCreateButton onClick={onOpenCreateTableTab}>Create {itemNoun}</DbCreateButton>
              </div>
            )}
          </div>
        ) : (
          <div className="pb-8">
            <DataTable<string>
              data={filteredTables}
              columns={columns}
              getRowId={(table) => `${selectedSchema}.${table}`}
              pagination={{
                page,
                pageSize: 10,
                onPageChange: setPage,
                itemLabel: isMongo ? "collections" : "tables",
              }}
              onRowClick={(table) => onTableClick(table)}
              renderRowContextMenu={(table) => (
                <>
                  {renderMenuItems(
                    table,
                    ContextMenuItem,
                    ContextMenuSub,
                    ContextMenuSubTrigger,
                    ContextMenuSubContent,
                    ContextMenuSeparator,
                  )}
                </>
              )}
            />
          </div>
        )}
      </div>

      <Dialog open={tagManagerOpen} onOpenChange={setTagManagerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tags</DialogTitle>
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
                  className={
                    newTagColor === c
                      ? "size-5 rounded-full border transition-transform scale-110 border-foreground"
                      : "size-5 rounded-full border transition-transform border-border"
                  }
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
                    {renameTag && (
                      <button
                        type="button"
                        aria-label={`Rename tag ${tag.name}`}
                        onClick={() => openRenameTagDialog(tag.name)}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
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
    </DbListPage>
  );
}
