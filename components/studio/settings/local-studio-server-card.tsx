"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Play, Square, Server, Trash2 } from "@/lib/icon-theme/lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { openExternalUrl } from "@/lib/desktop";

type LocalServerStatus = {
  id: string;
  name: string;
  running: boolean;
  configured: boolean;
  url: string | null;
};

export function LocalStudioServerCard({ onReady }: { onReady: (url: string, email: string, password: string) => void }) {
  const [servers, setServers] = useState<LocalServerStatus[]>([]);
  const [newName, setNewName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<LocalServerStatus[]>("local_studio_status");
      setServers(result);
    } catch { /* Tauri command may not be registered during web preview */ }
  }, []);

  useEffect(() => {
    void refresh();
    if (servers.length > 0 && servers.every((server) => server.url)) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [refresh, servers]);

  const runAction = async (server: LocalServerStatus, action: "start" | "stop") => {
    setBusy(true);
    try {
      if (action === "start") {
        await invoke<LocalServerStatus[]>("local_studio_start", { serverId: server.id });
      } else {
        await invoke<LocalServerStatus[]>("local_studio_stop", { serverId: server.id });
      }
      toast.success(action === "start" ? "Local RexaDB Studio server started." : "Local RexaDB Studio server stopped.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not manage the local server.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const createServer = async () => {
    if (!newName.trim() || !email.trim() || password.length < 8) return;
    setBusy(true);
    try {
      const updated = await invoke<LocalServerStatus[]>("local_studio_create", {
        name: newName.trim(), adminEmail: email.trim().toLowerCase(), adminPassword: password,
      });
      setServers(updated);
      const created = updated.find((server) => server.name === newName.trim());
      if (created?.url) onReady(created.url, email.trim().toLowerCase(), password);
      setNewName("");
      setEmail("");
      setPassword("");
      toast.success("Local server created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the local server.");
    } finally { setBusy(false); }
  };

  const deleteServer = async (server: LocalServerStatus) => {
    setBusy(true);
    try {
      const updated = await invoke<LocalServerStatus[]>("local_studio_delete", { serverId: server.id });
      setServers(updated);
      toast.success("Local server and its stored data were deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the local server.");
    } finally { setBusy(false); }
  };

  return (
    <Card className="space-y-4 border-studio-border bg-studio-bg/50 p-4" data-setting-id="workspace-local-server">
      <div className="flex items-start gap-3">
        <Server className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">Local RexaDB Studio server</div>
          <p className="text-xs text-muted-foreground">
            Create isolated workspace servers inside RexaDB. Each server keeps its own accounts and data.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="local-studio-server-name">Server name</Label>
            <Input id="local-studio-server-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="My RexaDB server" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="local-studio-admin-email">Admin email</Label>
            <Input id="local-studio-admin-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="local-studio-admin-password">Admin password</Label>
            <Input id="local-studio-admin-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
          </div>
          <div className="sm:col-span-2">
            <Button size="sm" disabled={busy || !newName.trim() || !email.trim() || password.length < 8} onClick={() => void createServer()}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Create server
            </Button>
          </div>
      </div>

      <div className="space-y-2 border-t border-studio-border pt-4">
        <div className="text-xs font-medium text-muted-foreground">Your servers</div>
        {servers.length === 0 ? <p className="text-xs text-muted-foreground">No local servers yet.</p> : <div className="grid gap-2 sm:grid-cols-2">{servers.map((server) => (
          <div key={server.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-studio-border bg-studio-bg/30 p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{server.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">{server.url ?? (server.configured ? "Stopped" : "Setup required")}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {server.running && server.url ? <Button size="sm" variant="secondary" onClick={() => void openExternalUrl(server.url!)}><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</Button> : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runAction(server, "start")}><Play className="mr-1 h-3.5 w-3.5" />Start</Button>
              )}
              {server.running && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runAction(server, "stop")}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button>}
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void deleteServer(server)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
            </div>
          </div>
        ))}</div>}
      </div>
    </Card>
  );
}
