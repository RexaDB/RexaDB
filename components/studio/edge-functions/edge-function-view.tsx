"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  BarChart3,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  File as FileIcon,
  HelpCircleIcon,
  Plus,
  RefreshCw,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import { FunctionEventsExplorer } from "./edge-function-events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/hooks/use-confirm";
import { useTheme } from "next-themes";
import {
  registerCustomMonacoThemes,
  getStudioDarkTheme,
  resolveEditorThemeId,
} from "@/lib/studio/editor-themes";
import {
  deleteEdgeFunction,
  deployEdgeFunction,
  edgeFunctionUrl,
  fetchFunctionBody,
  fetchFunctionEvents,
  getEdgeFunction,
  resolveEdgeAccess,
  timeAgo,
  updateEdgeFunction,
  type CodeFile,
  type EdgeAccess,
  type EdgeFunction,
  type FunctionEvent,
} from "@/lib/studio/edge-functions-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** "Sep 8, 9:00pm" axis labels. */
function formatChartAxis(t: number): string {
  const d = new Date(t);
  let h = d.getHours();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 === 0 ? 12 : h % 12;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${h}:${pad(d.getMinutes())}${suffix}`;
}

const MonacoCodeEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading editor…
      </div>
    ),
  },
);

export function EdgeFunctionView({
  studio,
  functionName,
}: {
  studio: any;
  functionName: string;
}) {
  const connectionType: string | undefined =
    studio.connection?.connectionType ?? studio.dbType;
  const connectionString: string | undefined =
    studio.currentConnectionString || studio.connection?.connectionString;
  const confirm = useConfirm();

  // Same editor theme resolution as the SQL editor.
  const { theme, resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme || theme;
  const codeEditorThemeId = resolveEditorThemeId(
    studio.effectiveEditorThemeId || "auto",
    currentTheme,
    studio.appEditorTheme?.id,
  );
  const codeFontSize =
    (typeof studio.editorFontSize === "string"
      ? parseInt(studio.editorFontSize, 10)
      : studio.editorFontSize) || 13;

  const [access, setAccess] = useState<EdgeAccess | null>(null);
  const [fn, setFn] = useState<EdgeFunction | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<
    "overview" | "invocations" | "logs" | "code" | "settings"
  >("overview");

  // Code tab
  const [codeFiles, setCodeFiles] = useState<CodeFile[]>([]);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoaded, setCodeLoaded] = useState(false);
  const [activeCodeFile, setActiveCodeFile] = useState(0);
  const [extraFiles, setExtraFiles] = useState<CodeFile[]>([]);
  const [codeEdits, setCodeEdits] = useState<Record<string, string>>({});
  const [addFileOpen, setAddFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [deploying, setDeploying] = useState(false);

  const allCodeFiles = useMemo(
    () => [...codeFiles, ...extraFiles],
    [codeFiles, extraFiles],
  );

  const codeDirty = useMemo(() => {
    if (extraFiles.length > 0) return true;
    const originals = new Map(codeFiles.map((f) => [f.name, f.content]));
    return Object.entries(codeEdits).some(
      ([name, content]) => originals.get(name) !== content,
    );
  }, [extraFiles, codeFiles, codeEdits]);

  async function handleDeploy() {
    if (!access || allCodeFiles.length === 0) return;
    const entrypoint =
      allCodeFiles.find(
        (f) => f.name === "index.ts" || f.name.endsWith("/index.ts"),
      ) ?? allCodeFiles[0];
    setDeploying(true);
    try {
      const { error } = await deployEdgeFunction(
        access,
        functionName,
        {
          entrypointPath: entrypoint.name,
          name: fn?.name || undefined,
          verifyJwt: fn?.verify_jwt ?? undefined,
        },
        allCodeFiles.map((f) => ({
          name: f.name,
          content: codeEdits[f.name] ?? f.content,
        })),
      );
      if (error) throw new Error(error);
      toast.success("Function deployed.");
      setCodeEdits({});
      await loadFunction();
      await loadCode();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deploy function");
    } finally {
      setDeploying(false);
    }
  }

  function handleAddFile() {
    const name = newFileName.trim();
    if (!name) {
      toast.error("File name is required.");
      return;
    }
    if (name.includes("/")) {
      toast.error("Use a plain file name without slashes.");
      return;
    }
    if (allCodeFiles.some((f) => f.name === name)) {
      toast.error("A file with that name already exists.");
      return;
    }
    setExtraFiles((prev) => [...prev, { name, content: `// ${name}\n` }]);
    setActiveCodeFile(allCodeFiles.length);
    setNewFileName("");
    setAddFileOpen(false);
  }

  // Settings tab
  const [displayName, setDisplayName] = useState("");
  const [verifyJwt, setVerifyJwt] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Overview tab
  const [ovHours, setOvHours] = useState(1);
  const [ovEvents, setOvEvents] = useState<FunctionEvent[]>([]);
  const [ovLoading, setOvLoading] = useState(false);
  const [errEvents, setErrEvents] = useState<FunctionEvent[]>([]);

  useEffect(() => {
    if (tab !== "overview" || !access) return;
    let cancelled = false;
    setOvLoading(true);
    const end = new Date();
    const start = new Date(end.getTime() - ovHours * 3600 * 1000);
    const dayStart = new Date(end.getTime() - 24 * 3600 * 1000);
    void Promise.all([
      fetchFunctionEvents(access, functionName, "function_edge_logs", {
        start,
        end,
      }),
      fetchFunctionEvents(access, functionName, "function_edge_logs", {
        start: dayStart,
        end,
      }),
    ]).then(([ranged, day]) => {
      if (cancelled) return;
      if (!ranged.error) setOvEvents(ranged.events);
      if (!day.error) setErrEvents(day.events);
      setOvLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, access, functionName, ovHours]);

  const ovRange = useMemo(() => {
    const end = Date.now();
    return { start: end - ovHours * 3600 * 1000, end };
  }, [ovHours, ovEvents]);

  const ovChart = useMemo(() => {
    const count = 48;
    const span = ovRange.end - ovRange.start;
    const rows = Array.from({ length: count }, (_, i) => ({
      i,
      t: ovRange.start + ((span * (i + 0.5)) / count || 0),
      y: 0,
    }));
    if (span <= 0) return rows;
    for (const e of ovEvents) {
      if (!e.timestamp) continue;
      const t = new Date(e.timestamp).getTime();
      if (Number.isNaN(t) || t < ovRange.start || t > ovRange.end) continue;
      const idx = Math.min(
        count - 1,
        Math.floor(((t - ovRange.start) / span) * count),
      );
      rows[idx].y++;
    }
    return rows;
  }, [ovEvents, ovRange]);

  const ovTotal = ovEvents.length;
  const ov5xx = ovEvents.filter(
    (e) => e.status != null && e.status >= 500 && e.status < 600,
  ).length;
  const ov4xx = ovEvents.filter(
    (e) => e.status != null && e.status >= 400 && e.status < 500,
  ).length;
  const pct = (n: number) =>
    ovTotal > 0 ? `${Math.round((n / ovTotal) * 100)}%` : "0%";
  const errCount = errEvents.filter(
    (e) => e.status != null && e.status >= 400 && e.status < 600,
  ).length;

  const loadFunction = useCallback(async () => {
    if (!connectionString || !functionName) return;
    setLoading(true);
    const { access: resolved, error: accessError } = await resolveEdgeAccess(
      connectionType,
      connectionString,
    );
    if (!resolved) {
      setFn(null);
      setAccess(null);
      setLoadError(accessError ?? "Edge Functions are unavailable here.");
      setLoading(false);
      return;
    }
    setAccess(resolved);
    const { function: detail, error } = await getEdgeFunction(
      resolved,
      functionName,
    );
    setFn(detail);
    setLoadError(error ?? null);
    if (error) toast.error(error);
    if (detail) {
      setDisplayName(detail.name || "");
      setVerifyJwt(detail.verify_jwt ?? true);
    }
    setLoading(false);
  }, [connectionString, connectionType, functionName]);

  useEffect(() => {
    void loadFunction();
  }, [loadFunction]);

  const url = access ? edgeFunctionUrl(access.projectRef, functionName) : "";

  function copyUrl() {
    if (!url) return;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Function URL copied."))
      .catch(() => toast.error("Failed to copy URL."));
  }

  async function handleDelete() {
    if (!access) return;
    const ok = await confirm({
      title: "Delete function",
      description: `Delete "${functionName}"? This removes the deployment and cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const { error } = await deleteEdgeFunction(access, functionName);
      if (error) throw new Error(error);
      toast.success(`Function "${functionName}" deleted.`);
      studio.openEdgeFunctionsTab?.();
      if (studio.closeTabById && studio.activeTabId) {
        studio.closeTabById(studio.activeTabId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete function");
    } finally {
      setDeleting(false);
    }
  }

  const loadCode = useCallback(async () => {
    if (!access) return;
    setCodeLoading(true);
    setCodeError(null);
    const { files, error } = await fetchFunctionBody(access, functionName);
    setCodeFiles(files);
    setCodeError(error ?? null);
    setCodeLoaded(true);
    setActiveCodeFile(0);
    setCodeLoading(false);
  }, [access, functionName]);

  function selectTab(
    next: "overview" | "invocations" | "logs" | "code" | "settings",
  ) {
    setTab(next);
    if (next === "code" && !codeLoaded && !codeLoading) void loadCode();
  }

  async function handleSaveName() {
    if (!access) return;
    const name = displayName.trim();
    if (!name) {
      toast.error("Display name is required.");
      return;
    }
    setSavingSettings(true);
    try {
      const { function: updated, error } = await updateEdgeFunction(access, functionName, { name });
      if (error) throw new Error(error);
      if (updated) setFn(updated);
      else await loadFunction();
      const tabs: any[] = studio.openTabs ?? [];
      if (studio.activeTabId && studio.setOpenTabs) {
        studio.setOpenTabs(
          tabs.map((t) => (t.id === studio.activeTabId ? { ...t, name } : t)),
        );
      }
      toast.success("Function renamed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename function");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleToggleVerifyJwt(next: boolean) {
    if (!access) return;
    setVerifyJwt(next);
    try {
      const { function: updated, error } = await updateEdgeFunction(access, functionName, {
        verify_jwt: next,
      });
      if (error) throw new Error(error);
      if (updated) setFn(updated);
      else await loadFunction();
      toast.success(
        next ? "JWT verification required." : "JWT verification disabled.",
      );
    } catch (e) {
      setVerifyJwt(!next);
      toast.error(
        e instanceof Error ? e.message : "Failed to update JWT setting",
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="px-6 pt-5">
        <h1
          className="truncate text-2xl font-medium tracking-tight text-foreground"
          title={fn?.name || functionName}
        >
          {fn?.name || functionName}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {url && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-[13px]">{url}</span>
              <button
                type="button"
                aria-label="Copy function URL"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={copyUrl}
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          )}
          {fn?.updated_at && (
            <span className="flex shrink-0 items-center gap-1.5 text-[13px]">
              <Clock className="size-3.5" />
              <span
                className="underline decoration-dotted underline-offset-4"
                title={new Date(fn.updated_at).toLocaleString()}
              >
                {timeAgo(fn.updated_at)}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="border-b border-border px-3">
        <div className="flex gap-1">
          {(
            [
              "overview",
              "invocations",
              "logs",
              "code",
              "settings",
            ] as const
          ).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              className={cn(
                "relative px-3 py-2 text-sm capitalize transition-colors",
                tab === id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {id}
              {tab === id && (
                <span className="absolute inset-x-3 bottom-0 h-[2px] bg-foreground" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
          <div
          className={
            tab === "settings"
              ? "mx-auto flex w-full max-w-4xl flex-col gap-6 p-6"
              : "flex min-h-full flex-col"
          }
        >
          {loading && !fn && !loadError ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              Loading function…
            </div>
          ) : loadError && !fn ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
              <div className="text-sm font-medium text-foreground">
                Failed to load function
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {loadError}
              </p>
              <Button size="sm" className="mt-3" onClick={() => void loadFunction()}>
                <RefreshCw className="mr-1.5 size-3.5" />
                Retry
              </Button>
            </div>
          ) : (
            <>
              {tab === "overview" && (
              <div className="flex flex-col p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-wrap gap-10">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground" />
                        Total invocations
                        <HelpCircleIcon
                          className="size-3.5"
                          aria-label="All recorded invocations in the selected range"
                        />
                      </div>
                      <div className="mt-1.5 text-3xl font-medium tabular-nums text-foreground">
                        {ovTotal}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-red-400" />
                        5xx rate
                        <HelpCircleIcon
                          className="size-3.5"
                          aria-label="Share of invocations returning a 5xx status"
                        />
                      </div>
                      <div className="mt-1.5 text-3xl font-medium tabular-nums text-foreground">
                        {pct(ov5xx)}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-amber-400" />
                        4xx rate
                        <HelpCircleIcon
                          className="size-3.5"
                          aria-label="Share of invocations returning a 4xx status"
                        />
                      </div>
                      <div className="mt-1.5 text-3xl font-medium tabular-nums text-foreground">
                        {pct(ov4xx)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex overflow-hidden rounded-lg border border-border">
                      {(
                        [
                          { h: 0.25, label: "15 min" },
                          { h: 1, label: "1 hour" },
                          { h: 3, label: "3 hours" },
                          { h: 24, label: "1 day" },
                        ] as const
                      ).map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          onClick={() => setOvHours(o.h)}
                          className={cn(
                            "h-8 border-r border-border px-3 text-xs transition-colors last:border-r-0",
                            ovHours === o.h
                              ? "bg-foreground font-medium text-background"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {access && (
                      <a
                        href={`https://supabase.com/dashboard/project/${access.projectRef}/functions/${functionName}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open in Supabase dashboard"
                        className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-6 h-[220px]">
                  {ovLoading && ovEvents.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading invocations…
                    </div>
                  ) : ovTotal === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
                      <BarChart3 className="size-6 text-muted-foreground/50" />
                      <div className="mt-3 text-sm font-medium text-foreground">
                        No data to show
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        It may take up to 24 hours for data to refresh
                      </p>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col">
                      <div className="min-h-0 flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={ovChart}
                            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                            barCategoryGap="25%"
                          >
                            <CartesianGrid
                              vertical={false}
                              stroke="var(--border)"
                            />
                            <XAxis dataKey="t" hide />
                            <YAxis hide domain={[0, "dataMax"]} />
                            <Tooltip
                              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                              content={({ active, payload }: any) => {
                                if (!active || !payload?.length) return null;
                                const y = payload[0]?.value ?? 0;
                                if (!y) return null;
                                return (
                                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                                    <span className="font-mono text-foreground">
                                      {y} invocation{y === 1 ? "" : "s"}
                                    </span>
                                  </div>
                                );
                              }}
                            />
                            <Bar
                              dataKey="y"
                              fill="#3ECF8E"
                              isAnimationActive={false}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex shrink-0 items-center justify-between pt-1.5 font-mono text-[11px] text-muted-foreground">
                        <span>{formatChartAxis(ovRange.start)}</span>
                        <span>{formatChartAxis(ovRange.end)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="my-6 border-t border-border" />

                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xl font-medium text-foreground">
                    Errors in the last 24h
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectTab("logs")}
                  >
                    <ExternalLink className="mr-1.5 size-3.5" />
                    View logs
                  </Button>
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-border p-5 text-sm">
                  <Eye className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    There have been{" "}
                    <span className="font-medium text-foreground">
                      {errEvents.length} invocation
                      {errEvents.length === 1 ? "" : "s"}
                    </span>{" "}
                    since last deploy and{" "}
                    {errCount === 0 ? (
                      "no errors."
                    ) : (
                      <>
                        <span className="font-medium text-destructive">
                          {errCount} error{errCount === 1 ? "" : "s"}.
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </div>
              )}

              {tab === "invocations" && (
              <FunctionEventsExplorer
                access={access}
                functionName={functionName}
                mode="invocations"
              />
              )}

              {tab === "logs" && (
              <FunctionEventsExplorer
                access={access}
                functionName={functionName}
                mode="logs"
              />
              )}

              {tab === "code" && (
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1">
                  <div className="flex w-52 shrink-0 flex-col border-r border-border">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Files
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setNewFileName("");
                          setAddFileOpen(true);
                        }}
                      >
                        <Plus className="mr-1 size-3" />
                        Add File
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                      {allCodeFiles.map((f, i) => {
                        const original = codeFiles.find(
                          (o) => o.name === f.name,
                        )?.content;
                        const isDirty =
                          original === undefined
                            ? true
                            : codeEdits[f.name] !== undefined &&
                              codeEdits[f.name] !== original;
                        return (
                          <button
                            key={f.name}
                            type="button"
                            onClick={() => setActiveCodeFile(i)}
                            className={cn(
                              "group flex h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-muted/60",
                              i === activeCodeFile && "bg-muted",
                            )}
                          >
                            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {f.name.split("/").pop()}
                            </span>
                            {isDirty && (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                                title="Unsaved changes"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    {codeLoading && allCodeFiles.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading source…
                      </div>
                    ) : codeError ? (
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-muted-foreground">
                          <span className="break-words">{codeError}</span>
                        </div>
                      </div>
                    ) : allCodeFiles.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        No source available.
                      </div>
                    ) : (
                      <MonacoCodeEditor
                        key={allCodeFiles[Math.min(activeCodeFile, allCodeFiles.length - 1)]?.name ?? "editor"}
                        height="100%"
                        language="typescript"
                        theme={codeEditorThemeId}
                        value={
                          (() => {
                            const f =
                              allCodeFiles[
                                Math.min(activeCodeFile, allCodeFiles.length - 1)
                              ];
                            return f ? (codeEdits[f.name] ?? f.content) : "";
                          })()
                        }
                        onChange={(value) => {
                          const f =
                            allCodeFiles[
                              Math.min(activeCodeFile, allCodeFiles.length - 1)
                            ];
                          if (!f) return;
                          setCodeEdits((prev) => ({
                            ...prev,
                            [f.name]: value ?? "",
                          }));
                        }}
                        beforeMount={(monaco: any) => {
                          monaco.editor.defineTheme(
                            "studio-dark",
                            getStudioDarkTheme(),
                          );
                          if (studio.appEditorTheme) {
                            registerCustomMonacoThemes(monaco, [
                              studio.appEditorTheme,
                            ]);
                          }
                        }}
                        options={{
                          minimap: { enabled: false },
                          fontSize: codeFontSize,
                          fontFamily:
                            studio.editorFontFamily ||
                            "'JetBrains Mono', 'Fira Code', monospace",
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          padding: { top: 12 },
                          renderLineHighlight: "all",
                          scrollbar: { verticalScrollbarSize: 10 },
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
                  {codeDirty && (
                    <span className="text-xs text-muted-foreground">
                      Unsaved changes
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadCode()}
                    disabled={codeLoading}
                  >
                    <RefreshCw className={cn("mr-1.5 size-3.5", codeLoading && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleDeploy()}
                    disabled={!codeDirty || deploying || allCodeFiles.length === 0}
                  >
                    {deploying ? "Deploying…" : "Deploy updates"}
                  </Button>
                </div>
              </section>
              )}

              {tab === "settings" && (
              <section className="overflow-hidden rounded-xl border border-border bg-card/40">
                <div className="border-b border-border px-5 py-3">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    Settings
                  </h2>
                </div>
                <div className="px-5">
                  <div className="grid grid-cols-1 gap-3 border-b border-border py-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-center md:gap-8">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        Display name
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Shown in the dashboard. The URL slug stays{" "}
                        <code className="rounded bg-muted px-1 font-mono text-[11px]">
                          {functionName}
                        </code>
                        .
                      </p>
                    </div>
                    <div className="flex min-w-0 gap-2 md:justify-self-end md:w-full">
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="h-9"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveName();
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-9 shrink-0"
                        onClick={() => void handleSaveName()}
                        disabled={savingSettings}
                      >
                        {savingSettings ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 border-b border-border py-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-center md:gap-8">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        JWT verification
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {verifyJwt
                          ? "Invocations require a valid JWT."
                          : "Anyone can invoke this function without a token."}
                      </p>
                    </div>
                    <div className="flex md:justify-end">
                      <Switch
                        checked={verifyJwt}
                        onCheckedChange={(v) => void handleToggleVerifyJwt(v)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-center md:gap-8">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-destructive">
                        Delete function
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Removes the deployment. This cannot be undone.
                      </p>
                    </div>
                    <div className="flex md:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                      >
                        <Trash2 className="mr-1.5 size-3.5" />
                        {deleting ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={addFileOpen} onOpenChange={setAddFileOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add file</DialogTitle>
          </DialogHeader>
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="utils.ts"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddFile();
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddFileOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddFile}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
