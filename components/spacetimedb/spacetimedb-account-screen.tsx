"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listSpacetimeDbDatabases,
  type SpacetimeDbCloudDatabase,
} from "@/lib/spacetimedb-mgmt/client";
import type { SpacetimeDbMgmtAccount } from "@/lib/spacetimedb-mgmt/token-store";
import { buildSpacetimeDbConnectionString } from "@/lib/spacetimedb-mgmt/register";
import { registerSpacetimeDbDatabases } from "@/lib/spacetimedb-mgmt/register";
import { toast } from "sonner";
import {
  LogOut,
  Database,
  Plus,
  Search,
  Download,
  RefreshCw,
  Loader2,
  Fingerprint,
  Server,
} from "@/lib/icon-theme/lucide-react";
import { SpacetimeDbLogo } from "@/components/shared/provider-logo";

interface SpacetimeDbAccountsScreenProps {
  accounts: SpacetimeDbMgmtAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onAddAccount: () => void;
  canAddAccount: boolean;
  existingConnectionStrings: string[];
  maxConnections: number | null;
  onConnectDatabase: (
    payload: {
      name: string;
      connectionString: string;
      connectionType: string;
    },
    opts?: { silent?: boolean },
  ) => Promise<{ success: boolean }>;
}

function formatIdentity(identity: string | null | undefined): string {
  const id = identity || "unknown";
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

export function SpacetimeDbAccountsScreen({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  canAddAccount,
  existingConnectionStrings,
  maxConnections,
  onConnectDatabase,
}: SpacetimeDbAccountsScreenProps) {
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<SpacetimeDbCloudDatabase[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) ?? null;

  const loadDatabases = useCallback(async () => {
    const account = accounts.find((a) => a.id === activeAccountId);
    if (!account) {
      setDatabases([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listSpacetimeDbDatabases(account.token, account.host);
      setDatabases(result);
    } catch (err) {
      setDatabases([]);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Failed to load databases for this account.",
      );
    } finally {
      setLoading(false);
    }
  }, [accounts, activeAccountId]);

  useEffect(() => {
    if (activeAccount) void loadDatabases();
  }, [activeAccount, loadDatabases]);

  const displayName = (database: SpacetimeDbCloudDatabase): string =>
    database.names[0] ?? database.identity;

  const filteredDatabases = databases.filter((db) => {
    const q = search.toLowerCase();
    return (
      db.names.some((n) => n.toLowerCase().includes(q)) ||
      db.identity.toLowerCase().includes(q)
    );
  });

  const handleConnect = async (database: SpacetimeDbCloudDatabase) => {
    if (!activeAccount) return;
    const key = `${database.identity}:${displayName(database)}`;
    setConnectingKey(key);
    try {
      await onConnectDatabase({
        name: displayName(database),
        connectionString: buildSpacetimeDbConnectionString(
          activeAccount.host || "",
          displayName(database),
          activeAccount.token,
        ),
        connectionType: "spacetimedb",
      });
    } finally {
      setConnectingKey(null);
    }
  };

  const handleImportAll = async () => {
    if (!activeAccount) return;
    setImporting(true);
    try {
      const result = await registerSpacetimeDbDatabases(
        activeAccount.token,
        activeAccount.host || "",
        existingConnectionStrings,
        maxConnections,
        {
          listDatabases: listSpacetimeDbDatabases,
          createConnection: async (payload) => {
            const res = await onConnectDatabase(payload, { silent: true });
            return { success: Boolean(res?.success) };
          },
        },
      );
      const total =
        result.imported +
        result.alreadyRegistered +
        result.skippedLimit +
        result.skippedNameless;
      if (result.imported > 0 && result.skippedLimit > 0) {
        toast.warning(
          `Imported ${result.imported} of ${total} databases — upgrade for more connections`,
        );
      } else if (result.imported > 0) {
        toast.success(`Imported ${result.imported} of ${total} databases`);
      } else if (result.skippedLimit > 0) {
        toast.warning("Upgrade to Pro for more connections");
      } else if (result.alreadyRegistered > 0) {
        toast.info("All databases are already connected.");
      } else if (result.failed > 0) {
        toast.error("Failed to import databases.");
      } else {
        toast.info("No databases to import.");
      }
    } catch {
      toast.error("Failed to import databases.");
    } finally {
      setImporting(false);
    }
  };

  const accountLabel = (account: SpacetimeDbMgmtAccount) =>
    formatIdentity(account.identity) || "SpacetimeDB account";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-studio-border bg-studio-bg/60">
            <SpacetimeDbLogo className="h-6 w-6 text-foreground/80" />
          </div>
          <div>
            <h2 className="text-sm font-bold">SpacetimeDB Accounts</h2>
            <p className="text-xs text-muted-foreground">
              Browse, connect, and import your SpacetimeDB databases.
            </p>
          </div>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-studio-border/60 bg-studio-bg/60 px-6 py-16 text-center">
          <SpacetimeDbLogo className="mb-4 h-11 w-11 text-foreground/80" />
          <h3 className="text-sm font-semibold">No SpacetimeDB account linked</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Log in with GitHub to link your SpacetimeDB identity, then browse
            your Maincloud databases and connect them here.
          </p>
          <Button
            onClick={onAddAccount}
            className="mt-5 h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Log in to SpacetimeDB
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-studio-border/60 bg-studio-bg/60">
            <div className="flex items-center justify-between border-b border-studio-border/50 px-4 py-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Linked accounts
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onAddAccount}
                disabled={!canAddAccount}
                title={
                  canAddAccount
                    ? "Link another SpacetimeDB account"
                    : "Upgrade to Pro to link more accounts"
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Link account
              </Button>
            </div>
            <div className="space-y-2 p-4">
              {accounts.map((account) => {
                const isActive = account.id === activeAccountId;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => onSwitchAccount(account.id)}
                    className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      isActive
                        ? "border-primary/40 bg-primary/5"
                        : "border-studio-border/60 bg-studio-bg/40 hover:border-studio-border hover:bg-studio-row-hover/80"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                      <Fingerprint className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate font-mono">
                          {accountLabel(account)}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        <Server className="mr-1 inline h-3 w-3" />
                        {account.host || "maincloud.spacetimedb.com"}
                      </div>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      title="Remove this account"
                      className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAccount(account.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          onRemoveAccount(account.id);
                        }
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-studio-border/60 bg-studio-bg/60">
            <div className="flex items-center justify-between border-b border-studio-border/50 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Databases
                </h3>
                {activeAccount && (
                  <span className="text-xs text-muted-foreground truncate">
                    — {accountLabel(activeAccount)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void loadDatabases()}
                  disabled={loading}
                  title="Refresh databases"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleImportAll}
                  disabled={importing || !activeAccount}
                >
                  <Download className="h-3.5 w-3.5" />
                  {importing ? "Importing..." : "Import all"}
                </Button>
              </div>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search databases..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 bg-background/70 border-border/60 text-sm"
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : loadError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm font-medium text-destructive">
                    Failed to load databases
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {loadError}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This account&apos;s token may have expired or the server
                    host is unreachable. Switch accounts or remove this account
                    and log in again.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredDatabases.map((database) => {
                    const name = displayName(database);
                    const key = `${database.identity}:${name}`;
                    return (
                      <div
                        key={database.identity}
                        className="flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/40 p-3"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                          <Database className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {formatIdentity(database.identity)}
                            {database.names.length > 1
                              ? ` · ${database.names.slice(1).join(", ")}`
                              : ""}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 gap-1 text-xs"
                          onClick={() => void handleConnect(database)}
                          disabled={connectingKey === key}
                        >
                          {connectingKey === key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          Connect
                        </Button>
                      </div>
                    );
                  })}

                  {databases.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No databases found for this identity. Publish one with{" "}
                      <code className="text-[11px]">spacetime publish</code>{" "}
                      first.
                    </div>
                  )}
                  {databases.length > 0 && filteredDatabases.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No databases match your search.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}