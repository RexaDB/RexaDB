"use client";

import React, { useState, useMemo } from "react";
import { Plus, Search, Trash2, Layers, Database } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { EmptyStatePresentational } from "./empty-state-presentational";
import { Skeleton } from "@/components/ui/skeleton";

interface Index {
  schema: string;
  table_name: string;
  name: string;
  columns: string[];
  definition: string;
  is_unique: boolean;
}

interface IndexesListProps {
  indexes: Index[];
  fetchingIndexes?: boolean;
  onDeleteIndex: (schema: string, name: string) => void;
  onViewDefinition: (index: Index) => void;
  onOpenCreateIndexTab?: () => void;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

export function IndexesList({
  indexes,
  fetchingIndexes,
  onDeleteIndex,
  onViewDefinition,
  onOpenCreateIndexTab,
  schemas,
  selectedSchema,
  onSchemaChange,
}: IndexesListProps) {
  const [search, setSearch] = useState("");

  const sortedIndexes = useMemo(() => {
    const filtered = indexes.filter((idx) => {
      const matchesSchema =
        selectedSchema === "all" ||
        selectedSchema === "" ||
        idx.schema === selectedSchema;
      const matchesSearch =
        !search ||
        idx.name.toLowerCase().includes(search.toLowerCase()) ||
        idx.table_name.toLowerCase().includes(search.toLowerCase());
      return matchesSchema && matchesSearch;
    });
    return filtered.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [indexes, search, selectedSchema]);

  if (fetchingIndexes && indexes.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="px-8 pb-4 flex items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-52 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md ml-auto" />
        </div>
        <div className="px-8 flex-1 overflow-hidden flex flex-col">
          <div className="rounded-lg border border-border overflow-hidden flex-1 flex flex-col">
            <div className="border-b border-border px-4 py-3 grid grid-cols-[1fr_1fr_1fr_80px] gap-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-4 ml-auto" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-border px-4 py-4 grid grid-cols-[1fr_1fr_1fr_80px] gap-4 items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-28" />
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-7 w-24 rounded-md" />
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
          Database Indexes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Improve query performance against your database
        </p>
      </div>

      <div className="px-8 pb-4 flex items-center gap-2 flex-wrap">
        <SchemaDropdown
          schemas={schemas}
          selectedSchema={selectedSchema}
          onSchemaChange={onSchemaChange}
          showAllOption={false}
        />
        <div className="relative w-full lg:w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            placeholder="Search for an index"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 bg-background border-border text-xs"
          />
        </div>
        {onOpenCreateIndexTab && (
          <Button
            onClick={onOpenCreateIndexTab}
            variant="default"
            className="ml-auto grow lg:grow-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Create index
          </Button>
        )}
      </div>

      <div className="px-8 flex-1 overflow-hidden flex flex-col">
        {sortedIndexes.length === 0 && search.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start supabase-theme">
            <EmptyStatePresentational
              icon={Database}
              title="No indexes created yet"
              description={`There are no indexes found in the schema "${selectedSchema}"`}
            >
              {onOpenCreateIndexTab && (
                <Button onClick={onOpenCreateIndexTab} variant="default">
                  <Plus className="w-3.5 h-3.5" />
                  Create index
                </Button>
              )}
            </EmptyStatePresentational>
          </div>
        ) : (
          <div className="w-full overflow-hidden flex-1 flex flex-col">
            <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden flex-1 flex flex-col supabase-theme">
              <DatabaseTable className="table-fixed">
                <DatabaseTableHeader>
                  <DatabaseTableRow>
                    <DatabaseTableHead className="w-[20%]">Table</DatabaseTableHead>
                    <DatabaseTableHead className="w-[35%]">Columns</DatabaseTableHead>
                    <DatabaseTableHead className="w-[25%]">Name</DatabaseTableHead>
                    <DatabaseTableHead className="w-[20%]" />
                  </DatabaseTableRow>
                </DatabaseTableHeader>
                <DatabaseTableBody>
                  {sortedIndexes.length === 0 && search.length > 0 && (
                    <DatabaseTableRow>
                      <DatabaseTableCell colSpan={4}>
                        <p className="text-sm text-foreground">No results found</p>
                        <p className="text-sm text-muted-foreground">
                          Your search for &ldquo;{search}&rdquo; did not return any results
                        </p>
                      </DatabaseTableCell>
                    </DatabaseTableRow>
                  )}
                  {sortedIndexes.map((idx) => (
                    <DatabaseTableRow key={`${idx.schema}.${idx.name}`}>
                      <DatabaseTableCell>
                        <p className="truncate" title={idx.table_name}>
                          {idx.table_name}
                        </p>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <p className="truncate text-muted-foreground" title={idx.columns.join(", ")}>
                          {idx.columns.join(", ")}
                        </p>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <p className="truncate font-medium" title={idx.name}>
                          {idx.name}
                        </p>
                      </DatabaseTableCell>
                      <DatabaseTableCell>
                        <div className="flex justify-end items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onViewDefinition(idx)}
                          >
                            View definition
                          </Button>
                          <TooltipProvider><Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Delete index"
                                onClick={() => onDeleteIndex(idx.schema, idx.name)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Delete index</TooltipContent>
                          </Tooltip></TooltipProvider>
                        </div>
                      </DatabaseTableCell>
                    </DatabaseTableRow>
                  ))}
                </DatabaseTableBody>
              </DatabaseTable>
            </div>
          </div>
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}
