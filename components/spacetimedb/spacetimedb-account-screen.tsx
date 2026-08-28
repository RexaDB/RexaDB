"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  listSpacetimeDbDatabases,
  type SpacetimeDbCloudDatabase,
} from "@/lib/spacetimedb-mgmt/client";
import type { SpacetimeDbMgmtAccount } from "@/lib/spacetimedb-mgmt/token-store";
import { buildSpacetimeDbConnectionString } from "@/lib/spacetimedb-mgmt/register";
import { registerSpacetimeDbDatabases } from "@/lib/spacetimedb-mgmt/register";
import { ProviderAccountsHeader } from "@/components/shared/provider-accounts/header";
import { AccountChips, type AccountChipItem } from "@/components/shared/provider-accounts/account-chips";
import { ProviderEmptyState } from "@/components/shared/provider-accounts/empty-state";
import { ProviderListToolbar } from "@/components/shared/provider-accounts/list-toolbar";
import { ResourceRow } from "@/components/shared/provider-accounts/resource-row";
import { toast } from "sonner";
import {
  Database,
  Download,
  RefreshCw,
  Loader2,
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

  const logo = <SpacetimeDbLogo className="h-[22px] w-[22px] text-foreground/80" />;

  const accountChips: AccountChipItem[] = accounts.map((account) => ({
    id: account.id,
    label: accountLabel(account),
    initial: (account.identity || "S").slice(0, 1).toUpperCase(),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <ProviderAccountsHeader
        logo={logo}
        title="SpacetimeDB"
        description="Browse, connect, and import your SpacetimeDB databases."
      />

      {accounts.length === 0 ? (
        <ProviderEmptyState
          logo={logo}
          title="No SpacetimeDB account linked"
          description="Log in with GitHub to link your SpacetimeDB identity, then browse your Maincloud databases and connect them here."
          actionLabel="Log in to SpacetimeDB"
          onAction={onAddAccount}
        />
      ) : (
        <>
          <AccountChips
            accounts={accountChips}
            activeId={activeAccountId}
            onSwitch={onSwitchAccount}
            onRemove={onRemoveAccount}
            onAdd={onAddAccount}
            canAdd={canAddAccount}
            addLabel="Add SpacetimeDB account"
          />

          <section className="overflow-hidden rounded-xl border border-studio-border/60 bg-studio-bg/40">
            <ProviderListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search databases..."
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => void loadDatabases()}
                    disabled={loading}
                    title="Refresh databases"
                  >
                    <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                    onClick={handleImportAll}
                    disabled={importing || !activeAccount}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {importing ? "Importing..." : "Import all"}
                  </Button>
                </>
              }
            />

            <div className="p-2">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : loadError ? (
                <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm font-medium text-destructive">Failed to load databases</p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This account&apos;s token may have expired or the server
                    host is unreachable. Switch accounts or remove this account
                    and log in again.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredDatabases.map((database) => {
                    const name = displayName(database);
                    const key = `${database.identity}:${name}`;
                    return (
                      <ResourceRow
                        key={database.identity}
                        icon={<Database className="h-4 w-4 text-muted-foreground" />}
                        title={name}
                        subtitle={`${formatIdentity(database.identity)}${
                          database.names.length > 1 ? ` · ${database.names.slice(1).join(", ")}` : ""
                        }`}
                        trailing={
                          <Button
                            size="sm"
                            className="h-6 shrink-0 gap-1 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
                            onClick={() => void handleConnect(database)}
                            disabled={connectingKey === key}
                          >
                            {connectingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Connect
                          </Button>
                        }
                      />
                    );
                  })}

                  {databases.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No databases found for this identity. Publish one with{" "}
                      <code className="text-[11px]">spacetime publish</code> first.
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
        </>
      )}
    </div>
  );
}
