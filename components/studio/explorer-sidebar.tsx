"use client";

import { useState, useRef, memo, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  X,
  Table2 as TableIcon,
  Check,
  ChevronsUpDown,
  MoreVertical,
  Terminal,
  Copy,
  Files,
  Tag,
  Download,
  Trash2,
  Eraser,
  Hash,
  KeyRound,
  ChevronRight,
  Table,
  Table2,
  Eye,
  RefreshCw,
  FunctionSquare,
  Workflow,
  Gauge,
  GitFork,
  List,
  Edit2,
} from "@/lib/icon-theme/lucide-react";
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
import { ConnectionDbType } from "@/lib/db/connection-type";
import {
  getNamespaceLabel,
  getNamespaceLabelPlural,
} from "@/lib/db/namespace-display";
import { getEditorLabel, getTableLabels } from "@/lib/studio/db-labels";
import {
  ConfirmDialogState,
  DEFAULT_CONFIRM_DIALOG,
  copyItemName,
  getTableDerivedValues,
} from "@/lib/studio/table-utils";
import { TableContextMenuItems } from "@/components/studio/database/table-utils";
import { ConfirmDialog } from "@/components/studio/shared/confirm-dialog";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";

interface ExplorerSidebarProps {
  dbType: ConnectionDbType;
  schemas: string[];
  selectedSchema: string;
  setSelectedSchema: (schema: string) => void;
  fetchingSchemas: boolean;
  tables: string[];
  selectedTable: string | null;
  fetchingTables: boolean;
  tableSearch: string;
  setTableSearch: (search: string) => void;
  viewTables: string[];
  openTabs: Array<{ id: string; type: string; name: string; schema?: string }>;
  activeTabId: string | null;
  handleTableClick: (table: string) => void;
  schemaData?: Record<
    string,
    {
      schema: string;
      name: string;
      columns?: Array<{
        name: string;
        type: string;
        isPrimary?: boolean;
        isNullable?: boolean;
        references?: {
          schema: string;
          table: string;
          column: string;
        } | null;
      }>;
    }
  >;
  openCreateTableTab: () => void;
  refreshTablesSidebar: () => void;
  openCreateSchemaTab: () => void;
  openCreateKeyTab: () => void;
  // New props
  tags: Array<{ name: string; color: string }>;
  tableTags: Record<string, string[]>;
  sidebarSortMode: "alphabetical" | "tags";
  setSidebarSortMode: (mode: "alphabetical" | "tags") => void;
  addTag: (name: string, color: string) => void;

  toggleTableTag: (schema: string, table: string, tag: string) => void;
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
  exportData: (format: "json" | "csv" | "sql") => void;
  sleek?: boolean;
  schemaExplorer?: boolean;
  tableExpansion?: boolean;
  functions?: Array<{
    schema: string;
    name: string;
    arguments?: string;
    return_type?: string;
    language?: string;
    definition?: string;
    type?: string;
  }>;
  triggers?: Array<{
    schema: string;
    name: string;
    table_name?: string;
    timing?: string;
    event?: string;
    definition?: string;
  }>;
  indexes?: Array<{
    schema: string;
    table_name?: string;
    name: string;
    definition?: string;
    is_unique?: boolean;
    columns?: string[];
  }>;
  onCopyFunction?: (
    func: {
      name: string;
      arguments?: string;
      definition?: string;
      return_type?: string;
      language?: string;
      type?: string;
      schema?: string;
    },
    mode?: "signature" | "definition" | "declaration",
  ) => void;
  onCopyTrigger?: (trigger: { name: string; definition?: string }) => void;
  onCopyIndex?: (index: { name: string; definition?: string }) => void;
  viewTableSchema?: (tableName: string) => void;
  enums?: Array<{ schema: string; name: string; values: string[] }>;
  fetchingEnums?: boolean;
  onCopyEnum?: (enumItem: {
    name: string;
    values?: string[];
    definition?: string;
    schema?: string;
  }) => void;
  onEditEnum?: (schema: string, enumName: string, values: string[]) => void;
  onDeleteEnum?: (schema: string, enumName: string) => void;
  openCreateEnumTab?: () => void;
}

export const ExplorerSidebar = memo(function ExplorerSidebar({
  dbType,
  schemas,
  selectedSchema,
  setSelectedSchema,
  fetchingSchemas,
  tables,
  selectedTable,
  fetchingTables,
  tableSearch,
  setTableSearch,
  viewTables,
  openTabs,
  activeTabId,
  handleTableClick,
  schemaData,
  openCreateTableTab,
  refreshTablesSidebar,
  openCreateSchemaTab,
  openCreateKeyTab,
  // New props
  tags,
  tableTags,
  sidebarSortMode,
  setSidebarSortMode,
  addTag,
  toggleTableTag,
  openSqlEditor,
  copyTableSchema,
  duplicateTable,
  emptyTable,
  deleteTable,
  exportData,
  sleek,
  schemaExplorer = false,
  tableExpansion = true,
  functions = [],
  triggers = [],
  indexes = [],
  onCopyFunction,
  onCopyTrigger,
  onCopyIndex,
  viewTableSchema,
  enums = [],
  fetchingEnums,
  onCopyEnum,
  onEditEnum,
  onDeleteEnum,
  openCreateEnumTab,
}: ExplorerSidebarProps) {
  const tableSearchRef = useRef<HTMLInputElement>(null);
  const tableListRef = useRef<HTMLDivElement>(null);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [tableScrollThumb, setTableScrollThumb] = useState({
    top: 0,
    height: 0,
    visible: false,
  });
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [selectedTagColor, setSelectedTagColor] = useState("#ef444480");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    { Untagged: true },
  );
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedSchemaSections, setExpandedSchemaSections] = useState<
    Record<string, boolean>
  >({
    tables: true,
    functions: true,
    triggers: true,
    indexes: true,
    enums: true,
  });
  const [expandedSchemaItems, setExpandedSchemaItems] = useState<
    Record<string, boolean>
  >({});
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(
    DEFAULT_CONFIRM_DIALOG,
  );

  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const isCurrentlyExpanded = prev[group] !== false;
      return { ...prev, [group]: !isCurrentlyExpanded };
    });
  };

  const toggleTableExpand = (tableKey: string) => {
    if (!tableExpansion) return;
    setExpandedTables((prev) => ({
      ...prev,
      [tableKey]: !(prev[tableKey] ?? false),
    }));
  };

  const toggleSchemaSection = (
    section: "tables" | "functions" | "triggers" | "indexes" | "enums",
  ) => {
    setExpandedSchemaSections((prev) => ({
      ...prev,
      [section]: !(prev[section] ?? false),
    }));
  };

  const toggleSchemaItemExpand = (itemKey: string) => {
    setExpandedSchemaItems((prev) => ({
      ...prev,
      [itemKey]: !(prev[itemKey] ?? false),
    }));
  };

  const getSchemaItemKey = (type: string, name: string) => `${type}:${name}`;

  const TAG_COLORS = [
    "#ef444480",
    "#ec489980",
    "#a855f780",
    "#92400e80",
    "#eab30880",
    "#84cc1680",
    "#22c55e80",
    "#06b6d480",
    "#3b82f680",
    "#0ea5e980",
    "#2563eb80",
    "#1e40af80",
    "#7c3aed80",
    "#4b556380",
  ];

  const DEFAULT_TAG_COLOR = "#4b556380";
  const isPostgres = dbType === "postgres" || dbType === "supabase-mgmt";
  const isMssql = dbType === "mssql";
  const isClickhouse = dbType === "clickhouse";
  const namespaceLabel = getNamespaceLabel(dbType);
  const namespaceLabelPlural = getNamespaceLabelPlural(dbType);
  const { isMongo, isRedis, itemNoun, copyDefinitionLabel, canExportSql } =
    getTableDerivedValues(dbType);
  const nounPlural = getTableLabels(dbType).plural;
  const editorLabel = getEditorLabel(dbType);
  const openEditorLabel = `Open in ${editorLabel}`;

  const getTableKey = (table: string) => `${selectedSchema || ""}.${table}`;

  const handleCopyItemName = (name: string) => copyItemName(name, itemNoun);

  const handleTableDragStart = (e: React.DragEvent, table: string) => {
    e.dataTransfer.setData(
      "application/x-rexadb-item",
      JSON.stringify({ type: "table", name: table, schema: selectedSchema }),
    );
    e.dataTransfer.effectAllowed = "link";
  };

  const handleCreateTag = () => {
    if (newTagName.trim()) {
      addTag(newTagName.trim(), selectedTagColor);
      setNewTagName("");
      setIsCreateTagOpen(false);
    }
  };

  const filteredSchemas = schemas.filter((s) =>
    s.toLowerCase().includes(schemaSearch.toLowerCase()),
  );

  const tableColumns = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        name: string;
        type: string;
        isPrimary?: boolean;
        isNullable?: boolean;
        references?: { schema: string; table: string; column: string } | null;
      }>
    >();
    Object.entries(schemaData || {}).forEach(([key, entry]) => {
      map.set(key, Array.isArray(entry?.columns) ? entry.columns : []);
    });
    return map;
  }, [schemaData]);

  const filteredTables = tables.filter((t) => {
    const searchLower = tableSearch.toLowerCase();
    if (t.toLowerCase().includes(searchLower)) return true;
    const columns = tableColumns.get(getTableKey(t)) || [];
    return columns.some((col) => col.name.toLowerCase().includes(searchLower));
  });
  const filteredTablesSorted = useMemo(
    () => [...filteredTables].sort(),
    [filteredTables],
  );
  const schemaSearchLower = tableSearch.toLowerCase();
  const filteredSchemaTables = useMemo(
    () =>
      tables.filter((t) => {
        if (!schemaSearchLower) return true;
        if (t.toLowerCase().includes(schemaSearchLower)) return true;
        const columns = tableColumns.get(getTableKey(t)) || [];
        return columns.some((col) =>
          col.name.toLowerCase().includes(schemaSearchLower),
        );
      }),
    [tables, schemaSearchLower, tableColumns],
  );
  const filteredSchemaFunctions = useMemo(
    () =>
      schemaSearchLower
        ? functions.filter(
            (f) =>
              f.name.toLowerCase().includes(schemaSearchLower) ||
              (f.arguments &&
                f.arguments.toLowerCase().includes(schemaSearchLower)),
          )
        : functions,
    [functions, schemaSearchLower],
  );
  const filteredSchemaTriggers = useMemo(
    () =>
      schemaSearchLower
        ? triggers.filter(
            (t) =>
              t.name.toLowerCase().includes(schemaSearchLower) ||
              (t.table_name &&
                t.table_name.toLowerCase().includes(schemaSearchLower)),
          )
        : triggers,
    [triggers, schemaSearchLower],
  );
  const filteredSchemaIndexes = useMemo(
    () =>
      schemaSearchLower
        ? indexes.filter(
            (i) =>
              i.name.toLowerCase().includes(schemaSearchLower) ||
              (i.table_name &&
                i.table_name.toLowerCase().includes(schemaSearchLower)),
          )
        : indexes,
    [indexes, schemaSearchLower],
  );
  const filteredSchemaEnums = useMemo(
    () =>
      schemaSearchLower
        ? enums.filter(
            (e) =>
              e.schema === selectedSchema &&
              (e.name.toLowerCase().includes(schemaSearchLower) ||
                e.values.some((v) =>
                  v.toLowerCase().includes(schemaSearchLower),
                )),
          )
        : enums.filter((e) => e.schema === selectedSchema),
    [enums, schemaSearchLower, selectedSchema],
  );
  const activeTableTab = useMemo(() => {
    if (!activeTabId) return null;
    const tab = openTabs.find(
      (t) => t.id === activeTabId && t.type === "table",
    );
    return tab ? { name: tab.name, schema: tab.schema || null } : null;
  }, [activeTabId, openTabs]);
  const viewTableSet = useMemo(() => new Set(viewTables), [viewTables]);

  const renderTableMenuItems = (
    Component: any,
    Sub: any,
    SubTrigger: any,
    SubContent: any,
    Separator: any,
    table: string,
    isDropdown = false,
  ) => {
    const handleAction = (fn: any) => (e: any) => {
      if (isDropdown) e.stopPropagation();
      fn(table, selectedSchema);
    };

    return (
      <>
        <div className="px-2 py-1.5 text-xs tracking-wider text-muted-foreground/50">
          Actions
        </div>
        <Component className="text-xs" onClick={handleAction(openSqlEditor)}>
          <Terminal className="mr-2 h-3.5 w-3.5" />
          {openEditorLabel}
        </Component>
        <Component
          className="text-xs"
          onClick={handleAction((t: string) => viewTableSchema?.(t))}
        >
          <GitFork className="mr-2 h-3.5 w-3.5" />
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
          duplicateLabel={isMongo ? "Duplicate Collection" : "Duplicate Table"}
          isMongo={isMongo}
          canExportSql={canExportSql}
          isDropdown={isDropdown}
          table={table}
          selectedSchema={selectedSchema}
          tags={tags}
          tableTags={tableTags}
          handleAction={handleAction}
          onToggleTag={(s, t, tagName) => toggleTableTag(s, t, tagName)}
          handleCopyName={(t: string) => void handleCopyItemName(t)}
          handleCopyDefinition={copyTableSchema}
          handleDuplicate={duplicateTable}
          onExport={(format) => exportData(format)}
          setConfirmDialog={setConfirmDialog}
          onEmpty={(t, s) => emptyTable(t, s)}
          onDelete={(t, s) => deleteTable(t, s)}
        />
      </>
    );
  };

  const renderTableRow = (
    table: string,
    tableIdx: number,
    opts?: { isVirtualized?: boolean },
  ) => {
    const isActive =
      !!activeTableTab &&
      activeTableTab.name === table &&
      (activeTableTab.schema ? activeTableTab.schema === selectedSchema : true);
    const isView = viewTableSet.has(table);
    const ItemIcon = isView ? Eye : Table;
    const tableKey = getTableKey(table);
    const isExpanded = expandedTables[tableKey] ?? false;
    return (
      <div
        key={opts?.isVirtualized ? `${table}` : `${table}-${tableIdx}`}
        className={
          opts?.isVirtualized ? "absolute left-0 right-0" : "space-y-1"
        }
        style={
          opts?.isVirtualized
            ? { top: tableIdx * ROW_HEIGHT, height: ROW_HEIGHT }
            : undefined
        }
      >
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              role="button"
              draggable
              onDragStart={(e) => handleTableDragStart(e, table)}
              onClick={() => handleTableClick(table)}
              className={`flex items-center gap-2 pl-1 pr-1.5 py-1.5 text-xs transition-all cursor-pointer rounded-lg group/item select-none ${isActive ? "bg-neutral-500/10 text-neutral-500 font-medium" : "text-foreground/78 hover:text-foreground hover:bg-muted/10"}`}
            >
              {tableExpansion && (
                <button
                  className="p-0.5 rounded hover:bg-secondary/40"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTableExpand(tableKey);
                  }}
                  aria-label={
                    isExpanded ? "Collapse columns" : "Expand columns"
                  }
                >
                  <ChevronRight
                    className={cn(
                      "w-3.5 h-3.5 transition-transform text-muted-foreground",
                      isExpanded && "rotate-90",
                    )}
                  />
                </button>
              )}
              <ItemIcon
                className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-sm truncate flex-1 select-none text-foreground/90">
                {table}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                    <MoreVertical className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-popover border-border shadow-2xl"
                >
                  {renderTableMenuItems(
                    DropdownMenuItem,
                    DropdownMenuSub,
                    DropdownMenuSubTrigger,
                    DropdownMenuSubContent,
                    DropdownMenuSeparator,
                    table,
                    true,
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56 bg-popover border-border shadow-2xl">
            {renderTableMenuItems(
              ContextMenuItem,
              ContextMenuSub,
              ContextMenuSubTrigger,
              ContextMenuSubContent,
              ContextMenuSeparator,
              table,
            )}
          </ContextMenuContent>
        </ContextMenu>
        {renderColumnList(table)}
      </div>
    );
  };

  const renderColumnRows = (
    columns: Array<{ name: string; type?: string; isPrimary?: boolean }>,
    tableKey: string,
    highlight?: string,
  ) => {
    const searchLower = highlight?.toLowerCase() ?? "";
    return (
      <div className="ml-6 mt-1 space-y-0.5 border-l border-studio-border/30 pl-2">
        {columns.map((col, idx) => {
          const isMatch = searchLower && col.name.toLowerCase().includes(searchLower);
          return (
            <div
              key={`${tableKey}-${col.name}-${idx}`}
              className={`flex items-center gap-2 rounded-lg px-2 py-0.5 text-xs ${isMatch ? "bg-yellow-500/20 text-foreground font-medium" : "text-foreground/82 hover:bg-muted/10"}`}
            >
              {col.isPrimary ? (
                <KeyRound className="w-3 h-3 text-muted-foreground shrink-0" />
              ) : (
                <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{col.name}</span>
              {col.type && (
                <span className="ml-auto max-w-[90px] truncate text-xs text-foreground/58">
                  {col.type}
                </span>
              )}
            </div>
          );
        })}
        {columns.length === 0 && (
          <div className="px-3 py-1 text-xs text-foreground/40">No columns</div>
        )}
      </div>
    );
  };

  const renderColumnList = (table: string) => {
    const tableKey = getTableKey(table);
    const columns = tableColumns.get(tableKey) || [];
    const isExpanded = expandedTables[tableKey] ?? false;
    if (!isExpanded || columns.length === 0) return null;
    return renderColumnRows(columns, tableKey, tableSearch);
  };

  const SchemaSectionHeader = ({
    section,
    icon: Icon,
    label,
    count,
  }: {
    section: "tables" | "functions" | "triggers" | "indexes" | "enums";
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    count: number;
  }) => (
    <button
      onClick={() => toggleSchemaSection(section)}
      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs tracking-wider text-foreground/60 hover:text-foreground transition-colors"
    >
      <ChevronRight
        className={cn(
          "w-3 h-3 text-muted-foreground transition-transform",
          expandedSchemaSections[section] && "rotate-90",
        )}
      />
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span>{label}</span>
      <span className="text-foreground/40 font-normal">({count})</span>
    </button>
  );

  const updateTableScrollThumb = useCallback(() => {
    const el = tableListRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setTableScrollTop(scrollTop);
    setTableViewportHeight(clientHeight);
    if (scrollHeight <= clientHeight + 1) {
      setTableScrollThumb({ top: 0, height: 0, visible: false });
      return;
    }
    const ratio = clientHeight / scrollHeight;
    const height = Math.max(10, Math.round(clientHeight * ratio));
    const maxTop = clientHeight - height;
    const top = Math.round(
      (scrollTop / (scrollHeight - clientHeight)) * maxTop,
    );
    setTableScrollThumb({ top, height, visible: true });
  }, []);

  useEffect(() => {
    const el = tableListRef.current;
    if (!el) return;
    updateTableScrollThumb();
    const handleScroll = () => updateTableScrollThumb();
    el.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => updateTableScrollThumb());
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [updateTableScrollThumb]);

  useEffect(() => {
    updateTableScrollThumb();
  }, [
    filteredTables.length,
    sidebarSortMode,
    expandedGroups,
    expandedTables,
    selectedSchema,
    updateTableScrollThumb,
  ]);

  const ROW_HEIGHT = 32;
  const OVERSCAN = 8;
  const hasExpandedTables = useMemo(
    () => Object.values(expandedTables).some(Boolean),
    [expandedTables],
  );
  const shouldVirtualize =
    sidebarSortMode === "alphabetical" && !fetchingTables && !hasExpandedTables;
  const totalRows = filteredTablesSorted.length;
  const totalHeight = totalRows * ROW_HEIGHT;
  const startIndex = Math.max(
    0,
    Math.floor(tableScrollTop / ROW_HEIGHT) - OVERSCAN,
  );
  const endIndex = Math.min(
    totalRows,
    Math.ceil((tableScrollTop + tableViewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleTables = shouldVirtualize
    ? filteredTablesSorted.slice(startIndex, endIndex)
    : filteredTablesSorted;

  // Sorting and Grouping Logic
  const groupedTables =
    sidebarSortMode === "alphabetical"
      ? { "": filteredTablesSorted } // Empty key for direct listing
      : (() => {
          // Initialize with all tags to ensure empty ones are shown
          const groups = tags.reduce(
            (acc, tag) => {
              acc[tag.name] = [];
              return acc;
            },
            {} as Record<string, string[]>,
          );

          // Add Untagged group
          groups["Untagged"] = [];

          // Sort tables within groups alphabetically
          const sortedTables = [...filteredTables].sort();

          sortedTables.forEach((table) => {
            const tableTagsList = tableTags[`${selectedSchema}.${table}`] || [];
            if (tableTagsList.length === 0) {
              groups["Untagged"].push(table);
            } else {
              tableTagsList.forEach((tagName) => {
                if (groups[tagName]) {
                  groups[tagName].push(table);
                }
              });
            }
          });
          return groups;
        })();

  return (
    <div
      className={cn(
        "relative shrink-0 border-r border-studio-border bg-popover",
        sleek && "border-r-0",
      )}
      style={{ width: sidebarWidth }}
    >
      <div className="flex flex-col overflow-hidden h-full text-muted-foreground">
        <SidebarHeader title={nounPlural} />
        <div className="px-3 pt-3 flex-1 min-h-0 flex flex-col">
          <div className="space-y-3 flex flex-col min-h-0">
            {/* Schema Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between bg-secondary/20 border-studio-border h-7 text-xs text-foreground focus:ring-0 px-2 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground font-normal shrink-0">
                      {namespaceLabel}
                    </span>
                    <span className="text-foreground truncate">
                      {selectedSchema || "Select schema"}
                    </span>
                  </div>
                  <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="bg-popover border-studio-border p-0 overflow-hidden"
                style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
              >
                <div className="px-2 pt-1.5 pb-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
                    <Input
                      placeholder={`Find ${namespaceLabel}...`}
                      value={schemaSearch}
                      onChange={(e) => setSchemaSearch(e.target.value)}
                      className="w-full bg-secondary/20 border-none h-7 pl-7 pr-2 text-xs text-foreground focus-visible:ring-0 placeholder:text-muted-foreground/30"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="max-h-[300px] overflow-y-auto">
                  {filteredSchemas.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                      {`No ${namespaceLabelPlural} found`}
                    </div>
                  ) : (
                    filteredSchemas.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() => setSelectedSchema(s)}
                        className="text-xs cursor-pointer pl-2 pr-3 py-1.5 flex items-center justify-between rounded-none text-foreground/78 hover:bg-muted/10 hover:text-foreground focus:bg-muted/10 focus:text-foreground"
                      >
                        <span
                          className={
                            (selectedSchema === s
                              ? "font-medium text-foreground "
                              : "") + "truncate"
                          }
                        >
                          {s}
                        </span>
                        {selectedSchema === s && (
                          <Check className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                      </DropdownMenuItem>
                    ))
                  )}
                </div>

                {(isPostgres || isMssql) && (
                  <>
                    <div className="border-t border-border/30 mx-2" />
                    <DropdownMenuItem
                      onClick={openCreateSchemaTab}
                      className="text-xs cursor-pointer pl-2 pr-3 py-1.5 rounded-none text-foreground/78 hover:bg-muted/10 hover:text-foreground focus:bg-muted/10 focus:text-foreground flex items-center gap-2"
                    >
                      <Plus className="w-3 h-3 text-muted-foreground" />
                      Create a new schema
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* New Item / Refresh */}
            <div className="flex items-center gap-2">
              {!isRedis && (
                <Button
                  variant="outline"
                  onClick={openCreateTableTab}
                  className="flex-1 justify-start gap-2 bg-secondary/20 border-studio-border h-7 text-xs text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Plus className="w-3 h-3 text-muted-foreground" />
                  {`New ${itemNoun.toLowerCase()}`}
                </Button>
              )}
              {isRedis && (
                <Button
                  variant="outline"
                  onClick={openCreateKeyTab}
                  className="flex-1 justify-start gap-2 bg-secondary/20 border-studio-border h-7 text-xs text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Plus className="w-3 h-3 text-muted-foreground" />
                  New key
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={refreshTablesSidebar}
                className="h-7 w-7 bg-secondary/20 border-studio-border text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                title={`Refresh ${nounPlural.toLowerCase()}`}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${fetchingSchemas || fetchingTables ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {/* Search and Toggle Area */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex bg-secondary/20 p-0.5 rounded-lg border border-studio-border">
                  <button
                    onClick={() => setSidebarSortMode("alphabetical")}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-lg transition-all ${sidebarSortMode === "alphabetical" ? "bg-muted/40 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    A-Z
                  </button>
                  <button
                    onClick={() => setSidebarSortMode("tags")}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-lg transition-all ${sidebarSortMode === "tags" ? "bg-muted/40 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Tags
                  </button>
                </div>

                <button
                  onClick={() => setIsCreateTagOpen(true)}
                  className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colorstracking-tight"
                >
                  <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                  New Tag
                </button>
              </div>

              <div className="relative group px-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 group-focus-within:text-foreground/60 transition-colors" />
                <Input
                  ref={tableSearchRef}
                  placeholder={
                    schemaExplorer ? "Search..." : "Search tables..."
                  }
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="w-full bg-secondary/20 border-studio-border h-7 pl-8 pr-8 text-xs text-foreground focus-visible:ring-0 placeholder:text-muted-foreground/30 transition-colors"
                />
                {tableSearch && (
                  <button
                    onClick={() => setTableSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Table List */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={tableListRef}
                className="h-full overflow-y-auto min-h-0 space-y-4 pb-4 custom-scrollbar scrollbar-hide"
              >
                {schemaExplorer ? (
                  /* Schema Explorer Mode: Organized by object type */
                  <div className="space-y-3">
                    {/* Tables Section */}
                    <div>
                      {expandedSchemaSections.tables && (
                        <div className="space-y-0.5">
                          {filteredSchemaTables.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              No tables found
                            </div>
                          ) : (
                            filteredSchemaTables.map((table, idx) => {
                              const tableKey = getTableKey(table);
                              const isExpanded =
                                expandedSchemaItems[
                                  getSchemaItemKey("table", table)
                                ] ?? false;
                              return (
                                <div key={`table-${table}-${idx}`}>
                                  <div className="group/table flex items-center gap-1.5">
                                    <button
                                      className="p-0.5 rounded hover:bg-secondary/40"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleSchemaItemExpand(
                                          getSchemaItemKey("table", table),
                                        );
                                      }}
                                    >
                                      <ChevronRight
                                        className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                      />
                                    </button>
                                    <div
                                      role="button"
                                      draggable
                                       onDragStart={(e) => handleTableDragStart(e, table)}
                                      onClick={() => handleTableClick(table)}
                                      className="flex-1 flex items-center gap-2 px-2 py-1 text-xs text-foreground/78 hover:text-foreground hover:bg-muted/10 rounded-lg cursor-pointer transition-colors"
                                    >
                                      <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                      <span className="text-sm truncate select-none text-foreground/80">
                                        {table}
                                      </span>
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        asChild
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button className="opacity-0 group-hover/table:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                                          <MoreVertical className="w-3 h-3" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent
                                        align="end"
                                        className="w-48"
                                      >
                                        <DropdownMenuItem
                                          className="text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openSqlEditor(
                                              table,
                                              selectedSchema,
                                            );
                                          }}
                                        >
                                          <Terminal className="mr-2 h-3.5 w-3.5" />
                                          {openEditorLabel}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleCopyItemName(table);
                                          }}
                                        >
                                          <Copy className="mr-2 h-3.5 w-3.5" />
                                          Copy {itemNoun} Name
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            copyTableSchema(
                                              table,
                                              selectedSchema,
                                            );
                                          }}
                                        >
                                          <Copy className="mr-2 h-3.5 w-3.5" />
                                          {copyDefinitionLabel}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            duplicateTable(
                                              table,
                                              selectedSchema,
                                            );
                                          }}
                                        >
                                          <Files className="mr-2 h-3.5 w-3.5" />
                                          {isMongo
                                            ? "Duplicate Collection"
                                            : "Duplicate Table"}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-xs text-amber-500 focus:text-amber-500"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmDialog({
                                              open: true,
                                              title: `Empty table "${table}"?`,
                                              description:
                                                "This will delete all data in the table. This action cannot be undone.",
                                              onConfirm: () =>
                                                emptyTable(
                                                  table,
                                                  selectedSchema,
                                                ),
                                              variant: "destructive",
                                            });
                                          }}
                                        >
                                          <Eraser className="mr-2 h-3.5 w-3.5" />
                                          {isMongo
                                            ? "Empty Collection"
                                            : "Empty Table"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-xs text-red-500 focus:text-red-500"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmDialog({
                                              open: true,
                                              title: `Delete table "${table}"?`,
                                              description:
                                                "This will delete all data. This action cannot be undone.",
                                              onConfirm: () =>
                                                deleteTable(
                                                  table,
                                                  selectedSchema,
                                                ),
                                              variant: "destructive",
                                            });
                                          }}
                                        >
                                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                                          {isMongo
                                            ? "Delete Collection"
                                            : "Delete Table"}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  {isExpanded && renderColumnRows(
                                    schemaData?.[tableKey]?.columns || [],
                                    `${tableKey}-col`,
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* Functions Section */}
                    {isPostgres && (
                      <div>
                        <SchemaSectionHeader
                          section="functions"
                          icon={FunctionSquare}
                          label="Functions"
                          count={filteredSchemaFunctions.length}
                        />
                        {expandedSchemaSections.functions && (
                          <div className="mt-1 space-y-0.5">
                            {filteredSchemaFunctions.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No functions found
                              </div>
                            ) : (
                              filteredSchemaFunctions.map((func, idx) => {
                                const funcKey = getSchemaItemKey(
                                  "function",
                                  func.name,
                                );
                                const isExpanded =
                                  expandedSchemaItems[funcKey] ?? false;
                                return (
                                  <div key={`func-${func.name}-${idx}`}>
                                    <div className="group/func flex items-center gap-1.5">
                                      <button
                                        className="p-0.5 rounded hover:bg-secondary/40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSchemaItemExpand(funcKey);
                                        }}
                                      >
                                        <ChevronRight
                                          className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                        />
                                      </button>
                                      <div className="flex-1 flex items-center gap-2 px-2 py-1 text-xs text-foreground/78 hover:text-foreground hover:bg-muted/10 rounded-lg cursor-pointer transition-colors">
                                        <FunctionSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate select-none max-w-[120px]">
                                          {func.name}
                                        </span>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger
                                          asChild
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button className="opacity-0 group-hover/func:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                                            <MoreVertical className="w-3 h-3" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="end"
                                          className="w-48"
                                        >
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyFunction?.(
                                                {
                                                  name: func.name,
                                                  arguments: func.arguments,
                                                },
                                                "signature",
                                              );
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Signature
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyFunction?.(
                                                {
                                                  name: func.name,
                                                  definition: func.definition,
                                                },
                                                "definition",
                                              );
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Definition
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyFunction?.(
                                                {
                                                  name: func.name,
                                                  arguments: func.arguments,
                                                  definition: func.definition,
                                                  return_type: func.return_type,
                                                  language: func.language,
                                                  type: func.type,
                                                  schema: func.schema,
                                                },
                                                "declaration",
                                              );
                                            }}
                                          >
                                            <Files className="mr-2 h-3.5 w-3.5" />
                                            Copy Declaration
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                    {isExpanded && (
                                      <div className="ml-6 mt-1 space-y-1 border-l border-studio-border/30 pl-2 text-xs">
                                        <div className="flex items-center gap-2 px-2 py-0.5">
                                          <span className="text-foreground/50 w-16 shrink-0">
                                            Signature:
                                          </span>
                                          <span className="text-foreground/90 truncate">
                                            {func.name}(
                                            {func.arguments
                                              ?.split(",")
                                              .map((a: string) => a.trim())
                                              .filter(Boolean)
                                              .join(", ") || ""}
                                            )
                                          </span>
                                        </div>
                                        {func.return_type && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-16 shrink-0">
                                              Returns:
                                            </span>
                                            <span className="text-foreground/90">
                                              {func.return_type}
                                            </span>
                                          </div>
                                        )}
                                        {func.language && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-16 shrink-0">
                                              Language:
                                            </span>
                                            <span className="text-foreground/90">
                                              {func.language}
                                            </span>
                                          </div>
                                        )}
                                        {func.type && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-16 shrink-0">
                                              Type:
                                            </span>
                                            <span className="text-foreground/90">
                                              {func.type}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Triggers Section */}
                    {isPostgres && (
                      <div>
                        <SchemaSectionHeader
                          section="triggers"
                          icon={Workflow}
                          label="Triggers"
                          count={filteredSchemaTriggers.length}
                        />
                        {expandedSchemaSections.triggers && (
                          <div className="mt-1 space-y-0.5">
                            {filteredSchemaTriggers.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No triggers found
                              </div>
                            ) : (
                              filteredSchemaTriggers.map((trigger, idx) => {
                                const triggerKey = getSchemaItemKey(
                                  "trigger",
                                  trigger.name,
                                );
                                const isExpanded =
                                  expandedSchemaItems[triggerKey] ?? false;
                                return (
                                  <div key={`trigger-${trigger.name}-${idx}`}>
                                    <div className="group/trig flex items-center gap-1.5">
                                      <button
                                        className="p-0.5 rounded hover:bg-secondary/40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSchemaItemExpand(triggerKey);
                                        }}
                                      >
                                        <ChevronRight
                                          className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                        />
                                      </button>
                                      <div className="flex-1 flex items-center gap-2 px-2 py-1 text-xs text-foreground/78 hover:text-foreground hover:bg-muted/10 rounded-lg cursor-pointer transition-colors">
                                        <Workflow className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate select-none max-w-[120px]">
                                          {trigger.name}
                                        </span>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger
                                          asChild
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button className="opacity-0 group-hover/trig:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                                            <MoreVertical className="w-3 h-3" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="end"
                                          className="w-48"
                                        >
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyTrigger?.({
                                                name: trigger.name,
                                                definition: trigger.definition,
                                              });
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Definition
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                    {isExpanded && (
                                      <div className="ml-6 mt-1 space-y-1 border-l border-studio-border/30 pl-2 text-xs">
                                        {trigger.table_name && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-12 shrink-0">
                                              On:
                                            </span>
                                            <span className="text-foreground/90">
                                              {trigger.table_name}
                                            </span>
                                          </div>
                                        )}
                                        {trigger.timing && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-12 shrink-0">
                                              Event:
                                            </span>
                                            <span className="text-foreground/90">
                                              {trigger.timing} {trigger.event}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Indexes Section */}
                    {isPostgres && (
                      <div>
                        <SchemaSectionHeader
                          section="indexes"
                          icon={Gauge}
                          label="Indexes"
                          count={filteredSchemaIndexes.length}
                        />
                        {expandedSchemaSections.indexes && (
                          <div className="mt-1 space-y-0.5">
                            {filteredSchemaIndexes.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No indexes found
                              </div>
                            ) : (
                              filteredSchemaIndexes.map((index, idx) => {
                                const indexKey = getSchemaItemKey(
                                  "index",
                                  index.name,
                                );
                                const isExpanded =
                                  expandedSchemaItems[indexKey] ?? false;
                                return (
                                  <div key={`index-${index.name}-${idx}`}>
                                    <div className="group/idx flex items-center gap-1.5">
                                      <button
                                        className="p-0.5 rounded hover:bg-secondary/40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSchemaItemExpand(indexKey);
                                        }}
                                      >
                                        <ChevronRight
                                          className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                        />
                                      </button>
                                      <div className="flex-1 flex items-center gap-2 px-2 py-1 text-xs text-foreground/78 hover:text-foreground hover:bg-muted/10 rounded-lg cursor-pointer transition-colors">
                                        <Gauge className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate select-none max-w-[120px]">
                                          {index.name}
                                        </span>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger
                                          asChild
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button className="opacity-0 group-hover/idx:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                                            <MoreVertical className="w-3 h-3" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="end"
                                          className="w-48"
                                        >
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyIndex?.({
                                                name: index.name,
                                                definition: index.definition,
                                              });
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Definition
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                    {isExpanded && (
                                      <div className="ml-6 mt-1 space-y-1 border-l border-studio-border/30 pl-2 text-xs">
                                        {index.table_name && (
                                          <div className="flex items-center gap-2 px-2 py-0.5">
                                            <span className="text-foreground/50 w-16 shrink-0">
                                              On:
                                            </span>
                                            <span className="text-foreground/90">
                                              {index.table_name}
                                            </span>
                                          </div>
                                        )}
                                        <div className="flex items-center gap-2 px-2 py-0.5">
                                          <span className="text-foreground/50 w-16 shrink-0">
                                            Type:
                                          </span>
                                          <span className="text-foreground/90">
                                            {index.is_unique
                                              ? "UNIQUE"
                                              : "INDEX"}
                                          </span>
                                        </div>
                                        {index.columns &&
                                          index.columns.length > 0 && (
                                            <div className="flex items-center gap-2 px-2 py-0.5">
                                              <span className="text-foreground/50 w-16 shrink-0">
                                                Columns:
                                              </span>
                                              <span className="text-foreground/90">
                                                ({index.columns.join(", ")})
                                              </span>
                                            </div>
                                          )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Enums Section */}
                    {isPostgres && (
                      <div>
                        <SchemaSectionHeader
                          section="enums"
                          icon={List}
                          label="Enums"
                          count={filteredSchemaEnums.length}
                        />
                        {expandedSchemaSections.enums && (
                          <div className="mt-1 space-y-0.5">
                            {filteredSchemaEnums.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No enums found
                              </div>
                            ) : (
                              filteredSchemaEnums.map((enumItem, idx) => {
                                const enumKey = getSchemaItemKey(
                                  "enum",
                                  enumItem.name,
                                );
                                const isExpanded =
                                  expandedSchemaItems[enumKey] ?? false;
                                return (
                                  <div key={`enum-${enumItem.name}-${idx}`}>
                                    <div className="group/enum flex items-center gap-1.5">
                                      <button
                                        className="p-0.5 rounded hover:bg-secondary/40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSchemaItemExpand(enumKey);
                                        }}
                                      >
                                        <ChevronRight
                                          className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                        />
                                      </button>
                                      <div className="flex-1 flex items-center gap-2 px-2 py-1 text-xs text-foreground/78 hover:text-foreground hover:bg-muted/10 rounded-lg cursor-pointer transition-colors">
                                        <List className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate select-none max-w-[120px]">
                                          {enumItem.name}
                                        </span>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger
                                          asChild
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button className="opacity-0 group-hover/enum:opacity-100 p-1 hover:bg-secondary rounded transition-all">
                                            <MoreVertical className="w-3 h-3" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="end"
                                          className="w-48"
                                        >
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleCopyItemName(
                                                enumItem.name,
                                              );
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Name
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onCopyEnum?.({
                                                name: enumItem.name,
                                                values: enumItem.values,
                                                schema: enumItem.schema,
                                              });
                                            }}
                                          >
                                            <Copy className="mr-2 h-3.5 w-3.5" />
                                            Copy Definition
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            className="text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onEditEnum?.(
                                                enumItem.schema,
                                                enumItem.name,
                                                enumItem.values,
                                              );
                                            }}
                                          >
                                            <Edit2 className="mr-2 h-3.5 w-3.5" />
                                            Edit Enum
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            className="text-xs text-red-500 focus:text-red-500"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setConfirmDialog({
                                                open: true,
                                                title: `Delete enum "${enumItem.name}"?`,
                                                description:
                                                  "Are you sure you want to delete this enum type? This action cannot be undone.",
                                                onConfirm: () =>
                                                  onDeleteEnum?.(
                                                    enumItem.schema,
                                                    enumItem.name,
                                                  ),
                                                variant: "destructive",
                                              });
                                            }}
                                          >
                                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                                            Delete Enum
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                    {isExpanded && (
                                      <div className="ml-6 mt-1 space-y-0.5 border-l border-studio-border/30 pl-2 text-xs">
                                        {enumItem.values.map((val, vi) => (
                                          <div
                                            key={`${enumItem.name}-val-${vi}`}
                                            className="flex items-center gap-2 px-2 py-0.5 text-foreground/82"
                                          >
                                            <span className="text-foreground/40">
                                              •
                                            </span>
                                            <span className="text-foreground/90">
                                              {val}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : sidebarSortMode === "alphabetical" ? (
                  /* A-Z Mode: Direct List */
                  <div>
                    {shouldVirtualize ? (
                      totalRows === 0 ? (
                        <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                          No tables found
                        </div>
                      ) : (
                        <div
                          className="relative"
                          style={{ height: totalHeight }}
                        >
                          {visibleTables.map((table, offsetIdx) => {
                            const tableIdx = startIndex + offsetIdx;
                            return renderTableRow(table, tableIdx, {
                              isVirtualized: true,
                            });
                          })}
                        </div>
                      )
                    ) : (
                      <>
                        {filteredTablesSorted.map((table, tableIdx) =>
                          renderTableRow(table, tableIdx),
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  /* Tags Mode: Grouped List */
                  Object.entries(groupedTables).map(
                    ([groupName, groupTables], groupIdx) => {
                      const tag = tags.find((t) => t.name === groupName);
                      const isExpanded = expandedGroups[groupName] !== false;
                      const isUntagged = groupName === "Untagged";
                      const isEmpty = groupTables.length === 0;

                      return (
                        <div
                          key={`${groupName}-${groupIdx}`}
                          className="space-y-3"
                        >
                          <div
                            className="flex items-center justify-between group/header cursor-pointer px-1"
                            onClick={() => !isEmpty && toggleGroup(groupName)}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              {!isEmpty ? (
                                <ChevronRight
                                  className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                />
                              ) : (
                                <div className="w-3 h-3" />
                              )}
                              {isUntagged ? (
                                <div className="w-2 h-2 rounded-lg bg-foreground/25 shrink-0" />
                              ) : (
                                tag && (
                                  <div
                                    className="w-2 h-2 rounded-lg shrink-0"
                                    style={{
                                      backgroundColor:
                                        tag.color || DEFAULT_TAG_COLOR,
                                    }}
                                  />
                                )
                              )}
                              <span
                                className={`text-xs tracking-tight truncate ${isEmpty ? "text-foreground/30" : "text-foreground/72 group-hover/header:text-foreground"}`}
                              >
                                {groupName}
                              </span>
                              <span className="text-xs font-medium text-foreground/38">
                                {groupTables.length}
                              </span>
                            </div>
                          </div>

                          {isExpanded && !isEmpty && (
                            <div className="space-y-0.5 border-l border-studio-border/30 pl-1">
                              {groupTables.map((table, tableIdx) =>
                                renderTableRow(table, tableIdx),
                              )}
                            </div>
                          )}
                        </div>
                      );
                    },
                  )
                )}
              </div>
              {tableScrollThumb.visible && (
                <div className="pointer-events-none absolute right-0.5 top-2 bottom-2 w-0.5">
                  <div
                    className="absolute right-0 w-0.5 rounded-lg bg-foreground/40 dark:bg-white/40"
                    style={{
                      height: tableScrollThumb.height,
                      top: tableScrollThumb.top,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <ConfirmDialog state={confirmDialog} setState={setConfirmDialog} />

        {/* Tag Creator Dialog */}
        <Dialog open={isCreateTagOpen} onOpenChange={setIsCreateTagOpen}>
          <DialogContent className="sm:max-w-[425px] bg-popover border-studio-border p-0 overflow-hidden">
            <DialogHeader className="p-6 border-b border-studio-border">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Create Tag
              </DialogTitle>
              <DialogDescription className="sr-only">
                Create a new tag to organize your tables.
              </DialogDescription>
            </DialogHeader>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <Input
                  placeholder="Enter tag name..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="bg-secondary/30 border-studio-border h-10 text-sm focus:ring-0"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTagName) {
                      handleCreateTag();
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-7 gap-3">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-lg transition-all relative ${
                      selectedTagColor === color
                        ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-110"
                        : "hover:scale-110"
                    }`}
                    style={{
                      backgroundColor: color,
                      border: `1px solid ${color.replace("80", "FF")}`,
                    }}
                    onClick={() => setSelectedTagColor(color)}
                  >
                    {selectedTagColor === color && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-lg bg-foreground/80 shadow-sm" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter className="p-6 border-t border-studio-border bg-secondary/10">
              <div className="flex w-full gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 text-xs hover:bg-secondary"
                  onClick={() => setIsCreateTagOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                >
                  Create
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize select-none bg-transparent group"
        onPointerDown={handlePointerDown}
      >
        <div className="h-full w-px mx-auto bg-studio-border/50 group-hover:bg-blue-500/60 transition-colors" />
      </div>
    </div>
  );
});
