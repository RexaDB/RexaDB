import { ToolbarSelectionActions } from "./toolbar/toolbar-selection-actions";
import { ToolbarFilterSort } from "./toolbar/toolbar-filter-sort";
import { ToolbarGlobalActions } from "./toolbar/toolbar-global-actions";
import { Search, ChevronDown } from "@/lib/icon-theme/solar-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutTable01Icon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import type {
  SupabaseAuthUserOption,
  TablePermissionContext,
} from "@/lib/studio/table-permissions";

interface DataTableToolbarProps {
  selectedRows: Set<number>;
  setSelectedRows: (rows: Set<number>) => void;
  exportData: (format: "json" | "csv" | "sql") => void;
  copyData: (format: "json" | "csv" | "sql") => void;
  handleDeleteRows: () => void;
  isDeleting: boolean;
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  sortConfig: Array<{ column: string; direction: "ASC" | "DESC" }>;
  setSortConfig: (
    config: Array<{ column: string; direction: "ASC" | "DESC" }>,
  ) => void;
  refreshTableData: (
    table: string,
    schema: string,
    filter: string,
    sort: Array<{ column: string; direction: "ASC" | "DESC" }>,
  ) => void;
  refreshCurrentTab: () => void;
  selectedTable: string | null;
  selectedSchema: string;
  results: any;
  setIsInsertSheetOpen: (open: boolean) => void;
  loading: boolean;
  fetchingStructure: boolean;
  onOpenRlsPolicies: () => void;
  globalSearchQuery: string;
  setGlobalSearchQuery: (query: string) => void;
  globalSearchScope: "page" | "table";
  setGlobalSearchScope: (scope: "page" | "table") => void;
  supportsWholeTableSearch?: boolean;
  dbType?: ConnectionDbType;
  rlsEnabled?: boolean;
  rlsPolicyCount?: number;
  permissionContext: TablePermissionContext;
  setPermissionContext: (value: TablePermissionContext) => void;
  postgresRoles: string[];
  supabaseAuthUsers: SupabaseAuthUserOption[];
  loadingPermissionOptions?: boolean;
  isPermissionPreview?: boolean;
  hiddenColumns?: string[];
  onToggleColumn?: (columnName: string) => void;
  onShowAllColumns?: () => void;
  tableStructure?: any[];
  connectionString?: string;
}

export function DataTableToolbar(props: DataTableToolbarProps) {
  const { selectedRows } = props;

  const SearchInputWithScope = (
    <div className="relative w-[280px] group/search-scope">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
      <Input
        value={props.globalSearchQuery}
        onChange={(e) => props.setGlobalSearchQuery(e.target.value)}
        placeholder="Search all values..."
        className="h-7 pl-7 pr-8 text-xs bg-background border-border"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search scope"
            className="absolute right-1 top-1/2 -translate-y-1/2 border-0 bg-transparent shadow-none hover:bg-transparent active:bg-transparent opacity-0 group-hover/search-scope:opacity-100 focus:opacity-100"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel className="text-xs tracking-wider text-muted-foreground/70">
            Search Scope
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.globalSearchScope}
            onValueChange={(value) => {
              if (value === "page" || value === "table") {
                props.setGlobalSearchScope(value);
              }
            }}
          >
            <DropdownMenuRadioItem value="page" className="text-xs">
              This page
            </DropdownMenuRadioItem>
            {props.supportsWholeTableSearch !== false && (
              <DropdownMenuRadioItem value="table" className="text-xs">
                Whole table
              </DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const columnList = props.tableStructure?.length
    ? props.tableStructure.map((c: any) => ({ name: c.column_name || c.name }))
    : (props.results?.fields ?? []);

  const toolbarGlobalActions = (
    <ToolbarGlobalActions
      setIsInsertSheetOpen={props.setIsInsertSheetOpen}
      selectedTable={props.selectedTable}
      refreshCurrentTab={props.refreshCurrentTab}
      loading={props.loading}
      fetchingStructure={props.fetchingStructure}
      onOpenRlsPolicies={props.onOpenRlsPolicies}
      dbType={props.dbType}
      rlsEnabled={props.rlsEnabled}
      rlsPolicyCount={props.rlsPolicyCount}
      permissionContext={props.permissionContext}
      onPermissionContextChange={props.setPermissionContext}
      postgresRoles={props.postgresRoles}
      supabaseAuthUsers={props.supabaseAuthUsers}
      loadingPermissionOptions={props.loadingPermissionOptions}
      connectionString={props.connectionString}
    />
  );

  const ColumnsDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="font-normal">
          <HugeiconsIcon icon={LayoutTable01Icon} className="w-3.5 h-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs tracking-wider text-muted-foreground/70">
          Visible Columns
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columnList.map((col: any) => (
          <DropdownMenuCheckboxItem
            key={col.name}
            checked={!props.hiddenColumns?.includes(col.name)}
            onCheckedChange={() => props.onToggleColumn?.(col.name)}
            className="text-xs"
          >
            {col.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <button
          onClick={() => props.onShowAllColumns?.()}
          className="w-full px-2 py-1.5 text-xs text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors rounded-lg"
        >
          Show all columns
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="relative border-b border-studio-border bg-studio-bg h-12 shrink-0 overflow-hidden">
      {/* Default State */}
      <div
        className={cn(
          "flex items-center px-4 h-full w-full transition-all duration-300 ease-in-out absolute inset-0 gap-2",
          selectedRows.size > 0
            ? "-translate-y-full opacity-0 pointer-events-none"
            : "translate-y-0 opacity-100",
        )}
      >
        {SearchInputWithScope}
        <div className="ml-auto flex items-center gap-2">
          <ToolbarFilterSort
            filterQuery={props.filterQuery}
            setFilterQuery={props.setFilterQuery}
            sortConfig={props.sortConfig}
            setSortConfig={props.setSortConfig}
            refreshTableData={props.refreshTableData}
            selectedTable={props.selectedTable}
            selectedSchema={props.selectedSchema}
            results={props.results}
            dbType={props.dbType}
            globalSearchQuery={props.globalSearchQuery}
            setGlobalSearchQuery={props.setGlobalSearchQuery}
            setGlobalSearchScope={props.setGlobalSearchScope}
          />
          {ColumnsDropdown}
          {toolbarGlobalActions}
        </div>
      </div>

      {/* Selection State */}
      <div
        className={cn(
          "flex items-center px-4 h-full w-full transition-all duration-300 ease-in-out absolute inset-0 gap-2",
          selectedRows.size > 0
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <ToolbarSelectionActions
          selectedRows={props.selectedRows}
          setSelectedRows={props.setSelectedRows}
          exportData={props.exportData}
          copyData={props.copyData}
          handleDeleteRows={props.handleDeleteRows}
          isDeleting={props.isDeleting}
          deleteDisabled={props.isPermissionPreview}
        />

        <div className="ml-auto flex items-center gap-2">
          {SearchInputWithScope}
          {ColumnsDropdown}
          {toolbarGlobalActions}
        </div>
      </div>
    </div>
  );
}
