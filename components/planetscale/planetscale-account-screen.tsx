"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/shared/provider-logo";
import {
  listOrganizations,
  listDatabases,
  listBranches,
  createBranchPassword,
  type PlanetscaleDatabase,
  type PlanetscaleBranch,
} from "@/lib/planetscale/client";
import { buildPlanetscaleConnectionString } from "@/lib/db/planetscale-connection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlanetscaleAccount } from "@/lib/planetscale/token-store";
import { openExternalUrl } from "@/lib/desktop";
import { ProviderAccountsHeader } from "@/components/shared/provider-accounts/header";
import { AccountChips, type AccountChipItem } from "@/components/shared/provider-accounts/account-chips";
import { ProviderEmptyState } from "@/components/shared/provider-accounts/empty-state";
import { ProviderListToolbar } from "@/components/shared/provider-accounts/list-toolbar";
import { ResourceRow } from "@/components/shared/provider-accounts/resource-row";
import { toast } from "sonner";
import {
  Database,
  ExternalLink,
  RefreshCw,
  Loader2,
  GitBranch,
} from "@/lib/icon-theme/lucide-react";

interface PlanetscaleAccountsScreenProps {
  accounts: PlanetscaleAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onAddAccount: () => void;
  canAddAccount: boolean;
  onConnectDatabase: (
    payload: { name: string; connectionString: string; connectionType: string },
    opts?: { silent?: boolean },
  ) => Promise<{ success: boolean }>;
}

export function PlanetscaleAccountsScreen({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  canAddAccount,
  onConnectDatabase,
}: PlanetscaleAccountsScreenProps) {
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<PlanetscaleDatabase[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [orgs, setOrgs] = useState<{ name: string }[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [branchesByDb, setBranchesByDb] = useState<Record<string, PlanetscaleBranch[]>>({});
  const [branchesLoading, setBranchesLoading] = useState<string | null>(null);
  const [connectingBranch, setConnectingBranch] = useState<string | null>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const requestIdRef = useRef(0);

  const loadDatabasesForOrg = useCallback(
    async (account: PlanetscaleAccount, org: string, requestId: number) => {
      setLoading(true);
      setLoadError(null);
      try {
        const dbs = await listDatabases(account.id, org);
        if (requestIdRef.current !== requestId) return;
        setDatabases(dbs);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setDatabases([]);
        setLoadError(err instanceof Error ? err.message : "Failed to load databases for this account.");
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [],
  );

  const loadDatabases = useCallback(() => {
    if (!activeAccount || !selectedOrg) return;
    const requestId = ++requestIdRef.current;
    void loadDatabasesForOrg(activeAccount, selectedOrg, requestId);
  }, [activeAccount, selectedOrg, loadDatabasesForOrg]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!activeAccount) {
      setOrgs([]);
      setSelectedOrg(null);
      setOrgsError(null);
      setDatabases([]);
      setLoadError(null);
      return;
    }

    setOrgs([]);
    setSelectedOrg(null);
    setOrgsError(null);

    (async () => {
      setOrgsLoading(true);
      let org: string | null = null;
      try {
        const list = await listOrganizations(activeAccount.id);
        if (requestIdRef.current !== requestId) return;
        setOrgs(list);
        org = list[0]?.name ?? null;
        setSelectedOrg(org);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setOrgsError(err instanceof Error ? err.message : "Failed to load organizations for this account.");
      } finally {
        if (requestIdRef.current === requestId) setOrgsLoading(false);
      }
      if (requestIdRef.current !== requestId || !org) return;
      await loadDatabasesForOrg(activeAccount, org, requestId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id]);

  const handleOrgChange = useCallback(
    (org: string) => {
      setSelectedOrg(org);
      if (!activeAccount) return;
      const requestId = ++requestIdRef.current;
      void loadDatabasesForOrg(activeAccount, org, requestId);
    },
    [activeAccount, loadDatabasesForOrg],
  );

  const filteredDatabases = databases.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleDatabase = async (database: PlanetscaleDatabase) => {
    if (expandedDb === database.name) {
      setExpandedDb(null);
      return;
    }
    setExpandedDb(database.name);
    if (!branchesByDb[database.name] && activeAccount && selectedOrg) {
      setBranchesLoading(database.name);
      try {
        const branches = await listBranches(activeAccount.id, selectedOrg, database.name);
        setBranchesByDb((prev) => ({ ...prev, [database.name]: branches }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load branches.");
      } finally {
        setBranchesLoading(null);
      }
    }
  };

  const handleConnectBranch = async (database: PlanetscaleDatabase, branch: PlanetscaleBranch) => {
    if (!activeAccount || !selectedOrg) return;
    const branchKey = `${database.name}/${branch.name}`;
    setConnectingBranch(branchKey);
    try {
      const password = await createBranchPassword(
        activeAccount.id,
        selectedOrg,
        database.name,
        branch.name,
      );
      const { connectionString, connectionType } = buildPlanetscaleConnectionString(
        password,
        database.name,
        database.kind,
      );
      const name = branch.production ? database.name : `${database.name} (${branch.name})`;
      await onConnectDatabase({ name, connectionString, connectionType });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect.");
    } finally {
      setConnectingBranch(null);
    }
  };

  const accountLabel = (account: PlanetscaleAccount) =>
    account.email || account.name || "PlanetScale account";

  const logo = <ProviderLogo type="planetscale" className="h-[22px] w-[22px]" />;

  const accountChips: AccountChipItem[] = accounts.map((account) => ({
    id: account.id,
    label: accountLabel(account),
    initial: accountLabel(account).slice(0, 1),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <ProviderAccountsHeader
        logo={logo}
        title="PlanetScale"
        description="Browse, connect, and manage your PlanetScale databases."
      />

      {accounts.length === 0 ? (
        <ProviderEmptyState
          logo={logo}
          title="No PlanetScale account linked"
          description="Log in with your PlanetScale account to browse your databases and connect them here — no passwords to type."
          actionLabel="Log in to PlanetScale"
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
            addLabel="Add PlanetScale account"
          />

          <section className="overflow-hidden rounded-xl border border-studio-border/60 bg-studio-bg/40">
            <ProviderListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search databases..."
              actions={
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
              }
              extra={
                orgs.length > 1 ? (
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">Organization</span>
                    <Select value={selectedOrg ?? undefined} onValueChange={handleOrgChange}>
                      <SelectTrigger className="h-8 flex-1 border-border/60 bg-background/70 text-sm">
                        <SelectValue placeholder="Select an organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((org) => (
                          <SelectItem key={org.name} value={org.name}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : undefined
              }
            />

            <div className="p-2">
              {orgsError && (
                <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                  <p className="text-xs text-destructive">{orgsError}</p>
                </div>
              )}

              {loading || orgsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : loadError ? (
                <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm font-medium text-destructive">Failed to load databases</p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredDatabases.map((database) => {
                    const isExpanded = expandedDb === database.name;
                    const branches = branchesByDb[database.name] || [];
                    return (
                      <div key={database.name} className="overflow-hidden rounded-lg">
                        <ResourceRow
                          icon={<Database className="h-4 w-4 text-muted-foreground" />}
                          title={database.name}
                          subtitle={database.kind ?? undefined}
                          onClick={() => void toggleDatabase(database)}
                          expandable
                          expanded={isExpanded}
                          className={isExpanded ? "bg-studio-row-hover/50" : undefined}
                          trailing={
                            selectedOrg ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                title="Open in PlanetScale dashboard"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void openExternalUrl(
                                    `https://app.planetscale.com/${selectedOrg}/${database.name}`,
                                  );
                                }}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            ) : undefined
                          }
                        />

                        {isExpanded && (
                          <div className="ml-[3.25rem] space-y-0.5 border-l border-studio-border/50 py-1 pl-3">
                            {branchesLoading === database.name ? (
                              <div className="flex items-center justify-center py-5">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              </div>
                            ) : branches.length === 0 ? (
                              <div className="py-3 text-xs text-muted-foreground">No branches found.</div>
                            ) : (
                              branches.map((branch) => {
                                const branchKey = `${database.name}/${branch.name}`;
                                return (
                                  <div
                                    key={branch.name}
                                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-studio-row-hover/50"
                                  >
                                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1 text-xs">
                                      <span className="font-medium">{branch.name}</span>
                                      {branch.production && (
                                        <span className="ml-1.5 text-[10px] text-muted-foreground">production</span>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      className="h-6 shrink-0 gap-1 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
                                      onClick={() => void handleConnectBranch(database, branch)}
                                      disabled={connectingBranch === branchKey}
                                    >
                                      {connectingBranch === branchKey ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : null}
                                      Connect
                                    </Button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredDatabases.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {databases.length === 0 ? "No databases found." : "No databases match your search."}
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
