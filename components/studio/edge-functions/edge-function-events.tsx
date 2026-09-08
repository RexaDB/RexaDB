"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Copy,
  Download,
  History,
  RefreshCw,
  Search,
  Terminal,
} from "@/lib/icon-theme/lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildFunctionEventsSql,
  fetchFunctionEvents,
  type EdgeAccess,
  type FunctionEvent,
} from "@/lib/studio/edge-functions-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "08 Sep 26 18:46:05" like the dashboard event rows. */
function formatRowTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const RANGE_OPTIONS = [
  { hours: 1, label: "Last hour" },
  { hours: 6, label: "Last 6 hours" },
  { hours: 24, label: "Last 24 hours" },
] as const;

export function FunctionEventsExplorer({
  access,
  functionName,
  mode,
}: {
  access: EdgeAccess | null;
  functionName: string;
  mode: "invocations" | "logs";
}) {
  const source =
    mode === "invocations" ? "function_edge_logs" : "function_logs";
  const [events, setEvents] = useState<FunctionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState(1);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "2xx" | "4xx" | "5xx"
  >("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);

  const end = windowEnd ?? Date.now();
  const start = end - rangeHours * 3600 * 1000;

  const loadEvents = useCallback(
    async (append: boolean, customEnd?: number) => {
      if (!access) return;
      const effEnd = customEnd ?? Date.now();
      const effStart = effEnd - rangeHours * 3600 * 1000;
      if (append) setLoadingOlder(true);
      else {
        setLoading(true);
        setLoadError(null);
      }
      const { events: rows, error } = await fetchFunctionEvents(
        access,
        functionName,
        source,
        { start: new Date(effStart), end: new Date(effEnd) },
      );
      if (error && !append) {
        setEvents([]);
        setLoadError(error);
      } else if (error) {
        toast.error(error);
      } else if (append) {
        setEvents((prev) => [...prev, ...rows]);
        setWindowEnd(effEnd);
      } else {
        setEvents(rows);
        setWindowEnd(null);
      }
      setLoading(false);
      setLoadingOlder(false);
    },
    [access, functionName, source, rangeHours],
  );

  useEffect(() => {
    setEvents([]);
    setSelected(new Set());
    setExpanded(null);
    void loadEvents(false);
  }, [loadEvents]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e, i) => {
      if (
        mode === "invocations" &&
        statusFilter !== "all" &&
        e.status != null
      ) {
        const cls = Math.floor(e.status / 100);
        if (
          (statusFilter === "2xx" && cls !== 2) ||
          (statusFilter === "4xx" && cls !== 4) ||
          (statusFilter === "5xx" && cls !== 5)
        ) {
          return false;
        }
      }
      if (!q) return true;
      return [
        e.message,
        e.method,
        e.requestId,
        e.status != null ? String(e.status) : "",
        e.timestamp,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [events, search, statusFilter, mode]);

  const sql = useMemo(
    () =>
      buildFunctionEventsSql(
        functionName,
        source,
        new Date(start),
        new Date(end),
        mode === "invocations",
      ),
    [functionName, source, start, end, mode],
  );

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportRows(): FunctionEvent[] {
    return selected.size > 0
      ? visible.filter((_, i) => selected.has(`${i}`))
      : visible;
  }

  function copyText(text: string, what: string) {
    if (!text) {
      toast.message("Nothing to copy.");
      return;
    }
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`${what} copied.`))
      .catch(() => toast.error("Failed to copy."));
  }

  function toMarkdown(rows: FunctionEvent[]): string {
    const head = "| timestamp | method | status | request | message |";
    const sep = "| --- | --- | --- | --- | --- |";
    const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const lines = rows.map((e) =>
      `| ${cell(formatRowTime(e.timestamp))} | ${cell(e.method ?? "")} | ${cell(e.status != null ? String(e.status) : "")} | ${cell(e.requestId ?? "")} | ${cell(e.message)} |`.trim(),
    );
    return [head, sep, ...lines].join("\n");
  }

  function toCsv(rows: FunctionEvent[]): string {
    const cell = (v: string) => {
      const s = v.replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = rows.map((e) =>
      [
        formatRowTime(e.timestamp),
        e.method ?? "",
        e.status != null ? String(e.status) : "",
        e.requestId ?? "",
        e.message,
      ]
        .map(cell)
        .join(","),
    );
    return ["timestamp,method,status,request_id,message", ...lines].join("\n");
  }

  function handleCopyMarkdown() {
    copyText(toMarkdown(exportRows()), "Markdown");
  }

  function handleCopyJson() {
    const rows = exportRows();
    if (rows.length === 0) {
      toast.message("Nothing to copy.");
      return;
    }
    copyText(JSON.stringify(rows, null, 2), "JSON");
  }

  function handleCopyCsv() {
    copyText(toCsv(exportRows()), "CSV");
  }

  function handleDownloadCsv() {
    const rows = exportRows();
    if (rows.length === 0) {
      toast.message("Nothing to download.");
      return;
    }
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${functionName}-${mode}-events.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toast.success(`Downloaded ${rows.length} event${rows.length === 1 ? "" : "s"}.`);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        !!target?.isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        handleCopyMarkdown();
      } else if (key === "j") {
        e.preventDefault();
        handleCopyJson();
      } else if (key === "c") {
        e.preventDefault();
        handleCopyCsv();
      } else if (key === "d") {
        e.preventDefault();
        handleDownloadCsv();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <div className="relative w-full max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events"
            className="h-7 pl-8 text-xs"
          />
        </div>
        <button
          type="button"
          aria-label="Refresh events"
          title="Refresh"
          onClick={() => void loadEvents(false)}
          className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
        <Select
          value={String(rangeHours)}
          onValueChange={(v) => setRangeHours(Number(v))}
        >
          <SelectTrigger className="h-7 w-auto gap-1.5 text-xs">
            <Clock className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.hours} value={String(o.hours)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "invocations" && (
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "all" | "2xx" | "4xx" | "5xx")
            }
          >
            <SelectTrigger className="h-7 w-auto border-dashed text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Status: all</SelectItem>
              <SelectItem value="2xx">2xx success</SelectItem>
              <SelectItem value="4xx">4xx client errors</SelectItem>
              <SelectItem value="5xx">5xx server errors</SelectItem>
            </SelectContent>
          </Select>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Export events"
              title={
                selected.size > 0
                  ? `Export ${selected.size} selected`
                  : "Export visible events"
              }
              className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Download className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleCopyMarkdown}>
              <Copy className="size-3.5" />
              Copy as Markdown
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⇧⌘M
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyJson}>
              <Copy className="size-3.5" />
              Copy as JSON
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⇧⌘J
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyCsv}>
              <Copy className="size-3.5" />
              Copy as CSV
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⇧⌘C
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadCsv}>
              <Download className="size-3.5" />
              Download CSV
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⇧⌘D
              </kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => setQueryOpen(true)}>
            Explore via query
          </Button>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-border">
        {loading && events.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Loading events…
          </div>
        ) : loadError ? (
          <div className="p-6 text-center">
            <div className="text-sm font-medium text-foreground">
              Failed to load events
            </div>
            <p className="mx-auto mt-1 max-w-md break-words text-xs text-muted-foreground">
              {loadError}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void loadEvents(false)}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6">
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              {mode === "invocations" ? (
                <Activity className="mx-auto size-8 text-muted-foreground/50" />
              ) : (
                <Terminal className="mx-auto size-8 text-muted-foreground/50" />
              )}
              <div className="mt-3 text-sm font-medium text-foreground">
                {search || statusFilter !== "all"
                  ? "No matching events"
                  : "No events yet"}
              </div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {search || statusFilter !== "all"
                  ? "Try a different search term or filter."
                  : mode === "invocations"
                    ? "Invoke this function to see its requests here."
                    : "Console output from this function will appear here."}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((e, i) => {
              const key = `${i}`;
              const isOpen = expanded === key;
              return (
                <div key={key} className="bg-transparent">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(isOpen ? null : key)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter")
                        setExpanded(isOpen ? null : key);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left font-mono text-xs transition-colors hover:bg-muted/30",
                      isOpen && "bg-muted/30",
                    )}
                  >
                    <span onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(key)}
                        onCheckedChange={() => toggleSelected(key)}
                        aria-label={`Select event ${i + 1}`}
                      />
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatRowTime(e.timestamp)}
                    </span>
                    {mode === "invocations" ? (
                      <>
                        {e.status != null ? (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "shrink-0 font-mono text-[11px]",
                              e.status >= 200 &&
                                e.status < 300 &&
                                "bg-emerald-400/10 text-emerald-400",
                              e.status >= 500 &&
                                "bg-destructive/10 text-destructive",
                              e.status >= 400 &&
                                e.status < 500 &&
                                "bg-amber-400/10 text-amber-400",
                            )}
                          >
                            {e.status}
                          </Badge>
                        ) : (
                          <span className="w-10 shrink-0 text-muted-foreground/50">
                            —
                          </span>
                        )}
                        <span className="w-[70px] shrink-0 truncate text-foreground/90">
                          {e.method ?? "—"}
                        </span>
                        <span className="w-32 shrink-0 truncate text-foreground/90">
                          {functionName}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {e.requestId ?? e.message}
                        </span>
                      </>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-foreground/90">
                        {e.message || "—"}
                      </span>
                    )}
                  </div>
                  {isOpen && (
                    <pre className="border-t border-border bg-muted/20 px-3 py-2 pl-12 font-mono text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
                      {e.message || "‹empty›"}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadEvents(true, start)}
          disabled={loadingOlder || loading}
        >
          <History className="mr-1.5 size-3.5" />
          {loadingOlder ? "Loading…" : "Load older"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Showing {visible.length} result{visible.length === 1 ? "" : "s"}
          {selected.size > 0 && ` (${selected.size} selected)`}
        </span>
      </div>

      <Dialog open={queryOpen} onOpenChange={setQueryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Explore via query</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            This is the ClickHouse SQL behind the event list. Run it against
            the project logs endpoint.
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
            {sql}
          </pre>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQueryOpen(false)}
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(sql)
                  .then(() => toast.success("Query copied."))
                  .catch(() => toast.error("Failed to copy query."));
              }}
            >
              <Copy className="mr-1.5 size-3.5" />
              Copy query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
