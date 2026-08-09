"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PermissionCheckboxList } from "@/components/shared/permission-checkbox-list";
import {
  Server,
  Key,
  User,
  Mail,
  ArrowRight,
  LayoutDashboard,
  Shield,
  Users,
  Database,
  Loader2,
  Briefcase,
  History,
  FileText,
} from "@/lib/icon-theme/lucide-react";
import {
  StudioUrlStep,
  AcceptInviteFields,
  ConnectedDoneScreen,
} from "@/components/shared/accept-invite";
import { acceptInvite } from "@/components/shared/accept-invite-utils";
import {
  initStudioAuth,
  loadStudioAuth,
  saveStudioAuth,
  setStudioConfig,
  setStudioUrl,
  getStudioUrl,
  addWorkspace,
} from "@/lib/studio-backend/auth-store";
import { studioApi } from "@/lib/studio-backend/api-client";
import { RoleList } from "@/components/team/role-list";
import { UserList } from "@/components/team/user-list";
import { ConnectionList } from "@/components/team/connection-list";
import { InviteList } from "@/components/team/invite-list";
import { TeamList } from "@/components/team/team-list";
import { AuditLogList } from "@/components/team/audit-log-list";
import { QueryLogList } from "@/components/team/query-log-list";
import { ProfileTab } from "@/components/team/profile-tab";
import { UserPopover } from "@/components/team/user-popover";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/analytics/dashboard-card";
import { DashboardSkeleton } from "@/components/analytics/dashboard-skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import type { Role, Permission } from "@/lib/studio-backend/types";
import {
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";

interface StudioUser {
  id: string;
  email: string;
  name: string;
  role: {
    id: number;
    name: string;
    description?: string;
  };
  permissions: Permission[];
  avatarUrl?: string | null;
}

const PERM_RESOURCE: Record<string, string> = {
  roles: "roles",
  users: "users",
  connections: "connections",
  invites: "invites",
  teams: "teams",
  audit_logs: "audit_logs",
  query_logs: "query_logs",
};

function hasResourcePerm(perms: Set<string>, resource: string): boolean {
  if (perms.size === 0) return false;
  for (const code of perms) {
    if (code.startsWith(resource + ".")) return true;
  }
  return false;
}

function canAccessSection(
  perms: Set<string> | undefined,
  value: string,
): boolean {
  if (!perms) return true;
  if (value === "dashboard") return true;
  // Roles section: permissions.view or any roles.* permission
  if (value === "roles")
    return perms.has("permissions.view") || hasResourcePerm(perms, "roles");
  const resource = PERM_RESOURCE[value];
  return resource ? hasResourcePerm(perms, resource) : true;
}

const sidebarItems = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "profile", label: "Profile", icon: User },
  { value: "roles", label: "Roles", icon: Shield },
  { value: "users", label: "Users", icon: Users },
  { value: "connections", label: "Connections", icon: Database },
  { value: "invites", label: "Invites", icon: Mail },
  { value: "teams", label: "Teams", icon: Briefcase },
  { value: "audit_logs", label: "Audit Logs", icon: History },
  { value: "query_logs", label: "Query Logs", icon: FileText },
] as const;

export function AcceptView({ onConnected }: { onConnected: () => void }) {
  const [step, setStep] = useState<"url" | "form" | "totp" | "done">("url");
  const [mode, setMode] = useState<"invite" | "login">("invite");
  const [studioUrl, setStudioUrlState] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSetUrl = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = studioUrl.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    setStudioUrlState(trimmed);
    setStep("form");
  };

  const onSuccess = async (studioToken: string) => {
    try {
      await saveStudioAuth({ userId: "", studioToken });
      const me = await studioApi.get<{ data: { id: string } }>("/auth/me");
      await setStudioConfig({
        studioUrl,
        userId: me.data.id,
        studioToken,
      });
      let studioName = studioUrl;
      try {
        const studioRes = await studioApi.get<{ data: { name: string } }>(
          "/studio",
        );
        studioName = studioRes?.data?.name || studioUrl;
      } catch {}
      const added = await addWorkspace({
        studioUrl,
        studioToken,
        userId: me.data.id,
        name: studioName,
      });
      if (!added)
        toast.warning("Connected but failed to save to workspace list");
    } catch {
      toast.error("Connected but failed to load profile. Try reconnecting.");
      return;
    }
    setStep("done");
    toast.success("Connected to studio!");
  };

  const handleAccept = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !name.trim() || !email.trim()) return;
    setLoading(true);
    try {
      const inviteData = await acceptInvite(studioUrl, token, name, email);
      let studioName = studioUrl;
      try {
        const studioRes = await studioApi.get<{ data: { name: string } }>(
          "/studio",
        );
        studioName = studioRes?.data?.name || studioUrl;
      } catch {}
      const added = await addWorkspace({
        studioUrl,
        studioToken: inviteData.studioToken,
        userId: inviteData.userId,
        name: studioName,
      });
      if (!added)
        toast.warning("Connected but failed to save to workspace list");
      setStep("done");
      toast.success("Connected to studio!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to accept invite",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const emailTrimmed = email.trim().toLowerCase();
    if (!emailTrimmed || !password) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setLoading(true);
    try {
      await setStudioUrl(studioUrl);
      const res = await studioApi.post<{
        data: { studioToken?: string; step?: string; tempToken?: string };
      }>("/auth/login", {
        email: emailTrimmed,
        password,
      });
      if (res.data?.step === "totp" && res.data.tempToken) {
        setTempToken(res.data.tempToken);
        setStep("totp");
      } else if (res.data?.studioToken) {
        await onSuccess(res.data.studioToken);
      } else {
        toast.error("Unexpected login response.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (e: FormEvent) => {
    e.preventDefault();
    if (!totpCode.trim()) return;
    setLoading(true);
    try {
      const res = await studioApi.post<{
        data: { studioToken: string };
      }>("/auth/login/totp", {
        tempToken,
        code: totpCode.trim(),
      });
      if (res.data?.studioToken) {
        await onSuccess(res.data.studioToken);
      } else {
        toast.error("Unexpected TOTP response.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "TOTP verification failed",
      );
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md p-8 text-center space-y-4 border-studio-border bg-studio-bg/80">
          <ConnectedDoneScreen onDone={onConnected} />
        </Card>
      </div>
    );
  }

  if (step === "totp") {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md p-6 space-y-6 border-studio-border bg-studio-bg/80">
          <div className="space-y-2 text-center">
            <Shield className="w-8 h-8 text-primary mx-auto" />
            <h2 className="text-sm font-semibold">Two-Factor Authentication</h2>
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>
          <form onSubmit={handleTotp} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Authenticator Code
              </Label>
              <Input
                placeholder="000000"
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="bg-background/70 border-border/60 h-10 text-center text-sm font-mono tracking-[0.3em]"
                maxLength={6}
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full"
            >
              {loading ? "Verifying..." : "Verify & Connect"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setTempToken("");
                setTotpCode("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
            >
              Back to sign in
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md p-6 space-y-6 border-studio-border bg-studio-bg/80">
        {step === "url" ? (
          <StudioUrlStep
            studioUrl={studioUrl}
            onStudioUrlChange={setStudioUrlState}
            onSubmit={handleSetUrl}
          />
        ) : (
          <>
            <div className="flex border border-border/60 rounded-lg p-0.5 bg-muted/30 mb-2">
              <button
                type="button"
                onClick={() => setMode("invite")}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
                  mode === "invite"
                    ? "bg-background text-foreground border border-border/40 shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Accept Invite
              </button>
              <button
                type="button"
                onClick={() => setMode("login")}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
                  mode === "login"
                    ? "bg-background text-foreground border border-border/40 shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Sign In
              </button>
            </div>

            {mode === "invite" ? (
              <AcceptInviteFields
                token={token}
                onTokenChange={setToken}
                name={name}
                onNameChange={setName}
                email={email}
                onEmailChange={setEmail}
                loading={loading}
                onSubmit={handleAccept}
              />
            ) : (
              <>
                <div className="space-y-2 text-center">
                  <User className="w-8 h-8 text-primary mx-auto" />
                  <h2 className="text-sm font-semibold">Sign In</h2>
                  <p className="text-sm text-muted-foreground">
                    Sign in with your studio account
                  </p>
                </div>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Email
                    </Label>
                    <Input
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-background/70 border-border/60 h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Password
                    </Label>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-background/70 border-border/60 h-10"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || !email.trim() || !password}
                    className="w-full"
                  >
                    {loading ? "Signing in..." : "Sign In & Connect"}
                  </Button>
                </form>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setStep("url");
                setMode("invite");
                setToken("");
                setName("");
                setEmail("");
                setPassword("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
            >
              Change studio URL
            </button>
          </>
        )}
      </Card>
    </div>
  );
}

interface DashboardStats {
  userCount: number;
  roleCount: number;
  connectionCount: number;
  inviteCount: number;
}

interface RecentConn {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

interface RoleSummary {
  name: string;
  userCount: number;
}

interface InviteSummary {
  email: string;
  status: string;
  createdAt: string;
}

function DashboardTab({
  permissions,
  hasPermissions,
  onNavigate,
}: {
  permissions: Set<string> | undefined;
  hasPermissions: boolean;
  onNavigate?: (section: string) => void;
}) {
  const can = (resource: string) => {
    if (!hasPermissions) return true;
    if (resource === "roles")
      return (
        permissions!.has("permissions.view") ||
        hasResourcePerm(permissions!, "roles")
      );
    return hasResourcePerm(permissions!, resource);
  };

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentConns, setRecentConns] = useState<RecentConn[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [recentInvites, setRecentInvites] = useState<InviteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const promises: Promise<unknown>[] = [];
        if (can("roles"))
          promises.push(
            studioApi.get<{ data: { name: string; userCount: number }[] }>(
              "/roles",
            ),
          );
        if (can("connections"))
          promises.push(studioApi.get<{ data: RecentConn[] }>("/connections"));
        if (can("invites"))
          promises.push(studioApi.get<{ data: InviteSummary[] }>("/invites"));
        const settled = await Promise.allSettled(promises);
        let userCount = 0;
        let roleCount = 0;
        let roleData: RoleSummary[] = [];
        let connData: RecentConn[] = [];
        let inviteData: InviteSummary[] = [];
        let idx = 0;
        if (can("roles") && settled[idx]?.status === "fulfilled") {
          const res = (
            settled[idx] as PromiseFulfilledResult<{
              data: { name: string; userCount: number }[];
            }>
          ).value;
          roleData = res.data || [];
          userCount = roleData.reduce((sum, r) => sum + (r.userCount || 0), 0);
          roleCount = roleData.length;
          idx++;
        }
        if (can("connections") && settled[idx]?.status === "fulfilled") {
          const res = (
            settled[idx] as PromiseFulfilledResult<{ data: RecentConn[] }>
          ).value;
          connData = res.data || [];
          idx++;
        }
        if (can("invites") && settled[idx]?.status === "fulfilled") {
          const res = (
            settled[idx] as PromiseFulfilledResult<{ data: InviteSummary[] }>
          ).value;
          inviteData = res.data || [];
          idx++;
        }
        setStats({
          userCount,
          roleCount,
          connectionCount: connData.length,
          inviteCount: inviteData.length,
        });
        setRoles(roleData);
        const sorted = [...connData].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setRecentConns(sorted.slice(0, 5));
        const sortedInvites = [...inviteData].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setRecentInvites(sortedInvites.slice(0, 5));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Card className="p-6 border-destructive/30 text-center space-y-2">
          <Server className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      </div>
    );
  }

  const statCards = [
    can("users") && {
      label: "Users",
      value: stats?.userCount ?? 0,
      desc: "Manage and view all users",
      icon: Users,
      section: "users",
    },
    can("roles") && {
      label: "Roles",
      value: stats?.roleCount ?? 0,
      desc: "Create and manage roles",
      icon: Shield,
      section: "roles",
    },
    can("connections") && {
      label: "Connections",
      value: stats?.connectionCount ?? 0,
      desc: "View and manage connections",
      icon: Database,
      section: "connections",
    },
    can("invites") && {
      label: "Invites",
      value: stats?.inviteCount ?? 0,
      desc: "Manage and send invites",
      icon: Mail,
      section: "invites",
    },
  ].filter(Boolean) as any[];

  return (
    <div className="grid grid-cols-1 gap-px bg-border p-px">
      <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <DashboardCard
            key={card.label}
            className="cursor-pointer"
            onClick={() => onNavigate?.(card.section)}
          >
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <card.icon className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="font-normal text-xs tracking-wide">
                  {card.label}
                </CardTitle>
              </div>
              <span className="font-semibold text-sm tabular-nums">
                {card.value}
              </span>
            </CardHeader>
            <CardFooter className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{card.desc}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </CardFooter>
          </DashboardCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-2">
        {can("connections") && (
          <DashboardCard className="gap-0">
            <CardHeader className="border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Connections</CardTitle>
                <CardDescription>
                  Latest database connections in your workspace.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 px-2 shrink-0"
                onClick={() => onNavigate?.("connections")}
              >
                Manage <ArrowRight className="w-3 h-3" />
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {recentConns.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                  No connections yet
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recentConns.map((conn) => (
                    <li
                      key={conn.id}
                      className="flex h-12 items-center justify-between px-6"
                    >
                      <span className="text-sm font-medium">{conn.name}</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {conn.type}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </DashboardCard>
        )}

        {can("invites") && (
          <DashboardCard className="gap-0">
            <CardHeader className="border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Invites</CardTitle>
                <CardDescription>Latest invitations sent.</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 px-2 shrink-0"
                onClick={() => onNavigate?.("invites")}
              >
                Manage <ArrowRight className="w-3 h-3" />
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {recentInvites.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                  No invites yet
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recentInvites.map((inv, i) => (
                    <li
                      key={i}
                      className="flex h-12 items-center justify-between px-6"
                    >
                      <span className="text-sm">{inv.email}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          inv.status === "ACCEPTED"
                            ? "text-emerald-500 border-emerald-500/30"
                            : inv.status === "PENDING"
                              ? "text-amber-500 border-amber-500/30"
                              : "text-muted-foreground",
                        )}
                      >
                        {inv.status === "ACCEPTED"
                          ? "Accepted"
                          : inv.status === "PENDING"
                            ? "Pending"
                            : inv.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </DashboardCard>
        )}
      </div>

      {can("roles") && roles.length > 0 && (
        <DashboardCard className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              {roles.length} role
              {roles.length !== 1 ? "s" : ""} defined in your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">Role</TableHead>
                  <TableHead className="pe-6 text-right tabular-nums">
                    Users
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.name} className="h-12">
                    <TableCell className="ps-6 font-medium">
                      {role.name}
                    </TableCell>
                    <TableCell className="pe-6 text-right tabular-nums">
                      {role.userCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </DashboardCard>
      )}
    </div>
  );
}

function RoleEditor({
  role,
  onSaved,
  onCancel,
}: {
  role: Role | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [desc, setDesc] = useState(role?.description ?? "");
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedPerms, setSelectedPerms] = useState<number[]>(
    role?.permissions?.map((p) => p.id) ?? [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    studioApi
      .get<{ data: Permission[] }>("/permissions")
      .then((res) => setAllPermissions(res.data ?? []))
      .catch(() => {});
  }, []);

  const togglePerm = (id: number) => {
    setSelectedPerms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSaving(true);
    try {
      if (role) {
        await studioApi.put(`/roles/${role.id}`, {
          name: name.trim(),
          description: desc.trim(),
          permissionIds: selectedPerms,
        });
        toast.success("Role updated");
      } else {
        await studioApi.post("/roles", {
          name: name.trim(),
          description: desc.trim(),
          permissionIds: selectedPerms,
        });
        toast.success("Role created");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 px-2"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
        </Button>
        <div>
          <h1 className="text-sm font-semibold">
            {role ? "Edit Role" : "Create Role"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {role
              ? "Update role name, description, and permissions"
              : "Define a new role with specific permissions"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Role name"
            className="bg-background/70 border-border/60 h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Role description"
            className="bg-background/70 border-border/60 min-h-[60px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Permissions ({selectedPerms.length} selected)
          </Label>
          <div className="max-h-64 overflow-y-auto border border-studio-border rounded-lg p-2 space-y-0.5">
            {allPermissions.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">
                No permissions available
              </p>
            ) : (
              <PermissionCheckboxList
                allPermissions={allPermissions}
                selectedPerms={selectedPerms}
                togglePerm={togglePerm}
              />
            )}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : role ? "Update Role" : "Create Role"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ConnectStudioView() {
  const [auth, setAuth] = useState<{
    userId: string;
    studioToken: string;
  } | null>(null);
  const [user, setUser] = useState<StudioUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>("dashboard");
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(160);
  const sidebarRef = useRef<HTMLElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current =
        sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      preventTextSelection();
    },
    [sidebarWidth],
  );

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const diff = e.clientX - startX.current;
    const newWidth = Math.max(120, Math.min(400, startWidth.current + diff));
    setSidebarWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    allowTextSelection();
  }, [handleMouseMove]);

  useEffect(() => {
    initStudioAuth().then(() => {
      setAuth(loadStudioAuth());
      setLoading(false);
    });
  }, []);

  const loadUser = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await studioApi.get<{ data: StudioUser }>("/auth/me");
      setUser(res.data);
    } catch {
      // silent
    }
  }, [auth]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const hasPermissions = user !== null;
  const permissions = hasPermissions
    ? new Set(user!.permissions.map((p) => p.code))
    : undefined;

  const visibleItems = sidebarItems.filter((item) =>
    canAccessSection(permissions, item.value),
  );

  useEffect(() => {
    if (hasPermissions && !canAccessSection(permissions, activeSection)) {
      setActiveSection("dashboard");
    }
  }, [hasPermissions, activeSection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="h-full overflow-y-auto">
        <AcceptView
          onConnected={() => {
            setAuth(loadStudioAuth());
          }}
        />
      </div>
    );
  }

  const isRoleEditor = editingRole !== null;

  return (
    <div className="h-full flex overflow-hidden">
      <aside
        ref={sidebarRef}
        className="shrink-0 border-r border-border/60 overflow-y-auto relative flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <nav className="flex flex-col gap-1 py-3 pl-3 pr-3 flex-1">
          {visibleItems.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setActiveSection(item.value);
                setEditingRole(null);
              }}
              type="button"
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                !isRoleEditor && activeSection === item.value
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <item.icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>
        {user && (
          <UserPopover user={user}>
            <div className="shrink-0 border-t border-border/60 px-3 py-2.5 flex items-center gap-2.5">
              {user.avatarUrl ? (
                <img
                  src={`${getStudioUrl()}/api/avatars/${user.avatarUrl}`}
                  alt=""
                  className="w-7 h-7 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>
          </UserPopover>
        )}
        <div
          className="absolute top-0 -right-1.5 w-3 h-full cursor-col-resize group z-10"
          onMouseDown={handleMouseDown}
        >
          <div className="w-px h-full mx-auto group-hover:bg-blue-500/50 group-active:bg-blue-500/70 transition-colors" />
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        {isRoleEditor ? (
          <RoleEditor
            role={editingRole}
            onSaved={() => {
              setEditingRole(null);
              setActiveSection("roles");
            }}
            onCancel={() => setEditingRole(null)}
          />
        ) : activeSection === "dashboard" ? (
          <div className="h-full overflow-y-auto">
            <DashboardTab
              permissions={permissions}
              hasPermissions={hasPermissions}
              onNavigate={(section) => {
                setActiveSection(section);
                setEditingRole(null);
              }}
            />
          </div>
        ) : activeSection === "profile" && user ? (
          <ProfileTab user={user} onUserUpdate={loadUser} />
        ) : activeSection === "roles" ? (
          <RoleList
            permissions={permissions}
            onEditRole={(role) => setEditingRole(role)}
          />
        ) : activeSection === "users" ? (
          <UserList permissions={permissions} />
        ) : activeSection === "connections" ? (
          <ConnectionList permissions={permissions} />
        ) : activeSection === "invites" ? (
          <InviteList />
        ) : activeSection === "teams" ? (
          <TeamList permissions={permissions} />
        ) : activeSection === "audit_logs" ? (
          <AuditLogList />
        ) : activeSection === "query_logs" ? (
          <QueryLogList />
        ) : null}
      </div>
    </div>
  );
}
