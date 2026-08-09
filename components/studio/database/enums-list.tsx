"use client";

import { List, Plus, Edit2, Trash2, Search, MoreVertical } from "@/lib/icon-theme/lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { EmptyStatePresentational } from "./empty-state-presentational";
import { Skeleton } from "@/components/ui/skeleton";
import { SchemaDropdown } from "./schema-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EnumType {
  id: string;
  schema: string;
  name: string;
  values: string[];
}

interface EnumsListProps {
  enums: EnumType[];
  fetchingEnums: boolean;
  onOpenCreateEnumTab: () => void;
  onOpenEditEnumTab: (schema: string, enumName: string, values: string[]) => void;
  onDeleteEnum: (schema: string, enumName: string) => void;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

export function EnumsList({
  enums,
  fetchingEnums,
  onOpenCreateEnumTab,
  onOpenEditEnumTab,
  onDeleteEnum,
  schemas,
  selectedSchema,
  onSchemaChange,
}: EnumsListProps) {
  const [search, setSearch] = useState("");

  const enumeratedTypes = (enums ?? []).filter((type) => type.values.length > 0);

  const filteredEnums =
    search.length > 0
      ? enumeratedTypes.filter(
          (x) => x.schema === selectedSchema && x.name.toLowerCase().includes(search.toLowerCase())
        )
      : enumeratedTypes.filter((x) => x.schema === selectedSchema);

  if (fetchingEnums && enums.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-60" />
        </div>
        <div className="px-8 pb-4 flex items-center gap-2 flex-wrap">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-52 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md ml-auto" />
        </div>
        <div className="px-8 flex-1 overflow-hidden flex flex-col">
          <div className="rounded-lg border border-border overflow-hidden flex-1 flex flex-col">
            <div className="border-b border-border px-4 py-3 grid grid-cols-[1fr_1fr_1fr_80px] gap-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-4 ml-auto" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-border px-4 py-4 grid grid-cols-[1fr_1fr_1fr_80px] gap-4 items-center">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
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
          Database Enumerated Types
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Custom data types that you can use in your database tables or functions
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
              placeholder="Search for a type"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 bg-background border-border text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">

          <Button
            onClick={onOpenCreateEnumTab}
            variant="default"
            className="ml-auto grow"
          >
            <Plus className="w-3.5 h-3.5" />
            Create type
          </Button>
        </div>
      </div>

      <div className="px-8 flex-1 overflow-hidden flex flex-col">
        {filteredEnums.length === 0 && search.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start supabase-theme">
            <EmptyStatePresentational
              icon={List}
              title="No enumerated types created yet"
              description={`There are no enumerated types found in the schema "${selectedSchema}"`}
            >
              <Button onClick={onOpenCreateEnumTab} variant="default">
                <Plus className="w-3.5 h-3.5" />
                Create type
              </Button>
            </EmptyStatePresentational>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden flex-1 flex flex-col supabase-theme">
            <DatabaseTable>
              <DatabaseTableHeader>
                <DatabaseTableRow>
                  <DatabaseTableHead key="schema">Schema</DatabaseTableHead>
                  <DatabaseTableHead key="name">Name</DatabaseTableHead>
                  <DatabaseTableHead key="values">Values</DatabaseTableHead>
                  <DatabaseTableHead key="actions" />
                </DatabaseTableRow>
              </DatabaseTableHeader>
              <DatabaseTableBody>
                {filteredEnums.length === 0 && search.length > 0 && (
                  <DatabaseTableRow>
                    <DatabaseTableCell colSpan={4}>
                      <p className="text-sm text-foreground">No results found</p>
                      <p className="text-sm text-muted-foreground">
                        Your search for &ldquo;{search}&rdquo; did not return any results
                      </p>
                    </DatabaseTableCell>
                  </DatabaseTableRow>
                )}
                {filteredEnums.map((enumType) => (
                  <DatabaseTableRow key={`${enumType.schema}.${enumType.name}`}>
                    <DatabaseTableCell className="w-20">
                      <p className="w-20 truncate text-muted-foreground">{enumType.schema}</p>
                    </DatabaseTableCell>
                    <DatabaseTableCell className="font-medium">{enumType.name}</DatabaseTableCell>
                    <DatabaseTableCell className="text-muted-foreground">{enumType.values.join(", ")}</DatabaseTableCell>
                    <DatabaseTableCell>
                      <div className="flex justify-end items-center space-x-2">
                        <DropdownMenu>
                          <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  aria-label={`${enumType.name} actions`}
                                >
                                  <MoreVertical />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">More options</TooltipContent>
                          </Tooltip>
                          </TooltipProvider>
                          <DropdownMenuContent side="bottom" align="end" className="w-32">
                            <DropdownMenuItem
                              className="space-x-2"
                              onClick={() =>
                                onOpenEditEnumTab(
                                  enumType.schema,
                                  enumType.name,
                                  enumType.values,
                                )
                              }
                            >
                              <Edit2 size={14} />
                              <p>Update type</p>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="space-x-2"
                              onClick={() => onDeleteEnum(enumType.schema, enumType.name)}
                            >
                              <Trash2 size={14} />
                              <p>Delete type</p>
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
  );
}
