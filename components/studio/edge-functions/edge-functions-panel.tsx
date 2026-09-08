"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getTabIcon } from "@/lib/studio/tab-registry";
import {
  EdgeFunctionsIcon,
  KeyRound,
  RefreshCw,
} from "@/lib/icon-theme/lucide-react";
import {
  listEdgeFunctions,
  resolveEdgeAccess,
  type EdgeAccess,
  type EdgeFunction,
} from "@/lib/studio/edge-functions-utils";

const ROW =
  "flex h-8 w-full select-none items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

/**
 * Edge Functions sidebar section for Supabase projects (supabase-mgmt and
 * direct Postgres-to-Supabase connections). Functions lists deployed
 * functions; Secrets opens secret management; each function opens its tab.
 */
export function EdgeFunctionsPanel({ studio }: { studio: any }) {
  const [functions, setFunctions] = useState<EdgeFunction[]>([]);
  const [access, setAccess] = useState<EdgeAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const connectionType: string | undefined =
    studio.connection?.connectionType ?? studio.dbType;
  const connectionString: string | undefined =
    studio.currentConnectionString || studio.connection?.connectionString;

  const loadFunctions = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    const { access: resolved, error: accessError } =
      await resolveEdgeAccess(connectionType, connectionString);
    if (!resolved) {
      setFunctions([]);
      setAccess(null);
      setLoadError(accessError ?? null);
      setLoading(false);
      return;
    }
    setAccess(resolved);
    const { functions: list, error } = await listEdgeFunctions(resolved);
    setFunctions(list);
    setLoadError(error ?? null);
    if (error) console.warn("[edge-functions] failed to list:", error);
    setLoading(false);
  }, [connectionString, connectionType]);

  useEffect(() => {
    void loadFunctions();
  }, [loadFunctions]);

  const navItems: Array<{ label: string; tabType: string; fn?: () => void; icon: React.ReactNode }> = [
    {
      label: "Functions",
      tabType: "edge-functions",
      fn: studio.openEdgeFunctionsTab,
      icon: <EdgeFunctionsIcon className="size-4 shrink-0" />,
    },
    {
      label: "Secrets",
      tabType: "edge-secrets",
      fn: studio.openEdgeSecretsTab,
      icon: <KeyRound className="size-4 shrink-0" />,
    },
  ];

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {navItems.map((i) => {
        const Icon = getTabIcon(i.tabType);
        return (
          <button
            key={i.tabType}
            type="button"
            onClick={() => i.fn?.()}
            className={ROW}
          >
            {i.icon ?? (Icon ? <Icon className="size-4 shrink-0" /> : null)}
            <span>{i.label}</span>
          </button>
        );
      })}

      <div className="mt-2 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Functions
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Refresh functions"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
            onClick={() => void loadFunctions()}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {loadError ? (
        <div
          className="mx-0.5 mt-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
          title={loadError}
        >
          Failed to load functions:{" "}
          <span className="break-words">{loadError}</span>
        </div>
      ) : functions.length === 0 && !loading ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          No functions
        </div>
      ) : (
        functions.map((f) => (
          <button
            key={f.slug}
            type="button"
            onClick={() => studio.openEdgeFunctionTab?.(f.slug)}
            title={f.slug}
            className={cn(
              ROW,
              studio.activeTabId?.includes(`edge-function-${f.slug}`) &&
                "bg-white/10 text-foreground",
            )}
          >
            <EdgeFunctionsIcon className="size-4 shrink-0" />
            <span className="truncate">{f.slug}</span>
          </button>
        ))
      )}
    </div>
  );
}

