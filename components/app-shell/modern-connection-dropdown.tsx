"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Plus } from "@/lib/icon-theme/lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderLogo } from "@/components/shared/provider-logo";
import { getConnections } from "@/lib/api/actions-client";
import { apiFetch } from "@/lib/api-base";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import type { Connection } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type CurrentConnection = {
  id: number;
  name: string;
  connectionType?: string | null;
  connectionString?: string;
};

/**
 * Compact connection switcher for the Modern UI title bar (left of search).
 * Keeps the menu open while testing/navigating so switching feels continuous.
 *
 * Pass `onSelectConnection` for surfaces that should switch locally only
 * (e.g. the Agents window) without navigating the main studio.
 */
export function ModernConnectionDropdown({
  connection,
  onSelectConnection,
}: {
  connection?: CurrentConnection | null;
  onSelectConnection?: (conn: Connection) => void | Promise<void>;
}) {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingToId, setSwitchingToId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConnections()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setConnections(list);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connection?.id]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Stay open while a connection is testing / navigating.
      if (!open && switchingToId != null) return;
      setMenuOpen(open);
    },
    [switchingToId],
  );

  const shouldTestConnection = useCallback((conn: Connection) => {
    const type = detectConnectionDbType(conn.connectionString);
    return (
      type !== "sqlite" &&
      type !== "redis" &&
      type !== "mssql" &&
      type !== "federated"
    );
  }, []);

  const testConnection = useCallback(async (connectionString: string) => {
    try {
      const res = await apiFetch(`/api/connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString }),
      });
      return await res.json();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error || "Connection check failed.");
      return { success: false, error: message };
    }
  }, []);

  const switchTo = useCallback(
    async (conn: Connection) => {
      if (!connection || conn.id === connection.id) return;
      if (switchingToId != null) return;

      setSwitchingToId(conn.id);
      setMenuOpen(true);

      if (shouldTestConnection(conn)) {
        const res = await testConnection(conn.connectionString);
        if (!res.success) {
          setSwitchingToId(null);
          toast.error(res.error ?? "Connection failed.");
          return;
        }
        toast.success("Connection successful.");
      }

      if (onSelectConnection) {
        try {
          await onSelectConnection(conn);
        } finally {
          setSwitchingToId(null);
          setMenuOpen(false);
        }
        return;
      }

      // Keep spinner until navigation unmounts this header.
      router.push(`/studio/${conn.id}`);
    },
    [
      connection,
      onSelectConnection,
      router,
      shouldTestConnection,
      switchingToId,
      testConnection,
    ],
  );

  if (!connection) return null;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Switch connection"
          className={cn(
            "group flex h-6 max-w-[160px] select-none items-center gap-1.5 rounded-sm border border-border/70 bg-sidebar px-2 text-[11px] leading-none text-muted-foreground transition-colors",
            "hover:border-border hover:text-foreground",
            "outline-none",
            "data-[state=open]:border-border data-[state=open]:text-foreground",
          )}
        >
          <ProviderLogo
            type={connection.connectionType}
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium select-none">
            {connection.name}
          </span>
          {switchingToId != null ? (
            <Loader2 className="size-3 shrink-0 animate-spin opacity-70" />
          ) : (
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-56 border-border bg-[var(--shell-content-bg)]"
      >
        <DropdownMenuLabel className="text-[10px] font-medium tracking-wide text-muted-foreground">
          Connections
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {connections.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No connections
          </div>
        ) : (
          connections.map((conn) => {
            const isCurrent = conn.id === connection.id;
            const isSwitching = switchingToId === conn.id;
            return (
              <DropdownMenuItem
                key={conn.id}
                className="gap-2 text-xs"
                disabled={switchingToId != null && !isSwitching}
                onSelect={(e) => {
                  // Prevent Radix from auto-closing while we navigate / load.
                  if (!isCurrent) e.preventDefault();
                  void switchTo(conn);
                }}
              >
                <ProviderLogo
                  type={conn.connectionType}
                  className="size-3.5 shrink-0"
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    isCurrent && "font-medium text-foreground",
                  )}
                >
                  {conn.name}
                </span>
                {isSwitching ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : isCurrent ? (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-xs text-muted-foreground"
          disabled={switchingToId != null}
          onSelect={() => router.push("/")}
        >
          <Plus className="size-3.5" />
          <span>New connection</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
