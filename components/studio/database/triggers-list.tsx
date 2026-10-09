"use client";

import { Zap, Search, Check, X, MoreVertical, Edit2, Copy, Trash2, Plus } from "@/lib/icon-theme/lucide-react";
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
import { SelectFilter } from "./select-filter";
import { EmptyStatePresentational } from "./empty-state-presentational";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DbListHeader,
  DbListPage,
  DbListToolbar,
  DbSchemaFilter,
  DbSearchInput,
  DbTableLink,
  DbToolbarFilters,
} from "./db-list-layout";

export interface Trigger {
  id: string;
  schema: string;
  name: string;
  table: string;
  table_id?: string;
  function_name: string;
  function_schema?: string;
  activation: string;
  events: string[];
  orientation: string;
  enabled_mode: string;
  definition: string;
}

interface TriggersListProps {
  triggers: Trigger[];
  fetchingTriggers: boolean;
  onOpenCreateTriggerTab?: () => void;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
  onEditTrigger?: (trigger: Trigger) => void;
  onDuplicateTrigger?: (trigger: Trigger) => void;
  onDeleteTrigger?: (trigger: Trigger) => void;
  onOpenTable?: (table: string, schema: string) => void;
  onAskAI?: () => void;
  dbType?: string;
}

export function TriggersList({
  triggers,
  fetchingTriggers,
  onOpenCreateTriggerTab,
  schemas,
  selectedSchema,
  onSchemaChange,
  onEditTrigger,
  onDuplicateTrigger,
  onDeleteTrigger,
  onOpenTable,
  onAskAI,
  dbType = "postgres",
}: TriggersListProps) {
  const isMssql = dbType === "mssql";
  const isOracle = dbType === "oracle";
  // Oracle trigger SQL differs from the Postgres shapes these controls
  // emit, so Oracle stays read-only until Oracle-aware actions exist.
  const readOnlyTriggers = isMssql || isOracle;
  const readOnlyTitle = isOracle
    ? "Triggers are read-only for Oracle connections"
    : "Editing MSSQL triggers coming soon";
  // MSSQL rows carry table_name/timing/event; pg-explorer rows carry
  // table/activation/events — accept both.
  const normalizedTriggers = useMemo(
    () =>
      (triggers ?? []).map((t: any, i: number) => ({
        ...t,
        id: t.id ?? `${t.schema}.${t.name}-${i}`,
        table: t.table ?? t.table_name ?? "",
        table_name: t.table_name ?? t.table ?? "",
        activation: t.activation ?? t.timing ?? "",
        timing: t.timing ?? t.activation ?? "",
        events: Array.isArray(t.events)
          ? t.events
          : t.event
            ? String(t.event).split(",").map((e: string) => e.trim()).filter(Boolean)
            : [],
        event: t.event ?? (Array.isArray(t.events) ? t.events.join(", ") : ""),
        orientation: t.orientation ?? "ROW",
        enabled_mode: t.enabled_mode ?? "ENABLED",
        function_name: t.function_name ?? "",
      })),
    [triggers],
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewingDefinition, setViewingDefinition] = useState<Trigger | null>(null);

  const schemaTriggers = normalizedTriggers.filter((t) => t.schema === selectedSchema);

  const tables = useMemo(
    () => Array.from(new Set(schemaTriggers.map((x) => x.table))).sort(),
    [schemaTriggers]
  );

  const [tablesFilter, setTablesFilter] = useState<string[]>([]);

  const filteredTriggers = useMemo(() => {
    let list = schemaTriggers;
    const q = search.toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.function_name && t.function_name.toLowerCase().includes(q))
      );
    }
    if (tablesFilter.length > 0) {
      list = list.filter((t) => tablesFilter.includes(t.table));
    }
    return list;
  }, [schemaTriggers, search, tablesFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema, tablesFilter]);

  type TriggerRow = (typeof normalizedTriggers)[number];

  const eventBadgeVariant = (
    event: string,
  ): "success" | "warning" | "destructive" | "outline" => {
    const e = event.toUpperCase();
    if (e.includes("INSERT")) return "success";
    if (e.includes("UPDATE")) return "warning";
    if (e.includes("DELETE") || e.includes("TRUNCATE")) return "destructive";
    return "outline";
  };
  const columns: TableColumn<TriggerRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: "1.4fr",
        cell: (t) => (
          <span className="block truncate font-medium" title={t.name}>
            {t.name}
          </span>
        ),
      },
      {
        key: "table",
        header: "Table",
        sortable: true,
        width: "1fr",
        cell: (t) =>
          onOpenTable ? (
            <DbTableLink table={t.table} schema={t.schema} onOpen={onOpenTable} />
          ) : (
            <p className="truncate text-muted-foreground" title={t.table}>
              {t.table}
            </p>
          ),
      },
      {
        key: "function",
        header: "Function",
        width: "1fr",
        cell: (t) =>
          t.function_name ? (
            <p className="truncate text-muted-foreground" title={t.function_name}>
              {t.function_name}
            </p>
          ) : (
            <p className="truncate text-muted-foreground">-</p>
          ),
        sortValue: (t) => t.function_name ?? "",
      },
      {
        key: "events",
        header: "Events",
        width: "1.2fr",
        cell: (t) => (
          <div
            className="flex gap-1.5 flex-nowrap overflow-hidden"
            title={(t.events ?? []).map((event: string) => `${t.activation} ${event}`).join(", ")}
          >
            {(t.events ?? []).map((event: string) => (
              <Badge key={event} variant={eventBadgeVariant(event)} className="shrink-0">
                {t.activation} {event}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        key: "orientation",
        header: "Orientation",
        width: "0.8fr",
        cell: (t) => (
          <p className="truncate text-muted-foreground" title={t.orientation}>
            {t.orientation}
          </p>
        ),
        sortValue: (t) => t.orientation ?? "",
      },
      {
        key: "enabled",
        header: "Enabled",
        align: "center",
        width: "4.5rem",
        cell: (t) => (
          <div className="flex items-center justify-center">
            {t.enabled_mode !== "DISABLED" ? (
              <Check className="w-4 h-4 text-primary" />
            ) : (
              <X className="w-4 h-4 text-muted-foreground/40" />
            )}
          </div>
        ),
        sortValue: (t) => (t.enabled_mode !== "DISABLED" ? 1 : 0),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "3rem",
        cell: (t) => (
          <div className="flex items-center justify-end">
            <DropdownMenu>
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`${t.name} actions`}
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
                  disabled={readOnlyTriggers}
                  title={readOnlyTriggers ? readOnlyTitle : undefined}
                  onClick={() => { if (!readOnlyTriggers) onEditTrigger?.(t); }}
                >
                  <Edit2 size={14} />
                  <p>Edit trigger</p>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="space-x-2"
                  disabled={readOnlyTriggers}
                  title={readOnlyTriggers ? readOnlyTitle : undefined}
                  onClick={() => { if (!readOnlyTriggers) onDuplicateTrigger?.(t); }}
                >
                  <Copy size={14} />
                  <p>Duplicate trigger</p>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="space-x-2"
                  disabled={readOnlyTriggers}
                  title={readOnlyTriggers ? readOnlyTitle : undefined}
                  onClick={() => { if (!readOnlyTriggers) onDeleteTrigger?.(t); }}
                >
                  <Trash2 size={14} />
                  <p>Delete trigger</p>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [readOnlyTriggers, readOnlyTitle, onDeleteTrigger, onDuplicateTrigger, onEditTrigger, onOpenTable],
  );

  if (fetchingTriggers && triggers.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-80" />
        </div>
        <div className="px-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
            <Skeleton className="h-8 w-32 rounded-md" />
            <Skeleton className="h-8 w-52 rounded-md" />
            <Skeleton className="h-8 w-36 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        <div className="px-8 flex-1 overflow-hidden flex flex-col">
          <div className="rounded-lg border border-border overflow-hidden flex-1 flex flex-col">
            <div className="border-b border-border px-4 py-3 grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px_80px] gap-4">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-4 ml-auto" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-border px-4 py-4 grid grid-cols-[1fr_1fr_1fr_1fr_1fr_80px_80px] gap-4 items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-4 mx-auto" />
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
    <>
      <DbListPage>
        <DbListHeader
          title="Database Triggers"
          description="Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in."
        />

        <DbListToolbar>
          <DbToolbarFilters>
            <DbSchemaFilter schemas={schemas} selectedSchema={selectedSchema} onSchemaChange={onSchemaChange} />
            <DbSearchInput value={search} onChange={setSearch} placeholder="Search for a trigger" icon="right" />
            {tables.length > 0 && (
              <SelectFilter
                label="Table"
                options={tables.map((type) => ({ label: type, value: type }))}
                value={tablesFilter}
                onChange={setTablesFilter}
                showSearch
              />
            )}
          </DbToolbarFilters>
          <div className="flex items-center gap-2">

            {readOnlyTriggers ? (
              <>
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
              <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto grow inline-flex">
                    <Button variant="outline" size="sm" className="grow" disabled>
                      <Plus className="w-3.5 h-3.5" />
                      New trigger
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{readOnlyTitle}</TooltipContent>
              </Tooltip>
              </TooltipProvider>
              </>
            ) : (
            onOpenCreateTriggerTab && (
              <>
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
              <Button
                onClick={onOpenCreateTriggerTab}
                variant="outline"
                size="sm"
                className="ml-auto grow"
              >
                <Plus className="w-3.5 h-3.5" />
                New trigger
              </Button>
              </>))}
          </div>
        </DbListToolbar>

        <div className="px-8 flex-1 min-h-0 overflow-y-auto">
          {schemaTriggers.length === 0 ? (
            <div className="flex-1 flex flex-col justify-start supabase-theme">
              <EmptyStatePresentational
                icon={Zap}
                title={readOnlyTriggers ? `No triggers in ${selectedSchema}` : "Add your first trigger"}
                description={
                  readOnlyTriggers
                    ? isOracle
                      ? "Oracle triggers in this schema are browsable here; trigger writes are read-only for now."
                      : "SQL Server DML triggers on tables in this schema will appear here."
                    : "Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in."
                }
              >
                {!readOnlyTriggers && onOpenCreateTriggerTab && (
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
                    <Button onClick={onOpenCreateTriggerTab} variant="outline" size="sm">
                      <Plus className="w-3.5 h-3.5" />
                      New trigger
                    </Button>
                  </div>
                )}
              </EmptyStatePresentational>
            </div>
          ) : (
            <div className="pb-8">
              <DataTable<TriggerRow>
                data={filteredTriggers}
                columns={columns}
                getRowId={(t) => t.id || `${t.schema}.${t.name}`}
                pagination={{
                  page,
                  pageSize: 10,
                  onPageChange: setPage,
                  itemLabel: "triggers",
                }}
                isRowClickable={() => !readOnlyTriggers}
                onRowClick={(t) => {
                  if (!readOnlyTriggers) onEditTrigger?.(t as Trigger);
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
        </div>
      </DbListPage>
    </>
  );
}
