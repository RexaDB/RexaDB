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
                  className="font-normal border-transparent bg-[#b54444] text-white hover:bg-[#a53c3c] hover:text-white dark:bg-[#b54444] dark:hover:bg-[#a53c3c]"
                >
                  <Lock className="w-3.5 h-3.5 text-white" />
                  RLS disabled
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-[380px] rounded-2xl border-white/10 bg-[#1c1c1e] p-5 text-white shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-5 h-5 text-white" />
                  <p className="text-lg font-medium text-white">
                    Row Level Security (RLS)
                  </p>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-white/70">
                  You can restrict and control who can read, write and update
                  data in this table using Row Level Security.
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-white/70">
                  With RLS enabled, anonymous users will not be able to
                  read/write data in the table.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnableRls}
                  disabled={enablingRls || !selectedTable || previewOnly}
                  title={previewOnly ? "Disabled while previewing as a role or user" : undefined}
                  className="mt-5 h-9 rounded-xl border-white/15 bg-white/[0.04] px-4 text-[15px] font-normal text-white hover:bg-white/10 hover:text-white dark:border-white/15 dark:bg-white/[0.04] dark:hover:bg-white/10"
                >
                  {enablingRls ? "Enabling…" : "Enable RLS for this table"}
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

      <div className="ml-auto flex items-center gap-2">
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
