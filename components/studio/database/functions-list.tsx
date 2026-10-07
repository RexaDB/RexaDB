"use client";

import {
  StudioSheetContent as SheetContent,
  StudioSheetTitle as SheetTitle,
  StudioSheetHeader as SheetHeader,
  StudioSheetFooter as SheetFooter,
} from "@/components/common/studio-sheet";

import {
  Search,
  FunctionSquare,
  Code2,
  Terminal,
  MoreVertical,
  Save,
  X,
  Plus,
  Edit2,
  Copy,
  Trash2,
  FileText,
  Check,
  Database,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { useEffect, useState, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SchemaDropdown } from "./schema-dropdown";
import { SelectFilter } from "./select-filter";
import { EmptyStatePresentational } from "./empty-state-presentational";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MonacoSqlInput } from "@/components/studio/monaco-sql-input";
import { SqlQueryInput } from "@/components/studio/sql-query-input";
import type { SqlEditorEngine } from "@/lib/studio/types";
import type {
  CustomEditorTheme,
  MonacoThemeRef,
} from "@/lib/studio/editor-themes";
import {
  Sheet,
} from "@/components/ui/sheet";

interface DatabaseFunction {
  schema: string;
  name: string;
  arguments: string;
  argument_types?: string;
  type: string;
  return_type: string;
  definition: string;
  language: string;
  security_definer?: boolean;
}

interface FunctionsListProps {
  functions: DatabaseFunction[];
  selectedSchema: string;
  schemas: string[];
  onSchemaChange: (schema: string) => void;
  onDeleteFunction: (schema: string, name: string, args: string) => void;
  onSaveFunctionDefinition: (
    schema: string,
    name: string,
    args: string,
    definition: string,
  ) => Promise<boolean> | boolean;
  fetchingFunctions?: boolean;
  dbType?: string;
  sqlEditorEngine?: SqlEditorEngine;
  editorFontSize?: number;
  editorFontFamily?: string;
  editorThemeId?: string;
  appEditorTheme?: MonacoThemeRef | null;
  customEditorThemes?: CustomEditorTheme[];
  vimMode?: boolean;
  schemaData?: Record<string, any>;
  onAskAI?: () => void;
}

const DEFAULT_SHEET_WIDTH = 1152;
const MIN_SHEET_WIDTH = 760;
const MAX_SHEET_WIDTH = 1800;
const RESIZED_DEFAULT_SHEET_WIDTH = Math.round(DEFAULT_SHEET_WIDTH * (2 / 3));

export function FunctionsList({
  functions,
  selectedSchema,
  schemas,
  onSchemaChange,
  onDeleteFunction,
  onSaveFunctionDefinition,
  fetchingFunctions,
  dbType = "postgres",
  sqlEditorEngine = "monaco",
  editorFontSize = 13,
  editorFontFamily = "",
  editorThemeId = "auto",
  appEditorTheme = null,
  customEditorThemes = [],
  vimMode = false,
  schemaData = {},
  onAskAI,
}: FunctionsListProps) {
  const isMssql = dbType === "mssql";
  const [search, setSearch] = useState("");
  const [selectedFunction, setSelectedFunction] =
    useState<DatabaseFunction | null>(null);
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [isSavingDefinition, setIsSavingDefinition] = useState(false);

  const schemaFunctions = functions.filter((f) => f.schema === selectedSchema);

  const uniqueReturnTypes = useMemo(
    () => Array.from(new Set(schemaFunctions.map((fn) => fn.return_type))).filter(Boolean).sort(),
    [schemaFunctions]
  );
  const uniqueRoutineTypes = useMemo(
    () =>
      Array.from(
        new Set(
          schemaFunctions.map((fn) => String(fn.type || "").toUpperCase()).filter(Boolean),
        ),
      ).sort(),
    [schemaFunctions]
  );
  const hasDefiner = !isMssql && schemaFunctions.some((fn) => fn.security_definer);
  const hasInvoker = !isMssql && schemaFunctions.some((fn) => !fn.security_definer);
  const securityOptions = [
    ...(hasDefiner ? [{ label: "Definer", value: "definer" }] : []),
    ...(hasInvoker ? [{ label: "Invoker", value: "invoker" }] : []),
  ];

  const [returnTypeFilter, setReturnTypeFilter] = useState<string[]>([]);
  const [securityFilter, setSecurityFilter] = useState<string[]>([]);
  const [routineTypeFilter, setRoutineTypeFilter] = useState<string[]>([]);

  const filteredFunctions = useMemo(() => {
    let list = schemaFunctions;
    const q = search.toLowerCase();
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    if (returnTypeFilter.length > 0) {
      list = list.filter((f) => returnTypeFilter.includes(f.return_type));
    }
    if (routineTypeFilter.length > 0) {
      list = list.filter((f) =>
        routineTypeFilter.includes(String(f.type || "").toUpperCase()),
      );
    }
    if (securityFilter.length > 0) {
      list = list.filter((f) => {
        const sec = f.security_definer ? "definer" : "invoker";
        return securityFilter.includes(sec);
      });
    }
    return list;
  }, [schemaFunctions, search, returnTypeFilter, routineTypeFilter, securityFilter]);

  useEffect(() => {
    if (!selectedFunction) return;
    setDefinitionDraft(selectedFunction.definition || "");
  }, [selectedFunction]);

  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema, returnTypeFilter, routineTypeFilter, securityFilter]);

  const openFunctionViewer = (fn: DatabaseFunction) => {
    setSelectedFunction(fn);
    setDefinitionDraft(fn.definition || "");
  };

  const closeFunctionViewer = () => {
    setSelectedFunction(null);
    setDefinitionDraft("");
    setIsSavingDefinition(false);
  };

  const handleCancelEdit = () => closeFunctionViewer();

  const columns: TableColumn<DatabaseFunction>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: "1.2fr",
        cell: (fn) => (
          <span className="block truncate font-medium" title={fn.name}>
            {fn.name}
          </span>
        ),
      },
      {
        key: "type",
        header: "Type",
        sortable: true,
        width: "0.7fr",
        cell: (fn) => (
          <span className="text-muted-foreground capitalize">{fn.type}</span>
        ),
      },
      {
        key: "arguments",
        header: "Arguments",
        width: "1.2fr",
        cell: (fn) => {
          const argumentTypes = fn.argument_types || fn.arguments || "";
          return (
            <p
              title={argumentTypes}
              className={`truncate ${argumentTypes ? "text-muted-foreground" : "text-muted-foreground/60"}`}
            >
              {argumentTypes || "\u2013"}
            </p>
          );
        },
        sortValue: (fn) => fn.argument_types || fn.arguments || "",
      },
      {
        key: "return_type",
        header: "Return type",
        sortable: true,
        width: "0.9fr",
        cell: (fn) =>
          fn.return_type === "trigger" ? (
            <span
              className="text-primary cursor-pointer hover:underline"
              title={fn.return_type}
            >
              {fn.return_type}
            </span>
          ) : (
            <p
              title={fn.return_type || ""}
              className={`truncate ${!fn.return_type ? "text-muted-foreground/60" : "text-muted-foreground"}`}
            >
              {fn.return_type || "\u2013"}
            </p>
          ),
      },
      ...(!isMssql
        ? [
            {
              key: "security",
              header: "Security",
              width: "0.7fr",
              cell: (fn: DatabaseFunction) => (
                <Badge variant={fn.security_definer ? "warning" : "outline"}>
                  {fn.security_definer ? "Definer" : "Invoker"}
                </Badge>
              ),
              sortValue: (fn: DatabaseFunction) =>
                fn.security_definer ? "Definer" : "Invoker",
            } as TableColumn<DatabaseFunction>,
          ]
        : []),
      {
        key: "actions",
        header: "",
        align: "right",
        width: "3rem",
        cell: (fn) => (
          <div className="flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`${fn.name} actions`}
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" className="w-52">
                <DropdownMenuItem
                  className="space-x-2"
                  disabled={isMssql}
                  title={isMssql ? "Editing MSSQL routines coming soon" : undefined}
                  onClick={() => { if (!isMssql) openFunctionViewer(fn); }}
                >
                  <Edit2 size={14} />
                  <p>{isMssql ? "View definition" : "Edit function"}</p>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="space-x-2"
                  disabled={isMssql}
                  title={isMssql ? "Editing MSSQL routines coming soon" : undefined}
                  onClick={() => {
                    if (isMssql) return;
                    const newFn = { ...fn, name: `${fn.name}_duplicate` };
                    openFunctionViewer(newFn);
                  }}
                >
                  <Copy size={14} />
                  <p>Duplicate function</p>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="space-x-2"
                  disabled={isMssql}
                  title={isMssql ? "Editing MSSQL routines coming soon" : undefined}
                  onClick={() => {
                    if (!isMssql)
                      onDeleteFunction(fn.schema, fn.name, fn.arguments);
                  }}
                >
                  <Trash2 size={14} />
                  <p>Delete function</p>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [isMssql, onDeleteFunction],
  );

  const hasDefinitionChanges =
    !!selectedFunction &&
    definitionDraft !== (selectedFunction.definition || "");

  const handleSaveDefinition = async () => {
    if (!selectedFunction || !hasDefinitionChanges) return;
    setIsSavingDefinition(true);
    try {
      const saved = await onSaveFunctionDefinition(
        selectedFunction.schema,
        selectedFunction.name,
        selectedFunction.arguments,
        definitionDraft,
      );
      if (saved) {
        setSelectedFunction((prev) =>
          prev ? { ...prev, definition: definitionDraft } : prev,
        );
      }
    } finally {
      setIsSavingDefinition(false);
    }
  };

  if (fetchingFunctions && functions.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="px-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
            <Skeleton className="h-8 w-32 rounded-md" />
            <Skeleton className="h-8 w-52 rounded-md" />
            <Skeleton className="h-8 w-36 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        <div className="px-8 flex-1 overflow-hidden flex flex-col">
          <div className="rounded-lg border border-border overflow-hidden flex-1 flex flex-col">
            <div className="border-b border-border px-4 py-3 grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px] gap-4">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-4 ml-auto" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-border px-4 py-4 grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px] gap-4 items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
                <div className="flex justify-end">
                  <Skeleton className="h-7 w-7 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          Database Functions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage stored routines in the{" "}
          <code className="bg-muted px-1 rounded">{selectedSchema}</code> schema
        </p>
      </div>

      <div className="px-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
          <SchemaDropdown
            schemas={schemas}
            selectedSchema={selectedSchema}
            onSchemaChange={onSchemaChange}
            showAllOption={false}
          />
          <div className="relative w-full lg:w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <Input
              placeholder="Search for a function"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-7 bg-background border-border text-xs"
            />
          </div>
          {uniqueReturnTypes.length > 0 && (
            <SelectFilter
              label="Return Type"
              options={uniqueReturnTypes.map((type) => ({ label: type, value: type }))}
              value={returnTypeFilter}
              onChange={setReturnTypeFilter}
              showSearch
            />
          )}
          {isMssql && uniqueRoutineTypes.length > 1 && (
            <SelectFilter
              label="Type"
              options={uniqueRoutineTypes.map((type) => ({
                label: type === "PROCEDURE" ? "Procedure" : "Function",
                value: type,
              }))}
              value={routineTypeFilter}
              onChange={setRoutineTypeFilter}
            />
          )}
          {!isMssql && securityOptions.length > 0 && (
            <SelectFilter
              label="Security"
              options={securityOptions}
              value={securityFilter}
              onChange={setSecurityFilter}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={onAskAI}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ai-agent.png" alt="" width={20} height={20} className="rounded-[3px] object-cover dark:invert" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
          </Tooltip>
          </TooltipProvider>
          {isMssql ? (
            <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-auto grow lg:grow-0 inline-flex">
                  <Button variant="outline" size="sm" className="grow lg:grow-0" disabled>
                    <Plus className="w-3.5 h-3.5" />
                    New function
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Editing MSSQL routines coming soon</TooltipContent>
            </Tooltip>
            </TooltipProvider>
          ) : (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto grow lg:grow-0"
            onClick={() => {
              const newFn: DatabaseFunction = {
                schema: selectedSchema,
                name: "",
                arguments: "",
                type: "function",
                return_type: "void",
                definition: "",
                language: "plpgsql",
              };
              openFunctionViewer(newFn);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New function
          </Button>
          )}
        </div>
      </div>

      <div className="px-8 flex-1 min-h-0 overflow-y-auto">
        {schemaFunctions.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start supabase-theme">
            <EmptyStatePresentational
              icon={Database}
              title={isMssql ? `No procedures or functions in ${selectedSchema}` : "Add your first function"}
              description={
                isMssql
                  ? "SQL Server stored procedures and functions in this schema will appear here."
                  : "PostgreSQL functions are a set of SQL and procedural commands such as declarations, assignments, loops, or flow-of-control."
              }
            >
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon-sm" onClick={onAskAI}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ai-agent.png" alt="" width={20} height={20} className="rounded-[3px] object-cover dark:invert" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!isMssql && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newFn: DatabaseFunction = {
                      schema: selectedSchema,
                      name: "",
                      arguments: "",
                      type: "function",
                      return_type: "void",
                      definition: "",
                      language: "plpgsql",
                    };
                    openFunctionViewer(newFn);
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  New function
                </Button>
                )}
              </div>
            </EmptyStatePresentational>
          </div>
        ) : (
          <div className="pb-8">
            <DataTable<DatabaseFunction>
              data={filteredFunctions}
              columns={columns}
              getRowId={(fn) => `${fn.schema}.${fn.name}(${fn.arguments || ""})`}
              pagination={{
                page,
                pageSize: 10,
                onPageChange: setPage,
                itemLabel: "functions",
              }}
              isRowClickable={() => !isMssql}
              onRowClick={(fn) => {
                if (!isMssql) openFunctionViewer(fn);
              }}
              emptyState={
                <div className="py-8 text-center">
                  <p className="text-sm text-foreground">No results found</p>
                  <p className="text-sm text-muted-foreground">
                    Your search for &ldquo;{search}&rdquo; did not return any results
                  </p>
                </div>
              }
            />
          </div>
        )}
        <div className="h-8" />
      </div>

      <Sheet
        open={!!selectedFunction}
        onOpenChange={(open) => { if (!open) closeFunctionViewer(); }}
        modal={false}
      >
        <SheetContent
          side="right"
          contained
          className="bg-background text-foreground flex flex-col p-0 gap-0"
          style={{ width: `min(95vw, ${RESIZED_DEFAULT_SHEET_WIDTH}px)` }}
          minResizeWidth={MIN_SHEET_WIDTH}
          maxResizeWidth={MAX_SHEET_WIDTH}
          resizeHandleLabel="Resize function definition panel"
        >
            <SheetHeader>
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <FunctionSquare className="size-4 text-primary" />
                </div>
                <SheetTitle className="min-w-0 truncate">
                  {selectedFunction?.name}
                </SheetTitle>
                <Badge
                  variant="secondary"
                  className="shrink-0 border-none bg-primary/10 text-xs text-primary"
                >
                  {selectedFunction?.type}
                </Badge>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Terminal className="size-3" />
                  {selectedFunction?.language}
                </span>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-hidden p-6 pt-4 flex flex-col gap-4">
              <div className="flex-1 flex flex-col rounded-lg border border-border overflow-hidden bg-card/60">
                <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground tracking-widest">
                    <Code2 className="w-3.5 h-3.5" />
                    Source Definition
                  </div>
                  <span className="text-xs tracking-wider text-muted-foreground">
                    {selectedFunction?.language}
                  </span>
                </div>
                <div className="flex-1 overflow-hidden relative">
                  {!definitionDraft && isMssql ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No permission to view this definition, or the object is encrypted.
                      </p>
                    </div>
                  ) : sqlEditorEngine === "monaco" ? (
                    <MonacoSqlInput
                      dbType={dbType}
                      query={definitionDraft}
                      fontSize={editorFontSize}
                      fontFamily={editorFontFamily}
                      themeId={editorThemeId}
                      schemaData={schemaData}
                      onChange={(value) => setDefinitionDraft(value)}
                      onRun={handleSaveDefinition}
                      onRunSelected={handleSaveDefinition}
                      onSaveSnippet={() => {}}
                      onSelectionChange={() => {}}
                      appEditorTheme={appEditorTheme}
                      customEditorThemes={customEditorThemes}
                      vimMode={vimMode}
                      readOnly={isMssql}
                    />
                  ) : (
                    <SqlQueryInput
                      dbType={dbType}
                      query={definitionDraft}
                      fontSize={editorFontSize}
                      fontFamily={editorFontFamily}
                      schemaData={schemaData}
                      onChange={(value) => setDefinitionDraft(value)}
                      onRun={handleSaveDefinition}
                      onRunSelected={handleSaveDefinition}
                      onSaveSnippet={() => {}}
                      onSelectionChange={() => {}}
                    />
                  )}
                </div>
              </div>
            </div>
            <SheetFooter>
              {isMssql && (
                <span className="text-xs text-muted-foreground mr-auto">
                  MSSQL routines are read-only in this view.
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isSavingDefinition}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                {isMssql ? "Close" : "Cancel"}
              </Button>
              <Button
                size="sm"
                onClick={handleSaveDefinition}
                disabled={isMssql || !hasDefinitionChanges || isSavingDefinition}
                title={isMssql ? "Editing MSSQL routines coming soon" : undefined}
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                {isSavingDefinition ? "Saving..." : "Save"}
              </Button>
            </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
