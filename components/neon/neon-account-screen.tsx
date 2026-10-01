"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// components
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NeonLogo } from "@/components/shared/provider-logo";
import { NeonInstallPrompt } from "@/components/neon/neon-install-prompt";
import {
  AccountChips,
  ProviderAccountsHeader,
  ProviderEmptyState,
  ProviderListToolbar,
  ResourceRow,
  buildAccountChips,
  filterByName,
  type ProviderAccountScreenBaseProps,
} from "@/components/shared/provider-accounts";
import {
  Database,
  ExternalLink,
  RefreshCw,
  Loader2,
  GitBranch,
} from "@/lib/icon-theme/lucide-react";

// hooks
import { useOrgScopedLoader } from "@/components/shared/provider-accounts/use-org-scoped-loader";

// services
import {
  listProjects,
  listOrgs,
  listBranches,
  listDatabases,
  listRoles,
  type NeonProject,
  type NeonOrg,
  type NeonBranch,
  type NeonDatabase,
  type NeonRole,
} from "@/lib/neon-cli/client";

// utils
import {
  buildNeonCliConnectionString,
  getNeonConnectionKey,
  parseNeonCliConnectionString,
} from "@/lib/neon-cli/pointer";
import { openExternalUrl } from "@/lib/desktop";
import { isNeonSessionExpiredError } from "@/lib/neon-cli/errors";

// types
import type { NeonCliAccount } from "@/lib/neon-cli/profile-store";

interface NeonAccountsScreenProps extends ProviderAccountScreenBaseProps {
  accounts: NeonCliAccount[];
  existingConnectionStrings: string[];
  cliInstalled: boolean | null;
  checkingCli: boolean;
  onRecheckCli: () => void;
  /** Re-authenticates an existing profile in place after its session expired. */
  onReconnectAccount: (profileName: string) => void;
  /** Bumped by the parent after a successful (re)connect to retrigger loading. */
  reloadSignal: number;
}

export function NeonAccountsScreen(props: NeonAccountsScreenProps) {
  const account = props.accounts.find((item) => item.id === props.activeAccountId);
  return <NeonAccountContent key={JSON.stringify([account?.id, account?.profileName])} {...props} />;
}

function NeonAccountContent({
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
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  const mounted = useRef<boolean>(true);
  const pendingConnections = useRef<Set<string>>(new Set());

  const [search, setSearch] = useState<string>("");
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [branchesByProject, setBranchesByProject] = useState<Record<string, NeonBranch[]>>({});
  const [branchesLoading, setBranchesLoading] = useState<string | null>(null);
  const [connectingBranchId, setConnectingBranchId] = useState<string | null>(null);
  const [connectDialog, setConnectDialog] = useState<{
    profile: string;
    project: NeonProject;
    branch: NeonBranch;
    databases: NeonDatabase[];
    roles: NeonRole[];
  } | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("");

  const connectedPointers = existingConnectionStrings
    .map((conn) => parseNeonCliConnectionString(conn))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const connectedKeys = new Set(
    connectedPointers.map(getNeonConnectionKey),
  );

  const getConnectedCount = (projectId: string, branchId: string) =>
    connectedPointers.filter((p) => p.profile === activeAccount?.profileName && p.projectId === projectId && p.branchId === branchId).length;

  const selectedConnectionExists = connectDialog !== null && connectedKeys.has(getNeonConnectionKey({
    profile: connectDialog.profile,
    projectId: connectDialog.project.id,
    branchId: connectDialog.branch.id,
    database: selectedDatabase,
    role: selectedRole,
  }));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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

  const filteredProjects = filterByName(projects, search, (p) => [p.name, p.id]);

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

  const connectWithDatabaseAndRole = async (
    profile: string,
    project: NeonProject,
    branch: NeonBranch,
    database: string,
    role: string,
  ) => {
    if (!mounted.current) return;
    const pointer = {
      profile,
      projectId: project.id,
      branchId: branch.id,
      database,
      role,
    };
    const key = getNeonConnectionKey(pointer);
    if (connectedKeys.has(key) || pendingConnections.current.has(key)) {
      toast.info("This database and role are already connected.");
      return;
    }
    const connectionString = buildNeonCliConnectionString(pointer);
    const name = branch.default
      ? `${project.name} / ${database}`
      : `${project.name} (${branch.name}) / ${database}`;
    pendingConnections.current.add(key);
    try {
      await onConnectDatabase({ name, connectionString, connectionType: "neon" });
    } finally {
      pendingConnections.current.delete(key);
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
      if (!mounted.current) return;
      if (databases.length === 0 || roles.length === 0) {
        toast.error("This branch has no database/role to connect to.");
        return;
      }
      const available = databases
        .flatMap((database) => roles.map((role) => ({ database: database.name, role: role.name })))
        .find((selection) => !connectedKeys.has(getNeonConnectionKey({
          profile: activeAccount.profileName,
          projectId: project.id,
          branchId: branch.id,
          ...selection,
        })));
      if (!available) {
        toast.info("All database and role combinations are already connected.");
        return;
      }
      if (databases.length === 1 && roles.length === 1) {
        await connectWithDatabaseAndRole(activeAccount.profileName, project, branch, available.database, available.role);
        return;
      }
      setConnectDialog({ profile: activeAccount.profileName, project, branch, databases, roles });
      setSelectedDatabase(available.database);
      setSelectedRole(available.role);
    } catch (err) {
      if (!mounted.current) return;
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

  const accountChips = buildAccountChips(accounts, accountLabel);

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
                                const connectedCount = getConnectedCount(project.id, branch.id);
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
                                    {connectedCount > 0 && (
                                      <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                        {connectedCount} connected
                                      </span>
                                    )}
                                    <Button
                                      size="sm"
                                      className="h-6 shrink-0 gap-1 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
                                      onClick={() => void handleConnectBranch(project, branch)}
                                      disabled={connectingBranchId !== null}
                                    >
                                      {connectingBranchId === branch.id ? (
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

      <Dialog open={connectDialog !== null} onOpenChange={(open) => { if (!open) setConnectDialog(null); }}>
        <DialogContent className="gap-0 rounded-xl p-0 sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="px-5 pt-5 pb-4">
            <DialogTitle className="text-base font-semibold">Connect to database</DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {connectDialog ? `${connectDialog.project.name} · ${connectDialog.branch.name}` : ""}
            </p>
          </div>
          <div className="space-y-4 px-5 pb-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Database</Label>
              <Select value={selectedDatabase} onValueChange={setSelectedDatabase}>
                <SelectTrigger className="h-9 border-border/60 bg-background/70 text-sm">
                  <SelectValue placeholder="Select a database" />
                </SelectTrigger>
                <SelectContent>
                  {connectDialog?.databases.map((db) => (
                    <SelectItem key={db.name} value={db.name}>
                      {db.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {connectDialog && connectDialog.roles.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="h-9 border-border/60 bg-background/70 text-sm">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {connectDialog.roles.map((role) => (
                      <SelectItem key={role.name} value={role.name}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedConnectionExists && (
              <p className="text-xs text-muted-foreground">This database and role are already connected.</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConnectDialog(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!selectedDatabase || !selectedRole || selectedConnectionExists}
                onClick={() => {
                  if (!connectDialog || !selectedDatabase || !selectedRole || selectedConnectionExists) return;
                  const { profile, project, branch } = connectDialog;
                  setConnectDialog(null);
                  void (async () => {
                    setConnectingBranchId(branch.id);
                    try {
                      await connectWithDatabaseAndRole(profile, project, branch, selectedDatabase, selectedRole);
                    } catch (err) {
                      const message = err instanceof Error ? err.message : "Failed to connect.";
                      toast.error(message);
                    } finally {
                      setConnectingBranchId(null);
                    }
                  })();
                }}
              >
                Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
