"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { runQuery } from "@/lib/api/actions-client";
import { cn } from "@/lib/utils";
import { Pencil, Play, RefreshCw, Trash2 } from "@/lib/icon-theme/lucide-react";
import type { DashboardWidget } from "@/lib/studio/types";

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899"];

const AREA_FAMILY = new Set(["area-chart", "p-chart-13", "p-chart-14", "p-chart-15", "p-chart-17", "p-chart-18"]);

/** Shared bar-chart axes. */
function barAxes(gridOpacity = 0.2) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" opacity={gridOpacity} />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
      <YAxis tick={{ fontSize: 11 }} width={48} />
      <Tooltip />
    </>
  );
}

/** Shared area-chart axes. */
function areaAxes() {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
      <YAxis tick={{ fontSize: 11 }} width={48} />
      <Tooltip />
    </>
  );
}

/** Per-bar SVG pattern fills so patterned bars keep their colors. */
function barPatternDefs(kind: "stripe" | "dots" | "cross", idPrefix: string, count: number) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const c = PALETTE[i % PALETTE.length];
        const id = `${idPrefix}-${i}`;
        if (kind === "stripe") {
          return (
            <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill={c} opacity="0.15" />
              <path d="M0,8 L8,0 M4,12 L12,4 M-4,4 L4,-4" stroke={c} strokeWidth="1.5" opacity="0.7" />
            </pattern>
          );
        }
        if (kind === "dots") {
          return (
            <pattern key={id} id={id} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill={c} opacity="0.12" />
              <circle cx="3" cy="3" r="1.3" fill={c} opacity="0.7" />
            </pattern>
          );
        }
        return (
          <pattern key={id} id={id} x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0,8 L8,0" stroke={c} strokeWidth="0.9" opacity="0.45" />
            <path d="M0,0 L8,8" stroke={c} strokeWidth="0.9" opacity="0.25" />
          </pattern>
        );
      })}
    </>
  );
}

/** Vertical fade gradients for area variants. */
function gradientDefs(idPrefix: string, count: number) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const c = PALETTE[i % PALETTE.length];
        const id = `${idPrefix}-${i}`;
        return (
          <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={c} stopOpacity={0.55} />
            <stop offset="95%" stopColor={c} stopOpacity={0.08} />
          </linearGradient>
        );
      })}
    </>
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : String(Math.round(value * 100) / 100);
  return String(value);
}

interface NoteWidgetProps {
  widget: DashboardWidget;
  connectionString: string;
  refreshKey?: number;
  onEdit?: () => void;
  onRemove?: () => void;
}

/**
 * Auto-size rendering of a dashboard widget snapshot.
 * Header holds the title plus always-visible Run / edit / remove actions —
 * nothing is hidden behind hover overlays.
 */
export function NoteWidget({ widget, connectionString, refreshKey = 0, onEdit, onRemove }: NoteWidgetProps) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState(0);

  const needsQuery =
    widget.widgetType !== "text" &&
    widget.widgetType !== "image" &&
    widget.widgetType !== "gif" &&
    widget.widgetType !== "map" &&
    widget.widgetType !== "empty";

  const effectiveQuery = useMemo(() => {
    if (widget.query?.trim()) return widget.query.trim();
    if (widget.tableName) {
      const ref = widget.schema ? `"${widget.schema}"."${widget.tableName}"` : `"${widget.tableName}"`;
      return `SELECT * FROM ${ref} LIMIT 50;`;
    }
    return "";
  }, [widget.query, widget.tableName, widget.schema]);

  useEffect(() => {
    if (!needsQuery || !effectiveQuery) {
      setRows([]);
      setFields([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    runQuery(connectionString, effectiveQuery)
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !res.data) {
          setError(res.error || "Failed to run query.");
          setRows([]);
          setFields([]);
          return;
        }
        const names = (res.data.fields || []).map((f: { name: string }) => String(f.name));
        setFields(names);
        setRows(Array.isArray(res.data.rows) ? res.data.rows : []);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to run query.");
          setRows([]);
          setFields([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionString, effectiveQuery, needsQuery, refreshKey, runId]);

  const labelValuePairs = useMemo(() => {
    if (rows.length === 0 || fields.length === 0) return [];
    const labelField = fields[0];
    const numericField = fields.find((f) => rows.some((r) => toNumber(r[f]) !== null)) ?? fields[1] ?? fields[0];
    return rows.slice(0, 12).map((row) => ({
      label: String(row[labelField] ?? ""),
      value: toNumber(row[numericField]) ?? 0,
    }));
  }, [rows, fields]);

  const firstValue = useMemo(() => {
    if (rows.length === 0 || fields.length === 0) return null;
    const row = rows[0];
    const numericField = fields.find((f) => toNumber(row[f]) !== null);
    if (numericField) return row[numericField];
    return row[fields[0]];
  }, [rows, fields]);

  /** Two-series data for grouped / stacked variants (first two numeric columns). */
  const duoData = useMemo(() => {
    if (rows.length === 0 || fields.length === 0) return [];
    const labelField = fields[0];
    const nums = fields.filter((f) => rows.some((r) => toNumber(r[f]) !== null));
    const a = nums[0] ?? fields[1] ?? fields[0];
    const b = nums[1] ?? a;
    return rows.slice(0, 12).map((row) => ({
      label: String(row[labelField] ?? ""),
      a: toNumber(row[a]) ?? 0,
      b: toNumber(row[b]) ?? 0,
      single: a === b,
    }));
  }, [rows, fields]);

  const renderBody = () => {
    if (widget.widgetType === "text") {
      let text = widget.content || "";
      if (rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        text = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
          const v = row[key];
          return v === null || v === undefined ? "" : String(v);
        });
      }
      return <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text || "Empty text widget."}</p>;
    }
    if (widget.widgetType === "image" || widget.widgetType === "gif") {
      if (!widget.content) return <p className="text-sm text-muted-foreground">No image source.</p>;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={widget.content} alt={widget.title} className="max-h-72 w-full rounded-md object-contain" />;
    }
    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (error) return <p className="text-sm text-destructive">{error}</p>;
    if (!effectiveQuery) return <p className="text-sm text-muted-foreground">No query configured.</p>;
    if (widget.widgetType === "map" || widget.widgetType === "empty") {
      return <p className="text-sm text-muted-foreground">This widget type isn&apos;t supported in notes yet.</p>;
    }
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rows returned.</p>;

    switch (widget.widgetType) {
      case "metric":
        return (
          <div className="py-2">
            <div className="text-3xl font-semibold tracking-tight text-foreground">{formatValue(firstValue)}</div>
            {fields.length > 1 && rows.length > 1 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {rows.length} rows · {fields.length} columns
              </div>
            )}
          </div>
        );
      case "table":
        return (
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {fields.map((f) => (
                    <th key={f} className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-white/[0.02]">
                    {fields.map((f) => (
                      <td key={f} className="max-w-48 truncate px-2 py-1.5 text-foreground">
                        {formatValue(row[f])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "pie-chart":
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={labelValuePairs} dataKey="value" nameKey="label" innerRadius={48} outerRadius={88} paddingAngle={2}>
                  {labelValuePairs.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      case "p-chart-12":
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={labelValuePairs} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={96} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {labelValuePairs.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      case "p-chart-20": {
        const max = Math.max(1, ...labelValuePairs.map((p) => p.value));
        return (
          <div className="flex flex-col gap-2 py-1">
            {labelValuePairs.map((p, i) => {
              const dots = Math.max(1, Math.round((p.value / max) * 24));
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{p.label}</span>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {Array.from({ length: dots }).map((_, j) => (
                      <span key={j} className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    ))}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-foreground">{formatValue(p.value)}</span>
                </div>
              );
            })}
          </div>
        );
      }
      case "sparkline":
        return (
          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={labelValuePairs}>
                <Area type="monotone" dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.25} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      case "progress": {
        const pct = Math.max(0, Math.min(100, toNumber(firstValue) ?? 0));
        return (
          <div className="py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-foreground">{formatValue(firstValue)}</span>
              <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      }
      default: {
        // Bar Chart (Grid): prominent gridlines.
        if (widget.widgetType === "p-chart-1") {
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={labelValuePairs}>
                  {barAxes(0.55)}
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {labelValuePairs.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Bar Chart (Grouped): two side-by-side series.
        if (widget.widgetType === "p-chart-2") {
          const single = duoData.length === 0 || duoData[0].single;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={duoData}>
                  {barAxes()}
                  <Bar dataKey="a" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
                  {!single && <Bar dataKey="b" fill={PALETTE[1]} radius={[4, 4, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Bar Chart (Striped) / (Dotted): patterned fills.
        if (widget.widgetType === "p-chart-3" || widget.widgetType === "p-chart-4") {
          const kind = widget.widgetType === "p-chart-3" ? "stripe" : "dots";
          const pid = `${kind}-${widget.id}`;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={labelValuePairs}>
                  <defs>{barPatternDefs(kind, pid, labelValuePairs.length)}</defs>
                  {barAxes()}
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {labelValuePairs.map((_, i) => (
                      <Cell key={i} fill={`url(#${pid}-${i})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Bar Chart (Metric): headline number over bars.
        if (widget.widgetType === "p-chart-19") {
          return (
            <div className="w-full">
              <div className="pb-1 text-2xl font-semibold tracking-tight text-foreground">{formatValue(firstValue)}</div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={labelValuePairs}>
                    {barAxes()}
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {labelValuePairs.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        }
        // Bar Chart (Stacked Multi): stacked series.
        if (widget.widgetType === "p-chart-21") {
          const single = duoData.length === 0 || duoData[0].single;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={duoData}>
                  {barAxes()}
                  <Bar dataKey="a" stackId="s" fill={PALETTE[0]} />
                  {!single && <Bar dataKey="b" stackId="s" fill={PALETTE[1]} radius={[4, 4, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Area Chart (Gradient): vertical fade.
        if (widget.widgetType === "p-chart-13") {
          const gid = `grad-${widget.id}`;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={labelValuePairs}>
                  <defs>{gradientDefs(gid, 1)}</defs>
                  {areaAxes()}
                  <Area type="monotone" dataKey="value" stroke={PALETTE[0]} fill={`url(#${gid}-0)`} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Area Chart (Stacked): stacked gradient series.
        if (widget.widgetType === "p-chart-14") {
          const single = duoData.length === 0 || duoData[0].single;
          const gid = `stackgrad-${widget.id}`;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={duoData}>
                  <defs>{gradientDefs(gid, single ? 1 : 2)}</defs>
                  {areaAxes()}
                  <Area type="monotone" dataKey="a" stackId="s" stroke={PALETTE[0]} fill={`url(#${gid}-0)`} strokeWidth={2} />
                  {!single && <Area type="monotone" dataKey="b" stackId="s" stroke={PALETTE[1]} fill={`url(#${gid}-1)`} strokeWidth={2} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Area Chart (Step Dotted): stepped line over dotted fill.
        if (widget.widgetType === "p-chart-15") {
          const pid = `stepdots-${widget.id}`;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={labelValuePairs}>
                  <defs>{barPatternDefs("dots", pid, labelValuePairs.length)}</defs>
                  {areaAxes()}
                  <Area type="stepAfter" dataKey="value" stroke={PALETTE[0]} fill={`url(#${pid}-0)`} strokeWidth={2} strokeDasharray="1 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Line + Area (Forecast): area wash with a bold line on top.
        if (widget.widgetType === "p-chart-17") {
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={labelValuePairs}>
                  {areaAxes()}
                  <Area type="natural" dataKey="value" fill={PALETTE[0]} fillOpacity={0.12} stroke="none" />
                  <Line type="natural" dataKey="value" stroke={PALETTE[0]} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Area Chart (Crosshatch): hatched fill.
        if (widget.widgetType === "p-chart-18") {
          const pid = `cross-${widget.id}`;
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={labelValuePairs}>
                  <defs>{barPatternDefs("cross", pid, 1)}</defs>
                  {areaAxes()}
                  <Area type="monotone" dataKey="value" stroke={PALETTE[0]} fill={`url(#${pid}-0)`} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        }
        if (AREA_FAMILY.has(widget.widgetType)) {
          return (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={labelValuePairs}>
                  {areaAxes()}
                  <Area type="monotone" dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.3} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        }
        // Plain Bar Chart (also the fallback for unknown types).
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={labelValuePairs}>
                {barAxes()}
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {labelValuePairs.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }
    }
  };

  return (
    <div className={cn("w-full overflow-hidden rounded-lg border border-border bg-card")}>
      <div className="flex items-center gap-1 border-b border-border py-1.5 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{widget.title || "Untitled widget"}</span>
        {needsQuery && !!effectiveQuery && (
          <button
            type="button"
            title="Re-run query"
            onClick={() => setRunId((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-white/5 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            title="Edit widget"
            onClick={onEdit}
            className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            title="Remove widget"
            onClick={onRemove}
            className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <div className="px-3 py-2">{renderBody()}</div>
    </div>
  );
}
