"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Copy, CheckCircle2 } from "@/lib/icon-theme/lucide-react";
import { studioApi, StudioApiError } from "@/lib/studio-backend/api-client";
import {
  clearAllStudioData,
  getStudioUrl,
} from "@/lib/studio-backend/auth-store";
import { TeamListLayout } from "@/components/shared/team-list-utils";
import { UserPopover } from "@/components/team/user-popover";
import { toast } from "sonner";
import type {
  ApiResponse,
  Role,
  UserWithRoleResponse,
} from "@/lib/studio-backend/types";

interface UserWithRole {
  id: string;
  email: string;
  name: string;
  roleId: number;
  isActive: boolean;
  createdAt: string;
  roleName?: string;
  avatarUrl?: string | null;
}

export function UserList({ permissions }: { permissions?: Set<string> }) {
  const canManageUsers = !permissions || permissions.has("users.manage");
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<string>("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultRoleId =
    roles.find((r) => r.name === "viewer")?.id?.toString() || "";

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [rolesRes, usersRes] = await Promise.all([
        studioApi.get<ApiResponse<Role[]>>("/roles"),
        studioApi.get<ApiResponse<UserWithRoleResponse[]>>("/users"),
      ]);
      const roles = rolesRes.data || [];
      setRoles(roles);

      const allUsers: UserWithRole[] = (usersRes.data || []).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        roleId: u.roleId,
        isActive: u.isActive,
        createdAt: u.createdAt,
        roleName: u.role?.name || "Unknown",
        avatarUrl: u.avatarUrl,
      }));
      setUsers(allUsers);
    } catch (err) {
      if (err instanceof StudioApiError && err.status === 401) {
        await clearAllStudioData();
        window.location.href = "/team/accept-invite";
        return;
      }
      toast.error(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      toast.error("Email is required");
      return;
    }
    setSaving(true);
    try {
      const res = await studioApi.post<{
        data: { id: number; email: string; token: string; expiresAt: string };
      }>("/invites", {
        email: inviteEmail.trim().toLowerCase(),
        roleId: inviteRoleId ? Number(inviteRoleId) : Number(defaultRoleId),
      });
      setInviteToken(res.data.token);
      toast.success("Invite created!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create invite",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetInviteDialog() {
    setShowInvite(false);
    setInviteEmail("");
    setInviteRoleId("");
    setInviteToken(null);
  }

  return (
    <TeamListLayout
      loading={loading}
      title="Users"
      description="Manage users and invite new members"
      buttonLabel="Invite User"
      buttonDisabled={!canManageUsers}
      onButtonClick={() => {
        setShowInvite(true);
        setInviteToken(null);
      }}
    >
      <Card className="border-studio-border bg-studio-bg/50">
        <div className="divide-y divide-studio-border">
          {users.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No users yet</p>
            </div>
          ) : (
            users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <UserPopover
                    user={{ ...user, role: { name: user.roleName } }}
                  >
                    {user.avatarUrl ? (
                      <img
                        src={`${getStudioUrl()}/api/avatars/${user.avatarUrl}`}
                        alt=""
                        className="w-8 h-8 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </UserPopover>
                  <div>
                    <div className="flex items-center gap-2">
                      <UserPopover
                        user={{ ...user, role: { name: user.roleName } }}
                      >
                        <span className="text-sm font-medium">{user.name}</span>
                      </UserPopover>
                      {!user.isActive && (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {user.roleName}
                </Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Dialog open={showInvite} onOpenChange={resetInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an invite to join the studio
            </DialogDescription>
          </DialogHeader>
          {inviteToken ? (
            <div className="space-y-4">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <CheckCircle2 className="w-4 h-4" />
                  Invite created! Share this token securely:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background border border-border rounded text-xs font-mono break-all">
                    {inviteToken}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteToken);
                      toast.success("Copied!");
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This token is shown only once.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={resetInviteDialog}
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="bg-background/70 border-border/60 h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select
                  value={inviteRoleId || defaultRoleId}
                  onValueChange={setInviteRoleId}
                >
                  <SelectTrigger className="bg-background/70 border-border/60 h-10">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id.toString()}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetInviteDialog}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Generate Invite"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </TeamListLayout>
  );
}
