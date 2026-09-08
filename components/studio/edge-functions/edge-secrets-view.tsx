"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import { useConfirm } from "@/hooks/use-confirm";
import {
  deleteEdgeSecrets,
  listEdgeSecrets,
  resolveEdgeAccess,
  timeAgo,
  upsertEdgeSecrets,
  type EdgeAccess,
  type EdgeSecret,
} from "@/lib/studio/edge-functions-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function EdgeSecretsView({ studio }: { studio: any }) {
  const connectionType: string | undefined =
    studio.connection?.connectionType ?? studio.dbType;
  const connectionString: string | undefined =
    studio.currentConnectionString || studio.connection?.connectionString;
  const confirm = useConfirm();
  const [secrets, setSecrets] = useState<EdgeSecret[]>([]);
  const [access, setAccess] = useState<EdgeAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSecrets = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    const { access: resolved, error: accessError } = await resolveEdgeAccess(
      connectionType,
      connectionString,
    );
    if (!resolved) {
      setSecrets([]);
      setAccess(null);
      setLoadError(accessError ?? "Secrets are unavailable here.");
      setLoading(false);
      return;
    }
    setAccess(resolved);
    const { secrets: list, error } = await listEdgeSecrets(resolved);
    setSecrets(list);
    setLoadError(error ?? null);
    if (error) toast.error(error);
    setLoading(false);
  }, [connectionString, connectionType]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return secrets;
    return secrets.filter((s) => s.name.toLowerCase().includes(q));
  }, [secrets, search]);

  function openAdd() {
    setEditName(null);
    setNameDraft("");
    setValueDraft("");
    setDialogOpen(true);
  }

  function openEdit(secret: EdgeSecret) {
    setEditName(secret.name);
    setNameDraft(secret.name);
    setValueDraft("");
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = nameDraft.trim();
    if (!name) {
      toast.error("Secret name is required.");
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      toast.error(
        "Use letters, numbers, and underscores, starting with a letter or underscore.",
      );
      return;
    }
    if (!valueDraft) {
      toast.error("Secret value is required.");
      return;
    }
    if (!access) return;
    setSaving(true);
    try {
      const { error } = await upsertEdgeSecrets(access, [
        { name, value: valueDraft },
      ]);
      if (error) throw new Error(error);
      toast.success(
        editName ? `Secret "${name}" updated.` : `Secret "${name}" added.`,
      );
      setDialogOpen(false);
      setValueDraft("");
      await loadSecrets();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save secret");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(secret: EdgeSecret) {
    if (!access) return;
    const ok = await confirm({
      title: "Delete secret",
      description: `Delete secret "${secret.name}"? Functions using it will break on next deploy.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      const { error } = await deleteEdgeSecrets(access, [secret.name]);
      if (error) throw new Error(error);
      toast.success(`Secret "${secret.name}" deleted.`);
      await loadSecrets();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete secret");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Secrets
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Environment variables for your Edge Functions. Values are
            write-only and never shown back.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadSecrets()}
            disabled={loading}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1.5 size-3.5" />
            Add secret
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search secrets…"
            className="h-9 pl-9 text-xs"
          />
        </div>

        {loading && secrets.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            Loading secrets…
          </div>
        ) : loadError && secrets.length === 0 ? (
          <div className="mx-auto w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
            <div className="text-sm font-medium text-foreground">
              Failed to load secrets
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {loadError}
            </p>
            <Button size="sm" className="mt-3" onClick={() => void loadSecrets()}>
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyStatePresentational
            icon={KeyRound}
            title={search ? "No matching secrets" : "No secrets yet"}
            description={
              search
                ? "Try a different search term."
                : "Add a secret to expose it as an environment variable in your functions."
            }
          >
            {!search && (
              <Button size="sm" className="mt-2" onClick={openAdd}>
                <Plus className="mr-1.5 size-3.5" />
                Add secret
              </Button>
            )}
          </EmptyStatePresentational>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[minmax(180px,1fr)_minmax(0,1fr)_140px_80px] gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Name</span>
              <span>Value</span>
              <span>Updated</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {visible.map((s) => (
                <div
                  key={s.name}
                  className="grid grid-cols-[minmax(180px,1fr)_minmax(0,1fr)_140px_80px] items-center gap-2 px-4 py-3 text-xs hover:bg-muted/20"
                >
                  <span className="truncate font-mono text-[11px] font-medium text-foreground">
                    {s.name}
                  </span>
                  <span
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={
                      s.value ? `sha256:${s.value.slice(0, 16)}…` : undefined
                    }
                  >
                    ••••••••
                  </span>
                  <span className="truncate text-muted-foreground">
                    {timeAgo(s.updated_at)}
                  </span>
                  <span className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${s.name}`}
                      title="Update value"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => openEdit(s)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${s.name}`}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={() => void handleDelete(s)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editName ? `Update "${editName}"` : "Add a new secret"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="MY_API_KEY"
                autoFocus
                disabled={!!editName}
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                placeholder="Secret value"
                className="h-9 font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Values are write-only — they can&apos;t be read back after
                saving.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : editName ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
