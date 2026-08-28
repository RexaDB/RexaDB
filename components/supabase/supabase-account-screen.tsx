"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SupabaseLogo } from "@/components/shared/provider-logo";
import {
  listProjects,
  listOrganizations,
  getMgmtUser,
} from "@/lib/supabase-mgmt/client";
import type { SupabaseMgmtAccount } from "@/lib/supabase-mgmt/token-store";
import { buildSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import {
  registerActiveSupabaseProjects,
  parseProjectRef,
} from "@/lib/supabase-mgmt/register";
import { openExternalUrl } from "@/lib/desktop";
import type { Project, Organization } from "supabase-client-sdk";
import { ProviderAccountsHeader } from "@/components/shared/provider-accounts/header";
import { AccountChips, type AccountChipItem } from "@/components/shared/provider-accounts/account-chips";
import { ProviderEmptyState } from "@/components/shared/provider-accounts/empty-state";
import { ProviderListToolbar } from "@/components/shared/provider-accounts/list-toolbar";
import { ResourceRow } from "@/components/shared/provider-accounts/resource-row";
import { toast } from "sonner";
import {
  Database,
  Download,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "@/lib/icon-theme/lucide-react";

interface SupabaseAccountsScreenProps {
  accounts: SupabaseMgmtAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onAddAccount: () => void;
  canAddAccount: boolean;
  existingConnectionStrings: string[];
  maxConnections: number | null;
  onConnectProject: (
    payload: {
      name: string;
      connectionString: string;
      connectionType: string;
    },
    opts?: { silent?: boolean },
  ) => Promise<{ success: boolean }>;
}

export function SupabaseAccountsScreen({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  canAddAccount,
  existingConnectionStrings,
  maxConnections,
  onConnectProject,
}: SupabaseAccountsScreenProps) {
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [connectingRef, setConnectingRef] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  const connectedProjectRefs = new Set(
    existingConnectionStrings
      .map((conn) => parseProjectRef(conn))
      .filter((ref): ref is string => Boolean(ref)),
  );

  const loadProjects = useCallback(async () => {
    const account = accounts.find((a) => a.id === activeAccountId);
    if (!account) {
      setProjects([]);
      setOrganizations([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [projs, orgs] = await Promise.all([
        listProjects(account.token),
        listOrganizations(account.token),
      ]);
      setProjects(projs);
      setOrganizations(orgs);
    } catch (err) {
      setProjects([]);
      setOrganizations([]);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Failed to load projects for this account.",
      );
    } finally {
      setLoading(false);
    }
  }, [accounts, activeAccountId]);

  useEffect(() => {
    if (activeAccount) void loadProjects();
  }, [activeAccount, loadProjects]);

  useEffect(() => {
    let cancelled = false;
    const entries = new Map<string, string>();
    accounts.forEach((a) => {
      if (a.email) entries.set(a.id, a.email);
    });
    const missing = accounts.filter((a) => !a.email);
    void Promise.all(
      missing.map(async (a) => {
        try {
          const user = await getMgmtUser(a.token);
          if (user?.primary_email) entries.set(a.id, user.primary_email);
        } catch {
          // token may be invalid or the proxy unreachable; keep fallback
        }
      }),
    ).finally(() => {
      if (!cancelled) setEmails(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  const getOrgName = (orgId: string) =>
    organizations.find((o) => o.id === orgId)?.name ?? "Unknown";

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.ref.toLowerCase().includes(search.toLowerCase()) ||
      getOrgName(p.organization_id).toLowerCase().includes(search.toLowerCase()),
  );

  const groupedProjects = filteredProjects.reduce(
    (acc, project) => {
      const orgName = getOrgName(project.organization_id);
      if (!acc[orgName]) acc[orgName] = [];
      acc[orgName].push(project);
      return acc;
    },
    {} as Record<string, Project[]>,
  );

  const handleConnect = async (project: Project) => {
    if (!activeAccount) return;
    if (connectedProjectRefs.has(project.ref)) return;
    setConnectingRef(project.ref);
    try {
      const connectionString = buildSupabaseMgmtConnectionString(
        project.ref,
        activeAccount.token,
      );
      await onConnectProject({
        name: project.name,
        connectionString,
        connectionType: "supabase-mgmt",
      });
    } finally {
      setConnectingRef(null);
    }
  };

  const handleImportAll = async () => {
    if (!activeAccount) return;
    setImporting(true);
    try {
      const result = await registerActiveSupabaseProjects(
        activeAccount.token,
        existingConnectionStrings,
        maxConnections,
        {
          listProjects,
          createConnection: async (payload) => {
            const res = await onConnectProject(payload, { silent: true });
            return { success: Boolean(res?.success) };
          },
        },
      );
      const activeTotal =
        result.imported + result.alreadyRegistered + result.skippedLimit;
      if (result.imported > 0 && result.skippedLimit > 0) {
        toast.warning(
          `Imported ${result.imported} of ${activeTotal} active projects — upgrade for more connections`,
        );
      } else if (result.imported > 0) {
        toast.success(`Imported ${result.imported} of ${activeTotal} active projects`);
      } else if (result.skippedLimit > 0) {
        toast.warning("Upgrade to Pro for more connections");
      } else if (result.alreadyRegistered > 0) {
        toast.info("All active projects are already connected.");
      } else if (result.failed > 0) {
        toast.error("Failed to import projects.");
      } else {
        toast.info("No active projects to import.");
      }
    } catch {
      toast.error("Failed to import projects.");
    } finally {
      setImporting(false);
    }
  };

  const accountEmail = (account: SupabaseMgmtAccount) =>
    emails[account.id] ?? account.email ?? null;

  const accountLabel = (account: SupabaseMgmtAccount) =>
    accountEmail(account) || account.name || "Supabase account";

  const statusMeta = (status: string): { label: string; className: string } => {
    if (status === "ACTIVE_HEALTHY" || status === "ACTIVE")
      return { label: "Active", className: "border-primary/20 bg-primary/10 text-primary" };
    if (status === "PAUSED")
      return { label: "Paused", className: "border-studio-border/60 bg-muted/40 text-muted-foreground" };
    if (status === "COMING_UP")
      return { label: "Starting", className: "border-studio-border/60 bg-muted/40 text-muted-foreground" };
    return {
      label: status.replace(/_/g, " "),
      className: "border-studio-border/60 bg-muted/40 text-muted-foreground",
    };
  };

  const logo = <SupabaseLogo className="h-[22px] w-[22px]" />;

  const accountChips: AccountChipItem[] = accounts.map((account) => ({
    id: account.id,
    label: accountLabel(account),
    initial: accountLabel(account).slice(0, 1),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <ProviderAccountsHeader
        logo={logo}
        title="Supabase"
        description="Browse, connect, and import your Supabase projects."
      />

      {accounts.length === 0 ? (
        <ProviderEmptyState
          logo={logo}
          title="No Supabase account linked"
          description="Log in with your Supabase (supabase.com) account to browse your projects and connect them here."
          actionLabel="Log in to Supabase"
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
            addLabel="Add Supabase account"
          />

          <section className="overflow-hidden rounded-xl border border-studio-border/60 bg-studio-bg/40">
            <ProviderListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search projects..."
              actions={
                <>
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
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                    onClick={handleImportAll}
                    disabled={importing || !activeAccount}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {importing ? "Importing..." : "Import all active"}
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
                  <p className="text-sm font-medium text-destructive">Failed to load projects</p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This account&apos;s token may have expired. Switch accounts
                    or remove this account and log in again.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedProjects).map(([orgName, orgProjects]) => (
                    <div key={orgName}>
                      <div className="mb-1 px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {orgName}
                      </div>
                      <div className="space-y-0.5">
                        {orgProjects.map((project) => {
                          const status = statusMeta(project.status);
                          const isConnected = connectedProjectRefs.has(project.ref);
                          return (
                            <ResourceRow
                              key={project.id}
                              icon={<Database className="h-4 w-4 text-muted-foreground" />}
                              title={project.name}
                              subtitle={`${project.ref} · ${project.region}`}
                              trailing={
                                <>
                                  <span
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.className}`}
                                  >
                                    {status.label}
                                  </span>
                                  {isConnected ? (
                                    <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                      Connected
                                    </span>
                                  ) : (
                                    <Button
                                      size="sm"
                                      className="h-6 shrink-0 gap-1 bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
                                      onClick={() => void handleConnect(project)}
                                      disabled={connectingRef === project.ref}
                                    >
                                      {connectingRef === project.ref ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : null}
                                      Connect
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Open in Supabase dashboard"
                                    onClick={() =>
                                      openExternalUrl(
                                        `https://supabase.com/dashboard/project/${project.ref}/settings/database`,
                                      )
                                    }
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}

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
