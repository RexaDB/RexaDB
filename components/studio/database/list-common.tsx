"use client";

import React from "react";
import { Search, MoreVertical } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SchemaDropdown } from "./schema-dropdown";

interface DatabaseSearchInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function DatabaseSearchInput({
  placeholder,
  value,
  onChange,
}: DatabaseSearchInputProps) {
  return (
    <div className="relative flex-1 max-w-sm group">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 h-9 bg-background border-border focus-visible:ring-primary/50 text-xs placeholder:text-muted-foreground/30 shadow-sm"
      />
    </div>
  );
}

interface TableActionMenuProps {
  children: React.ReactNode;
}

export function TableActionMenu({ children }: TableActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted/40"
        >
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[160px] bg-popover border-border text-foreground shadow-2xl"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ListLoadingProps {
  icon: React.ReactNode;
  text: string;
}

export function ListLoading({ icon, text }: ListLoadingProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-studio-bg">
      <div className="flex flex-col items-center gap-2">
        {icon}
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

interface DatabaseListHeaderProps {
  title: string;
  description: string;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
  searchPlaceholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  actionLabel: string;
  onAction: () => void;
  actionIcon?: React.ReactNode;
}

export function DatabaseListHeader({
  title,
  description,
  schemas,
  selectedSchema,
  onSchemaChange,
  searchPlaceholder,
  search,
  onSearchChange,
  actionLabel,
  onAction,
  actionIcon,
}: DatabaseListHeaderProps) {
  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <div className="px-8 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <SchemaDropdown
            schemas={schemas}
            selectedSchema={selectedSchema}
            onSchemaChange={onSchemaChange}
          />
          <DatabaseSearchInput
            placeholder={searchPlaceholder}
            value={search}
            onChange={onSearchChange}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onAction}
            className="bg-primary hover:bg-primary/90 h-9 text-xs flex items-center gap-2 px-4 transition-all"
          >
            {actionIcon}
            <span>{actionLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ListEmptyProps {
  icon: React.ReactNode;
  title: string;
  searchMessage: string;
  emptyMessage: string;
  searchQuery?: string;
}

export function ListEmpty({
  icon,
  title,
  searchMessage,
  emptyMessage,
  searchQuery,
}: ListEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {icon}
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
        {searchQuery ? searchMessage : emptyMessage}
      </p>
    </div>
  );
}
