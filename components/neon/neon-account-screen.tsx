"use client";

import { useState } from "react";
import { useOrgScopedLoader } from "@/components/shared/provider-accounts/use-org-scoped-loader";
import { Button } from "@/components/ui/button";
import { NeonLogo } from "@/components/shared/provider-logo";
import {
  listProjects,
  listOrgs,
  listBranches,
  listDatabases,
  listRoles,
  type NeonProject,
  type NeonOrg,
  type NeonBranch,
} from "@/lib/neon-cli/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NeonCliAccount } from "@/lib/neon-cli/profile-store";
import {
  buildNeonCliConnectionString,
  parseNeonCliConnectionString,
} from "@/lib/neon-cli/pointer";
import { openExternalUrl } from "@/lib/desktop";
import { isNeonSessionExpiredError } from "@/lib/neon-cli/errors";
import { NeonInstallPrompt } from "@/components/neon/neon-install-prompt";
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

interface NeonAccountsScreenProps {
  accounts: NeonCliAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onAddAccount: () => void;
  canAddAccount: boolean;
  existingConnectionStrings: string[];
  cliInstalled: boolean | null;
  checkingCli: boolean;
  onRecheckCli: () => void;
  onBack?: () => void;
  onConnectDatabase: (
    payload: { name: string; connectionString: string; connectionType: string },
    opts?: { silent?: boolean },
  ) => Promise<{ success: boolean }>;
  /** Re-authenticates an existing profile in place after its session expired. */
  onReconnectAccount: (profileName: string) => void;
  /** Bumped by the parent after a successful (re)connect to retrigger loading. */
  reloadSignal: number;
}

export function NeonAccountsScreen({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  canAddAccount,
  existingConnectionStrings,
  cliInstalled,
  checkingCli,
  onRecheckCli,
  onBack,
  onConnectDatabase,
  onReconnectAccount,
  reloadSignal,
}: NeonAccountsScreenProps) {
  const [search, setSearch] = useState("");
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [branchesByProject, setBranchesByProject] = useState<Record<string, NeonBranch[]>>({});
  const [branchesLoading, setBranchesLoading] = useState<string | null>(null);
  const [connectingBranchId, setConnectingBranchId] = useState<string | null>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  const connectedKeys = new Set(
    existingConnectionStrings
      .map((conn) => parseNeonCliConnectionString(conn))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => `${p.profile}/${p.projectId}/${p.branchId}`),
  );

  const {
    orgs,
    selectedOrg: selectedOrgId,
    orgsLoading,
    orgsError,
    resources: projects,
    loading,
    loadError,
    reload: loadProjects,
    handleOrgChange,
  } = useOrgScopedLoader<NeonCliAccount, NeonOrg, NeonProject>({
    activeAccount,
    accountKey: activeAccount?.id,
    listOrgs: (account) => listOrgs(account.profileName),
    pickInitialOrgKey: (list) => list[0]?.id ?? null,
    loadResources: (account, orgId) => listProjects(account.profileName, orgId ?? undefined),
    reloadSignal,
  });

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleProject = async (project: NeonProject) => {
    if (expandedProjectId === project.id) {
      setExpandedProjectId(null);
      return;
    }
    setExpandedProjectId(project.id);
    if (!branchesByProject[project.id] && activeAccount) {
      setBranchesLoading(project.id);
      try {
        const branches = await listBranches(activeAccount.profileName, project.id);
        setBranchesByProject((prev) => ({ ...prev, [project.id]: branches }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load branches.");
      } finally {
        setBranchesLoading(null);
      }
    }
  };

  const handleConnectBranch = async (project: NeonProject, branch: NeonBranch) => {
    if (!activeAccount) return;
    setConnectingBranchId(branch.id);
    try {
      const [databases, roles] = await Promise.all([
        listDatabases(activeAccount.profileName, project.id, branch.id),
        listRoles(activeAccount.profileName, project.id, branch.id),
      ]);
      const database = databases[0]?.name;
      const role = roles[0]?.name;
      if (!database || !role) {
        toast.error("This branch has no database/role to connect to.");
        return;
      }
      const connectionString = buildNeonCliConnectionString({
        profile: activeAccount.profileName,
        projectId: project.id,
        branchId: branch.id,
        database,
        role,
      });
      const name = branch.default ? project.name : `${project.name} (${branch.name})`;
      await onConnectDatabase({ name, connectionString, connectionType: "neon" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect.";
      toast.error(message, {
        action: isNeonSessionExpiredError(message)
          ? { label: "Reconnect", onClick: () => onReconnectAccount(activeAccount.profileName) }
          : undefined,
      });
    } finally {
      setConnectingBranchId(null);
    }
  };

  const accountLabel = (account: NeonCliAccount) => account.label || account.profileName;

  if (cliInstalled === false) {
    return (
      <div className="mx-auto max-w-5xl py-6">
        <NeonInstallPrompt onRecheck={onRecheckCli} checking={checkingCli} />
      </div>
    );
  }

  const logo = <NeonLogo className="h-[22px] w-[22px]" />;

  const accountChips: AccountChipItem[] = accounts.map((account) => ({
    id: account.id,
    label: accountLabel(account),
    initial: accountLabel(account).slice(0, 1),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <ProviderAccountsHeader
        logo={logo}
        title="Neon"
        description="Browse and connect your Neon projects — via the real Neon CLI."
        onBack={onBack}
      />

      {accounts.length === 0 ? (
        <ProviderEmptyState
          logo={logo}
          title="No Neon account linked"
          description="Sign in with your Neon account (via the Neon CLI) to browse your projects and connect them here."
          actionLabel="Sign in with Neon CLI"
          onAction={onAddAccount}
          actionDisabled={cliInstalled === null}
          actionLoading={cliInstalled === null}
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
            addLabel="Add Neon account"
          />

          <section className="overflow-hidden rounded-xl border border-studio-border/60 bg-studio-bg/40">
            <ProviderListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search projects..."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void loadProjects()}
                  disabled={loading}
                  title="Refresh projects"
                >
                  <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                </Button>
              }
              extra={
                orgs.length > 1 ? (
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">Organization</span>
                    <Select value={selectedOrgId ?? undefined} onValueChange={handleOrgChange}>
                      <SelectTrigger className="h-8 flex-1 border-border/60 bg-background/70 text-sm">
                        <SelectValue placeholder="Select an organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
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
                  {isNeonSessionExpiredError(orgsError) && activeAccount && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                      onClick={() => onReconnectAccount(activeAccount.profileName)}
                    >
                      Reconnect
                    </Button>
                  )}
                </div>
              )}

              {loading || orgsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : loadError ? (
                <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm font-medium text-destructive">
                    {isNeonSessionExpiredError(loadError) ? "Session expired" : "Failed to load projects"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                  {isNeonSessionExpiredError(loadError) && activeAccount && (
                    <Button
                      size="sm"
                      className="mt-3 h-7 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                      onClick={() => onReconnectAccount(activeAccount.profileName)}
                    >
                      Reconnect
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredProjects.map((project) => {
                    const isExpanded = expandedProjectId === project.id;
                    const branches = branchesByProject[project.id] || [];
                    return (
                      <div key={project.id} className="overflow-hidden rounded-lg">
                        <ResourceRow
                          icon={<Database className="h-4 w-4 text-muted-foreground" />}
                          title={project.name}
                          subtitle={`${project.id}${project.region_id ? ` · ${project.region_id}` : ""}`}
                          onClick={() => void toggleProject(project)}
                          expandable
                          expanded={isExpanded}
                          className={isExpanded ? "bg-studio-row-hover/50" : undefined}
                          trailing={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                              title="Open in Neon console"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openExternalUrl(`https://console.neon.tech/app/projects/${project.id}`);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />

                        {isExpanded && (
                          <div className="ml-[3.25rem] space-y-0.5 border-l border-studio-border/50 py-1 pl-3">
                            {branchesLoading === project.id ? (
                              <div className="flex items-center justify-center py-5">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              </div>
                            ) : branches.length === 0 ? (
                              <div className="py-3 text-xs text-muted-foreground">No branches found.</div>
                            ) : (
                              branches.map((branch) => {
                                const key = `${activeAccount?.profileName}/${project.id}/${branch.id}`;
                                const isConnected = connectedKeys.has(key);
                                return (
                                  <div
                                    key={branch.id}
                                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-studio-row-hover/50"
                                  >
                                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1 text-xs">
                                      <span className="font-medium">{branch.name}</span>
                                      {branch.default && (
                                        <span className="ml-1.5 text-[10px] text-muted-foreground">default</span>
                                      )}
                                    </div>
                                    {isConnected ? (
                                      <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                        Connected
                                      </span>
                                    ) : (
                                      <Button
                                        size="sm"
                                        className="h-6 shrink-0 gap-1 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
                                        onClick={() => void handleConnectBranch(project, branch)}
                                        disabled={connectingBranchId === branch.id}
                                      >
                                        {connectingBranchId === branch.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : null}
                                        Connect
                                      </Button>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredProjects.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {projects.length === 0 ? "No projects found." : "No projects match your search."}
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
