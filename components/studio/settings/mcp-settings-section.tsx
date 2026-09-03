"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SettingRow,
  SwitchSetting,
  SelectSetting,
} from "@/components/studio/settings-view";
import { useMcpSettings } from "@/hooks/use-mcp-settings";

function copyText(text: string, label: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`${label} copied.`),
    () => toast.error("Copy failed."),
  );
}

function ConfigSnippet({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => copyText(text, title)}
        >
          Copy
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto rounded-lg border border-border/60 bg-secondary/20 p-2.5 font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

export function McpSettingsSection() {
  const {
    data,
    loading,
    saving,
    error,
    lastToken,
    clearLastToken,
    saveConfig,
    toggleConnection,
    setAllExposed,
    regenerateToken,
    revealToken,
    createMode,
    updateMode,
    deleteMode,
  } = useMcpSettings();

  const [search, setSearch] = useState("");
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const [modeLabel, setModeLabel] = useState("");
  const [modeRead, setModeRead] = useState(true);
  const [modeWrite, setModeWrite] = useState(false);

  const filteredConnections = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.connections;
    return data.connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dbType.toLowerCase().includes(q) ||
        String(c.id).includes(q),
    );
  }, [data, search]);

  const stdio = data?.stdio ?? null;
  const stdioSnippet = useMemo(() => {
    if (!stdio) return "Start the RexaDB sidecar first — the stdio command is generated from it.";
    return JSON.stringify(
      {
        mcpServers: {
          rexadb: {
            command: stdio.command,
            args: stdio.args,
            env: stdio.env,
          },
        },
      },
      null,
      2,
    );
  }, [stdio]);

  const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const stdioAddCmd = useMemo(() => {
    if (!stdio) return "";
    const parts = [shellQuote(stdio.command), ...stdio.args.map(shellQuote)];
    const env = Object.entries(stdio.env || {})
      .map(([k, v]) => `--env ${k}=${shellQuote(v)}`)
      .join(" ");
    return `claude mcp add --transport stdio rexadb ${env} -- ${parts.join(" ")}`.replace(/\s+/g, " ");
  }, [stdio]);

  if (loading || !data) {
    return (
      <section className="space-y-5">
        <h2 className="text-sm font-semibold">MCP Server</h2>
        <p className="text-xs text-muted-foreground">
          {error ? `Failed to load MCP settings: ${error}` : "Loading MCP settings…"}
        </p>
      </section>
    );
  }

  const { config, modes, httpUrl } = data;
  const activeMode = modes.find((m) => m.id === config.modeId);
  const httpEnabled = config.transports === "http" || config.transports === "both";
  const httpAddCmd =
    `claude mcp add --transport http rexadb ${httpUrl} --header ${shellQuote(`Authorization: Bearer ${lastToken || "<TOKEN — click Show above first>"}`)}`;
  const customModes = modes.filter((m) => m.kind === "custom" || m.id.startsWith("custom:"));

  const openCreateDialog = () => {
    setEditingModeId(null);
    setModeLabel("");
    setModeRead(true);
    setModeWrite(false);
    setModeDialogOpen(true);
  };

  const openEditDialog = (id: string) => {
    const m = modes.find((x) => x.id === id);
    if (!m || (!m.id.startsWith("custom:") && m.kind !== "custom")) return;
    setEditingModeId(m.id);
    setModeLabel(m.label);
    setModeRead(m.allowSqlRead);
    setModeWrite(m.allowSqlWrite);
    setModeDialogOpen(true);
  };

  const submitModeDialog = async () => {
    const label = modeLabel.trim() || "Custom mode";
    if (editingModeId) {
      await updateMode(editingModeId, { label, allowSqlRead: modeRead, allowSqlWrite: modeWrite });
    } else {
      await createMode({ label, allowSqlRead: modeRead, allowSqlWrite: modeWrite });
    }
    setModeDialogOpen(false);
  };

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">MCP Server</h2>
        <p className="text-xs text-muted-foreground">
          Expose saved connections to external AI clients with a permission
          mode. Connection strings are never revealed — clients only see ids,
          names and types.
        </p>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Server</h3>

        <SwitchSetting
          title="Enable MCP server"
          description="When off, all MCP tools refuse with a disabled error."
          value={config.enabled}
          onChange={(v) => void saveConfig({ enabled: v })}
        />

        <SelectSetting
          title="Transports"
          description={`HTTP runs on the sidecar itself (${httpUrl}).`}
          value={config.transports}
          onValueChange={(v) => {
            if (v === "stdio" || v === "http" || v === "both") void saveConfig({ transports: v });
          }}
          options={[
            { value: "both", label: "stdio + HTTP" },
            { value: "stdio", label: "stdio only" },
            { value: "http", label: "HTTP only" },
          ]}
          width="w-40"
        />

        {httpEnabled ? (
          <SettingRow
            title="HTTP auth token"
            description={
              config.hasAuthToken
                ? "Clients must send it as a Bearer header."
                : "No token yet — one is minted on enable."
            }
          >
            <span className="flex gap-1.5">
              {config.hasAuthToken ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2.5 text-xs"
                  disabled={saving}
                  onClick={() => void revealToken()}
                >
                  Show
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2.5 text-xs"
                disabled={saving}
                onClick={() => void regenerateToken()}
              >
                Regenerate
              </Button>
            </span>
          </SettingRow>
        ) : null}

        {lastToken ? (
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {lastToken}
            </code>
            <span className="flex shrink-0 gap-1.5 pl-2">
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(lastToken, "Token")}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={clearLastToken}
              >
                Dismiss
              </Button>
            </span>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium">Permission mode</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs"
            onClick={openCreateDialog}
          >
            New mode
          </Button>
        </div>

        <SelectSetting
          title="Active mode"
          description={
            activeMode?.description ||
            "Read-only inspects only; autopilot also runs writes. Applies to every exposed connection."
          }
          value={config.modeId}
          onValueChange={(v) => void saveConfig({ modeId: v })}
          options={modes.map((m) => ({
            value: m.id,
            label: `${m.label} — ${m.allowSqlWrite ? "read + write" : m.allowSqlRead ? "read-only" : "no data access"}`,
          }))}
          width="w-64"
        />

        {customModes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Custom modes</span>
            <div className="flex flex-col gap-1.5">
              {customModes.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-foreground">
                      {m.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m.allowSqlWrite ? "read + write" : "read-only"}
                    </span>
                  </div>
                  <span className="flex gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => openEditDialog(m.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                      onClick={() => void deleteMode(m.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <h3 className="text-sm font-medium">
              Exposed connections ({config.exposedConnectionIds.length}/{data.connections.length})
            </h3>
            <span className="text-xs text-muted-foreground">
              Only checked connections are visible to MCP clients.
            </span>
          </div>
          <span className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => void setAllExposed(true)}
            >
              All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => void setAllExposed(false)}
            >
              None
            </Button>
          </span>
        </div>

        <Input
          className="h-8 bg-secondary/50 border-border text-xs"
          placeholder="Search connections…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="max-h-64 space-y-1 overflow-auto">
          {filteredConnections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {data.connections.length === 0
                ? "No saved connections yet — add one in the connection manager first."
                : "No connections match this search."}
            </p>
          ) : (
            filteredConnections.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 hover:border-border/60 hover:bg-secondary/20"
              >
                <Checkbox
                  checked={c.exposed}
                  onCheckedChange={() => void toggleConnection(c.id)}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {c.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {c.dbType}
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <h3 className="text-sm font-medium">Client setup</h3>
        <p className="-mt-2 text-xs text-muted-foreground">
          Paths and data dir are filled in from the running sidecar, so these
          work from any working directory.
        </p>

        <ConfigSnippet title="Claude Desktop / Cursor (stdio JSON)" text={stdioSnippet} />
        {stdio && !stdio.available ? (
          <p className="text-xs text-muted-foreground">
            The stdio entry isn&apos;t on disk for this sidecar build — use HTTP, or run the sidecar from the repo checkout.
          </p>
        ) : null}
        <ConfigSnippet title="Claude Code (stdio, terminal)" text={stdioAddCmd} />
        {httpEnabled ? (
          <>
            <ConfigSnippet
              title="Generic HTTP client"
              text={`URL: ${httpUrl}\nHeader: Authorization: Bearer ${lastToken || "<click Show above to reveal>"}`}
            />
            <ConfigSnippet title="Claude Code (HTTP, terminal)" text={httpAddCmd} />
          </>
        ) : null}
      </div>

      <Dialog open={modeDialogOpen} onOpenChange={setModeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModeId ? "Edit mode" : "New permission mode"}</DialogTitle>
            <DialogDescription>
              Modes bundle read/write permissions applied to every exposed connection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                className="h-8 bg-secondary/50 border-border text-xs"
                value={modeLabel}
                onChange={(e) => setModeLabel(e.target.value)}
                placeholder="e.g. Analytics read-only"
              />
            </div>
            <SwitchSetting
              title="Allow reading data"
              description="Schema, samples, SELECT."
              value={modeRead}
              onChange={setModeRead}
            />
            <SwitchSetting
              title="Allow writes (autopilot)"
              description="INSERT, UPDATE, DELETE, DDL."
              value={modeWrite}
              onChange={setModeWrite}
            />
            {!modeRead && !modeWrite ? (
              <p className="text-xs text-muted-foreground">
                With both off, clients can only list connections and describe them.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModeDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitModeDialog()} disabled={saving}>
              {editingModeId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
