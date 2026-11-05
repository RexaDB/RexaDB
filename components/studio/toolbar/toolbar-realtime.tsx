"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2 } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/hooks/use-confirm";
import { useTableRealtime, type TableRealtimeStatus } from "@/hooks/use-table-realtime";
import { getNeonManagementPointer } from "@/lib/studio/neon-management";
import {
  disableRealtime,
  enableRealtime,
  getRealtimeState,
  rotateRealtimeSecret,
  type NeonRealtimeState,
} from "@/lib/neon-cli/client";
import { supabaseTableRealtime, type SupabaseTableRealtimeStatus } from "@/lib/realtime/client";
import { REALTIME_ERROR, realtimeProviderFor } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

export interface ToolbarRealtimeProps {
  /** The connection's stored string (neon-cli:// or supabase-mgmt:// pointer). */
  connectionString?: string | null;
  schema: string;
  table: string | null;
  tableStructure?: any[];
  /** Row-level security on the table; Neon's Realtime beta rejects such tables. */
  rlsEnabled?: boolean;
  /** The grid's applied filter, sort and window, mirrored by the Neon watch. */
  filter: string;
  sort: { column: string; direction: "ASC" | "DESC" } | null;
  limit: number;
  offset: number;
  refreshCurrentTab: () => void;
}

const POLL_MS = 3000;

const NEON_RLS_UNSUPPORTED =
  "Neon Realtime (beta) doesn't support tables with row-level security yet. Use Auto-refresh instead.";

const STATUS_LABEL: Record<TableRealtimeStatus, string> = {
  off: "Off",
  connecting: "Connecting…",
  live: "Live",
  stale: "Reconnecting…",
  error: "Stopped",
};

const STATUS_DOT: Record<TableRealtimeStatus, string> = {
  off: "bg-muted-foreground/40",
  connecting: "bg-amber-400 animate-pulse",
  live: "bg-emerald-500",
  stale: "bg-amber-400 animate-pulse",
  error: "bg-destructive",
};

/** Live grid updates plus the provider's Realtime switches, for Neon and
 *  Supabase management connections. Renders nothing for other connections. */
export function ToolbarRealtime(props: ToolbarRealtimeProps) {
  const provider = realtimeProviderFor(props.connectionString);
  if (!provider || !props.table || !props.connectionString) return null;
  return <RealtimeControl {...props} connectionString={props.connectionString} table={props.table} provider={provider} />;
}

function RealtimeControl({
  connectionString,
  schema,
  table,
  tableStructure,
  rlsEnabled,
  filter,
  sort,
  limit,
  offset,
  refreshCurrentTab,
  provider,
}: ToolbarRealtimeProps & { connectionString: string; table: string; provider: "neon" | "supabase" }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [neonState, setNeonState] = useState<NeonRealtimeState | null>(null);
  const [supabaseState, setSupabaseState] = useState<SupabaseTableRealtimeStatus | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const pointer = useMemo(
    () => (provider === "neon" ? getNeonManagementPointer(connectionString) : null),
    [provider, connectionString],
  );

  const primaryKey = useMemo(
    () =>
      (tableStructure ?? [])
        .filter((c: any) => c?.is_primary_key === true || c?.is_primary_key === "t")
        .map((c: any) => String(c.column_name ?? c.name)),
    [tableStructure],
  );

  const { status, error, retry } = useTableRealtime({
    enabled: live,
    connectionString,
    schema,
    table,
    primaryKey,
    filter,
    sort,
    limit,
    offset,
    onChange: refreshCurrentTab,
  });

  // Live is per table: switching tables starts with it off.
  useEffect(() => setLive(false), [connectionString, schema, table]);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      if (pointer) {
        setNeonState(await getRealtimeState(pointer.profile, pointer.projectId, pointer.branchId));
      } else if (provider === "supabase") {
        setSupabaseState(await supabaseTableRealtime(connectionString, schema, table));
      }
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e));
    }
  }, [pointer, provider, connectionString, schema, table]);

  useEffect(() => {
    if (open) void loadSettings();
  }, [open, loadSettings]);

  // Neon applies Realtime changes asynchronously; poll while one is pending.
  useEffect(() => {
    if (!open || !pointer || !neonState?.pending) return;
    const timer = setTimeout(() => void loadSettings(), POLL_MS);
    return () => clearTimeout(timer);
  }, [open, pointer, neonState, loadSettings]);

  // A watch that failed because Realtime was still provisioning retries once ready.
  useEffect(() => {
    if (live && error?.code === REALTIME_ERROR.pending && neonState?.enabled && !neonState.pending) retry();
  }, [live, error, neonState, retry]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await loadSettings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableNeon() {
    if (!pointer) return;
    const ok = await confirm({
      title: "Enable Neon Realtime?",
      description:
        "This permanently sets wal_level to logical for the whole project and restarts every compute on all branches, dropping active connections. Disabling Realtime later does not turn logical replication off.",
      confirmText: "Enable Realtime",
    });
    if (!ok) return;
    await run(
      () => enableRealtime(pointer.profile, pointer.projectId, pointer.branchId),
      "Realtime is being enabled on this branch.",
    );
  }

  async function handleDisableNeon() {
    if (!pointer) return;
    const ok = await confirm({
      title: "Disable Neon Realtime?",
      description: "Live queries on this branch stop and the shared secret is discarded.",
      confirmText: "Disable",
      variant: "destructive",
    });
    if (!ok) return;
    setLive(false);
    await run(() => disableRealtime(pointer.profile, pointer.projectId, pointer.branchId), "Realtime disabled.");
  }

  async function handleRotateNeon() {
    if (!pointer) return;
    const ok = await confirm({
      title: "Rotate the Realtime secret?",
      description: "Apps sealing queries with the current NEON_REALTIME_SECRET must be updated once rotation finishes.",
      confirmText: "Rotate",
    });
    if (!ok) return;
    await run(
      () => rotateRealtimeSecret(pointer.profile, pointer.projectId, pointer.branchId),
      "Secret rotation requested.",
    );
  }

  async function setSupabase(changes: { published?: boolean; fullReplicaIdentity?: boolean }) {
    await run(async () => {
      setSupabaseState(await supabaseTableRealtime(connectionString, schema, table, changes));
    });
    if (changes.published === false) setLive(false);
    if (changes.published && live && error?.code === REALTIME_ERROR.notPublished) retry();
  }

  const neonReady = Boolean(neonState?.enabled && !neonState.pending);
  const canGoLive = provider === "supabase" ? Boolean(supabaseState?.published) : neonReady;
  const noPk = provider === "neon" && primaryKey.length === 0;
  const neonRls = provider === "neon" && rlsEnabled === true;
  const liveBlockedReason = neonRls
    ? NEON_RLS_UNSUPPORTED
    : noPk
      ? "Needs a primary key"
      : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="font-normal dark:border-white/15 dark:bg-white/[0.02]"
          title={error ? error.message : `Realtime: ${STATUS_LABEL[status]}`}
        >
          <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
          <Activity className="w-3.5 h-3.5" />
          Realtime
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 rounded-xl p-3 shadow-2xl">
        <div className="space-y-3 text-xs">
          <div>
            <p className="text-sm font-medium">{provider === "neon" ? "Neon Realtime" : "Supabase Realtime"}</p>
            <p className="mt-1 text-muted-foreground">
              {provider === "neon"
                ? "Live queries for this branch. The grid watches the rows it is showing, with its filter and sort."
                : "Streams inserts, updates and deletes for tables in the supabase_realtime publication."}
            </p>
          </div>

          {settingsError && <p className="break-words text-destructive">{settingsError}</p>}

          {provider === "neon" ? (
            <div className="space-y-2 rounded-lg border border-border/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Branch</span>
                <span className="font-medium">
                  {!neonState ? "…" : neonState.pending ? "Applying…" : neonState.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              {neonState?.invocation_url && (
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={neonState.invocation_url}>
                  {neonState.invocation_url}
                </p>
              )}
              <div className="flex gap-2">
                {neonState?.enabled ? (
                  <>
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={busy || neonState.pending} onClick={() => void handleRotateNeon()}>
                      Rotate secret
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-xs text-destructive" disabled={busy || neonState.pending} onClick={() => void handleDisableNeon()}>
                      Disable
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="h-7 flex-1 text-xs" disabled={busy || !neonState || neonState.pending} onClick={() => void handleEnableNeon()}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Enable Realtime
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-border/60 p-2">
              <label className="flex items-center justify-between gap-2">
                <span>
                  <span className="block">Publish changes</span>
                  <span className="text-muted-foreground">Add to supabase_realtime</span>
                </span>
                <Switch
                  checked={Boolean(supabaseState?.published)}
                  disabled={busy || !supabaseState}
                  onCheckedChange={(v) => void setSupabase({ published: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>
                  <span className="block">Include old values</span>
                  <span className="text-muted-foreground">REPLICA IDENTITY FULL</span>
                </span>
                <Switch
                  checked={Boolean(supabaseState?.fullReplicaIdentity)}
                  disabled={busy || !supabaseState}
                  onCheckedChange={(v) => void setSupabase({ fullReplicaIdentity: v })}
                />
              </label>
            </div>
          )}

          <label className="flex items-center justify-between gap-2">
            <span>
              <span className="block">Live updates</span>
              <span className="text-muted-foreground">
                {liveBlockedReason ?? `Refresh the grid on change · ${STATUS_LABEL[status]}`}
              </span>
            </span>
            <Switch checked={live} disabled={!live && (!canGoLive || liveBlockedReason !== null)} onCheckedChange={setLive} />
          </label>

          {error && (
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words text-destructive">{error.message}</p>
              <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-xs" onClick={retry}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
