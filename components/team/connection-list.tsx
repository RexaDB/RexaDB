"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { TeamListLayout, fetchTeamList } from "@/components/shared/team-list-utils";
import { Database, Plus, Pencil, Trash2, Key, Shield, Users } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { studioApi } from "@/lib/studio-backend/api-client";
import { toast } from "sonner";
import type { Connection, Role, ConnectionAccess, AccessType } from "@/lib/studio-backend/types";

export function ConnectionList({ permissions }: { permissions?: Set<string> }) {
  const permCheck = (action: string) =>
    !permissions || permissions.has(`connections.${action}`);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingConn, setEditingConn] = useState<Connection | null>(null);
  const [deleteConn, setDeleteConn] = useState<Connection | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"postgres" | "mysql">("postgres");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("5432");
  const [formDb, setFormDb] = useState("");
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formSsl, setFormSsl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [formAccess, setFormAccess] = useState<Record<number, AccessType>>({});
  const [accessMap, setAccessMap] = useState<Map<string, ConnectionAccess[]>>(new Map());
  const [loadingRoles, setLoadingRoles] = useState(false);

  useEffect(() => {
    loadData();
    loadRoles();
  }, []);

  useEffect(() => {
    if (!permCheck("manage_access") || connections.length === 0) return;
    const map = new Map<string, ConnectionAccess[]>();
    let cancelled = false;
    Promise.all(
      connections.map(async (conn) => {
        try {
          const res = await studioApi.get<{ data: ConnectionAccess[] }>(
            `/connections/${conn.id}/access`,
          );
          if (!cancelled) map.set(conn.id, res.data || []);
        } catch {
          /* no access data */
        }
      }),
    ).then(() => {
      if (!cancelled) setAccessMap(map);
    });
    return () => { cancelled = true; };
  }, [connections, permissions]);

  async function loadRoles() {
    setLoadingRoles(true);
    try {
      const res = await studioApi.get<{ data: Role[] }>("/roles");
      setRoles(res.data || []);
    } catch {
      /* roles not available */
    }
    setLoadingRoles(false);
  }

  async function loadData() {
    await fetchTeamList("/connections", setConnections, setLoading, "Failed to load connections");
  }

  function openCreate() {
    setEditingConn(null);
    setFormName("");
    setFormType("postgres");
    setFormHost("");
    setFormPort("5432");
    setFormDb("");
    setFormUser("");
    setFormPass("");
    setFormSsl(false);
    setFormAccess({});
    setShowDialog(true);
  }

  function handleTypeChange(type: string) {
    setFormType(type as "postgres" | "mysql");
    setFormPort(type === "mysql" ? "3306" : "5432");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (
      !formName.trim() ||
      !formHost.trim() ||
      !formDb.trim() ||
      !formUser.trim()
    ) {
      toast.error("Name, host, database, and username are required");
      return;
    }
    if (!editingConn && !formPass) {
      toast.error("Password is required for new connections");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        type: formType,
        host: formHost.trim(),
        port: Number(formPort),
        database: formDb.trim(),
        username: formUser.trim(),
        ssl: formSsl,
      };
      if (formPass) {
        payload.password = formPass;
      }
      let connId: string;
      if (editingConn) {
        await studioApi.put(`/connections/${editingConn.id}`, payload);
        connId = editingConn.id;
        toast.success("Connection updated");
      } else {
        const res = await studioApi.post<{ data: { id: string } }>(
          "/connections",
          payload,
        );
        connId = res.data.id;
        toast.success("Connection created");
      }

      if (permCheck("manage_access")) {
        let accessErrors = 0;
        const entries = Object.entries(formAccess) as [string, AccessType][];
        for (const [roleId, accessType] of entries) {
          try {
            await studioApi.put(`/connections/${connId}/access`, {
              roleId: Number(roleId),
              accessType,
            });
          } catch {
            accessErrors++;
          }
        }
        if (accessErrors > 0) {
          toast.error(
            `${accessErrors} access rule(s) failed to save. Connection was saved.`,
          );
        }
      }

      setShowDialog(false);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save connection",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConn) return;
    try {
      await studioApi.del(`/connections/${deleteConn.id}`);
      toast.success("Connection deleted");
      setDeleteConn(null);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete connection",
      );
    }
  }

  return (
    <TeamListLayout
      loading={loading}
      title="Connections"
      description="Managed database connections"
      buttonLabel="Add Connection"
      buttonDisabled={!permCheck("create")}
      onButtonClick={openCreate}
    >

      <div className="grid gap-3">
        {connections.length === 0 ? (
          <Card className="p-8 text-center border-studio-border">
            <Database className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No connections yet</p>
          </Card>
        ) : (
          connections.map((conn) => (
            <Card
              key={conn.id}
              className="p-4 border-studio-border bg-studio-bg/50 hover:bg-studio-bg/80 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{conn.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {conn.type}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {conn.host}:{conn.port}/{conn.database}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    User: {conn.username}
                    {conn.ssl ? " • SSL" : ""}
                  </p>
                  {permCheck("manage_access") && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {(accessMap.get(conn.id) || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground/50 italic">
                          Restricted access
                        </span>
                      ) : (
                        (accessMap.get(conn.id) || []).map((a) => (
                          <Badge
                            key={a.roleId}
                            variant={
                              a.accessType === "FULL_ACCESS"
                                ? "default"
                                : "outline"
                            }
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            {a.role.name}:{" "}
                            {a.accessType === "FULL_ACCESS"
                              ? "Full"
                              : a.accessType === "READ_ONLY"
                                ? "Read"
                                : a.accessType === "READ_AND_REQUEST"
                                  ? "R&R"
                                  : "Custom"}
                          </Badge>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!permCheck("update")}
                    onClick={async () => {
                      setEditingConn(conn);
                      setFormName(conn.name);
                      setFormType(conn.type);
                      setFormHost(conn.host);
                      setFormPort(
                        conn.port != null ? conn.port.toString() : "",
                      );
                      setFormDb(conn.database);
                      setFormUser(conn.username);
                      setFormPass("");
                      setFormSsl(conn.ssl);
                      setFormAccess({});
                      if (permCheck("manage_access")) {
                        try {
                          const res = await studioApi.get<{
                            data: ConnectionAccess[];
                          }>(`/connections/${conn.id}/access`);
                          const access: Record<number, AccessType> = {};
                          for (const a of res.data || []) {
                            access[a.roleId] = a.accessType;
                          }
                          setFormAccess(access);
                        } catch {
                          /* no access data */
                        }
                      }
                      setShowDialog(true);
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8",
                      permCheck("delete")
                        ? "text-destructive hover:text-destructive"
                        : "",
                    )}
                    disabled={!permCheck("delete")}
                    onClick={() => setDeleteConn(conn)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingConn ? "Edit Connection" : "Add Connection"}
            </DialogTitle>
            <DialogDescription>
              {editingConn
                ? "Update connection details"
                : "Add a new database connection"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                placeholder="Production DB"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="bg-background/70 border-border/60 h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={formType} onValueChange={handleTypeChange}>
                <SelectTrigger className="bg-background/70 border-border/60 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postgres">PostgreSQL</SelectItem>
                  <SelectItem value="mysql">MySQL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Host</Label>
                <Input
                  placeholder="localhost"
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                  className="bg-background/70 border-border/60 h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Port</Label>
                <Input
                  placeholder="5432"
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                  className="bg-background/70 border-border/60 h-10"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Database</Label>
              <Input
                placeholder="mydb"
                value={formDb}
                onChange={(e) => setFormDb(e.target.value)}
                className="bg-background/70 border-border/60 h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Username
                </Label>
                <Input
                  placeholder="admin"
                  value={formUser}
                  onChange={(e) => setFormUser(e.target.value)}
                  className="bg-background/70 border-border/60 h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  <Key className="w-3 h-3 inline mr-1" />
                  Password
                </Label>
                <Input
                  type="password"
                  placeholder={editingConn ? "Leave blank to keep" : "Password"}
                  value={formPass}
                  onChange={(e) => setFormPass(e.target.value)}
                  className="bg-background/70 border-border/60 h-10"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="ssl" checked={formSsl} onCheckedChange={setFormSsl} />
              <Label htmlFor="ssl" className="text-xs text-muted-foreground">
                Use SSL
              </Label>
            </div>

            {permCheck("manage_access") && (
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    <Shield className="w-3 h-3 inline mr-1" />
                    Connection Access
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {Object.keys(formAccess).length} role
                    {Object.keys(formAccess).length !== 1 ? "s" : ""} with
                    access
                  </span>
                </div>
                {roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {loadingRoles
                      ? "Loading roles..."
                      : "No roles available"}
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {roles.map((role) => (
                      <div
                        key={role.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{role.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            <Users className="w-3 h-3 inline mr-0.5" />
                            {role.userCount || 0} users
                          </p>
                        </div>
                        <Select
                          value={formAccess[role.id] || "NO_ACCESS"}
                          onValueChange={(v) => {
                            setFormAccess((prev) => {
                              const next = { ...prev };
                              if (v === "NO_ACCESS") {
                                delete next[role.id];
                              } else {
                                next[role.id] = v as AccessType;
                              }
                              return next;
                            });
                          }}
                          disabled={saving}
                        >
                          <SelectTrigger className="w-32 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NO_ACCESS">
                              No access
                            </SelectItem>
                            <SelectItem value="FULL_ACCESS">
                              Full access
                            </SelectItem>
                            <SelectItem value="READ_ONLY">
                              Read only
                            </SelectItem>
                            <SelectItem value="READ_AND_REQUEST">
                              Read & request
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                  : editingConn
                    ? "Update"
                    : "Create Connection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConn} onOpenChange={() => setDeleteConn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConn?.name}"? This will
              remove all associated access rules, saved queries, and logs.
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
