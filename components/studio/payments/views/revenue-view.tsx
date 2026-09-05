"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PAYKIT_QUERIES,
  formatDateTime,
  formatMoney,
  queryPaykit,
} from "@/lib/supabase-paykit/queries";
import {
  DataTable,
  EmptyState,
  SetupCta,
  StatusBadge,
  ViewError,
  ViewLoading,
  ViewShell,
} from "./shared";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-studio-border/60 bg-studio-bg/40 p-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-xl font-semibold tracking-tight">{value}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function PaymentsRevenueView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [invoices, setInvoices] = useState<Record<string, any>[]>([]);
  const [kpis, setKpis] = useState<Record<string, any> | null>(null);
  const [mrrCents, setMrrCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    setError(null);
    const [inv, kpi, mrr] = await Promise.all([
      queryPaykit(connectionString, PAYKIT_QUERIES.invoices),
      queryPaykit(connectionString, PAYKIT_QUERIES.revenueKpis),
      queryPaykit(connectionString, PAYKIT_QUERIES.mrr),
    ]);
    setInvoices(inv.rows);
    setKpis(kpi.rows[0] ?? null);
    setMrrCents(mrr.rows[0]?.mrr_cents != null ? Number(mrr.rows[0].mrr_cents) : null);
    setMissing(inv.missingSchema || kpi.missingSchema);
    const firstError = [inv, kpi, mrr].find((r) => !r.missingSchema && r.error);
    setError(firstError?.error ?? null);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ViewShell title="Revenue" description="Monthly recurring revenue, collected invoices and failures." loading={loading} onRefresh={() => void load()}>
      {loading ? (
        <ViewLoading />
      ) : missing ? (
        <SetupCta onGoSetup={() => studio.openPaymentsSetupTab?.()} />
      ) : (
        <>
          {error && <ViewError message={error} />}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="MRR" value={mrrCents != null ? formatMoney(mrrCents) : "—"} hint="active monthly subs" />
            <Kpi label="Collected" value={formatMoney(Number(kpis?.paid_total ?? 0))} hint="paid invoices, all time" />
            <Kpi label="Active subs" value={String(kpis?.active_subs ?? 0)} />
            <Kpi label="Failed invoices" value={String(kpis?.failed_invoices ?? 0)} hint="need attention" />
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
    </ViewShell>
  );
}

export function PaymentsWebhooksView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
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
