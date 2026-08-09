"use client";

import { ArrowDownNarrowWide, ArrowDownWideNarrow } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SORT_OPTIONS } from "./users-constants";

interface AuthSortDropdownProps {
  specificFilterColumn: string;
  sortColumn: string;
  sortDirection: "ASC" | "DESC";
  onSortChange: (column: string, direction: "ASC" | "DESC") => void;
}

export function AuthSortDropdown({
  specificFilterColumn,
  sortColumn,
  sortDirection,
  onSortChange,
}: AuthSortDropdownProps) {
  const disabled = specificFilterColumn !== "freeform";

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={-1}>
              <Button variant="outline" size="sm" disabled>
                <ArrowDownNarrowWide className="h-3.5 w-3.5" />
                Sorted by user ID
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-80 text-center">
            Sorting cannot be changed when searching on a specific column. If you&apos;d like to
            sort on other columns, change the search to{" "}
            <span className="text-warning">unified search</span> from the search dropdown.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const label =
    sortColumn === "id" ? "user ID" : sortColumn.replaceAll("_", " ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {sortDirection === "DESC" ? (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownNarrowWide className="h-3.5 w-3.5" />
          )}
          Sorted by {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={`${sortColumn}:${sortDirection.toLowerCase()}`}
          onValueChange={(value) => {
            const [column, direction] = value.split(":");
            onSortChange(column, direction.toUpperCase() as "ASC" | "DESC");
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuSub key={option.column}>
              <DropdownMenuSubTrigger>{option.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioItem value={`${option.column}:asc`}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={`${option.column}:desc`}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
