import { useState, useEffect } from "react";
import { Plus, RefreshCw, Check, ChevronDown } from "@/lib/icon-theme/solar-icons";
import { Lock } from "@/lib/icon-theme/lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToolbarPermissionFilter } from "./toolbar-permission-filter";

interface ToolbarGlobalActionsProps {
  setIsInsertSheetOpen: (open: boolean) => void;
  selectedTable: string | null;
  refreshCurrentTab: () => void;
  loading: boolean;
  fetchingStructure: boolean;
  onOpenRlsPolicies: () => void;
  onEnableRls?: () => Promise<void> | void;
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
  onEnableRls,
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
  const [rlsPopoverOpen, setRlsPopoverOpen] = useState(false);
  const [enablingRls, setEnablingRls] = useState(false);
  const previewOnly = Boolean(permissionContext);

  const handleEnableRls = async () => {
    if (!onEnableRls || enablingRls) return;
    setEnablingRls(true);
    try {
      await onEnableRls();
      setRlsPopoverOpen(false);
    } catch {
      // parent surfaces the error via toast
    } finally {
      setEnablingRls(false);
    }
  };

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
          className="font-normal dark:border-white/15 dark:bg-white/[0.02]"
          onClick={() => setIsInsertSheetOpen(true)}
          disabled={previewOnly}
        >
          <Plus className="w-3.5 h-3.5" />
          Insert
        </Button>
      )}

      {(dbType === "postgres" || dbType === "supabase-mgmt") && (
        <>
          {rlsEnabled === false ? (
            <Popover open={rlsPopoverOpen} onOpenChange={setRlsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  disabled={!selectedTable}
                  title="Row Level Security is disabled on this table — click to enable it"
                  className="font-normal border-destructive/25 bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive dark:border-destructive/30 dark:bg-destructive/20 dark:hover:bg-destructive/30"
                >
                  <Lock className="w-3.5 h-3.5" />
                  RLS off
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-72 rounded-xl p-3 shadow-2xl"
              >
                <div className="flex items-start gap-2.5">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Enable Row Level Security
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      Restricts read and write access to{" "}
                      {selectedTable ? `"${selectedTable}"` : "this table"} to
                      the policies you define.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnableRls}
                  disabled={enablingRls || !selectedTable || previewOnly}
                  title={previewOnly ? "Disabled while previewing as a role or user" : undefined}
                  className="mt-3 h-7 w-full rounded-lg px-3 text-xs font-normal"
                >
                  {enablingRls ? "Enabling…" : "Enable RLS"}
                </Button>
              </PopoverContent>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="font-normal dark:border-white/15 dark:bg-white/[0.02]"
              onClick={onOpenRlsPolicies}
              disabled={!selectedTable}
            >
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-lg text-xs bg-muted text-foreground/80 border border-studio-border">
                {Number.isFinite(rlsPolicyCount) ? rlsPolicyCount : "—"}
              </span>
              RLS Policies
            </Button>
          )}
        </>
      )}

      {(dbType === "postgres" || dbType === "supabase-mgmt") && (
        <ToolbarPermissionFilter
          value={permissionContext}
          onValueChange={onPermissionContextChange}
          postgresRoles={postgresRoles}
          supabaseAuthUsers={supabaseAuthUsers}
          loading={loadingPermissionOptions}
          dbType={dbType}
        />
      )}

      <div className="flex items-center gap-2">
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            className="rounded-r-none font-normal dark:border-white/15 dark:bg-white/[0.02]"
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
                className="-ml-px rounded-l-none border-l-0 dark:border-white/15 dark:bg-white/[0.02] px-1 font-normal"
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
