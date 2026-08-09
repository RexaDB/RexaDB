"use client";

import {
  Table2,
  Search,
  ArrowRight,
  ChevronDown,
  Plus,
  Globe,
  Unlock,
  GitFork,
  Terminal,
  MoreVertical,
  Tag,
  Download,
  Eraser,
  Trash2,
  Check,
  Eye,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import type {
  TableActionHandler,
  ExportDataHandler,
} from "@/lib/studio-backend/types";
import { useState } from "react";
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
  viewTables?: string[];
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
  viewTables = [],
}: TablesListProps) {
  const [search, setSearch] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(
    DEFAULT_CONFIRM_DIALOG,
  );

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
                      <div className="px-2 py-1.5 text-xs tracking-wider text-muted-foreground/50">
                        Actions
                      </div>
                      <Component
                        className="text-xs"
                        onClick={handleAction((t) => onTableClick(t))}
                      >
                        <ItemIcon className="mr-2 h-3.5 w-3.5" />
                        Open {itemNoun}
                      </Component>
                      <Component
                        className="text-xs"
                        onClick={handleAction((t, s) =>
                          onOpenSqlEditor?.(t, s),
                        )}
                      >
                        <Terminal className="mr-2 h-3.5 w-3.5" />
                        {openEditorLabel}
                      </Component>
                      <Component
                        className="text-xs"
                        onClick={handleAction((t) => onViewSchema?.(t))}
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
                        onExport={(format) => exportData?.(format)}
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
                        <div className="flex items-center gap-2">
                          <ItemIcon className="w-3.5 h-3.5 text-primary/60" />
                          <span className="text-xs font-bold text-foreground tracking-tight">
                            {table}
                          </span>
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
                              className="w-56 bg-popover border-border shadow-2xl"
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
                    <ContextMenuContent className="w-56 bg-popover border-border shadow-2xl">
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

            {filteredTables.length === 0 && (
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
