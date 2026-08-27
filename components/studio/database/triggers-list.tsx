"use client";

import { Zap, Search, Check, X, MoreVertical, Edit2, Copy, Trash2, Plus } from "@/lib/icon-theme/lucide-react";
import { useState, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

interface Trigger {
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
  onAskAI?: () => void;
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
  onAskAI,
}: TriggersListProps) {
  const [search, setSearch] = useState("");
  const [viewingDefinition, setViewingDefinition] = useState<Trigger | null>(null);

  const schemaTriggers = triggers.filter((t) => t.schema === selectedSchema);

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
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            Database Triggers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in.
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
              <Input
                placeholder="Search for a trigger"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 bg-background border-border text-xs pr-9"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
            </div>
            {tables.length > 0 && (
              <SelectFilter
                label="Table"
                options={tables.map((type) => ({ label: type, value: type }))}
                value={tablesFilter}
                onChange={setTablesFilter}
                showSearch
              />
            )}
          </div>
          <div className="flex items-center gap-2">

            {onOpenCreateTriggerTab && (
              <>
              <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={onAskAI}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/ai-agent.png" alt="" width={20} height={20} className="rounded-[3px] object-cover dark:invert" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
              </Tooltip>
              </TooltipProvider>
              <Button
                onClick={onOpenCreateTriggerTab}
                variant="default"
                className="ml-auto grow"
              >
                <Plus className="w-3.5 h-3.5" />
                New trigger
              </Button>
              </>)}
          </div>
        </div>

        <div className="px-8 flex-1 overflow-hidden flex flex-col">
          {schemaTriggers.length === 0 ? (
            <div className="flex-1 flex flex-col justify-start supabase-theme">
              <EmptyStatePresentational
                icon={Zap}
                title="Add your first trigger"
                description="Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in."
              >
                {onOpenCreateTriggerTab && (
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" onClick={onAskAI}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/ai-agent.png" alt="" width={20} height={20} className="rounded-[3px] object-cover dark:invert" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Create with RexaDB Assistant</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button onClick={onOpenCreateTriggerTab} variant="default">
                      <Plus className="w-3.5 h-3.5" />
                      New trigger
                    </Button>
                  </div>
                )}
              </EmptyStatePresentational>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden flex-1 flex flex-col supabase-theme">
              <DatabaseTable>
                <DatabaseTableHeader>
                  <DatabaseTableRow>
                    <DatabaseTableHead key="name">Name</DatabaseTableHead>
                    <DatabaseTableHead key="table">Table</DatabaseTableHead>
                    <DatabaseTableHead key="function">Function</DatabaseTableHead>
                    <DatabaseTableHead key="events">Events</DatabaseTableHead>
                    <DatabaseTableHead key="orientation">Orientation</DatabaseTableHead>
                    <DatabaseTableHead key="enabled" className="w-20">Enabled</DatabaseTableHead>
                    <DatabaseTableHead key="buttons" className="w-1/12" />
                  </DatabaseTableRow>
                </DatabaseTableHeader>
                <DatabaseTableBody>
                  {filteredTriggers.length === 0 && search.length > 0 && (
                    <DatabaseTableRow>
                      <DatabaseTableCell colSpan={7}>
                        <p className="text-sm text-foreground">No results found</p>
                        <p className="text-sm text-muted-foreground">
                          Your search for &ldquo;{search}&rdquo; did not return any results
                        </p>
                      </DatabaseTableCell>
                    </DatabaseTableRow>
                  )}
                {filteredTriggers.map((t, i) => (
                  <DatabaseTableRow key={t.id || `${t.schema}.${t.name}-${i}`}>
                      <DatabaseTableCell className="space-x-2">
                        <Button
                          variant="ghost"
                          className="text-sm font-medium p-0 hover:bg-transparent h-auto text-primary hover:text-primary/80 text-left"
                          onClick={() => onEditTrigger?.(t)}
                          title={t.name}
                        >
                          {t.name}
                        </Button>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <p className="truncate text-muted-foreground max-w-40" title={t.table}>
                          {t.table}
                        </p>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        {t.function_name ? (
                          <p className="truncate text-muted-foreground max-w-40" title={t.function_name}>
                            {t.function_name}
                          </p>
                        ) : (
                          <p className="truncate text-muted-foreground">-</p>
                        )}
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <div className="flex gap-2 flex-wrap">
                          {(t.events ?? []).map((event) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {t.activation} {event}
                            </Badge>
                          ))}
                        </div>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <p className="truncate text-muted-foreground" title={t.orientation}>
                          {t.orientation}
                        </p>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <div className="flex items-center justify-center">
                          {t.enabled_mode !== "DISABLED" ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <X className="w-4 h-4 text-muted-foreground/40" />
                          )}
                        </div>
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
                                onClick={() => onEditTrigger?.(t)}
                              >
                                <Edit2 size={14} />
                                <p>Edit trigger</p>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="space-x-2"
                                onClick={() => onDuplicateTrigger?.(t)}
                              >
                                <Copy size={14} />
                                <p>Duplicate trigger</p>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="space-x-2"
                                onClick={() => onDeleteTrigger?.(t)}
                              >
                                <Trash2 size={14} />
                                <p>Delete trigger</p>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </DatabaseTableCell>
                    </DatabaseTableRow>
                  ))}
                </DatabaseTableBody>
              </DatabaseTable>
            </div>
          )}
          <div className="h-8" />
        </div>
      </div>
    </>
  );
}
