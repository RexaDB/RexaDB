"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Table2,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyStatePresentational } from "@/components/studio/database/empty-state-presentational";
import { runQuery } from "@/lib/api/actions-client";
import type { StoragePolicy } from "@/lib/studio/storage-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const POLICY_TEMPLATES = [
  {
    id: "select",
    command: "SELECT",
    title: "Select policy for bucket",
    description: "Allow SELECT for buckets matching a given condition",
  },
  {
    id: "insert",
    command: "INSERT",
    title: "Insert policy for bucket",
    description: "Allow INSERT for buckets matching a given condition",
  },
  {
    id: "update",
    command: "UPDATE",
    title: "Update policy for bucket",
    description: "Allow UPDATE for buckets matching a given condition",
  },
  {
    id: "delete",
    command: "DELETE",
    title: "Delete policy for bucket",
    description: "Allow DELETE for buckets matching a given condition",
  },
] as const;

export function StoragePoliciesView({ studio }: { studio: any }) {
  const connectionString: string =
    studio.currentConnectionString || studio.connection?.connectionString || "";
  const [policies, setPolicies] = useState<StoragePolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(true);

  const loadPolicies = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    try {
      const res = await runQuery(
        connectionString,
        `SELECT
           n.nspname AS schema,
           c.relname AS table_name,
           p.polname AS name,
           CASE p.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
           COALESCE(
             (SELECT array_agg(r.rolname::text)
              FROM pg_roles r
              WHERE r.oid = ANY (p.polroles)),
             ARRAY['public']::text[]
           ) AS roles,
           CASE p.polcmd
             WHEN 'r' THEN 'SELECT'
             WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE'
             WHEN 'd' THEN 'DELETE'
             ELSE 'ALL'
           END AS command,
           pg_get_expr(p.polqual, p.polrelid) AS using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'storage'
           AND c.relname IN ('objects', 'buckets')
         ORDER BY c.relname, p.polname`,
      );
      if (res?.success === false || (res as any)?.error) throw new Error((res as any)?.error ?? "Query failed.");
      setPolicies((((res as any)?.data?.rows ?? (res as any)?.rows ?? [])) as StoragePolicy[]);
    } catch (e) {
      setPolicies([]);
      console.warn("[storage] failed to list policies:", e);
    } finally {
      setLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return policies;
    return policies.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.table_name.toLowerCase().includes(q) ||
        p.command.toLowerCase().includes(q),
    );
  }, [policies, search]);

  const byTable = useMemo(() => {
    const map = new Map<string, StoragePolicy[]>();
    for (const p of filtered) {
      const list = map.get(p.table_name) ?? [];
      list.push(p);
      map.set(p.table_name, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function openCreate(command?: string) {
    // Reuse the existing RLS policy editor tab when available.
    if (studio.openRlsPolicyCreateTab) {
      studio.openRlsPolicyCreateTab("storage", "objects");
      return;
    }
    if (studio.openDatabaseTab) {
      studio.openDatabaseTab("rls-policies");
      toast.message(
        command
          ? `Create a ${command} policy on storage.objects`
          : "Create a new policy on storage.objects",
      );
      return;
    }
    toast.message("Open Database → RLS Policies to create storage policies.");
  }

  const empty = !loading && policies.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center justify-between gap-4 border-b border-studio-border px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Policies</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Control Storage access with Row Level Security policies on{" "}
            <code className="rounded bg-muted px-1">storage.objects</code> and{" "}
            <code className="rounded bg-muted px-1">storage.buckets</code>.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadPolicies()}
            disabled={loading}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 size-3.5" />
                New policies
                <ChevronDown className="ml-1.5 size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => openCreate()}>
                Create policy from scratch
              </DropdownMenuItem>
              {POLICY_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => openCreate(t.command)}>
                  {t.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!empty && (
          <div className="mb-4 flex items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter policies"
                className="h-9 pl-9 text-xs"
              />
            </div>
          </div>
        )}

        {loading && policies.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            Loading storage policies…
          </div>
        ) : empty ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <EmptyStatePresentational
              icon={Shield}
              title="No policies created yet"
              description={
                <>
                  Storage is protected by policies — without them buckets stay private.
                  Create policies to control who can read and write objects.
                </>
              }
            >
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openCreate()}>
                  <Plus className="mr-1.5 size-3.5" />
                  Create policy from scratch
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowTemplates((v) => !v)}
                >
                  {showTemplates ? "Hide templates" : "Show templates"}
                </Button>
              </div>
            </EmptyStatePresentational>

            {showTemplates && (
              <div className="overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between bg-muted/30 px-4 py-3 text-left"
                  onClick={() => setShowTemplates((v) => !v)}
                >
                  <span className="text-sm font-medium text-foreground">
                    Get started quickly
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      showTemplates && "rotate-180",
                    )}
                  />
                </button>
                <div className="divide-y divide-border">
                  {POLICY_TEMPLATES.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{t.title}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => openCreate(t.command)}
                      >
                        <Plus className="mr-1 size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {byTable.map(([tableName, tablePolicies]) => (
              <div
                key={tableName}
                className="overflow-hidden rounded-lg border border-border bg-card/40 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Table2 className="size-3.5 shrink-0 text-primary/60" />
                    <span className="truncate text-xs font-semibold text-foreground">
                      storage.{tableName}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {tablePolicies.length}{" "}
                      {tablePolicies.length === 1 ? "policy" : "policies"}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => openCreate()}
                  >
                    <Plus className="mr-1 size-3" />
                    New policy
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_100px_120px_1fr] gap-2 border-b border-border/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Policy</span>
                  <span>Command</span>
                  <span>Mode</span>
                  <span>Using</span>
                </div>
                <div className="divide-y divide-border/60">
                  {tablePolicies.map((p) => (
                    <div
                      key={`${p.table_name}.${p.name}.${p.command}`}
                      className="grid grid-cols-[1fr_100px_120px_1fr] items-center gap-2 px-4 py-3 text-xs hover:bg-muted/20"
                    >
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      <span className="text-primary/80">{p.command}</span>
                      <Badge variant="secondary" className="w-fit text-[10px]">
                        {String(p.permissive).toUpperCase()}
                      </Badge>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.using_expression || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
