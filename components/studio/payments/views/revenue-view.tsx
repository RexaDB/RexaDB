"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  PAYKIT_QUERIES,
  formatDateTime,
  formatMoney,
  queryPaykit,
} from "@/lib/supabase-paykit/queries";
import {
  AVAILABLE_METRICS,
  DEFAULT_SELECTED_METRICS,
  buildMockRevenueDataset,
  dominantCurrency,
  emptySeriesForRange,
  filterSeriesByRange,
  formatAxisDay,
  formatRangeLabel,
  metricsStorageKey,
  sanitizeSelectedMetrics,
  sumSeries,
  timeAgo,
  type RevenueMetricId,
  type RevenueRangeKey,
} from "@/lib/supabase-paykit/analytics";
import {
  BalanceCard,
  CustomizeMetricsModal,
  MetricMiniCard,
  MonthlyBarsCard,
  RangePills,
  RevenueAreaCard,
  TimelineCard,
  type MonthBar,
  type TimelineItem,
} from "../revenue-charts";
import {
  DataTable,
  EmptyState,
  SetupCta,
  StatusBadge,
  ViewError,
  ViewLoading,
  ViewShell,
} from "./shared";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dayOf(row: Record<string, any>, field: string): string {
  return String(row?.[field] ?? "").slice(0, 10);
}

export function PaymentsRevenueView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [invoices, setInvoices] = useState<Record<string, any>[]>([]);
  const [kpis, setKpis] = useState<Record<string, any> | null>(null);
  const [mrrCents, setMrrCents] = useState<number | null>(null);
  const [revenueDaily, setRevenueDaily] = useState<Array<{ day: string; cents: number; orders: number }>>([]);
  const [mrrDaily, setMrrDaily] = useState<Array<{ day: string; value: number }>>([]);
  const [activeSubsDaily, setActiveSubsDaily] = useState<Array<{ day: string; subs: number }>>([]);
  const [checkoutsDaily, setCheckoutsDaily] = useState<Array<{ day: string; checkouts: number }>>([]);
  const [cancelsDaily, setCancelsDaily] = useState<Array<{ day: string; cancels: number }>>([]);
  const [customers, setCustomers] = useState<Record<string, any>[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [range, setRange] = useState<RevenueRangeKey>("30d");
  const [timelineMode, setTimelineMode] = useState<"system" | "all">("system");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState<RevenueMetricId[]>(DEFAULT_SELECTED_METRICS);
  const [mockOn, setMockOn] = useState(false);

  const load = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    setError(null);
    const [inv, kpi, mrr, rev, mrrS, actS, coS, caS, cust, evts] = await Promise.all([
      queryPaykit(connectionString, PAYKIT_QUERIES.invoices),
      queryPaykit(connectionString, PAYKIT_QUERIES.revenueKpis),
      queryPaykit(connectionString, PAYKIT_QUERIES.mrr),
      queryPaykit(connectionString, PAYKIT_QUERIES.revenueDaily),
      queryPaykit(connectionString, PAYKIT_QUERIES.mrrDaily),
      queryPaykit(connectionString, PAYKIT_QUERIES.activeSubsDaily),
      queryPaykit(connectionString, PAYKIT_QUERIES.checkoutsDaily),
      queryPaykit(connectionString, PAYKIT_QUERIES.cancelsDaily),
      queryPaykit(connectionString, PAYKIT_QUERIES.recentCustomers),
      queryPaykit(connectionString, PAYKIT_QUERIES.webhookEvents),
    ]);
    setInvoices(inv.rows);
    setKpis(kpi.rows[0] ?? null);
    setMrrCents(mrr.rows[0]?.mrr_cents != null ? Number(mrr.rows[0].mrr_cents) : null);
    setRevenueDaily(
      rev.rows.map((r) => ({ day: dayOf(r, "day"), cents: Number(r.cents) || 0, orders: Number(r.orders) || 0 })),
    );
    setMrrDaily(mrr.rows.map((r: any) => ({ day: dayOf(r, "day"), value: Number(r.cents) || 0 })));
    setActiveSubsDaily(actS.rows.map((r) => ({ day: dayOf(r, "day"), subs: Number(r.subs) || 0 })));
    setCheckoutsDaily(coS.rows.map((r) => ({ day: dayOf(r, "day"), checkouts: Number(r.checkouts) || 0 })));
    setCancelsDaily(caS.rows.map((r) => ({ day: dayOf(r, "day"), cancels: Number(r.cancels) || 0 })));
    setCustomers(cust.rows);
    setWebhookEvents(evts.rows);
    setMissing(inv.missingSchema || kpi.missingSchema);
    const firstError = [inv, kpi, mrr, rev, mrrS, actS, coS, caS, cust, evts].find(
      (r) => !r.missingSchema && r.error,
    );
    setError(firstError?.error ?? null);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    if (!mockOn) void load();
  }, [load, mockOn]);

  // Metric selection persists per connection; mock toggle is session-only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(metricsStorageKey(connectionString || "default"));
      if (raw) setSelectedMetrics(sanitizeSelectedMetrics(JSON.parse(raw)));
    } catch {
      // corrupted value — keep defaults
    }
  }, [connectionString]);

  const enableMock = useCallback(
    (seed = 7) => {
      const dataset = buildMockRevenueDataset(seed);
      setInvoices(dataset.invoices);
      setKpis(dataset.kpis);
      setMrrCents(dataset.mrrCents);
      setRevenueDaily(dataset.revenueDaily);
      setMrrDaily(dataset.mrrDaily.map((d) => ({ day: d.day, value: d.value })));
      setActiveSubsDaily(dataset.activeSubsDaily);
      setCheckoutsDaily(dataset.checkoutsDaily);
      setCancelsDaily(dataset.cancelsDaily);
      setCustomers(dataset.customers);
      setWebhookEvents(dataset.webhookEvents);
      setError(null);
      setMissing(false);
      setLoading(false);
      setMockOn(true);
      toast.success("Previewing mock revenue data — nothing was written to the database.");
    },
    [],
  );

  const disableMock = useCallback(() => {
    setMockOn(false);
    toast.success("Mock preview off — reloading live data.");
  }, []);

  // Console command: rexadbMockRevenue() to preview, .off() to go back live.
  // Preview-only by design: the dataset lives in memory, zero writes.
  useEffect(() => {
    const api = Object.assign((seed?: number) => enableMock(seed ?? 7), {
      off: disableMock,
      seed: (seed = 7) => enableMock(seed),
    });
    (window as any).rexadbMockRevenue = api;
    return () => {
      if ((window as any).rexadbMockRevenue === api) {
        delete (window as any).rexadbMockRevenue;
      }
    };
  }, [enableMock, disableMock]);

  const currency = useMemo(() => dominantCurrency(invoices), [invoices]);

  const heroPoints = useMemo(() => {
    const pts = filterSeriesByRange(
      revenueDaily.map((d) => ({ day: d.day, value: d.cents / 100 })),
      range,
    ).map((p) => ({ x: formatAxisDay(p.day), y: Math.round(p.value * 100) / 100 }));
    return pts.length > 0 ? pts : emptySeriesForRange(range);
  }, [revenueDaily, range]);
  const heroTotal = useMemo(
    () => sumSeries(heroPoints.map((p) => ({ day: p.x, value: p.y }))),
    [heroPoints],
  );

  const spark = useCallback(
    <T extends { day: string }>(rows: T[], pick: (r: T) => number) =>
      filterSeriesByRange(
        rows.map((r) => ({ day: r.day, value: pick(r) })),
        range,
      ).map((p) => ({ x: p.day, y: p.value })),
    [range],
  );

  const miniCards = useMemo(() => {
    const cards: Array<{ id: RevenueMetricId; label: string; value: string; data: Array<{ x: string; y: number }> }> = [];
    const defs = new Map(AVAILABLE_METRICS.map((m) => [m.id, m.label]));
    // Empty data still renders gridlines, axes and a flat baseline.
    const withSkeleton = (data: Array<{ x: string; y: number }>) =>
      data.length > 0 ? data : emptySeriesForRange(range);
    for (const id of selectedMetrics) {
      if (id === "revenue") continue; // hero card owns revenue
      if (id === "mrr") {
        cards.push({
          id, label: defs.get(id)!,
          value: mrrCents != null ? formatMoney(mrrCents, currency) : "—",
          data: withSkeleton(spark(mrrDaily, (r) => r.value / 100).map((p) => ({ x: formatAxisDay(p.x), y: p.y }))),
        });
      } else if (id === "active") {
        cards.push({
          id, label: defs.get(id)!,
          value: String(kpis?.active_subs ?? 0),
          data: withSkeleton(spark(activeSubsDaily, (r) => r.subs).map((p) => ({ x: formatAxisDay(p.x), y: p.y }))),
        });
      } else if (id === "orders") {
        const rows = withSkeleton(spark(revenueDaily, (r) => r.orders).map((p) => ({ x: formatAxisDay(p.x), y: p.y })));
        cards.push({ id, label: defs.get(id)!, value: String(rows.reduce((s, p) => s + p.y, 0)), data: rows });
      } else if (id === "checkouts") {
        const rows = withSkeleton(spark(checkoutsDaily, (r) => r.checkouts).map((p) => ({ x: formatAxisDay(p.x), y: p.y })));
        cards.push({ id, label: defs.get(id)!, value: String(rows.reduce((s, p) => s + p.y, 0)), data: rows });
      } else if (id === "cancellations") {
        const rows = withSkeleton(spark(cancelsDaily, (r) => r.cancels).map((p) => ({ x: formatAxisDay(p.x), y: p.y })));
        cards.push({ id, label: defs.get(id)!, value: String(rows.reduce((s, p) => s + p.y, 0)), data: rows });
      }
    }
    return cards;
  }, [selectedMetrics, mrrCents, currency, kpis, mrrDaily, activeSubsDaily, revenueDaily, checkoutsDaily, cancelsDaily, spark, range]);

  const monthlyBars = useMemo<MonthBar[]>(() => {
    const now = new Date();
    const buckets = new Map<string, number>();
    for (const row of revenueDaily) {
      const key = row.day.slice(0, 7);
      buckets.set(key, (buckets.get(key) || 0) + row.cents);
    }
    return [2, 1, 0].map((back) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cents = buckets.get(key) || 0;
      return {
        key,
        label: MONTHS[d.getMonth()],
        value: formatMoney(cents, currency),
        amount: cents / 100,
      };
    });
  }, [revenueDaily, currency]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const e of webhookEvents) {
      const type = String(e.type || "");
      const pretty = type
        .split(/[._]/)
        .map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");
      items.push({
        id: `evt-${String(e.id)}`,
        timeMs: Date.parse(String(e.received_at)) || 0,
        timeLabel: timeAgo(String(e.received_at)),
        title: pretty || "Webhook event",
        sub: String(e.status || ""),
        kind: "webhook",
      });
    }
    if (timelineMode === "all") {
      for (const c of customers) {
        items.push({
          id: `cus-${String(c.id)}`,
          timeMs: Date.parse(String(c.created_at)) || 0,
          timeLabel: timeAgo(String(c.created_at)),
          title: "Customer Created",
          sub: String(c.name || c.email || ""),
          kind: "customer",
        });
      }
      for (const r of invoices) {
        if (r.status !== "paid") continue;
        items.push({
          id: `ord-${String(r.id)}`,
          timeMs: Date.parse(String(r.created_at)) || 0,
          timeLabel: timeAgo(String(r.created_at)),
          title: "Order Paid",
          sub: formatMoney(Number(r.amount) || 0, String(r.currency || currency)),
          kind: "order",
        });
      }
    }
    return items
      .filter((i) => i.timeMs > 0)
      .sort((a, b) => b.timeMs - a.timeMs)
      .slice(0, 12);
  }, [webhookEvents, customers, invoices, timelineMode, currency]);

  const collected = useMemo(
    () => formatMoney(Number(kpis?.paid_total ?? 0), currency),
    [kpis, currency],
  );

  return (
    <ViewShell
      title="Overview"
      description="Revenue, subscriptions and payouts."
      loading={loading}
      actions={
        <RangePills
          value={range}
          onChange={setRange}
          onRefresh={() => (mockOn ? enableMock() : void load())}
          refreshing={loading}
        />
      }
    >
      {loading ? (
        <ViewLoading />
      ) : missing && !mockOn ? (
        <SetupCta onGoSetup={() => studio.openPaymentsSetupTab?.()} />
      ) : (
        <>
          {error && <ViewError message={error} />}
          {mockOn && (
            <button
              type="button"
              onClick={disableMock}
              className="w-fit rounded-full border border-dashed border-border px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              title="Back to live data"
            >
              Previewing mock data — click to go back live. Nothing was written.
            </button>
          )}
          <RevenueAreaCard
            title="Revenue"
            total={formatMoney(Math.round(heroTotal * 100), currency)}
            rangeLabel={formatRangeLabel(range)}
            data={heroPoints}
          />
          {miniCards.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {miniCards.map((c) => (
                <MetricMiniCard
                  key={c.id}
                  label={c.label}
                  value={c.value}
                  rangeLabel={formatRangeLabel(range)}
                  data={c.data}
                />
              ))}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-3">
            <MonthlyBarsCard months={monthlyBars} />
            <TimelineCard items={timeline} mode={timelineMode} onMode={setTimelineMode} />
            <BalanceCard
              collected={collected}
              onOpenStripe={() =>
                void import("@/lib/desktop").then((m) =>
                  m.openExternalUrl("https://dashboard.stripe.com/balance"),
                )
              }
            />
          </div>
          <h3 className="text-sm font-medium">Invoices</h3>
          {invoices.length === 0 ? (
            <EmptyState message="No invoices yet. Paid and failed invoices land here via webhooks." />
          ) : (
            <DataTable
              rows={invoices}
              columns={[
                { key: "customer_email", label: "Customer" },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
                { key: "amount", label: "Amount", render: (r) => formatMoney(Number(r.amount), String(r.currency)) },
                { key: "period_end_at", label: "Period end", render: (r) => formatDateTime(r.period_end_at) },
                {
                  key: "hosted_url",
                  label: "Receipt",
                  render: (r) =>
                    r.hosted_url ? (
                      <a href={String(r.hosted_url)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Open
                      </a>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          )}
        </>
      )}
      <CustomizeMetricsModal
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        selected={selectedMetrics}
        onSave={(ids) => {
          const clean = [...new Set(ids)];
          setSelectedMetrics(clean.length > 0 ? (clean as typeof selectedMetrics) : [...selectedMetrics]);
          try {
            localStorage.setItem(
              metricsStorageKey(connectionString || "default"),
              JSON.stringify(clean.length > 0 ? clean : selectedMetrics),
            );
          } catch {
            // storage unavailable — selection stays in memory
          }
        }}
      />
    </ViewShell>
  );
}

export function PaymentsWebhooksView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(false);

  const load = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    setError(null);
    const res = await queryPaykit(connectionString, PAYKIT_QUERIES.webhookEvents);
    setRows(res.rows);
    setMissing(res.missingSchema);
    if (!res.missingSchema) setError(res.error);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePayload = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setPayload(null);
      return;
    }
    setExpanded(id);
    setPayloadLoading(true);
    const safeId = id.replace(/'/g, "''");
    const res = await queryPaykit(
      connectionString,
      PAYKIT_QUERIES.webhookEventPayload.replace("__ID__", safeId),
    );
    setPayload(res.rows[0]?.payload ? JSON.stringify(res.rows[0].payload, null, 2) : null);
    setPayloadLoading(false);
  };

  return (
    <ViewShell title="Webhooks" description="Stripe events received by paykit-webhook, newest first. Failed events are retried by Stripe." loading={loading} onRefresh={() => void load()}>
      {loading ? (
        <ViewLoading />
      ) : missing ? (
        <SetupCta onGoSetup={() => studio.openPaymentsSetupTab?.()} />
      ) : (
        <>
          {error && <ViewError message={error} />}
          {rows.length === 0 ? (
            <EmptyState message="No webhook events yet. Send a test event from the Stripe Dashboard after registering the endpoint." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <div key={String(row.id)} className="overflow-hidden rounded-xl border border-studio-border/60">
                  <button
                    type="button"
                    onClick={() => void togglePayload(String(row.id))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/20"
                  >
                    <StatusBadge status={String(row.status)} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{String(row.type)}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(row.received_at)}</span>
                  </button>
                  {row.error && (
                    <p className="break-words border-t border-studio-border/40 px-3 py-1.5 text-[11px] text-destructive">
                      {String(row.error).slice(0, 500)}
                    </p>
                  )}
                  {expanded === String(row.id) && (
                    <pre className="max-h-64 overflow-auto border-t border-studio-border/40 bg-black/30 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
                      {payloadLoading ? "Loading…" : (payload ?? "No payload stored.")}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ViewShell>
  );
}
