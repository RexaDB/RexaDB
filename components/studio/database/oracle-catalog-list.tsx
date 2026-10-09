"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
import { SchemaDropdown } from "./schema-dropdown";
import { EmptyStatePresentational } from "./empty-state-presentational";
import { Skeleton } from "@/components/ui/skeleton";

export type OracleCatalogRow = Record<string, any> & {
  schema?: string;
  name: string;
};

type ColumnDef = {
  key: string;
  header: string;
  width?: string;
  render?: (row: OracleCatalogRow) => React.ReactNode;
};

interface OracleCatalogListProps {
  title: string;
  description: string;
  rows: OracleCatalogRow[];
  loading?: boolean;
  columns: ColumnDef[];
  schemas?: string[];
  selectedSchema?: string;
  onSchemaChange?: (schema: string) => void;
  showSchemaFilter?: boolean;
  searchPlaceholder?: string;
  onViewDefinition?: (row: OracleCatalogRow) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function OracleCatalogList({
  title,
  description,
  rows,
  loading,
  columns,
  schemas = [],
  selectedSchema = "",
  onSchemaChange,
  showSchemaFilter = true,
  searchPlaceholder = "Search…",
  onViewDefinition,
  emptyTitle = "No objects found",
  emptyDescription = "Nothing matched this schema.",
}: OracleCatalogListProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return rows
      .filter((row) => {
        const matchesSchema =
          !showSchemaFilter ||
          selectedSchema === "all" ||
          selectedSchema === "" ||
          String(row.schema || "").toUpperCase() ===
            String(selectedSchema || "").toUpperCase();
        const hay = JSON.stringify(row).toLowerCase();
        const matchesSearch = !search || hay.includes(search.toLowerCase());
        return matchesSchema && matchesSearch;
      })
      .sort((a, b) =>
        String(a.name || "")
          .toLowerCase()
          .localeCompare(String(b.name || "").toLowerCase()),
      );
  }, [rows, search, selectedSchema, showSchemaFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema]);

  const tableColumns: TableColumn<OracleCatalogRow>[] = useMemo(() => {
    const cols: TableColumn<OracleCatalogRow>[] = columns.map((c) => ({
      key: c.key,
      header: c.header,
      width: c.width || "1fr",
      sortable: true,
      cell: (row) =>
        c.render ? (
          c.render(row)
        ) : (
          <p className="truncate" title={String(row[c.key] ?? "")}>
            {String(row[c.key] ?? "")}
          </p>
        ),
      sortValue: (row) => String(row[c.key] ?? ""),
    }));
    if (onViewDefinition) {
      cols.push({
        key: "actions",
        header: "",
        align: "right",
        width: "10rem",
        cell: (row) => (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewDefinition(row)}
            >
              View
            </Button>
          </div>
        ),
      });
    }
    return cols;
  }, [columns, onViewDefinition]);

  if (loading && rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden p-8 gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="px-8 pb-4 flex items-center gap-2 flex-wrap">
        {showSchemaFilter && onSchemaChange ? (
          <SchemaDropdown
            schemas={schemas}
            selectedSchema={selectedSchema}
            onSchemaChange={onSchemaChange}
            showAllOption={false}
          />
        ) : null}
        <div className="relative w-full lg:w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-7 bg-background border-border text-xs"
          />
        </div>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length}
        </Badge>
      </div>

      <div className="px-8 flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyStatePresentational
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <div className="pb-8">
            <DataTable
              columns={tableColumns}
              data={filtered}
              getRowId={(row) =>
                `${row.schema || "x"}:${row.name}:${row.table_name || ""}`
              }
              pagination={{
                page,
                pageSize: 25,
                onPageChange: setPage,
                itemLabel: "objects",
              }}
              emptyState={
                <div className="py-8 text-center">
                  <p className="text-sm text-foreground">{emptyTitle}</p>
                  <p className="text-sm text-muted-foreground">{emptyDescription}</p>
                </div>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
