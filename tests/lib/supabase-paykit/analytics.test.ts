import test from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABLE_METRICS,
  DEFAULT_SELECTED_METRICS,
  UNAVAILABLE_METRICS,
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
  toDayKey,
} from "../../../lib/supabase-paykit/analytics";

const NOW = new Date("2026-09-05T12:00:00Z").getTime();

test("toDayKey and formatAxisDay round-trip", () => {
  assert.equal(toDayKey(NOW), "2026-09-05");
  assert.equal(formatAxisDay("2026-09-05"), "Sep 05");
  assert.equal(formatAxisDay("2026-08-07"), "Aug 07");
});

test("filterSeriesByRange windows correctly", () => {
  const points = [
    { day: "2026-09-05", value: 1 },
    { day: "2026-08-20", value: 2 },
    { day: "2026-06-01", value: 3 },
    { day: "2025-01-01", value: 4 },
  ];
  assert.equal(filterSeriesByRange(points, "all", NOW).length, 4);
  assert.equal(filterSeriesByRange(points, "30d", NOW).length, 2);
  assert.equal(filterSeriesByRange(points, "today", NOW).length, 1);
  assert.equal(filterSeriesByRange(points, "12m", NOW).length, 3);
  assert.equal(sumSeries(filterSeriesByRange(points, "30d", NOW)), 3);
});

test("formatRangeLabel renders human windows", () => {
  assert.equal(formatRangeLabel("all", NOW), "All time");
  assert.ok(formatRangeLabel("30d", NOW).includes("2026"));
  assert.ok(formatRangeLabel("today", NOW).includes("Sep 5"));
});

test("timeAgo buckets", () => {
  assert.equal(timeAgo(NOW, NOW), "just now");
  assert.equal(timeAgo(NOW - 5 * 60000, NOW), "5m ago");
  assert.equal(timeAgo(NOW - 3 * 3600000, NOW), "3h ago");
  assert.equal(timeAgo(NOW - 2 * 86400000, NOW), "2d ago");
  assert.equal(timeAgo(null, NOW), "—");
  assert.equal(timeAgo("garbage", NOW), "—");
});

test("dominantCurrency picks the majority code", () => {
  assert.equal(
    dominantCurrency([{ currency: "usd" }, { currency: "eur" }, { currency: "usd" }]),
    "USD",
  );
  assert.equal(dominantCurrency([]), "USD");
  assert.equal(dominantCurrency([{ currency: "eur" }]), "EUR");
});

test("metric registry is coherent", () => {
  const ids = AVAILABLE_METRICS.map((m) => m.id);
  assert.deepEqual([...DEFAULT_SELECTED_METRICS].sort(), [...ids.filter((id) => id !== "cancellations")].sort());
  assert.ok(UNAVAILABLE_METRICS.length > 0);
  assert.ok(UNAVAILABLE_METRICS.every((m) => m.reason.length > 0));
  assert.equal(metricsStorageKey("abc"), "rexadb-revenue-metrics:abc");
  assert.deepEqual(sanitizeSelectedMetrics(["mrr", "bogus", "mrr"]), ["mrr"]);
  assert.deepEqual(sanitizeSelectedMetrics(null), DEFAULT_SELECTED_METRICS);
  assert.deepEqual(sanitizeSelectedMetrics([]), DEFAULT_SELECTED_METRICS);
});

test("emptySeriesForRange renders skeleton grids", () => {
  const d30 = emptySeriesForRange("30d", NOW);
  assert.equal(d30.length, 30);
  assert.ok(d30.every((p) => p.y === 0));
  assert.equal(d30[0].x, "Aug 07");
  assert.equal(d30[d30.length - 1].x, "Sep 05");
  assert.equal(emptySeriesForRange("today", NOW).length, 24);
  assert.ok(emptySeriesForRange("today", NOW)[0].x.endsWith(":00"));
  assert.equal(emptySeriesForRange("12m", NOW).length, 12);
  assert.equal(emptySeriesForRange("3m", NOW).length, 90);
  assert.equal(emptySeriesForRange("all", NOW).length, 90);
});

test("mock dataset is deterministic and internally consistent", () => {
  const a = buildMockRevenueDataset(7, NOW);
  const b = buildMockRevenueDataset(7, NOW);
  const c = buildMockRevenueDataset(8, NOW);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.invoices, c.invoices);
  // every id is mock-namespaced. The dataset lives in memory only and is
  // never written anywhere — no SQL builder exists for it by design.
  const ids = [
    ...a.invoices.map((r) => r.id),
    ...a.customers.map((r) => r.id),
    ...a.webhookEvents.map((r) => r.id),
  ];
  assert.ok(ids.length > 20);
  assert.ok(ids.every((id) => String(id).startsWith("mock-")));
  // aggregates match their primitives
  const paidTotal = a.invoices
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + r.amount, 0);
  assert.equal(a.kpis.paid_total, paidTotal);
  assert.equal(a.kpis.active_subs, 3);
  assert.equal(a.mrrCents, 6000);
  assert.equal(a.kpis.failed_invoices, 3);
  assert.equal(
    sumSeries(a.revenueDaily.map((d) => ({ day: d.day, value: d.cents }))),
    paidTotal,
  );
  // revenue series sorted ascending by day
  const days = a.revenueDaily.map((d) => d.day);
  assert.deepEqual([...days].sort(), days);
  // mrr + subs step series cover 90 days
  assert.equal(a.mrrDaily.length, 90);
  assert.equal(a.activeSubsDaily.length, 90);
  // timeline newest-first
  const times = a.webhookEvents.map((r) => r.received_at);
  assert.deepEqual([...times].sort().reverse(), times);
});
