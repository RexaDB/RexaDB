"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Plus, Search, Trash2, Layers, Database } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
import { DbTableLink } from "./db-list-layout";
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
  onOpenTable?: (table: string, schema: string) => void;
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
  onOpenTable,
  schemas,
  selectedSchema,
  onSchemaChange,
}: IndexesListProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema]);

  const columns: TableColumn<Index>[] = useMemo(
    () => [
      {
        key: "table",
        header: "Table",
        sortable: true,
        width: "1fr",
        cell: (idx) =>
          onOpenTable ? (
            <DbTableLink table={idx.table_name} schema={idx.schema} onOpen={onOpenTable} />
          ) : (
            <p className="truncate" title={idx.table_name}>
              {idx.table_name}
            </p>
          ),
        sortValue: (idx) => idx.table_name,
      },
      {
        key: "columns",
        header: "Columns",
        width: "1.2fr",
        cell: (idx) => (
          <p className="truncate text-muted-foreground" title={idx.columns.join(", ")}>
            {idx.columns.join(", ")}
          </p>
        ),
        sortValue: (idx) => idx.columns.join(", "),
      },
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: "1fr",
        cell: (idx) => (
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium" title={idx.name}>
              {idx.name}
            </span>
            {idx.is_unique ? (
              <Badge variant="info" className="shrink-0">
                Unique
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "11rem",
        cell: (idx) => (
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
        ),
      },
    ],
    [onDeleteIndex, onViewDefinition, onOpenTable],
  );

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
            className="pl-9 h-7 bg-background border-border text-xs"
          />
        </div>
        {onOpenCreateIndexTab && (
          <Button
            onClick={onOpenCreateIndexTab}
            variant="outline"
            size="sm"
            className="ml-auto grow lg:grow-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Create index
          </Button>
        )}
      </div>

      <div className="px-8 flex-1 min-h-0 overflow-y-auto">
        {sortedIndexes.length === 0 && search.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start supabase-theme">
            <EmptyStatePresentational
              icon={Database}
              title="No indexes created yet"
              description={`There are no indexes found in the schema "${selectedSchema}"`}
            >
              {onOpenCreateIndexTab && (
                <Button onClick={onOpenCreateIndexTab} variant="outline" size="sm">
                  <Plus className="w-3.5 h-3.5" />
                  Create index
                </Button>
              )}
            </EmptyStatePresentational>
          </div>
        ) : (
          <div className="pb-8">
            <DataTable<Index>
              data={sortedIndexes}
              columns={columns}
              getRowId={(idx) => `${idx.schema}.${idx.name}`}
              pagination={{
                page,
                pageSize: 10,
                onPageChange: setPage,
                itemLabel: "indexes",
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
    </div>
  );
}
