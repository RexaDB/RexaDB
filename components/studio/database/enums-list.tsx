"use client";

import { List, Edit2, Trash2, MoreVertical } from "@/lib/icon-theme/lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DbCreateButton,
  DbListEmptyState,
  DbListHeader,
  DbListPage,
  DbListToolbar,
  DbSchemaFilter,
  DbSearchInput,
  DbToolbarFilters,
} from "./db-list-layout";

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
  const [page, setPage] = useState(1);

  const enumeratedTypes = (enums ?? []).filter((type) => type.values.length > 0);

  const filteredEnums =
    search.length > 0
      ? enumeratedTypes.filter(
          (x) => x.schema === selectedSchema && x.name.toLowerCase().includes(search.toLowerCase())
        )
      : enumeratedTypes.filter((x) => x.schema === selectedSchema);

  useEffect(() => {
    setPage(1);
  }, [search, selectedSchema]);

  const columns: TableColumn<EnumType>[] = useMemo(
    () => [
      {
        key: "schema",
        header: "Schema",
        sortable: true,
        width: "0.6fr",
        cell: (enumType) => (
          <p className="w-20 truncate text-muted-foreground">{enumType.schema}</p>
        ),
      },
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: "1fr",
        cell: (enumType) => (
          <span className="block truncate font-medium" title={enumType.name}>
            {enumType.name}
          </span>
        ),
      },
      {
        key: "values",
        header: "Values",
        width: "1.6fr",
        cell: (enumType) => (
          <span
            className="block truncate text-muted-foreground"
            title={enumType.values.join(", ")}
          >
            {enumType.values.join(", ")}
          </span>
        ),
        sortValue: (enumType) => enumType.values.join(", "),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "3rem",
        cell: (enumType) => (
          <div className="flex justify-end items-center space-x-2">
            <DropdownMenu>
              <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
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
        ),
      },
    ],
    [onDeleteEnum, onOpenEditEnumTab],
  );

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
    <DbListPage>
      <DbListHeader
        title="Database Enumerated Types"
        description="Custom data types that you can use in your database tables or functions"
      />

      <DbListToolbar>
        <DbToolbarFilters>
          <DbSchemaFilter schemas={schemas} selectedSchema={selectedSchema} onSchemaChange={onSchemaChange} />
          <DbSearchInput value={search} onChange={setSearch} placeholder="Search for a type" />
        </DbToolbarFilters>
        <DbCreateButton onClick={onOpenCreateEnumTab}>Create type</DbCreateButton>
      </DbListToolbar>

      <div className="px-8 flex-1 min-h-0 overflow-y-auto">
        {filteredEnums.length === 0 && search.length === 0 ? (
          <DbListEmptyState
            icon={List}
            title="No enumerated types created yet"
            description={`There are no enumerated types found in the schema "${selectedSchema}"`}
            actionLabel="Create type"
            onAction={onOpenCreateEnumTab}
          />
        ) : (
          <div className="pb-8">
            <DataTable<EnumType>
              data={filteredEnums}
              columns={columns}
              getRowId={(enumType) => `${enumType.schema}.${enumType.name}`}
              pagination={{
                page,
                pageSize: 10,
                onPageChange: setPage,
                itemLabel: "types",
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
  );
}
