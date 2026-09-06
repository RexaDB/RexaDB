/**
 * Pure analytics helpers for the Revenue overview: time ranges, series
 * bucketing, relative times, currency resolution, the metric registry, and
 * the deterministic mock-data SQL builder (seeded demo dataset for the
 * console command + empty state).
 *
 * Everything here is side-effect free and unit-tested. All timestamps flow
 * through an injectable `now` so tests are deterministic.
 */

export type RevenueRangeKey = "all" | "12m" | "3m" | "30d" | "today";

export const REVENUE_RANGES: Array<{ id: RevenueRangeKey; label: string; days: number | null }> = [
  { id: "all", label: "All Time", days: null },
  { id: "12m", label: "12m", days: 365 },
  { id: "3m", label: "3m", days: 90 },
  { id: "30d", label: "30d", days: 30 },
  { id: "today", label: "Today", days: 1 },
];

export interface DayPoint {
  /** ISO date (yyyy-mm-dd). */
  day: string;
  value: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function toDayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatAxisDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${String(d || 1).padStart(2, "0")}`;
}

export function formatRangeLabel(range: RevenueRangeKey, now = Date.now()): string {
  const def = REVENUE_RANGES.find((r) => r.id === range);
  const end = new Date(now);
  const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  if (!def || def.days === null) return "All time";
  if (range === "today") {
    return `${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  const start = new Date(now - (def.days - 1) * 86400000);
  return fmt(start);
}

/** Keep points inside the selected window (inclusive). */
export function filterSeriesByRange(
  points: DayPoint[],
  range: RevenueRangeKey,
  now = Date.now(),
): DayPoint[] {
  const def = REVENUE_RANGES.find((r) => r.id === range);
  if (!def || def.days === null) return points;
  const cutoff = toDayKey(now - (def.days - 1) * 86400000);
  return points.filter((p) => p.day >= cutoff);
}

/** Sum of values in the window. */
export function sumSeries(points: DayPoint[]): number {
  return points.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
}

/**
 * Zero-filled skeleton series so empty charts still render gridlines, axes
 * and a flat baseline instead of a blank card. One point per day inside the
 * window (monthly for 12m, hourly for today), capped for sanity.
 */
export function emptySeriesForRange(
  range: RevenueRangeKey,
  now = Date.now(),
): Array<{ x: string; y: number }> {
  if (range === "today") {
    const end = new Date(now);
    end.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(end.getTime() - (23 - i) * 3600000);
      return { x: `${String(d.getHours()).padStart(2, "0")}:00`, y: 0 };
    });
  }
  if (range === "12m") {
    const end = new Date(now);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(end.getFullYear(), end.getMonth() - (11 - i), 1);
      return { x: formatAxisDay(toDayKey(d.getTime())), y: 0 };
    });
  }
  const days = range === "all" ? 90 : (REVENUE_RANGES.find((r) => r.id === range)?.days ?? 30);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now - (days - 1 - i) * 86400000);
    return { x: formatAxisDay(toDayKey(d.getTime())), y: 0 };
  });
}

export function timeAgo(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso));
  if (!Number.isFinite(ms)) return "—";
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Most common currency code (uppercased), defaulting to USD. */
export function dominantCurrency(
  rows: Array<Record<string, any>>,
  field = "currency",
): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = String(row?.[field] || "").toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = "USD";
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

// ─── metric registry ─────────────────────────────────────────────────────

export type RevenueMetricId =
  | "revenue"
  | "mrr"
  | "active"
  | "orders"
  | "checkouts"
  | "cancellations";

export interface RevenueMetricDef {
  id: RevenueMetricId;
  label: string;
  hint: string;
}

export const AVAILABLE_METRICS: RevenueMetricDef[] = [
  { id: "revenue", label: "Revenue", hint: "Collected from paid invoices." },
  { id: "mrr", label: "Monthly Recurring Revenue", hint: "Active monthly plans right now." },
  { id: "active", label: "Active Subscriptions", hint: "Non-canceled, unended subscriptions." },
  { id: "orders", label: "Orders", hint: "Paid invoice count." },
  { id: "checkouts", label: "Checkouts", hint: "Checkout sessions started." },
  { id: "cancellations", label: "Cancellations", hint: "Canceled or ended subscriptions." },
];

export interface UnavailableMetricDef {
  label: string;
  reason: string;
}

export const UNAVAILABLE_METRICS: UnavailableMetricDef[] = [
  { label: "Unit Economics", reason: "No cost data source yet." },
  { label: "Costs", reason: "No cost data source yet." },
  { label: "Usage", reason: "No usage metering source yet." },
  { label: "Seats", reason: "No seat model yet." },
];

export const DEFAULT_SELECTED_METRICS: RevenueMetricId[] = [
  "revenue",
  "mrr",
  "active",
  "orders",
  "checkouts",
];

export const METRICS_STORAGE_PREFIX = "rexadb-revenue-metrics:";

export function metricsStorageKey(projectRef: string): string {
  return `${METRICS_STORAGE_PREFIX}${projectRef}`;
}

export function sanitizeSelectedMetrics(value: unknown): RevenueMetricId[] {
  const valid = new Set(AVAILABLE_METRICS.map((m) => m.id));
  if (!Array.isArray(value)) return [...DEFAULT_SELECTED_METRICS];
  const cleaned = [...new Set(value)].filter(
    (id): id is RevenueMetricId => typeof id === "string" && valid.has(id as RevenueMetricId),
  );
  return cleaned.length > 0 ? cleaned : [...DEFAULT_SELECTED_METRICS];
}

// ─── deterministic in-memory mock dataset ──────────────────────────────
// Preview-only: feeds the Revenue overview charts without touching the
// database. Row shapes mirror the live queries 1:1. Seeded PRNG + injectable
// `now` keep it deterministic for tests.

export interface MockRevenueDataset {
  invoices: Array<Record<string, any>>;
  kpis: Record<string, any>;
  mrrCents: number;
  revenueDaily: Array<{ day: string; cents: number; orders: number }>;
  mrrDaily: DayPoint[];
  activeSubsDaily: Array<{ day: string; subs: number }>;
  checkoutsDaily: Array<{ day: string; checkouts: number }>;
  cancelsDaily: Array<{ day: string; cancels: number }>;
  customers: Array<Record<string, any>>;
  webhookEvents: Array<Record<string, any>>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_NAMES: Array<[string, string]> = [
  ["Zeki", "zeki@example.com"],
  ["Ada", "ada@example.com"],
  ["Grace", "grace@example.com"],
  ["Linus", "linus@example.com"],
  ["Mira", "mira@example.com"],
  ["Theo", "theo@example.com"],
];

const MOCK_AMOUNTS = [1000, 2000, 2000, 2900, 2900, 4900, 9900, 1500, 2500, 9900];

export function buildMockRevenueDataset(seed = 7, now = Date.now()): MockRevenueDataset {
  const rand = mulberry32(seed);
  const day = 86400000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const at = (daysAgo: number, jitterHours = 12) =>
    now - daysAgo * day - Math.floor(rand() * jitterHours * 3600000);

  const customers = MOCK_NAMES.map(([name, email], i) => {
    const n = String(i + 1).padStart(3, "0");
    return {
      id: `mock-cus-${n}`,
      email,
      name,
      created_at: iso(at(80 - i * 5)),
      stripe_customer_id: `cus_mock_${n}`,
    };
  });

  const subs = [
    { id: "mock-sub-001", customer: "mock-cus-001", startAgo: 45, endAgo: null as number | null },
    { id: "mock-sub-002", customer: "mock-cus-002", startAgo: 30, endAgo: null as number | null },
    { id: "mock-sub-003", customer: "mock-cus-003", startAgo: 12, endAgo: null as number | null },
    { id: "mock-sub-004", customer: "mock-cus-004", startAgo: 70, endAgo: 50 as number | null },
    { id: "mock-sub-005", customer: "mock-cus-005", startAgo: 55, endAgo: 35 as number | null },
  ].map((s) => ({
    ...s,
    canceled: s.endAgo !== null,
    status: s.endAgo !== null ? ("canceled" as const) : ("active" as const),
  }));

  const invoices: Array<Record<string, any>> = [];
  let inv = 0;
  const paidInvoice = (daysAgo: number, amount: number, customer: string) => {
    inv += 1;
    const n = String(inv).padStart(3, "0");
    const created = iso(at(daysAgo));
    invoices.push({
      id: `mock-inv-${n}`,
      customer_id: customer,
      customer_email: customers.find((c) => c.id === customer)?.email ?? "",
      subscription_id: "mock-sub-001",
      type: "subscription",
      status: "paid",
      amount,
      currency: "usd",
      hosted_url: null,
      period_start_at: created,
      period_end_at: created,
      created_at: created,
    });
  };
  for (let d = 89; d >= 0; d--) {
    const roll = rand();
    const burst = d <= 4 ? 3 : 0; // recent spike like the reference chart
    const count = roll < 0.45 ? 1 : roll < 0.7 ? 2 : 0;
    for (let k = 0; k < count + burst; k++) {
      paidInvoice(d, MOCK_AMOUNTS[Math.floor(rand() * MOCK_AMOUNTS.length)], `mock-cus-00${1 + Math.floor(rand() * 5)}`);
    }
  }
  for (let k = 0; k < 3; k++) {
    inv += 1;
    const n = String(inv).padStart(3, "0");
    const created = iso(at(3 + k * 4));
    invoices.push({
      id: `mock-inv-${n}`,
      customer_id: "mock-cus-002",
      customer_email: "ada@example.com",
      subscription_id: "mock-sub-002",
      type: "subscription",
      status: "failed",
      amount: 2000,
      currency: "usd",
      hosted_url: null,
      period_start_at: created,
      period_end_at: created,
      created_at: created,
    });
  }

  const paid = invoices.filter((r) => r.status === "paid");
  const paidTotal = paid.reduce((s, r) => s + r.amount, 0);
  const byDay = new Map<string, { cents: number; orders: number }>();
  for (const r of paid) {
    const key = toDayKey(Date.parse(r.created_at));
    const bucket = byDay.get(key) || { cents: 0, orders: 0 };
    bucket.cents += r.amount;
    bucket.orders += 1;
    byDay.set(key, bucket);
  }
  const revenueDaily = [...byDay.entries()]
    .map(([d, b]) => ({ day: d, cents: b.cents, orders: b.orders }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  // MRR + active-sub step series over the last 90 days.
  const mrrDaily: DayPoint[] = [];
  const activeSubsDaily: Array<{ day: string; subs: number }> = [];
  for (let d = 89; d >= 0; d--) {
    const t = now - d * day;
    const key = toDayKey(t);
    const live = subs.filter(
      (s) => t >= now - s.startAgo * day && (s.endAgo === null || t < now - s.endAgo * day),
    );
    mrrDaily.push({ day: key, value: live.filter((s) => s.endAgo === null).length * 2000 });
    activeSubsDaily.push({ day: key, subs: live.filter((s) => s.endAgo === null).length });
  }

  const checkoutsDaily: Array<{ day: string; checkouts: number }> = [];
  for (let k = 0; k < 8; k++) {
    const key = toDayKey(at(k * 4, 6));
    const found = checkoutsDaily.find((c) => c.day === key);
    if (found) found.checkouts += 1;
    else checkoutsDaily.push({ day: key, checkouts: 1 });
  }
  checkoutsDaily.sort((a, b) => (a.day < b.day ? -1 : 1));

  const cancelsDaily = subs
    .filter((s) => s.endAgo !== null)
    .map((s) => ({ day: toDayKey(now - (s.endAgo as number) * day), cancels: 1 }));

  const webhookEvents: Array<Record<string, any>> = [];
  let evt = 0;
  const event = (daysAgo: number, type: string, status: string) => {
    evt += 1;
    const n = String(evt).padStart(3, "0");
    webhookEvents.push({
      id: `mock-evt-${n}`,
      type,
      status,
      received_at: iso(at(daysAgo)),
      stripe_event_id: `evt_mock_${n}`,
    });
  };
  for (let d = 30; d >= 0; d -= 3) {
    event(d, "invoice.payment_succeeded", "processed");
    if (d % 9 === 0) event(d + 1, "customer.created", "processed");
    if (d % 12 === 0) event(d + 2, "checkout.session.completed", "processed");
  }
  event(1, "invoice.payment_failed", "failed");
  webhookEvents.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));

  const activeCount = subs.filter((s) => s.endAgo === null).length;
  return {
    invoices: [...invoices].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    kpis: {
      paid_total: paidTotal,
      active_subs: activeCount,
      customers: customers.length,
      failed_invoices: invoices.filter((r) => r.status === "failed").length,
    },
    mrrCents: activeCount * 2000,
    revenueDaily,
    mrrDaily,
    activeSubsDaily,
    checkoutsDaily,
    cancelsDaily,
    customers,
    webhookEvents,
  };
}
