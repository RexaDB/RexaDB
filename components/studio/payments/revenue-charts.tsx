"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  Check,
  ChevronDown,
  Diamond,
  Plus,
  RefreshCw,
  ShoppingBag,
  User,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AVAILABLE_METRICS,
  REVENUE_RANGES,
  UNAVAILABLE_METRICS,
  type RevenueMetricId,
  type RevenueRangeKey,
} from "@/lib/supabase-paykit/analytics";

export const CHART_ACCENT = "#5b8cff";

export interface ChartPoint {
  x: string;
  y: number;
}

function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{format(payload[0].value)}</div>
    </div>
  );
}

// ─── range pills + refresh ─────────────────────────────────────────────────

export function RangePills({
  value,
  onChange,
  onRefresh,
  refreshing,
}: {
  value: RevenueRangeKey;
  onChange: (r: RevenueRangeKey) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-full bg-muted/60 p-1">
        {REVENUE_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(r.id)}
            className={cn(
              "h-7 rounded-full px-3 text-xs transition-colors",
              value === r.id
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 rounded-full text-xs"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> Refresh
      </Button>
    </div>
  );
}

// ─── hero revenue card ───────────────────────────────────────────────────

export function RevenueAreaCard({
  title,
  total,
  rangeLabel,
  data,
  height = 260,
}: {
  title: string;
  total: string;
  rangeLabel: string;
  data: ChartPoint[];
  height?: number;
}) {
  const gradientId = useId();
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-5">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{total}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full border-2 border-[var(--chart-accent,#5b8cff)]" />
        {rangeLabel}
      </p>
      <div style={{ height }} className="mt-3 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical horizontal={false} strokeDasharray="4 4" stroke="var(--border)" opacity={0.6} />
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip content={<ChartTooltip format={(v: number) => v} />} />
            <Area
              type="monotone"
              dataKey="y"
              stroke={CHART_ACCENT}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3, fill: CHART_ACCENT }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── mini metric card ────────────────────────────────────────────────────

export function MetricMiniCard({
  label,
  value,
  rangeLabel,
  data,
}: {
  label: string;
  value: string;
  rangeLabel: string;
  data: ChartPoint[];
}) {
  const gradientId = useId();
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-5">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full border-2 border-[var(--chart-accent,#5b8cff)]" />
        {rangeLabel}
      </p>
      <div className="mt-3 h-[110px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical horizontal={false} strokeDasharray="4 4" stroke="var(--border)" opacity={0.5} />
            <XAxis dataKey="x" hide />
            <Area
              type="monotone"
              dataKey="y"
              stroke={CHART_ACCENT}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── monthly bars + timeline + balance ───────────────────────────────────

export interface MonthBar {
  key: string;
  label: string;
  value: string;
  amount: number;
}

export function MonthlyBarsCard({
  months,
}: {
  months: MonthBar[];
}) {
  const data = months.map((m, i) => ({ x: m.label, y: m.amount, i }));
  const max = Math.max(0, ...months.map((m) => m.amount));
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/40 p-5 xl:h-[360px] xl:overflow-hidden">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Revenue</p>
        <p className="text-xs text-muted-foreground">Last 3 Months</p>
      </div>
      <div className="h-44 w-full flex-1 border-b border-dashed border-border/60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={false} />
            <Tooltip
              content={<ChartTooltip format={(v: number) => v} />}
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
            />
            <Bar dataKey="y" radius={[8, 8, 8, 8]}>
              {data.map((d) => (
                <Cell
                  key={d.i}
                  fill={d.y > 0 && d.y === max ? CHART_ACCENT : "var(--muted)"}
                  fillOpacity={d.y > 0 && d.y === max ? 1 : 0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {months.map((m) => (
          <div key={m.key}>
            <p className="text-xs">{m.label}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export type TimelineKind = "webhook" | "order" | "customer";

export interface TimelineItem {
  id: string;
  timeMs: number;
  timeLabel: string;
  title: string;
  sub: string;
  kind: TimelineKind;
}

export function TimelineCard({
  items,
  mode,
  onMode,
}: {
  items: TimelineItem[];
  mode: "system" | "all";
  onMode: (m: "system" | "all") => void;
}) {
  const iconFor = (kind: TimelineKind) => {
    if (kind === "customer") return User;
    if (kind === "order") return ShoppingBag;
    return Diamond;
  };
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/40 p-5 xl:h-[360px] xl:overflow-hidden">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Timeline</p>
        <div className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
          {(["system", "all"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cn(
                "h-6 rounded-full px-2.5 text-[11px] capitalize transition-colors",
                mode === m
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "system" ? "System" : "All"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex max-h-[420px] min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No events yet.
          </p>
        ) : (
          items.map((item) => {
            const Icon = iconFor(item.kind);
            return (
              <div key={item.id} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{item.sub}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{item.timeLabel}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function BalanceCard({
  collected,
  onOpenStripe,
}: {
  collected: string;
  onOpenStripe: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/40 p-5 xl:h-[360px] xl:overflow-hidden">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Available balance</p>
        <p className="text-sm font-semibold tabular-nums">{collected}</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Collected revenue settles through Stripe payouts. Payout timing depends
        on your Stripe account schedule.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 h-8 w-fit gap-1.5 text-xs"
        onClick={onOpenStripe}
      >
        <Zap className="size-3.5" /> Open Stripe payouts
      </Button>
    </div>
  );
}

// ─── customize modal ─────────────────────────────────────────────────────

export function CustomizeMetricsModal({
  open,
  onOpenChange,
  selected,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selected: RevenueMetricId[];
  onSave: (ids: RevenueMetricId[]) => void;
}) {
  const [draft, setDraft] = useState<RevenueMetricId[]>(selected);
  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);
  const toggle = (id: RevenueMetricId) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Customize Overview Metrics</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center justify-between text-xs font-medium">
              Selected
              <span className="text-muted-foreground">
                {draft.length}/{AVAILABLE_METRICS.length}
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              {draft.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Nothing selected — pick metrics on the right.
                </p>
              )}
              {draft.map((id) => {
                const def = AVAILABLE_METRICS.find((m) => m.id === id);
                if (!def) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 font-medium">{def.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${def.label}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => toggle(id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium">Metrics</p>
            <div className="flex flex-col gap-1.5">
              {AVAILABLE_METRICS.map((m) => {
                const active = draft.includes(m.id);
                return (
                  <MetricRow
                    key={m.id}
                    label={m.label}
                    hint={m.hint}
                    active={active}
                    onToggle={() => toggle(m.id)}
                  />
                );
              })}
              {UNAVAILABLE_METRICS.map((m) => (
                <div
                  key={m.label}
                  className="rounded-lg bg-muted/20 px-3 py-2 opacity-50"
                  title={m.reason}
                >
                  <p className="text-sm text-muted-foreground">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(draft.length > 0 ? draft : [...draft]);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricRow({
  label,
  hint,
  active,
  onToggle,
}: {
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <span className="flex-1 font-medium">{label}</span>
        {active ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <ChevronDown
            className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")}
          />
        )}
      </button>
      {expanded && !active && (
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <p className="text-[11px] text-muted-foreground">{hint}</p>
          <Button size="sm" variant="outline" className="h-6 shrink-0 gap-1 text-[11px]" onClick={onToggle}>
            <Plus className="size-3" /> Add
          </Button>
        </div>
      )}
      {active && (
        <div className="px-3 pb-2">
          <Button size="sm" variant="ghost" className="h-6 px-0 text-[11px] text-muted-foreground hover:text-destructive" onClick={onToggle}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

