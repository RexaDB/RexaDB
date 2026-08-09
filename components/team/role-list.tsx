"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TeamListLayout } from "@/components/shared/team-list-utils";
import { Shield, Plus, Pencil, Trash2, Users } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { PermissionRow } from "@/components/shared/permission-row";
import {
  studioApi,
  handleStudio401Error,
} from "@/lib/studio-backend/api-client";
import { toast } from "sonner";
import type { ApiResponse, Role, Permission } from "@/lib/studio-backend/types";

export function RoleList({
  permissions,
  onEditRole,
}: {
  permissions?: Set<string>;
  onEditRole?: (role: Role | null) => void;
}) {
  const canManageRoles = !permissions || permissions.has("roles.manage");
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPerms, setFormPerms] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [rolesRes, permsRes] = await Promise.all([
        studioApi.get<ApiResponse<Role[]>>("/roles"),
        studioApi.get<ApiResponse<Permission[]>>("/permissions"),
      ]);
      setRoles(rolesRes.data || []);
      setAllPermissions(permsRes.data || []);
    } catch (err) {
      if (await handleStudio401Error(err)) return;
      toast.error(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingRole(null);
    setFormName("");
    setFormDesc("");
    setFormPerms([]);
    setShowDialog(true);
  }

  function openEdit(role: Role) {
    setEditingRole(role);
    setFormName(role.name);
    setFormDesc(role.description);
    setFormPerms(role.permissions?.map((p) => p.id) || []);
    setShowDialog(true);
  }

  function togglePerm(id: number) {
    setFormPerms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSaving(true);
    try {
      if (editingRole) {
        await studioApi.put(`/roles/${editingRole.id}`, {
          name: formName.trim(),
          description: formDesc.trim(),
          permissionIds: formPerms,
        });
        toast.success("Role updated");
      } else {
        await studioApi.post("/roles", {
          name: formName.trim(),
          description: formDesc.trim(),
          permissionIds: formPerms,
        });
        toast.success("Role created");
      }
      setShowDialog(false);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteRole) return;
    try {
      await studioApi.del(`/roles/${deleteRole.id}`);
      toast.success("Role deleted");
      setDeleteRole(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete role");
    }
  }

  return (
    <TeamListLayout
      loading={loading}
      title="Roles"
      description="Manage roles and their permissions"
      buttonLabel="Create Role"
      buttonDisabled={!canManageRoles}
      onButtonClick={openCreate}
    >
      <div className="grid gap-3">
        {roles.length === 0 ? (
          <Card className="p-8 text-center border-studio-border">
            <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No roles yet</p>
          </Card>
        ) : (
          roles.map((role) => (
            <Card
              key={role.id}
              className="p-4 border-studio-border bg-studio-bg/50 hover:bg-studio-bg/80 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{role.name}</span>
                    {role.isSystem && (
                      <Badge variant="secondary" className="text-xs">
                        System
                      </Badge>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-sm text-muted-foreground">
                      {role.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {role.userCount} users
                    </span>
                    <span>{role.permissions?.length || 0} permissions</span>
                  </div>
                </div>
                {!role.isSystem && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!canManageRoles}
                      onClick={() =>
                        onEditRole ? onEditRole(role) : openEdit(role)
                      }
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8",
                        canManageRoles
                          ? "text-destructive hover:text-destructive"
                          : "",
                      )}
                      disabled={!canManageRoles}
                      onClick={() => setDeleteRole(role)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? "Edit Role" : "Create Role"}
            </DialogTitle>
            <DialogDescription>
              {editingRole
                ? "Update role name, description, and permissions"
                : "Define a new role with specific permissions"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                placeholder="Role name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="bg-background/70 border-border/60 h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                placeholder="Role description"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="bg-background/70 border-border/60 min-h-[60px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Permissions ({formPerms.length} selected)
              </Label>
              <div className="max-h-48 overflow-y-auto border border-studio-border rounded-lg p-2 space-y-0.5">
                {allPermissions.map((perm) => (
                  <PermissionRow
                    key={perm.id}
                    perm={perm}
                    selected={formPerms.includes(perm.id)}
                    onToggle={togglePerm}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingRole
                    ? "Update Role"
                    : "Create Role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRole} onOpenChange={() => setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteRole?.name}"? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TeamListLayout>
  );
}
