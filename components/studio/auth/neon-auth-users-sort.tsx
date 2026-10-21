import { ArrowUpDown, Check } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortState } from "@/components/data-table/components/data-table";

const options: Array<{ label: string; sort: SortState }> = [
  { label: "Created · newest first", sort: { key: "__created_at_raw", direction: "desc" } },
  { label: "Created · oldest first", sort: { key: "__created_at_raw", direction: "asc" } },
  { label: "User · A to Z", sort: { key: "Display name", direction: "asc" } },
  { label: "User · Z to A", sort: { key: "Display name", direction: "desc" } },
  { label: "Status · verified first", sort: { key: "__confirmed", direction: "desc" } },
  { label: "Status · unverified first", sort: { key: "__confirmed", direction: "asc" } },
  { label: "Sign-in method · A to Z", sort: { key: "Providers", direction: "asc" } },
  { label: "Sign-in method · Z to A", sort: { key: "Providers", direction: "desc" } },
];

interface NeonAuthUsersSortProps {
  sort: SortState | null;
  onSortChange: (sort: SortState) => void;
}

export function NeonAuthUsersSort({ sort, onSortChange }: NeonAuthUsersSortProps) {
  const label = sort?.key === "Display name" ? "User" : sort?.key === "__confirmed" ? "Status" : sort?.key === "Providers" ? "Sign-in method" : "Created";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 border-border bg-studio-bg px-2.5 text-xs font-normal">
          <ArrowUpDown className="size-3.5" />
          Sort: {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => {
          const selected = sort !== null && sort.key === option.sort.key && sort.direction === option.sort.direction;
          return (
            <DropdownMenuItem key={option.label} onSelect={() => onSortChange(option.sort)}>
              {selected ? <Check className="size-3.5" /> : <span className="size-3.5" />}
              {option.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
