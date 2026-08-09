"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Menu,
  Search,
  Plus,
  X,
  RefreshCw,
  Folder,
  FolderOpen,
  Table2,
  MoreVertical,
  Copy,
  Trash2,
  Files,
  Terminal,
  Loader2,
  Database,
  Check,
} from "@/lib/icon-theme/lucide-react";
import { ConnectionDbType } from "@/lib/db/connection-type";
import { getTableLabels, getEditorLabel } from "@/lib/studio/db-labels";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { ConfirmDialog } from "@/components/studio/shared/confirm-dialog";
import {
  copyItemName,
  DEFAULT_CONFIRM_DIALOG,
  type ConfirmDialogState,
} from "@/lib/studio/table-utils";

interface DatabaseExplorerSidebarProps {
  dbType: ConnectionDbType;
  schemas: string[];
  selectedSchema: string;
  setSelectedSchema: (schema: string) => void;
  allSchemaTables: Array<{ schema: string; name: string }>;
  fetchingAllSchema: boolean;
  loadAllSchemaData: () => void;
  handleTableClick: (table: string, schema?: string) => void;

  openCreateTableTab: () => void;
  // fallow-ignore-next-line code-duplication
  openSqlEditor: (
    table?: string,
    schema?: string,
    initialQuery?: string,
  ) => void;
  copyTableSchema: (table: string, schema: string) => void;
  duplicateTable: (table: string, schema: string) => void;
  emptyTable: (table: string, schema: string) => void;
  deleteTable: (table: string, schema: string) => void;
  viewTableSchema?: (tableName: string) => void;
  sleek?: boolean;
}

export function DatabaseExplorerSidebar({
  dbType,
  schemas,
  selectedSchema,
  setSelectedSchema,
  allSchemaTables,
  fetchingAllSchema,
  loadAllSchemaData,
  handleTableClick,
  openCreateTableTab,
  openSqlEditor,
  copyTableSchema,
  duplicateTable,
  emptyTable,
  deleteTable,
  viewTableSchema,
  sleek,
}: DatabaseExplorerSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);
  const [search, setSearch] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<
    Record<string, boolean>
  >({});
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(
    DEFAULT_CONFIRM_DIALOG,
  );

  const [publicFirst, setPublicFirst] = useLocalStorage(
    "rexadb:db-explorer-public-first",
    true,
  );
  const [joinTablesLast, setJoinTablesLast] = useLocalStorage(
    "rexadb:db-explorer-join-last",
    false,
  );
  const [groupByPrefix, setGroupByPrefix] = useLocalStorage(
    "rexadb:db-explorer-group-prefix",
    false,
  );
  const [hideTempSchemas, setHideTempSchemas] = useLocalStorage(
    "rexadb:db-explorer-hide-temp",
    true,
  );

  const isPostgres = dbType === "postgres" || dbType === "supabase-mgmt";
  const editorLabel = getEditorLabel(dbType);
  const openEditorLabel = `Open in ${editorLabel}`;
  const { itemNoun } = (() => {
    const labels = getTableLabels(dbType);
    return { itemNoun: labels.singular.toLowerCase() };
  })();

  const searchLower = search.toLowerCase();

  const groupedBySchema = useMemo(() => {
    const schemaMap: Record<
      string,
      { tables: Array<{ schema: string; name: string }> }
    > = {};

    for (const schema of schemas) {
      if (schema === "pg_catalog" || schema === "information_schema") continue;
      if (hideTempSchemas && /^pg_temp_\d+$/.test(schema)) continue;
      schemaMap[schema] = { tables: [] };
    }

    for (const t of allSchemaTables) {
      if (schemaMap[t.schema]) schemaMap[t.schema].tables.push(t);
    }

    return schemaMap;
  }, [schemas, allSchemaTables, hideTempSchemas]);

  const filteredGroupedSchemas = useMemo(() => {
    let entries = Object.entries(groupedBySchema);

    if (publicFirst) {
      entries.sort(([a], [b]) => {
        if (a === "public") return -1;
        if (b === "public") return 1;
        return a.localeCompare(b);
      });
    }

    if (searchLower) {
      entries = entries.filter(([schema, group]) => {
        if (schema.toLowerCase().includes(searchLower)) return true;
        return group.tables.some((item) =>
          item.name.toLowerCase().includes(searchLower),
        );
      });
    }

    return entries;
  }, [groupedBySchema, searchLower, publicFirst]);

  const GROUP_SUFFIXES = [
    "_info",
    "_history",
    "_log",
    "_stats",
    "_summary",
    "_audit",
    "_backup",
    "_archive",
    "_tmp",
    "_old",
    "_new",
    "_config",
    "_settings",
    "_data",
    "_meta",
  ];

  const getPrefix = (name: string) => {
    for (const suffix of GROUP_SUFFIXES) {
      if (name.endsWith(suffix) && name.length > suffix.length) {
        return name.slice(0, -suffix.length);
      }
    }
    return null;
  };

  const isJoinTable = (name: string) => {
    if (!joinTablesLast) return false;
    return (
      name.startsWith("_") ||
      (name.includes("_") && name.split("_").length >= 3)
    );
  };

  const toggleSchema = (schema: string) => {
    setExpandedSchemas((prev) => ({
      ...prev,
      [schema]: !(prev[schema] ?? false),
    }));
  };

  const getItemKey = (schema: string, name: string, idx: number) =>
    `${schema}:${name}:${idx}`;

  const handleCopyItemName = (name: string) => copyItemName(name, itemNoun);

  const renderTableItem = (
    item: { schema: string; name: string },
    schema: string,
    idx: number,
  ) => {
    const itemKey = getItemKey(schema, item.name, idx);

    const handleItemClick = () => {
      setSelectedSchema(schema);
      handleTableClick(item.name, schema);
    };

    return (
      <div key={itemKey}>
        <div className="group/item flex items-center gap-1.5">
          <div
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "application/x-rexadb-item",
                JSON.stringify({
                  type: "table",
                  name: item.name,
                  schema,
                }),
              );
              e.dataTransfer.effectAllowed = "link";
            }}
            onClick={handleItemClick}
            className="flex-1 flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg cursor-pointer transition-colors"
          >
            <Table2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate select-none max-w-[120px]">
              {item.name}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                <MoreVertical className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  openSqlEditor(item.name, schema);
                }}
              >
                <Terminal className="mr-2 h-3.5 w-3.5" />
                {openEditorLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyItemName(item.name);
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy Name
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  copyTableSchema(item.name, schema);
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy Definition
              </DropdownMenuItem>
              {viewTableSchema && (
                <DropdownMenuItem
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    viewTableSchema(item.name);
                  }}
                >
                  <Files className="mr-2 h-3.5 w-3.5" />
                  View Schema
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateTable(item.name, schema);
                }}
              >
                <Files className="mr-2 h-3.5 w-3.5" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-amber-500 focus:text-amber-500"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDialog({
                    open: true,
                    title: `Empty "${item.name}"?`,
                    description:
                      "This will delete all data. This action cannot be undone.",
                    onConfirm: () => emptyTable(item.name, schema),
                    variant: "destructive",
                  });
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Empty
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs text-red-500 focus:text-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDialog({
                    open: true,
                    title: `Delete "${item.name}"?`,
                    description:
                      "This will delete all data. This action cannot be undone.",
                    onConfirm: () => deleteTable(item.name, schema),
                    variant: "destructive",
                  });
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  const renderSchema = ([schema, group]: [
    string,
    { tables: Array<{ schema: string; name: string }> },
  ]) => {
    const isExpanded = expandedSchemas[schema] ?? false;
    let tables = group.tables;

    if (joinTablesLast) {
      const regular = tables.filter((t) => !isJoinTable(t.name));
      const joins = tables.filter((t) => isJoinTable(t.name));
      tables = [...regular, ...joins];
    }

    const tableCount = tables.length;

    return (
      <div key={schema}>
        <button
          onClick={() => toggleSchema(schema)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="truncate">{schema}</span>
          <span className="text-xs text-foreground/40 font-normal ml-auto">
            {tableCount}
          </span>
        </button>
        {isExpanded && (
          <div className="ml-2 mt-0.5 space-y-0.5 border-l border-studio-border/30 pl-1">
            {groupByPrefix
              ? renderGroupedTables(tables, schema)
              : tables.map((item, idx) => renderTableItem(item, schema, idx))}
          </div>
        )}
      </div>
    );
  };

  const renderGroupedTables = (
    tables: Array<{ schema: string; name: string }>,
    schema: string,
  ) => {
    const groups = new Map<string, Array<{ schema: string; name: string }>>();
    const standalone: Array<{ schema: string; name: string }> = [];

    const groupKeys = new Set<string>();
    for (const t of tables) {
      const prefix = getPrefix(t.name);
      if (prefix) groupKeys.add(prefix);
    }

    for (const t of tables) {
      const prefix = getPrefix(t.name);
      if (prefix) {
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix)!.push(t);
      } else if (groupKeys.has(t.name)) {
        if (!groups.has(t.name)) groups.set(t.name, []);
        groups.get(t.name)!.push(t);
      } else {
        standalone.push(t);
      }
    }

    const sortedPrefixes = Array.from(groups.keys()).sort();

    return (
      <>
        {standalone.map((item, idx) => renderTableItem(item, schema, idx))}
        {sortedPrefixes.map((prefix) => (
          <div key={`pfx-${prefix}`} className="space-y-0.5">
            <div className="px-2 py-0.5 text-xs tracking-wider text-foreground/40 uppercase">
              {prefix}
            </div>
            {groups
              .get(prefix)!
              .map((item, idx) => renderTableItem(item, schema, idx))}
          </div>
        ))}
      </>
    );
  };

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
          title="Database Explorer"
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  <Menu className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuCheckboxItem
                  checked={publicFirst}
                  onCheckedChange={setPublicFirst}
                  className="text-xs"
                >
                  Public schema first
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={joinTablesLast}
                  onCheckedChange={setJoinTablesLast}
                  className="text-xs"
                >
                  Join tables last
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={groupByPrefix}
                  onCheckedChange={setGroupByPrefix}
                  className="text-xs"
                >
                  Group by prefix
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={hideTempSchemas}
                  onCheckedChange={setHideTempSchemas}
                  className="text-xs"
                >
                  Hide temp schemas
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <div className="px-3 pt-3 flex-1 min-h-0 flex flex-col">
          <div className="space-y-3 px-1 flex flex-col min-h-0">
            {/* New Table / Refresh */}
            <div className="flex items-center gap-2">
              {(dbType === "postgres" || dbType === "supabase-mgmt" || dbType === "spacetimedb") && (
                <Button
                  variant="outline"
                  onClick={openCreateTableTab}
                  className="flex-1 justify-start gap-2 bg-secondary/20 border-studio-border h-8 text-xs text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New table
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={loadAllSchemaData}
                className="h-8 w-8 bg-secondary/20 border-studio-border text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                title="Refresh all schemas"
                disabled={fetchingAllSchema}
              >
                {fetchingAllSchema ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>

            {/* Search */}
            <div className="relative group px-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 group-focus-within:text-foreground/60 transition-colors" />
              <Input
                placeholder="Search objects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-secondary/20 border-studio-border h-8 pl-8 pr-8 text-xs text-foreground focus-visible:ring-0 placeholder:text-muted-foreground/30 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Tree */}
            <div className="relative flex-1 min-h-0">
              <div className="h-full overflow-y-auto min-h-0 space-y-1 pb-4 custom-scrollbar scrollbar-hide">
                {!isPostgres ? (
                  <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                    Database Explorer is only available for PostgreSQL.
                  </div>
                ) : fetchingAllSchema && filteredGroupedSchemas.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                    Loading schemas...
                  </div>
                ) : filteredGroupedSchemas.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                    {search ? "No objects found" : "No schemas available"}
                  </div>
                ) : (
                  filteredGroupedSchemas.map(renderSchema)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog state={confirmDialog} setState={setConfirmDialog} />

      <div
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize select-none bg-transparent group"
        onPointerDown={handlePointerDown}
      >
        <div className="h-full w-px mx-auto bg-studio-border/50 group-hover:bg-blue-500/60 transition-colors" />
      </div>
    </div>
  );
}
