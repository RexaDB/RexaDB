"use client";

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
import { LogoIcon } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DatabaseTable,
  DatabaseTableBody,
  DatabaseTableCell,
  DatabaseTableHead,
  DatabaseTableHeader,
  DatabaseTableRow,
} from "./database-table";
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
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";

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
}: FunctionsListProps) {
  const [search, setSearch] = useState("");
  const [selectedFunction, setSelectedFunction] =
    useState<DatabaseFunction | null>(null);
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [isSavingDefinition, setIsSavingDefinition] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(RESIZED_DEFAULT_SHEET_WIDTH);
  const [isResizingSheet, setIsResizingSheet] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const schemaFunctions = functions.filter((f) => f.schema === selectedSchema);

  const uniqueReturnTypes = useMemo(
    () => Array.from(new Set(schemaFunctions.map((fn) => fn.return_type))).filter(Boolean).sort(),
    [schemaFunctions]
  );
  const hasDefiner = schemaFunctions.some((fn) => fn.security_definer);
  const hasInvoker = schemaFunctions.some((fn) => !fn.security_definer);
  const securityOptions = [
    ...(hasDefiner ? [{ label: "Definer", value: "definer" }] : []),
    ...(hasInvoker ? [{ label: "Invoker", value: "invoker" }] : []),
  ];

  const [returnTypeFilter, setReturnTypeFilter] = useState<string[]>([]);
  const [securityFilter, setSecurityFilter] = useState<string[]>([]);

  const filteredFunctions = useMemo(() => {
    let list = schemaFunctions;
    const q = search.toLowerCase();
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    if (returnTypeFilter.length > 0) {
      list = list.filter((f) => returnTypeFilter.includes(f.return_type));
    }
    if (securityFilter.length > 0) {
      list = list.filter((f) => {
        const sec = f.security_definer ? "definer" : "invoker";
        return securityFilter.includes(sec);
      });
    }
    return list;
  }, [schemaFunctions, search, returnTypeFilter, securityFilter]);

  useEffect(() => {
    if (!selectedFunction) return;
    setDefinitionDraft(selectedFunction.definition || "");
  }, [selectedFunction]);

  const openFunctionViewer = (fn: DatabaseFunction) => {
    setSelectedFunction(fn);
    setDefinitionDraft(fn.definition || "");
  };

  const closeFunctionViewer = () => {
    setSelectedFunction(null);
    setDefinitionDraft("");
    setIsSavingDefinition(false);
    setIsResizingSheet(false);
    resizeStartRef.current = null;
  };

  const handleCancelEdit = () => closeFunctionViewer();

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

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStartRef.current = { startX: e.clientX, startWidth: sheetWidth };
    setIsResizingSheet(true);
    document.body.style.cursor = "col-resize";
    preventTextSelection();
  };

  useEffect(() => {
    if (!isResizingSheet) return;
    const onMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = start.startX - e.clientX;
      const viewportMax = Math.max(900, window.innerWidth - 24);
      const maxWidth = Math.min(MAX_SHEET_WIDTH, viewportMax);
      const next = Math.min(
        maxWidth,
        Math.max(MIN_SHEET_WIDTH, start.startWidth + delta),
      );
      setSheetWidth(next);
    };
    const onMouseUp = () => {
      setIsResizingSheet(false);
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      allowTextSelection();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingSheet]);

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
              className="pl-9 h-8 bg-background border-border text-xs"
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
          {securityOptions.length > 0 && (
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
              <Button variant="outline" size="icon" onClick={() => {}}>
                <LogoIcon width={16} height={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
          </Tooltip>
          </TooltipProvider>
          <Button
            variant="default"
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
        </div>
      </div>

      <div className="px-8 flex-1 overflow-hidden flex flex-col">
        {schemaFunctions.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start supabase-theme">
            <EmptyStatePresentational
              icon={Database}
              title="Add your first function"
              description="PostgreSQL functions are a set of SQL and procedural commands such as declarations, assignments, loops, or flow-of-control."
            >
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={() => {}}>
                        <LogoIcon width={16} height={16} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button
                  variant="default"
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
              </div>
            </EmptyStatePresentational>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden flex-1 flex flex-col supabase-theme">
            <DatabaseTable className="table-fixed">
              <DatabaseTableHeader>
                <DatabaseTableRow>
                  <DatabaseTableHead key="name">Name</DatabaseTableHead>
                  <DatabaseTableHead key="type">Type</DatabaseTableHead>
                  <DatabaseTableHead key="arguments">Arguments</DatabaseTableHead>
                  <DatabaseTableHead key="return_type">Return type</DatabaseTableHead>
                  <DatabaseTableHead key="security" className="w-[100px]">Security</DatabaseTableHead>
                  <DatabaseTableHead key="buttons" className="w-1/6" />
                </DatabaseTableRow>
              </DatabaseTableHeader>
              <DatabaseTableBody>
                {filteredFunctions.length === 0 && search.length > 0 && (
                  <DatabaseTableRow>
                    <DatabaseTableCell colSpan={6}>
                      <p className="text-sm text-foreground">No results found</p>
                      <p className="text-sm text-muted-foreground">
                        Your search for &ldquo;{search}&rdquo; did not return any results
                      </p>
                    </DatabaseTableCell>
                  </DatabaseTableRow>
                )}
              {filteredFunctions.map((fn) => {
                const argumentTypes = fn.argument_types || fn.arguments || "";
                return (
                  <DatabaseTableRow key={`${fn.schema}.${fn.name}(${fn.arguments || ""})`}>
                    <DatabaseTableCell className="truncate">
                      <Button
                        variant="ghost"
                        className="text-sm font-medium p-0 hover:bg-transparent h-auto text-primary hover:text-primary/80"
                        onClick={() => openFunctionViewer(fn)}
                        title={fn.name}
                      >
                        {fn.name}
                      </Button>
                    </DatabaseTableCell>
                    <DatabaseTableCell className="text-muted-foreground capitalize">
                      {fn.type}
                    </DatabaseTableCell>
                    <DatabaseTableCell>
                      <p
                        title={argumentTypes}
                        className={`truncate ${argumentTypes ? "text-muted-foreground" : "text-muted-foreground/60"}`}
                      >
                        {argumentTypes || "\u2013"}
                      </p>
                    </DatabaseTableCell>
                    <DatabaseTableCell>
                      {fn.return_type === "trigger" ? (
                        <span
                          className="text-primary cursor-pointer hover:underline"
                          title={fn.return_type}
                        >
                          {fn.return_type}
                        </span>
                      ) : (
                        <p
                          title={fn.return_type}
                          className={`truncate ${fn.return_type === null ? "text-muted-foreground/60" : "text-muted-foreground"}`}
                        >
                          {fn.return_type === null ? "\u2013" : fn.return_type}
                        </p>
                      )}
                    </DatabaseTableCell>
                    <DatabaseTableCell>
                      <p className="truncate text-muted-foreground">
                        {fn.security_definer ? "Definer" : "Invoker"}
                      </p>
                    </DatabaseTableCell>
                    <DatabaseTableCell className="text-right">
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <TooltipProvider><Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  aria-label={`${fn.name} actions`}
                                >
                                  <MoreVertical />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                          <TooltipContent side="bottom">More options</TooltipContent>
                        </Tooltip></TooltipProvider>
                          <DropdownMenuContent side="bottom" align="end" className="w-52">
                            <DropdownMenuItem
                              className="space-x-2"
                              onClick={() => openFunctionViewer(fn)}
                            >
                              <Edit2 size={14} />
                              <p>Edit function</p>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="space-x-2"
                              onClick={() => {
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
                              onClick={() =>
                                onDeleteFunction(fn.schema, fn.name, fn.arguments)
                              }
                            >
                              <Trash2 size={14} />
                              <p>Delete function</p>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </DatabaseTableCell>
                  </DatabaseTableRow>
                );
              })}
            </DatabaseTableBody>
          </DatabaseTable>
        </div>
        )}
        <div className="h-8" />
      </div>

      {selectedFunction ? (
        <div className="fixed inset-0 z-[100]">
          <button
            type="button"
            aria-label="Close function definition panel"
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            onClick={closeFunctionViewer}
          />
          <aside
            className="absolute right-0 top-0 h-full flex flex-col p-0 gap-0 bg-background border-l border-border text-foreground shadow-2xl"
            style={{ width: `min(95vw, ${sheetWidth}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="hidden sm:block absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize select-none"
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize function definition panel"
            />
            <div className="p-6 border-b border-border shrink-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <FunctionSquare className="w-5 h-5 text-primary" />
                </div>
                <div className="flex flex-col">
                  <h2 className="text-sm font-bold">
                    {selectedFunction?.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="secondary"
                      className="text-xs tracking-wider bg-primary/10 text-primary border-none"
                    >
                      {selectedFunction?.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 tracking-wider font-medium">
                      <Terminal className="w-3 h-3" />
                      {selectedFunction?.language}
                    </span>
                    <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted/50 rounded tracking-wider font-medium">
                      Returns: {selectedFunction?.return_type}
                    </span>
                  </div>
                </div>
              </div>
            </div>

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
                  {sqlEditorEngine === "monaco" ? (
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
            <div className="p-4 border-t border-border bg-background/95 flex flex-row items-center justify-end gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isSavingDefinition}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveDefinition}
                disabled={!hasDefinitionChanges || isSavingDefinition}
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                {isSavingDefinition ? "Saving..." : "Save"}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
