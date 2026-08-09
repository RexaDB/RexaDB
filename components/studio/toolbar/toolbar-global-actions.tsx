import { useState, useEffect } from "react";
import { Plus, RefreshCw, Check, ChevronDown, Unlock } from "@/lib/icon-theme/solar-icons";
import { Button } from "@/components/ui/button";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import type {
  SupabaseAuthUserOption,
  TablePermissionContext,
} from "@/lib/studio/table-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarPermissionFilter } from "./toolbar-permission-filter";

interface ToolbarGlobalActionsProps {
  setIsInsertSheetOpen: (open: boolean) => void;
  selectedTable: string | null;
  refreshCurrentTab: () => void;
  loading: boolean;
  fetchingStructure: boolean;
  onOpenRlsPolicies: () => void;
  dbType?: ConnectionDbType;
  rlsEnabled?: boolean;
  rlsPolicyCount?: number;
  permissionContext: TablePermissionContext;
  onPermissionContextChange: (value: TablePermissionContext) => void;
  postgresRoles: string[];
  supabaseAuthUsers: SupabaseAuthUserOption[];
  loadingPermissionOptions?: boolean;
  connectionString?: string;
}

const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "5 seconds", value: 5000 },
  { label: "10 seconds", value: 10000 },
  { label: "30 seconds", value: 30000 },
  { label: "1 minute", value: 60000 },
  { label: "5 minutes", value: 300000 },
];

export function ToolbarGlobalActions({
  setIsInsertSheetOpen,
  selectedTable,
  refreshCurrentTab,
  loading,
  fetchingStructure,
  onOpenRlsPolicies,
  dbType,
  rlsEnabled,
  rlsPolicyCount,
  permissionContext,
  onPermissionContextChange,
  postgresRoles,
  supabaseAuthUsers,
  loadingPermissionOptions = false,
  connectionString,
}: ToolbarGlobalActionsProps) {
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const previewOnly = Boolean(permissionContext);

  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(() => {
        refreshCurrentTab();
      }, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refreshCurrentTab]);

  return (
    <>
      {dbType !== "spacetimedb" && (
        <Button
          variant="outline"
          size="sm"
          className="font-normal"
          onClick={() => setIsInsertSheetOpen(true)}
          disabled={previewOnly}
        >
          <Plus className="w-3.5 h-3.5" />
          Insert
        </Button>
      )}

      {(dbType === "postgres" || dbType === "supabase-mgmt") && (
        <Button
          variant="outline"
          size="sm"
          className={`font-normal ${rlsEnabled === false ? "text-red-500 hover:text-red-500" : ""}`}
          onClick={onOpenRlsPolicies}
          disabled={!selectedTable}
        >
          {rlsEnabled === false ? (
            <>
              <Unlock className="w-3.5 h-3.5 text-red-500" />
              RLS Disabled
            </>
          ) : (
            <>
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-lg text-xs bg-muted text-foreground/80 border border-studio-border">
                {Number.isFinite(rlsPolicyCount) ? rlsPolicyCount : "—"}
              </span>
              RLS Policies
            </>
          )}
        </Button>
      )}

      {(dbType === "postgres" || dbType === "supabase-mgmt") && (
        <ToolbarPermissionFilter
          value={permissionContext}
          onValueChange={onPermissionContextChange}
          postgresRoles={postgresRoles}
          supabaseAuthUsers={supabaseAuthUsers}
          loading={loadingPermissionOptions}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            className="rounded-r-none font-normal"
            onClick={() => refreshCurrentTab()}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading || fetchingStructure ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="-ml-px rounded-l-none border-l-0 border-transparent px-1 font-normal"
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                Auto-refresh
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {REFRESH_INTERVALS.map((interval) => (
                <DropdownMenuItem
                  key={interval.value}
                  className="text-xs flex items-center justify-between"
                  onClick={() => setRefreshInterval(interval.value)}
                >
                  {interval.label}
                  {refreshInterval === interval.value && (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}
