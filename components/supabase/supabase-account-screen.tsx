"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listProjects,
  listOrganizations,
  getMgmtUser,
} from "@/lib/supabase-mgmt/client";
import type { SupabaseMgmtAccount } from "@/lib/supabase-mgmt/token-store";
import { buildSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import {
  registerActiveSupabaseProjects,
} from "@/lib/supabase-mgmt/register";
import { openExternalUrl } from "@/lib/desktop";
import type { Project, Organization } from "supabase-client-sdk";
import { toast } from "sonner";
import {
  LogOut,
  Database,
  Plus,
  Search,
  Download,
  ExternalLink,
  RefreshCw,
  Loader2,
  Mail,
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

  const handleConnect = async (project: Project) => {    if (!activeAccount) return;
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

  const statusColor = (status: string) => {
    if (status === "ACTIVE_HEALTHY" || status === "ACTIVE")
      return "text-green-500";
    if (status === "PAUSED") return "text-yellow-500";
    if (status === "COMING_UP") return "text-blue-500";
    return "text-muted-foreground";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-studio-border bg-studio-bg/60">
            <Image
              src="/providers/supabase.png"
              alt="Supabase"
              width={26}
              height={26}
              className="rounded-md object-contain"
            />
          </div>
          <div>
            <h2 className="text-sm font-bold">Supabase Accounts</h2>
            <p className="text-xs text-muted-foreground">
              Browse, connect, and import your Supabase projects.
            </p>
          </div>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-studio-border/60 bg-studio-bg/60 px-6 py-16 text-center">
          <Image
            src="/providers/supabase.png"
            alt="Supabase"
            width={44}
            height={44}
            className="mb-4 rounded-lg object-contain opacity-80"
          />
          <h3 className="text-sm font-semibold">No Supabase account linked</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Log in with your Supabase (supabase.com) account to browse your
            projects and connect them here.
          </p>
          <Button
            onClick={onAddAccount}
            className="mt-5 h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Log in to Supabase
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
                    ? "Link another Supabase account"
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
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {accountLabel(account)}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                            Active
                          </span>
                        )}
                      </div>
                      {accountEmail(account) && account.name && (
                        <div className="text-xs text-muted-foreground truncate">
                          {account.name}
                        </div>
                      )}
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
                  Projects
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
                  onClick={() => void loadProjects()}
                  disabled={loading}
                  title="Refresh projects"
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
                  {importing ? "Importing..." : "Import all active"}
                </Button>
              </div>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
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
                    Failed to load projects
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {loadError}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This account&apos;s token may have expired. Switch accounts
                    or remove this account and log in again.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedProjects).map(
                    ([orgName, orgProjects]) => (
                      <div key={orgName}>
                        <div className="mb-2 px-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {orgName}
                        </div>
                        <div className="space-y-1.5">
                          {orgProjects.map((project) => (
                            <div
                              key={project.id}
                              className="flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/40 p-3"
                            >
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                                <Database className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {project.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {project.ref} &middot; {project.region}
                                </div>
                              </div>
                              <span
                                className={`shrink-0 text-xs font-medium ${statusColor(project.status)}`}
                              >
                                {project.status === "ACTIVE_HEALTHY"
                                  ? "Active"
                                  : project.status === "PAUSED"
                                    ? "Paused"
                                    : project.status.replace(/_/g, " ")}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 shrink-0 gap-1 text-xs"
                                onClick={() => void handleConnect(project)}
                                disabled={connectingRef === project.ref}
                              >
                                {connectingRef === project.ref ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : null}
                                Connect
                              </Button>
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
                            </div>
                          ))}
                        </div>
                      </div>
                    ),
                  )}

                  {filteredProjects.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {projects.length === 0
                        ? "No projects found."
                        : "No projects match your search."}
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
