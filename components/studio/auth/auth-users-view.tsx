"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Columns2,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { runQuery } from "@/lib/api/actions-client";
import { AuthDataGrid } from "./auth-data-grid";
import { AuthSortDropdown } from "./auth-sort-dropdown";
import { AuthAddUserDropdown } from "./auth-add-user-dropdown";
import { useAuthUsers } from "@/hooks/use-auth-users";
import { useToggleRowSelection } from "@/hooks/use-selection-utils";
import {
  PHONE_NUMBER_LEFT_PREFIX_REGEX,
  SEARCH_COLUMN_OPTIONS,
  SEARCH_PLACEHOLDERS,
  SpecificFilterColumn,
  UUIDV4_LEFT_PREFIX_REGEX,
} from "./users-constants";

interface AuthUsersViewProps {
  connectionString: string;
  enabled: boolean;
}

interface ColumnDef {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { name: "UID", type: "uuid", isPrimaryKey: true },
  { name: "Display name", type: "text" },
  { name: "Email", type: "text" },
  { name: "Phone", type: "text" },
  { name: "Providers", type: "text" },
  { name: "Provider type", type: "text" },
  { name: "Created at", type: "text" },
  { name: "Last sign in at", type: "text" },
];

const TOGGLEABLE_COLUMNS = [
  "Display name",
  "Email",
  "Phone",
  "Providers",
  "Provider type",
  "Created at",
  "Last sign in at",
];

function getSortValue(row: any, column: string): string | null {
  if (column === "created_at") return row.__created_at_raw ?? null;
  if (column === "last_sign_in_at") return row.__last_sign_in_at_raw ?? null;
  if (column === "id") return row.UID ?? null;
  return row[column] ?? null;
}

function isSearchInvalid(search: string, filterColumn: SpecificFilterColumn): boolean {
  if (!search || filterColumn === "freeform" || filterColumn === "email" || filterColumn === "name") {
    return false;
  }
  if (filterColumn === "id") return !UUIDV4_LEFT_PREFIX_REGEX.test(search);
  return !PHONE_NUMBER_LEFT_PREFIX_REGEX.test(search);
}

export function AuthUsersView({ connectionString, enabled }: AuthUsersViewProps) {
  const { users, loading, error, refresh } = useAuthUsers(connectionString, enabled);
  const [filterColumn, setFilterColumn] = useState<SpecificFilterColumn>("email");
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "ASC" | "DESC";
  }>({ column: "created_at", direction: "DESC" });
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(TOGGLEABLE_COLUMNS));
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const columns = useMemo(
    () => ALL_COLUMNS.filter((column) => column.name === "UID" || visibleColumns.has(column.name)),
    [visibleColumns],
  );

  const sortedUsers = useMemo(() => {
    const direction = sortConfig.direction === "ASC" ? 1 : -1;
    return [...users].sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.column);
      const bValue = getSortValue(b, sortConfig.column);
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      const cmp = String(aValue).localeCompare(String(bValue), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return cmp === 0 ? 0 : cmp * direction;
    });
  }, [users, sortConfig]);

  const searchTerm = search.trim().toLowerCase();
  const searchInvalid = isSearchInvalid(search, filterColumn);
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return sortedUsers;
    const matches = (value: string | null | undefined) =>
      value != null && String(value).toLowerCase().includes(searchTerm);
    return sortedUsers.filter((row) => {
      if (filterColumn === "email") return matches(row.Email);
      if (filterColumn === "phone") return matches(row.Phone);
      if (filterColumn === "id") return matches(row.UID);
      if (filterColumn === "name") return matches(row["Display name"]);
      return (
        matches(row.Email) ||
        matches(row.Phone) ||
        matches(row.UID) ||
        matches(row["Display name"])
      );
    });
  }, [sortedUsers, searchTerm, filterColumn]);

  const toggleAllSelection = useCallback(() => {
    setSelectedRows((prev) =>
      prev.size === filteredUsers.length ? new Set() : new Set(filteredUsers.map((_, i) => i)),
    );
  }, [filteredUsers]);

  const toggleRowSelection = useToggleRowSelection(setSelectedRows);

  const handleDeleteUsers = async () => {
    const ids = Array.from(selectedRows)
      .map((index) => filteredUsers[index]?.UID)
      .filter(Boolean) as string[];
    if (!ids.length) {
      setDeleteOpen(false);
      return;
    }
    setDeleting(true);
    const escapedIds = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(", ");
    const res = await runQuery(connectionString, `delete from auth.users where id in (${escapedIds});`);
    setDeleting(false);
    setDeleteOpen(false);
    if (!res.success) {
      toast.error(`Failed to delete users: ${res.error || "unknown error"}`);
      return;
    }
    toast.success(`Deleted ${ids.length} user${ids.length === 1 ? "" : "s"}`);
    setSelectedRows(new Set());
    await refresh();
  };

  if (!enabled) {
    return <div className="p-6 text-sm text-muted-foreground">Auth schema not available for this connection.</div>;
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="border-b border-studio-border bg-studio-header-bg py-3 px-4 md:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        {selectedRows.size > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {selectedRows.size} users
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setSelectedRows(new Set())}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex h-[26px] items-stretch overflow-hidden rounded-md border bg-studio-header-bg ${searchInvalid ? "border-red-900" : "border-studio-border"}`}
            >
              <div className="flex items-center px-1.5">
                <Search className="h-3.5 w-3.5 text-studio-cell-muted" />
              </div>
              <div className="w-px bg-studio-border" />
              <Select value={filterColumn} onValueChange={(value) => setFilterColumn(value as SpecificFilterColumn)}>
                <SelectTrigger
                  className={`h-[26px]! w-[130px] rounded-none border-0 bg-transparent! pt-0! pb-[2px]! text-xs ${filterColumn === "freeform" ? "text-warning" : ""}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-40">
                  {SEARCH_COLUMN_OPTIONS.map((option) =>
                    option.value === "freeform" ? (
                      <TooltipProvider key={option.value}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SelectItem value={option.value}>{option.label}</SelectItem>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="w-64 text-center">
                            Search by all columns at once, including mid-string search. May impact
                            database performance if you have many users.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <div className="w-px bg-studio-border" />
              <div className="relative">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={SEARCH_PLACEHOLDERS[filterColumn]}
                  className={`h-[26px]! w-[245px] -translate-y-px rounded-none border-0 bg-transparent! pt-0! pb-[2px]! pr-7! text-xs ${searchInvalid ? "text-red-900" : ""}`}
                />
                {search ? (
                  <button
                    onClick={() => setSearch("")}
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 hover:text-foreground ${searchInvalid ? "text-red-900" : "text-muted-foreground"}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            <AuthSortDropdown
              specificFilterColumn={search.trim() && filterColumn !== "freeform" ? filterColumn : "freeform"}
              sortColumn={sortConfig.column}
              sortDirection={sortConfig.direction}
              onSortChange={(column, direction) => setSortConfig({ column, direction })}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns2 className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {TOGGLEABLE_COLUMNS.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column}
                    checked={visibleColumns.has(column)}
                    onCheckedChange={(checked) => {
                      const next = new Set(visibleColumns);
                      if (checked) next.add(column);
                      else next.delete(column);
                      setVisibleColumns(next);
                    }}
                  >
                    {column}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" onClick={refresh} disabled={loading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <AuthAddUserDropdown connectionString={connectionString} onUsersChanged={refresh} />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-studio-cell-muted" />
          </div>
        ) : error && users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-y-2 h-full">
            <h2 className="text-sm font-semibold text-foreground">Failed to retrieve users</h2>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-y-2 py-16">
            <Users className="h-10 w-10 text-studio-cell-muted" strokeWidth={1} />
            <h2 className="text-sm font-semibold text-foreground">
              {search.trim() ? "No users found" : "No users in your project"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {search.trim()
                ? "There are currently no users based on the filters applied"
                : "There are currently no users who signed up to your project"}
            </p>
          </div>
        ) : (
          <AuthDataGrid
            rows={filteredUsers}
            columns={columns}
            loading={false}
            error={null}
            search=""
            selectedTable="auth.users"
            selectedSchema="auth"
            idKey="UID"
            selectedRows={selectedRows}
            setSelectedRows={setSelectedRows}
            toggleAllSelection={toggleAllSelection}
            toggleRowSelection={toggleRowSelection}
          />
        )}
      </div>
      <div className="flex items-center justify-between h-9 border-t border-studio-border bg-studio-bg px-6 text-xs text-muted-foreground">
        {loading || error ? <span>Loading...</span> : <span>Total: {users.length} users</span>}
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedRows.size} user{selectedRows.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The users will be permanently removed from auth.users
              and their sessions will be invalidated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteUsers();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
