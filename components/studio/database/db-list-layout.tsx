"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DatabaseTableCell,
  DatabaseTableRow,
} from "@/components/studio/database/database-table";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import { SchemaDropdown } from "@/components/studio/database/schema-dropdown";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function DbListPage({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">{children}</div>;
}

export function DbListHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8 pb-4">
      <h1 className="text-sm font-semibold text-foreground tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  );
}

export function DbListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="px-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-wrap">
      {children}
    </div>
  );
}

export function DbToolbarFilters({ children }: { children: ReactNode }) {
  return <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">{children}</div>;
}

export function DbSchemaFilter({
  schemas,
  selectedSchema,
  onSchemaChange,
}: {
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}) {
  return (
    <SchemaDropdown
      schemas={schemas}
      selectedSchema={selectedSchema}
      onSchemaChange={onSchemaChange}
      showAllOption={false}
    />
  );
}

export function DbSearchInput({
  value,
  onChange,
  placeholder,
  icon = "left",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: "left" | "right";
}) {
  if (icon === "right") {
    return (
      <div className="relative w-full lg:w-52">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 bg-background border-border text-xs pr-9"
        />
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
      </div>
    );
  }
  return (
    <div className="relative w-full lg:w-52">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 h-8 bg-background border-border text-xs"
      />
    </div>
  );
}

export function DbCreateButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Button onClick={onClick} variant="default" className="ml-auto grow">
        <Plus className="w-3.5 h-3.5" />
        {children}
      </Button>
    </div>
  );
}

export function DbListSkeleton({ columns, headerWidths = [] }: { columns: string; headerWidths?: string[] }) {
  return (
    <div className="px-8 flex-1 overflow-hidden flex flex-col">
      <div className="rounded-lg border border-border overflow-hidden flex-1 flex flex-col">
        <div className={`border-b border-border px-4 py-3 grid ${columns} gap-4`}>
          {(headerWidths.length > 0 ? headerWidths : ["w-12"]).map((w, i) => (
            <Skeleton key={i} className={`h-4 ${w}`} />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`border-b border-border px-4 py-4 grid ${columns} gap-4 items-center`}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <div className="flex justify-end">
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DbListEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: any;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col justify-start supabase-theme">
      <EmptyStatePresentational icon={icon} title={title} description={description}>
        <Button onClick={onAction} variant="default">
          <Plus className="w-3.5 h-3.5" />
          {actionLabel}
        </Button>
      </EmptyStatePresentational>
    </div>
  );
}

export function DbNoResultsRow({ colSpan, search }: { colSpan: number; search: string }) {
  return (
    <DatabaseTableRow>
      <DatabaseTableCell colSpan={colSpan}>
        <p className="text-sm text-foreground">No results found</p>
        <p className="text-sm text-muted-foreground">
          Your search for &ldquo;{search}&rdquo; did not return any results
        </p>
      </DatabaseTableCell>
    </DatabaseTableRow>
  );
}

export function DbCardTable({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden flex-1 flex flex-col supabase-theme">
      {children}
    </div>
  );
}
