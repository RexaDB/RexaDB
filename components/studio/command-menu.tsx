"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  Camera,
  Clock,
  Database,
  FunctionSquare,
  GitFork,
  Layout,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Workflow,
} from "@/lib/icon-theme/lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { defaultFilter } from "cmdk";
import { ConnectionDbType } from "@/lib/db/connection-type";
import { getTableLabels } from "@/lib/studio/db-labels";
import {
  formatShortcutForPlatform,
  getKeybindingCombo,
  type Keybinding,
} from "@/lib/studio/keybindings";

type SectionId =
  | "create"
  | "navigation"
  | "connections"
  | "tables"
  | "saved-queries"
  | "account";

interface CommandMenuProps {
  dbType: ConnectionDbType;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  tables: string[];
  functions: Array<{ name?: string }>;
  schemas: string[];
  onSelectTable: (table: string) => void;
  onSelectFunction: (fn: { name?: string }) => void;
  onSelectSchema: (schema: string) => void;
  onNewQuery: () => void;
  onRefresh: () => void;
  onCreateDatabase: () => void;
  onCreateSchema: () => void;
  onCreateTable: () => void;
  onCreateEnum: () => void;
  onCreateIndex: () => void;
  onCreateTrigger: () => void;
  onNewConnection: () => void;
  onToggleSidebar: () => void;
  onOpenHistory: () => void;
  onOpenSnapshots: () => void;
  onOpenDiagram: () => void;
  onOpenExportTab: () => void;
  onUniversalSearch?: () => void;
  onOpenSpacetimeDbReducers?: () => void;
  onOpenSpacetimeDbLogs?: () => void;
  onOpenSpacetimeDbSchema?: () => void;
  commandMenuSections: Array<{ id: string; name: string; isVisible: boolean }>;
  /** User keybindings so listed shortcuts reflect remaps. */
  keybindings?: Record<string, Keybinding>;
}

interface CommandItem {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

interface CommandGroup {
  id: SectionId | "functions" | "schemas";
  title: string;
  items: CommandItem[];
}

export function CommandMenu({
  dbType,
  isOpen,
  onOpenChange,
  tables,
  functions,
  schemas,
  onSelectTable,
  onSelectFunction,
  onSelectSchema,
  onNewQuery,
  onRefresh,
  onCreateDatabase,
  onCreateSchema,
  onCreateTable,
  onCreateEnum,
  onCreateIndex,
  onCreateTrigger,
  onNewConnection,
  onToggleSidebar,
  onOpenHistory,
  onOpenSnapshots,
  onOpenDiagram,
  onOpenExportTab,
  onUniversalSearch,
  onOpenSpacetimeDbReducers,
  onOpenSpacetimeDbLogs,
  onOpenSpacetimeDbSchema,
  commandMenuSections = [],
  keybindings,
}: CommandMenuProps) {
  const labels = getTableLabels(dbType);
  const isMongo = dbType === "mongodb";
  const isRedis = dbType === "redis";

  const [search, setSearch] = useState("");
  const [selectedValue, setSelectedValue] = useState("");

  const shortcutFor = useCallback(
    (type: string, fallback: string) => {
      const combo = keybindings ? getKeybindingCombo(keybindings, type) : null;
      return formatShortcutForPlatform(combo || fallback);
    },
    [keybindings],
  );

  const sectionVisibility = useMemo(() => {
    const visible = new Map<string, boolean>();
    for (const section of commandMenuSections) {
      visible.set(section.id, section.isVisible);
    }
    return visible;
  }, [commandMenuSections]);

  const allGroups = useMemo<CommandGroup[]>(() => {
    const groups: CommandGroup[] = [];
    const isMongo = dbType === "mongodb";
    const isRedis = dbType === "redis";
    const isSpacetimedb = dbType === "spacetimedb";
    const isSqlite = dbType === "sqlite";
    const isPostgres = dbType === "postgres" || dbType === "supabase-mgmt";
    const isMssql = dbType === "mssql";
    const isClickhouse = dbType === "clickhouse";

    if (sectionVisibility.get("create") !== false) {
      groups.push({
        id: "create",
        title: isMongo ? "Mongo Create" : "Create",
        items: [
          {
            id: "new-query",
            label: isRedis ? "New Command" : "New Query",
            keywords: isMongo
              ? ["mongo", "json", "shell", "query", "editor"]
              : isRedis
                ? ["redis", "command", "editor"]
                : ["sql", "editor", "query"],
            icon: Plus,
            shortcut: shortcutFor("OPEN_SQL_EDITOR", "Cmd+N"),
            action: onNewQuery,
          },
          ...(isSpacetimedb
            ? [
                {
                  id: "spacetimedb-reducers",
                  label: "Reducers",
                  keywords: ["reducer", "function", "call", "spacetimedb"],
                  icon: FunctionSquare,
                  action: () => onOpenSpacetimeDbReducers?.(),
                },
                {
                  id: "spacetimedb-logs",
                  label: "Logs",
                  keywords: ["log", "stream", "spacetime", "spacetimedb"],
                  icon: RefreshCw,
                  action: () => onOpenSpacetimeDbLogs?.(),
                },
                {
                  id: "spacetimedb-schema",
                  label: "Raw Schema",
                  keywords: ["schema", "json", "raw", "spacetimedb"],
                  icon: Search,
                  action: () => onOpenSpacetimeDbSchema?.(),
                },
              ]
            : []),
          ...(isRedis || isSpacetimedb
            ? []
            : [
                {
                  id: "create-table",
                  label: isMongo ? "Create Collection" : "Create Table",
                  keywords: isMongo
                    ? ["collection", "mongo", "create"]
                    : ["table", "ddl"],
                  icon: Table2,
                  action: onCreateTable,
                },
              ]),
          ...(isMongo
            ? [
                {
                  id: "create-database",
                  label: "Create Database",
                  keywords: ["database", "db", "mongo"],
                  icon: Database,
                  action: onCreateDatabase,
                },
              ]
            : isSqlite || isRedis
              ? []
              : isPostgres
                ? [
                    {
                      id: "create-schema",
                      label: "Create Schema",
                      keywords: ["schema", "namespace"],
                      icon: Database,
                      action: onCreateSchema,
                    },
                    {
                      id: "create-database",
                      label: "Create Database",
                      keywords: ["database", "db"],
                      icon: Database,
                      action: onCreateDatabase,
                    },
                    {
                      id: "create-enum",
                      label: "Create Enum",
                      keywords: ["enum", "type"],
                      icon: Plus,
                      action: onCreateEnum,
                    },
                    {
                      id: "create-index",
                      label: "Create Index",
                      keywords: ["index", "performance"],
                      icon: Plus,
                      action: onCreateIndex,
                    },
                    {
                      id: "create-trigger",
                      label: "Create Trigger",
                      keywords: ["trigger", "function"],
                      icon: Plus,
                      action: onCreateTrigger,
                    },
                  ]
                : isMssql
                  ? [
                      {
                        id: "create-schema",
                        label: "Create Schema",
                        keywords: ["schema", "namespace"],
                        icon: Database,
                        action: onCreateSchema,
                      },
                      {
                        id: "create-database",
                        label: "Create Database",
                        keywords: ["database", "db"],
                        icon: Database,
                        action: onCreateDatabase,
                      },
                    ]
                  : [
                      {
                        id: "create-database",
                        label: "Create Database",
                        keywords: ["database", "db"],
                        icon: Database,
                        action: onCreateDatabase,
                      },
                    ]),
        ],
      });
    }

    if (sectionVisibility.get("navigation") !== false) {
      groups.push({
        id: "navigation",
        title: "Navigation",
        items: [
          {
            id: "history",
            label: "Query History",
            keywords: ["history", "queries"],
            icon: Clock,
            action: onOpenHistory,
          },
          {
            id: "schema-diagram",
            label: "Schema Diagram",
            keywords: ["diagram", "er", "schema", "graph"],
            icon: GitFork,
            shortcut: shortcutFor("OPEN_DATABASE_VIEW", "Cmd+Shift+D"),
            action: onOpenDiagram,
          },
          {
            id: "toggle-sidebar",
            label: "Toggle Navigator",
            keywords: ["sidebar", "navigator"],
            icon: Layout,
            shortcut: shortcutFor("TOGGLE_SIDEBAR", "Cmd+B"),
            action: onToggleSidebar,
          },
          {
            id: "refresh",
            label: "Refresh Data",
            keywords: ["reload", "refresh"],
            icon: RefreshCw,
            action: onRefresh,
          },
          {
            id: "export-tab",
            label: "Export Schema / Data",
            keywords: ["export", "schema", "data", "csv", "json", "sql"],
            icon: Workflow,
            action: onOpenExportTab,
          },
          {
            id: "snapshots",
            label: "Snapshots",
            keywords: ["snapshot", "backup", "diff", "compare", "version"],
            icon: Camera,
            action: onOpenSnapshots,
          },
          ...(onUniversalSearch
            ? [
                {
                  id: "universal-search",
                  label: "Search All Tables...",
                  keywords: [
                    "search",
                    "find",
                    "universal",
                    "global",
                    "cross-table",
                  ],
                  icon: Search,
                  shortcut: shortcutFor("OPEN_UNIVERSAL_SEARCH", "Cmd+Shift+F"),
                  action: () => onUniversalSearch(),
                },
              ]
            : []),
        ],
      });
    }

    if (sectionVisibility.get("connections") !== false) {
      groups.push({
        id: "connections",
        title: "Connections",
        items: [
          {
            id: "new-connection",
            label: "Manage Connections",
            keywords: ["connections", "switch", "new"],
            icon: LogOut,
            action: onNewConnection,
          },
        ],
      });
    }

    if (sectionVisibility.get("tables") !== false && tables.length > 0) {
      groups.push({
        id: "tables",
        title: labels.plural,
        items: tables.map((table) => ({
          id: `table-${table}`,
          label: table,
          keywords: ["table", table],
          icon: Table2,
          action: () => onSelectTable(table),
        })),
      });
    }

    if (functions.length > 0) {
      groups.push({
        id: "functions",
        title: "Functions",
        items: functions.map((fn, idx) => {
          const label =
            typeof fn?.name === "string" && fn.name.trim()
              ? fn.name
              : `Function ${idx + 1}`;
          return {
            id: `fn-${label}-${idx}`,
            label,
            keywords: ["function", "routine", label],
            icon: FunctionSquare,
            action: () => onSelectFunction(fn),
          };
        }),
      });
    }

    if (schemas.length > 0) {
      groups.push({
        id: "schemas",
        title:
          isMongo || dbType === "mysql" || isClickhouse
            ? "Databases"
            : "Schemas",
        items: schemas.map((schema) => ({
          id: `schema-${schema}`,
          label: schema,
          keywords:
            isMongo || isClickhouse
              ? ["database", "db", schema]
              : ["schema", "namespace", schema],
          icon: Database,
          action: () => onSelectSchema(schema),
        })),
      });
    }

    return groups;
  }, [
    functions,
    dbType,
    onCreateDatabase,
    onCreateEnum,
    onCreateIndex,
    onCreateSchema,
    onCreateTable,
    onCreateTrigger,
    onOpenExportTab,
    onNewConnection,
    onNewQuery,
    onOpenDiagram,
    onOpenHistory,
    onRefresh,
    onSelectFunction,
    onSelectSchema,
    onSelectTable,
    onToggleSidebar,
    onOpenSnapshots,
    onUniversalSearch,
    schemas,
    sectionVisibility,
    shortcutFor,
    tables,
  ]);

  const filteredGroups = useMemo(() => {
    if (!search) return allGroups;
    const groupsWithScores: Array<{ group: CommandGroup; maxScore: number }> =
      [];
    for (const group of allGroups) {
      const scoredItems = group.items.map((item) => ({
        item,
        score: defaultFilter(
          `${group.title} ${item.label}`,
          search,
          item.keywords,
        ),
      }));
      const matchingItems = scoredItems.filter((s) => s.score > 0);
      if (matchingItems.length === 0) continue;
      matchingItems.sort((a, b) => b.score - a.score);
      groupsWithScores.push({
        group: { ...group, items: matchingItems.map((s) => s.item) },
        maxScore: matchingItems[0].score,
      });
    }
    groupsWithScores.sort((a, b) => b.maxScore - a.maxScore);
    return groupsWithScores.map((g) => g.group);
  }, [search, allGroups]);

  const bestValue = useMemo(() => {
    if (!search || filteredGroups.length === 0) return "";
    const g = filteredGroups[0];
    return g.items.length > 0 ? `${g.title} ${g.items[0].label}` : "";
  }, [search, filteredGroups]);

  // When the query changes, select the top match once. Do not keep forcing
  // `value` to bestValue on every render — that cancels mouse hover selection.
  React.useEffect(() => {
    if (!search) return;
    if (bestValue) setSelectedValue(bestValue);
  }, [search, bestValue]);

  const executeItem = (item: CommandItem) => {
    item.action();
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearch("");
      setSelectedValue("");
    }
    onOpenChange(open);
  };

  const handleSearchChange = useCallback((newSearch: string) => {
    setSearch(newSearch);
  }, []);

  const handleValueChange = useCallback((newValue: string) => {
    setSelectedValue(newValue);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="overflow-hidden rounded-lg border border-studio-border bg-studio-bg p-0 pb-10 shadow-2xl data-[state=open]:animate-cmd-enter data-[state=closed]:animate-cmd-exit sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search commands, tables, schemas, and functions.
        </DialogDescription>

        <Command
          shouldFilter={false}
          value={selectedValue}
          onValueChange={handleValueChange}
          className="rounded-none bg-transparent **:data-[selected=true]:bg-muted **:data-[selected=true]:text-foreground"
        >
          <CommandInput
            autoFocus
            onValueChange={handleSearchChange}
            placeholder={`Search commands, ${labels.plural.toLowerCase()}, ${isMongo || isRedis ? "databases" : "schemas"}...`}
          />
          <CommandList className="no-scrollbar max-h-80 min-h-80">
            <CommandEmpty>No matching commands.</CommandEmpty>

            {filteredGroups.map((group, index) => (
              <React.Fragment key={group.id}>
                {index > 0 ? <CommandSeparator alwaysRender /> : null}
                <CommandGroup heading={group.title}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem
                        key={item.id}
                        keywords={item.keywords}
                        value={`${group.title} ${item.label}`}
                        onSelect={() => executeItem(item)}
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                        {item.shortcut ? (
                          <CommandShortcut>{item.shortcut}</CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
        </Command>

        <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 border-t border-studio-border bg-studio-bg px-4 font-medium text-muted-foreground text-xs">
          <Kbd>Enter</Kbd>
          Select
        </div>
      </DialogContent>
    </Dialog>
  );
}
