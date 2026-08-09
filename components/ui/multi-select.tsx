"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Database, Search, X } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  emptyText = "No options",
  loading = false,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(
    () =>
      options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      ),
    [options, search],
  );

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const selectAll = () => {
    const next = new Set(selected);
    for (const o of filtered) next.add(o.value);
    onChange(next);
  };

  const deselectAll = () => onChange(new Set());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 text-sm justify-between w-full", className)}
        >
          <span className="truncate">
            {selected.size === 0
              ? placeholder
              : `${selected.size} table${selected.size !== 1 ? "s" : ""} selected`}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="ml-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-xs text-muted-foreground">
          <span>
            {selected.size} of {options.length} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="hover:text-foreground transition-colors"
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className="hover:text-foreground transition-colors"
            >
              Deselect All
            </button>
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-4 w-4 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            <div className="p-1">
              {filtered.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded-lg hover:bg-accent cursor-pointer"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
