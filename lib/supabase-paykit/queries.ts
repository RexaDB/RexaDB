import { runQuery } from "@/lib/api/actions-client";
import { PAYKIT_SCHEMA } from "./paykit-sql";

export interface PaykitQueryResult {
  rows: Record<string, any>[];
  error: string | null;
  missingSchema: boolean;
}

function isMissingTable(message: string): boolean {
  return (
    /relation "?paykit\./i.test(message) ||
    /schema "?paykit"? does not exist/i.test(message) ||
    /paykit_[a-z_]*"?\s+does not exist/i.test(message)
  );
}

/** Runs read-only SQL against the user's project connection (postgres direct or supabase-mgmt). */
export async function queryPaykit(
  connectionString: string,
  sql: string,
): Promise<PaykitQueryResult> {
  try {
    const res: any = await runQuery(connectionString, sql);
    if (!res?.success) {
      const message = String(res?.error ?? "Query failed.");
      return { rows: [], error: message, missingSchema: isMissingTable(message) };
    }
    const rows = Array.isArray(res?.data?.rows) ? res.data.rows : [];
    return { rows, error: null, missingSchema: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query failed.";
    return { rows: [], error: message, missingSchema: isMissingTable(message) };
  }
}

const P = PAYKIT_SCHEMA;

export const PAYKIT_QUERIES = {
  customers: `SELECT c.id, c.email, c.name, c.stripe_customer_id, c.created_at,
    (SELECT count(*) FROM ${P}.subscription s WHERE s.customer_id = c.id AND s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL) AS active_subs,
    (SELECT count(*) FROM ${P}.subscription s WHERE s.customer_id = c.id) AS total_subs
  FROM ${P}.customer c ORDER BY c.created_at DESC LIMIT 200`,
  subscriptions: `SELECT s.id, s.customer_id, c.email AS customer_email, s.product_internal_id,
    p.name AS plan_name, s.status, s.canceled, s.cancel_at_period_end,
    s.current_period_end_at, s.quantity, s.updated_at
  FROM ${P}.subscription s
  LEFT JOIN ${P}.customer c ON c.id = s.customer_id
  LEFT JOIN ${P}.product p ON p.internal_id = s.product_internal_id
  ORDER BY s.updated_at DESC LIMIT 200`,
  invoices: `SELECT i.id, i.customer_id, c.email AS customer_email, i.subscription_id,
    i.status, i.amount, i.currency, i.hosted_url, i.period_start_at, i.period_end_at, i.created_at
  FROM ${P}.invoice i
  LEFT JOIN ${P}.customer c ON c.id = i.customer_id
  ORDER BY i.created_at DESC LIMIT 200`,
  revenueKpis: `SELECT
    (SELECT coalesce(sum(amount),0) FROM ${P}.invoice WHERE status = 'paid') AS paid_total,
    (SELECT count(*) FROM ${P}.subscription WHERE status IN ('active','trialing') AND canceled = false AND ended_at IS NULL) AS active_subs,
    (SELECT count(*) FROM ${P}.customer) AS customers,
    (SELECT count(*) FROM ${P}.invoice WHERE status = 'failed') AS failed_invoices`,
  mrr: `SELECT coalesce(sum(p.price_amount * s.quantity),0) AS mrr_cents
  FROM ${P}.subscription s
  JOIN ${P}.product p ON p.internal_id = s.product_internal_id
  WHERE s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL
    AND p.price_amount IS NOT NULL AND p.price_interval = 'month'`,
  webhookEvents: `SELECT id, type, status, error, received_at, processed_at, stripe_event_id
  FROM ${P}.webhook_event ORDER BY received_at DESC LIMIT 200`,
  webhookEventPayload: `SELECT payload FROM ${P}.webhook_event WHERE id = '__ID__' LIMIT 1`,
  products: `SELECT p.internal_id, p.id, p.name, p.group, p.is_default, p.price_amount,
    p.price_interval, p.price_currency, p.stripe_product_id, p.stripe_price_id,
    (SELECT count(*) FROM ${P}.subscription s WHERE s.product_internal_id = p.internal_id AND s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL) AS active_subs
  FROM ${P}.product p ORDER BY p.price_amount NULLS FIRST, p.id`,
};

export function formatMoney(amountCents: number | null | undefined, currency?: string | null): string {
  if (amountCents == null || !Number.isFinite(Number(amountCents))) return "—";
  const dollars = Number(amountCents) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}
